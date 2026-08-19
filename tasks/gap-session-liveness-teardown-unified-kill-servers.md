---
id: gap-session-liveness-teardown-unified-kill-servers
title: "session-liveness 测试 teardown 系统性漏杀自建 tmux server（ol-gap4/ol-subagent/tgt）——第 20 条点修 ol-scd-d 漏同类路径，需统一 after() hook 清理"
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

session-liveness 测试的 `after()` hook 没有**统一**杀掉测试自建的 tmux server，泄漏 4 个 server + 1 个 touch-loop（`ol-gap4` / `ol-scd-a` / `ol-subagent` / `tgt`），从首轮 suite 起存活 62 分钟、10000ms reap-wait 后仍在，导致每轮全量 suite 的 `tmux-leak-scan` FAIL → 阻塞第 23 条（inflight-states）fan-in（它 Touches 不含 session-liveness，但全量 suite 必跑 session-liveness 测试）。

**第 20 条（ol-scd-d）是「点修」**——只补了 ol-scd-d 那一条 teardown 路径（serverPidViaPaneEnv 解析 + SIGKILL），漏了 `ol-gap4`/`ol-subagent`/`tgt` 等**同类但不同路径**的自建 server。**硬规则 5b 形态**：修一处漏同类。正确修法是【统一 after() hook 系统性杀所有自建 server】，不是逐个路径补（逐个补会继续漏）。

## Acceptance Criteria

- [ ] AC1: session-liveness 测试的 `after()` hook **统一**杀掉所有测试自建的 tmux server（不逐路径枚举，而是系统性清理自建 server 集合）。
- [ ] AC2: 负控制落在生产载体——真实全量 suite 后 `tmux-leak-scan` 无 session-liveness 自建 server 残留（多次 suite 稳定 clean，读生产日志非 fixture）。
- [ ] AC3: scoped 绿 + session-liveness 相关测试不红。

## Definition of Done

- [ ] 真实全量 suite 后无 session-liveness 自建 tmux server 残留（稳定，多次复现不泄漏），scoped 绿。

## Touches

- tasks/gap-session-liveness-teardown-unified-kill-servers.md（自身）
- plugin/test/session-liveness-*.test.mjs（after() hook 统一清理自建 server）
- plugin/scripts/session-liveness-sweep.mjs（统一清理逻辑，若需）
