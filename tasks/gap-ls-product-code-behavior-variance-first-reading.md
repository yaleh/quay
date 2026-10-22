---
id: gap-ls-product-code-behavior-variance-first-reading
title: L_S（行为方差）对产品代码没有活仪器——ADR-007 列的 mutation/property 测试在产品代码上 0 处存在；先在一个高
  churn 的纯判定模块上取第一条读数并入载体（观察项）
status: done
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

- [x] AC1 读数器能判出「弱测试」（夹具负对照）：对一个夹具模块配两份测试——一份断言完整、一份只断言「函数不抛错」——同一组变异算子下，弱测试那份的 survived 严格大于强测试那份，且强测试那份的 killed ≥1（贴出两次 JSON 输出）。
- [x] AC2 未评估不伪装成击杀（硬规则 3b）：夹具中一个会导致语法错误的变异体记为 `notEvaluated`，不计入 `killed`；当全部变异体都是 notEvaluated 时 `score` 为 `null` 而不是 0 或 1（贴出输出）。
- [x] AC3 第一条产品代码读数（生产载体）：在主检出 HEAD 上对 `packages/quay/src/kernel/task-transition.ts` 的 `decideTransition`、`edgeKindFor`、`patchStatusField` 跟 `packages/quay/test/task-transition.test.mjs` 运行一次，`.quay/ls-readings.jsonl` 中出现一行 `target` 为该文件、`mutants ≥ 10`、`head` 等于运行时 `git rev-parse HEAD` 的记录。贴出该行与 HEAD。
- [x] AC4 不污染源码：AC3 运行前后 `git status --porcelain packages/quay/src/kernel/task-transition.ts` 均为空，`md5sum` 一致（贴出两次读数）。
- [x] AC5 存活变异体逐条有判断：AC3 记录中的每个 survivor 在 `## Evidence` 里都有一行 FACT（函数/行/算子）+ JUDGMENT（测试缺口或等价变异体，附一句理由）；行数等于该记录的 `survived`（贴出计数对照）。

## Definition of Done

- [x] AC1–AC5 全绿，`scripts/test.sh` 相关泳道与 `--for-task` scoped 静态检查通过，合并进 develop。
- [x] 载体与脚本均已在 `docs/carrier-registry.json`、`plugin/scripts/capability-catalog-declarations.json` 登记，相关完整性测试为绿。
- [x] 未引入新的 npm 依赖；未设任何阈值或门；ADR-007 未被修改（是否把该读数器写回 ADR 由人裁定）。

## Evidence

### AC1 — 同一 target、同一算子集：弱测试 vs 强测试

夹具 `plugin/test/fixtures/ls-mutation/target.mjs`（`classify` / `combine` / `pick`），两份检查跑同一组 11 个变异体。

强断言版 `target-strong-check.mjs`（断言精确返回值）：

```json
{"ts":"2026-10-22T01:36:41.140Z","head":"1fea7a571c5dba6a2037bb53e769ec16e649b073","target":"target.mjs","functions":["classify","combine","pick"],"operators":["equality-flip","logical-operator","boolean-literal","bracket-empty","string-empty","return-early"],"mutants":11,"killed":11,"survived":0,"notEvaluated":0,"score":1,"survivors":[]}
```

只断言「不抛错」版 `target-weak-check.mjs`（`assert.doesNotThrow`）：

```json
{"ts":"2026-10-22T01:36:42.106Z","head":"1fea7a571c5dba6a2037bb53e769ec16e649b073","target":"target.mjs","functions":["classify","combine","pick"],"operators":["equality-flip","logical-operator","boolean-literal","bracket-empty","string-empty","return-early"],"mutants":11,"killed":0,"survived":11,"notEvaluated":0,"score":0,"survivors":[{"fn":"classify","line":9,"operator":"equality-flip"},{"fn":"classify","line":9,"operator":"string-empty"},{"fn":"classify","line":10,"operator":"string-empty"},{"fn":"classify","line":9,"operator":"return-early"},{"fn":"combine","line":14,"operator":"logical-operator"},{"fn":"combine","line":14,"operator":"return-early"},{"fn":"pick","line":18,"operator":"equality-flip"},{"fn":"pick","line":18,"operator":"boolean-literal"},{"fn":"pick","line":18,"operator":"string-empty"},{"fn":"pick","line":18,"operator":"string-empty"},{"fn":"pick","line":18,"operator":"return-early"}]}
```

