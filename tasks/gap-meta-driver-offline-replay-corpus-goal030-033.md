---
id: gap-meta-driver-offline-replay-corpus-goal030-033
title: "meta-driver offline replay corpus v1: 4 historical GOAL-030..033
  decision-replay cases + harness + integrity tests"
status: todo
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

This task builds a **first-version (v1), 4-case gold/replay corpus** for GOAL-030/031/032/033 (the four real human-driven ownership-first goal branches, GOAL-033 newly added to the 3 the reference doc named), each case strictly separating what was knowable BEFORE the human's decision from the decision itself and its real downstream outcome — plus a minimal reproducible eval harness and dataset-integrity tests. **Explicit non-goals**: no change to `plugin/scripts/meta-driver.ts` or any driver file; no online/autonomous evaluation loop; this is a static fixture + offline harness only. Not over-claimed as a general-purpose benchmark (point 9 of the origin instruction) — the README states plainly this is 4 real samples, not a validated statistical corpus.

## Plan

1. **Fixture layout** (mirrors the existing `plugin/fixtures/workflow-replay/<scenario>/{events.jsonl,expectations.json,meta.json}` convention — one subdir per case, physically separate files, not separate keys in one file):
   ```
   plugin/fixtures/meta-driver-replay/
     GOAL-030/{input.json, reference.json, outcome.json}
     GOAL-031/{input.json, reference.json, outcome.json}
     GOAL-032/{input.json, reference.json, outcome.json}
     GOAL-033/{input.json, reference.json, outcome.json}
     README.md
   ```
2. **`input.json`** per case: `{case_id, cutoff (ISO, strictly pre-decision), context: {repo_state_summary, archguard_readings_before, related_landed_tasks, prior_goal_precedents, code_pointers (file:line of the signal, never the solution), human_trigger_quote}, decision_prompt_schema: {instructions, questions: [a..h per origin instruction], response_schema}}`. Content drawn from each GOAL's own `origin`/"调查结论" section, truncated to what was known before the decision — the chosen target files/kernel module names are deliberately NOT named in `context` (only the *signal*, e.g. "ArchGuard reports N duplicate/dispersed definitions of X" without naming where they'll be sunk).
3. **`reference.json`** per case: the 8 fields from the origin instruction (`selected_concern, selected_slice, why_now, why_not_others, risk, scope_discipline {non_goals, stop_signals}, acceptance_evidence, stop_abandon_condition`), plus a `leakage_markers: string[]` field — the exact identifying strings (new file/symbol names the human chose) that must NOT appear anywhere in that case's `input.json` (mechanically checked, not just visually separated).
4. **`outcome.json`** per case: real post-execution readings — merge commit sha (GOAL-030=`d71d2bde4`, GOAL-031=`117ee91b8`, GOAL-032=`0da918926`), AC final statuses, ArchGuard before/after numbers. **GOAL-033 is still `active` as of this task's filing** (AC-350 achieved, AC-351/352 not yet achieved, no merge commit) — `outcome.json` for GOAL-033 must say so honestly (`status:"in-progress"`, `as_of` timestamp), not fabricate a completed result. This asymmetry is itself valuable corpus diversity (point 9), not a defect to paper over.
5. **Harness** `plugin/test/helpers/meta-driver-replay-harness.mjs` (test-only helper, not a shipped `plugin/scripts/*.ts` capability — same scoping choice as the self-health backtest/liveness-check tasks, avoids the capability-catalog/outline/laydown registration machinery for what is dataset+test tooling, not a production driver surface): exports `listCaseIds()`, `loadCaseInput(id)` (reads ONLY `input.json`+`meta` fields, structurally cannot touch `reference.json`/`outcome.json`), `loadCaseReference(id)`/`loadCaseOutcome(id)` (separate, explicit opt-in functions — never called by the default prompt path), `buildDefaultPrompt(id)` (built from `loadCaseInput` only), `scoreResponse(id, candidateResponseObj)` (rule-assisted, returns the 8 metrics from the origin instruction: concern recall/precision, chosen-slice agreement/near-match, investigation-vs-goal agreement, scope-expansion-violation, expected-delta quality, falsifiability/negative-control presence, hindsight-leakage-guard result, abstention/uncertainty reasonableness). CLI `main()`: `--case <id> --print-prompt` or `--case <id> --response <path> --score` for a human-filled-in candidate response; an optional `--auto <claude|none>` mode MAY shell out to a configured LLM CLI if present, but the test suite and default path never require it (point 7 of origin instruction — no external-model hard dependency).
6. **Integrity tests** `plugin/test/meta-driver-replay-corpus.test.mjs` (`node:test`, run via `scripts/test.sh`): (a) each case's `meta.case_id` matches its directory name, all 4 ids unique; (b) `input.json`/`reference.json`/`outcome.json` each have all required schema keys; (c) **behavioral leakage guard**: copy a case dir to a tmp dir with `reference.json`/`outcome.json` REMOVED, call `buildDefaultPrompt` against the tmp copy, assert it still succeeds identically (proves the default path never needs those files, not just that it's not currently reading them); (d) none of `reference.json`'s `leakage_markers` strings appear anywhere in that case's `input.json` (`JSON.stringify` substring scan); (e) `cutoff` is strictly before the case's recorded decision-activation timestamp (cross-checked against the real `goals/GOAL-0{30,31,32,33}-*.md` `activatedAt` field).
7. `plugin/fixtures/meta-driver-replay/README.md`: states plainly this is a first-version, 4-sample gold/replay corpus — not a validated statistical benchmark, not to be over-fit as universal truth; names non-architectural human-decision corpora and negative examples as future extensions (point 9).

