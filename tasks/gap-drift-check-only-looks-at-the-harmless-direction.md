---
id: gap-drift-check-only-looks-at-the-harmless-direction
title: "The status-drift check scans todo/ready only — it can see a task that should be closed, never one that was closed without the work"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

外层核实自己 `goals-and-ac.md` 的 AC2 时发现：**漂移检查只查一个方向，而危险的是它没查的那个。**

### 实测

```
$ node --experimental-strip-types plugin/scripts/task-status-drift-check.ts
task-status-drift: 6 SUSPECT task(s) with code already in the tree but status not closed
  (636 todo/ready scanned)
```

**它只扫 `todo`/`ready`**，判据是「代码已在树里但状态没关」。

**外层那个活标本它报不出来**：`gap-no-e2e-proves-install-is-configuration-driven`
一度是 **`status: done`、8 条 AC 全未勾、分支未合入 master、worktree 已被移除**——
**工作只存在于一个孤立分支上**（外层 01:32Z 实测，随后已恢复）。

### 两个方向的性质完全不同

| 方向 | 形状 | 性质 | 当前是否被查 |
|---|---|---|---|
| 状态**过于开放** | 代码在树里，任务仍 `todo`/`ready` | **良性**——该关未关，最多是记账滞后 | **是** |
| 状态**过于关闭** | 任务 `done`，而 AC 未勾 / 工作不在树里 | **这是伪造完成的形状** | **否** |

**⇒ 检查的名字覆盖「状态漂移」这个类，实现只覆盖了良性的那半。**
本仓今晚已记过多次同形（规则名覆盖类、实现覆盖标本），**这次落在方向上**。

### 为什么它是门槛相关的（外层的排序论证）

管理者 01:05Z 裁定「只做门槛相关的」。**外层判断本条属于门槛相关，理由如下**：

**G4 是「通过闸端到端完成至少一个任务」。**
`gap-both-gates-read-one-signal-so-done-costs-nothing` 已修好**闸本身**
（外层 01:55Z 自造夹具实测：AC 全勾 + DoD 未勾 ⇒ `execute-done` `ok:false`）。
**但闸修好不等于 `done` 可信**——**状态可以被直接写入，根本不经过闸**。

**⇒ 今天没有任何东西能验证一个 `done` 任务确实过了闸。**
**⇒ G4 的证据在原则上不可核实**，与闸修得多好无关。

**这与 #1 是同一件事的两半**：#1 修「闸太松」，本条修「闸可被绕过」。

## Contract

```
measure closed_without_work = `node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --closed-direction --json | jq length` 报出的「已关而无实」任务数字段
measure specimen_reported = `node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --json | grep -c '<fixture-id>'` 已知活标本是否被报出的计数字段
band specimen_reported = true
invariant 漂移检查必须双向；危险方向是「已关而无实」，不是「该关未关」
invoke `node --experimental-strip-types plugin/scripts/task-status-drift-check.ts`
control 造一个 done 但 AC 未勾/工作不在树里的任务 ⇒ 必须报出；一个 done 且证据齐全的 ⇒ 必须不报
resume 先让检查扫 done，再谈判据细化
```

## Chosen mechanism

1. **扫描面扩到 `done`**——当前只扫 `todo`/`ready`（**636 个**），`done` 从不被扫。
2. **「已关而无实」的判据**（择一或组合，写明理由）：
   - AC 复选框 **0 勾**而状态为 `done`；
   - `## Touches` 里的文件**在 master 上不存在**或**无相关提交**；
   - 任务对应分支**未合入**且内容不在 `master`。
3. **活标本验证**：上线时**必须报出**今晚那个标本的历史状态
   （可用固定夹具复现，不依赖它当时的现场）。
4. **不与 #1 合并**：#1 修闸的判据，本条修「绕过闸」的可见性——
   **两者都不做，`done` 仍不可信**。

**不做**：不把 `done` 任务改成不可写（**状态由人/内层写是设计**，本条只要求**可见**）；
不用「报出即失败」阻断流程（**先可见，再谈是否阻断**——
本仓已裁定过同样的顺序：`heavy-op-token.sh:61` 的「先让饥饿可观测，策略决定往后放」）。

## Acceptance Criteria

- [ ] AC1: 扫描面覆盖 `done`——扫描计数从「636 todo/ready」变为含 `done` 的全量（实跑贴出）
- [ ] AC2: **活标本验证**——夹具复现「`done` + AC 0 勾 + Touches 文件不在树里」⇒ **必须报出**（实跑贴出）
- [ ] AC3: **反向负控制**——`done` 且证据齐全的任务 ⇒ **必须不报**（实跑贴出）。
      **这条不过，AC2 不算数**——**把「看不见」修成「全都报」等于换一种方式看不见**
- [ ] AC4: **既有方向不退化**——原「该关未关」的 6 个 suspect 仍被报出（改动前后对照贴出）
- [ ] AC5: **报告可行动**——每条报出的记录说明**缺的是哪一项**（AC 未勾 / 文件不在树 / 分支未合），
      不是只给一个任务名
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC2 与 AC3 两个方向的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录：**闸修好不等于 `done` 可信**——
      **状态可以被直接写入，根本不经过闸**；
      **G4 的证据在原则上不可核实，与闸修得多好无关**

## Touches

- plugin/scripts/task-status-drift-check.ts
- plugin/test/task-status-drift-check.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-04T02:00:00Z
changed: 外层在核实**自己** `goals-and-ac.md` 的 AC2 时发现本条——
**我预期漂移检查能报出今晚那个活标本，实测它报不出**，因为它只扫 `todo`/`ready`。
**两个方向性质不同**：「该关未关」是**良性**的记账滞后；
**「已关而无实」是伪造完成的形状**——**而被查的恰恰是良性的那半**。
**排序论证（外层判断本条属门槛相关，尽管它不在十条清单里）**：
G4 是「通过闸端到端完成至少一个任务」；#1 已把**闸本身**修好
（外层 01:55Z 自造夹具实测 `execute-done` 在 AC 全勾 + DoD 未勾时 `ok:false`），
**但闸修好不等于 `done` 可信——状态可被直接写入、根本不经过闸**
⇒ **今天没有任何东西能验证一个 `done` 确实过了闸** ⇒ **G4 的证据在原则上不可核实**。
**⇒ 本条与 #1 是同一件事的两半**：一个修「闸太松」，一个修「闸可被绕过」。
**AC3 是真判据**：把「看不见」修成「全都报」等于换一种方式看不见。
**并按本仓已有的顺序裁定**（`heavy-op-token.sh:61`「先让饥饿可观测，策略决定往后放」）
明确本条**只要求可见，不要求阻断**——先有信号，再谈是否用它拦人。
