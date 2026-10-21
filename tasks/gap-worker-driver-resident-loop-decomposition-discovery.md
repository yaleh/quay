---
id: gap-worker-driver-resident-loop-decomposition-discovery
title: worker-driver.ts 7266 行 / runResidentLoop@6017 出度 30 是 loop
  生产核心最大单体——把四关注点与出度图落到可查询载体（后续切片 goal 的输入）
status: ready
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Finding

实测（archguard scope b4f87b21 @ HEAD 6473463e3）：plugin/scripts/worker-driver.ts 全长 7266 行，其中 runResidentLoop 定义于第 6017 行、出度 30（archguard_summary topByOutDegree 第 3 位，仅次于 run=39 / handleAllRoutes=35）。同层 goal-driver.ts 5059 行、full-suite-runner.ts >3065 行。对照：packages/quay/src/serve-handlers.ts 曾是 3559 行 monolith，已按关注点拆成 22 个 serve-*.ts、现 349 行——同一仓库内已有验证过的分割模板。判断（JUDGMENT）：worker-driver.ts 的 runResidentLoop 同时装着四个关注点（状态机 retryState/counts/needsHuman、派发决策 slot-refill/claim/ready-pool、派发执行 spawn/fan-in、落账 outcome ledger），是本层最大的单体；但它是否值得按片拆、按什么边界拆，取决于尚未落到可查询载体的出度/关注点清单。本 finding 只做「把四关注点 + 函数出度图落到任务体」这件事，不实现拆分、不开 goal。

<!-- dedup-ref --> 关联（非重复）：gap-plugin-scripts-monolith-convergence-unmeasured（done）已对 plugin/scripts 整体做包级收敛判断并结论不立项；本条是同一领域的单文件切片发现（worker-driver.ts 的 runResidentLoop 出度 30 与四关注点），机制不同，不与其合并。

## Acceptance Criteria

- [ ] 把 runResidentLoop 的函数出度读数（archguard summary topByOutDegree）与 worker-driver.ts 的四关注点清单（状态机/派发决策/派发执行/落账，各附该关注点代码的行号区间）落到本任务 body，并贴出前 3 条按位置核对的证据。
- [ ] 判断标注 FACT / JUDGMENT，且「是否值得拆分、按什么边界」明确是 JUDGMENT，附「若 7266 行单体并不导致真实代价，则结论不同」的反事实对照。

## Definition of Done

- 两条 AC 全绿；出度读数可独立复核（重跑 archguard summary 或读 .archguard/output 产物），四关注点的行号区间可 grep 核对。
- 不实现拆分、不开 goal；是否立切片 goal 另行决定。

## Touches

- tasks/gap-worker-driver-resident-loop-decomposition-discovery.md
- plugin/scripts/worker-driver.ts
