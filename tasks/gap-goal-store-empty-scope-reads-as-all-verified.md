---
id: gap-goal-store-empty-scope-reads-as-all-verified
title: goal-store 的 I5/I3 空作用域输出与「全部复验通过」同形——58 条判据一条没跑却报 evaluated:true
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra: {}
goal_ac: AC-180
---
## Proposal

**实测（2026-09-09，生产载体 round 788）**：`goal-driver` 每轮写进 `.quay/goal-round.jsonl` 的是
`achievedFailing: {"achievedButFailing": [], "evaluated": true}` —— 而当前 active goal = 0，
全仓 58 条 criterion 全部挂在 achieved goal 下 ⇒ **I5 的作用域是空的，一条都没跑**。
即：**空作用域的输出与「58 条判据全部复验通过」完全同形**（硬规则 3b）。

`packages/quay/src/goal-store.ts:497-502` 注释逐字：「Produced ONLY by RUNNING the criterion —
never a stored field. **Scope: achieved ACs under ACTIVE goals (the same scope as checkStaleness)**」。
同一函数**对递归那一支专门做了** `evaluated: false`，并逐字引了硬规则 3b
「⛔ not an empty array masquerading as "no achieved-but-failing AC"」——
**递归那支想到了，空作用域这支漏了，而空作用域正是当前生产状态。**

`checkStaleness` 共用同一 scope ⇒ 同族缺陷，必须一并修（硬规则 5b：修好一个 ≠ 只在一处）。

## Plan

1. 给 `checkAchievedFailing` 与 `checkStaleness` 的返回增加**作用域规模**这一独立取值
   （如 `scopeSize` + `evaluated:false`），⛔ 空作用域不得与「全部通过」共用输出形态。
2. `goal-driver.ts` 的 `achievedFailing` / `staleness` 读数透传该取值，使 round Fact 可机械区分
   「查过且全过」与「没有可查对象」。
3. 负控制两向：0 个 active goal ⇒ 必须报未评估；1 个 active goal 且其下有 achieved AC ⇒
   必须真跑判据且报评估过、条数 > 0。

## Acceptance Criteria

- [x] AC1 active goal = 0 时 `check --achieved-failing` 的输出可与「有作用域且全过」按**字段**区分（非文案差异）
- [x] AC2 `check --staleness` 同上
- [x] AC3 `.quay/goal-round.jsonl` 的新轮次记录里该区分可被机械读出
- [x] AC4 负控制：置 1 个 active goal 且其下有 achieved AC ⇒ 报「评估过」且作用域规模 > 0
- [ ] AC5 `scripts/test.sh` 全量绿（待外部）

## Definition of Done

AC1–AC5 全绿，且在**生产载体**上读到一条新轮次记录、其空作用域取值与达成态可区分
（⛔ 判据落生产载体不落 fixture——硬规则 4 推论三：只能被 fixture 满足的判据不是测量）。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/test/goal-store.test.mjs
- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver.test.mjs
- tasks/gap-goal-store-empty-scope-reads-as-all-verified.md