## Touches

- plugin/fixtures/meta-driver-replay/GOAL-030/input.json (new)
- plugin/fixtures/meta-driver-replay/GOAL-030/reference.json (new)
- plugin/fixtures/meta-driver-replay/GOAL-030/outcome.json (new)
- plugin/fixtures/meta-driver-replay/GOAL-031/input.json (new)
- plugin/fixtures/meta-driver-replay/GOAL-031/reference.json (new)
- plugin/fixtures/meta-driver-replay/GOAL-031/outcome.json (new)
- plugin/fixtures/meta-driver-replay/GOAL-032/input.json (new)
- plugin/fixtures/meta-driver-replay/GOAL-032/reference.json (new)
- plugin/fixtures/meta-driver-replay/GOAL-032/outcome.json (new)
- plugin/fixtures/meta-driver-replay/GOAL-033/input.json (new)
- plugin/fixtures/meta-driver-replay/GOAL-033/reference.json (new)
- plugin/fixtures/meta-driver-replay/GOAL-033/outcome.json (new)
- plugin/fixtures/meta-driver-replay/README.md (new)
- plugin/test/helpers/meta-driver-replay-harness.mjs (new)
- plugin/test/meta-driver-replay-corpus.test.mjs (new)
- tasks/gap-meta-driver-offline-replay-corpus-goal030-033.md

## AC

- [ ] All 4 case directories exist with `input.json`/`reference.json`/`outcome.json`: `node -e 'const fs=require("fs");for(const g of ["GOAL-030","GOAL-031","GOAL-032","GOAL-033"])for(const f of ["input.json","reference.json","outcome.json"])if(!fs.existsSync("plugin/fixtures/meta-driver-replay/"+g+"/"+f)){console.error("missing "+g+"/"+f);process.exit(1)}' ` exits 0.
- [ ] Integrity test suite passes: `node --experimental-strip-types --test plugin/test/meta-driver-replay-corpus.test.mjs` exits 0.
- [ ] Case id uniqueness + directory-name match, verified by the same test run (test (a) above).
- [ ] Leakage guard passes for all 4 cases (test (d)) AND the behavioral guard (test (c)) — both are real test cases in the suite, not just prose claims.
- [ ] `cutoff` precedes real `activatedAt` for all 4 cases (test (e)).
- [ ] Harness CLI works end-to-end for at least one case: `node plugin/test/helpers/meta-driver-replay-harness.mjs --case GOAL-030 --print-prompt` exits 0 and prints non-empty output not containing any GOAL-030 `leakage_markers` string.
- [ ] No production driver file touched: `git status --porcelain plugin/scripts/meta-driver.ts packages/quay/src/cli/driver.ts plugin/scripts/driver-runtime.ts` prints nothing.
- [ ] `scripts/test.sh` run scoped to the new test file shows it registered and passing (not silently skipped).

## DoD

真实落地 = 上述全部文件随本任务提交进 develop；`outcome.json` 的数字是对真实 git 历史（合并提交 sha）与真实 goal/AC 文件状态的直接读数，不是虚构；GOAL-033 的 outcome 诚实标注 `in-progress`（不编造一个尚未发生的落地结果）。本任务不创建任何自治评测循环、不改写 meta-driver 行为——产出仅为可复用的离线语料 + harness + 完整性测试。