---
id: gap-static-check-red-failures0-misattributed
title: 静态闸红时 failures[0] 指向非阻断检查器（--no-block）而非真 exit≠0 的 gate——诊断者会先修不该修的地方（round181/182 实证，manager ③ 对照定案）
status: done
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

- [x] AC1 `reason=static-check` 时 failures[0] 来自真 exit≠0 的 checker（非流里第一条 VIOLATION 样式行）——manager 判据。
- [x] AC2 能取假·真样本：round181/182 回放——failures[0] 必须 = direct-to-develop-bypass-check（真 gate），非 contract-line VIOLATION。
- [x] AC3 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] failures[0] 在 static-check 红时指向真 gate（exit≠0 的 checker），诊断者不再被误导去修非阻断检查器的 VIOLATION。

## Touches

- plugin/scripts/full-suite-runner.ts（failures[] 排序/构建——inner 实现面）
- plugin/test/full-suite-runner.test.mjs（对应测试：真 gate 排在 failures[0]；round181/182 回放 fixture）
- tasks/gap-static-check-red-failures0-misattributed.md（自身）

## Evidence

**实现（`plugin/scripts/full-suite-runner.ts` `buildStaticCheckFailures`）**：fail-closed checkers（真 gate，exit≠0）排到 VIOLATION 行之前——`failures[0]` = 真 gate 的 identity。两处调用点（early-red 写 `:3096` 与 terminal 写 `:3322`）共用同一函数，一致生效。`classifyFailure` 按 `staticCheck` marker 路由（顺序无关），下游无依赖旧 VIOLATION-first 排序的消费者。

**AC2 能取假·真样本（round181/182 回放 fixture，`full-suite-runner.test.mjs`）**：fake suite 先打 `VIOLATION: tasks/gap-ac37.md — contract-line: …`（task-contract --no-block exit 0，非阻断），再打 `STATIC_CHECK_FAILED: direct-to-develop-bypass-check exit=1`（真 gate）。实测 `failures[0].line === "STATIC_CHECK_FAILED: direct-to-develop-bypass-check exit=1"`，且 round record 的 failures[0] 同样为真 gate（非 contract-line VIOLATION）。

**测试**：
- `node --test plugin/test/full-suite-runner.test.mjs` → 147 pass / 0 fail（含新 unit + round181/182 回放）。
- `node --test plugin/test/direct-to-develop-bypass-check.test.mjs` → 14 pass / 0 fail（真 gate checker 不受影响）。
- `bash scripts/test.sh --for-task gap-static-check-red-failures0-misattributed` → **exit 0**；scoped static checks 全 PASS（test-framework-policy / test-isolation / tmp-leak-pairing / test-impl-census / task-contract --no-block / malformed-task / superseded-capability / concurrency-literal / landing-target / delivery-inventory-drift）；selector 解析 Touches 只选中 `plugin/test/full-suite-runner.test.mjs`；build_dist_once 正常完成（未触发 worktree 约束）。

**主 checkout 实况佐证**（2026-08-15 05:15Z static-check 红轮，修前形态）：`failures[0]` 是 `VIOLATION: tasks/gap-ac37-exec-core-ships-with-package.md — dispatch-review-missing`（非阻断），而真 gate `STATIC_CHECK_FAILED: fan-in-workflow-check exit=1` 排在最末——正是本任务修的形状；修后该形态下 failures[0] 会指向 `fan-in-workflow-check`。

## 止损

**需要 —— 当下动作 = 本任务立案**：round181/182 两轮红都因 failures[0] 指向非阻断检查器而误导分诊（gap-ac37 白花一轮）。manager ③ 对照定案后判据现成（failures[0] 须来自真 exit≠0 checker），立案即止损线。
