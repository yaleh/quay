---
id: gap-worker-needs-human-destroys-branch-worktree
title: needs-human / exited-not-landed（套件绿+实现完成）走孤儿清理销毁分支+worktree ⇒
  已完成实现永久丢失（39min 第 2 次同形）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**根因（manager 2026-08-24 07:0xZ 定位，证据=worker transcript + worker-outcome.jsonl 实测）**：worker 完成实现 + 全量套件绿 → fan-in 跑到底 → AC-completion 闸因【零勾选】拒绝翻 done（闸行为正确）→ driver 按 status != done 记 `exited-not-landed` → `cleanupOrphanWorktree`（worker-driver.ts:436）把「闸拒绝」与「崩溃/未实现」走同一销毁路径：`git worktree remove --force` + `git branch -D task/<id>` ⇒ 完成实现永久丢失。

**实例（第 2 次同形）**：`gap-worker-print-bg-wait-ceiling-600s` 第 2 次尝试（worker pid 4035689，04:30:27→05:09:43，39.3min），套件绿 3303/0，fan-in outcome=needs-human。独立核实：`git branch --list '*print-bg-wait*'` ⇒ 分支已不存在；worktree 目录非 git 仓库（空壳）；task status=ready 4 AC+DoD 全未勾；worker-outcome final_state=exited-not-landed。第 1 次尝试（04:15:46）worktree_cleanup_error 侥幸留残骸。

**两个可分离点**：①闸拒绝 ≠ 工作无效——needs-human 应保留分支/worktree 供续做，不该走「崩溃/未实现」的销毁路径（本条，新的、代价最大）；②AC 勾选缺口（fan-in subagent 不 satisfy-then-check）已有记录（memory `fan-in-post-suite-boxes-need-inner-check`，3 实例达机械修法门槛）。

## Plan

区分「闸拒绝（工作有效，需保留）」与「崩溃/未实现（可销毁）」两种终态，needs-human 时 `cleanupOrphanWorktree` 不得删分支+worktree（保留供续做或人工收尾）。

## Acceptance Criteria

- [x] AC1（能取假，保留）：worker fan-in 终态为 needs-human 时，其分支 `task/<id>` 与 worktree 目录【仍存在】且 worktree 是有效 git 仓库（`git -C <worktree> rev-parse` 成功）；⛔ 分支消失/空壳 ⇒ 假。
- [x] AC2（能取假，仍清崩溃）：worker 异常死亡（failed/killed，无完成实现）时，orphan 清理仍删分支+worktree（⛔ 本条不能破坏正常 orphan 回收）。

## Definition of Done

needs-human 与崩溃终态在清理路径上区分落地 develop；AC1-2 全勾；一个套件绿+AC 闸拒绝的 worker 其分支/worktree 保留（AC1 复现，不重演 39min 丢失）。

## Touches

- plugin/scripts/worker-driver.ts（cleanupOrphanWorktree 调用点 / exited-not-landed 处置）
- plugin/test/worker-driver.test.mjs
- tasks/gap-worker-needs-human-destroys-branch-worktree.md（自身）