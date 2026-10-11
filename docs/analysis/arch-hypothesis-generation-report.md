# Architecture hypothesis generation — blind shadow stage, round-1 readings

Regenerated 2026-10-11T15:17:09.799Z from recorded artifacts by `docs/analysis/arch-hypothesis-generation.mjs report`.
No model call is made here; the model outputs below are the recorded round-1 artifacts.

## Inventory reproduction (pin `e3163e519`)

| arm | settings | components | sha256 |
|---|---|---|---|
| A | `--max-exports 15 --max-carriers 6 --carrier-forms literal` | 283 | `fe87bd79420ba4f4f107fab17d1cfb62df47deb5a6776f93e19cd67a6057838c` |
| B | `--max-exports 1000 --max-carriers 12 --carrier-forms literal+join` | 283 | `186a7355d35a642ac82dd9a4d07880eabc78a4aae33e8e6372764fcb1f83ac9f` |

## Design (pre-registered before the first model call)

- **Investigator input**: a neutral inventory with the SAME fields for every `plugin/scripts/*.ts`
  component (catalog question, exported names, carrier literals). The prompt is fixed and names no
  component and no target pair.
- **Investigator isolation**: `--tools ""` and a cwd that is an EMPTY directory, so no CLAUDE.md or
  project memory reaches the model.
- **Scoring**: mechanical match against sealed labels (1 holdout, 2 positives, 2 negatives), an
  independent reviewer per match, and a bounded verifier (Read/Grep only, ≤8 turns, 300 s) run on a
  pinned tree with `tasks/`, `goals/`, `docs/`, `orchestration/` removed.
- **Novelty**: a Touches-overlap proxy over the task board (see the round-1 summary below).

## Round-1 headline readings (recorded in `E-HYPGEN-1`; not recomputed here)

- model `v4.1flash-anthropic`; prompt+inventory sha256 `08a11f52…`.
- **Arm A**: 3/3 runs parsed, 36 hypotheses, 28 clusters; the verifier ran on 15. Of the 5 supported
  clusters, 4 had the difference documented as INTENTIONAL. Recall 0/2 on the positives; the holdout
  was hit in 0 of 3 runs; no negative was falsely hit. Stable across all 3 runs: `Touches` parsing,
  task-status vocabulary, full-suite-state writers, concurrency-cap policies. **Novelty (proxy): 1 of
  the 5 supported clusters is novel** (checker exit-code vocabulary).
- **Arm B (declared post-hoc ablation)**: only the inventory extraction changed (all exports instead
  of 15, plus `path.join(".quay", …)` carriers); the prompt is unchanged. 2 of 3 runs parsed, 1 run's
  JSON was malformed. The holdout was partially hit in 1 of the 2 parsed runs; the reviewer judged it
  `partial=true, same_concept=false` — it found only the recurrence sub-part. This weakly supports the
  explanation that the inventory format (export truncation, missed carrier forms) limited arm-A recall.
- **Cost**: about 60–73 s per investigator run; verifier calls took 17–133 s.

## Arm A (pre-registered)

- investigator runs: 3 declared, 3 parsed, 36 hypotheses
- wall time per run: 60s, 73s, 73s
- clusters: 28, verified: 15
- verdicts (normalised to the landed vocabulary): {"supported":5,"refuted":4,"undetermined(TURN_LIMIT)":5,"undetermined(UNPARSEABLE)":1}
- recorded raw verdicts: {"supported":5,"refuted":4,"not-evaluated(unparseable)":6} — the scratch tool spelled budget exhaustion as `not-evaluated(unparseable)`; both causes are `undetermined`, never `refuted`
- precision: 5/9 = 0.56
- verifier found a documented INTENTIONAL difference in 4/5 supported clusters
- verifier wall time: 57s, 86s, 24s, 30s, 69s, 37s, 52s, 48s, 60s, 56s, 82s, 17s, 133s, 88s, 77s
- mechanical matches: 0
- recall (positives): 0/2
- holdout: HOLDOUT-PM 0
- negative false positives: 0/2
- reviews: 1 — HOLDOUT-PM: same_concept=false partial=true

## Arm B (declared post-hoc ablation: inventory extraction only)

- investigator runs: 3 declared, 2 parsed, 24 hypotheses
- wall time per run: 57s, 79s, 56s
- mechanical matches: 1
- recall (positives): 0/2
- holdout: HOLDOUT-PM 1
- negative false positives: 0/2

## Pre-registration

Scoring refuses unless the pre-registration file's hashes match the prompt / inventory / labels
bytes AND its mtime precedes every run file (`preregRefusal`). The recorded round-1 hashes:

```
19be897494996db41e05cc3862cfbb53361d0e5f10a82e41f91e99a2e0ad16ea  prompt-investigator.txt
9aada4d3ffbd6b41c1444eddb809fe20a1f355059b6069588c14b8c27111c878  labels-sealed.json
c7908af0824b54a18c9773618a71a2ff69c5b8a6945e626274219eb9d89a70d6  PREREG.md
fe87bd79420ba4f4f107fab17d1cfb62df47deb5a6776f93e19cd67a6057838c  out/inventory.txt
2026-10-11T14:51:40Z
dba2e67157aac12ccb769fe10bfa75fb91cfe8955cf9eca66b71301f01981f2d  prompt-verifier.txt
B arm: inventory-B sha 186a7355d35a642ac82dd9a4d07880eabc78a4aae33e8e6372764fcb1f83ac9f, prompt unchanged, declared post-hoc 2026-10-11T15:02:43Z
ebfa9b5587c9ab86a616e0a2fb2daba797ea7465d7b38aef9e414f7086e01621  prompt-reviewer.txt
```
