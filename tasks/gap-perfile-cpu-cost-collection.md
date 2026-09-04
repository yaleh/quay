---
id: gap-perfile-cpu-cost-collection
title: per-file CPU/成本采集进 perFile 记录——动态调相/成本预算准入的前置观测量（纯采集，不改调度）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`gap-suite-scheduler-reliability-cap-not-speed`（done, 2026-09-04）把调度语义改成了"三组总并发 ≤ 当前活跃组的最小预算"，round #998 实测确认生效（低相在跑期间总并发恒 8，排空后 main 跳到 28；`total≤10` 的时段占观测窗口 41.9%）。人 2026-09-04 提出的后续方向是：**废弃静态分相，像 LPT 那样基于历史数据动态决定每个文件可接受的并发，并把超订阅机制并进同一套计算**。

**本任务只做那个方向的第 0 步：把「每文件消耗多少机器」这个量采集下来。纯观测，不改任何调度行为。**

**为什么这一步必须先做、且必须单独做**：

① **它是后续所有步骤的结构性前置**。动态并发模型需要两个彼此独立的量：`cost_f`（跑这个文件消耗多少机器）与 `sensitivity_f`（机器满载时它有多受伤）。`cost_f` 是**可直接观测、无删失、无归因问题**的量（性质同 `durationMs`）；`sensitivity_f` 是删失量（健康文件永远只给出下界，且失败时存在受害者/肇事者归因倒置的风险，`facf63605` 已实证）。**没有 `cost_f` 的历史数据，成本预算准入和超订阅整合都无从谈起**，而它今天完全没有被采集。

② **现有的并发计数是错误的单位**。今天的准入判据（组预算、`nproc × oversub / S` 的超订阅标量）把所有文件当成等大的"一个槽位"，而实测它们差一个数量级：round #985 里 `worker-driver-fan-in.test.mjs` 单文件 160s 且 spawn 真实子进程，同轮十几个文件 5s 内跑完。用一个全局标量代表异质现实，与 CLAUDE.md 硬规则 4 推论二记录的 `cpuQuota:"400%"` 是同一类范畴错误。（新增实证 2026-09-04 15:09：一轮生产轮跑到 main 相 28 槽位时，16 核机器 load average = 42 ⇒ 平均每槽位 ≈1.5 核、且方差极大——"槽位计数"与"实际消耗"根本不是一个量。）

③ **它的判据完全机械、且不会被 fixture 满足**（硬规则 4 推论三）：字段有没有真的在生产载体里出现、非零、且只计实现落地之后的轮次，一条查询就能取假。

**采集这一个量同时服务两类判别**（人 2026-09-04 讨论）：测试文件分两类且在调度不等式里角色相反——**Type 1（CPU 重、时间长）是消耗者**，进预算的被减数，自身通常不脆弱；**Type 2（CPU 轻、等待型、时间长）是被保护者**，消耗≈0 但要求周围安静，进的是预算上限。`cpu_ms` 的**绝对值**给出 Type 1 所需的成本，`cpu_ms / duration_ms` 的**比值**给出"这个文件是在算还是在等"这个 Type 2 体质的筛选信号（必要不充分——无期限的等待是健壮的，故比值只是筛不是判）。

**当前数据面**：`.quay/verification-round.jsonl` 的 `perFile[]` 目前只有 `{file, durationMs, passed, startedAtMs, endedAtMs}`；`cpu_time_s` 只有**轮级**一个总数。发射端是 `plugin/scripts/measure-suite-reporter.mjs:168` 的 `__PERFILE__ duration_ms=<dur> <path> passed=<bool> end_ms=<epoch-ms>` 行，由 `measure-trend-check.ts:126-138` 的 `parsePerFileLines` 统一解析——`full-suite-runner.ts` 与 `pre-verified-round-record.ts:764` 两个 writer **共用这一个解析器**，所以字段沿一条链路流动（`end_ms` 就是这样以可选捕获组的形式后加的，可照抄该先例）。⛔ 但两个 writer 的记录成形面仍需各自带上新字段——本仓库已有"verification-round 两 writer，新字段只加一边"的教训。

**关联**：`gap-suite-cost-model-is-wrong-optimizations-buy-nothing`（done）用两次全量实测否定了"单文件耗时节省 ⇒ 等比例墙钟节省"，并明确记录噪声带 17-63s；本任务**不设任何墙钟目标**，只交付观测量。`gap-verification-round-missing-phase-ms-breaks-cost-attribution` 是相邻但不同的机制（相级 phase_ms 缺失，非每文件成本）。

## Plan

