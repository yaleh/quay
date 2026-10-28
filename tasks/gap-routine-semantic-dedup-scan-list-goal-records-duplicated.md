---
id: gap-routine-semantic-dedup-scan-list-goal-records-duplicated
title: "semantic-dedup-scan: Bodies are byte-identical apart from
  goalStoreArgv's extra dataRoot argument, and goalStoreArgv already defaults
  dataRoot to scriptRoot, so one implementation "
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Bodies are byte-identical apart from goalStoreArgv's extra dataRoot argument, and goalStoreArgv already defaults dataRoot to scriptRoot, so one implementation serves both callers.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793162251891` · ts `2026-10-28T04:37:31.891Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`listGoalRecords`
- 涉及文件：
- `plugin/scripts/goal-driver.ts:284`
- `plugin/scripts/meta-driver.ts:289`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## Disposition
已修（merge，2026-10-28，由派发链执行）。`listGoalRecords` 在 `plugin/scripts/goal-driver.ts` 与
`plugin/scripts/meta-driver.ts` 各有一份 byte-identical 副本，唯一差异是前者显式传 `goalStoreArgv` 的第三参
`dataRoot`；而 `goalStoreArgv` 的缺省本来就是 `scriptRoot`。

→ 上收为**一份实现**：`meta-driver.listGoalRecords(scriptRoot, dataRoot = scriptRoot ?? "")`。
本模块既有调用点 `listGoalRecords(root)` 行为不变（第二参落到同一缺省）；goal-driver 的【测试缝】
（scriptRoot 定位 goal-store.ts，dataRoot 定位 goals/）仍显式传第二参。goal-driver 改为 import + re-export，
保留既有 import 面（同 `splitArgs` 的 `process-kill-lib` 手法）。

证据（可复跑）：
- `grep -rn "function listGoalRecords" plugin/scripts packages/*/src` —— 修前 2 处（goal-driver.ts /
  meta-driver.ts），修后 1 处（meta-driver.ts）。
- 绑定同一性：`node --no-warnings --experimental-strip-types -e 'const a=await import("./plugin/scripts/goal-driver.ts"); const b=await import("./plugin/scripts/meta-driver.ts"); console.log(a.listGoalRecords===b.listGoalRecords)'`
  ⇒ `true`（re-export 的是同一个函数对象，⛔ 不是第二份转调壳）。
- 行为不变：直接消费该函数体的 4 个测试文件（goal-triage-activate-executed / goal-triage-fresh-draft-not-retire /
  goal-posture-blocks-activate / goal-driver-activation-blocked）12 例全绿。
- 效应预测（concept_recurs_after_merge）：符号 `listGoalRecords` 的**定义处**数 2→1，后续轮次已无成对副本可报。

边界（硬规则 5b）：同簇的 `gateCriterion` **未**并入 —— 两者参数面不同（meta 版没有 dataRoot 位，
goal-driver 版按 `(scriptRoot, id, dataRoot, opts)` 调用），且扫描器未判其为 `byte-identical-body`；
已在 goal-driver 的注释里写明它为何留在本文件，⛔ 不是「修了被报出来的那一个就以为整簇干净」。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `list-goal-records-duplicated`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793162251891`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Dark axis (ADR-007)
- L_G archguard-runner --root . : cycles=0, directoryCycleCount=0（6 个 scope 全部 evaluated=true，exit 0）
  改动只在两个 driver 模块之间上收一个函数体，未新增目录/包依赖边，故 L_G 读数与改动前同形。
- L_D: goal-driver→meta-driver import 边数=1（修前也是 1——收掉的是函数体副本，不是新增依赖）

## Touches
- `plugin/scripts/goal-driver.ts`
- `plugin/scripts/meta-driver.ts`
- `tasks/gap-routine-semantic-dedup-scan-list-goal-records-duplicated.md`
