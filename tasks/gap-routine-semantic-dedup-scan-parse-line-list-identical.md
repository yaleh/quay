---
id: gap-routine-semantic-dedup-scan-parse-line-list-identical
title: "semantic-dedup-scan: Byte-identical split/trim/filter-#-and-blank list
  parser under two names, in two files that already import from the same
  ratchet-baseline helper module."
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Byte-identical split/trim/filter-#-and-blank list parser under two names, in two files that already import from the same ratchet-baseline helper module.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792752400273` · ts `2026-10-23T10:46:40.273Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseExemptionList`、`parseViolationList`
- 涉及文件：
- `plugin/scripts/test-framework-policy-check.ts:153`
- `plugin/scripts/test-isolation-check.ts:897`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-23T10:46:40.273Z

## Resolution
处置：**修掉**（merge 到 `ratchet-baseline.ts` 的单一机制），⛔ 不是「已有机制在管」。

- 新的唯一正本：`plugin/scripts/ratchet-baseline.ts` 的 `parseRatchetEntryLines(text)` ——
  `split(/\r?\n/)` / `trim` / 过滤空行与 `#` 行首注释的 entry-line 语法，与该模块已有的 token 语法
  （`parseBaselineCount`）和 shrink-only 守卫同处一室（该模块头注释本就把 non-comment-line set 列为 shared mechanism）。
- `parseRatchetBaselineText` 内部**第三份**同样的 grammar（原为内联 `for` 循环）也改为调用它。
- 两个消费者保留各自导出名（各绑定自己的名词：exemptions / violations），body 降为一行委托：
  - `test-framework-policy-check.ts` 的 `parseExemptionList` → `parseRatchetEntryLines(text)`
  - `test-isolation-check.ts` 的 `parseViolationList` → `parseRatchetEntryLines(text)`
- 行为不变：两处原本就是同一段代码逐字复制，委托不改变返回值、顺序、CRLF 语义；两侧自带测试全绿。

复核读数（实跑，worktree `/data/home/yale/work/quay-worktrees/gap-routine-semantic-dedup-scan-parse-line-list-identical`）：
- `grep -rn 'l.length > 0 && !l.startsWith("#")' --include=*.ts`：**修复前 3 处 → 修复后 2 处**，
  其中同一 grammar 的实现处 **3 → 1**（`ratchet-baseline.ts:85`）。
- `node --experimental-strip-types --test plugin/test/ratchet-baseline.test.mjs plugin/test/test-framework-policy-check.test.mjs` → 44 pass / 0 fail。
- `node --experimental-strip-types --test plugin/test/test-isolation-check.test.mjs` → 15 pass / 0 fail。

硬规则 5b（同一载体内的兄弟实例）：第 3 处 `plugin/scripts/audit-independence-check.ts:105` 的
`parseDispatchRecord` **不并入**，理由可核：它不是 byte-identical（`split("\n")` 而非 `/\r?\n/`，自带
`typeof` 守卫，返回 `Set`），且它解析的不是 ratchet baseline 文件；并入会**静默改变它的 CRLF 行为**。
记录在此，不静默丢弃。

## Effect Prediction 复核
`concept_recurs_after_merge` 的终局判据是下一次 `semantic-dedup-scan` 里同 concept 不再复发；本轮能取到的
直接量是上面的实现处计数（3 → 1，单点 `ratchet-baseline.ts`）与两侧测试实跑绿。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `parse-line-list-identical`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792752400273`）所描述的问题被复核并处置
  - 复核：读该 runId 的 finding 记录，确认两文件中的 `parseExemptionList` / `parseViolationList` 逐字相同。
  - 处置：见 `## Resolution` —— 归并到 `ratchet-baseline.ts` 的 `parseRatchetEntryLines`。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案
  - 结论 = **修掉**。可核读数：同一 grammar 的实现处 3 → 1；两侧 59 个测试实跑全绿。

## DoD
- [x] 上面的判据实跑通过
  - 三组 `node --test` 实跑 44 + 15 全绿；`import-graph-check` 实跑 PASS。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑
  - 实现与验证均由派发链的 worker 会话执行；例程只产出 finding 与立案。

## ADR-007 暗轴记录
- L_D 依赖结构（`import-graph-check` 本 worktree 实测，2026-10-23）：valueSccs=0 · typeSccs=0 · reverseEdges=0 · files=506 · edges=1508（value=1371 / type=137）
- L_G: 该轴仍暗,理由: 本次仅为 plugin/scripts 内的函数体归并，未运行 archguard god-package 读数，不据此下结论

## Touches
- `plugin/scripts/test-framework-policy-check.ts`
- `plugin/scripts/test-isolation-check.ts`
- `plugin/scripts/ratchet-baseline.ts`
- `plugin/test/ratchet-baseline.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-parse-line-list-identical.md`