---
id: gap-ownership-first-manifold-recovery-replay
title: "ownership-first manifold recovery replay: can a constrained discovery
  procedure recover the GOAL-030/031/032 recurring axis, and at which
  checkpoint"
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

该轴仍暗，理由：本任务新增一个独立、零依赖的检查脚本，不 import/不改变任何生产包间依赖边，也不碰任何既有 god-package 候选，故 L_D 与 L_G 两轴对本任务结构性不适用。

## Proposal

GOAL-030, GOAL-031, and GOAL-032 are three real, human-driven goal branches that each (self-declared in GOAL-031/032's own text as "同构"/isomorphic to the prior one) follow the same recurring pattern: notice an ArchGuard duplicate/dispersion-shaped signal, sink it to the correct ownership layer in a minimally-scoped slice with explicit non-goals, prove it with ArchGuard before/after evidence plus a deliberately-constructed negative control, human-activate, and merge with a clean single-commit shape. This task tests, offline and read-only, whether a **constrained discovery procedure** (deterministic feature extraction + LLM used only for semantic contract generation, never for the trigger decision) can recover this axis as a structured meta-driver candidate contract — and, critically, reports **honestly** at which checkpoint (seeing only GOAL-030; seeing GOAL-030+031; seeing GOAL-030+031+032) a FIXED, pre-declared threshold rule first fires, rather than retrofitting a "could have seen it earlier" narrative after the fact.

**Explicit non-goals**: no RoutineSpec is registered, no live proposer runs, no `label:driver-candidate` task or GOAL is created from the discovered contract, and this task does not touch `plugin/scripts/meta-driver.ts` or any production mechanism. The output is an inert evaluation artifact only.

## Plan

1. Write `docs/analysis/ownership-first-manifold-recovery-replay.mjs` — a deterministic extractor (zero LLM) that parses a goal markdown body against a FIXED, declared-before-running set of 9 boolean/categorical features. **Execution note**: a known-true-sample check caught a heading-matching bug in `has_explicit_non_goals` (fixed; see `.md` writeup) before trusting any result. A second mismatch (`human_activated` false for GOAL-031 due to `人...指令` vs the regex's `人...裁定`) was deliberately left unfixed to avoid retroactively loosening the feature definition.
2. Run the extractor on `goals/GOAL-030-*.md`, `goals/GOAL-031-*.md`, `goals/GOAL-032-*.md` individually → one 9-feature boolean vector per goal.
3. Define three replay checkpoints by progressive visibility: ① `{GOAL-030}` only, ② `{GOAL-030, GOAL-031}`, ③ `{GOAL-030, GOAL-031, GOAL-032}`.
4. Apply a FIXED, pre-declared deterministic trigger: "a recurring-axis candidate is proposable at a checkpoint iff the visible goals' feature vectors pairwise agree on ≥6 of the 9 features."
5. At the FIRST checkpoint where the trigger fires, synthesize one structured candidate contract (JSON, 7 required fields) constrained to ONLY the extracted feature vectors of currently-visible goals.
6. Honest reporting: record `first_threshold_checkpoint` in the results JSON — **result: checkpoint 2** (GOAL-030+031 agree 7/9, before GOAL-032 existed), independently confirmed via `--verify-trigger` recomputation from stored feature vectors.
7. Write `docs/analysis/ownership-first-manifold-recovery-replay.results.json` and `.md` per the declared schema.
8. **Explicit non-actions**: no RoutineSpec registered, no live proposer, no `label:driver-candidate` task filed, no GOAL created, no change to any production driver file.

## Touches

- docs/analysis/ownership-first-manifold-recovery-replay.mjs
- docs/analysis/ownership-first-manifold-recovery-replay.results.json
- docs/analysis/ownership-first-manifold-recovery-replay.md
- tasks/gap-ownership-first-manifold-recovery-replay.md

## AC

- [x] Extractor runs against all three real goal files and produces three feature vectors. **Verified**: exit 0, 3 keys present.
- [x] `checkpoints` array has exactly 3 entries, each carrying a boolean `trigger_fired` and a numeric agreement score. **Verified**: exit 0.
- [x] `first_threshold_checkpoint` is present and, when independently recomputed via `--verify-trigger`, matches the stored `checkpoints[].trigger_fired` values exactly. **Verified**: "recomputed checkpoints match stored checkpoints exactly", exit 0. **Value: 2.**
- [x] At least one `contracts.checkpoint_N` object exists with all 7 required fields present and non-empty. **Verified**: 2 contracts (checkpoint_2, checkpoint_3), all fields present, exit 0.
- [x] `.md` writeup states `first_threshold_checkpoint`'s value in prose. **Verified**: `grep -q` exit 0.
- [x] No live system was touched by running this experiment. **Verified**: `git status --porcelain goals/ plugin/scripts/meta-driver.ts` empty.

## DoD

真实落地 = 三个产物文件随本任务提交进 develop（已提交 `b96576f3f`）；`results.json` 的 `feature_vectors` 是对 `goals/GOAL-030-*.md`/`GOAL-031-*.md`/`GOAL-032-*.md` 三个真实文件内容的直接正则提取（`source_files` 字段记录了具体文件路径，可核对）；`first_threshold_checkpoint=2` 诚实反映固定规则的实际触发点——在只看到 030+031 时就已触发，并非看到 032 后回填。本任务未创建任何 goal/task/driver 注册，只产出评估用的只读 artifact。