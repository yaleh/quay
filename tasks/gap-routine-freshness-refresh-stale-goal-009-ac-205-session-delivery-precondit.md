---
id: gap-routine-freshness-refresh-stale-goal-009-ac-205-session-delivery-precondit
title: "freshness-refresh: AC-205's newest delivery evidence is the same aged
  build_sha 2d3a6fa3 (2026-09-18T04:20:31Z, carrier line 256), d=161 leaving
  margin 39 (0.195) under the 0.2808 "
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
AC-205's newest delivery evidence is the same aged build_sha 2d3a6fa3 (2026-09-18T04:20:31Z, carrier line 256), d=161 leaving margin 39 (0.195) under the 0.2808 threshold; it rides the coldstart-face command line but its registered preconditions (a LIVE session on the verification host whose settings allow inbound) are NOT guaranteed by this repo, so re-running is not by itself a complete remedy.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789909757223` · ts `2026-09-20T13:09:17.223Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`session-delivery`、`develop-deliver-tgz.sh`、`find_ac205_target_session`、`GOAL-009-AC-205`
- 涉及文件：
- `plugin/freshness-producers.json:49`
- `plugin/freshness-producers.json:54`
- `plugin/scripts/verify-deliver-coldstart.sh:5114`
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl:256`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
Re-run session-delivery's shared command (same run as coldstart-face) only on a host whose live session passes send-to-session.ts --pid <pid> --precheck printing hold-precheck=direct; the 2026-09-15 measurement found host C held.

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `stale-goal-009-ac-205-session-delivery-precondition`（routine `freshness-refresh`，runId `freshness-refresh-1789909757223`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `tasks/gap-routine-freshness-refresh-stale-goal-009-ac-205-session-delivery-precondit.md`