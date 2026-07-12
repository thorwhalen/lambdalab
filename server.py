"""Backend for LambdaLab — the challenge leaderboards.

Mounted by enlace at ``/api/lambdalab``. There are no accounts and no personal
data: a learner picks a nickname, it lives in their browser's localStorage, and
it is the only thing that ever reaches this server alongside a score.

Storage is one JSON file per board under ``$LAMBDALAB_DATA_DIR`` (default
``~/.local/share/lambdalab``). A board holds at most one entry per nickname —
the best one — so a single enthusiastic child cannot carpet the top ten.

On honesty: scores are computed in the browser, so they are trivially forgeable
by anyone who opens the devtools. That is a deliberate trade. The alternative —
re-running the automaton equivalence check and the model enumeration server-side
— would double the engine and buy nothing, because the audience is a handful of
kids and the leaderboards are *par-score* boards ("beat the author") rather than
a global ranking worth cheating for. The interesting exploit here is learning
enough JavaScript to forge a score, which we would consider a win.

Endpoints
---------
- ``GET  /health``               -> liveness
- ``GET  /boards``               -> every board id we hold, with entry counts
- ``GET  /boards/{board}``       -> the board's ranked entries
- ``POST /scores``               -> submit a score
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from threading import Lock
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

app = FastAPI(title="LambdaLab API", version="0.1.0")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DATA_DIR = Path(
    os.environ.get("LAMBDALAB_DATA_DIR", Path.home() / ".local" / "share" / "lambdalab")
)
BOARDS_DIR = DATA_DIR / "leaderboards"

# A board id looks like "set-logic.translate". Anything else is a bug or an
# attack; either way it must never reach the filesystem.
BOARD_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$")

NICKNAME_MAX_LEN = 16
# Letters (any script — the kids may want accents), digits, spaces, - and _.
NICKNAME_RE = re.compile(r"^[\w \-]{1,%d}$" % NICKNAME_MAX_LEN, re.UNICODE)

# Scores are points, always "higher is better" (see src/core/types.ts). Anything
# outside this range is a client bug, not a triumph.
SCORE_MIN = 0
SCORE_MAX = 1_000_000

# Per-board cap. Beyond this the lowest scores fall off the end.
MAX_ENTRIES_PER_BOARD = 200
DEFAULT_PAGE = 20
MAX_PAGE = 100

# `detail` is display-only metadata (states used, seconds taken, ...). Bound it
# so a board file cannot be used as free blob storage.
MAX_DETAIL_KEYS = 8
MAX_DETAIL_VALUE_LEN = 40

_write_lock = Lock()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ScoreSubmission(BaseModel):
    board: str
    nickname: str
    score: int = Field(ge=SCORE_MIN, le=SCORE_MAX)
    detail: dict[str, Any] = Field(default_factory=dict)

    @field_validator("board")
    @classmethod
    def _check_board(cls, v: str) -> str:
        if not BOARD_RE.match(v):
            raise ValueError(f"malformed board id: {v!r}")
        return v

    @field_validator("nickname")
    @classmethod
    def _check_nickname(cls, v: str) -> str:
        v = v.strip()
        if not NICKNAME_RE.match(v):
            raise ValueError(
                f"nickname must be 1-{NICKNAME_MAX_LEN} letters, digits, spaces, - or _"
            )
        return v

    @field_validator("detail")
    @classmethod
    def _check_detail(cls, v: dict[str, Any]) -> dict[str, Any]:
        if len(v) > MAX_DETAIL_KEYS:
            raise ValueError(f"detail may hold at most {MAX_DETAIL_KEYS} keys")
        out: dict[str, Any] = {}
        for key, value in v.items():
            if not isinstance(value, (int, float, str)):
                raise ValueError(f"detail[{key!r}] must be a number or a string")
            if isinstance(value, str) and len(value) > MAX_DETAIL_VALUE_LEN:
                raise ValueError(f"detail[{key!r}] is too long")
            out[str(key)[:32]] = value
        return out


class ScoreEntry(BaseModel):
    board: str
    nickname: str
    score: int
    detail: dict[str, Any] = Field(default_factory=dict)
    at: int
    rank: int


class Board(BaseModel):
    board: str
    entries: list[ScoreEntry]


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------


def _board_path(board: str) -> Path:
    """Path for a board's JSON file.

    `board` must already have been validated against BOARD_RE — the regex
    excludes ``/``, ``.``-runs and everything else that could escape BOARDS_DIR,
    so this cannot traverse. We re-check anyway: the cost is nil and the failure
    mode is arbitrary file write.
    """
    if not BOARD_RE.match(board):
        raise HTTPException(status_code=400, detail=f"malformed board id: {board!r}")
    return BOARDS_DIR / f"{board}.json"


def _load(board: str) -> list[dict[str, Any]]:
    path = _board_path(board)
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        # A corrupt board is not worth a 500 — the leaderboard is a nicety, and
        # returning empty degrades gracefully while leaving the file for a human.
        return []
    return raw if isinstance(raw, list) else []


def _save(board: str, rows: list[dict[str, Any]]) -> None:
    path = _board_path(board)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)  # atomic on POSIX


def _ranked(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sort by score desc, then by earliest submission — first to reach a score wins ties."""
    ordered = sorted(rows, key=lambda r: (-int(r.get("score", 0)), int(r.get("at", 0))))
    for i, row in enumerate(ordered):
        row["rank"] = i + 1
    return ordered


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "boards": len(list(BOARDS_DIR.glob("*.json"))) if BOARDS_DIR.exists() else 0}


@app.get("/boards")
def list_boards() -> dict[str, Any]:
    if not BOARDS_DIR.exists():
        return {"boards": []}
    out = [
        {"board": p.stem, "entries": len(_load(p.stem))}
        for p in sorted(BOARDS_DIR.glob("*.json"))
    ]
    return {"boards": out}


@app.get("/boards/{board}", response_model=Board)
def get_board(board: str, limit: int = DEFAULT_PAGE) -> Board:
    limit = max(1, min(limit, MAX_PAGE))
    rows = _ranked(_load(board))[:limit]
    return Board(board=board, entries=[ScoreEntry(**r) for r in rows])


@app.post("/scores", response_model=Board)
def submit_score(sub: ScoreSubmission, limit: int = DEFAULT_PAGE) -> Board:
    """Record a score and hand back the freshly-ranked board.

    Only an *improvement* is stored: a nickname holds exactly one entry per
    board, its best. Returning the whole board saves the client a round trip —
    it wants to render the new standings immediately anyway.
    """
    limit = max(1, min(limit, MAX_PAGE))
    now = int(time.time() * 1000)

    with _write_lock:
        rows = _load(sub.board)
        existing = next((r for r in rows if r.get("nickname") == sub.nickname), None)

        if existing is None:
            rows.append(
                {
                    "board": sub.board,
                    "nickname": sub.nickname,
                    "score": sub.score,
                    "detail": sub.detail,
                    "at": now,
                }
            )
        elif sub.score > int(existing.get("score", 0)):
            existing.update(score=sub.score, detail=sub.detail, at=now)
        # else: an equal-or-worse attempt. Keep the better one; still return the board.

        rows = _ranked(rows)[:MAX_ENTRIES_PER_BOARD]
        _save(sub.board, rows)

    return Board(board=sub.board, entries=[ScoreEntry(**r) for r in rows[:limit]])