1. **测量口径：默认选路线 (a) 子进程自报**（人 2026-09-04 明确定向，不再是"两条都可接受"）。
   - **(a) 子进程自报（默认）**：node:test `run({isolation:"process"})` 每文件一个子进程，用 `NODE_OPTIONS=--require` 之类的预载 seam，在子进程 `process.on("exit")` 时报告自己的 `process.cpuUsage()`。精确、无采样误差、不改任何测试文件；需要确认预载 seam 不污染被测行为。
   - **(b) 采样归因（仅在 (a) 被证明不可行时才用，且必须在任务体写明为何不可行）**：复用 `plugin/scripts/suite-load-sampler.ts`，加采 `/proc/<pid>/stat` 的 utime+stime 并用 `/proc/<pid>/cmdline` 把 PID 映射回文件。
   - **⛔ 为什么默认必须是 (a)**：本任务最关心的恰恰是 **Type 2（CPU 极低）**文件——一个 160s 墙钟 / 200ms CPU 的等待型文件，5s 采样极可能**采到 0**，而 0 与"没测到"同形，正好踩中硬规则 3b（读不懂的输入不得返回与合格同形的值）。采样路线对我们最需要分辨的那一类文件恰好最没有分辨力。若最终仍选 (b)，AC7 的分辨力判据必须照样满足。
   - 两条路线共同的硬约束：**必须是真实测量**——⛔ 不得用 `durationMs × 常数` 之类的派生值冒充 CPU 采集（硬规则 4 的"结构上不可能取假的量"）。
2. **发射端加字段**：`measure-suite-reporter.mjs` 的 `__PERFILE__` 行追加 `cpu_ms=<n>`，格式与既有 `end_ms=` 同款（行尾可选字段）。
3. **解析端加可选捕获组**：`measure-trend-check.ts` 的 `parsePerFileLines` 正则加 `cpu_ms` 可选组，**向后兼容**——旧日志无该字段时字段缺席（不是 0，不是伪造值），照抄 `end_ms` 的既有处理方式。
4. **两个 writer 都带上**：`full-suite-runner.ts` 与 `pre-verified-round-record.ts` 的 perFile 记录成形面各自带上 `cpuMs`；⛔ 只改一边即视为未完成（本仓库已有该教训）。
5. **单测**：`measure-suite-reporter.test.mjs`（发射行含新字段）、`measure-trend-check.test.mjs`（解析新字段 + 旧格式行仍能解析、字段缺席而非 0）、`full-suite-runner.test.mjs` 与 `pre-verified-round-record.test.mjs`（两个 writer 的记录都带该字段）。
6. **生产核验**：实现落地后跑至少一轮真实全量套件，直接查 `.quay/verification-round.jsonl` 里**落地时刻之后**的轮次，确认 `perFile[]` 中带非零 `cpuMs` 的记录数达到 AC 门槛。
   **⚠️ 取比值时注意窗口污染（人 2026-09-04）**：`cpu_ms / duration_ms` 的比值**本身受负载影响**——CPU 重的文件在机器满载时墙钟被拉长 ⇒ 比值下降 ⇒ 看起来更像"等待型"，会把 Type 1 误判成 Type 2。所以 AC5 的比值样本应优先取自**安静窗口**：新调度器的可靠性上限恰好造出了这个窗口——低并发组在跑期间总并发被摁在 min 预算（round #998 实测为 8），那段时间是全轮最安静的环境。比值数据须**注明取自哪个窗口**（低总并发窗口 / main 满载窗口），不注明窗口的比值不可比。
7. **不做的事**（明确划界，防范围膨胀）：不改任何调度/准入逻辑；不引入 `sensitivity_f`；不动 `@test-group` 分组；不设墙钟目标。这些属于该方向的后续步骤，各自另立任务。

## Acceptance Criteria

