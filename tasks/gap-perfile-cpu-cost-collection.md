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
   - **实现选型记录（2026-09-04，本实现）**：选 (a)，已实测可行——`NODE_OPTIONS=--require` 会**穿透**进 node:test 的隔离子进程（子进程 execArgv 含 `--require=<preload>`、environ 含 `NODE_OPTIONS`，实测直跑与 LPT 路径 `suite-lpt-runner.mjs` 两条都命中）；子进程 `process.argv[1]` 是 node:test 解析后的**绝对路径**，`process.cpuUsage()` 在 `process.on("exit")` 同步写出、早于父进程 `test:complete` 发射（无竞态）。预载 seam 只 import `node:fs/path/crypto/child_process` + 注册一个 exit 钩子，零全局污染、不改任何测试文件、不碰 test.sh（接线收在 `full-suite-runner.ts` 的 suiteEnv，两条 writer 与直接/LPT 路径共用同一 seam）。**2026-09-04 续（同一轮实现，修正两处缺陷）**：① **cpu_ms 加入 reaped 子进程 CPU**——`process.cpuUsage()` 只含本进程、不含它 spawn 的子进程，会严重低报 spawn 重文件（实测 1.5s 子进程烧 CPU 时 cpuUsage≈133ms vs own+children≈1730ms，恰把重度 spawn 的 Type 1 误判成 Type 2）；现改为 own `process.cpuUsage()` + `/proc/self/stat` `cutime+cstime`（tick→ms，HZ 读宿主 `getconf CLK_TCK` 不写死）。② **seam 触发收窄**为 execArgv 含 `--test-isolation` 的隔离子进程（不再注入 `node -e` 探针 / MCP provider 等非测试进程——无差别注入曾在 suite 负载下让 serve-board.test.mjs 的活进程判活夹具翻车，生产载体 488 轮首红）。**2026-09-04 再续（第三处修正，本轮——修复 suite 红 `suite-bucket-drift-check` ②-AC1 `reads=[]`）**：③ **预载 seam 禁用顶层命名 ESM import `node:child_process`**——`NODE_OPTIONS=--require` 会穿透进 `suite-fs-trace.ts` 的 `traceOne` 子进程（其 `env: {...process.env}` 继承 NODE_OPTIONS），而 `suite-fs-trace-preload.cjs` 靠 `--require` CJS 预载在 ESM 图实例化前 patch `node:child_process` 的 CJS exports，使被测文件的 `import { spawnSync }` 解析到 patch 后的函数；任何【更早加载】的预载若做命名 ESM import（原实现 `import { execFileSync }`），会把 child_process 的 ESM namespace 绑定**提前快照到 patch 前的原函数**，导致 trace 捕获 0 reads（实测：命名 import 预载 ⇒ ②-AC1 `reads=[]`；default `import fs` / `path` / `crypto` / `createRequire` 均不受影响——它们不触发 child_process namespace 提前链接）。现改为 `createRequire(import.meta.url)` **惰性** `require("node:child_process")`（只在 armed exit 钩子内调用，惰性 trace 子进程不触发）。⛔ 未来维护者勿「简化」回命名 import。
   - 两条路线共同的硬约束：**必须是真实测量**——⛔ 不得用 `durationMs × 常数` 之类的派生值冒充 CPU 采集（硬规则 4 的"结构上不可能取假的量"）。
2. **发射端加字段**：`measure-suite-reporter.mjs` 的 `__PERFILE__` 行追加 `cpu_ms=<n>`，格式与既有 `end_ms=` 同款（行尾可选字段）。
3. **解析端加可选捕获组**：`measure-trend-check.ts` 的 `parsePerFileLines` 正则加 `cpu_ms` 可选组，**向后兼容**——旧日志无该字段时字段缺席（不是 0，不是伪造值），照抄 `end_ms` 的既有处理方式。
4. **两个 writer 都带上**：`full-suite-runner.ts` 与 `pre-verified-round-record.ts` 的 perFile 记录成形面各自带上 `cpuMs`；⛔ 只改一边即视为未完成（本仓库已有该教训）。
5. **单测**：`measure-suite-reporter.test.mjs`（发射行含新字段）、`measure-trend-check.test.mjs`（解析新字段 + 旧格式行仍能解析、字段缺席而非 0）、`full-suite-runner.test.mjs` 与 `pre-verified-round-record.test.mjs`（两个 writer 的记录都带该字段）。
6. **生产核验**：实现落地后跑至少一轮真实全量套件，直接查 `.quay/verification-round.jsonl` 里**落地时刻之后**的轮次，确认 `perFile[]` 中带非零 `cpuMs` 的记录数达到 AC 门槛。
   **⚠️ 取比值时注意窗口污染（人 2026-09-04）**：`cpu_ms / duration_ms` 的比值**本身受负载影响**——CPU 重的文件在机器满载时墙钟被拉长 ⇒ 比值下降 ⇒ 看起来更像"等待型"，会把 Type 1 误判成 Type 2。所以 AC5 的比值样本应优先取自**安静窗口**：新调度器的可靠性上限恰好造出了这个窗口——低并发组在跑期间总并发被摁在 min 预算（round #998 实测为 8），那段时间是全轮最安静的环境。比值数据须**注明取自哪个窗口**（低总并发窗口 / main 满载窗口），不注明窗口的比值不可比。
