---
id: gap-ls-product-code-behavior-variance-first-reading
title: L_S（行为方差）对产品代码没有活仪器——ADR-007 列的 mutation/property 测试在产品代码上 0 处存在；先在一个高
  churn 的纯判定模块上取第一条读数并入载体（观察项）
status: ready
labels:
  - gap
  - observation
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**这是观察项，不是阻塞项**（硬规则 12）：下面说明为什么「L_S 缺失导致的缺陷」的发生率从历史上取不出来，所以本任务只要求取得第一条读数，不给任何流程加新的前置。

**事实**（2026-10-22 实测）：
- ADR-007 Decision 写 `L_S (stability / behavior variance): mutation / property tests`。原来的 L_S 探针 `git-lens-l-s-behavior-variance.ts` 只剩 `archive/2026-09-07-zero-call-scripts/plugin/scripts/` 下的归档副本，而且跑不起来（它 import 的 `gate-script-base.ts` 没有一起归档 ⇒ `ERR_MODULE_NOT_FOUND`）。
- **产品代码上没有 property/mutation 测试**：`grep -l "fast-check\|stryker\|jsverify\|mutation" package.json packages/*/package.json` ⇒ 0 个文件；`ls node_modules | grep -i "fast-check\|stryker"` ⇒ 空；`grep -rl "from \"fast-check\"" packages plugin` ⇒ 0。测试里出现 "mutation" 的约 154 个文件，抽看前 3 个（`ci-runner-env-prereqs.test.mjs`、`cross-project-dogfood-routine.test.mjs`、`discovery-portfolio.test.mjs`），都是「手工改一下被测对象看测试会不会红」的单点负对照，不是系统化变异读数。
- **活着的 L_S 仪器只覆盖检查器**：`plugin/scripts/checker-mutation-check.ts`（catalog 自述 "the L_S instrument"）每次全量跑时对 87 个已注册检查器做变异，`--list` 报 `uncovered: none`。它变异的是检查器，不是 `packages/` 下的产品代码（其头注释原文：「NOT a mutation test of product code」）。所以准确的说法是：**L_S 对检查器是亮的，对产品代码是暗的**。

**发生率为何取不出来**：历史里没有任何一种记录把缺陷归因到「测试过了、但行为在扰动下不稳」。能数的只有相邻量：`grep -liE '^title:.*(vacuous|恒真|空转|永不变红|never.*red)' tasks/*.md` ⇒ 18 个任务，抽看前 3 个（AC-180 判据恒真、arch-discovery 空转、AC-903 判据空转 spawn），都是检查器或判据层面的问题，正是 checker-mutation-check 已覆盖的那一类；`plugin/scripts/known-flakes.json` 登记 3 条，都是负载导致的时序抖动，不是被测逻辑的行为方差。⇒ 产品代码上「L_S 导致的缺陷」可分类的计数 = 0，**这是「没有载体」，不是「没有缺陷」**（硬规则 5）。

**选哪个模块**：`git log --since=2026-09-22 --format= --name-only -- 'packages/quay/src/**/*.ts'` 按文件计数，排在前面的是 `cli/help.ts`(20)、`cli/init.ts`(13)、`cli/server.ts`(10)、`gate/lifecycle.ts`(8)、`kernel/task-transition.ts`(7)。前三个是 CLI 表层，分支少、副作用多，不适合做第一条变异读数；`packages/quay/src/kernel/task-transition.ts`（1015 行）里有纯判定函数 `decideTransition`(:161)、`edgeKindFor`(:183)、`patchStatusField`(:199)，所有状态翻转都经过它们，且有专用测试 `packages/quay/test/task-transition.test.mjs`（14 个 test）。选它。

## Plan

