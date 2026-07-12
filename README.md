# LambdaLab

**The theory of computation, for curious minds.**

Interactive lessons in the mathematics behind computer science — sets, logic,
automata, regular expressions, computability — built for two kids aged 11 and 12
who kept asking questions that deserved real answers.

Live at **[apps.thorwhalen.com/lambdalab](https://apps.thorwhalen.com/lambdalab/)**.

Nothing here is watch-only. Every lesson hands you something to push, drag,
break and rebuild, and only *then* points you at the best videos, games and
explanations the rest of the internet has to offer.

---

## What's in it

Two lessons are built:

**Sets & Logic** — the language mathematics is written in. Culminates in a
two-way translation game: read a sentence in formal notation and say what it
means; read an English sentence and *build* its formal version by clicking symbol
tiles. Get it wrong and you are not told "wrong" — you are shown a tiny universe
in which your sentence says something you did not mean.

**Finite Automata & Regular Expressions** — build a machine by dragging states
and arrows until it accepts exactly the strings it should. Write a regular
expression that does the same. Then convert between them, both directions, and
watch the conversion happen. A wrong machine is answered with the *shortest
string it gets wrong*.

The other fourteen modules are on the course map as ghosts — visible,
unclickable, honest about where the road goes.

## Design principles

1. **Play before notation.** The symbol arrives after the idea it abbreviates.
2. **A few things at a time.** Every lesson has a ladder; level 1 hands you five
   symbols and nothing else. Being overwhelmed is a design failure, not a rite of
   passage.
3. **Wrong answers are the interesting ones.** Never "wrong" — always the
   evidence: the exact string, the concrete counter-world.
4. **Par, not rank.** Leaderboards exist, but the number that matters is par (the
   author's score) and your own personal best.
5. **No condescension.** The mathematics is real, the notation is standard, and
   nothing taught here has to be un-taught later.

The full curriculum plan and the research behind every curated link live in
[`docs/`](docs/).

## Architecture

```
src/
  core/       domain contracts (lesson, ladder, challenge, leaderboard) — the SSOT
  lib/
    automata/ NFA/DFA simulation, Thompson construction, subset construction,
              minimisation, equivalence-with-shortest-counterexample, state elimination
    logic/    a first-order language where a set IS a unary predicate, evaluated
              by exhaustive model checking over small domains
  components/ shared UI (the automaton canvas, the tile palette, the ladder)
  lessons/    one directory per lesson: content, puzzles, page
server.py     FastAPI — the nickname-only leaderboards. No accounts, no tracking.
```

The engines are the interesting part. Both are property-tested against
independent oracles: the automata engine is fuzzed on the full round trip
(regex → NFA → DFA → minimise → regex → parse → NFA → *is it still the same
language?*), and the logic engine is checked against a second, independently
written evaluator.

### The key idea in the logic engine

A set and a unary predicate are the same thing: `x ∈ Dogs` and `Dogs(x)` denote
the same fact. So one engine covers both notations, the lesson can make that
identification explicit — and grading becomes *exhaustive model checking*. We
enumerate every possible tiny universe and compare the learner's formula against
the reference. When they disagree, the disagreeing universe **is** the feedback.

(This is the small-scope hypothesis: agreement over all models up to three
elements is not a proof of logical equivalence, but for formulas built from a
handful of tiles it is right in practice — and the honest alternative, a decision
procedure for first-order logic, does not exist.)

## Development

```bash
npm install
npm run dev        # http://localhost:5178
npm test           # vitest — the engines are the thing worth testing
npm run typecheck
npm run build      # emits frontend/ (what enlace serves)
```

The leaderboard backend is optional in development: with no server running, the
client falls back to a localStorage board and tells you it has done so.

To run the backend too:

```bash
uvicorn server:app --reload --port 8000
```

## Deployment

Deployed as an app on the [enlace](https://github.com/thorwhalen/enlace) platform.
`app.toml` declares the build; `platform.toml` in `tw_platform` registers it.

## Licence

MIT for the code. The curated third-party resources belong to the people who made
them and are linked, never copied.
