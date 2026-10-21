---
id: gap-routine-semantic-dedup-scan-server-verifier-twin-scripts
title: "semantic-dedup-scan: 216 of 491 non-comment lines in
  server-partial-stop-verify reappear verbatim in server-restart-inflight-verify
  (44 percent vs 40 percent); five helpers are byt"
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
216 of 491 non-comment lines in server-partial-stop-verify reappear verbatim in server-restart-inflight-verify (44 percent vs 40 percent); five helpers are byte-identical, runCli differs only by the timeout literal, and the restart file imports lastLine/parseRoundRecord from its twin at line 81, making the copy lineage explicit.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792560001684` · ts `2026-10-21T05:20:01.684Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`resolveCliPath`、`readServerCarrier`、`isIsoInstant`、`out`、`runCli`、`sleep`
- 涉及文件：
- `plugin/scripts/server-partial-stop-verify.ts:211`
- `plugin/scripts/server-partial-stop-verify.ts:423`
- `plugin/scripts/server-partial-stop-verify.ts:441`
- `plugin/scripts/server-partial-stop-verify.ts:449`
- `plugin/scripts/server-partial-stop-verify.ts:456`
- `plugin/scripts/server-partial-stop-verify.ts:460`
- `plugin/scripts/server-restart-inflight-verify.ts:306`
- `plugin/scripts/server-restart-inflight-verify.ts:447`
- `plugin/scripts/server-restart-inflight-verify.ts:454`
- `plugin/scripts/server-restart-inflight-verify.ts:461`
- `plugin/scripts/server-restart-inflight-verify.ts:465`
- `plugin/scripts/server-restart-inflight-verify.ts:481`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `server-verifier-twin-scripts`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792560001684`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/server-partial-stop-verify.ts`
- `plugin/scripts/server-restart-inflight-verify.ts`
- `tasks/gap-routine-semantic-dedup-scan-server-verifier-twin-scripts.md`