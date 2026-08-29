---
id: gap-fan-in-merge-develop-derived-recompute-and-reason
title: 机械 fan-in merge-develop 冲突：derived 文件机械重算（A）+ CONTINUE reason 携带具体冲突（B）
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

机械 fan-in 第 2 步 `git merge develop` 的冲突，是当前批量 fan-in 的主力卡点（4 个 outline 计数冲突 + 1 个 worker-driver.ts 冲突）。冲突发生在 **driver 的 step 2**（worker 已退出后），且冲突信息（`mechanical_fan_in.reason` =「CONFLICT: Merge conflict in <file>」）**没有传回下一轮 worker**——CONTINUE prompt 的 `reason` 读的是通用 `failure_reason`（「task status=ready not done」）。

两个修法：
- **A（driver 对 derived 文件机械重算）**：step 2 冲突时，若全部冲突文件是 derived（`docs/proposals/quay-product-outline.md` §6 inventory），driver 机械 resolve——取 develop 版 + 重跑 generator，零往返；
- **B（reason 携带具体冲突）**：CONTINUE prompt 的 `reason` 改读 `mechanical_fan_in.step` + `mechanical_fan_in.reason`（具体冲突文件），让 worker 精准 resolve code 冲突。

## Plan

1. **A**：`runMechanicalFanIn` 的 step 2（`git merge develop`）失败时，`git diff --name-only --diff-filter=U` 取 unmerged 文件；若**全部**落在 derived 集合（`docs/proposals/quay-product-outline.md`），则机械取 mergeTarget 版：`git checkout develop -- <derived>` + `git add` + `git commit --no-edit` 完成 merge，然后继续后续步（⛔ **不再重跑 `--write-inventory`**——该 flag 已退役，outline §6 快照移除、改 check-time 计算，见 verify-delivery-surface.ts:502「ERROR: --write-inventory is retired」）；若含 code 文件则照旧 `fail("merge-develop")`（worker 兜底）。**import 直接引用 outline 路径 `docs/proposals/quay-product-outline.md`，⛔ 不用不存在的 `OUTLINE_DOC_REL`**（verify-delivery-surface.ts 不导出该符号——它导出 SPEC_DOC_REL/DELIVERY_INVENTORY 等，坏 import 是当前 scoped-gate 红的直接根因）。
2. **B**：`lastExitedNotLandedReason`（worker-driver.ts）改读 `mechanical_fan_in`（先 `step` 后 `reason`，拼接成「step=merge-develop: CONFLICT in <file>」），非通用 `failure_reason`；`continueConflictResolutionNote()` 的「derived 重算」同步改为「outline 冲突取 develop 版」（⛔ 也引用过 --write-inventory，同属过时）。

## Acceptance Criteria

- [ ] AC1（能取假，A 生效）：两个各自增删 plugin/scripts 的任务、worktree fork 于不同 develop 基点时，机械 fan-in 的 step 2 对纯 outline 冲突**机械重算并继续**（不 red、不 exited-not-landed），最终 landed。
- [ ] AC2（能取假，A 不越界）：冲突含 code 文件（如 worker-driver.ts）时，step 2 仍 `fail("merge-develop")`（机械重算只对 derived，不对 code）。
- [ ] AC3（能取假，B 生效）：merge-develop 失败后，`lastExitedNotLandedReason` 返回的值含具体冲突文件路径（grep 到 `CONFLICT` 或 `docs/proposals/quay-product-outline.md`），非「task status=ready not done」。
- [ ] AC4（能取假，单测）：`worker-driver.test.mjs` 断言 A（derived 冲突机械重算成功路径 + code 冲突仍 fail）与 B（reason 含具体文件），改掉任一 ⇒ 测试红。

## Definition of Done

driver 的 step 2 对纯 derived（outline §6）冲突机械重算落地、零往返；code 冲突仍 fail 并交由 worker，且 worker 的 CONTINUE prompt 能拿到「具体哪个文件冲突」去精准 resolve。落地即消掉批量里最痛的 4 个 outline 冲突 + 给 code 冲突的 worker 提供所需信息。

## Touches

- plugin/scripts/worker-driver.ts（runMechanicalFanIn step 2 derived 重算 + lastExitedNotLandedReason 读 mechanical_fan_in）
- plugin/test/worker-driver.test.mjs（A/B 单测）
- tasks/gap-fan-in-merge-develop-derived-recompute-and-reason.md（自身）