7. **不做的事**（明确划界，防范围膨胀）：不改任何调度/准入逻辑；不引入 `sensitivity_f`；不动 `@test-group` 分组；不设墙钟目标。这些属于该方向的后续步骤，各自另立任务。

## Acceptance Criteria

- [x] AC1（能取假，发射端）：`measure-suite-reporter.mjs` 的 `__PERFILE__` 行含 `cpu_ms=<数字>`——grep 源码 + 跑一次单文件确认真实输出行里有该字段；（⛔ 行里无该字段 ⇒ 假）。
- [x] AC2（能取假，解析端向后兼容）：`measure-trend-check.ts` 的 `parsePerFileLines` 能解析带 `cpu_ms` 的新行**且**仍能解析不带该字段的旧行，旧行解析结果里该字段**缺席而非 0**（区分"未测量"与"测得 0"，硬规则 3b）；单测覆盖两种行形，`node --test plugin/test/measure-trend-check.test.mjs` 全绿。
- [x] AC3（能取假，两个 writer 都带）：`full-suite-runner.ts` 与 `pre-verified-round-record.ts` 的 perFile 记录成形面**都**带该字段——两个文件各自 grep 命中，且两条路径的单测各自覆盖；（⛔ 只有一个 writer 带 ⇒ 假）。
- [ ] AC4（能取假，生产载体，真实数据不是 fixture，硬规则 4 推论三）：实现落地后，`.quay/verification-round.jsonl` 中**落地提交时刻之后**的轮次里，`perFile[]` 带非零 `cpuMs` 的记录数 ≥ 100，且该轮的 `Σ perFile.cpuMs` 与同轮轮级 `cpu_time_s` 处于同一数量级（比值记录进 Measured，不设阈值——只要求写出实测比值并解释差异来源）；（⛔ 只有 fixture/单测数据、或落地后轮次里该字段全缺席/全零 ⇒ 假）。（待外部）
- [ ] AC5（能取假，非派生值负控制）：`cpuMs` 不是从 `durationMs` 算出来的——在同一轮数据里给出至少 3 个文件的 `cpuMs / durationMs` 比值，证明该比值**不是常数**（spawn 子进程的重文件与纯 import 单测的比值应显著不同）；每个比值须**注明取自哪个窗口**（低总并发窗口 / main 满载窗口，见 Plan 步骤 6 的窗口污染说明）；（⛔ 比值恒定 ⇒ 说明采集是派生而非测量 ⇒ 假；⛔ 未注明窗口 ⇒ 比值不可比 ⇒ 假）。（待外部）
- [ ] AC6（能取假，无行为回归）：全量 `scripts/test.sh` 跑通，0 failed、0 cancelled；且本任务**未改动任何调度/准入代码**——`git diff` 不含 `suite-scheduler.ts` 的调度逻辑改动；（⛔ 动了调度 ⇒ 超范围 ⇒ 假）。（待外部）
- [ ] AC7（能取假，低 CPU 文件的分辨力——本任务最关心的那一类）：在落地后的真实轮次里，取 `cpuMs` **最低的 10 个文件**，它们的 `cpuMs` 必须是**非零且有分辨力的真实读数**（彼此不全相等、不是被采样/取整吞成 0 或同一个常数）；（⛔ 等待型低 CPU 文件的 `cpuMs` 全为 0 或全为同一值 ⇒ 说明该口径对 Type 2 无分辨力 ⇒ 假）。（待外部）

## Definition of Done

`__PERFILE__` 行、共享解析器、两个 writer 的记录成形面都带上真实测量的 per-file CPU；旧格式行仍可解析且"未测量"与"0"可区分；AC1-AC7 全部勾选且勾选状态与本 DoD 文字一致（⛔ 不重蹈 `gap-suite-dynamic-waterline-scheduler` 那次 status/DoD/AC 三者矛盾的覆辙——AC 未勾就不得翻 done）；至少一轮**实现落地之后**的真实全量套件在生产载体里留下 ≥100 条非零 `cpuMs` 记录；AC5 的非派生负控制数据（含窗口标注）与 AC7 的低 CPU 分辨力数据都写进 Measured；全程未改动调度/准入逻辑，不设任何墙钟目标。

