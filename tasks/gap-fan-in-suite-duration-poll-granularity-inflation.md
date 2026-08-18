---
id: gap-fan-in-suite-duration-poll-granularity-inflation
title: fan-in 的 wall_ms 用「轮询发现 exit marker 时刻」而非「suite 真结束时刻」——verification-round durationMs 系统性虚高（最高 +60s），污染 AC101 600s 判定（round232 实证 +65.1s）
status: ready
labels:
  - gap
  - defect
  - instrumentation
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（manager 实测 + outer 独立核实，2026-08-17 23:5xZ）**：`verification-round.jsonl` 的 `durationMs`（AC101 600s 判定、`/tests` 页、成本分析的数据源）被 fan-in 的轮询粒度**系统性抬高**。实证（gap-fan-in-fix-commit-delta-escapes-touches-coverage 的 suite）：
- exit marker mtime `23:07:41.89`，真墙钟 **609.1s**
- ledger round 232 记 **674.2s**（durationMs=674186）⇒ **虚高 65.1s**
- ⚠️ 609s 与 674s 分落「差 9s 达标」与「超 12%」两侧——**判定可能正在用被抬高的数，使 suite 看起来比实际更慢**。

**根因（读 fan-in-execute.js 核实）**：`fan-in-execute.js:102` `pollIntervalMs = 60_000`（脚本 setTimeout 轮询间隔）；`wall_ms=$((end_ms - start_ms))`（:145）的 `end_ms` 由**轮询 agent 发现 exit marker 时**取（`date +%s%3N`），不是 suite 真结束时刻。marker 在两次轮询之间写好 ⇒ 发现时刻最多晚 60s ⇒ durationMs 系统性虚高 0-60s。

**影响**：AC101 600s 目标判定、suite 趋势账本、成本分析全部吃这个偏置——「suite 到底慢没慢」的判断在噪声带里失真；人的「600s 不可突破」裁定与「优化有没有效果」都被污染的读数蒙蔽。与 `gap-suite-cost-model-is-wrong-optimizations-buy-nothing`（17-63s 噪声带记载）同族但更具体：这是**测量时刻错误**，不是负载噪声。

**能取假（⊢ 对照）**：修复后，一次真跑 suite 的 verification-round `durationMs` 与该 suite 的真墙钟（`.log` birth→mtime 或 exit marker mtime − start）一致（±轮询间隔内），不再系统性高 0-60s。

## Plan

1. 读 fan-in-execute.js step 4/4.5 的 poll 段（:145 `wall_ms`、:155 `end_ms` 写入、poll agent 读取逻辑）。
2. 修法（低成本，二选一）：
   - **① end_ms 取 exit marker 的 mtime**：detached 段写 marker 时把 `end_ms` 一并写进 marker（`printf 'end_ms=%s' $(date +%s%3N)` 在 suite 进程退出时刻），轮询只读不重算——零粒度损失；
   - **② 轮询 agent 发现 marker 时用 `stat -c %Y` 取 marker mtime**——不改造 detached 段，但 stat 粒度是秒（%Y）非毫秒。
   倾向 ①（毫秒级、detached 侧写入是唯一准确时刻）。
3. 确认 per-task-suite-record 与 pre-verified-round-record 的 durationMs 语义一致（同样别用轮询发现时刻）。
4. 对照实测：一次真跑 fan-in → durationMs 与真墙钟一致（±poll 间隔内）。
5. scoped 门（`--for-task`）+ 全量验证，fan-in。

## Acceptance Criteria

- [ ] AC1: verification-round 的 `durationMs` 不再系统性虚高——真跑 suite 的墙钟（marker mtime − start 或 log birth→mtime）与记录一致（±轮询间隔内），round 232 那种 +65s 消失。
- [ ] AC2: pre-verified 与真跑两分支的 durationMs 语义一致（都不含轮询发现延迟）。
- [ ] AC3: 对照实测：一次真跑 fan-in → 记录 durationMs ≈ 真墙钟。
- [ ] AC4: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [ ] wall_ms 取 suite 真结束时刻（marker mtime 或 detached 写入 end_ms），verification-round durationMs 不再被轮询粒度抬高，AC101 判定用真实读数，scoped + 全量绿。

## Touches

- plugin/workflows/fan-in-execute.js（poll 段 end_ms 取 marker mtime / detached 写入 end_ms；双拷贝）
- .claude/workflows/fan-in-execute.js（同 dual-copy 的 landed 副本，与 plugin/workflows 逐字节一致）
- plugin/scripts/per-task-suite-record.ts（若 durationMs 语义需同步）
- plugin/scripts/pre-verified-round-record.ts（若 durationMs 语义需同步）
- plugin/test/fan-in-execute-paths.test.mjs（durationMs 真墙钟一致性测试）
- tasks/gap-fan-in-suite-duration-poll-granularity-inflation.md（自身）
