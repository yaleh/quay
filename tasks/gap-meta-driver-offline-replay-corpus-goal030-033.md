---
id: gap-meta-driver-offline-replay-corpus-goal030-033
title: "meta-driver offline replay corpus v1: 4 historical GOAL-030..033
  decision-replay cases + harness + integrity tests"
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

该轴仍暗，理由：本任务新增的是只读 fixture 数据与测试 harness，不 import/不改变任何生产包间依赖边，不碰任何既有 god-package 候选，故 L_D 与 L_G 两轴对本任务结构性不适用。

## Proposal

`docs/references/harness-semantic-compression-and-meta-driver-builder.md` §10 already names the exact evaluation this task builds: "能否重现近期人工推动 GOAL-030/031/032 的决策链...这是目前唯一有真实历史数据可供对照的候选评价方式." That doc's own §6 confirms (two independent searches) **zero existing implementation** of a replay dataset/harness for meta-driver decisions — this is a real gap, not a duplicate of `experiments/offline-replay/` (that corpus replays exp5's BAIME *termination rules*, a different decision class entirely, though this task reuses its proven schema vocabulary: `features_available_then` / hindsight-vs-on-the-spot / `divergence` / `label_source`).

This task builds a **first-version (v1), 4-case gold/replay corpus** for GOAL-030/031/032/033 (the four real human-driven ownership-first goal branches, GOAL-033 newly added to the 3 the reference doc named), each case strictly separating what was knowable BEFORE the human's decision from the decision itself and its real downstream outcome — plus a minimal reproducible eval harness and dataset-integrity tests. **Explicit non-goals**: no change to `plugin/scripts/meta-driver.ts` or any driver file; no online/autonomous evaluation loop; this is a static fixture + offline harness only.

## Plan (as executed)

1. Fixture layout mirroring `plugin/fixtures/workflow-replay/<scenario>/{events.jsonl,expectations.json,meta.json}`: `plugin/fixtures/meta-driver-replay/{GOAL-030,GOAL-031,GOAL-032,GOAL-033}/{input.json,reference.json,outcome.json}` + `README.md`.
2. `input.json` per case: pre-decision-only context (ArchGuard raw readings, prior landed-goal precedents, code pointers to the SIGNAL not the solution, the real human trigger quote with the final conclusion stripped where it would leak) + the 8-question `decision_prompt_schema` shared verbatim across all 4 cases for comparability.
3. `reference.json` per case: the 8 structured fields (`selected_concern, selected_slice, why_now, why_not_others, risk, scope_discipline, acceptance_evidence, stop_abandon_condition`) + `leakage_markers` (exact new-identifier strings) + `investigation_or_goal_reference`.
4. `outcome.json` per case: real merge commit shas (GOAL-030=`d71d2bde4`, GOAL-031=`117ee91b8`, GOAL-032=`0da918926`, cross-checked via `git log --grep --merges`), real AC statuses. **GOAL-033 honestly marked `"status":"in-progress"`** (AC-350 achieved, AC-351/352 not yet achieved, no merge commit exists) — not fabricated.
5. Harness `plugin/test/helpers/meta-driver-replay-harness.mjs` (test-only helper, not a registered `plugin/scripts/*.ts` capability — same scoping as the self-health backtest/liveness-check tasks): `listCaseIds`, `loadCaseInput` (input-only), `loadCaseReference`/`loadCaseOutcome` (separate opt-in), `buildDefaultPrompt` (input-only, proven below), `scoreResponse` (8 rule-assisted metrics, no pretend aggregate score). CLI: `--list`, `--case <id> --print-prompt`, `--case <id> --response <path> --score`. No external-model dependency anywhere in the default path.
6. Integrity tests `plugin/test/meta-driver-replay-corpus.test.mjs` (`@test-group engine`, 26 tests): case-id uniqueness/match, schema completeness for all 3 files per case, leakage-marker absence from `input.json`, a **behavioral** leakage guard (copies a case with `reference.json`/`outcome.json` physically removed and proves `buildDefaultPrompt` output is byte-identical), and `cutoff` strictly preceding the real `goals/GOAL-0{30,31,32,33}-*.md` `activatedAt`.
7. `README.md`: states plainly this is a 4-sample v1 corpus, not a validated benchmark, names future extensions (non-architectural decisions, negative examples).

**Execution note**: manually verified all 4 cases' `leakage_markers` are genuinely absent from their `input.json` via an independent script pass (not just trusting the test suite) before committing; one case (GOAL-032) required editing the human-trigger quote to remove a leaking conclusion ("结论 equivalent") and moving that fact into a separately-labeled, honestly-dated context field instead.

## Touches

- plugin/fixtures/meta-driver-replay/GOAL-030/input.json
- plugin/fixtures/meta-driver-replay/GOAL-030/reference.json
- plugin/fixtures/meta-driver-replay/GOAL-030/outcome.json
- plugin/fixtures/meta-driver-replay/GOAL-031/input.json
- plugin/fixtures/meta-driver-replay/GOAL-031/reference.json
- plugin/fixtures/meta-driver-replay/GOAL-031/outcome.json
- plugin/fixtures/meta-driver-replay/GOAL-032/input.json
- plugin/fixtures/meta-driver-replay/GOAL-032/reference.json
- plugin/fixtures/meta-driver-replay/GOAL-032/outcome.json
- plugin/fixtures/meta-driver-replay/GOAL-033/input.json
- plugin/fixtures/meta-driver-replay/GOAL-033/reference.json
- plugin/fixtures/meta-driver-replay/GOAL-033/outcome.json
- plugin/fixtures/meta-driver-replay/README.md
- plugin/test/helpers/meta-driver-replay-harness.mjs
- plugin/test/meta-driver-replay-corpus.test.mjs
- tasks/gap-meta-driver-offline-replay-corpus-goal030-033.md

## AC

- [x] All 4 case directories exist with `input.json`/`reference.json`/`outcome.json`. **Verified**: exit 0.
- [x] Integrity test suite passes. **Verified**: `node --experimental-strip-types --test plugin/test/meta-driver-replay-corpus.test.mjs` — 26/26 pass, 0 fail.
- [x] Case id uniqueness + directory-name match. **Verified**: covered by the first test, pass.
- [x] Leakage guard (both static marker-absence and the behavioral guard) passes for all 4 cases. **Verified**: 8 of the 26 tests, all pass.
- [x] `cutoff` precedes real `activatedAt` for all 4 cases. **Verified**: 4 tests, all pass.
- [x] Harness CLI works end-to-end for at least one case. **Verified**: `--case GOAL-030 --print-prompt` exits 0, output contains no GOAL-030 leakage marker (independently re-checked).
- [x] No production driver file touched. **Verified**: `git status --porcelain plugin/scripts/meta-driver.ts packages/quay/src/cli/driver.ts plugin/scripts/driver-runtime.ts` empty.
- [x] `scripts/test.sh` run scoped to the new test file shows it registered and passing. **Verified**: initial run caught a real policy gate (`test-framework-policy-check`: missing `// @test-group` declaration), fixed (`@test-group engine`), re-run shows 26/26 pass through the official entry point, not silently skipped.

## DoD

真实落地 = 上述全部文件随本任务提交进 develop（已提交 `dbdf58e96`）；`outcome.json` 的数字是对真实 git 历史（合并提交 sha，`git log --grep --merges` 核验）与真实 goal/AC 文件状态的直接读数，不是虚构；GOAL-033 的 outcome 诚实标注 `in-progress`（未编造尚未发生的落地结果）。本任务未创建任何自治评测循环、未改写 meta-driver 行为——产出仅为可复用的离线语料 + harness + 完整性测试。