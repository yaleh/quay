---
id: gap-in-flight-liveness-worktree-proxy-not-process
title: "面板/遥测把「worktree 存在 + status=ready + 无活进程」的任务显示成 in-flight——活性判据只有 worktree/事件存在性，缺进程级 liveness 读法"
status: todo
labels:
  - gap
  - observability
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

面板/遥测把「worktree 存在、status=ready、当前无活进程」的任务显示成「in-flight 中」，因为可用的活性判据只有 worktree/事件存在性（`fast-mode-telemetry.ts --reconcile` 的 `keepReason=worktree-present`；面板 `observation.ts:142 pairInFlight` 的「start 无 end ⇒ in-flight」配对），没有暴露进程级判活（inner 内部已有 `pgrep bash scripts/test.sh` 模式）。

**a8 实测（诊断性只读）**：`fast-mode-telemetry.ts --reconcile --json` 输出 `"closed": []`，6 个任务全 `keepReason: "worktree-present"`——reconcile 设计上「worktree 在 ⇒ 保留」，**不判进程死活**。这判据对「该不该关闭记录」是对的（worktree 在 = 任务确实没完，不该关），但对「面板该不该显示 in-flight」是错的（worktree 在 ≠ 有活进程；ready 池等待期也是 worktree 在，但已无 agent 在跑）。

**修法方向（a8 裁定）**：给读者（面板/CLI）加一条进程级 liveness 读法（像 inner 的 `pgrep bash scripts/test.sh`），**不改 reconcile 的保留判据本身**（关闭条件语义不变）。`observation.ts:544` 注释「the board's orphan signal agrees with --reconcile's process probe」暗示 reconcile 已有 process probe——面板的 in-flight 判定应对齐它，而非只看事件配对。

## Acceptance Criteria

- [ ] AC1: 面板/遥测暴露进程级 liveness 读法——「start 无 end 但无活进程」的任务不再显示为 in-flight（判为 orphan/abandoned 或等价非-in-flight 态），区别于「worktree 存在性」。
- [ ] AC2: 负控制落在生产载体——一个「worktree 存在 + status=ready + 无活进程」的真实任务，进程级判活返回非 in-flight，而 `--reconcile` 保留判据仍返回 `worktree-present`（两套粒度并存，不混）。
- [ ] AC3: reconcile 的保留判据本身不改——`worktree-present` 仍保留记录（关闭条件语义不变），`--reconcile` 不新增关闭条件。

## Definition of Done

- [ ] 面板/遥测对「worktree 在、无活进程」的任务显示为非 in-flight（进程级判活生效，读真实 /live 或 --slot-status 输出），reconcile 保留判据不变，scoped 绿 + 面板相关测试不红（真实输出，非 fixture）。

## Touches

- tasks/gap-in-flight-liveness-worktree-proxy-not-process.md（自身）
- packages/quay/src/observation.ts（pairInFlight/readLive 加进程级判活，对齐 reconcile process probe）
- plugin/scripts/fast-mode-telemetry.ts（process probe 暴露给面板读法，不改 reconcile 保留判据）
- packages/quay/test/serve-board.test.mjs（负控制：worktree 在 + 无活进程 ⇒ 非 in-flight）
