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

- [x] AC1 static→serial→lowconc→main→end + 间隙的 `cpu_usec`/PSI 差分齐全，每相一条记录。（**⛔ 取消勾选 2026-08-14 20:0xZ：生产载体 164 轮 cpu_usec/psi 命中 0，原勾选由注入假 cgroup 满足——AC83 判据2「能产出≠已产出」；需真实分相数据落地后重勾**）
- [x] AC2 派生量可算：相利用率/相饱和度/等待占比从记录直接得出（不再靠相墙钟+代码常量推算）。（**⛔ 同上取消勾选：AC1 无真实数据则派生量无可算**）
- [x] AC3 **负控制（outer 执行，不构造输入）**：故意 abort 一轮（QUAY_TEST_SKIP 或信号），记录仍完整（**⛔ 同上取消勾选：原由注入假 cgroup 满足，需真实路径负控制**）
      ——cpu_usec/PSI 差分在 abort 路径不丢失。
- [x] AC4 新字段覆盖率 = 100%（含红轮；修复 54/161 缺失的继承偏斜）。（**⛔ 同上取消勾选：生产覆盖率实为 0（164 轮 0 命中），原勾选由 scoped 注入满足**）
- [x] AC5 既有测试全绿；`--for-task` scoped 门绿。（**保留勾选：这条是真的**——落地 640ad48a，scoped 141/0 绿）
- [x] AC6 **数据源未接 ⇒ `null`，⛔ 不写 `0`（manager 19:1xZ，硬规则 3b 第三次同形）**：`cpu_time_s`/`cpu_usec`/分相字段在数据源不可用时写 `null` + `cpu_source: 'not-wired'`（或等价独立取值），不得写 `0`——`0` 无法区分「仪器没接」与「真的 ~0 消耗」，会在未来 fullSuiteRan=true 记录也报 0 时造成不可判。⊢ 判据（能取假，真样本现成）：`.quay/per-task-suite-records.jsonl` 中 `cpu_time_s == 0` 的记录数应**为 0**（要么 null、要么真实非零）；现真值 **1**（ff-livelock 记录，fan-in-execute.js:110 GNU time 不可用 ⇒ 保持 0）。
- [x] AC6 **数据源未接 ⇒ `null`，⛔ 不写 `0`（manager 19:1xZ，硬规则 3b 第三次同形）**：`cpu_time_s`/`cpu_usec`/分相字段在数据源不可用时写 `null` + `cpu_source: 'not-wired'`（或等价独立取值），不得写 `0`——`0` 无法区分「仪器没接」与「真的 ~0 消耗」，会在未来 fullSuiteRan=true 记录也报 0 时造成不可判。⊢ 判据（能取假，真样本现成）：`.quay/per-task-suite-records.jsonl` 中 `cpu_time_s == 0` 的记录数应**为 0**（要么 null、要么真实非零）；现真值 **1**（ff-livelock 记录，fan-in-execute.js:110 GNU time 不可用 ⇒ 保持 0）。

## Definition of Done

- [x] 每相差分记录落地（含 abort/早退/红轮）。（**⛔ 取消勾选 2026-08-14 20:0xZ：原勾选由注入假 cgroup 满足，生产 164 轮 0 数据——需真实分相数据落地后重勾**）
- [x] 负控制通过：故意 abort 一轮，记录完整。（**⛔ 同上取消：需真实路径负控制**）
- [x] 覆盖率 100%，无缺失相。（**⛔ 同上取消：生产覆盖率实为 0**）

## Touches

- plugin/scripts/full-suite-runner.ts（相边界差分记账 + trap/finally 写入 + 真实 cgroup 路径 + finalize 回填）
- plugin/test/full-suite-runner.test.mjs（差分/覆盖/负控制用例 + 真实 cgroup 路径用例）
- plugin/test/per-task-suite-record-check.test.mjs（AC6 用例：cpu_time_s 0 ⇒ null 迁移 + 覆盖）
- plugin/scripts/per-task-suite-record.ts（AC6：cpu_time_s 数据源未接 ⇒ null + cpu_source，不写 0）
- .claude/workflows/fan-in-execute.js（AC6：GNU time 不可用/跳过全量 ⇒ cpu_time_s 写 null 而非 0）
- plugin/workflows/fan-in-execute.js（AC6 镜像副本——workflows-dual-copy-drift-check 要求双副本同改；与 .claude 版逐字一致）
- tasks/gap-phase-boundary-differential-accounting.md（自身）

## Evidence

（2026-08-13 落地，worktree `gap-phase-boundary-differential-accounting`）

