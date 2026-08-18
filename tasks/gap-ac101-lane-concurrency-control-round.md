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
  depends_on:
    - gap-fan-in-suite-duration-poll-granularity-inflation
---
**type:** execution

## Proposal

**背景（manager 实测 + outer 独立核实，2026-08-17 23:5xZ）**：AC101 600s 目标（人裁定「绝不接受 suite >600s」，宁可不并发多 suite）当前未达标——末 4 次干净单跑真墙钟 738/682/728/609s。609s 的相分解：serial 301.0s(49.7%) + main 255.2s(42.2%) = **556s = 93% 预算**。main 相打包效率 94.4%（sum_ms=1928255 floor=241032 在 concurrency=8 下）——不是调度浪费，是 **lane 数封顶**。

**根因（读代码核实）**：`full-suite-runner.ts:1561 defaultLaneCount()` 与 `scripts/test.sh:999 serial_lowconc_host_default()` 共用 `max(1, floor(nproc × oversub / S))`，`S = QUAY_MAX_CONCURRENT_SUITES` **默认 2**。本机 nproc=16 ⇒ 三相全部 concurrency=8（日志实证）。**即使只跑一个 suite，也永久按「要给第二个 suite 留一半机器」收税**——与人「用并发换时长」的裁定方向相反。

**⚠️ 不投递结论**（硬规则④推论四）：「S 改 1 就能进 600s」需要**对照轮**验证——同 commit、`QUAY_MAX_CONCURRENT_SUITES=1` 跑一次，对比 serial/main 两相。这正是 `gap-fan-in-turn-budget-suite-timeout` 原本要做的 lane 对照实验，而该任务实际落的是回合预算承载（9327056a），**对照轮从未跑过**。

**依赖**：先落 `gap-fan-in-suite-duration-poll-granularity-inflation`（durationMs 必须真实，对照才可信——否则 609 vs 674 的判定差会被读数污染）。

**能取假（⊢ 对照）**：对照轮跑完，若 `QUAY_MAX_CONCURRENT_SUITES=1` 的 serial+main 两相墙钟 + 前置 ≤ 600s（对照 609s 基线），则结论成立 ⇒ 改默认值（S=2→1）+ 落地；若不成立 ⇒ S 不是主因，回 manager 的候选清单继续（serial 301s 整族/文件级清单）。两种结果都是有效产出。

## Plan

1. 等 `gap-fan-in-suite-duration-poll-granularity-inflation` land（durationMs 真实化——对照前提）。
2. **对照轮**：同当前 develop commit，`QUAY_MAX_CONCURRENT_SUITES=1` 跑一次全量 suite（单 suite，无并发），记录 serial/main 两相墙钟 + 总墙钟 + verification-round durationMs。
3. 对比基线（609s 分解：serial 301 + main 255 + 前置 47-68）：S=1 ⇒ concurrency=16 ⇒ main floor 减半（240→120s 理论）。
4. 判定：总墙钟 ≤600s ⇒ 改默认 S=2→1 + 落地；否则回 manager 候选清单（serial 相文件级耗时清单是下一候选）。
5. scoped 门（`--for-task`）+ 全量验证，fan-in（改默认时）。

## Acceptance Criteria

- [ ] AC1: 对照轮跑完——同 commit、`QUAY_MAX_CONCURRENT_SUITES=1` 的单 suite 全量，serial/main 两相墙钟 + 总墙钟 + verification-round durationMs 记录在案。
- [ ] AC2: 判定有产出：≤600s ⇒ 改默认 S=2→1 并落地；>600s ⇒ 记录 serial 301s 的候选路径（文件级清单）为下一候选，不空转。
- [ ] AC3: 对照轮不误伤正常 fan-in（单次实验轮，不并发）。
- [ ] AC4: 测试全绿 + `--for-task` scoped 门绿（若改默认）。

## Definition of Done

- [ ] S=1 对照轮跑完并给出判定（改默认或转 serial 候选），AC101 600s 目标有真实数据支撑的下一步，scoped + 全量绿（若改默认）。

## Touches

- scripts/test.sh（若 AC2 判定改默认：`QUAY_MAX_CONCURRENT_SUITES` 默认 2→1；serial_lowconc_host_default / RESOURCE_GATE_CONCURRENT_SUITES 语义）
- plugin/scripts/full-suite-runner.ts（若 AC2 判定改默认：defaultLaneCount 的 S 默认值）
- plugin/test/full-suite-runner.test.mjs（默认值变化回归）
- experiments/quay-perpetual-stream/（对照轮记录——实验产出，证据段）
- tasks/gap-ac101-lane-concurrency-control-round.md（自身）
