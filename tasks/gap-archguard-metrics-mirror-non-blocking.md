---
id: gap-archguard-metrics-mirror-non-blocking
title: mirrorArchguardMetrics 镜像写不得阻塞 fan-in——结构闸判定与 metrics 镜像解耦
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

审计命中（gap-observability-blocks-main-execution-audit 实锤 2）：`mirrorArchguardMetrics`（worker-driver.ts:2326）——`if (!mirrored.ok) return failClean("archguard-metrics", ...)`。archguard **结构闸**（依赖环 sccCount=0 ⇒ 绿）本身是执行判定，该挡；但 metrics 从 worktree 镜像到生产载体是**观测**（注释自认「AC2：能产出≠已产出」），其写失败阻塞落地——违反人 2026-08-30 裁定。

修复：结构闸的**判定**与 metrics **镜像写**解耦——判定来自 archguard-runner 的分析结果/退出（执行语义，失败仍挡）；镜像写 fail-open（写失败 WARN + 事件，不 failClean）。后续重试/修复时镜像可补。

## Plan

1. 定位 mirrorArchguardMetrics 的失败语义：把「结构判定」（依赖 archguard-runner 分析，须挡）与「metrics 载体写」（观测，须 open）拆开。判定在 archguard-structure 步（:2318-2320 `fail("archguard-structure")`）已挡；metrics 镜像步改为 best-effort。
2. 镜像写失败 ⇒ WARN（stderr + fan-in 日志），不 `failClean("archguard-metrics")`。
3. 测试：结构闸绿但镜像写失败（mock/mkdir 失败）⇒ fan-in 继续；结构闸红 ⇒ 仍 fail（执行语义不回归）；正常路径镜像照常写。

## Acceptance Criteria

- [x] AC1（能取假，负控制）：结构闸绿 + 镜像写失败（mock）⇒ fan-in 不因镜像失败 fail，继续到 scoped-gate。
- [x] AC2（能取假，执行语义不回归）：结构闸红（依赖环）⇒ 仍 failClean，不因镜像 open 而放宽。
- [x] AC3（能取假，回归）：正常路径 metrics 镜像照常写到生产载体。

## Definition of Done

metrics 镜像写失败不再阻塞 fan-in（fail-open + WARN）；结构闸判定语义原样保留；正常路径镜像不回归。

## Touches

- plugin/scripts/worker-driver.ts（mirrorArchguardMetrics 步 fail-open）
- plugin/test/worker-driver.test.mjs（镜像失败负控制 + 结构闸红正控制）
- tasks/gap-archguard-metrics-mirror-non-blocking.md（自身）