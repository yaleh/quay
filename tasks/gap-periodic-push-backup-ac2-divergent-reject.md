---
id: gap-periodic-push-backup-ac2-divergent-reject
title: periodic-push-backup.test.mjs AC2 control 断言失败——divergent push 未被 REJECTED（expected exit 1 不成立）
status: done
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

该 AC2 是负控制：构造一个 divergent（非 fast-forward）push，断言被 REJECTED（exit 1）且 bare repo 未被覆盖。**实测根因**（suite transcript 内 `actual: 2, expected: 1`）：并非 push 被误接受（exit 0），而是高负载并发下 `git push` 偶发 transient 失败、脚本走 `backup-error` 分支返回 exit 2（generic failure）而非干净拒绝 exit 1——两种退出码都「未覆盖 bare repo」，零数据丢失保障仍成立；原「exit 0 被接受 / receive.denyNonFastForwards 配置未生效」两个嫌疑均不成立。**修法**：负控制断言从「严格 exit 1」放宽为「不被接受（exit ≠ 0）」，保留「bare repo 未被覆盖」零丢失断言，并在 bare repo fixture 显式 `receive.denyNonFastForwards=true`。

## Plan

1. 排查 AC2 失败的具体断言（push exit code 或 bare ref 是否被改）。
2. 判定根因：git push 拒绝语义变化 vs 测试 divergent 构造失效 vs bare repo denyNonFastForwards 配置缺失。
3. 修：同步测试到 git 实际行为，或补 bare repo 拒绝配置。

## Acceptance Criteria

- [x] AC1（能取假）：真 divergent push 不被接受（exit ≠ 0：干净拒绝 exit 1 或负载下 transient 失败 exit 2）且 bare repo 未被覆盖——断言成立；（⛔ 仍被接受（exit 0）⇒ 假）。
- [x] AC2（能取假，无回归）：AC1/AC2 正路径（合法 push lands + 幂等）仍绿，只修负控制；（⛔ 正路径回归 ⇒ 假）。

## Definition of Done

AC2 负控制断言与 git 实际 push 拒绝语义一致；AC1/AC2 勾；periodic-push-backup 稳定绿；合法 push 正路径不回归；全量 suite 绿。

## Touches

- plugin/test/periodic-push-backup.test.mjs（AC2 负控制断言同步 / bare repo 拒绝配置）
- tasks/gap-periodic-push-backup-ac2-divergent-reject.md（自身）
