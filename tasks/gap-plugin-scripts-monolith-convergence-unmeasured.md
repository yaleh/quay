---
id: gap-plugin-scripts-monolith-convergence-unmeasured
title: plugin/scripts 仍是 4449 实体 / 2971 fan-out 的未分化巨无霸 —— 实测当前规模 + 判断是否值得立项收敛
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

实测（fresh archguard scope b4f87b21 @ HEAD 75198f775，2026-10-21）：plugin/scripts = 299 文件 / 4449 实体 / fan-out 2971 / fan-in 0，是 packages/quay/src（663 实体 / 558 fan-out）的约 6.7 倍；archguard_summary 的 topByOutDegree 多落在此层或其消费侧。历史 done 任务（gap-crosscut-checks-zero-coverage-of-plugin-scripts、gap-arch-import-graph-check 等）各自修的是个别缺口（静态检查覆盖、import 棘轮），没有一条以「plugin/scripts 整体收敛」为对象。判断（JUDGMENT）：巨无霸是今天实测仍在的结构事实，不因历史 done 任务而消失；但它是否值得立一个收敛 program，取决于尚未测量的成本结构（重复实现、互相覆盖、单文件 2971 出度的实际代价）。本 finding 只记录实测规模与这个待测问题，不实现收敛、不开 goal。

## Acceptance Criteria

- [ ] 「299 文件 / 4449 实体 / 2971 fan-out」与 archguard_summary（scope b4f87b21）或等价结构仪器的当前读数一致，引用时贴出前 3 条命中证据（按位置判定，非关键词）。
- [ ] 判断标注 FACT / JUDGMENT，且「收敛是否值得立项」明确为 JUDGMENT，附「若 fan-out 高并不导致真实代价，则结论不同」的反事实对照。

## Definition of Done

- 两条 AC 全绿；finding 落地为 done，实测规模读数可独立复核（重跑 archguard summary 或读 .archguard/output 产物）。
- 不实现收敛、不开 goal；是否立项另行决定。

## Touches

- tasks/gap-plugin-scripts-monolith-convergence-unmeasured.md
- plugin/scripts/ready-pool-check.ts
- plugin/scripts/driver-runtime.ts