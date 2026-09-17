---
id: gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face
title: "freshness-refresh: margin -4 is already negative (d=204 > K=200): the
  newest carrier evidence for AC-238 is 204 delivery-face commits behind the
  develop tip, so the goal layer's fr"
status: todo
labels:
  - gap
  - routine-filed
  - freshness-refresh
parent: null
children: []
extra: {}
---
## Finding
margin -4 is already negative (d=204 > K=200): the newest carrier evidence for AC-238 is 204 delivery-face commits behind the develop tip, so the goal layer's freshness criterion is already violated and degrades further with every commit; upgrade-face is the only producer whose subjects list contains it.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789621383770` · ts `2026-09-17T05:03:03.770Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`GOAL-009-AC-238`、`upgrade-face`
- 涉及文件：
- `plugin/freshness-producers.json:65`
- `plugin/freshness-producers.json:70`
- `.quay/goal-freshness-margin.json:1`
- `.quay/productization-verification.jsonl`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run upgrade-face (bash plugin/scripts/develop-deliver-tgz.sh --verify-upgrade --upgrade-source <aged-third-party-project> --ac239-e2e --hosts B --force --root <main-checkout>) on host B

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `freshness-goal-009-ac-238-upgrade-face`（routine `freshness-refresh`，runId `freshness-refresh-1789621383770`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-freshness-goal-009-ac-238-upgrade-face.md`