---
id: gap-outer-session-check-waitforclaude-timeout-flaky
title: outer-session-check.test.mjs waitForClaude 5s 超时在并发 suite 下不够——A 类时序敏感 flaky
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/test/outer-session-check.test.mjs` 3 个测试（`:138` / `:160` / `:229`）同根因红：`AssertionError: outer claude child must be alive (actual: false, expected: true)`。

**根因（读测试源码确认）**：fixture 用 tmux `h.send("osc-h:outer", "exec -a claude-probe sleep 10000 &")` 启动一个 claude-probe 进程，然后 `waitForClaude(..., 5000)` 只等 5 秒断言存活。并发 suite（16 核并行）下 tmux send-keys + 进程启动慢，5 秒超时不够 ⇒ 断言「child must be alive」失败。A 类时序敏感测试（同「四类处置」A 类思路），pre-existing（verification-round 历史失败 2 次）。

## Plan

1. `waitForClaude` 超时 5000ms → 加长（或加 retry），容纳并发 load 下 tmux send-keys + 进程启动慢。
2. 验证：并发 load 下稳定绿；真 dead child 仍 fail（负控制）。

## Acceptance Criteria

- [ ] AC1（能取假）：并发 load 下 outer-session-check 稳定绿（waitForClaude 超时/retry 足够）；（⛔ 仍偶发红 ⇒ 假）。
- [ ] AC2（能取假，负控制）：真 dead child（进程未启动/已死）仍 assert 失败——超时加长不掩盖真失败；（⛔ 误放行 ⇒ 假）。

## Definition of Done

`waitForClaude` 超时/retry 加长到并发 load 下够用；AC1/AC2 勾；outer-session-check 稳定绿；真 dead child 仍 fail；全量 suite 绿。

## Touches

- plugin/test/outer-session-check.test.mjs（waitForClaude 超时/retry 加长）
- tasks/gap-outer-session-check-waitforclaude-timeout-flaky.md（自身）
