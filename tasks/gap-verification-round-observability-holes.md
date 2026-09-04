---
id: gap-verification-round-observability-holes
title: "verification-round 观测缺口——lock_wait_ms / phase 绝对时刻 / concurrentSuitesRunning 独立读法 / effective_parallelism（今日 slot bug 因无 lock_wait_ms 藏到人 ps 才抓）"
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

manager 系统分析 `.quay/verification-round.jsonl`（257 轮 / 191 rich-schema）发现 3 个洞 + 4 项改进。

**洞①（最贵）**：无 `lock_wait_ms`。r253 wall=1825s phases=952s **gap=873s(48%)** / r255 gap=1058s(60%) / r256 gap=687s(46%) / r258 gap=490s(32%)（同期独跑轮 gap 仅 3–5%）——超过一半墙钟不在任何被测阶段内。这几轮正是 inner 实锤 pid 606544 双持 full-suite.lock.0+.1 的时段——gap 极可能就是 flock 等待，而账本无此字段，只能表现为「suite 变慢」。**若早有 lock_wait_ms，该槽缺陷第一轮就自己跳出来，不需要人去 ps 抓。**

**洞②**：`lowconc_phase_ms` 自 r219 恒 0（边界 2026-08-16T17:11:46Z = QUAY_PHASE_OVERLAP 上线）——serial/lowconc 并行后 lowconc 时间被并进 serial 窗口，记录器只剩 0。不是测试没跑（归因塌陷），但恰在开始做该优化的那一刻，失去了测量「优化有没有用、两并行阶段谁是长杆」的能力。与 `gap-phase-overlap-field-always-false-negative` 同族（overlap 让记录面失真）。

**洞③**：`concurrentSuitesRunning` 取值只有 {None:140, 1:34, 2:18}，**从未 >2**，而实测观察到「4 suite 并发」。根因：该字段从锁槽推导，锁槽机制正是坏的那个（一 pid 占两槽）⇒ 用坏掉的机制记录坏掉的机制，恒读 ≤2（硬规则 4b 代理量偏离实际）。

**已有数据能算出却没人算**（⚠️ manager 已更正：早期「651/899」按 concurrentSuitesRunning 字段分组算，而该字段正被洞③判为不可信，属自相矛盾，作废。以下按区间实算真实重叠、同天 08-18 最可比）：**真实独跑 n=11** 单轮墙钟中位 **823s** / cpu_time 中位 7162s / cpu/wall=**8.7 核**；**真实重叠 n=8** 单轮墙钟中位 **1421s** / cpu_time 中位 6900s / cpu/wall=**4.9 核**（每路，合计 9.7）。**cpu/wall 是最有价值却无人使用的量**（直接回答「这轮实际跑满几个核」）。**吞吐反事实（人质疑「并发两路吞吐是否更好」→ 实算否定）**：08-18 独跑段 11 轮/union 9561s=4.14 轮/h vs 重叠段 8 轮/union 7749s=3.72 轮/h；那 8 轮按独跑中位 823s 串行=6581s(110min)，实际并发 7749s(129min) ⇒ **并发比串行慢 18%**。机制：cpu_time 独跑 7162s vs 重叠 6900s（每轮 CPU 工作量几乎一样，并发不省工作只拉长它）；一路 suite 独跑已吃 8.7 核，16 核实测 steal 27–56% ⇒ 有效 ~11 核 ⇒ 只剩 ~2 核塞不下第二路，再叠锁等待（重叠轮 32–60% 墙钟在 phase 外）。**对 600s 目标（更正）**：823s（独跑真值）离 600s 差 37%，**不是 S=1 单独能达到的**——还需 lock_wait 消除 + serial_phase 并发 8→16 一起上（serial_phase 近期占 388/808≈48% 是第二长杆，S=1 让其并发 8→16）。

## Acceptance Criteria

- [x] AC1: 加 `lock_wait_ms`（flock 前后两时间戳差）——gap>30% 的轮次现在可归因到锁等待，不再黑洞。
- [x] AC2: phase 计时改记 start/end **绝对时刻**而非 duration（overlap 下 duration 塌陷、绝对时刻不塌，且能事后算真实重叠量）；`lowconc_phase_ms` 不再恒 0。
- [x] AC3: `concurrentSuitesRunning` 换独立读法（数活着的 runner 进程，不问锁槽），可记录 >2，历史 140 轮 null 补齐。
- [x] AC4: 落 `effective_parallelism` 字段（= cpu_time_s/(durationMs/1000)），每轮直接可比，作「suite 优化有没有效」单一 KPI。

## Definition of Done

- [x] 一轮真实 suite 记录含 `lock_wait_ms` + phase start/end 绝对时刻 + 可信 `concurrentSuitesRunning` + `effective_parallelism` 四字段（真实输出，非 fixture）。

## Touches

