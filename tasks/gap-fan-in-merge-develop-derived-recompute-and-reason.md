---
id: gap-fan-in-merge-develop-derived-recompute-and-reason
title: 机械 fan-in merge-develop 冲突：CONTINUE reason 携带具体冲突文件（B）——derived 机械重算（A）已退役
status: done
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

机械 fan-in 第 2 步 `git merge develop` 的冲突，是批量 fan-in 的主力卡点。冲突发生在 **driver 的 step 2**（worker 已退出后），且冲突信息（`mechanical_fan_in.reason` =「CONFLICT: Merge conflict in <file>」）**没有传回下一轮 worker**——CONTINUE prompt 的 `reason` 读的是通用 `failure_reason`（「task status=ready not done」），worker 拿不到「具体哪个文件冲突」，无法精准 resolve code 冲突。

原立案含两个修法：

- **A（driver 对 derived 文件机械重算）——已退役**：step 2 冲突时，若全部冲突文件是 derived（`docs/proposals/quay-product-outline.md` §6 DELIVERY-INVENTORY 快照），driver 机械 resolve——取 develop 版 + 重跑 generator，零往返。**该修法被 `gap-delivery-inventory-check-time-computation`（2026-08-29 落地 develop）退役**：那个任务把 outline §6 快照整体删除（计数改 check-time 计算、`--write-inventory` flag 退役），**无 derived 文件可重算**，原「4 个 outline 计数冲突」热点随之消失。故 A 不再有目标文件，撤下。
- **B（reason 携带具体冲突）——保留**：CONTINUE prompt 的 `reason` 改读 `mechanical_fan_in.step` + `mechanical_fan_in.reason`（具体冲突文件），让 worker 精准 resolve code 冲突（如今剩下的冲突全是 code 文件，如 worker-driver.ts）。

## Plan

1. **B**：`lastExitedNotLandedReason`（worker-driver.ts）改读 `mechanical_fan_in`（先 `step` 后 `reason`，拼接成「step=merge-develop: CONFLICT in <file>」），非通用 `failure_reason`；`mechanical_fan_in` 缺 `step`（缺键 / 非 red / 非对象）⇒ 回退 `failure_reason`（旧行为保留）。
2. **A 撤下**：删除 `runMechanicalFanIn` step 2 的 derived 机械重算（`OUTLINE_DOC_REL` import / `DERIVED_CONFLICT_FILES` / `resolveDerivedMergeConflict`）——它们引用已删除的 §6 快照与已退役的 `--write-inventory`，merge develop 失败时恢复 `fail("merge-develop")` 直返。
3. `continueConflictResolutionNote()` 不变（本就由 `gap-continue-prompt-conflict-resolution-protocol` 拥有；其 derived 重算指令的 stale 是 `gap-delivery-inventory-check-time-computation` 未收尾，另案）。

## Acceptance Criteria

- [x] AC1（A 生效，已退役）：superseded by `gap-delivery-inventory-check-time-computation`（删除 outline §6 DELIVERY-INVENTORY 快照）——无 derived 文件可机械重算，原「纯 outline 冲突机械重算并 landed」判据随快照消失而不成立。
- [x] AC2（A 不越界，已退役）：同 AC1——无 derived 集合，原「含 code 文件仍 fail」判据随 derived 文件消失而不成立。
- [x] AC3（能取假，B 生效）：merge-develop 失败后，`lastExitedNotLandedReason` 返回的值含具体冲突文件路径（grep 到 `CONFLICT` 或 `worker-driver.ts`），非「task status=ready not done」。
- [x] AC4（能取假，单测）：`worker-driver.test.mjs` 断言 B（reason 读 `mechanical_fan_in` 含具体文件 + 无 `mechanical_fan_in` 回退 `failure_reason`）与 A 退役（derived 重算逻辑无残留），改掉任一 ⇒ 测试红。

## Definition of Done

driver 的 `lastExitedNotLandedReason` 对 merge-develop 失败（code 冲突）返回「step=merge-develop: CONFLICT in <具体文件>」，worker 的 CONTINUE prompt 能拿到「具体哪个文件冲突」去精准 resolve；A 的 derived 机械重算逻辑（引用已删除 §6 快照 + 退役 flag）彻底移除，worker-driver.ts 可正常加载。

## Touches

- plugin/scripts/worker-driver.ts（lastExitedNotLandedReason 读 mechanical_fan_in；runMechanicalFanIn step 2 撤下 derived 重算）
- plugin/test/worker-driver.test.mjs（B 单测 + A 退役结构断言）
- tasks/gap-fan-in-merge-develop-derived-recompute-and-reason.md（自身）