⇒ 弱测试 survived = 11 **严格大于** 强测试 survived = 0；强测试 killed = 11 ≥ 1。✓

### AC2 — notEvaluated 不伪装成击杀

夹具（AC2 专用，临时目录）只有一个算子会产生变异体：`target.mjs` 里只有索引表达式 `list[i]` / `list[0]`，`bracket-empty` 把它们变成 `list[]` ⇒ 语法错误。只启用 `bracket-empty`（全部变异体都不可评估）：

```json
{"ts":"2026-10-22T01:36:46.036Z","head":null,"target":"target.mjs","functions":["at","first"],"operators":["bracket-empty"],"mutants":2,"killed":0,"survived":0,"notEvaluated":2,"score":null,"survivors":[]}
```

⇒ killed = 0（没有被伪装成击杀）；**全部 notEvaluated 时 `score` = `null`，不是 0 也不是 1**。✓

对照（同一夹具启用全部算子）：`{"mutants":4,"killed":2,"survived":0,"notEvaluated":2,"score":1,...}` —— 2 个 `return-early` 变异体被判 killed，2 个无法解析的括号变异体仍单独计入 notEvaluated，两类不混同。✓

### AC3 — 第一条产品代码读数（生产载体 = 主检出）

运行命令（`--root` = 主检出 `/data/home/yale/work/quay`）：

```
node --no-warnings --experimental-strip-types <worktree>/plugin/scripts/ls-mutation-reading.ts \
  --root /data/home/yale/work/quay \
  --target packages/quay/src/kernel/task-transition.ts \
  --functions decideTransition,edgeKindFor,patchStatusField \
  --test packages/quay/test/task-transition.test.mjs --json
```

`.quay/ls-readings.jsonl`（主检出，第 1 行）：

```json
{"ts":"2026-10-22T01:36:34.072Z","head":"584e10c60d7850733799ab60eb35675fb78d0a38","target":"packages/quay/src/kernel/task-transition.ts","functions":["decideTransition","edgeKindFor","patchStatusField"],"operators":["equality-flip","logical-operator","boolean-literal","bracket-empty","string-empty","return-early"],"mutants":30,"killed":26,"survived":3,"notEvaluated":1,"score":0.8966,"survivors":[{"fn":"decideTransition","line":166,"operator":"string-empty"},{"fn":"patchStatusField","line":204,"operator":"bracket-empty"},{"fn":"patchStatusField","line":207,"operator":"bracket-empty"}]}
```

运行时 HEAD（主检出，运行前 / 运行后各读一次，均为 `584e10c60d7850733799ab60eb35675fb78d0a38`）= 记录中的 `head`；`target` = `packages/quay/src/kernel/task-transition.ts`；`mutants` = 30 ≥ 10。✓

### AC4 — 不污染源码

| 时点 | `git status --porcelain packages/quay/src/kernel/task-transition.ts` | `md5sum` |
|---|---|---|
| 运行前 | 空 | `a7bb3b46018bb24a809e2b38319ae2c1` |
| 运行后 | 空 | `a7bb3b46018bb24a809e2b38319ae2c1` |

（两次读数均取自主检出，HEAD 均为 `584e10c60…`。变异体只写进 `os.tmpdir()` 的临时副本，运行结束即删除。）✓

### AC5 — 每个 survivor 一条 FACT + JUDGMENT

计数对照：AC3 记录 `survived` = **3**；下面的 FACT/JUDGMENT 条目 = **3**。

1. **FACT** `decideTransition` :166，算子 `string-empty` —— 把模板字符串里的 `", "`（`unknown.map(JSON.stringify).join(", ")` 的分隔符）置空为 `""`。
   **JUDGMENT** **测试缺口**：`task-transition.test.mjs` 只在「单个未知状态」上断言 `not-evaluated`，没有任何用例断言**两个以上**未知状态时 reason 文本的分隔符；verdict 本身不受影响，因此这是消息层的缺口，不是判定层。
2. **FACT** `patchStatusField` :204，算子 `bracket-empty` —— 把 `statusLineRe = /^status:[ \t]*[^\r\n]*$/m` 里的 `[ \t]` 置空为 `[]`。
   **JUDGMENT** **等价变异体**：`[]*` 只匹配空串，紧随的 `[^\r\n]*` 仍然吞掉 `status:` 之后的全部非换行字符 ⇒ 匹配集合与原正则完全相同，行为不可区分。
