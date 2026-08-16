---
id: gap-bypass-ruled-table-self-entry
title: "bypass-ruled 表自条目：8dfd2967 入 RULED_HISTORICAL_COMMITS——ruling-add 提交自身豁免（自指死锁解）"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：AC1b develop 基线轮 unblock 链中，inner 为 unblock 直提 develop 两次（f70507b6 checker 数据基线 + 8dfd2967 ruled 表条目）——manager 裁 f70507b6 放行（不 revert），8dfd2967（把 f70507b6 加入 ruled 表）是 ruling-add 提交，本身也是直接提交 ⇒ bypass check RED。

**自指死锁**：给 8dfd2967 加 ruled = 又一个直接提交（改 checker）⇒ 无限循环。revert 也会产生新直接提交（无 revert 豁免）。

**解**：把 8dfd2967 加入 RULED_HISTORICAL_COMMITS 表，**经 fan-in 正规 land**——fan-in 的 lock-window 豁免本任务提交，8dfd2967 入表后 ruled ⇒ bypass check PASS。f70507b6 已在表中（8dfd2967 加的）。

**教训**：inner 直提 develop 是错的（应走 fan-in）——两条 ruled reason 均已写明，本任务承载「把 ruling-add 也记进表」的机制收口。

## Acceptance Criteria

- [x] AC1: `RULED_HISTORICAL_COMMITS` 表含 8dfd2967（reason 含「ruling-add 提交自身豁免，解自指死锁」+ inner 直提教训）。— worktree 实测：ruled-historical=5（含 8dfd2967）
- [x] AC2: bypass check（`--baseline b11ce720...`）对 develop PASS——worktree 实测 `ok=true (ac65-authorized-or-ruled-historical-only)`，f70507b6 + 8dfd2967 均 ruled。
- [ ] AC3: 经 fan-in 正规 land（lock-window 豁免本任务提交）。（待外部）

## Definition of Done

- [ ] bypass check PASS，AC1b develop 基线轮可重跑（fan-in 后 develop 上验证 + AC1b 轮重跑）。（待外部）

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（RULED_HISTORICAL_COMMITS 加 8dfd2967）
- tasks/gap-bypass-ruled-table-self-entry.md（自身）
