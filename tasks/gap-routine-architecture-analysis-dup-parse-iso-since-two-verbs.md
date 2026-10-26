---
id: gap-routine-architecture-analysis-dup-parse-iso-since-two-verbs
title: "architecture-analysis: archguard exact-clone 82266722a040a86e (101
  tokens / 7 statements / 11 lines): the two verbs' --since validators differ
  only in the error-message prefix; the"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard exact-clone 82266722a040a86e (101 tokens / 7 statements / 11 lines): the two verbs' --since validators differ only in the error-message prefix; the in-code note says the copy exists so each verb keeps its own wording, but a parseIsoSince(raw, verbLabel) helper reproduces both strings byte-for-byte, so the stated reason does not actually require duplication.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793051973088` · ts `2026-10-26T21:59:33.088Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseDriverLogSince`、`parseSuiteSince`
- 涉及文件：
- `packages/quay/src/cli/driver.ts:221`
- `packages/quay/src/cli/suite.ts:104`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract one parseIsoSince(raw, verbLabel) into a shared cli helper and have both verbs call it with 'quay driver log' / 'quay suite'; AC = the existing cli tests asserting each verb's exact --since error text pass unchanged, and archguard no longer returns group 82266722a040a86e for scope 075f2c0c.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-26T21:59:33.088Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-parse-iso-since-two-verbs`（routine `architecture-analysis`，runId `architecture-analysis-1793051973088`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Disposition
处置结论：**修掉**（⛔ 不是「已注意到」）。来源 finding 已按 `.quay/routine-findings.jsonl` 原文复核
（`grep dup-parse-iso-since-two-verbs` 命中 finding + filing-round 两条，runId / ts / 符号 / 文件行号一致）。

- 修复提交：`bd740f9f8`（本任务分支 `task/gap-routine-architecture-analysis-dup-parse-iso-since-two-verbs`）
- 单一实现落在 `packages/quay/src/cli/flags.ts` 的 `parseIsoSince(raw, verbLabel)`——两个调用方本来就都
  import `./flags.ts`（`parseFlags`/`parseVerbless`），因此零新增 import 边、无环风险。
- `cli/driver.ts` / `cli/suite.ts` 的重复函数体已删除，改为
  `parseIsoSince(flags.since, "quay driver log")` / `parseIsoSince(flags.since, "quay suite")`；
  「每个 verb 保留自己的措辞」这一原注释理由由 `verbLabel` 参数直接兑现，不再需要复制函数体。
- 报错文本逐字节不变（2026-10-27 实跑两个 verb，均 exit 1）：
  - `quay driver log: --since requires an ISO 8601 instant (e.g. 2026-10-01T00:00:00Z; got "not-a-date")`
  - `quay suite: --since requires an ISO 8601 instant (e.g. 2026-10-01T00:00:00Z; got "not-a-date")`
- `npx tsc --noEmit -p packages/quay/` 退出 0。

复现原判据的同一台仪器读数（archguard `detect_duplicates`，例程原 scope 形状：sources=`packages`、
trackedOnly=true、minStatements=6、minTokens=50、topN=20）：

- 修复前（routine 持久化的 scope `075f2c0c`，2026-10-26T21:59:56Z）：`totalGroups: 1`（即 group `82266722a040a86e`）
- 修复后（本 worktree，scope `1e669d9b`）：`totalGroups: 0`，`scannedFiles: 169`，`scannedFunctions: 2344`
- 零读数的负控制（硬规则 2）：同一判定器、同样 floors、对一份【已知为真】的两份同构函数样本运行
  ⇒ `totalGroups: 1`（hash `b90ee393f4994687`，9 statements / 124 tokens）——证明上面的 0 是真零，
  不是判定器对该形状不敏感。

- L_D archguard: duplicate_groups=0 (before the fix: 1, hash 82266722a040a86e), scannedFunctions=2344, scannedFiles=169, minStatements=6, minTokens=50, trackedOnly=true

## Touches
- `packages/quay/src/cli/driver.ts`
- `packages/quay/src/cli/suite.ts`
- `packages/quay/src/cli/flags.ts`
- `tasks/gap-routine-architecture-analysis-dup-parse-iso-since-two-verbs.md`