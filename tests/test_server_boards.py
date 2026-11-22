"""Only the boards the app ships can be written or read; unknown ids create no file."""

import importlib.util
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SERVER = Path(__file__).resolve().parents[1] / "server.py"


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Load THIS server.py by path with its own data dir (a bare import may find another app's)."""
    monkeypatch.setenv("LAMBDALAB_DATA_DIR", str(tmp_path))
    spec = importlib.util.spec_from_file_location("lambdalab_server", SERVER)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # pydantic resolves postponed annotations through sys.modules
    spec.loader.exec_module(module)
    return TestClient(module.app), tmp_path, module


def _post(c, board):
    return c.post("/scores", json={"board": board, "nickname": "ada", "score": 10})


def test_known_board_accepts_a_score(client):
    c, root, module = client
    board = sorted(module.KNOWN_BOARDS)[0]
    assert _post(c, board).status_code == 200
    assert (root / "leaderboards" / f"{board}.json").is_file()


def test_unknown_board_is_rejected_and_creates_no_file(client):
    c, root, _ = client
    res = _post(c, "set-logic.made-up")
    assert 400 <= res.status_code < 500
    assert not list((root / "leaderboards").glob("*")) if (root / "leaderboards").exists() else True


def test_many_unknown_boards_never_grow_the_directory(client):
    c, root, _ = client
    for i in range(30):
        assert _post(c, f"x.board-{i}").status_code == 422
    assert not (root / "leaderboards").exists()


def test_reading_an_unknown_board_is_404(client):
    c, _, _ = client
    assert c.get("/boards/set-logic.made-up").status_code == 404