3. **FACT** `patchStatusField` :207，算子 `bracket-empty` —— 把 `line[0].replace(/^status:[ \t]*/, "")` 里的 `[ \t]` 置空为 `[]`。
   **JUDGMENT** **等价变异体**：`[]*` 在同一位置匹配空串，`status:` 之后残留的空白由紧随其后的 `.trim()` 去掉 ⇒ 取出的 `from` 与原实现逐字相同。

补充（不是 survivor，但同一读数里的第三种状态）：`patchStatusField` :207 的 `[0]`→`[]`（索引表达式 `line[0]`）产生 `line[]`，无法解析 ⇒ 记为 `notEvaluated`（本读数 `notEvaluated` = 1），**没有被算作 killed** —— AC2 的三态规则在生产读数上同样成立。

### DoD evidence

- **scoped 门**：`bash scripts/test.sh --for-task gap-ls-product-code-behavior-variance-first-reading --allow-thin` ⇒ `EXIT=0`；9 tests / 9 pass / 0 fail；scoped 静态检查无 `STATIC_CHECK_FAILED`（含 `tmp-leak-pairing-check`、`test-isolation-check`、`test-framework-policy-check`、`checked-in-write-check` 全 PASS）。本轮在 worktree 内 `git merge develop` 之后重跑了同一个门：`EXIT=0`，9 tests / 9 pass / 0 fail。
- **登记完整性**：`plugin/test/carrier-registry-completeness.test.mjs` 5/5 绿（`ls-readings.jsonl` 已登记，owner = `plugin/scripts/ls-mutation-reading.ts`）；`bash plugin/scripts/capability-catalog.sh --summary` ⇒ `391 scripts | 391 declared | 0 unclassified`；`plugin/test/capability-catalog.test.mjs` 18/18 绿；`plugin/scripts/gitignore-runtime-coverage-check.ts` PASS（13 marked = 13 manifest；新增的 `**/.quay/ls-readings.jsonl` 刻意不带 `@quay-runtime-artifact` 标记 —— 它在 `.quay/` 下，quay-init 的静态 `.quay/*` 规则已覆盖消费方）。
- **未引入新依赖**：`git diff --name-only develop...HEAD -- package.json package-lock.json 'packages/*/package.json'` ⇒ 空。
- **未设阈值/门**：本脚本只被人/自检调用，不在任何 driver 或 loop 里；`scripts/test.sh` 未改动；读数只落在 `## Evidence` 与 `.quay/ls-readings.jsonl`。
- **ADR-007 未修改**：`git diff --name-only develop...HEAD -- 'adr/ADR-007*'` ⇒ 空。
- **第一轮 fan-in 红的修复（2026-10-22）**：第一轮把 1-based 换行计数器 `lineOf` 私有复制进 `plugin/scripts/ls-mutation-reading.ts`，重新打开了已退役的 `lineof-lineat` 家族，`plugin/test/source-text-lib.test.mjs` 的 family 回归判据报 `ls-mutation-reading.ts:243 lineOf`（一条 task-introduced-red）。本轮改为 `import { lineOf } from "./source-text-lib.ts"`，该测试 28/28 绿。

## Dark axis (ADR-007)

- L_G：该轴仍暗,理由:本任务是 L_S（行为方差）轴上的第一条产品代码读数——它只跑文本变异读数器，不产生任何依赖结构/上帝模块（L_G）或文档-代码耦合（L_D）读数，两条轴在本任务中均未被观测；把 L_S 的读数冒充成 L_D/L_G 的读数正是 ADR-007 反对的「用一个轴顶替另一个轴」。

## Touches

- tasks/gap-ls-product-code-behavior-variance-first-reading.md
- plugin/scripts/ls-mutation-reading.ts (new)
- plugin/scripts/capability-catalog-declarations.json
- docs/carrier-registry.json
- .gitignore
- plugin/test/ls-mutation-reading.test.mjs (new)
- plugin/test/fixtures/ls-mutation/target.mjs (new)
- plugin/test/fixtures/ls-mutation/target-strong-check.mjs (new)
- plugin/test/fixtures/ls-mutation/target-weak-check.mjs (new)
- plugin/test/carrier-registry-completeness.test.mjs
