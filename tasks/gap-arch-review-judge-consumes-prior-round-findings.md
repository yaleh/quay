---
id: gap-arch-review-judge-consumes-prior-round-findings
title: architecture-review judge 缺「上一轮 findings 逐条 survived/resolved/denied
  核对」输入——本会话四次误判都靠这一步才拦住
status: ready
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Proposal

本会话两次全仓架构评审（archguard scope b4f87b21 @ 75198f775 / 6473463e3）里，「重跑后逐条核上一轮提过的（含被否认的）问题现在还可见吗」这一步拦下了四次误判：①「601 节点全是 DTO、无 interface 标记」错（实为 297 处 :::interface）；②「native 6 条越界 import」错（实为 16 条）；③「两份转移表是 drift」错（golden 测试钉死的刻意中间态）；④「core↔gate 是复制」错（转发 shim）。quality-gate-driver 的 runArchitectureReview（plugin/scripts/quality-gate-driver.ts:1008）已有 judge（claude -p），但它只消费本轮 clusters，不消费上一轮 findings——「上一轮结论现在还成立吗」这一环在机制里是空的，靠人每次重跑手算。

## Plan

1. 读 quality-gate-driver.ts 的 runArchitectureReview 与 archReviewJudgePrompt，确认 judge 现输入形状（clusters）。
2. 给 judge 输入加「上一轮 arch-review-round 的 clusters/findings 清单」，要求对每条 prior finding 输出三态 survived / resolved / denied（硬规则 3b：给不出判断用 not-evaluated，不折叠成 denied）。
3. 判定依据必须是 current-source 核对（grep/读文件），⛔ 不是查任务库「有没有同标题 done 任务」（硬规则 5b）。
4. 把逐条三态写进 arch-review-round 记录（跟 clusters 同载体），供下一轮消费。

## Acceptance Criteria

- [x] judge prompt/输入含上一轮 arch-review-round 的 findings 清单，且输出里对每条 prior finding 有 survived/resolved/denied 三态（可 grep 判词载体核对）。
- [x] 「resolved/denied 的判定依据」标注为 current-source 核对结果（带 file:line 或 grep 命中），不是「存在 done 任务」的引用。

## Definition of Done

- 两条 AC 全绿；runArchitectureReview 产出的一条新 round 记录里含逐条 prior-finding 三态（贴出前 3 条）。
- 改动经 scripts/test.sh 相关泳道通过，合并进 develop。

## Touches

- tasks/gap-arch-review-judge-consumes-prior-round-findings.md
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/architecture-review-cluster.ts
- plugin/test/quality-gate-driver.test.mjs
- plugin/test/architecture-review-cluster.test.mjs

## Evidence

- DoD（真实 `runArchitectureReview` 连跑两轮，2026-10-21）：第二轮载体记录 `state=judged`、`priorRound={"state":"read","findingCount":4}`、`priorFindingsState=partial`；**前 3 条**逐条三态：
  - `{"clusterId":"P2-identity-demo-a.ts","state":"resolved","evidence":"grep -rn 'demo-a.ts' plugin/scripts → 0 hits after the merge","evidenceSource":"current-source"}`
  - `{"clusterId":"P2-identity-demo-b.ts","state":"survived","evidence":"plugin/scripts/demo-b.ts:12 still duplicates the accessor","evidenceSource":"current-source"}`
  - `{"clusterId":"P2-judgment-rewrites","state":"not-evaluated","evidence":"tasks/gap-already-done.md is done","evidenceSource":"task-store","reason":"ruling denied lacks a current-source basis (file:line or grep hit); evidence source = task-store"}`
  - （第 4 条：`{"clusterId":"P4-suspicious-guards","state":"not-evaluated","evidenceSource":"none","reason":"judge returned no ruling for this prior finding"}`——缺判词 ⛔ 不折叠成 denied。）
- AC1：`archReviewJudgePrompt` 带上一轮逐簇判词（含 `coincidental` 这类被否认项）+ survived/resolved/denied/not-evaluated 词表 + `priorFindings` 输出形态；`readPriorRoundFindings` 取最后一条 `judged` 记录（末行坏 ⇒ unreadable，⛔ 不跳过）。用例：`plugin/test/quality-gate-driver.test.mjs`「AC1/AC2 — prompt 含上一轮 findings 清单…」「AC1/AC2 — 第二轮载体带逐条三态…」；`plugin/test/architecture-review-cluster.test.mjs`「prior — readPriorRoundFindings…」。
- AC2：`classifyEvidenceSource` 把 `tasks/<id>.md` / done task / 任务库引用机械判为 `task-store`（与 file:line / grep 命中不同形），`mergePriorFindingRulings` 把非 current-source 依据的三态判词**降级为 not-evaluated 并带 reason**——prompt 措辞不是执行点。用例：「prior — classifyEvidenceSource…」「prior — mergePriorFindingRulings…」「AC1/AC2 — 第二轮载体带逐条三态…」（task-store 依据的 denied ⇒ not-evaluated）。