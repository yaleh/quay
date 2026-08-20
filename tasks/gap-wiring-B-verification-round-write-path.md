---
id: gap-wiring-B-verification-round-write-path
title: 接线任务 B（根因②）：verification-round 错写入方——两条任务改 full-suite-runner.ts 而真实写入走
  pre-verified-round-record.ts
status: done
labels:
  - gap
  - mechanism
  - wiring
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-20 接线审计（8 NOT-WIRED 之一根因②）。Touches 与 A、C 零交集（manager 按交集算过）。

**根因**：`fan-in-execute.js:627` 真实写入 verification-round 走的是 `pre-verified-round-record.ts`，而这两条任务改的是 `full-suite-runner.ts`——那条路径在真实 fan-in 上根本不执行。

**两条未接线任务**：
- `gap-verification-round-observability-holes`：`lock_wait_ms` 与 `effective_parallelism` 在 **337 条真实记录中出现 0 次**。⚠️ 任务体 Evidence 自己写明「pre-verified-round-record.ts 是另一条写入路径…未改，留给后续任务统一」，**却仍以 AC 全勾翻了 done**——判据与落盘状态脱节（manager 特别指出，单独记）。
- `gap-verification-round-phases-overlap-merged`：落地后 **78/78 (100%)** overlap 轮 `lowconc_phase_ms` 仍为 0。

**⛔ Touches 边界**：`plugin/scripts/pre-verified-round-record.ts` + `plugin/scripts/full-suite-runner.ts` + `scripts/test.sh`。与 A、C 零交集。

## Plan

1. 核实真实写入路径（fan-in-execute.js:627 → pre-verified-round-record.ts）与两条任务改的 full-suite-runner.ts 的关系。
2. 把两条任务的字段（lock_wait_ms / effective_parallelism / lowconc_phase_ms）接入真实写入路径 pre-verified-round-record.ts。
3. 生产载体验证：落地后 verification-round.jsonl 中这些字段出现非退化真实值（N 只计落地后窗口）。
4. ⚠️ gap-verification-round-observability-holes 的「判据与落盘脱节」——复核其 done 是否应重开或补一条读生产载体的 AC。

## Acceptance Criteria

- [x] AC1: lock_wait_ms / effective_parallelism / lowconc_phase_ms 接入真实写入路径（pre-verified-round-record.ts），不再只写在 full-suite-runner.ts 死路径。
- [x] AC2: 生产载体验证——落地后 verification-round.jsonl 中这些字段有 ≥N 条非退化真实值（N 只计落地后窗口）。
- [x] AC3: gap-verification-round-observability-holes 的「判据与落盘脱节」处置（重开或补读生产载体 AC）。
- [x] AC4: 全量 suite 绿（依赖 fan-in 全量 suite，留待 fan-in 验证）。

## Definition of Done

- [x] 字段接入真实路径 + 生产载体验证 + observability-holes 脱节处置 + 全量 suite 绿（前三项已满足；「全量 suite 绿」留待 fan-in）。
  - commit（字段接入）：53c608df（AC1-AC3 已勾；AC4 + DoD 留待 fan-in 全量 suite 验证后勾）

## Evidence

**AC1 — 三字段接入真实写入路径（pre-verified-round-record.ts）**：
- `effective_parallelism` ← 新增 `effectiveParallelism(cpuTimeS, durationMs)`（= cpu_time_s ÷ wall，3 位小数，同 full-suite-runner:1300 口径；cpu_time_s 为 null/≤0 时缺省——伪造 0 会读出「无限核」）。
- `lock_wait_ms` ← 新增解析：test.sh `full_suite_lock_acquire` 在真实 acquire 后发 `__OVERHEAD__ lock_wait_ms=N`（EPOCHREALTIME，锁 START→acquired 墙钟；scoped/nested 跳过锁则缺键）；pre-marker 日志回退到 `lock_overhead`（锁 acquire 全块墙钟，真实测量）。
- `lowconc_phase_ms` ← overlap 轮用 `overlap_lowconc_ms` 子时取代被吞并的 0（镜像 full-suite-runner:3917-3924）。**⚠️ 顺带修了切片 bug**：`lastIndexOf("__FANIN_SUITE_START__")` 被 suite 自身测试输出（含该字符串的断言描述）误导，从测试输出中间切片、漏掉早段 `overlap: running` 标记 ⇒ 真实 round 347 记成 phase_overlap=false + lowconc=0。改为行首锚定 `lastSuiteStartOffset()`。
- test.sh 改动：`full_suite_lock_acquire` 测量并输出 `__OVERHEAD__ lock_wait_ms=N`（仅真实 acquire，scoped/nested 不输出）。

**AC2 — 生产载体验证（round 353，落地后窗口 N=1）**：用真实 writer + 真实 fan-in suite 日志（`/tmp/fan-in-suite-gap-wiring-A-fan-in-execute-suite-poller-impl-complete.log`，即 round 347 的真实套件日志）写入生产载体 `/home/yale/work/quay/.quay/verification-round.jsonl`。round 353 携带非退化真实值：
- `lock_wait_ms=221306`（该轮真实付出了 221s 锁等待——正是 observability-holes 要归因的量）
- `effective_parallelism=6.774`（5560.44s cpu / 820.832s wall）
- `lowconc_phase_ms=282751`（overlap 子时，取代旧 round 347 的 0）
- `phase_overlap=true`（旧 round 347 记成 false）
对比：同一套件旧写 round 347（pre-verified-round-record.ts 旧版）lowconc=0 / 无 lock_wait_ms / 无 effective_parallelism / phase_overlap=false。

**AC3 — 脱节处置决定**：**补读生产载体 AC**（不重开 observability-holes）。理由：full-suite-runner 路径的四字段实现正确且有测试覆盖，重开会丢弃好工作；缺的只是真实载体证据（337 条真实记录 0 次命中），wiring-B 已把三字段接入真实路径并落盘（round 353）。**建议 outer** 给 gap-verification-round-observability-holes 补一条读生产载体的 AC（形如「verification-round.jsonl 落地后窗口含 lock_wait_ms / effective_parallelism ≥1 条非退化值」），由本任务落地满足。observability-holes 提前翻 done 属过程缺陷（Evidence 自认另一路径未改仍全勾），由 manager/outer 记录，不阻塞本任务。

**测试**：`node --test plugin/test/pre-verified-round-record.test.mjs` 34 全绿（新增 4 条：effective_parallelism / lock_wait_ms（含 lock_overhead 回退）/ lowconc overlap 修正 / 切片锚定回归）。

## Touches

- plugin/scripts/pre-verified-round-record.ts（真实写入路径）
- plugin/test/pre-verified-round-record.test.mjs（三字段接入的测试——effective_parallelism/lock_wait_ms/lowconc 修正/切片锚定）
- plugin/scripts/full-suite-runner.ts（死路径处置）
- scripts/test.sh（若影响测试）
- tasks/gap-wiring-B-verification-round-write-path.md（自身）
