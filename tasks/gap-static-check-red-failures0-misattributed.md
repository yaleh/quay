---
id: gap-static-check-red-failures0-misattributed
title: 静态闸红时 failures[0] 指向非阻断检查器（--no-block）而非真 exit≠0 的 gate——诊断者会先修不该修的地方（round181/182 实证，manager ③ 对照定案）
status: todo
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

> **止损（2026-08-15 04:2xZ，manager 对照定案后「值得单独立案」——立案归我）：需要 —— 当下动作 = 本任务立案**。round181/182 实证：`reason=static-check` 时 `failures[0]` 是 task-contract-check 的 VIOLATION 样式行（该检查器 `--no-block` **不阻断**），而真 exit≠0 的是 `direct-to-develop-bypass-check`。**manager 假说（failures[0] 捕第一条 VIOLATION 样式行，真 exit 非 0 是另一 checker）被 round182 生产轮证实**——由解释变结论。**真缺陷**：红了但失败详情指向不阻断的东西，会让每个诊断者先去修一个不该修的地方（manager 今晚就差点去修 gap-ac37）。

**判据（manager 给，现成）**：`reason=static-check` 时，`failures[0]` **必须来自那个真正 exit≠0 的 checker**，而不是流里第一条 VIOLATION 样式行。

**根因链（round181→182）**：
```
round181 红 failures[0]=gap-ac37 contract-line（task-contract-check --no-block exit 0 不阻断）
        真 gate = direct-to-develop-bypass-check exit=1（30 条真实直接提交）
round182 红 failures[0]=gap-ac37 dispatch-review（eb7b04f5 消 contract-line 后）
        真 gate 仍 = direct-to-develop-bypass-check exit=1
⇒ failures[0] 恒指向流里第一条 VIOLATION 样式行（非阻断检查器），真 gate 的 identity 在 failures[] 里淹没
```

**影响**：任何依赖 failures[0] 分诊红窗的人（manager/outer/inner）都会先去修一个不阻断的检查器报的东西——白费轮次（今晚 gap-ac37 已花一轮）。正确分诊需要读 STATIC_CHECK_FAILED 行（真 gate），而 failures[0] 误导。

## Plan

1. inner 读 full-suite-runner.ts 的 failures[] 构建（STATIC_CHECK_FAILED 与 VIOLATION 行如何进 failures[]）+ 排序逻辑。
2. 修法（供 inner 选）：failures[] 中 STATIC_CHECK_FAILED 行（真 gate）排到 VIOLATION 行前；或 failures[0] 优先取真 exit≠0 的 checker 名。
3. 能取假：round181/182 场景回放——`reason=static-check` 时 failures[0] 必须是 direct-to-develop-bypass-check（真 gate），不是 contract-line VIOLATION。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 `reason=static-check` 时 failures[0] 来自真 exit≠0 的 checker（非流里第一条 VIOLATION 样式行）——manager 判据。
- [ ] AC2 能取假·真样本：round181/182 回放——failures[0] 必须 = direct-to-develop-bypass-check（真 gate），非 contract-line VIOLATION。
- [ ] AC3 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] failures[0] 在 static-check 红时指向真 gate（exit≠0 的 checker），诊断者不再被误导去修非阻断检查器的 VIOLATION。

## Touches

- plugin/scripts/full-suite-runner.ts（failures[] 排序/构建——inner 实现面）
- plugin/test/（对应测试：真 gate 排在 failures[0]）
- tasks/gap-static-check-red-failures0-misattributed.md（自身）

## Evidence

（待落地后填：round181/182 回放 failures[0]=真 gate、测试绿、scoped 门绿）

## 止损

**需要 —— 当下动作 = 本任务立案**：round181/182 两轮红都因 failures[0] 指向非阻断检查器而误导分诊（gap-ac37 白花一轮）。manager ③ 对照定案后判据现成（failures[0] 须来自真 exit≠0 checker），立案即止损线。