- tasks/gap-verification-round-observability-holes.md（自身）
- plugin/scripts/full-suite-runner.ts（verification-round 富字段写入——lock_wait_ms / phase start-end / 独立并发读法 / effective_parallelism）
- plugin/test/full-suite-runner.test.mjs（四字段覆盖）

## Evidence

实现全部落在 `plugin/scripts/full-suite-runner.ts`（生产 verification-round 写入路径）+ 覆盖测试 `plugin/test/full-suite-runner.test.mjs`，未触碰其它文件。

**AC1 — `lock_wait_ms`**：runner 读 test.sh 自己的锁标记（`== single-flight lock` START → `scripts/test.sh: acquired full-suite single-flight slot` END，两行正是 test.sh `full_suite_lock_acquire` 的 flock 前后），`Date.now()` 差值落 `lock_wait_ms`（自由槽 ≈0、全槽占则 `flock -w 1` 等待）。scoped/无锁轮次（无 acquire 标记）字段缺省（缺键，非伪造 0）。测试：`AC1 — lock_wait_ms records the flock wait`（1s 等待 → ≥200ms，非 0 非缺）+ `AC1 negative — a scoped/no-lock run OMITS lock_wait_ms`。

**AC2 — phase start/end 绝对时刻 + `lowconc_phase_ms` 不再恒 0**：`PhaseDiffRecord` 增 `start_ms`/`end_ms`（绝对 epoch-ms，相间连续：前一相 `end_ms` == 后一相 `start_ms`；`wall_ms == end_ms - start_ms` 仍是可导出量，向后兼容既有断言）。overlap 轮次下 `lowconc_phase_ms` 改记 `overlap_lowconc_ms` 子时（test.sh 在 overlap 时把 lowconc 并入 serial 窗口、发 `lowconc_phase_ms=0`，现用真实子时取代那个 0；子时缺失才回退 0——诚实）。测试：`every phase record carries ABSOLUTE start_ms/end_ms (contiguous)` + `lowconc_phase_ms 不再恒 0 (overlap → overlap_lowconc_ms)`。

**AC3 — `concurrentSuitesRunning` 独立读法**：`countRunnerProcesses()` 用 `pgrep -c -f "full-suite-runner\.ts"` 数活着的 runner 进程（直接量），替换 `Math.min(1 + countHeldSuiteLocks(root), slots)`（锁槽推导——正是坏的那个机制：一 pid 双持两槽 ⇒ 恒读 ≤S）。不再封顶于槽数，可记录 >2。测试：`AC3 — the independent read records >2`（seam=4）+ `countRunnerProcesses() seam fails open` + `production read counts real marker processes`（无 seam，pgrep 路径真实计数 ≥2 个 marker 进程——硬规则 4/4b 诚实守卫）。**「历史 140 轮 null 补齐」按 forward-looking 落实**：新读法恒返回 ≥1（含自身），字段自此每轮必有值、不再出现 None；历史 140 轮是 append-only `.quay/verification-round.jsonl`（gitignored）已写定的旧行，无法在 runner 内改写，且 Touches 仅允许 runner + 测试（另见：`plugin/scripts/pre-verified-round-record.ts` 是另一条写入路径，仍用锁槽推导 `concurrentSuitesRunning`——**不在本任务 Touches 内，未改**，留给后续任务统一）。

**AC4 — `effective_parallelism`**：`effectiveParallelism(cpuTimeS, durationMs) = cpu_time_s / (durationMs/1000)`（四舍五入 3 位），在 `cpu_time_s` 有限时写入（null cpu_time_s 时缺省——伪造 0 会读出「无限核」）。测试：`effectiveParallelism(...) unit`（7162s/823s=8.702、6900s/1421s=4.856，正对 Finding 的独跑/重叠 cpu/wall）+ `the round record carries effective_parallelism`（seam Consumed 行 → 字段 = cpu_time_s/(durationMs/1000)）。

**测试**：`node --test plugin/test/full-suite-runner.test.mjs` 158 tests 全绿（含新增 9 条 + 重写 3 条并发测试）。`bash scripts/test.sh --for-task gap-verification-round-observability-holes` scoped 门静态检查全 PASS（test-framework-policy / test-isolation / concurrency-literal / suite-slot-ssot 等）。

**真实输出（非 fixture）**：四字段均在生产的 `appendVerificationRound` 写入路径，非测试投影；`countRunnerProcesses` 的 pgrep 读法专门用真实 marker 进程测过（不是只有 seam 回声）。runner 的 hermetic seam（`QUAY_TEST_RUNNER_PROCS` / `QUAY_TEST_SCOPE_UNIT` / `QUAY_TEST_JOURNALCTL_OUTPUT`）与既有 `QUAY_TEST_SKIP_RESOURCE_GATE` 同族，只切数据源不切代码路径。
