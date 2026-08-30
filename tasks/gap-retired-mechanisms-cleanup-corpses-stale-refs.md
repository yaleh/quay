---
id: gap-retired-mechanisms-cleanup-corpses-stale-refs
title: 清理近期退役机制残留——删除三个零消费者尸体脚本 + 修复陈旧引用（worker-driver 注释 / manager-loop-tick
  inbox-summary）
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

最近两周大量机制退役（AC48 / AC84 / AC135 / AC141 / AC149 / gap-retire-halt-file-driver-based / gap-retire-outer-monitors-after-reconciler / gap-inbox-message-bus-teardown 等），多数退役已干净删除文件（halt-check.sh / fan-in-workflow-check.ts / fan-in-ff-executor-check.ts / select-preflight.ts / inbox-reader.sh 等，08-16~08-29 已删）。但普查（2026-08-30，全量引用索引 + 退役提交对照）确认三处残留：

1. **三个「整机制已退役、文件仍在、零运行时消费者」的尸体脚本**（各有配套测试仍断言退役前的活行为，且仍占 capability-catalog 声明与 DELIVERY-INVENTORY 计数）：
   - `plugin/scripts/slot-free-trigger.ts`——外层 Monitor 挂载随 gap-retire-outer-monitors-after-reconciler（08-29）移除，slot-refill 对它的 import 随 gap-retire-slot-refill-halt-mount（08-29）移除；driver 未按 SPEC-unified-driver §2.2「改消费者」采纳。零运行时调用者（grep 全仓代码 = 0），只剩自身测试 + catalog。
   - `plugin/scripts/integration-branch-model.ts`——AC48（08-13/08-14）退役两线分支模型（archive R21/R25）；catalog 自注「forkBaseline() has ZERO production callers (confirmed 2026-08-13)」。当前 fork 基线由 fork-baseline.ts 承担。零生产调用者，仍在 quay-branch.ts:27 注册表占位，测试仍断言退役前集成分支判定行为。
   - `plugin/scripts/unverified-integration-task-ids.ts`——唯一用途是喂已退役的 `integration-branch-model.ts --overlaps-unverified` 路径。零运行时调用者，唯一非测试引用是 rhythm-consumer-check.ts:107 的一行 census 字符串。
2. **worker-driver.ts 两条陈旧注释指向已删除文件**：`:41`「标记落点：fan-in-workflow-check.ts」（该文件 08-29 已删）、`:82`「.halt 仍被旧三层循环的 halt-check.sh / slot-refill.ts 等消费」（halt-check.sh 08-29 已删、.halt 已退役，注释前提为假）。
3. **manager-loop-tick.md:321 仍把 `supervisor-bus-identity.sh inbox-summary` 当活指令**（「总线收件箱」）——inbox 机制 08-20 随 gap-inbox-message-bus-teardown 彻底删除，supervisor-bus-identity.sh 现为退役存根（头部自注「No functional subcommand remains」），该命令现在只会 usage/exit 2。

**为什么独立立案而非并入其它任务**：这是产品/机件层清理，不属于任何在飞任务；且删除机件需走套件验证（scoped 门 + 全量），须有独立 AC/DoD。

## Plan

1. **删除三个尸体脚本 + 配套测试 + catalog 条目**：
   - `plugin/scripts/slot-free-trigger.ts` + `plugin/test/slot-free-trigger.test.mjs`
   - `plugin/scripts/integration-branch-model.ts` + `plugin/test/integration-branch-model.test.mjs`
   - `plugin/scripts/unverified-integration-task-ids.ts` + `plugin/test/unverified-integration-task-ids.test.mjs`
   - `plugin/scripts/capability-catalog.sh` 移除三条 QUESTION 声明（catalog 是机件唯一清单，删除机件必须同步声明；虽无「declared 必须存在」机械红，残留声明是谎——硬规则，doc-referenced ⊆ declared 反向）
