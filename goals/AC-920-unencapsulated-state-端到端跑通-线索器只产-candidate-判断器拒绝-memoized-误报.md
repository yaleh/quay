---
id: AC-920
title: unencapsulated-state 端到端跑通：线索器只产 candidate、判断器拒绝 memoized 误报并确认真状态簇
status: draft
kind: criterion
goal: GOAL-911
criterion: node --test plugin/test/unencapsulated-state-admission.test.mjs 2>&1 | tail -6
expect: 正向：`plugin/test/unencapsulated-state-admission.test.mjs` 全绿（exit
  0），断言三件事：(1) 线索器（`plugin/scripts/unencapsulated-state-clue.ts`）对 fixture
  里的两个模块——一个 memoized-cache 误报、一个真状态簇（如 serve-dashboard 的 snapshot 簇形状）——都输出
  `state:"candidate"`，**从不**输出 `confirmed`；(2) 判断器（经 recorded-verdict
  replay，不调用真实 LLM）对 memoized-cache 误报输出 `refuted`、对真状态簇输出 `confirmed`，且
  `confirmed` 的记录带「若不为真则结果不同」的对照理由；(3) 被 `confirmed` 的候选走 Planner 的
  `semantic-judged` 分派路径（不经过 mechanical 的 delta 判定）。反向（能取假）：把判断器对 memoized-cache
  的 verdict 从 `refuted` 改成 `confirmed`，测试红；把线索器输出改成
  `confirmed`，测试红（线索器词表里根本没有这个值）。
origin: GOAL-911 设计：unencapsulated-state 作为第一个 semantic-judged kind
  端到端跑通，含负对照（判断器拒绝 memoized/计数器/注册表误报）
---
