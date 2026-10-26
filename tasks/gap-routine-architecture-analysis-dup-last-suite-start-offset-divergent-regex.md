---
id: gap-routine-architecture-analysis-dup-last-suite-start-offset-divergent-regex
title: "architecture-analysis: One marker-slicing rule is implemented 3x across
  2 carriers with 2 regex spellings (/^__FANIN_SUITE_START__[^\\n]*$/gm vs
  /^__FANIN_SUITE_START__\\s/gm); they "
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
One marker-slicing rule is implemented 3x across 2 carriers with 2 regex spellings (/^__FANIN_SUITE_START__[^\\n]*$/gm vs /^__FANIN_SUITE_START__\\s/gm); they agree today only because the emitter always appends ' iso=', and on a bare marker line at EOF they already diverge (node check: first returns 6, second -1), so a future emitter change silently mis-slices the suite log and fakes a checker misreport.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792940968187` · ts `2026-10-25T15:09:28.187Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`lastSuiteStartOffset`
- 涉及文件：
- `plugin/scripts/measure-trend-check.ts:151`
- `plugin/scripts/pre-verified-round-record.ts:255`
- `plugin/workflows/fan-in-execute.js:393`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Move the rule into one shared kernel helper imported by both checkers and the workflow, with a fixture test pinning equivalence on bare-marker/EOF input.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-25T15:09:28.187Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-last-suite-start-offset-divergent-regex`（routine `architecture-analysis`，runId `architecture-analysis-1792940968187`）所描述的问题被复核并处置 —— 已修：3 份实现 / 2 种拼写全部删除，规则上收 `plugin/scripts/source-text-lib.ts` 的 `lastSuiteStartOffset`；三个 carrier（measure-trend-check.ts / pre-verified-round-record.ts / fan-in-execute.js 的 FIX_SCOPE_GATE）改为 import
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 修掉；等价性 / 裸标记 EOF 分歧 fixture 在 `plugin/test/source-text-lib.test.mjs`（35 pass），三 carrier 相关测试 92 / 10 / 9 pass；续做轮补：`packages/quay/test/build-plugin-dist.test.mjs` 的 pre-fix anchor pin 按重测更新（25→26）后 45 pass

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Disposition
- 根因：同一条 `__FANIN_SUITE_START__` 行首切片规则被写了 3 次，且其中两份用了**语义不同**的正则
  （`[^\\n]*$` vs `\\s`）；两者只在 emitter 总带 ` iso=…` 时一致，裸标记行 + EOF 上分歧（0 vs -1）。
- 处置 = 修掉（不是「已有机制在管」）：提取到 `plugin/scripts/source-text-lib.ts` 的 `lastSuiteStartOffset`
  （leaf，不 import 任何模块），采用 `/^__FANIN_SUITE_START__(?:\\s|$)/gm` —— 保留 `\\s` 的 token 边界，
  同时承认 EOF 的裸标记；三处调用点改为 import（workflow 的 inline node 脚本经 `${PLUGIN_ROOT}` 导入）。
- 守卫：`plugin/test/source-text-lib.test.mjs` 构造两旧拼写做等价性对照（两者都接受的输入上三方同值），
  并 pin 裸标记 + EOF 的分歧（旧 `\\s` 拼写 = -1，共享 helper = offset）；另有位置族扫描
  「plugin/scripts 内无私有副本」+「两 checker 与 workflow 都 import」。
- 实跑：source-text-lib.test.mjs 35 pass；measure-trend-check + pre-verified-round-record 92 pass；
  fan-in-execute-paths-s08 10 pass；s09 9 pass。
- 续做轮（2026-10-27）：上一轮的 suite 红点 `packages/quay/test/build-plugin-dist.test.mjs`
  是**本任务引入的真实红**，不是环境/既有红 —— 该测试 pin 了 `fan-in-execute.js` 的 pre-fix
  anchor 数（25）；本任务给 workflow 增加一行 `"${PLUGIN_ROOT}/scripts/source-text-lib.ts"`
  import，实测变成 **26 occurrences / 25 lines**。已在同一测试内按既有体例重测并写清 +1 的来源
  （既有条目「25 / 24 lines」是同一类历史重测，先例在此），`node --test
  packages/quay/test/build-plugin-dist.test.mjs` 45 pass / 0 fail。
- 该轴仍暗,理由:本任务只提取一条切片规则（plugin/scripts 内部去重），未触及包级依赖结构 L_D 或上帝包 L_G，故未做该轴读数

## Touches
- `packages/quay/test/build-plugin-dist.test.mjs`
- `plugin/scripts/measure-trend-check.ts`
- `plugin/scripts/pre-verified-round-record.ts`
- `plugin/scripts/source-text-lib.ts`
- `plugin/test/source-text-lib.test.mjs`
- `plugin/workflows/fan-in-execute.js`
- `tasks/gap-routine-architecture-analysis-dup-last-suite-start-offset-divergent-regex.md`

## Blocker

**2026-10-25T17:41:37.980Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: fan-in-execute.js: pre-fix anchor count changed — the measurement drifted [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=packages/quay/test/build-plugin-dist.test.mjs changed=-]
- run_id：wk-prod-anchor
- ✅ 已解（2026-10-27 续做轮）：红点确认是本任务引入（workflow 多一行 `${PLUGIN_ROOT}` import ⇒ anchor 25→26），已在 `packages/quay/test/build-plugin-dist.test.mjs` 重测并写入 Touches；不是「既有红/死锁」。

## Needs-Human

**执行 2026-10-25T19:43:29.962Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：LOOP DEADLOCK: task gap-routine-architecture-analysis-dup-last-suite-start-offset-divergent-regex has been blocked by the SAME pre-existing red set for 4 consecutive fan-in rounds (signature unchanged across rounds). Blocked red points: packages/quay/test/build-plugin-dist.test.mjs. No other task in the carrier shares this signature yet — if more arrive, they are mutually landing gates. Suggested resolution: land ANY ONE of them first (each one's own fix is outside the blocked set, so the red set does not grow); the others' blocked sets then shrink by that red point and they land in turn. If a landing still makes it worse, a human must decide the order. ⛔ The gates were NOT relaxed: every new/changed red point still hard-fails this task (baseline-equivalence exemption never covers a red the task introduced). — 停止自动重派（电路断路器：同一既存红签名连续 4 轮未变）。⛔ 判据未放宽：本次新增 / 断言文本变化的红点仍然硬红（既存红等价豁免只覆盖「不变差」的方向）。
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: fan-in-execute.js: pre-fix anchor count changed — the measurement drifted [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=packages/quay/test/build-plugin-dist.test.mjs changed=-]
- run_id：wk-prod-anchor
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-routine-architecture-analysis-dup-last-suite-start-offset-divergent-regex~wk-prod-anchor~1792950098687-068b70.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-routine-architecture-analysis-dup-last-suite-start-offset-divergent-regex-wk-prod-anchor.log
- ✅ 死锁判词已失效（2026-10-27）：上面这条「同一既存红签名 4 轮不变」的归因是错的 —— 该红点由本任务自身引入（见 Blocker 已解），修好后不再存在；不需要人排序。
