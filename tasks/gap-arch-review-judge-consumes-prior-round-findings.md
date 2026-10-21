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

- [ ] judge prompt/输入含上一轮 arch-review-round 的 findings 清单，且输出里对每条 prior finding 有 survived/resolved/denied 三态（可 grep 判词载体核对）。
- [ ] 「resolved/denied 的判定依据」标注为 current-source 核对结果（带 file:line 或 grep 命中），不是「存在 done 任务」的引用。

## Definition of Done

- 两条 AC 全绿；runArchitectureReview 产出的一条新 round 记录里含逐条 prior-finding 三态（贴出前 3 条）。
- 改动经 scripts/test.sh 相关泳道通过，合并进 develop。

## Touches

- tasks/gap-arch-review-judge-consumes-prior-round-findings.md
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/architecture-review-cluster.ts
- plugin/test/quality-gate-driver.test.mjs
- plugin/test/architecture-review-cluster.test.mjs