## Measured

**测量口径**：路线 (a) 子进程自报——子进程 `process.on("exit")` 时把 **own `process.cpuUsage()`（user+system，µs→ms）+ 已被 wait 回收的子进程 CPU（`/proc/self/stat` 的 `cutime+cstime`，tick→ms，HZ 读宿主 `getconf CLK_TCK` 不写死）** 写入 `QUAY_PERFILE_CPU_DIR`，reporter 在 `test:complete` 读回并追加 `cpu_ms=`。理由见 Plan 步骤 1「实现选型记录」：精确、无删失、无归因（性质同 `durationMs`），对 Type 2（CPU 极低、等待型）仍有分辨力——采样路线在此类上会采到 0、与"没测到"同形。**⚠️ 口径限制**：`cutime/cstime` 只累计已被 wait 回收的子进程，detached 孤儿进程的 CPU 仍漏计——spawn 重文件（`execFileSync`/`spawn`+await 等回收型）全覆盖，孤儿型（`detached`+不 wait）漏计。

**非派生负控制（机制级，非生产轮；实现落地前实测）**：双文件 `--test-concurrency=2`、无窗口负载——
- `cpu-heavy.test.mjs`（烧 CPU ~300ms）：`duration_ms=645.47, cpu_ms=536.18` ⇒ `cpuMs/durationMs ≈ 0.83`（算多）。
- `sleep.test.mjs`（sleep ~300ms）：`duration_ms=933.47, cpu_ms=338.62` ⇒ `cpuMs/durationMs ≈ 0.36`（等待型）。

⇒ 比值 0.83 vs 0.36 **显著不同**，证明 `cpuMs` 来自 `process.cpuUsage()` 的真实测量、**不是 `durationMs × 常数`**（硬规则 4 的反派生负控制）。⛔ 这两条是**机制演示**（临时文件、非生产轮、未注窗口），AC5 的生产轮数据见下。

**生产核验（待外部——落地后的真实全量套件，由外层/内层验证轮补齐）**：
- AC4：落地提交时刻之后轮次里 `perFile[]` 带非零 `cpuMs` 记录数 ≥ 100；`Σ perFile.cpuMs` vs 轮级 `cpu_time_s` 的实测比值 + 差异来源（预计 Σ 只含各文件**自有进程** CPU、不含 runner/子进程/静态检查开销，故会低于 `cpu_time_s`——待实测写入）。
- AC5：≥3 个文件的 `cpuMs/durationMs` 比值 + **窗口标注**（低总并发窗口 / main 满载窗口）。
- AC6：全量 `scripts/test.sh` 0 failed 0 cancelled。**「未改动调度/准入」半句已实测**：本次 diff 不含 `suite-scheduler.ts`（只含 Touches 的 10 个采集/解析/writer/单测文件，无调度逻辑）。
- AC7：`cpuMs` 最低 10 个文件的非零 + 分辨力读数（彼此不全相等）。

## Touches

- plugin/scripts/measure-suite-reporter.mjs（`__PERFILE__` 行追加 cpu_ms 字段）
- plugin/scripts/per-file-cpu-report.mjs（路线 (a) 子进程自报预载 seam：NODE_OPTIONS=--require 加载，子进程 exit 时写 own process.cpuUsage + reaped 子进程 cutime/cstime；触发收窄为 `--test-isolation` 隔离子进程）
- plugin/scripts/measure-trend-check.ts（parsePerFileLines 正则加可选捕获组，照抄 end_ms 先例）
- plugin/scripts/full-suite-runner.ts（writer 之一：perFile 记录成形面带 cpuMs + suiteEnv 注入 QUAY_PERFILE_CPU_DIR/NODE_OPTIONS）
- plugin/scripts/pre-verified-round-record.ts（writer 之二：同款字段，禁止只改一边）
- plugin/scripts/capability-catalog.sh（新脚本 per-file-cpu-report.mjs 六表注册：QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING）
- plugin/scripts/quay-init.sh（laydown 显式清单 (c) 加 per-file-cpu-report.mjs——NODE_OPTIONS=--require 字符串路径运行期依赖，对 (a)/(b)/(d) 推导不可见）
- plugin/test/measure-suite.test.mjs（发射行含 cpu_ms + 非派生比值负控制）
- plugin/test/measure-suite-reporter.test.mjs（wiring 断言：预载 seam 接线存在）
- plugin/test/measure-trend-check.test.mjs（新旧两种行形的解析 + 缺席非 0）
- plugin/test/full-suite-runner.test.mjs（writer 之一带该字段）
- plugin/test/pre-verified-round-record.test.mjs（writer 之二带该字段）
- tasks/gap-perfile-cpu-cost-collection.md（自身）
