---
id: gap-routine-semantic-dedup-scan-parse-baseline-count-divergent-anchor
title: "semantic-dedup-scan: Two byte-identical parseBaselineCount bodies use
  ^#\\s*baseline-count:\\s*(\\d+)\\s*$ while the baseline-reader family uses ^#
  baseline-count:\\s*(\\d+), so a line w"
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
Two byte-identical parseBaselineCount bodies use ^#\s*baseline-count:\s*(\d+)\s*$ while the baseline-reader family uses ^# baseline-count:\s*(\d+), so a line with extra leading whitespace yields 5 under one grammar and null under the other.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790678624535` · ts `2026-09-29T10:43:44.535Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseBaselineCount`
- 涉及文件：
- `plugin/scripts/test-isolation-check.ts:900`
- `plugin/scripts/test-framework-policy-check.ts:159`
- `plugin/scripts/task-ac-carryover-check.ts:213`
- kind：`same-symbol-multi-file`
- verdict：`divergent-implementation`

## Requested action
extract

## Disposition

**复核 —— claim 成立，措辞需更正。**
- 两处 `parseBaselineCount` 的函数体确实**逐字节相同**（`plugin/scripts/test-isolation-check.ts` 与
  `plugin/scripts/test-framework-policy-check.ts` 各一份），且确实与 reader family 的
  `^# baseline-count:\s*(\d+)` 用了不同语法。
- finding 写的「extra leading whitespace」**不准确**：`#` 之前的空白在**两种**语法下都失败。真正的分叉是
  ① `#` 之后多一个空格（`#  baseline-count: 5`）→ 旧窄语法读 5，reader 读 null；
  ② 数字之后有尾随文字（`# baseline-count: 51 (frozen)`）→ 旧窄语法读 **null**，reader 读 51。
- ⇒ **被淘汰的那一支是弱的一支，不是强的一支**：ceil=null 的语义是「未设封顶」（硬规则 3b），所以一条尾随
  注释会让 commit-surviving 的 AC4/AC5 封顶**静默失效**。这不是「两种读法都行」，而是「其中一种会关掉闸门」。
- 实测**潜伏性**：20 个携带该 token 的载体 × worktree 与 git-HEAD 两份 = 118 次读数中，reader 与旧窄语法
  的分歧 **0 次**。该分叉此前从未真正咬到 —— 本任务是加固，不是红轮修复（这一点决定它不该被当作 red-fix 处置）。
- finding 列的第三个文件 `task-ac-carryover-check.ts:213` **无需处置**：它的行内 parser 用的本来就是 reader
  语法，且已被先前的 ratchet reader 抽取（`b7bcf0db9`）并进 `ratchet-baseline.ts`；`git show b7bcf0db9^:…`
  证实那一处从来没有过 `parseBaselineCount`。该文件列表是在那次重构在飞时被例行扫描拍下的，三个引用行号今天
  都已漂移。

**处置 = extract（finding 自己要求的动作）。**
- `plugin/scripts/ratchet-baseline.ts`（token 的唯一家）新增导出 `parseBaselineCount`，并让
  `parseRatchetBaselineText` 建在它之上 —— 一份实现、一套语法、两个契约（建条目集 / 只读封顶）。
- `test-framework-policy-check.ts` / `test-isolation-check.ts` 删掉各自副本，改为 import-and-export 共享的
  那一份（⛔ 不用 `export {…} from`：那只绑导出表，本模块自己的调用点会 ReferenceError）。
- `BASELINE_COUNT_RE` 由 `# ` 放宽为 `#[ \t]*` —— 既有语法的**严格超集**，只能把「无封顶」变成「写出多少
  就是多少」，不会反向。

**结论可核（AC2 要的那一半）。**
- 变异控制：把旧 anchored 正则装回去，新测试**变红**（`trailing prose must not void the ceiling`）⇒ 该测试
  不是回声，它真的能取假。
- 全载体读数：`reader_old` vs 新语法 回归 **0**（118 次读数），即改动在生产载体上零行为变化。
- **真闸门**复跑：`test-framework-policy-check` PASS（912 glob file / 33 exemption）、
  `test-isolation-check` PASS（21 条已基线化违规）。
- 单测：`ratchet-baseline.test.mjs` 14/14（含新增 2 条）、`test-framework-policy-check.test.mjs` 39/39、
  `task-ac-carryover-check` + `task-contract-check` + `threshold-scope-check` + `bare-dir-touches-check`
  104 pass / 0 fail、`test-isolation-check.test.mjs` 15/15。
- 实现提交：`6dcc98df5`。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `parse-baseline-count-divergent-anchor`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790678624535`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/test-isolation-check.ts`
- `plugin/scripts/test-framework-policy-check.ts`
- `plugin/scripts/task-ac-carryover-check.ts`
- `plugin/scripts/ratchet-baseline.ts`
- `plugin/test/ratchet-baseline.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-parse-baseline-count-divergent-anchor.md`
