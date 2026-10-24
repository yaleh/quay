---
id: gap-routine-architecture-analysis-dup-next-sequence-id
title: "architecture-analysis: archguard dup 6e19b6d306d82356: 97 tokens/8
  lines; both scan ^PREFIX-(\\d{3,})$ for max+1, differing only in the AC/GOAL
  literal."
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard dup 6e19b6d306d82356: 97 tokens/8 lines; both scan ^PREFIX-(\\d{3,})$ for max+1, differing only in the AC/GOAL literal.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792847950884` · ts `2026-10-24T13:19:10.884Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`nextAcId`、`nextGoalId`
- 涉及文件：
- `plugin/scripts/meta-driver.ts:1217`
- `plugin/scripts/meta-driver.ts:2051`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Replace both with one nextSequenceId(records, prefix, digits) and keep thin wrappers; AC: both ids unchanged on a fixture, no duplicated regex.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-24T13:19:10.884Z

## 处置
**结论：已修掉**（不是「已有机制在管」）。两份各自演化的扫描循环删除，唯一定义折叠为
`nextSequenceId(records, prefix, digits)`；`nextAcId` / `nextGoalId` 保留为 1 行薄包装 ⇒ 对外导出面与
4 个既有调用点零变化。

- 改动（commit `c1afbb0bc`，分支 `task/gap-routine-architecture-analysis-dup-next-sequence-id`）：
  - `plugin/scripts/meta-driver.ts`：`nextSequenceId` 只编译一次正则；`digits` 同时是「匹配最短位数」与
    「补零位数」（等价于旧的 `\d{3,}` + `padStart(3)`）；`prefix` 经共享 `escapeRegExp`
    （`plugin/scripts/regex-escape.ts` → kernel 单一真相源）转义，⛔ 不内联第二份 escaper。
  - `plugin/test/meta-driver.test.mjs`：新增 `nextSequenceId` 直接用例（族隔离 / digits / 元字符按字面）。
- 判据①「两个 id 在 fixture 上不变」：既有 `nextAcId` / `nextGoalId` 两条用例**字面未改**，仍绿
  （`AC-179 ⇒ AC-180`、`GOAL-003 ⇒ GOAL-004`、空 ⇒ `AC-001`/`GOAL-001`）。
- 判据②「无重复正则」的读数（改前/改后各实取一次，硬规则 2：计数与样本一起给出）：
  - 改前（develop 主检出）：`grep -nE 'match\(/\^(AC|GOAL)-' plugin/scripts/meta-driver.ts`
    ⇒ **2 处**：`:1220 const m = String(r.id ?? "").match(/^AC-(\d{3,})$/);`、
    `:2054 const m = String(r.id ?? "").match(/^GOAL-(\d{3,})$/);`
  - 改后（本任务 worktree）：`grep -n 'match(re)' plugin/scripts/meta-driver.ts`
    ⇒ **1 处**：`:1227 const m = String(r.id ?? "").match(re);`
- **仪器说明（硬规则 3b）**：archguard MCP `detect_duplicates` 在本 worktree 上返回
  `No query data … run archguard analyze first` ⇒ 该读数**未评估**，⛔ 不把「查不到」当作「零重复」。
  上面改用直接量（扫描点计数）替代；group `6e19b6d306d82356` 的两个成员现各是 1 行薄包装，低于
  archguard 默认 `minStatements=6`，构造上无法再被归入 dup 组（该结论可由 `minStatements` 语义证伪）。
- 实跑：
  - `node --experimental-strip-types --test plugin/test/meta-driver.test.mjs` ⇒ `tests 143 / pass 143 / fail 0`
  - scoped 门 `scripts/test.sh --for-task gap-routine-architecture-analysis-dup-next-sequence-id --allow-thin`
    ⇒ `exit 0`

## ADR-007 暗轴记录
- L_D: prefix_id_scan_sites_before=2 prefix_id_scan_sites_after=1 nextAcId_wrapper_lines=1 nextGoalId_wrapper_lines=1 archguard_minStatements=6

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-next-sequence-id`（routine `architecture-analysis`，runId `architecture-analysis-1792847950884`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-routine-architecture-analysis-dup-next-sequence-id.md`
