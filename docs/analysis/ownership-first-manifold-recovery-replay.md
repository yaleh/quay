# ownership-first manifold recovery replay

Offline, read-only replay testing whether a constrained discovery procedure (deterministic
feature extraction + LLM used only for contract synthesis, never for the trigger decision) can
recover the GOAL-030/031/032 recurring axis, and at which checkpoint. Implements
`tasks/gap-ownership-first-manifold-recovery-replay.md`. Regenerate with `node
docs/analysis/ownership-first-manifold-recovery-replay.mjs --extract --out
docs/analysis/ownership-first-manifold-recovery-replay.results.json`.

## A correction made before trusting any result

The first draft's `has_explicit_non_goals` regex matched only the literal heading `## 非目标`
and read **false** for all three goals — wrong: a known-true-sample check (`grep '^## .*非目标'`
against all three real files) shows all three actually use `## 范围与非目标` (scope+non-goals
combined). Fixed to match any line-start heading containing `非目标`. The feature's *definition*
did not change, only a heading-matching mechanics bug. By contrast, a second mismatch —
`human_activated` reading **false** for GOAL-031 because its origin text says `人...指令`
("instruction") rather than `人...裁定` ("ruling"), the only phrasing the pre-declared regex
recognized — was **deliberately left unfixed**, to avoid retroactively loosening a feature
definition just because it produced an inconvenient result. That asymmetry is itself a finding,
not a bug: one was a parsing defect (verified against ground truth), the other would have been
p-hacking the trigger (not).

## Result

**`first_threshold_checkpoint = 2`.** The fixed ≥6-of-9 pairwise-agreement trigger fires with
only `GOAL-030` and `GOAL-031` visible (7/9 features agree), *before `GOAL-032` existed*. At
checkpoint 3, `GOAL-030` and `GOAL-032` agree on **9/9** features (a perfect match), while
`GOAL-031` still disagrees with both on the same two features (`has_negative_control`,
`human_activated`).

| checkpoint | visible | pairwise agreement | trigger fired |
|---|---|---|---|
| 1 | GOAL-030 | — (no pair) | false (insufficient samples) |
| 2 | GOAL-030, GOAL-031 | 030\|031 = 7/9 | **true** |
| 3 | GOAL-030, GOAL-031, GOAL-032 | 030\|031=7, 030\|032=9, 031\|032=7 | true |

## The synthesized contracts

A structured (not prose-only) candidate contract was generated at checkpoint 2 and regenerated at
checkpoint 3 (see `results.json`'s `contracts.checkpoint_2`/`checkpoint_3`), constrained — per the
task's own discipline — to the extracted **boolean feature vectors only**, not a fresh read of
the goals' full prose. Both name the same underlying concern: a duplication/ownership-misplacement
signal sunk to a canonical layer, proven via before/after structural comparison plus a negative
control and a branch-self-host identity proof, merged as exactly one commit under human
activation. The checkpoint-3 version is materially unchanged from checkpoint 2 beyond an added
replay sample and a stronger confidence note (the 9/9 GOAL-030/032 match) — **a reportable limit
of this discovery design**: a feature-vector-only LLM step can confirm *that* a pattern recurs and
sketch its generic methodology shape, but cannot name the specific domain (task-transition vs.
task-status-vocabulary vs. verdict-parser dedup) or the destination layer (e.g. "kernel"), because
no extracted feature captures that level of content. A richer discovery step would need to relax
the prose-free constraint at the contract-synthesis stage (while keeping the TRIGGER decision
itself deterministic and feature-vector-only, which this replay preserved throughout).

## Honest answer to "when would this have been proposable"

**At checkpoint 2 — after seeing two real samples, not three.** This is not a retrofit: the
`--verify-trigger` check independently recomputes the same checkpoints from the stored feature
vectors and confirms they match exactly. The procedure did not need GOAL-032 to notice the
recurring axis; GOAL-032 mainly raised confidence (9/9 vs. 7/9) rather than being required for
initial detection.

## Explicit non-actions

No RoutineSpec was registered, no live proposer ran, no `label:driver-candidate` task or GOAL was
created, and no production driver file was touched by this experiment.
