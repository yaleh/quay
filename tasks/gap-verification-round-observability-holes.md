---
id: gap-verification-round-observability-holes
title: "verification-round 观测缺口——lock_wait_ms / phase 绝对时刻 / concurrentSuitesRunning 独立读法 / effective_parallelism（今日 slot bug 因无 lock_wait_ms 藏到人 ps 才抓）"
status: todo
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

**已有数据能算出却没人算**（按 concurrentSuitesRunning 分组）：独跑(n=34) 墙钟中位 651s / cpu_time 4562s / cpu/wall=7.06；并发2(n=18) 899s / 6100s / 5.95。**cpu/wall 是这套数据里最有价值却无人使用的量**（直接回答「这轮实际跑满几个核」）。并发让有效并行度掉 16% 而 CPU 总量不省。**对 600s 目标**：独跑 651s 只差 8%、并发 899s 超标 50%——**S=1 几乎单独就能送到门口**（S=1 还有第二重收益：serial_phase 近期占 388/808≈48% 是第二长杆，它按 nproc/S 低并发跑，S=1 让其并发 8→16）。

## Acceptance Criteria

- [ ] AC1: 加 `lock_wait_ms`（flock 前后两时间戳差）——gap>30% 的轮次现在可归因到锁等待，不再黑洞。
- [ ] AC2: phase 计时改记 start/end **绝对时刻**而非 duration（overlap 下 duration 塌陷、绝对时刻不塌，且能事后算真实重叠量）；`lowconc_phase_ms` 不再恒 0。
- [ ] AC3: `concurrentSuitesRunning` 换独立读法（数活着的 runner 进程，不问锁槽），可记录 >2，历史 140 轮 null 补齐。
- [ ] AC4: 落 `effective_parallelism` 字段（= cpu_time_s/(durationMs/1000)），每轮直接可比，作「suite 优化有没有效」单一 KPI。

## Definition of Done

- [ ] 一轮真实 suite 记录含 `lock_wait_ms` + phase start/end 绝对时刻 + 可信 `concurrentSuitesRunning` + `effective_parallelism` 四字段（真实输出，非 fixture）。

## Touches

- tasks/gap-verification-round-observability-holes.md（自身）
- plugin/scripts/full-suite-runner.ts（verification-round 富字段写入——lock_wait_ms / phase start-end / 独立并发读法 / effective_parallelism）
- plugin/test/full-suite-runner.test.mjs（四字段覆盖）
