---
id: gap-ownership-active-code-comment-decision-leak
title: "holdout leaks through source comments: packages/quay/src carries
  GOAL-034's ownership rationale in code comments (e.g. gate/config/types.ts:4
  \"moved OUT … (GOAL-034): they are not config-loading\"), reachable by the
  investigator's read_file/grep despite the path deny-list — add a shared
  decision-reference redactor"
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

## Finding

<!-- dedup-ref -->
`gap-ownership-active-investigator-holdout-deny-list`(done)按**路径**关闭了 holdout 答案面(`goals/`、`tasks/`、`docs/architecture/` 等)。但按位置核实(2026-10-11,develop `add3e7318`),**源码注释本身**承载了历史裁定的理由,路径 deny-list 管不到:

- `git grep -n "GOAL-034\|AC-35[345]" add3e7318 -- packages/quay/src` ⇒ **5 行**,其中 `packages/quay/src/gate/config/types.ts:4`:"`GateConfig` / `RunnerOptions` moved OUT of this file (GOAL-034): they are not config-loading…"——这正是 GOAL-034 的 ownership 判断(什么算 config 加载),也是 2026-10-11 盲测反复收敛到的 `gate/config → gate` 宽移动所需的那条答案;另 4 行在 `gate/factories/utils.ts:1,3`、`kernel/gate-run-options.ts:5,21`。
- 同一树上 `GOAL-03[0-9]` 注释引用共 18 处(含 GOAL-033/AC-350 等),`AC-3xx` 若干——都是"历史决策理由写进代码"的同一形状。
- 投研器的 `read_file` / `grep`(`docs/analysis/ownership-active-executor.mjs` `createExecutor` 约第 108-130 行)按路径过滤,**不检查内容**。
- **暴露读数(查历史)**:生产 carrier 94 条 + 两个隔离 carrier,投研器对上述三个文件发生过 **7 次** read_file / grep 命中行(含 0.1.40 生产轮 `live:2026-10-11T10-24-36-709Z:3`)。存档的 `text_head`(截断 1500 字符)里没有出现 GOAL-034 字样——**但 text_head 不是全文**,judge 实际收到的证据比存档长,所以"没泄露"**无法从记录证明**(硬规则 5:来源不完备)。修法的价值在于让它结构上不可能,而不是事后证明。

## AC

- [ ] AC1 `docs/analysis/ownership-active-contract.mjs` 导出一个纯函数 `redactDecisionReferences(text)`:把**包含决策标识**(`GOAL-\d+`、`AC-\d+`、`DIR-\d+`、`ADR-\d+`、`SPEC-[\w-]+`、`gap-[a-z0-9-]{6,}` 任务 id)的**整段连续注释块**(`//` 连续行、`/* … */`、`*` 续行)替换为 `// [redacted: decision reference]`,代码行不动;返回 `{ text, redacted_blocks }`。
- [ ] AC2 executor 的 `read_file` 与 `grep` 输出都经过该函数(grep 对命中行所在文件做同样处理:命中行若位于被 redact 的注释块内则整行替换);证据记录新增 `redacted_blocks` 计数;`text_sha256` 仍按**实际交给 judge 的文本**计算。
- [ ] AC3 负对照(真实文件):对 `packages/quay/src/gate/config/types.ts` 在 `add3e7318` 的 `read_file`(第 1-20 行)返回文本中**不含** `GOAL-034`、`not config-loading`;对 pattern `GateConfig` 作用域 `packages/quay/src/gate` 的 grep 返回行中不含任何 `GOAL-0` 字样。
- [ ] AC4 正对照(不误伤代码):同一文件的 `export`/`import` 代码行原样保留;`packages/quay/src/kernel/task-transition.ts` 中不含决策标识的头注释(例如 kernel 边界规则说明)原样保留;`declaredExportNames` 等对源码的机械解析结果不变(redaction 只作用于交给 judge 的证据文本,不作用于存在性/导出解析)。
- [ ] AC5 既有回归全绿(`plugin/test/ownership-active-loop.test.mjs` 等);准入门限/streak=3/fail-closed/只写 draft 不触碰;`bash scripts/test.sh --for-task gap-ownership-active-code-comment-decision-leak` exit 0。

## DoD

投研器看到的源码证据中,引用历史决策的注释块被机械 redact 并计数;真实 GOAL-034 注释的负对照与代码行/普通注释的正对照均有测试。⛔ 不改源码注释本身(那是代码作者的文档,不是本机制的事),不改任何准入门限,不创建/激活任何 Goal。

## Touches

- docs/analysis/ownership-active-contract.mjs
- docs/analysis/ownership-active-executor.mjs
- plugin/test/ownership-active-loop.test.mjs
- tasks/gap-ownership-active-code-comment-decision-leak.md
