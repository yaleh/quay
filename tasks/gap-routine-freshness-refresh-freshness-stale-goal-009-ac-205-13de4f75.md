---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205-13de4f75
title: "freshness-refresh: Delivery-face distance d=264 has passed K=200
  (margin=-64) and the newest AC-205 record is 232.71h old
  (2026-10-12T21:59:06Z, carrier line 360); only session-del"
status: ready
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
Delivery-face distance d=264 has passed K=200 (margin=-64) and the newest AC-205 record is 232.71h old (2026-10-12T21:59:06Z, carrier line 360); only session-delivery produces this subject, and its AC-205 leg is the one face whose precondition is not repo-controlled.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1792680214267` · ts `2026-10-22T14:43:34.267Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`session-delivery`、`targetInboundPolicy`、`verify-deliver-coldstart.sh:find_ac205_target_session`
- 涉及文件：
- `plugin/freshness-producers.json:156`
- `plugin/freshness-producers.json:172`
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl:360`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run session-delivery from this host (FILE-ONLY here): host B currently has a live procStart-matching session pid 3198864 whose argv --settings carries permissions.defaultMode=bypassPermissions (precheck verdict direct) => ⑦ leg can land; host C still reads will-hold (defaultMode/crossSessionInbound unset).

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `GOAL-009-AC-205` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-22T14:43:34.267Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-205`（routine `freshness-refresh`，runId `freshness-refresh-1792680214267`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-205-13de4f75.md`