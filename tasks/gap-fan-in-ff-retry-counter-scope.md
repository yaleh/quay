---
id: gap-fan-in-ff-retry-counter-scope
title: fan-in ff retry 计数器作用域 bug——grep -c 全历史累计，跨 dispatch 不隔离（任务提前锁死）
status: done
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

`fan-in-ff-merge.sh:344` 的 `prior_failures="$(grep -c "\"taskId\":\"${task_id}\"" "${retry_record}")"` 是**全文件累计**（跨所有历史 dispatch，从不重置/裁剪），而 `fan-in-execute.js:136` 的 `maxFfRetries=3` 是**每次全新 dispatch（新 runId）从 0 开始**的预算——两个计数器语义不匹配。

**实证**（`gap-fan-in-materialize-check-false-positive-non-bootstrap`，`.quay/fan-in-retries.jsonl` + `fan-in-ff-escalations.jsonl`）：
```
attempt1 runId=u5jgg9 17:28:56Z   attempt2 runId=u5jgg9 17:41:37Z   ← 同一 dispatch 内部两次重试
attempt3 runId=22atfr 18:11:02Z   ← 全新 dispatch（新 runId，隔 30min），却是它【第一次】真实尝试
                                      ——直接被历史累计判成第 3 次，escalate
```
`grep -rn 'fan-in-retries.jsonl' plugin/` 确认全仓库无代码在成功落地/重新 dispatch 时清理或裁剪该文件（纯 append-only）。

⇒ 历史上失败过 2 次的任务，在任何后续全新 dispatch 里会在还没跑到自己该有的 3 次预算前就被提前锁死。**这是比 quiet-window 消费者更靠前的一层**——先修它，quiet-window 消费者才是第二层。

## Plan

计数器按 runId/dispatch 隔离——（a）`prior_failures` 只数当前 runId 的失败（非全历史），或（b）成功落地/新 dispatch 时裁剪该任务的历史记录。

## Acceptance Criteria

- [x] AC1（能取假，per-dispatch 隔离）：全新 dispatch 不继承历史失败次数（attempt 从 0 起）；（⛔ 全新 dispatch 仍被历史累计判成第 N 次 ⇒ 假）。
- [x] AC2（能取假，预算足额）：每个 dispatch 能跑满自己的 3 次预算（不被历史提前锁死）；（⛔ 历史失败 2 次的任务在新 dispatch 第 1 次就被锁 ⇒ 假）。

## Definition of Done

计数器按 runId 隔离（各 dispatch 失败计数从 0 起）；AC1-2 全勾；历史失败不再跨 dispatch 累计。

## Touches

- plugin/scripts/fan-in-ff-merge.sh（:344 prior_failures 计数）
- plugin/scripts/fan-in-execute.js（maxFfRetries 语义对齐）
- plugin/test/fan-in-ff-merge.test.mjs（对应测试）
- tasks/gap-fan-in-ff-retry-counter-scope.md（自身）