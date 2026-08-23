---
id: gap-worker-driver-no-record-on-abnormal-death
title: worker-driver worker 异常死亡零终态记录（computeOutcome 只正常返回时调用，异常路径与未派发同形）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 分析 reflog-to-revlist 停摆（第三种形态，⛔ 与 fake-completion、死锁 worktree 都不同）。

**三种形态区分（⛔ 别混成一类修）**：
```
① fake-completion（已立案 gap-worker-driver-fake-completion-exit-0）
   driver 写了 completed ⇒ 任务对 driver 永久隐形，永不重派
② 早前 3 条死锁 worktree（已全部 inner 手动 re-trigger land）
   worker 完成实现但没 fan-in
③ 本 gap：reflog-to-revlist —— driver【零 outcome 记录】
   worker 死于 suite 失败后，driver 也没记它死过 ⇒ 既不算完成也不占 in_flight，
   但任务停在 ready 且 worktree 残留
```

**根因（③）**：`computeOutcome` 只在 worker **正常返回**时被调用；worker 异常死亡（被杀 / suite 失败后自尽）**不写任何终态记录** ⇒ 载体上与「从未派发」**完全同形**（硬规则 3b：异常路径与未发生共用「无记录」这个表示）。触发是 tmux-leak-scan flake（`FAIL 残留 test tmux server`，测试本身 fail 0、非任务代码因），但**修 flake 修不掉「无记录」**——flake 是触发原因，无记录是机制缺口，两者要分开记。

**影响（③ 与 ① 的本质区别）**：① 是「记错了」⇒ 永久隐形；③ 是「没记」⇒ 任务停在 ready、worktree 残留，driver 无记录可判，但**槽位空出后 driver 理论上会重新看到它**（不隐形）。当前没被重派只因 in_flight=2=cap 满，非隐形。

**区分原则（⛔ 第四种形态时直接查载体，manager 2026-08-23）**：① 与 ③ 表象同形（任务都停着没动），区分靠的不是「想得更细」而是「去读载体里到底有没有那条记录」——① 有 `completed` 记录、③ 零记录。将来出现第四种形态，先查 `worker-outcome.jsonl` 的记录**有无/取值**，比按表象归类快。

## Plan

1. worker 异常死亡（exit non-zero / signal / kill）也写 outcome 记录，`final_state ∈ {failed, killed, timed-out}`（⛔ 不是 completed）。
2. `computeOutcome` 之外加「worker 死亡兜底」记录路径（spawn 的 close/exit 事件写终态）。

## Acceptance Criteria

- [ ] AC1：worker 非正常退出（含被杀 / suite 失败后自尽）⇒ `worker-outcome.jsonl` 有对应记录且 `final_state ∉ {completed}`；零记录 ⇒ 假。

## Definition of Done

- [ ] worker 异常死亡写终态记录 + 生产验证零记录消失；AC1 全勾；land 到 develop。

## Retires

- 无

## Touches

- plugin/scripts/worker-driver.ts（worker 死亡兜底记录）
- plugin/test/worker-driver.test.mjs（test）
- tasks/gap-worker-driver-no-record-on-abnormal-death.md（自身）
