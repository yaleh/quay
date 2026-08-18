---
id: gap-ac101-lane-concurrency-control-round
title: AC101 600s 根因对照轮——QUAY_MAX_CONCURRENT_SUITES=1 的 lane 对照实验（serial+main 556s=93% 预算，S=2 默认砍半并发与裁定方向相反）
status: ready
labels:
  - gap
  - experiment
  - performance
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**背景（manager 实测 + outer 独立核实，2026-08-17 23:5xZ）**：AC101 600s 目标（人裁定「绝不接受 suite >600s」，宁可不并发多 suite）当前未达标——末 4 次干净单跑真墙钟 738/682/728/609s。609s 的相分解：serial 301.0s(49.7%) + main 255.2s(42.2%) = **556s = 93% 预算**。main 相打包效率 94.4%（sum_ms=1928255 floor=241032 在 concurrency=8 下）——不是调度浪费，是 **lane 数封顶**。

**根因（读代码核实）**：`full-suite-runner.ts:1561 defaultLaneCount()` 与 `scripts/test.sh:999 serial_lowconc_host_default()` 共用 `max(1, floor(nproc × oversub / S))`，`S = QUAY_MAX_CONCURRENT_SUITES` **默认 2**。本机 nproc=16 ⇒ 三相全部 concurrency=8（日志实证）。**即使只跑一个 suite，也永久按「要给第二个 suite 留一半机器」收税**——与人「用并发换时长」的裁定方向相反。

**⚠️ 不投递结论**（硬规则④推论四）：「S 改 1 就能进 600s」需要**对照轮**验证——同 commit、`QUAY_MAX_CONCURRENT_SUITES=1` 跑一次，对比 serial/main 两相。这正是 `gap-fan-in-turn-budget-suite-timeout` 原本要做的 lane 对照实验，而该任务实际落的是回合预算承载（9327056a），**对照轮从未跑过**。

**执行路径（必须，2026-08-18 00:2xZ manager 反向意见采纳）**：**对照轮与基线两侧均须经 `full-suite-runner` 直调**（不走 fan-in 写入路径）。依据：
- `full-suite-runner.ts:3293` 的 `durationMs = Date.parse(finishedAtIso) - Date.parse(startedAt)`，`finishedAtIso = new Date()` 在 suite 结束当场取——**自己的钟，全程无轮询** ⇒ `gap-fan-in-suite-duration-poll-granularity-inflation`（fan-in 分支 0-60s 虚高）对直调路径**不适用**；
- 富字段（相耗时 + nproc/concurrentSuiteSlots/concurrentSuitesRunning）本就是 `full-suite-runner.ts:3632` 写的 ⇒ `gap-fan-in-verification-round-thin-schema-phase-gap` 对直调路径**不适用**。
⇒ **两条前置缺陷都只存在于 fan-in 写入路径；两侧直调则两条都不碰，对照轮不依赖它们**。`gap-fan-in-suite-duration-poll-granularity-inflation` 与 `gap-fan-in-verification-round-thin-schema-phase-gap` 作为**独立机制缺陷**照常修（修的是常态 fan-in 轮的可观测性，与对照轮解耦），但**不是本任务的 depends_on 前置**（原 depends_on 会被 slot-refill step-4 deps-ready 压在池里，AC3 的「两侧直调」出口根本走不到——判据写了出口，派发机制不认它）。

**能取假（⊢ 对照）**：对照轮跑完，若 `QUAY_MAX_CONCURRENT_SUITES=1` 的 serial+main 两相墙钟 + 前置 ≤ 600s（对照 609s 基线），则结论成立 ⇒ 改默认值（S=2→1）+ 落地；若不成立 ⇒ S 不是主因，回 manager 的候选清单继续（serial 301s 整族/文件级清单）。两种结果都是有效产出。

**⚠️ 执行顺序前置（2026-08-18 注记，gap-suite-concurrency-ff-gate-and-slot-ssot 落地后）**：本任务设 S=1 的对照轮**必须先等** `gap-suite-concurrency-ff-gate-and-slot-ssot` 的层 2（槽数由 S 生成）落地——**否则设 S=1 得到的仍是「2 槽 × 16 lane = 32 lane 超订」**（槽文件写死 `.0/.1`、lane 除数按 S 算但槽不联动），对照轮测错对象。层 2 落地后 S=1 才真正单槽单 lane 集（仅 `.0`、lane=nproc×oversub/1）。

## Plan

1. **对照轮（两侧直调 full-suite-runner，不依赖 fan-in 路径）**：同当前 develop commit，`QUAY_MAX_CONCURRENT_SUITES=1` 直调 `full-suite-runner` 跑一次全量 suite（单 suite，无并发，S=1）；同 commit、`S=2`（默认）直调跑**基线对照**。两侧各自记录 serial/main 两相墙钟 + 总墙钟 + verification-round durationMs（rich-schema）。
2. **同 commit 同负载**：对照轮与基线必须同 commit、同负载（nproc/load 记录在案）——「同口径」（同一 writer）与「同负载」是两条独立轴，都须满足。
3. 对比基线（609s 分解：serial 301 + main 255 + 前置 47-68，同口径 S=2 直调复核）：S=1 ⇒ concurrency=16 ⇒ main floor 减半（240→120s 理论）。
4. 判定：总墙钟 ≤600s ⇒ 改默认 S=2→1 + 落地；否则回 manager 候选清单（serial 相文件级耗时清单是下一候选）。
5. scoped 门（`--for-task`）+ 全量验证，fan-in（改默认时）。

## Acceptance Criteria

- [ ] AC1: 对照轮跑完——同 commit、`QUAY_MAX_CONCURRENT_SUITES=1` 的单 suite 全量，serial/main 两相墙钟 + 总墙钟 + verification-round durationMs 记录在案。
- [ ] AC2: 判定有产出：≤600s ⇒ 改默认 S=2→1 并落地；>600s ⇒ 记录 serial 301s 的候选路径（文件级清单）为下一候选，不空转。
- [ ] AC3: **对照轮与基线两侧均经 `full-suite-runner` 直调**（同一 writer/同口径——rich-schema 相字段 + nproc/concurrentSuiteSlots 两侧都有）；**不依赖** `gap-fan-in-suite-duration-poll-granularity-inflation` / `gap-fan-in-verification-round-thin-schema-phase-gap`（两者只影响 fan-in 写入路径，对直调路径不适用）；不用 fan-in 落地行做基线（round227 落噪声带）。
- [ ] AC4: 对照轮不误伤正常 fan-in（单次实验轮，不并发；与在飞 fan-in suite 不并行）。
- [ ] AC5: 测试全绿 + `--for-task` scoped 门绿（若改默认）。

## Definition of Done

- [ ] S=1 对照轮跑完并给出判定（改默认或转 serial 候选），AC101 600s 目标有真实数据支撑的下一步，scoped + 全量绿（若改默认）。

## Touches

- scripts/test.sh（若 AC2 判定改默认：`QUAY_MAX_CONCURRENT_SUITES` 默认 2→1；serial_lowconc_host_default / RESOURCE_GATE_CONCURRENT_SUITES 语义）
- plugin/scripts/full-suite-runner.ts（若 AC2 判定改默认：defaultLaneCount 的 S 默认值）
- plugin/test/full-suite-runner.test.mjs（默认值变化回归）
- experiments/quay-perpetual-stream/lane-concurrency-control-round.md（对照轮记录——实验产出，证据段；具体文件，非 `**`，避免命中 SHARED_STATE_PATHS 被 assembleBatch 序列化）
- tasks/gap-ac101-lane-concurrency-control-round.md（自身）
