---
id: gap-goal-store-migrate-prose-phase-acs-to-records
title: 把 manager-phase-goal.md 的当前阶段与下一阶段 AC 保号迁入 goals/ 记录
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-store-goal-id-vocabulary-and-draft-status
---
## Proposal

正本：`orchestration/SPEC-goal-mechanism-2026-09-06.md` §7.1 + `goals/AC-171-migrate-live-phases-into-store.md`。

**立条依据（实测）**：`goal-store.ts` 于 2026-08-09 落地、功能完整、有测试、有 `/goal` 路由，
而 `goals/` 目录**在任何分支上从未存在过**、`.quay/gate-events.jsonl` 中 `"gate":"goal"` **零条**、
落地后 **28 天零改动**；其立案任务 `gap-spec-goal-store-third-sibling-kind` **标 done 而迁移从未发生**。
⇒ 上一次的死因是「建好了没人迁」，不是设计缺陷。本任务把迁移排在 ABI 与 driver 之前，
**让 store 先有真实数据，机制才有"不用就疼"的消费者**。

**⚠️ 散文文件的范围标注已经漂了**：`manager-phase-goal.md:12` 当前阶段标题写「AC143–**AC149**」，
而该段**实际含到 AC155**（`39617238e` 追加 AC150-155 时未更新标题，实测确认）。
**这是"散文不能继续当权威"的直接物证，也是本任务必须逐条核对而非按标题范围批量搬的理由。**

**前置已达成**：`gap-goal-store-goal-id-vocabulary-and-draft-status`（G1）已于 2026-09-06 done，
`GOAL-NNN` 前缀、`draft` 状态、`goal:` 字段均已可用（实测 `goal-store.ts get GOAL-001` 退出 0）。

## Plan

1. 逐条读 `manager-phase-goal.md` 当前阶段块（AC143–AC155，13 条）与下一阶段块（AC156–AC169，14 条），
   **按编号逐个核对，不按标题范围批量搬**。
2. 每条落一个 `goals/AC-<NNN>-<slug>.md`：**保号**（`AC143` → `AC-143`，不重排不复用）；
   `criterion` 取该 AC 在散文里的可跑 shell 判据；`origin` 取该 AC 的立条裁定原文；
   `goal:` 指向所属 GOAL。
3. **无可跑判据的 AC，`criterion` 留空** ⇒ gate `fail-closed` 报红。
   **这是对的**——它今天被散文盖住了（SPEC-0809 §3 明写该原则）。
4. 产出 `GOAL-002`（当前阶段「三层塌缩 —— 会话退役，机制承接」，`status: active`）与
   `GOAL-003`（下一阶段「插件面收敛 —— 单一 bundle、原生交付、死物归档」，`status: draft`）。
   两者正文按 SPEC §3.3 补齐五节（背景/范围与非目标/退出条件/风险/与其他 goal 的关系）。
5. `manager-phase-goal.md` 顶部横幅补一行指向 `goals/`（**本任务只加指针，正式降级与
   prompt 指针 repoint 留给 G3**，不改任何消费者）。
6. 在 `goal-store.test.mjs` 补一条迁移完整性断言：AC143..AC155 与 AC156..AC169 的每个编号
   在 `goals/` 下恰有一个记录。

**范围限定**：只迁**活跃集 + 下一阶段**（沿用 SPEC-0809 §5 的既有纪律）。
AC1–AC142 的历史阶段留在 `manager-phase-goal.md` / `manager-phase-goal-archive.md` 作历史档案。

## Acceptance Criteria

- [x] `test "$(node packages/quay/src/goal-store.ts list | grep -c '"id": "AC-1[4-6][0-9]"')" -ge 27` 退出 0（AC-171 判据，立案时取假：count=0）
- [x] `node packages/quay/src/goal-store.ts get GOAL-002 | grep -q '"status": "active"'` 退出 0
- [x] `node packages/quay/src/goal-store.ts get GOAL-003 | grep -q '"status": "draft"'` 退出 0（AC-172 判据的真实载体）
- [x] 保号无缺漏：AC143..AC155 与 AC156..AC169 的每个编号在 `goals/` 下恰有一个记录文件（单测断言）
- [x] 负控制：至少一条无可跑判据的 AC，其 `criterion` 为空且 `goal-store.ts gate <id>` 判红退出 1
- [x] `bash scripts/test.sh --for-task gap-goal-store-migrate-prose-phase-acs-to-records` 退出 0

## Definition of Done

**验收对象是【生产载体里的记录数】，不是【迁移脚本写好了】。**
`goals/` 下有 27 条真实 AC 记录 + 2 条 GOAL 记录，且每条的 `criterion`/`origin` 是从散文
**逐条核对**搬来的（不是按标题范围批量生成的占位内容）。
`node packages/quay/src/goal-store.ts list --status active` 在生产工作树上返回 `GOAL-001` 与 `GOAL-002` 两条
——**这同时是 I1′（多 active）的第一个真实载体，在旧 I1 下非法**。
仅新增文件而 `list` 读不出、或 `criterion` 全为空占位 ⇒ 不算完成。

## Touches

- goals/GOAL-002-three-layer-collapse.md (new)
- goals/GOAL-003-plugin-surface-convergence.md (new)
- goals/AC-1[4-6][0-9]-*.md (new)
- orchestration/manager-phase-goal.md
- packages/quay/test/goal-store.test.mjs
- tasks/gap-goal-store-migrate-prose-phase-acs-to-records.md
