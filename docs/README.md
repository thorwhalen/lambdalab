# docs/

The thinking behind LambdaLab.

| File | What it is |
|---|---|
| `PLAN.md` | The curriculum: every module, the dependency order, the lesson template, the progressive-disclosure model, and the rollout plan. **Start here.** |
| `research/<topic>.md` | One dossier per module. What material exists on the internet for this topic, what earned a place on the lesson page, **what was rejected and why**, and — most usefully — what does *not* exist and therefore has to be built. |
| `research/deepdive-*.md` | The deep dives: two-way logic translation, set/logic activities, automata tooling and algorithms, automata pedagogy, the pedagogy of the platform itself, and a survey of the other subjects worth teaching. |
| `lessons/design-*.md` | The build specs for the two lessons that shipped — mechanics, level ladders, data models, grading, scoring, and the seeded puzzle lists. |

## How a resource earns its place

The bar is: *would a bright, easily-bored 11-year-old be glad they clicked it?*

- Free and no-login, unless the thing is so good it buys the exception (there are
  two or three of these; they are marked).
- Videos under six minutes wherever possible. A long video has to earn it.
- Interactives and games beat passive video when both exist for a concept.
- Every lesson's shelf needs a **hook**, some **core explainers**, something to
  **play** with, some **practice**, and a **stretch** item or two.
- Rejections are recorded with the reason. That list is more useful than the
  accept list — it stops the same SEO filler being re-considered every time.

The shelves in the app are generated from `src/lessons/<id>/resources.ts`, which
is maintained *from* these dossiers. The dossier is the working notes; the
`resources.ts` is the published shelf.
