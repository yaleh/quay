---
id: gap-routine-semantic-dedup-scan-statecolortoken-pair
title: "semantic-dedup-scan: Identical 3-way token mapping over the identical
  domain; serve-tests.ts:288-291 documents re-copying it because
  serve-dashboard's version is module-private and"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Identical 3-way token mapping over the identical domain; serve-tests.ts:288-291 documents re-copying it because serve-dashboard's version is module-private and an AC forbids a same-named function, so drift exposure is confined to three token literals.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790306065833` · ts `2026-09-25T03:14:25.833Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`stateColorToken`、`timelineColorToken`
- 涉及文件：
- `packages/quay/src/serve-dashboard.ts:162`
- `packages/quay/src/serve-tests.ts:292`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## Disposition
**修掉了**（按 finding 的 `extract`，⛔ 不是 `merge`、更不是「已注意到」）：副本消失，该映射在全仓只剩**一处**定义；行为不变。

### 复核（先取读数，⛔ 不靠「我认为是因为」）
1. **两处 body 确实逐字相同**：从 `HEAD~1` 的两个 blob 各抽出那条 `return state === …`，sha256 **两侧同为 `ddfa66cfc81b4d52de79ded8e7533fa178afb407b1dd1f7b7062031fc74a90b1`** ⇒ 字节相同的副本，不是同形巧合（正是 finding 的 `byte-identical-body` 判据）。
2. **副本存在的理由逐字成立，只是注释把 AC 的禁止范围读宽了**：`serve-tests.ts` 原注释自述「serve-dashboard.ts 的 stateColorToken 是模块私有（非 export）」。而文件自己的 AC2（`packages/quay/test/gap-webui-tests-page-missing-rounds-timeline-bar.test.mjs:133`）断言的是 `function renderTimelineBarSvg` 在 serve-tests.ts 里 **0 个** —— 禁的是复制**渲染**函数，⛔ 不禁止复用**映射**。⇒ 把上游导出即可消除副本。

### 处置（可核落点；两处源码均在本任务 `## Touches` 内）
1. `packages/quay/src/serve-dashboard.ts`：`stateColorToken` 改为 **export**（函数体一字未动）。
2. `packages/quay/src/serve-tests.ts`：删掉整段 `function timelineColorToken`，改为 import 复用；`buildTestsTimelineSegments` 直接调 `stateColorToken`。
3. 两侧注释同步改写 —— 原文自述的「按同一三元复刻」在修复后即为假，⛔ 留着就是新的漂移源。

### 可核性（AC1/AC2 —— 下列每一条都实跑过，命令与读数逐字给出）
- 该 body 在全仓的定义点数：`grep -rn 'return state === "green" ? "--color-positive-700"' packages/ plugin/` ⇒ **1 行**（`serve-dashboard.ts:167`）。同一命令在 `HEAD~1` ⇒ **2 行**（`serve-dashboard.ts:163` + `serve-tests.ts:293`）。
- `grep -rn 'function timelineColorToken' packages/ plugin/` ⇒ **0 命中**。**负对照**：同一谓词打在 `HEAD~1` 的 `serve-tests.ts` blob 上 ⇒ 命中 `292:function timelineColorToken(…)`（谓词对已知为真的样本确实命中 ⇒ 上面的 0 是真零；硬规则 2 的两半都做了）。
- 行为不变：`packages/quay/test/gap-webui-tests-page-missing-rounds-timeline-bar.test.mjs` **4/4 绿** —— 其中 AC4 断言 `/tests` 与 `/dashboard` **算出相同分段、渲染相同 rect**，换共享实现后两侧仍逐字一致，正是这条用例钉的东西。旁证：`gap-dashboard-fanin-panel-and-timeline-bars.test.mjs` + `gap-dashboard-cards-layout-and-livecard-swimlane.test.mjs` 合 **24/24 绿**；scoped 门 `scripts/test.sh --for-task gap-routine-semantic-dedup-scan-statecolortoken-pair --allow-thin` **exit 0**（其中 `import-graph-check` 绿：⛔ 未新增导入边 —— serve-tests → serve-dashboard 这条本来就存在）。

### 边界（写明，⛔ 不留给读者猜）
① **同载体另有 2 处「同形不同域」的三元，故意不折叠**（硬规则 5b：已 grep 全仓，命中 3 条、已全部列出）：`fanInOutcomeColorToken`（以 `landed` 为「好」）与 `livePhaseColorToken`（4 路）。它们的**域不同**（机械 fan-in 结果 / 在飞 phase，vs 测试轮 state），而 finding 报的恰是「**over the identical domain**」那一对。折叠它们要替作者做一次**语义选择**（宣布 `green` 与 `landed` 同属「好」）—— 同族先例（已 done 的 `gap-routine-semantic-dedup-scan-lineof-lineat`）把 `snippetAt` 折进 `snippetOf` 时明写「这次折叠没有做语义选择」，本处相反，故**不折叠**，作为已命名的边界留下，⛔ 不靠顺手扩大 diff 来显得「更彻底」。
② **本类「再被复制」的守卫仍是例程探针本身；本任务未新增静态回归用例**：anti-drift 读的是 **worktree 里的** `## Touches`（`plugin/scripts/anti-drift-touches-check.ts:293`），而本任务 Touches 只有两个源码文件 —— 新增用例文件要么落在声明之外（fan-in 硬红），要么得赌 task_write 的 Touches 改动穿过 author→develop→worktree 的传播时序才生效，两者本任务都不赌。复制若再发生，探针下一轮仍会报（该对已报过 5 次：09-18 / 09-20 / 09-21 / 09-22 / 09-25），故此处只把**已发生的这一次**归零，并把这条边界写在这里。
③ **finding 措辞里的「an AC forbids a same-named function」范围偏宽**：副本是真的（上面 1. 已证），但那条 AC 禁的是复制**渲染**函数，见上面 2. 的实际断言文本。⛔ 不是「探针误报」。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `statecolortoken-pair`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790306065833`）所描述的问题被复核并处置（见 §Disposition：复核取了读数 —— 两处 body sha256 相同、AC2 实际断言只禁渲染函数；处置=export 上游 + import 复用，副本整段删除，全仓定义点由 2 → 1）
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案（已修掉；可核落点=两处源码 diff + 四条实跑读数（定义点数 1、`function timelineColorToken` 0 命中且负对照命中、timeline-bar 用例 4/4、scoped 门 exit 0）+ 三条边界已写明：不同域不折叠 / 回归守卫仍是例程探针 / AC 措辞范围偏宽）

## DoD
- [x] 上面的判据实跑通过（`node --test` timeline-bar 4/4；旁证 fan-in+cards 24/24；scoped 门 `scripts/test.sh --for-task gap-routine-semantic-dedup-scan-statecolortoken-pair --allow-thin` exit 0；负对照 = 同一 grep 谓词打在 `HEAD~1` blob 上命中 ⇒ 0 是真零）
- [x] ⛔ 探针只立案不执行：本任务由例程经 `plugin/scripts/routine-file-gate.ts` 机械立案，修复由派发链（worker）在本任务自己的 worktree 内执行 —— 例程本身一行都没跑

## Touches
- `packages/quay/src/serve-dashboard.ts`
- `packages/quay/src/serve-tests.ts`
- `tasks/gap-routine-semantic-dedup-scan-statecolortoken-pair.md`
