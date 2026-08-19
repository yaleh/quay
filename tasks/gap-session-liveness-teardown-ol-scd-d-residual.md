---
id: gap-session-liveness-teardown-ol-scd-d-residual
title: "session-liveness 测试 teardown 泄漏 ol-scd-d 残留——kill 路径不覆盖（7c755610 修了主路径漏了 ol-scd-d，稳定复现）"
status: todo
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`gap-session-liveness-teardown-ol-scd-leak`（7c755610）修了 teardown 的「kill-server 出口 + 漏杀 pane 子进程」，但 session-liveness 测试**仍泄漏 `ol-scd-d` 残留**：测试自己启动的 `tmux -S /tmp/session-liveness-scd-*/sock/... new-session -d ... -s ol-scd-d bash`（PID 1432481）在测试结束后【没被清理】，10000ms reap-wait 后仍在。**稳定复现（2 次 suite 2 次泄漏）**，导致每次 suite 的 tmux-leak-scan 都 FAIL——当前真正 blocker（第 19 条 monitor-mount-check 的 fix 对、测试 fail 0，但被这个越界 tmux-leak 红挡 land 不了）。

**硬规则 5b 实例**：teardown 泄漏修了「kill-server / pane 子进程」主路径，漏了「ol-scd-d 这个测试自己启动的 tmux server」另一条清理路径。

## Acceptance Criteria

- [ ] AC1: ol-scd-d 的 teardown 清理路径覆盖——测试结束 kill 自己启动的 `ol-scd-d` tmux server（不只 kill pane 子进程，还要 kill 测试自建的 session）。
- [ ] AC2: 负控制落在生产载体——真实 suite 后 `tmux-leak-scan` 无 ol-scd-d 残留（多次 suite 稳定 clean，读生产日志非 fixture）。
- [ ] AC3: scoped 绿 + session-liveness 相关测试不红。

## Definition of Done

- [ ] 真实 suite 后无 ol-scd-d 残留（稳定，多次复现不泄漏），scoped 绿。

## Touches

- tasks/gap-session-liveness-teardown-ol-scd-d-residual.md（自身）
- plugin/scripts/session-liveness-sweep.mjs（ol-scd-d 测试自建 session 的清理路径）
- plugin/test/session-liveness-sweep.test.mjs（ol-scd-d 清理负控制）
