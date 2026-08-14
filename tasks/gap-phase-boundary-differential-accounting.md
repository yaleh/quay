---
id: gap-phase-boundary-differential-accounting
title: 相边界差分记账 + 全退出路径写入——答「这一相是算得多还是等得久」（cpu_usec/PSI 差分）
status: ready
labels:
  - gap
  - mechanism
  - performance
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**人指令（2026-08-13，经 manager 转达）「创建相关任务」；本任务属【性能探索线】，不服务任何阶段 AC**
（manager 核过：AC 里的计时判据要么是数量级差、要么刻意不设阈值）⇒ **排在停全局轮关键路径之后**，
不得挤占 `gap-spec11-retest-2h-nondegradation` 及 AC42/43/45/46 相关任务。A0b⑤(a) 已执行：无重复。

**问题**：现在只在轮结束时读一次 `/proc/loadavg`（`full-suite-runner.ts:733-736`）+ 整轮一个 `cpu_time_s`
⇒ 答不了「这一相是算得多还是等得久」——而那决定后面所有优化方向。

**做法（不周期采样）**：在 `static→serial→lowconc→main→end` 每个边界各读一次**单调累计计数器**并差分。
本机已核可用：
```
/sys/fs/cgroup/cpu.stat     usage_usec 941623227503     ← 累计
/sys/fs/cgroup/cpu.pressure some … total=10692267353    ← 累计
/sys/fs/cgroup/io.pressure  some … total=187444163      ← 累计
```
每相写一条：`phase, wall_ms(已有), cpu_usec, psi_cpu_total, psi_io_total, lanes`。
**差分而非采样**：①采样贵且污染被测对象；②累计差分给精确总量，采样只给估计；③这是「这一相花了多少
CPU／等了多久」＝总量问题，不是形状问题。

**⚠️ 必带的覆盖修复（否则新字段继承旧偏斜）**：现 `cpu_time_s` 缺 **54/161**，缺失集中在**红轮（37）
与更长的轮（中位 546s vs 有值 407s）**——恰是最该分析的那些 ⇒ **写入必须放 trap/finally**，保证
abort／早退／红轮都有账。

**派生量与它支撑的决策**：
```
相利用率 = cpu_usec/(wall×lanes)  ⇒ 有没有把【给它的 lane】用满；低 ⇒ 提并发无用
相饱和度 = cpu_usec/(wall×nproc)  ⇒ 有没有把【机器】用满；低而利用率高 ⇒ 提旋钮有效
等待占比 = psi 差分/wall          ⇒ 慢是算得多还是等得久（目前完全缺失，最能定方向）
```
「serial/lowconc 占 52% 墙钟却只用 37.5% 核」此前是相墙钟 + 代码常量的【推算】——有了相内 `cpu_usec`，
同一结论变成直接量。

## Plan

1. 在 full-suite-runner.ts 各相边界（static→serial→lowconc→main→end + 相间间隙）读单调累计计数器并差分。
2. 每相写 `phase, wall_ms, cpu_usec, psi_cpu_total, psi_io_total, lanes` 进 verification-round.jsonl。
3. **写入放 trap/finally**——abort/早退/红轮都有账（修 cpu_time_s 54/161 缺失的继承偏斜）。
4. 新字段覆盖率验证 = 100%（含红轮）。

## Acceptance Criteria

- [ ] AC1 static→serial→lowconc→main→end + 间隙的 `cpu_usec`/PSI 差分齐全，每相一条记录。（**⛔ 取消勾选 2026-08-14 20:0xZ：生产载体 164 轮 cpu_usec/psi 命中 0，原勾选由注入假 cgroup 满足——AC83 判据2「能产出≠已产出」；需真实分相数据落地后重勾**）
- [ ] AC2 派生量可算：相利用率/相饱和度/等待占比从记录直接得出（不再靠相墙钟+代码常量推算）。（**⛔ 同上取消勾选：AC1 无真实数据则派生量无可算**）
- [ ] AC3 **负控制（outer 执行，不构造输入）**：故意 abort 一轮（QUAY_TEST_SKIP 或信号），记录仍完整（**⛔ 同上取消勾选：原由注入假 cgroup 满足，需真实路径负控制**）
      ——cpu_usec/PSI 差分在 abort 路径不丢失。
