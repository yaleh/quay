---
id: gap-writestate-atomicity-split-torn-negative-control-flaky
title: writestate-atomicity-split「撕裂」负控制断言时序敏感——低负载下撕裂不可观察致断言失败（pre-existing 8 次）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/test/writestate-atomicity-split.test.mjs` 的负控制断言「an in-place write must be observably torn (proves the reader can bite)」（`:3950`）时序敏感失败：期望「撕裂」被观察到、证明 reader 可能读到不一致态；但机器快/负载低时写入原子完成、撕裂不发生 ⇒ 断言失败。pre-existing 高频 flaky（verification-round 历史 8 次）。属 flaky 集群「负控制时序依赖」类（同 outer-session-check「claude child must be alive」、suite-driver），与「超时类」（lowconc=3 已修）不同子类。

**候选修法（需 worker 读该断言设计意图确定）**：
- (a) **强制撕裂**：加大写入尺寸/加竞争，让撕裂可靠发生（若意图是「证明 reader 能 bite」这个能力）；
- (b) **断言改可接受区间**：撕裂或不撕裂都可接受（若意图是「reader 不崩于 torn state」这个鲁棒性）；
- (c) **retry/时序容忍**。

## Plan

1. 读 `writestate-atomicity-split.test.mjs` 的「撕裂」负控制断言设计意图（`:3950` 附近 + 该测试头注释）。
2. 判定意图：证明能力（→ 强制撕裂）vs 证明鲁棒性（→ 可接受区间）。
3. 按意图修断言，使它在低负载/快机器上不再误失败，但保留原验证目标（负控制不退化）。

## Acceptance Criteria

- [ ] AC1（能取假）：低负载/快机器下「撕裂」负控制不再误失败（断言稳定绿）；（⛔ 仍时序失败 ⇒ 假）。
- [ ] AC2（能取假，负控制不退化）：原验证目标（reader 能 bite / 不崩于 torn state）仍被验证——修复不把「撕裂负控制」弱化成恒真；（⛔ 负控制被删成恒过 ⇒ 假）。

## Definition of Done

「撕裂」负控制断言按设计意图修（强制撕裂 / 可接受区间 / retry）；AC1/AC2 勾；低负载下稳定绿；原负控制目标不退化；全量 suite 绿。

## Touches

- plugin/test/writestate-atomicity-split.test.mjs（撕裂负控制断言）
- tasks/gap-writestate-atomicity-split-torn-negative-control-flaky.md（自身）
