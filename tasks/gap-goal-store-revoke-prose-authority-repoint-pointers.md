---
id: gap-goal-store-revoke-prose-authority-repoint-pointers
title: 断权威：manager-phase-goal.md 降级为归档，四处 prompt 指针改读 goals/ store
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-store-migrate-prose-phase-acs-to-records
---
## Proposal

正本：`orchestration/SPEC-goal-mechanism-2026-09-06.md` §7（G3）+ `goals/AC-173-revoke-prose-authority.md`。

**立条依据（实测）**：前置 G2 已 done，`goals/` 下现有 **27 条迁移 AC 记录 + 3 条 GOAL 记录**
（`GOAL-001`/`GOAL-002` active、`GOAL-003` draft）。**但没有任何一层在读它们**——
`orchestration/manager-tick-prompt.txt:1` 仍写「(3) orchestration/manager-phase-goal.md 拿当前阶段目标与 AC」。

**⇒ 现在是"两个来源并存"的状态，这正是上一次 goal-store 死掉的机制**：
散文文件仍是权威且编辑它零摩擦，而写 store 要过 fail-closed 校验。
`goal-store.ts` 2026-08-09 落地后 28 天零使用，根因不是设计缺陷，是**没有强制消费者**。
**本任务是整条 GOAL-001 里唯一真正"断掉旧路"的一步**——不做这一步，前两期的迁移会重新变成死数据。

**同一份文件自己就有漂移实证**：顶部横幅曾写死「AC54–AC78」并过期，2026-08-25 `e389d3e58`
才改成结构性描述；当前阶段标题写「AC143–AC149」而该段实际含到 AC155。

## Plan

1. `orchestration/manager-tick-prompt.txt:1`：把「拿当前阶段目标与 AC」的来源从
   `manager-phase-goal.md` 改为 store（`node packages/quay/src/goal-store.ts list --status active`
   取 active GOAL，再按 `goal:` 取其 AC）。
2. `orchestration/manager-loop-tick.md:66,80`：同上，两处「读 … 推理出【当前阶段】的 AC 清单」改指 store。
3. `orchestration/manager-tick-core.md:33`（A20「每轮推进【一条】阶段 AC（轮转）」）：
   AC 来源改指 store；**勾 AC 的动作改为写 store 记录的 `status`，不再手工编辑散文复选框**。
4. `orchestration/REVIEW-cadence.md:27,93,155`：复核记录的 AC 来源同改。
5. `orchestration/manager-phase-goal.md` 顶部横幅（前 14 行内）加一行显式降级声明：
   **正本已迁至 `goals/`，本文件仅为历史档案（AC1–AC142 的立条理由与已达成阶段）**。

**⛔ 文件不能删**：`plugin/scripts/outer-anchor-check.ts:81` 与
`orchestration/manager-anchor-check.py:32` 都要求该文件存在 ⇒ 只能降级，不能移除。

**⚠️ 改 `manager-tick-core.md` 的硬约束**：`tick-core-static-check.ts` 要求
AC3 的 `src:N` 覆盖率 **= 100%**（当前 manager-tick-core.md=56/56）。改 A20 必须同步维持覆盖率，
否则该检查器红。`plugin/loop/manager-tick-core.md` 是 2 行 pointer（非正文副本），
内容改动不触发 tick-core-drift-check（已实测 doc-check 输出确认）。

**⚠️ 观察项，不在本任务范围**：`plugin/test/integration-batch-merge.test.mjs:482,535-549`
拿 `manager-phase-goal.md` 当「manager 未提交编辑必须被 batch-merge 拒绝」的 fixture。
本任务只加横幅、该文件仍可被编辑 ⇒ 暂不受影响；**若将来它被彻底冻结，需另立任务换 fixture**。

## Acceptance Criteria

- [x] `grep -qE 'goals/|goal list|goal-store' orchestration/manager-tick-prompt.txt` 退出 0（AC-173 判据前半，立案时取假）
- [x] `head -14 orchestration/manager-phase-goal.md | grep -q 'goals/'` 退出 0（AC-173 判据后半，立案时取假）
- [x] `grep -qE 'goals/|goal-store' orchestration/manager-loop-tick.md` 退出 0
- [x] `grep -qE 'goals/|goal-store' orchestration/manager-tick-core.md` 退出 0
- [x] `grep -qE 'goals/|goal-store' orchestration/REVIEW-cadence.md` 退出 0
- [x] `node plugin/scripts/tick-core-static-check.ts` 退出 0（改 tick-core 后覆盖率仍 100%）
- [x] `bash scripts/test.sh --for-task gap-goal-store-revoke-prose-authority-repoint-pointers` 退出 0

## Definition of Done

**验收对象是【旧路真的被断掉】，不是【文档里多了一句话】。**
四处 prompt 指针都不再把 `manager-phase-goal.md` 当作"当前阶段 AC"的来源，
且散文文件顶部明确声明自己是归档；`manager-phase-goal.md` 仍然存在（锚检查要求）。
**验收时至少核一处真实消费**：某一轮 manager tick 的记录里出现从 store（而非散文）读取 active GOAL 及其 AC 的痕迹。
仅改了 prompt 文字而 store 仍无人读 ⇒ 不算完成。

## Touches

- orchestration/manager-tick-prompt.txt
- orchestration/manager-loop-tick.md
- orchestration/manager-tick-core.md
- orchestration/REVIEW-cadence.md
- orchestration/manager-phase-goal.md
- plugin/test/tick-core-static-check.test.mjs
- tasks/gap-goal-store-revoke-prose-authority-repoint-pointers.md