2. **quay-branch.ts:27 注册表移除 integration-branch-model 条目**（`createEntryPoint` 成员表不再含它；`quay branch list` 随之不含）
3. **worker-driver.ts:41/:82 注释**改指向退役记录（archive R30/R09 或直接删除该句），不再点已删文件名
4. **manager-loop-tick.md:321** 的 `supervisor-bus-identity.sh inbox-summary` 指令改退役指针（如「inbox 已退役（gap-inbox-message-bus-teardown），本命令为死命令」）或删除
5. **同步套件暴露的引用点**（以套件绿为准逐一核实；核到才改，未核到不得改以免 Touches 漂移）：
   - `plugin/scripts/rhythm-consumer-check.ts:107` census 条目（unverified-integration-task-ids.ts 描述行）
   - `plugin/scripts/runner-static-gate.ts:404` @static-object 列表（retired-clause-check 的静态对象含 integration-branch-model.ts）
   - `plugin/scripts/retired-clause-check.ts` REGISTRY R21/R25 条目（源文件删除后 CHECK-A 因 existsSync→"" 自动通过、不红，但条目成残引；删除或保留由套件判定）
6. **验证**：scoped 门 + 全量 suite 绿；`verify-delivery-surface --inventory` 计数自降（check-time 计算，无需手动快照）

## Acceptance Criteria

- [x] AC1（能取假）：三个尸体文件及其测试不在仓库——`git ls-files 'plugin/scripts/{slot-free-trigger,integration-branch-model,unverified-integration-task-ids}.{ts,sh,mjs}' plugin/test/{slot-free-trigger,integration-branch-model,unverified-integration-task-ids}.test.mjs` 输出为空
- [x] AC2：capability-catalog.sh 不再声明三个名字——`grep -c 'slot-free-trigger\|integration-branch-model\|unverified-integration-task-ids' plugin/scripts/capability-catalog.sh` = 0
- [x] AC3：quay-branch.ts 不再含 integration-branch-model——`grep -c integration-branch-model plugin/scripts/quay-branch.ts` = 0
- [x] AC4（能取假）：worker-driver.ts 不再指向已删除文件——`grep -c 'halt-check.sh\|fan-in-workflow-check' plugin/scripts/worker-driver.ts` = 0
- [x] AC5（能取假）：manager-loop-tick.md 无 `supervisor-bus-identity.sh inbox-summary` 命令形态——grep 命中需为退役指针说明文字，非反引号命令/代码块指令
- [ ] AC6：套件绿——`scripts/test.sh --for-task <本任务>` scoped 门 0 红 + 全量 suite pass（删测试后无残留红因；若 rhythm-consumer/runner-static-gate/retired-clause 需同步则一并绿）（待外部）

## Definition of Done

- [ ] 三尸体（脚本+测试+catalog+quay-branch 注册表）删除/清理落地并 commit；worker-driver 两条注释与 manager-loop-tick 指令已修；全量 suite 绿；DELIVERY-INVENTORY（check-time 计算）一致、无残留声明（待外部）

## Touches

- plugin/scripts/slot-free-trigger.ts (delete)
- plugin/scripts/integration-branch-model.ts (delete)
- plugin/scripts/unverified-integration-task-ids.ts (delete)
- plugin/test/slot-free-trigger.test.mjs (delete)
- plugin/test/integration-branch-model.test.mjs (delete)
- plugin/test/unverified-integration-task-ids.test.mjs (delete)
- plugin/scripts/capability-catalog.sh
- plugin/scripts/quay-branch.ts
- plugin/scripts/worker-driver.ts
- orchestration/manager-loop-tick.md
- plugin/scripts/rhythm-consumer-check.ts（census 条目，套件核实后定）
- plugin/scripts/runner-static-gate.ts（@static-object 条目，套件核实后定）
- plugin/scripts/retired-clause-check.ts（R21/R25 条目，套件核实后定）
- plugin/loop/orchestrator-loop-tick.md（slot-free-trigger 陈旧引用，套件暴露）
- plugin/test/outer-loop-tick-split.test.mjs（outerOnlyCritical 列表去 slot-free-trigger，套件暴露）
- docs/analysis/test-file-baseline.txt（test-file-snapshot 结构性 co-touch：删除三个尸体测试触发相对基线移除；snapshot 再生成一并吸收 develop 并发新增测试文件）
- tasks/gap-retired-mechanisms-cleanup-corpses-stale-refs.md（自身）