- [ ] AC1（能取假，发射端）：`measure-suite-reporter.mjs` 的 `__PERFILE__` 行含 `cpu_ms=<数字>`——grep 源码 + 跑一次单文件确认真实输出行里有该字段；（⛔ 行里无该字段 ⇒ 假）。
- [ ] AC2（能取假，解析端向后兼容）：`measure-trend-check.ts` 的 `parsePerFileLines` 能解析带 `cpu_ms` 的新行**且**仍能解析不带该字段的旧行，旧行解析结果里该字段**缺席而非 0**（区分"未测量"与"测得 0"，硬规则 3b）；单测覆盖两种行形，`node --test plugin/test/measure-trend-check.test.mjs` 全绿。
- [ ] AC3（能取假，两个 writer 都带）：`full-suite-runner.ts` 与 `pre-verified-round-record.ts` 的 perFile 记录成形面**都**带该字段——两个文件各自 grep 命中，且两条路径的单测各自覆盖；（⛔ 只有一个 writer 带 ⇒ 假）。
- [ ] AC4（能取假，生产载体，真实数据不是 fixture，硬规则 4 推论三）：实现落地后，`.quay/verification-round.jsonl` 中**落地提交时刻之后**的轮次里，`perFile[]` 带非零 `cpuMs` 的记录数 ≥ 100，且该轮的 `Σ perFile.cpuMs` 与同轮轮级 `cpu_time_s` 处于同一数量级（比值记录进 Measured，不设阈值——只要求写出实测比值并解释差异来源）；（⛔ 只有 fixture/单测数据、或落地后轮次里该字段全缺席/全零 ⇒ 假）。
- [ ] AC5（能取假，非派生值负控制）：`cpuMs` 不是从 `durationMs` 算出来的——在同一轮数据里给出至少 3 个文件的 `cpuMs / durationMs` 比值，证明该比值**不是常数**（spawn 子进程的重文件与纯 import 单测的比值应显著不同）；每个比值须**注明取自哪个窗口**（低总并发窗口 / main 满载窗口，见 Plan 步骤 6 的窗口污染说明）；（⛔ 比值恒定 ⇒ 说明采集是派生而非测量 ⇒ 假；⛔ 未注明窗口 ⇒ 比值不可比 ⇒ 假）。
- [ ] AC6（能取假，无行为回归）：全量 `scripts/test.sh` 跑通，0 failed、0 cancelled；且本任务**未改动任何调度/准入代码**——`git diff` 不含 `suite-scheduler.ts` 的调度逻辑改动；（⛔ 动了调度 ⇒ 超范围 ⇒ 假）。
- [ ] AC7（能取假，低 CPU 文件的分辨力——本任务最关心的那一类）：在落地后的真实轮次里，取 `cpuMs` **最低的 10 个文件**，它们的 `cpuMs` 必须是**非零且有分辨力的真实读数**（彼此不全相等、不是被采样/取整吞成 0 或同一个常数）；（⛔ 等待型低 CPU 文件的 `cpuMs` 全为 0 或全为同一值 ⇒ 说明该口径对 Type 2 无分辨力 ⇒ 假）。

## Definition of Done

`__PERFILE__` 行、共享解析器、两个 writer 的记录成形面都带上真实测量的 per-file CPU；旧格式行仍可解析且"未测量"与"0"可区分；AC1-AC7 全部勾选且勾选状态与本 DoD 文字一致（⛔ 不重蹈 `gap-suite-dynamic-waterline-scheduler` 那次 status/DoD/AC 三者矛盾的覆辙——AC 未勾就不得翻 done）；至少一轮**实现落地之后**的真实全量套件在生产载体里留下 ≥100 条非零 `cpuMs` 记录；AC5 的非派生负控制数据（含窗口标注）与 AC7 的低 CPU 分辨力数据都写进 Measured；全程未改动调度/准入逻辑，不设任何墙钟目标。

## Touches

- plugin/scripts/measure-suite-reporter.mjs（`__PERFILE__` 行追加 cpu_ms 字段）
- plugin/scripts/measure-trend-check.ts（parsePerFileLines 正则加可选捕获组，照抄 end_ms 先例）
- plugin/scripts/full-suite-runner.ts（writer 之一：perFile 记录成形面带 cpuMs）
- plugin/scripts/pre-verified-round-record.ts（writer 之二：同款字段，禁止只改一边）
- plugin/scripts/suite-load-sampler.ts（仅当路线 (a) 被证明不可行、改用采样归因时才动，选型见 Plan 步骤 1）
- plugin/test/measure-suite-reporter.test.mjs（发射行含新字段）
- plugin/test/measure-trend-check.test.mjs（新旧两种行形的解析 + 缺席非 0）
- plugin/test/full-suite-runner.test.mjs（writer 之一带该字段）
- plugin/test/pre-verified-round-record.test.mjs（writer 之二带该字段）
- tasks/gap-perfile-cpu-cost-collection.md（自身）

## Needs-Human

**执行 2026-09-04T17:27:10.200Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: the dynamic truth must contain plugin/scripts/quay-init.sh, got reads=[] writes=[]
- run_id：wk-prod-1788285192
- session_id：2b162168-0bbc-4caa-bd89-7774e3f95377
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-perfile-cpu-cost-collection~wk-prod-1788285192~1788542260842-364556.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-perfile-cpu-cost-collection-wk-prod-1788285192.log
