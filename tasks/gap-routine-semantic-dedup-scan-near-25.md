---
id: gap-routine-semantic-dedup-scan-near-25
title: "semantic-dedup-scan: Byte-identical quote-strip-then-JSON.parse CLI arg
  parsing, fail-closed invalid-json; only the typed error factory differs."
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
Byte-identical quote-strip-then-JSON.parse CLI arg parsing, fail-closed invalid-json; only the typed error factory differs.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791142275270` · ts `2026-10-04T19:31:15.270Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseJsonArg`
- 涉及文件：
- `plugin/scripts/run-identity.ts:504`
- `plugin/scripts/stage-receipt.ts:819`
- kind：`divergent-implementation`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `near-25`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791142275270`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Disposition
**处置 = extract（修掉）**，落点 `plugin/scripts/gate-script-base.ts`。

复核确认：同一 quote-strip-then-JSON.parse 体在 `plugin/scripts/` 下共有 **5 份**（不止 finding 点名的 2 份）——
`run-identity.ts` / `stage-receipt.ts` / `workflow-journal.ts`（带 try/catch，仅错误工厂不同）与
`execution-policy.ts` / `finding-backpropagate.ts`（裸 `JSON.parse`）。5 份都已 import `gate-script-base.ts`，
故共享 home 已存在（同 `flagValue` / `resolveRoot` / `git` / `readJsonLines` 的既有先例）。

判据（可核）：`grep -rn 'function parseJsonArg' plugin/scripts/*.ts` 只剩
`gate-script-base.ts`（共享实现）与 `inner-wakeup-heartbeat.ts`（**不同**函数：无 quote-strip、签名/错误文本不同，不在本族）。

错误契约逐点保留：`run-identity` 传 `identityError`（其 `code:"invalid-json"` 被 `plugin/test/run-identity.test.mjs` 钉死）、
`stage-receipt` 传 `receiptError`、`workflow-journal` 传 `journalJsonError`（保留 `invalid-json: <message>` 文本）；
两个裸副本改走默认 plain `Error`（仍 fail-closed，仅信息更可读）。

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/run-identity.ts`
- `plugin/scripts/stage-receipt.ts`
- `plugin/scripts/workflow-journal.ts`
- `plugin/scripts/execution-policy.ts`
- `plugin/scripts/finding-backpropagate.ts`
- `plugin/test/gate-script-base.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-near-25.md`