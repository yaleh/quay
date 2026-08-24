---
id: gap-suite-concurrent-session-liveness-cross-contamination
title: 并发套件（全量+scoped）共享 session-liveness-sig-* 前缀 ⇒ leak-scan 跨套件误报假红
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`gap-tmux-stale-not-honored-comment-private-socket-leak-scan` fan-in 5 轮 defer 至 needs-human——全量套件尾 tmux-leak-scan 检出 `/tmp/session-liveness-sig-*`（5 目录）+ `ol-*`（5 会话）残留，来自【其它任务并发套件】的 session-liveness 测试（本任务 Touches 前缀 `quay-init-tmux-|quay-isc-|repro-rmsync-` 不在残留内，workflow 已核实）。残留 transient 已清，但并发套件仍在跑（m-bucket 全量 + print-bg-wait scoped）⇒ 立即重派会再撞同一残留。

**根因**：`QUAY_MAX_CONCURRENT_SUITES=1` 应串行化套件，但全量 + scoped 套件仍在并发；并发套件共享 `session-liveness-sig-*` 前缀 ⇒ leak-scan 无法区分「本套件残留」vs「其它套件残留」，把并发套件的合法残留误判为 leak。

## Plan

三选一（或组合）：① 串行化套件（honor `QUAY_MAX_CONCURRENT_SUITES=1`，含 scoped 计数）；② 按套件隔离 `session-liveness-sig-*` 前缀（每套件独立前缀）；③ leak-scan 过滤非本套件残留（按前缀/套件 ID）。

## Acceptance Criteria

- [ ] AC1（能取假，并发不误报）：并发套件下 leak-scan 不再误报其它套件残留；（⛔ 仍假红 ⇒ 假）。
- [ ] AC2（能取假，串行/隔离生效）：全量+scoped 套件不再并发共享 session-liveness 前缀（串行化或前缀隔离）；（⛔ 仍并发共享 ⇒ 假）。

## Definition of Done

并发套件跨污染消除；AC1-2 全勾；fan-in 不再因并发套件残留被 defer。

## Touches

- plugin/scripts/full-suite-runner.ts（套件串行化 / leak-scan 前缀隔离）
- plugin/scripts/session-liveness.sh（前缀隔离，如需）
- plugin/test/full-suite-runner.test.mjs（对应测试）
- tasks/gap-suite-concurrent-session-liveness-cross-contamination.md（自身）