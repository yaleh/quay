---
id: gap-routine-freshness-refresh-stale-subject-goal-009-ac-203
title: "freshness-refresh: 28.5% of the window is left (margin 57 of K=200) and
  margin/K is at/below the 0.2925 threshold: at the worst observed delivery-face
  burst (25 commits/h) the rema"
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
28.5% of the window is left (margin 57 of K=200) and margin/K is at/below the 0.2925 threshold: at the worst observed delivery-face burst (25 commits/h) the remaining margin is consumed in 2.34h (2.34*25 = 58.5 > 57), i.e. before a coldstart-face run started now could finish.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `freshness-refresh` · probe `freshness-refresh` · runId `freshness-refresh-1789704102583` · ts `2026-09-18T04:01:42.583Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`coldstart-face`、`develop-deliver-tgz.sh`
- 涉及文件：
- `.quay/productization-verification.jsonl`
- `.quay/goal-freshness-margin.json`
- `plugin/freshness-producers.json`
- kind：`stale-subject`
- verdict：`act-now`

## Requested action
re-run coldstart-face on hosts B and C: bash plugin/scripts/develop-deliver-tgz.sh --verify-coldstart --ac207-e2e --hosts "B C" --force --root <main-checkout>

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `stale-subject-goal-009-ac-203`（routine `freshness-refresh`，runId `freshness-refresh-1789704102583`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/freshness-producers.json`
- `tasks/gap-routine-freshness-refresh-stale-subject-goal-009-ac-203.md`