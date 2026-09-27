---
id: gap-routine-semantic-dedup-scan-escaperegexp-sweep-missed-two
title: "semantic-dedup-scan: the documented sweep that collapsed twelve
  byte-identical copies could not see these two semantically identical Set-loop
  rewrites, so a completed dedup is only"
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
the documented sweep that collapsed twelve byte-identical copies could not see these two semantically identical Set-loop rewrites, so a completed dedup is only apparently complete (hard rule 5b).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790503843524` · ts `2026-09-27T10:10:43.524Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`escapeRegExp`
- 涉及文件：
- `packages/quay/src/kernel/regex-escape.ts:49`
- `plugin/scripts/precommit-guard.ts:202`
- `plugin/scripts/select-static-checks-for-touches.ts:202`
- kind：`real-duplication`
- verdict：`real-duplication`

## Requested action
merge onto the kernel leaf, then re-run the family check instead of trusting the 12/12 claim

## Disposition

**复核结论：finding 属实，而且它报的只是其中一部分。** finding 点名 2 处 Set 循环重写
（`precommit-guard.ts:202`、`select-static-checks-for-touches.ts:202`）；按同一原则（硬规则 5b：修好一处 ≠ 它只在一处）
**重跑枚举**——⛔ 不是重跑 grep、也不是重读那个绿灯。「re-run the family check」的字面做法（重跑原判据①看它绿）
会**原样复现同一个错误**：①的针是 `s.replace(`，对 `String(s).replace(`、Set 循环、单引号替换这三种拼写**结构性失明**。

> ⚠️ **本任务最要紧的副产品：grep 对含 NUL 字节的文件零命中，不是「没有」，是「读不懂且伪装成没有」。**
> 实测 `plugin/scripts/wiring-coverage-check.ts`：`grep -c 'e'` → 无任何输出、exit 1；`grep -a -c 'e'` → 519。
> 该文件里恰好藏着一处转义副本 ⇒ **任何 grep 驱动的扫描（含本仓库大量静态检查）都看不见它**——
> 这是硬规则 4 推论二那个「恒零读数与一切正常同形」的同族形态。全部含 NUL 的生产文件共 3 个：
> `plugin/scripts/wiring-coverage-check.ts`、`plugin/scripts/crystallization-half-life.ts`、
> `plugin/scripts/fan-in-queueing-model.ts`。⛔ 本条只报告、不修改这 3 个 NUL（不是本 finding 的对象，
> 且 3 处一起改才自洽）——写明而非沉默略过。

**枚举读数**（同一个**读字节的 walker**，修前 = develop tip，修后 = 本任务分支；同面：`plugin/**` + `packages/*/src/**`，
排除 node_modules / dist / archive / test / fixtures —— 与探针自身的排除规则一致，427 个文件）：

| 谓词 | 修前 | 修后 |
|---|---|---|
| 家族名**声明位**（escapeRegExp / escapeRegex / escapeRe / escapeGrep） | 5 | **1**（kernel 叶） |
| 转义 **body 字面量**所在文件（去掉接收者、去掉替换串的针） | 11 | **1**（kernel 叶） |
| **Set 循环**重写（逐字符查元字符 `Set`） | 2 | **0** |

**处置 = 修掉（extract）**：**12 处**全部并入 `packages/quay/src/kernel/regex-escape.ts` 这一个叶子，
家族从 12 个落点收敛为 1（4 个具名 helper + 8 处内联）：

- **具名 helper（4）**：`precommit-guard.ts` 与 `select-static-checks-for-touches.ts` 的私有 `escapeRegExp`（Set 循环，
  finding 点名的两处；后者的注释自称理由是「TS type-stripper 在本文件里 mis-parse 该字面量」——Node v24 实测为假，
  kernel 叶本身就是那个字面量的活证，该说法已替换）；`loop-shipping-exclusion-data.mjs` 的箭头 `escapeRegExp`
  （单引号替换 ⇒ 同时躲过①的两重针）；`fast-mode-telemetry.ts` 的 `escapeGrep`（接收者拼作 `String(s)`，
  **与 `s` 只差一个字符** ⇒ 正是①漏掉它的原因；薄名一并删除，家族只剩一个名字）。
- **内联（8）**：`wiring-coverage-check.ts`（即上面那处 grep 看不见的）、`checker-mutation-check.ts`、`goal-driver.ts`、
  `measure-trend-check.ts`、`suite-bucket-hub-list.ts`、`task-schema.ts`、`task-status-drift-check.ts`、
  `packages/quay/src/init.ts`。

**为什么上一轮「不动它们」的理由本轮不成立**：上一轮 task 的 `## Disposition` 写明理由是「把这两处收进来会扩大
`precommit-guard` / `driver-cli` 两个**手工维护**的依赖闭包面」。该代价前提已随 AC168 退役 copy 机器而消失——
铺设面棘轮 `quay-init-closure-ratchet --gate` **实测 PASS 且基线未动**（3 files / 1022 bytes，shrink-only 成立），
脚本已不在铺设面内；而 `regex-escape.ts` 在派生集里**早有显式条目**（`plugin/scripts/quay-init.sh:741`），
故增加 **import 方**不新增任何名字。⇒ 只剩收益。

**家族检查同步升级**（`packages/quay/test/kernel-regex-escape.test.mjs` 判据④）：① 是**逐字节 body** 判定；
④ 改判**声明谓词** + **去接收者/去引号的 body 谓词** + **Set 循环形状**，并在判树之前把每个谓词对着
**已知为真**的样本干跑一次（外加「`import` 不算声明」的反向控制）——即硬规则 2 的零计数配套动作两半都做。
⇒「12/12 已完成」这种口径再也回不来。

**红控制（4 条，全部实测；①/④ 两列是实测结果）**：

| 注入到扫描面的临时副本 | ① | ④ |
|---|---|---|
| (A) Set 循环重写（finding 的形状） | 绿 | **红** |
| (B) `String(s)` 接收者的 body | **绿** | **红** |
| (C) 换名声明（`escapeRe`） | 绿 | **红** |
| (D) 匿名 Set 循环（不含任何家族名） | 绿 | **红** |

(B)、(D) 是关键词条：它们证明 ④ 能看见 ① **结构上看不见**的东西。注入文件用后即删，未提交。

### 本条不声称什么

⛔ 探针扫描面之外仍在拼该 body：`experiments/quay-perpetual-stream/scripts/it0-dod-check.ts` 2 处，
以及测试面（`plugin/test`、`packages/quay/test`）若干。它们在探针自身的排除规则之外（methodology 层 / test 树），
与本条对象不同类——**写在 kernel 叶的头注释里**，⛔ 不沉默略过。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `escaperegexp-sweep-missed-two`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790503843524`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/kernel/regex-escape.ts`
- `packages/quay/src/init.ts`
- `packages/quay/test/kernel-regex-escape.test.mjs`
- `plugin/scripts/precommit-guard.ts`
- `plugin/scripts/select-static-checks-for-touches.ts`
- `plugin/scripts/loop-shipping-exclusion-data.mjs`
- `plugin/scripts/fast-mode-telemetry.ts`
- `plugin/scripts/wiring-coverage-check.ts`
- `plugin/scripts/checker-mutation-check.ts`
- `plugin/scripts/goal-driver.ts`
- `plugin/scripts/measure-trend-check.ts`
- `plugin/scripts/suite-bucket-hub-list.ts`
- `plugin/scripts/task-schema.ts`
- `plugin/scripts/task-status-drift-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-escaperegexp-sweep-missed-two.md`