1. **零依赖的最小变异读数器**：新增 `plugin/scripts/ls-mutation-reading.ts`。输入：目标文件、函数名列表、测试文件。它在**临时副本**里逐个应用确定性变异算子（`===`↔`!==`、`&&`↔`||`、布尔字面量取反、数组/字符串字面量置空、`return` 早退），每个变异体只跑指定测试文件，按退出码记 killed / survived / not-evaluated（编译失败、超时归 not-evaluated，⛔ 不算 killed）。⛔ 不改主检出源码；⛔ 不引入 stryker/fast-check（是否引入新依赖是另一个决定，不由本任务做）。
2. **载体**：每次运行向 `.quay/ls-readings.jsonl` 追加一行：`{ts, head, target, functions, operators, mutants, killed, survived, notEvaluated, score, survivors:[{fn,line,operator}]}`；`score` 只在 `mutants - notEvaluated > 0` 时计算，否则为 null。在 `docs/carrier-registry.json` 登记该载体，在 `plugin/scripts/capability-catalog-declarations.json` 登记脚本。
3. **对 `task-transition.ts` 取第一条读数**，并把存活变异体按函数列在 Evidence 里。⛔ 本任务不负责「把存活变异体全部杀掉」；只在 Evidence 里逐条给出判断（测试缺口 / 等价变异体）。
4. **不设阈值**（硬规则 4 推论：成本结构与分布都未测量过）。读数只记录，不进任何门。

## Acceptance Criteria

- [ ] AC1 读数器能判出「弱测试」（夹具负对照）：对一个夹具模块配两份测试——一份断言完整、一份只断言「函数不抛错」——同一组变异算子下，弱测试那份的 survived 严格大于强测试那份，且强测试那份的 killed ≥1（贴出两次 JSON 输出）。
- [ ] AC2 未评估不伪装成击杀（硬规则 3b）：夹具中一个会导致语法错误的变异体记为 `notEvaluated`，不计入 `killed`；当全部变异体都是 notEvaluated 时 `score` 为 `null` 而不是 0 或 1（贴出输出）。
- [ ] AC3 第一条产品代码读数（生产载体）：在主检出 HEAD 上对 `packages/quay/src/kernel/task-transition.ts` 的 `decideTransition`、`edgeKindFor`、`patchStatusField` 跟 `packages/quay/test/task-transition.test.mjs` 运行一次，`.quay/ls-readings.jsonl` 中出现一行 `target` 为该文件、`mutants ≥ 10`、`head` 等于运行时 `git rev-parse HEAD` 的记录。贴出该行与 HEAD。
- [ ] AC4 不污染源码：AC3 运行前后 `git status --porcelain packages/quay/src/kernel/task-transition.ts` 均为空，`md5sum` 一致（贴出两次读数）。
- [ ] AC5 存活变异体逐条有判断：AC3 记录中的每个 survivor 在 `## Evidence` 里都有一行 FACT（函数/行/算子）+ JUDGMENT（测试缺口或等价变异体，附一句理由）；行数等于该记录的 `survived`（贴出计数对照）。

## Definition of Done

- [ ] AC1–AC5 全绿，`scripts/test.sh` 相关泳道与 `--for-task` scoped 静态检查通过，合并进 develop。
- [ ] 载体与脚本均已在 `docs/carrier-registry.json`、`plugin/scripts/capability-catalog-declarations.json` 登记，相关完整性测试为绿。
- [ ] 未引入新的 npm 依赖；未设任何阈值或门；ADR-007 未被修改（是否把该读数器写回 ADR 由人裁定）。

## Touches

- tasks/gap-ls-product-code-behavior-variance-first-reading.md
- plugin/scripts/ls-mutation-reading.ts (new)
- plugin/scripts/capability-catalog-declarations.json
- docs/carrier-registry.json
- plugin/test/ls-mutation-reading.test.mjs (new)
- plugin/test/fixtures/ls-mutation/target.mjs (new)
- plugin/test/fixtures/ls-mutation/target-strong-check.mjs (new)
- plugin/test/fixtures/ls-mutation/target-weak-check.mjs (new)
- plugin/test/carrier-registry-completeness.test.mjs
