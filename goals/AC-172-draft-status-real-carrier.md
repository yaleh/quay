---
id: AC-172
title: draft 状态可用，且有真实的 draft GOAL 载体
status: achieved
kind: criterion
goal: GOAL-001
criterion: >
  node packages/quay/src/goal-store.ts list --status draft | grep -q '"id":
  "GOAL-'
expect: exit 0
origin: |
  人 2026-09-06 裁定「draft 状态接受」。
  立条依据（推导，非偏好）：现词表无"写好但未启动"态且 write() 默认 status="active"
  (goal-store.ts:258) ⇒ 写入即激活；叠加硬上限后，cap 满时连撰写都会被堵死——
  上限本该只约束激活。该状态在散文里已存在：manager-phase-goal.md:174
  「📋 下一阶段（已创建，未启动）」，44f8813d2 明写「未切换、未启动、不得据此派发」。
evidence:
  at: 2026-09-06T22:05:58.395Z
  verdict: pass
  reading: acceptance passed (exit 0)
---

**判据（能取假）**：`list --status draft` 至少返回一条 `GOAL-` 记录。

**取假**：今天必假两次——`VALID_GOAL_STATUSES`（`goal-store.ts:46`）不含 `draft`，
且 `goals/` 不存在。仅改词表而不产生真实 draft 载体，仍判假。

**⊢ 这条判的是"状态有真实用户"，不是"状态被定义了"**：
真实载体是 `GOAL-003`（下一阶段「插件面收敛」），它在 `AC-171` 的迁移中以 `draft` 落盘。

**配套改动**：`write()` 的默认 status 由 `active` 改为 **`draft`**——**默认不激活**，
与人裁定 3「暂不做自动晋升机制」同向；激活是一个显式动作。
