# Experiment 1 (quay-native bootstrap) — closing report

- **Date halted:** 2026-07-16
- **Halted by:** explicit human decision (Yale Huang), per
  `docs/proposals/quay-core-bootstrap-experiment-v2.md` §2.3 ("What
  'stop' means for experiment 1").
- **Final iteration:** 88 (`iterations/iteration-88.md`).
- **Status: HALTED, NOT CONVERGED.** This experiment did not reach
  convergence under `docs/proposals/quay-bootstrap-experiment.md` §7 at
  any point before being stopped, and was not required to (per the v2
  proposal's own explicit precondition framing).

## Final snapshot (iteration 88)

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
           = 0.85 × 0.97 × 0.76 × 0.96 = 0.6016

V_meta     = completeness × effectiveness × reusability × validation
           = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973
             (unchanged since iteration 66 — 22+ consecutive iterations
              of exact zero movement)

σ_strict   = 62 / 73 = 0.8493
```

None of protocol §7's 5 convergence criteria were met at halt time (see
`EXTRACTION-SUMMARY.md` for the full per-criterion breakdown).

## Extraction

`baime:knowledge-extractor` was run against this experiment's state
before the stop took effect, per the v2 proposal's §2.1 deliberate
deviation (extracting a non-converged experiment to produce an honest,
as-of-iteration-88 artifact rather than a polished retrospective). See
`EXTRACTION-SUMMARY.md` and `/home/yale/work/quay/.claude/skills/quay-native-methodology/`
for the extracted Skills, gate mechanics, directive lifecycle, G3 audit
discipline, and the four-stalled-V_meta-factor analysis.

## Pending directives at stop time

`directives/pending/` contained exactly two files at stop time:

- `DIR-021-iterations-must-themselves-run-a-fresh-manda-nested-subagent-trial.md`
  — a standing SOP (not a one-time task). Triaged: left `pending`
  (deferred is not applicable — this is a standing discipline, not a
  closable action), with a 2026-07-16 progress note recording that its
  trigger condition is unlikely to arise in quay-core-bootstrap while
  DIR-025 (below) is deferred there, without retracting its own
  discipline or historical evidence.
- `DIR-025-actively-explore-and-adopt-manda-nested-subagent-for-concurrent-work.md`
  — triaged: **deferred for quay-core-bootstrap**, by explicit human
  decision (2026-07-16), resolving
  `quay-core-bootstrap-experiment-v2.md` §7 precondition 5. Not
  retracted as history; action 3c/3d remain open, unattempted questions,
  simply not pursued for now. See that file's own progress note.

Neither directive was silently abandoned; both carry a dated disposition
in their own file, per `directives/README.md`'s lifecycle rules (deferred
directives stay in `pending/`, not `archive/`).

## Directory migration

This directory (`experiments/quay-native-bootstrap/`) is being renamed and moved to
`experiments/quay-native-bootstrap/` as part of the same transition, per
`quay-core-bootstrap-experiment-v2.md` §7 precondition 4. A new sibling
directory, `experiments/quay-core-bootstrap/`, is being created for the
follow-on experiment. See that proposal document for the full layout
decision and rationale.

## What is not part of this closing report

This report does not authorize or start the follow-on experiment
(quay-core-bootstrap) — that remains gated on all five of
`quay-core-bootstrap-experiment-v2.md` §7's preconditions being
satisfied, tracked in that document directly.
