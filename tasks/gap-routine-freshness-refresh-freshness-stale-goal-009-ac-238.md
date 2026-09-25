---
id: gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238
title: "freshness-refresh: ALREADY past the window: d=228 > K=200, newest
  evidence 2026-09-19T11:06:09Z (build_sha fa1cae202e02); no carrier record
  since 2026-09-20T13:50:36Z, so this face"
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
ALREADY past the window: d=228 > K=200, newest evidence 2026-09-19T11:06:09Z (build_sha fa1cae202e02); no carrier record since 2026-09-20T13:50:36Z, so this face has aged 28 commits beyond the limit.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1790303081218` · ts `2026-09-25T02:24:41.218Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`upgrade-face`
- 涉及文件：
- `plugin/scripts/develop-deliver-tgz.sh`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `.quay/productization-verification.jsonl`
- `.quay/goal-freshness-margin.json`
- `plugin/freshness-producers.json`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run upgrade-face on a host authorized to B (this host is NOT: ssh BatchMode rc=255), only after on-the-spot disk headroom is confirmed on B, and with --upgrade-source pointed at the aged copy work/meta-cc-aged-ac238-copy

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `freshness-stale-goal-009-ac-238`（routine `freshness-refresh`，runId `freshness-refresh-1790303081218`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/develop-deliver-tgz.sh`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-stale-goal-009-ac-238.md`