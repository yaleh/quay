---
id: gap-ci-red-release-model-check-catalog-row-misaligned
title: capability-catalog 的 release-model-check.ts 声明行四字段错位致 AC5/band 与 ①②③④ 双红
status: todo
labels:
  - gap
  - ci-red
  - defect
parent: null
children: []
extra: {}
---
## Proposal

develop CI 自 10-21 起恒红。两个确定性红在 `plugin/test/capability-catalog.test.mjs`：
`AC5/band — unclassified == 0`（question 必须是具体句子）与 `①/②/③/④ — 每行携带
cadence/失效前提/last-reaffirmed/matching`（cadence 必须五枚举之一）。两者都指向
`plugin/scripts/capability-catalog-declarations.json` 里 `release-model-check.ts` 这一行：四个字段整体
错位一格——question 文本落在了 CADENCE 槽、日期 "2026-10-23" 落在了 QUESTION 槽、"position" 落在了
LAST_REAFFIRMED 槽、"谁按" 文本落在了 MATCHING 槽，cadence 值（每轮）在引入提交 a08fd4420 时被
写进了 MATCHING 槽后又被覆盖。

## Plan

把 `release-model-check.ts` 的五个字段归位：QUESTION=原 CADENCE 里的问句；CADENCE=每轮；
LAST_REAFFIRMED=2026-10-23；MATCHING=position；CONSUMER=原 MATCHING 里的「谁按」文本。
INVALIDATION 本已正确，不动。

## AC

- [x] `capability-catalog.test.mjs` 的 AC5/band 与 ①/②/③/④ 两测本地全绿（实测 4/4 pass）。
- [x] 该行 QUESTION/CADENCE/LAST_REAFFIRMED/MATCHING/CONSUMER 五槽全部取正确值，其余行未动。

## DoD

修复提交（377000a60）落地后，capability-catalog 的两个红消失，develop CI test job 不再出现
release-model-check.ts 的 unclassified/cadence 断言失败。