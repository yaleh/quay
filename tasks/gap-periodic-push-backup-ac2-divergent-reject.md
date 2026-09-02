---
id: gap-periodic-push-backup-ac2-divergent-reject
title: periodic-push-backup.test.mjs AC2 control 断言失败——divergent push 未被 REJECTED（expected exit 1 不成立）
status: ready
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

`plugin/test/periodic-push-backup.test.mjs` 的「AC2 control: a divergent push is REJECTED (exit 1) and the bare repo is never overwritten」断言失败（1.6s，`expected:1` 不成立）。pre-existing 历史 1 次（本轮 runner-grouping-flaky fan-in 撞第 2 次）。

该 AC2 是负控制：构造一个 divergent（非 fast-forward）push，断言被 REJECTED（exit 1）且 bare repo 未被覆盖。`expected:1` 不成立 ⇒ push 未被拒绝（exit 0）或 bare repo 被覆盖了。**嫌疑**：git 版本/行为的 push 拒绝语义变化、或测试的 divergent 构造不再产生真 divergent（push 被误接受）、或 bare repo 的 receive.denyNonFastForwards 配置未生效。

## Plan

1. 排查 AC2 失败的具体断言（push exit code 或 bare ref 是否被改）。
2. 判定根因：git push 拒绝语义变化 vs 测试 divergent 构造失效 vs bare repo denyNonFastForwards 配置缺失。
3. 修：同步测试到 git 实际行为，或补 bare repo 拒绝配置。

## Acceptance Criteria

- [ ] AC1（能取假）：真 divergent push 被 REJECTED（exit 1）且 bare repo 未被覆盖——断言成立；（⛔ 仍被接受 ⇒ 假）。
- [ ] AC2（能取假，无回归）：AC1/AC2 正路径（合法 push lands + 幂等）仍绿，只修负控制；（⛔ 正路径回归 ⇒ 假）。

## Definition of Done

AC2 负控制断言与 git 实际 push 拒绝语义一致；AC1/AC2 勾；periodic-push-backup 稳定绿；合法 push 正路径不回归；全量 suite 绿。

## Touches

- plugin/test/periodic-push-backup.test.mjs（AC2 负控制断言同步 / bare repo 拒绝配置）
- tasks/gap-periodic-push-backup-ac2-divergent-reject.md（自身）
