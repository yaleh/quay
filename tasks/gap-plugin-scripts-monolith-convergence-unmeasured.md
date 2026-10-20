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

## Evidence — 复测 2026-10-21 @ HEAD c3d84ce29

### FACT 1 — 规模读数在 HEAD 上复现（新旧两个 scope 一致）

| 读数 | scope b4f87b21（2026-10-20T16:22Z，stale） | scope f2ded294（2026-10-20T17:14Z，fresh @ c3d84ce29） |
|---|---|---|
| plugin/scripts 文件数 | 299 | 299 |
| plugin/scripts 实体数 | 4449 | 4449 |
| plugin/scripts fan-out | 2971 | 2971 |
| plugin/scripts fan-in | 0 | 0 |
| packages/quay/src 实体数 | 663 | 663 |
| packages/quay/src fan-out | 558 | 558 |

4449 / 663 = 6.71。复现方式：对仓库根跑 `archguard_analyze(lang=typescript)` 得到新 scope key，再调 `archguard_get_package_stats` + `archguard_get_package_metrics`（f2ded294 即本轮在任务 worktree 上的重跑，`staleness.status=fresh`，head=c3d84ce29722）。

附加实测（同一产物）：plugin/scripts 恰有 299 个 `.ts` 文件、合计 188,258 行；package 读数只统计 `.ts`（目录中的 `.sh` 不计入），所以“299 文件”= 299 个 `.ts`。

### FACT 2 — 前 3 条位置证据（按文件位置枚举，非关键词匹配）

来源：`.archguard/query/f2ded294/arch.json` 的 `entities[].sourceLocation`，取实体 id 前缀为 `plugin/scripts/` 的文件按路径排序后的前 3 个位置：

1. `plugin/scripts/ac56-recommended-deordered-check.ts:71-114` — 实体 `checkRecommendedDeordered`（function，该文件共 3 个实体）
2. `plugin/scripts/ac61-staleness-disposition-check.ts:254-259` — 实体 `Ac61Result`（interface，该文件共 14 个实体）
3. `plugin/scripts/ac69-slot-queue-gap-check.ts:107-136` — 实体 `checkRecord`（function，该文件共 4 个实体）

### FACT 3 — fan-out 2971 不是 2971 条跨包依赖（仪器语义）

按 archguard 自己的计数规则（`src/analysis/package-metrics-analysis.ts`：`extractPackageName()` 取 relation target 字符串最后一个 `/` 或 `.` 之前的部分；`computePackageFanMetricsFromRelations()` 只在 src 包与 tgt 包不同名时计入 fan-out），把 2971 条 `source` 在 plugin/scripts 的跨“包”关系按 target 的**实际声明位置**重新归类：

| 归类 | 关系数 | 说明 |
|---|---|---|
| target id 编码了真实内部包 | 143 | 真跨包（dependency 133 / composition 9 / inheritance 1） |
| target 是裸名，且该名字只声明在 plugin/scripts | 1898 | **包内引用被计成跨包** |
| target 是裸名，且该名字只声明在另一个真实包 | 1 | 真跨包 |
| target 是裸名，索引里查无声明 | 861 | 多为类型表达式（`readonly string`、`ArrayBufferLike`、`readonly Record<string, unknown>` 等）或外部类型，根本不是包 |
| target 是裸名，声明在 ≥2 个包 | 68 | 归属不确定 |
| 合计 | 2971 | |

即：确定的真跨包关系 = 143 + 1 = **144 条（4.8%）**，再加最多 68 条归属不明的，仍不足 7.2%。原因不是猜测：TypeScript 索引里 relation 的 target 大量是裸实体名（`Ac61Result`、`ClassificationVerdict`、`readonly string`），`extractPackageName()` 就把这些名字本身当成了“包名”，于是同一目录内的引用被计入 fan-out。

负控制（零计数的配套半边）：同一个谓词在 `packages/quay/src` 上返回 fanIn=203，说明 “fanIn” 这项读数并非恒零的仪器故障。plugin/scripts 的真实入向引用 = 32 条，且 32 条全部来自 `archive/2026-09-07-zero-call-scripts/plugin/scripts`（归档副本）——活代码确实不 import plugin/scripts。

### FACT 4 — Finding 里「单文件 2971 出度」不成立

2971 是 package 级（299 个文件合计）读数。同一产物中 plugin/scripts 内单实体的最大出度是 44（`run`，`plugin/scripts/full-suite-runner.ts:3065`），全仓库单实体最大出度也是 44。所以“单文件 2971 出度的实际代价”这个待测前提不存在；真实的单实体最大出度比它小两个数量级。

### JUDGMENT — 是否值得立一个收敛 program

- **fan-out 不能作为立项依据（受本条 finding 自己的反事实检验）**：本条 finding 预设「若 fan-out 高并不导致真实代价，则结论不同」。实测结果正是这个反事实成立的情形——2971 中 96% 以上不是跨包耦合（1898 条是包内引用、861 条根本不是包），确定真跨包只有 144 条。按预设判据，结论必须不同：不能用 fan-out 读数证明“未分化巨无霸”的耦合代价。
- **规模本身仍是 FACT**：299 个 `.ts` / 4449 实体 / 188,258 行 / 实际 fan-in ≈ 0（活代码不消费它），这刻画的是一个**扁平的入口/工具层**，而不是“被很多包依赖的库”。它是否是问题，仍取决于尚未直接测量的成本：重复实现、同名概念多处实现、互相覆盖、变更冲突率。
- **结论（JUDGMENT，非 FACT）**：以现有证据**不立项**。若将来要立，前置条件不是再引用 package fan-out，而是先直接测上面那几类成本；在该测量出来之前，本 finding 维持“结构规模已知、代价未知”的状态。

## Acceptance Criteria

- [x] 「299 文件 / 4449 实体 / 2971 fan-out」与 archguard_summary（scope b4f87b21）或等价结构仪器的当前读数一致，引用时贴出前 3 条命中证据（按位置判定，非关键词）。
- [x] 判断标注 FACT / JUDGMENT，且「收敛是否值得立项」明确为 JUDGMENT，附「若 fan-out 高并不导致真实代价，则结论不同」的反事实对照。

## Definition of Done

- 两条 AC 全绿；finding 落地为 done，实测规模读数可独立复核（重跑 archguard summary 或读 .archguard/output 产物）。
- 不实现收敛、不开 goal；是否立项另行决定。

## Touches

- tasks/gap-plugin-scripts-monolith-convergence-unmeasured.md
- plugin/scripts/ready-pool-check.ts
- plugin/scripts/driver-runtime.ts