- [ ] AC4 新字段覆盖率 = 100%（含红轮；修复 54/161 缺失的继承偏斜）。（**⛔ 同上取消勾选：生产覆盖率实为 0（164 轮 0 命中），原勾选由 scoped 注入满足**）
- [x] AC5 既有测试全绿；`--for-task` scoped 门绿。（**保留勾选：这条是真的**——落地 640ad48a，scoped 141/0 绿）
- [ ] AC6 **数据源未接 ⇒ `null`，⛔ 不写 `0`（manager 19:1xZ，硬规则 3b 第三次同形）**：`cpu_time_s`/`cpu_usec`/分相字段在数据源不可用时写 `null` + `cpu_source: 'not-wired'`（或等价独立取值），不得写 `0`——`0` 无法区分「仪器没接」与「真的 ~0 消耗」，会在未来 fullSuiteRan=true 记录也报 0 时造成不可判。⊢ 判据（能取假，真样本现成）：`.quay/per-task-suite-records.jsonl` 中 `cpu_time_s == 0` 的记录数应**为 0**（要么 null、要么真实非零）；现真值 **1**（ff-livelock 记录，fan-in-execute.js:110 GNU time 不可用 ⇒ 保持 0）。
- [ ] AC6 **数据源未接 ⇒ `null`，⛔ 不写 `0`（manager 19:1xZ，硬规则 3b 第三次同形）**：`cpu_time_s`/`cpu_usec`/分相字段在数据源不可用时写 `null` + `cpu_source: 'not-wired'`（或等价独立取值），不得写 `0`——`0` 无法区分「仪器没接」与「真的 ~0 消耗」，会在未来 fullSuiteRan=true 记录也报 0 时造成不可判。⊢ 判据（能取假，真样本现成）：`.quay/per-task-suite-records.jsonl` 中 `cpu_time_s == 0` 的记录数应**为 0**（要么 null、要么真实非零）；现真值 **1**（ff-livelock 记录，fan-in-execute.js:110 GNU time 不可用 ⇒ 保持 0）。

## Definition of Done

- [ ] 每相差分记录落地（含 abort/早退/红轮）。（**⛔ 取消勾选 2026-08-14 20:0xZ：原勾选由注入假 cgroup 满足，生产 164 轮 0 数据——需真实分相数据落地后重勾**）
- [ ] 负控制通过：故意 abort 一轮，记录完整。（**⛔ 同上取消：需真实路径负控制**）
- [ ] 覆盖率 100%，无缺失相。（**⛔ 同上取消：生产覆盖率实为 0**）

## Touches

- plugin/scripts/full-suite-runner.ts（相边界差分记账 + trap/finally 写入）
- plugin/test/full-suite-runner.test.mjs（差分/覆盖/负控制用例）
- plugin/scripts/per-task-suite-record.ts（AC6：cpu_time_s 数据源未接 ⇒ null + cpu_source，不写 0）
- .claude/workflows/fan-in-execute.js（AC6：GNU time 不可用/跳过全量 ⇒ cpu_time_s 写 null 而非 0）
- tasks/gap-phase-boundary-differential-accounting.md（自身）

## Evidence

（2026-08-13 落地，worktree `gap-phase-boundary-differential-accounting`）

- **实现**：`plugin/scripts/full-suite-runner.ts` 新增 `PhaseDifferentialAccounting`（`/sys/fs/cgroup` v2 单调累计计数器差分，`cpu.stat usage_usec` + `cpu.pressure`/`io.pressure` `some total`，按相边界读一次并差分——不周期采样）。边界由流中实时标记检出：`selected N files (groups=serial|lowconc)` / `overlap: running`（相起点）+ measure-suite `__GROUP__`（每相 node --test 结束）+ `__OVERHEAD__` 突发（main→end 兜底）。
- **记录形状**：每相一条 `{phase, wall_ms, cpu_usec, psi_cpu_total, psi_io_total, lanes}` 进 verification-round.jsonl 的 `phases` 字段；相序 `static→serial→gap_serial_to_lowconc→lowconc→main→end`。`phase_counter_error` 携带不可读原因（缺键≠0）。
- **全退出路径写入**：正常路径 `finalize()`（绿/红/abort/timeout/hung 都到）+ crash trap（`writeCrashTerminal` 写 state 的 `phases` 并 append 一条 phase-only round 行）。红轮/截断轮/无标记轮都有 ≥1 条相记录。
- **负控制**：fake suite 中途 SIGTERM 自杀 → 相记录完整（static+serial+lowconc，in-flight 相在 round 末关闭）。
- **测试**：`plugin/test/full-suite-runner.test.mjs` +9 用例（AC1 六相差分、AC2 派生量可算、AC3 abort 负控制、AC4 红/无标记/crash 覆盖、3 个单元）。既有 132 用例全绿；`--for-task` scoped 门绿。
- **派生量**：相利用率=cpu_usec/(wall×lanes)、相饱和度=cpu_usec/(wall×nproc)、等待占比=psi_cpu_total/wall——记录 + round `nproc` 直接可算，不再靠相墙钟+代码常量推算。
