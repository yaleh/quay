---
id: gap-session-liveness-teardown-ol-scd-leak
title: "session-liveness 探针 teardown 泄漏——kill-server 无出口 + 漏杀 pane 子进程孤儿 claude-probe 误判活 owner（ol-scd 家族）"
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`session-liveness` 探针 teardown 有泄漏缺陷（ol-scd 家族），此前被 poll-bounded 的 suite-fix **越界修**了 4 连 commit（`a76959c8 → 338f9a71 → b5351a99 → cc034d90`），内容合法但越界（不在 poll-bounded Touches），inner 已 revert（→ `fbf7669b`）独立立案重做。

核心缺陷（4 连 commit 内容，现已在 develop 上还原为未修态）：

- **kill-server 无出口（ol-scd-c）**：teardown 重试 kill-server 直至 owner 死亡才注销，否则泄漏无出口——`serverPidOf` 定位 tmux server 失败时无回退。
- **漏杀 pane 子进程（ol-scd-e）**：teardown 漏杀 pane 子进程，孤儿 `claude-probe` 被误判为活 owner，挡目录清理。
- **mkdtemp 静态配对 rmSync**：`teardownProbe` 移入 helper 后，restart 测试的 mkdtemp 临时目录静态配对 rmSync 在文件内不可见。

## Acceptance Criteria

- [ ] AC1: teardown kill-server 有出口——owner 死亡才注销，`serverPidOf` 定位失败时有回退（SIGKILL），无泄漏（ol-scd-c）。
- [ ] AC2: 漏杀 pane 子进程消除——teardown 后无孤儿 `claude-probe` 进程被误判为活 owner、不挡目录清理（ol-scd-e）。
- [ ] AC3: scoped 绿 + session-liveness 相关测试不红（真实输出，非 fixture）。

## Definition of Done

- [ ] 真实 teardown 后：kill-server 退出（owner 死亡）+ 无孤儿 pane 进程挡目录清理（进程级实测），scoped 绿。

## Touches

- tasks/gap-session-liveness-teardown-ol-scd-leak.md（自身）
- plugin/scripts/session-liveness-sweep.mjs（teardown kill-server 泄漏 + pane 子进程漏杀修复）
- plugin/test/session-liveness-sweep.test.mjs（kill-server 出口 + 孤儿 pane 负控制）
- plugin/test/session-liveness-restart.test.mjs（mkdtemp 静态配对负控制）
- plugin/test/session-liveness-helpers.mjs（teardownProbe helper 可见性）
