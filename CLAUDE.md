# LambdaLab — map for agents

Interactive lessons in the theory of computation, for bright 11-12 year olds.
Deployed as an [enlace](https://github.com/thorwhalen/enlace) app at
`apps.thorwhalen.com/lambdalab`.

## The two ideas everything else follows from

**1. A set IS a unary predicate.** `x ∈ Dogs` and `Dogs(x)` denote the same fact,
so `src/lib/logic/` is ONE engine covering both notations. Grading is exhaustive
model checking (`logicEquivalent`): enumerate every tiny universe up to domain
size 3, compare the learner's formula against the reference, and when they
disagree, **the disagreeing universe is the feedback**. Don't "fix" this into a
syntactic comparison — the counter-world is the entire pedagogical bet.

This is the small-scope hypothesis, and it is documented as such in
`logic/equivalence.ts`. It is not a decision procedure and cannot be; formulas
whose only counterexamples need ≥4 elements would be wrongly accepted. For tile-built
formulas this does not happen in practice.

**2. Automata puzzles author a REGEX and derive everything else.** The target
machine (Thompson), the grading (equivalence), the feedback (shortest
counterexample), the par score (`minimalStateCount`) are all *computed* from the
one authored string. Never hand-author a machine and a regex and a state count
and expect them to stay consistent.

## Layout

| Path | Role |
|------|------|
| `src/core/types.ts` | **SSOT**: Lesson, Level (the ladder), Resource, ScoreSubmission, Verdict |
| `src/core/progress.ts` | localStorage progress; `checkAdvance` is the one place a rung opens |
| `src/core/leaderboard.ts` | API client; **degrades to a localStorage board** when the backend is absent |
| `src/lib/automata/` | simulate, regexParse, subset, thompson, minimize, equivalence, toRegex |
| `src/lib/logic/` | parse, evaluate, models, equivalence, english |
| `src/components/` | shared UI: `AutomatonCanvas`, `VennPlayground`, `LittleWorld`, `FormulaBuilder`, `LessonShell` |
| `src/lessons/<id>/` | `content.ts` (ladder + puzzles), `content.test.ts`, `resources.ts`, activity components, `index.tsx` |
| `src/lessons/registry.ts` | the course map — every module, including unbuilt ones |
| `server.py` | FastAPI leaderboards. No accounts. Scores are client-computed and forgeable *on purpose* (see its docstring) |
| `docs/` | the research behind every curated link, and the curriculum plan |

## The rule that keeps the content correct

**Every lesson's puzzle bank has a `content.test.ts` that checks it by machine.**
It is not optional and it is not ceremony — it caught seven real errors in the
first hand-authored bank (distractors that were logically equivalent to the
answer, and constants that silently parsed as free variables). If you add
puzzles, the test must still pass.

- set-logic: no distractor may be equivalent to the answer *or to another
  distractor*; every token must be in the palette at that puzzle's level.
- automata-regex: every `accept` string must really match the reference regex,
  every `reject` string must really not, and the examples must actually pin the
  language down (a puzzle that "accept everything" would pass is not a puzzle).

## Progressive disclosure

A lesson declares a `ladder: Level[]`. The learner has one integer per lesson,
`levelReached`. Everything — prose sections, palette tiles, regex operators,
whether ε-moves are offered — filters on it. A rung opens when `toAdvance`
puzzles at the current rung are solved; you are never blocked on a *specific*
puzzle, only on *enough* of them.

To add a symbol to the logic game, give its `Tile` a `level`. That is the whole
mechanism. Do not add gating logic anywhere else.

## Commands

```bash
npm run dev        # localhost:5178 (leaderboard falls back to local — fine)
npm test           # the engines and the content banks
npm run typecheck
npm run build      # → frontend/ (what enlace serves)
uvicorn server:app --reload --port 8000   # optional backend
```

## Deploy

Registered in `tw_platform/platform.toml` under `app_dirs` as `../lambdalab`.

```bash
cd ~/Dropbox/py/proj/tt/tw_platform
python deploy.py cmd-deploy --app lambdalab --force
```

`--force` is required from an agent shell (no TTY). See the `twp-deploy` skill.

## Don't

- Don't add regex features beyond union/concat/star/+/?/ε/∅. Backreferences and
  lookahead take you *outside* the regular languages, and the boundary is the
  lesson.
- Don't grade an automaton by running the test strings. Passing the visible
  examples is easy and teaches nothing; grade against the language.
- Don't replace a counterexample with a red cross.
