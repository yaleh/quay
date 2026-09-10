---
id: gap-activation-gates-bypassed-on-reopen-path-non-draft-to-active
title: 三道激活闸只认 draft→active，重开路径（achieved→active / needs-human→active，实测占激活总数
  19%）全部绕过——含 --force 留痕分支，故重开时的 --force 是静默越权
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`packages/quay/src/goal-store.ts:762`：

```ts
const activating = nextStatus === "active" && prevStatus === "draft";
```

**三道闸全部以它为条件**（按位置实测）：

```
:840  if (activating && !isGoalRecord && !force)   P6  可评估性闸（criterion 跑得动吗）
:867  if (activating && !isGoalRecord && !force)   P6b 保真性闸（criterion 测得着吗，GOAL-013）
:890  if (activating && !isGoalRecord && force)    P6c --force 越权留痕
```

⇒ **任何「非 draft → active」的转换，三道闸一道都不触发。**

### 发生率（硬规则 12：查历史，不等下一轮）

全历史 statusLog 枚举：

```
achieved    → active   2 次   GOAL-009 (2026-09-09, goal-cli) / AC-230 (2026-09-10, cli:human-ruling)
needs-human → active   3 次   AC-217 / AC-218 / AC-219 (均 2026-09-09)
                       ────
合计重开           5 次   对照 draft→active 21 次  ⇒ 约 19% 的激活走未设闸的路径
```

**`needs-human → active` 是其中的多数（3/5）**——它是常规流程（人裁定后重新激活），不是罕见路径。

### 活体证据（⛔ 非推断）

2026-09-10 的 AC-230 重开：**同一次写入既改了 `criterion` 又把状态翻 active**，而 `fidelity` 字段为 `null`、可评估性闸也未运行。⇒ 一条**刚被改写的判据**在没有任何机制检查的情况下进入了 active。当时的三向读数（当前 exit 1 / 谓词可命中 / 命题成立时转绿）是**人手动取的，不是机制取的**——机制在这条路径上什么都没做。

### 第三个后果：重开时的 `--force` 是静默越权

`:890` 的 force 留痕分支同样要求 `activating` ⇒ `goal-store write <id> --status active --force` 从 `achieved`/`needs-human` 出发时**不写** `fidelity: {verdict:"forced"}`。⇒ **P6c 专为防止的那件事（静默越权）在重开路径上原样成立。**

### 为什么这条路径的流量会增长

人 2026-09-10 裁定：「在某一时刻判断 goal archive 后，又发现进一步问题要求修改和重开该 goal 是诚实的行为，我们也需要这一行为模式持续优化系统。」⇒ 重开被确立为**常态行为模式**。

**⚠️ 而重开恰恰是判据质量最需要被检查的时刻**——重开的原因通常就是「判据或命题出了问题」（AC-230 正是：原判据断言了自己 expect 的反面）。**现状是：最该检查的那一刻，一道闸都没有。**

## Plan

1. 把判据改为「**任何进入 active 的转换**」，⛔ 但保留 create-as-active 不设闸的既有设计意图（`:756-761` 已记录理由：新记录的 criterion 由 create 完整性契约验证）：

   ```ts
   const activating = nextStatus === "active" && prevStatus !== undefined && prevStatus !== "active";
   ```
   - `prevStatus === undefined`（create）⇒ 不设闸（**语义逐字不变**）
   - `draft → active` ⇒ 照旧设闸
   - `achieved / needs-human / superseded / retired → active` ⇒ **新增设闸**
   - `active → active`（无状态变化）⇒ 不设闸（本就不是激活）
2. **确认不造成阻塞**：P6 要求的是「**可评估**」而非「通过」——`exit ≠ 0` 属确定性判决 ⇒ 判据当前为红的 AC 仍可被重开（这正是重开的典型场景）。落地前贴出对照读数验证这一点。
3. `--force` 逃逸保留，但**重开时也必须留痕**（P6c 同步放宽条件）。

## Acceptance Criteria

- [x] AC1（重开触发可评估性闸，双向能取假）：对一条已 `achieved` 的 AC 做 `achieved→active`——criterion 为空/不可 spawn ⇒ **拒绝激活且不写状态**；criterion 可评估（**含 `exit ≠ 0`**）⇒ **放行**。两个方向各贴一次**真实 CLI** 读数（⛔ 非纯 import 单测）。
- [x] AC2（重开触发保真性闸，**两条来源路径各测一次**）：配置判定器后，`achieved→active` 与 **`needs-human→active`** 两条路径上激活的记录都必须留 `fidelity.verdict`；⛔ 字段缺失不算通过。**⛔ 不得只测 `achieved` 那条**——历史上 `needs-human` 占 3/5。
- [x] AC3（force 留痕不再被绕过）：`--force` 做重开 ⇒ 记录留 `fidelity.verdict === "forced"`。**改动前实测该分支在重开路径上不触发**（静默越权）——贴出改动前后对照。
- [x] AC4（⛔ 不误伤 create-as-active）：创建即 `active`（`prevStatus === undefined`）仍**不过闸**，保留 `:756-761` 记录的设计意图；贴出对照读数。
- [x] AC5（⛔ 不误伤既有 draft→active）：既有 21 条历史所走的形态照常放行——贴一条真实 `draft→active` 的对照读数。
- [x] AC6：全量 `scripts/test.sh` 绿。

## Definition of Done

三道闸（可评估性 / 保真性 / `--force` 留痕）在**全部**「进入 active」的转换上生效，**create-as-active 除外**；`achieved` 与 `needs-human` 两条来源路径**各有实测读数**；判据当前为红的 AC 仍可被重开（⛔ 修法不得把重开变成不可能——那会与人 2026-09-10 确立的行为模式冲突）；全量 `scripts/test.sh` 绿。

⛔ 完成标志不是「测试都绿」——现有测试此刻全绿，而 19% 的激活正从三道闸旁边走过去。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/test/goal-store.test.mjs
- plugin/test/criterion-fidelity-gate.test.mjs
- tasks/gap-activation-gates-bypassed-on-reopen-path-non-draft-to-active.md