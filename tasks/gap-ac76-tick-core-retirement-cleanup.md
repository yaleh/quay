---
id: gap-ac76-tick-core-retirement-cleanup
title: AC76 判据5 + C7 收指针 + AC48 残留清理——fast-mode-tick-core 退役文本清理（tick core 不留已退役文本以减少上下文污染）
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（人 2026-08-15 裁定：AC76 推进——「tick core 中不应留有已退役的文本，以减少对 tick 处理时上下文的污染；检查退役文本衍生的相关操作和文本并清理。对 AC48 也应做同样的检查和调整。」归 inner 面（fast-mode-tick-core.md + 相关代码）。）**

**三件事**：
1. **C7 收指针（`fast-mode-tick-core.md:69`）**：现状长注解「（前提已死，AC48/AC61 退役；不计入覆盖率分母）活指令指向已 RETIRED 的 integration-branch-model.ts —— 正身已归档 → archive#R25」→ 目标「~~**C7 正身已迁出**~~ → archive#R25」（删长注解，只留指针）。
2. **AC48 残留（$FORK_BASELINE 两线语义已死）**：`fork-baseline.ts` 在 per-task-suite-verification 模型下建立基线 = develop（单线）；integration 线退役（`--force-integration` 已退役，默认路径仅单线下游用）。核内 A9/A15④/A17/C3 引用 $FORK_BASELINE——其中 A17（:39 `--branch "$FORK_BASELINE"`）+ C3（:65 `$FORK_BASELINE 只由外层批量合推进`）的「外层批量合推进 integration→develop」语义已死（AC48 退役），按单线（develop = merge target）处理。
3. **AC76 判据5 代码标注（不删，写显式退役标注——同 AC48 判据2）**：
   - slot-refill.ts 的 in_flight_count→slots_free 在飞输入
   - fast-mode-telemetry.ts 的 realInFlight/reconcileInFlight/detectClosedButLive/analyzeSlotStatus
   - .quay/inner-wakeup-heartbeat.json 的 slots_free/should_refill/dispatchable_disjoint 在飞输入
   - /live 与 observation 面的 realInFlight 消费端
   - A16/A16b 的 --task-start 遥测【在飞用途】（派发留痕用途另议，不退役）
   - **⛔ 代码文件写显式退役标注（不删）；tick core 里的条款才迁出正文——两者形态不同。**

**⊢ tick core 旧读法改新读法**：核内 A12/A13/A16（:33/:34/:37）引用旧读法（slot-refill --in-flight / telemetry --slots / --task-start 在飞用途），退役后改新读法（查 subagent）。

**⚠️ AC8 断言**：manager 已立 gap-ac8-migration-semantic-test-update。迁完 C7 后，`tick-core-static-check.test.mjs`「inner C7 deducts」类断言按新语义改（已迁出不在核内），不是改数。

**判据1**：tick core 无已退役文本（C7 指针 + $FORK_BASELINE 单线 + 旧读法清除）。
**判据2（能取假）**：AC76 判据5 代码文件有显式退役标注（不删）；`tick-core-static-check` AC8「inner C7」按新语义（迁出不计数）；既有测试绿。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 fast-mode-tick-core.md（C7/A9/A15④/A17/C3/A12/A13/A16）+ fork-baseline.ts + slot-refill.ts + fast-mode-telemetry.ts + tick-core-static-check.test.mjs。
2. C7 收指针；$FORK_BASELINE 引用按单线处理（A17/C3 改指向 develop/merge-target）；A12/A13/A16 旧读法改新读法。
3. AC76 判据5：代码文件（slot-refill/telemetry/heartbeat/live/A16 在飞用途）写显式退役标注（不删）。
4. AC8 断言按新语义改（inner C7 迁出不计数）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：tick core 无已退役文本——C7 收指针、$FORK_BASELINE 单线（A17/C3 改 develop）、A12/A13/A16 旧读法清除。
- [ ] AC2 判据2 能取假：AC76 判据5 代码文件显式退役标注（不删）；tick-core-static-check AC8「inner C7」新语义（迁出不计数）；既有测试绿。
- [ ] AC3 判据3：`--for-task` scoped 门绿。

## Definition of Done

- [ ] tick core 退役文本清理（C7/$FORK_BASELINE/旧读法）+ AC76 判据5 代码标注 + AC8 断言新语义——人裁定落地。

## Touches

- orchestration/fast-mode-tick-core.md（C7 收指针 + $FORK_BASELINE 单线 + 旧读法改新）
- plugin/scripts/fork-baseline.ts（如需，退役标注）
- plugin/scripts/slot-refill.ts、plugin/scripts/fast-mode-telemetry.ts（AC76 判据5 退役标注）
- plugin/test/tick-core-static-check.test.mjs（AC8 inner C7 新语义）
- tasks/gap-ac76-tick-core-retirement-cleanup.md（自身）
