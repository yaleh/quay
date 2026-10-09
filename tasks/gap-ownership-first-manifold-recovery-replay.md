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

## Proposal

GOAL-030, GOAL-031, and GOAL-032 are three real, human-driven goal branches that each (self-declared in GOAL-031/032's own text as "同构"/isomorphic to the prior one) follow the same recurring pattern: notice an ArchGuard duplicate/dispersion-shaped signal, sink it to the correct ownership layer in a minimally-scoped slice with explicit non-goals, prove it with ArchGuard before/after evidence plus a deliberately-constructed negative control, human-activate, and merge with a clean single-commit shape. This task tests, offline and read-only, whether a **constrained discovery procedure** (deterministic feature extraction + LLM used only for semantic contract generation, never for the trigger decision) can recover this axis as a structured meta-driver candidate contract — and, critically, reports **honestly** at which checkpoint (seeing only GOAL-030; seeing GOAL-030+031; seeing GOAL-030+031+032) a FIXED, pre-declared threshold rule first fires, rather than retrofitting a "could have seen it earlier" narrative after the fact.

**Explicit non-goals**: no RoutineSpec is registered, no live proposer runs, no `label:driver-candidate` task or GOAL is created from the discovered contract, and this task does not touch `plugin/scripts/meta-driver.ts` or any production mechanism. The output is an inert evaluation artifact only.

## Plan

1. Write `docs/analysis/ownership-first-manifold-recovery-replay.mjs` — a deterministic extractor (zero LLM) that parses a goal markdown body against a FIXED, declared-before-running set of 9 boolean/categorical features: `has_archguard_before_after`, `has_negative_control` (regex `负对照`), `has_branch_selfhost_probe` (regex `自举`/`selfhost`), `has_explicit_non_goals` (a `非目标` heading with ≥1 `⛔` bullet), `has_stop_signal_list` (a `停止扩大范围的信号`-shaped heading), `has_three_state_exit_code` (`0 达成.*1 未达成.*3 未评估`-shaped text), `sink_target_is_kernel` (mentions `kernel` as the destination layer), `human_activated` (frontmatter `origin`/`statusLog` names a human ruling, e.g. `人.*裁定`), `merge_shape_single_commit` (`恰好一个合并提交`). These 9 features must be fixed in the script BEFORE it is run against GOAL-031/032's content — no post-hoc tuning after seeing their results, to keep this a real test rather than a retrofit.
2. Run the extractor on `goals/GOAL-030-*.md`, `goals/GOAL-031-*.md`, `goals/GOAL-032-*.md` individually → one 9-feature boolean vector per goal.
3. Define three replay checkpoints by progressive visibility: ① `{GOAL-030}` only, ② `{GOAL-030, GOAL-031}`, ③ `{GOAL-030, GOAL-031, GOAL-032}`.
4. Apply a FIXED, pre-declared deterministic trigger (pure JS arithmetic, no LLM): "a recurring-axis candidate is proposable at a checkpoint iff the visible goals' feature vectors pairwise agree on ≥6 of the 9 features" — declared before inspecting extraction results. At checkpoint ① (one goal, no pair to compare) the trigger is structurally `false` (insufficient samples — must be reported as such, not as "not yet tested").
5. At the FIRST checkpoint where the trigger fires (and only then), use an LLM (this session) constrained to ONLY the extracted feature vectors of the currently-visible goals (not a fresh re-read of the full prose) to synthesize one structured candidate contract per the schema below. If the trigger already held at an earlier checkpoint, regenerate the contract again at checkpoint ③ for comparison (does more evidence change scope/confidence, or just reconfirm it).
6. Contract schema (all 7 fields required, JSON not prose): `owner_concern`, `scope: {owned_reading_classes, owned_mechanisms_or_paths}`, `inputs`, `forbidden_actions`, `success_metrics`, `replay_dataset`, `stop_retire_criteria`.
7. Write `docs/analysis/ownership-first-manifold-recovery-replay.results.json`: `{feature_vectors: {GOAL-030, GOAL-031, GOAL-032}, checkpoints: [{checkpoint, visible_goals, pairwise_agreement_scores, trigger_fired}, ...], first_threshold_checkpoint: 2|3|null, contracts: {checkpoint_N: {...}}}`.
8. Write `docs/analysis/ownership-first-manifold-recovery-replay.md`: plain-language summary stating `first_threshold_checkpoint` honestly (if it only fires at ③, say so plainly — do not claim ② would have sufficed) and whether the synthesized contract names the same axis a human reader recognizes (dedup/canonicalization sunk to kernel, ArchGuard before/after, negative control, branch self-host, human activation, single-commit merge shape).
9. **Explicit non-actions** (repeated for landing-time clarity): no RoutineSpec registered, no live proposer, no `label:driver-candidate` task filed, no GOAL created, no change to any production driver file.

## Touches

- docs/analysis/ownership-first-manifold-recovery-replay.mjs (new)
- docs/analysis/ownership-first-manifold-recovery-replay.results.json (new)
- docs/analysis/ownership-first-manifold-recovery-replay.md (new)
- tasks/gap-ownership-first-manifold-recovery-replay.md

## AC

- [ ] Extractor runs against all three real goal files and produces three feature vectors: `node docs/analysis/ownership-first-manifold-recovery-replay.mjs --extract --out docs/analysis/ownership-first-manifold-recovery-replay.results.json` exits 0, and `node -e 'const r=JSON.parse(require("fs").readFileSync("docs/analysis/ownership-first-manifold-recovery-replay.results.json","utf8")); process.exit(Object.keys(r.feature_vectors).length===3 ? 0 : 1)'`.
- [ ] `checkpoints` array has exactly 3 entries, each carrying a boolean `trigger_fired` and a numeric agreement score: `node -e 'const r=JSON.parse(require("fs").readFileSync("docs/analysis/ownership-first-manifold-recovery-replay.results.json","utf8")); process.exit(r.checkpoints.length===3 && r.checkpoints.every(c=>typeof c.trigger_fired==="boolean") ? 0 : 1)'`.
- [ ] `first_threshold_checkpoint` is present and, when independently recomputed from the stored `feature_vectors` using the fixed ≥6-of-9 pairwise-agreement rule, matches the stored `checkpoints[].trigger_fired` values exactly (no retrofit): `node docs/analysis/ownership-first-manifold-recovery-replay.mjs --verify-trigger --in docs/analysis/ownership-first-manifold-recovery-replay.results.json` exits 0.
- [ ] At least one `contracts.checkpoint_N` object exists with all 7 required fields present and non-empty: `node -e 'const r=JSON.parse(require("fs").readFileSync("docs/analysis/ownership-first-manifold-recovery-replay.results.json","utf8")); const req=["owner_concern","scope","inputs","forbidden_actions","success_metrics","replay_dataset","stop_retire_criteria"]; const cs=Object.values(r.contracts||{}); process.exit(cs.length>0 && cs.every(c=>req.every(k=>c[k])) ? 0 : 1)'`.
- [ ] `.md` writeup states `first_threshold_checkpoint`'s value in prose: `grep -q "first_threshold_checkpoint" docs/analysis/ownership-first-manifold-recovery-replay.md`.
- [ ] No live system was touched by running this experiment: `git status --porcelain goals/ plugin/scripts/meta-driver.ts` shows no new/modified files other than this task's own self-touch.

## DoD

真实落地 = 三个产物文件随本任务提交进 develop；`results.json` 的 `feature_vectors` 必须是对 `goals/GOAL-030-*.md`/`GOAL-031-*.md`/`GOAL-032-*.md` 三个真实文件内容的直接正则提取（审阅者可用 `grep` 核对任一布尔特征对应的原文片段确实存在于对应 goal 文件），不是构造样本；`first_threshold_checkpoint` 必须诚实反映固定规则的实际触发点——若只在看到 032 后才触发，正文必须直说，不得回填成"②本该就够了"。本任务不创建任何 goal/task/driver 注册，只产出评估用的只读 artifact；是否进入 shadow mode 或任何生产化，是本任务范围之外、且明确不自动触发的后续决定。