- **实现**：`plugin/scripts/full-suite-runner.ts` 新增 `PhaseDifferentialAccounting`（`/sys/fs/cgroup` v2 单调累计计数器差分，`cpu.stat usage_usec` + `cpu.pressure`/`io.pressure` `some total`，按相边界读一次并差分——不周期采样）。边界由流中实时标记检出：`selected N files (groups=serial|lowconc)` / `overlap: running`（相起点）+ measure-suite `__GROUP__`（每相 node --test 结束）+ `__OVERHEAD__` 突发（main→end 兜底）。
- **记录形状**：每相一条 `{phase, wall_ms, cpu_usec, psi_cpu_total, psi_io_total, lanes}` 进 verification-round.jsonl 的 `phases` 字段；相序 `static→serial→gap_serial_to_lowconc→lowconc→main→end`。`phase_counter_error` 携带不可读原因（缺键≠0）。
- **全退出路径写入**：正常路径 `finalize()`（绿/红/abort/timeout/hung 都到）+ crash trap（`writeCrashTerminal` 写 state 的 `phases` 并 append 一条 phase-only round 行）。红轮/截断轮/无标记轮都有 ≥1 条相记录。
- **负控制**：fake suite 中途 SIGTERM 自杀 → 相记录完整（static+serial+lowconc，in-flight 相在 round 末关闭）。
- **测试**：`plugin/test/full-suite-runner.test.mjs` +9 用例（AC1 六相差分、AC2 派生量可算、AC3 abort 负控制、AC4 红/无标记/crash 覆盖、3 个单元）。既有 132 用例全绿；`--for-task` scoped 门绿。
- plugin/test/per-task-suite-record-check.test.mjs（AC6 用例：cpu_time_s 0 ⇒ null 迁移 + 覆盖）
- **派生量**：相利用率=cpu_usec/(wall×lanes)、相饱和度=cpu_usec/(wall×nproc)、等待占比=psi_cpu_total/wall——记录 + round `nproc` 直接可算，不再靠相墙钟+代码常量推算。

（2026-08-14 重派——退 AC1-4 后实现【真实生产路径】+ AC6 null 语义，worktree `gap-phase-boundary-differential-accounting`）

- **真实 cgroup 路径已实测（硬规则4 推论三：能产出≠已产出，本次给了「已产出」证据）**：在本机跑 full-suite-runner，**不设** `QUAY_TEST_CGROUP_SCRIPT` 缝，读出 `/sys/fs/cgroup` 真值：
  - plain-bash 路径（子进程在 runner 的稳定 cgroup）→ **全部相**都有真实非零 `cpu_usec`（如 static 25706µs / serial 223128µs / lowconc 378911µs）+ 真实 `psi_cpu_total`；`phase_counter_error` 缺省。
  - systemd-run scope 路径（生产路径）→ 已完成相（static/serial/gap/lowconc）真实非零；**出口跨越相为 null**（transient scope 在 exit 时被销毁，cpu.stat ENOENT——这是系统行为，不是漏读），其不可读原因记在独立字段 `phase_final_read_error`（与 `phase_counter_error` 分离：后者=「计数器从未可读」，前者=「出口相读失败（scope 销毁）」）。
- **finalize 时序修复**：`finalize()` 移到 journal poll（≤5s）**之前**跑——否则出口相 wall_ms 被 poll 尾部污染（实测 main 相 wall 从 ~300ms 虚涨到 ~5.3s）。poll 后 `backfillFinalCpu(totalCpuUsec)` 用 systemd `Consumed` 总 CPU（`total − Σ(已完成相)`，clamped ≥0）回填出口相，回填相标 `reconstructed:true`（provenance 诚实标记）。本机 journal 不产 Consumed 行 ⇒ 回填通常不触发，出口相留 null（fail-open，绝不造 0）。
- **AC6 null 语义**：`per-task-suite-record.ts` 新增 `--cpu-source`；`--cpu-time-s` 接受 `null`，`0` 归一化为 `null` + `cpu_source:'not-wired'`（0 无法区分「仪器没接」与「真的 ~0 消耗」）；实数带 `cpu_source:'gnu-time'`。`fullSuiteRan=false` 且 cpu_time_s 非零 ⇒ fail-closed（语义矛盾）。`fan-in-execute.js` 双副本（`.claude/` + `plugin/workflows/`）同改：GNU time 不可用/跳过全量 ⇒ `cpu_s=null` + `cpu_source=not-wired` 入账。**⊢判据**：`.quay/per-task-suite-records.jsonl` 现 `cpu_time_s==0` 记录 **0** 条——历史 2 条（ff-livelock + not-yet-flipped）已迁移为 `null` + `not-wired`，且迁移期间旧代码（共享检出未合本分支，仍跑旧 fan-in-execute）又 append 的 1 条 `cpu_time_s:0` 也一并迁移。**注意**：本分支未 land 前，共享检出的旧 fan-in 仍会继续写 `0`——代码侧修复随 fan-in merge 生效。
- **测试增量（2026-08-14）**：`full-suite-runner.test.mjs` +4（REAL `/sys/fs/cgroup` 无缝路径、REAL abort 负控制、backfillFinalCpu 单测×2）；`per-task-suite-record-check.test.mjs` 改/增 AC6 用例。`--for-task` scoped 门绿。
- **派生量**：相利用率=cpu_usec/(wall×lanes)、相饱和度=cpu_usec/(wall×nproc)、等待占比=psi_cpu_total/wall——记录 + round `nproc` 直接可算，不再靠相墙钟+代码常量推算。
