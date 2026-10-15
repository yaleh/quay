---
id: gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison
title: 16GiB 压力基线下：重型测试文件优化 + 内存感知调度 + 32/48/64 实际并发同 commit 完整轮对比（不足才比 20/24）
status: needs-human
labels:
  - gap
parent: null
children: []
extra: {}
depends_on:
  - gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files
  - gap-suite-memory-telemetry-anon-file-shmem-swap-psi-concurrency-process-tree-unknown-not-zero
  - gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping
  - gap-quality-gate-driver-loop-watchdog-test-hangs-since-e18ec4b04
  - gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls
---
> **PARKED**（worker 第 5 轮，2026-10-16T21:3xZ）——⛔ 不是「做完了没勾」：AC1/AC3/AC4 三条都要求
> 「16 GiB 压力基线下、由 driver 在安静时段调度的完整测量轮」，而该基线已被 **2026-10-15 的 32G 裁定**取代；
> 且 AC1 的对照（「ac341 isolated vs included」）在本仓 `scripts/test.sh` 里**无法构造**（无排除 flag）。
> 缺的是**人的裁定**：(a) 按当前生效基线重定范围 / (b) 撤 AC1/AC3 / (c) 授权原样跑。
> 裁定请求已立案：`tasks/gap-meta-call-heavy-files-ac1-ac3-ac4-2026-10-15-32g-1.md`（status: needs-human）+ `meta/META-016-*.md`。
> **本行的唯一作用是停止重派**（本轮实测每 ~7–12 分钟烧一个 worker 会话；「达重试上限即停派」在本环境已被一次
> retreat 在 42 秒内撤销，不可依赖 —— 见 `## Evidence` 第 5 轮）。
> **解除条件（unpark trigger）**：上述裁定之一被写下 ⇒ 删掉本行即可恢复可派
> （读者 = `plugin/scripts/ready-pool-check.ts` 的 `PARKED_MARKER_RE` / `isParked`，逐字排除出货池）。
> ⛔ 本轮未改 AC 文本、未勾选、未动 `status:`。

## Proposal
**Human direction 2026-10-14: the 16 GiB suite MemoryMax is a deliberate pressure constraint meant to drive test optimization. It must not be "fixed" just by raising it to 24/26 GiB.** This task does the optimization and the controlled concurrency comparison under 16 GiB. Only if that comparison shows 16 GiB cannot hold does it compare 20/24.

**Measured inputs (read-only diagnosis, same day):**
- **OOM history under 16 GiB** (136 runs with evidence, 10-10 12:16 → 10-14 08:48Z): 10-10..10-12 **0/103 runs with oom_kill**. 10-13 3/25 runs (162 OOM events). 10-14 5/8 runs (74,499 events). 19 kills total, all in phase `main`. The onset is recent. It does not track test-process RSS: the summed concurrent per-file peak median was 12.3/11.9 GiB on 10-13/14, against 14.9/13.6 GiB on the OOM-free 10-11/12.
- **Heavy files** (self-RSS max over the last 5 full rounds):
  - `packages/quay/test/gap-dashboard-goal-card-ac-denominator-includes-superseded-retired.test.mjs` 1777 MB / 4.6s
  - `plugin/test/ac260-ac261-delivery-face-ref-source.test.mjs` 1769 MB / 8.7s
  - `plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs` 1761 MB / 38.1s. **First seen 10-12T20:52, the only heavy file that is new before the OOM onset.**
  - `plugin/test/ac272-rolling-channel-version-selfproof.test.mjs` 1754 MB / 30.3s
  - `plugin/test/workflow-runner-self-hosted-check.test.mjs` 1186 MB
  - `packages/quay/test/lanes-cli.test.mjs` 726 MB
  - `plugin/test/writestate-atomicity-split-s02.test.mjs` 662 MB
  - `plugin/test/prod-data-audit.test.mjs` 596 MB / 54.8s

  11 files exceed 300 MB. p50 71 MB, p95 157 MB, p99 662 MB.
- **Actual concurrency is 64**, not the `laneCount` 128 the round records.
- **Hypothesis, untested:** ac341 plus a nearly full shared host swap (28.7/32 GiB) tipped the main phase into OOM. Counterfactual needed: the same commit with ac341 isolated or removed.

## Plan
1. **Heavy-file optimization first.** For each file above 1 GB: find what holds the memory (whole-carrier reads, unbounded fixture generation, in-process loading of large modules) and reduce it without weakening the test's assertion. Start with ac341.
2. **Memory-aware scheduling.** Files with a measured high-water above a project-declared threshold go to a bounded "heavy" bucket, so they never co-run beyond a declared count. The declaration lives in the project's own config (`.quay/config.yml` loop section, or the test-group declaration mechanism), is read by the runner, and is overridable per host. No hardcoded paths. No dependency on another project's resources.
3. **Controlled comparison, same commit, complete sets.** At MemoryMax 16 GiB, run phase concurrency **32 / 48 / 64**, each for **≥3 complete rounds**, all on the same commit, and record for each:
   - files planned = files terminal (from the completeness task);
   - tests;
   - oom_kill;
   - peak anon/file/shmem/swap (from the telemetry task);
   - phase wall times;
   - leaked processes = 0 (from the lifecycle task).

   **These runs are deliberate measurement runs, scheduled by the driver in quiet slots, not stacked on top of live fan-ins.** Only if no concurrency at 16 GiB achieves 3/3 complete, OOM-free rounds, repeat the best concurrency at 20 then 24 GiB, and state which constraint failed.
4. The policy chosen is recorded as a project declaration, with the measurements that justify it. The gate that enforces completeness stays independent of the memory policy.

## Acceptance Criteria
- [ ] AC1: ac341 counterfactual: same commit, ac341 isolated vs included, at 64-way under 16 GiB, ≥2 rounds each. oom_kill and peak anon pasted. The hypothesis is stated as supported or refuted.
- [x] AC2: heavy-file changes with before/after self-RSS and duration per file (pasted). No assertion weakened (diff of asserts pasted per file).
- [ ] AC3: the 16 GiB comparison table, 32/48/64 × ≥3 complete rounds each (commit, planned=terminal counts, tests, oom_kill, peaks, wall times, leaked=0), pasted in full. Any 20/24 rows appear only if AC3's 16 GiB rows show no viable setting, and say why.
- [ ] AC4: the chosen setting is a project-declared, host-overridable configuration (not a code literal, not a path), with the table cited as its basis.
- [x] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence. MemoryMax baseline stays 16 GiB unless AC3 proves otherwise.

## Evidence

### AC2 —— 已满足（本条已勾）。重型文件优化，逐文件 before/after 实测

**改了什么（唯一的功能改动点）。** `packages/quay/src/goal-store.ts` 的两个 goal-ledger 读者
（`gateTails` / `ledgerEvidenceMap`）过去都调 `queryGateEvents(logPath,{gate:"goal"})`，**先把整本 ledger 物化成一个
`GateEvent[]`** 再看第一行；新增的分块 `scanGoalLedger()` 一次只解析一行，live set = 一行 + 调用方自己的
（id → ≤5 字段）累加器。本工作区生产 ledger：**156,010,174 字节 / 561,167 行**（改后同一本）。

**仪器（正本，非手搓）。** 用仓库自己的 per-file 峰值 RSS 读数 `process.resourceUsage().maxRSS`
（`plugin/scripts/per-file-cpu-report.mjs`，即套件 `mem_peak_kb=` 的同一读数），经 `--test-isolation=process` 取。

> ⚠️ **本轮实测到的一处仪器缺陷（先报，因为它曾给出过假读数）**：生产 preload 的输出文件名**只按文件 key**，
> 而 `node --test --test-isolation=process <file>` 会为测试文件起一个隔离子进程——**父进程的 `argv[1]` 与子进程相同
> ⇒ 同一个 key**，父进程退出时用自己的 ~50 MB 覆盖掉子进程的大读数。**用生产 preload 直读时，五个文件全都读出
> 几乎相同的 51224–52384 KB（≈50 MB）**——那正是这个覆盖效应，不是文件的实际峰值。⇒ 改用同一读数、**按 pid 分文件**
> 的变体（每个进程写自己的 `<key>.<pid>.mem`，取各 pid 的最大值）。下面的数字用该变体测得，且**逐文件复现了本任务
> 自己记录的 1.7–1.8 GB 量级**，即它测的是子进程、不是父进程。**（这处缺陷未在本任务修改：`per-file-cpu-report.mjs`
> 不在 ## Touches 内，它是独立的一处 硬规则 3b（父进程读数冒充子进程读数）；此处只如实记录。）**

两臂**只差 `packages/quay/src/goal-store.ts`**（同一 worktree、同一测试文件、同一绝对路径 ⇒ 仪器 key 相同），每臂每文件 2 趟：

| 文件 | before 峰值 RSS（2 趟，KB） | after 峰值 RSS（2 趟，KB） | 降幅 | before 墙钟（ms） | after 墙钟（ms） |
|---|---|---|---|---|---|
| `plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs` | 1,878,072 / 1,879,328 | 346,484 / 346,484 | **5.4×** | 9006 / 9232 | 7943 / 9024 |
| `plugin/test/ac260-ac261-delivery-face-ref-source.test.mjs` | 1,871,372 / 1,872,372 | 329,356 / 342,432 | **5.5×** | 6390 / 6239 | 7104 / 7470 |
| `plugin/test/ac272-rolling-channel-version-selfproof.test.mjs` | 1,873,796 / 1,876,328 | 344,704 / 348,644 | **5.4×** | 9893 / 9742 | 9586 / 8970 |
| `packages/quay/test/gap-dashboard-goal-card-ac-denominator-includes-superseded-retired.test.mjs` | 1,879,460 / 1,881,944 | 365,208 / 371,204 | **5.1×** | 3292 / 3160 | 3109 / 2959 |
| `plugin/test/workflow-runner-self-hosted-check.test.mjs` | 1,262,044 / 1,262,044 | 299,448 / 315,456 | **4.0×** | 3616 / 3688 | 3398 / 3375 |

**裸读数（ledger 扫描本身，与测试夹具无关）。** 只有一个 goal 的 store、ledger 指向生产那本 156 MB（其余不变）：
`list()` 的峰值 `maxRSS` **before 827,680 KB → after 275,532 KB**（delta 736,300 → 184,124 KB），墙钟 989 ms → 859 ms。

**「没有削弱任何断言」——产物是一条 diff，不是一句保证。** 上面五个文件在本分支上**与 develop 逐字节相同**：
`git diff --stat develop...HEAD -- <这五个文件>` ⇒ **空**（本分支没有改动任何重型测试文件；优化全部落在
`goal-store.ts`）。各文件 `assert.` 计数（改前=改后）：ac341 **19**、ac260-ac261 **45**、ac272 **29**、
gap-dashboard **47**、workflow-runner-self-hosted-check **34**。

**答案不变（等价性控制，产物）。** 对 worktree 自己的 268 个 goal，逐 goal 取**完整保真**的 `list()` 视图模型
＋ `list()` 之后每个 goal 的 `get()` 读数，两臂各存一份、按 id 对齐比较（把两个壁钟派生字段 `at` / `lastProgressAt`
遮罩，因为两臂相隔约 6 分钟）：**goalsBefore 268 / goalsAfter 268 / goalsDiffering 0**。
⇒ 分块读与「先物化整本」在真实载体上给出**逐字节相同**的答案。（`at` 是「最近一条事件」的时间，两臂取样时刻不同，
故遮罩；该字段之外的任何字段都没有差异。）

### AC5 —— 已满足（本条已勾）。scoped 门

`bash scripts/test.sh --for-task gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison --allow-thin`
⇒ **exit 0**，`ℹ tests 271 / ℹ pass 271 / ℹ fail 0 / ℹ cancelled 0`（含本分支新增的
`runScheduler — the declared heavy tail runs AFTER the body and never co-runs beyond its bound` ✔）。
`anti-drift-touches-check.ts --merge-target develop` ⇒ `ANTI-DRIFT OK — 6 actual file(s), all within declared Touches (13 glob(s))`。
`worker-driver --write-scoped-gate-cache` 已写（develop sha `960c12095973ec1dae3cd372f2ab01961243e161`）。

### AC1 / AC3 / AC4 —— 未勾，需人裁定（⛔ 不是「做完了没勾」）

**这三条要的是「16 GiB 压力基线下、driver 在安静时段调度的完整测量轮」。该基线在本轮之前已被人的裁定取代。**

- **读数**：主检出 `.quay/config.yml` 现声明 `suite: memory_max: 32G`（人 2026-10-15 裁定「可接受把套件上限放大到
  32G」）；且 `gap-suite-declared-memory-max-swallowed-by-shared-host-split`（**done**）已落地，声明值不再被分摊护栏吞掉，
  ⇒ **32 GiB 生效**。同一载体上另一条已落地任务实测：64 车道下 `laneScaledEstimateBytes` = **11.9 GiB**，对上 32 GiB 上限
  是 2.7× 余量；而所有 OOM 轮是 **16 GiB 上限对上 19.8 GiB 估计**。本任务 Proposal 的立案理由（人 2026-10-14）
  是「16 GiB 是刻意的压力约束，**不得靠提到 24/26 来修**」，**该前提在次日被人自己的 32G 裁定取代**。
- 因此 **AC3 要求的 32/48/64 × ≥3 完整轮（9 轮）＋ AC1 的 64 路反事实（4 轮）＝ 13 轮全量套件**，
  在 16 GiB 基线上测出的表**不能充当 AC4 的「the table cited as its basis」**——被引用的会是一张描述已弃用工作点的表。
- 且本任务 Plan §3 自己把这几轮**指派给 driver 的安静时段调度**（「not stacked on top of live fan-ins」）；worker 在共享
  单飞锁上连跑 13 轮正是它禁止的那种叠加，还会把生产 fan-in 堵住数小时。
- **AC4 还有一半非 worker 可做**：机制已实现并已有门（见下），但「the chosen setting is a project-declared」的**声明**落在
  `.quay/config.yml`（gitignored、运维面），且它引用的依据就是 AC3 的表。
- **AC1 的机制半边已测得**（这是它决策相关的内容）：ac341 单文件峰值 **1834 MB → 338 MB**；本修复之前它是 OOM 起点前
  唯一新增的重型文件。剩下的 OOM 计数反事实仍需要那些全量轮。

**AC4 已实现并在门内的部分（供裁定参考，⛔ 不是勾选）**：`suite.heavy_threshold_mb` / `suite.heavy_max_concurrent`
进了 `suite-params.ts` 的 **CLOSED schema**（未知/错型/越界 ⇒ fail-closed），经 `suite-params --shell` 变成
`QUAY_SUITE_HEAVY_THRESHOLD_MB` / `QUAY_SUITE_HEAVY_MAX_CONCURRENT`；`full-suite-runner.ts` 从**它自己的轮次记录**
（`memPeakKb`，本项目自己的实测）算出重型集，交给 `suite-scheduler.ts` 的**尾部桶**（body 全排空后才派发、
最多 `heavy_max_concurrent` 个同时）。**两键都不声明 ⇒ 机制 OFF**（代码里刻意没有阈值字面量——硬规则 4 推论二）。

### 需要人决定的一件事（这一条是本轮真正的产出）

**在 32 GiB 已生效的现在，AC1/AC3 的「16 GiB 对比表」还要不要跑？** 三个可能处置，只能由人/manager 选：
(a) 把 AC1/AC3 重定范围到**当前基线**（32 GiB，或本机有效值）重跑对比；
(b) 承认 16 GiB 基线已被 2026-10-15 裁定取代，**撤掉 AC1/AC3**，AC4 改为「机制已声明可声明」而不引用表；
(c) 授权 worker/ops **在安静时段**按原样跑那 13 轮（`QUAY_SUITE_MEMORY_MAX=16G` 强制该基线）。
⛔ 在拿到裁定之前，本条**不把 AC1/AC3/AC4 标为（待外部）、也不勾选**——因为它们缺的不是「外部稍后会产出的读数」，
而是一个**人的裁定**（是否还要在那个基线上测量），把待裁定写成待外部会把「未测」伪装成「待收」。
真实读数与 scoped 门都已就位；只差这一个决定。裁定请求已立案为 **META-016**（`meta/META-016-*.md`，status: proposed）。

### 第 4 轮复核（2026-10-16）—— AC5 重跑绿；AC1/AC3 的**「成本依据」更正**（⛔ 更正的是理由，结论不变）

**本轮先做的两件事（读数）。**
① `git -C <worktree> merge --no-edit develop` ⇒ `Already up to date`；`git diff --diff-filter=U` **空**（无未合并路径）。
② 重跑 scoped 门 `scripts/test.sh --for-task <本任务> --allow-thin` ⇒ **exit 0**，
`ℹ tests 271 / ℹ pass 271 / ℹ fail 0 / ℹ cancelled 0 / ℹ duration_ms 22246.46` ⇒ **AC5 仍然成立**（AC2 的读数未变）。

**更正 1（成本）：一轮全量套件是 ~2.6–4.3 分钟，不是 ≥19 分钟。**
正本 = 套件自己的轮次记录 `.quay/verification-round.jsonl` 末 6 轮的 `durationMs`：
**188565 / 174621 / 197265 / 257253 / 156931 / 160647 ms**。
⇒ 上面「把生产 fan-in 堵住**数小时**」高估了一个量级；13 轮的实际套件时长约 **45–60 分钟**。

**更正 2（封套）：本机 anchor cgroup 的 `memory.max` = 27,917,287,424 B（26.0 GiB），**大于** 16 GiB**
（`/sys/fs/cgroup/user.slice/.../quay-anchor-quay-*.scope/memory.max`）⇒ 用 `QUAY_SUITE_MEMORY_MAX=16G` 强制时，
runner 为套件建的 systemd scope **先于** anchor 封套生效，**测出来就是真的 16 GiB 读数**。
⇒ 上面「hand-run 继承 anchor 封套 ⇒ 读数不是 16 GiB 下」的说法**在本机不成立**（它只在 anchor 封套 < 16 GiB 时才成立）。

**更正之后仍然成立的那条理由（这条才是承重的）**：`plugin/scripts/full-suite-runner.ts:3066–3083` 的
**SPAWN-LAYER SINGLE-FLIGHT**——`isRunnerInFlight(<main>/.quay/full-suite-state.json)` 为真时 runner
**拒绝启动**（`state=running` + live pid ⇒ exit 1，并往套件日志写 `single-flight-refusal`）；其后还有 resource gate
的 `WAIT` 分支。⇒ worker 连跑 13 轮期间，**生产循环的 fan-in 轮会全部被拒**——这正是本任务 Plan §3 逐字禁止的
「not stacked on top of live fan-ins」。（上面那次 scoped 门重跑不走 `full-suite-runner`，所以没有这个问题。）

**结论不变**：AC1/AC3/AC4 缺的是**人的裁定**（是否还在 16 GiB 这个已被 2026-10-15 裁定取代的基线上测量），
不是 worker 能代替决定的事。三选一 (a)/(b)/(c) 见上一节；其中 (c) 的成本比上一节写的低（~45–60 分钟），
但**仍占用单飞槽、会拒掉生产 fan-in** ⇒ 它正确的家是 **driver / 例行轨道**（可由 driver 排安静时段），
而不是 worker 会话。

### 第 5 轮（2026-10-16T21:3xZ）—— 停止重派（机制标记）+ 前置与速率的**实测登记**

本轮**不重复**第 3/4 轮的推导（结论未变）；只登记新的可核读数，并据此把「散文再抄一遍」换成**有读者的机制**。

**① 前置三条全部未变（逐条读过正本，不是转述）。**
- `.quay/config.yml`（gitignored 运维面）仍 `suite: memory_max: 32G` —— 人 2026-10-15 的提额裁定仍生效。
- `meta/META-016-*.md` 仍 `status: answered`，但那是 **meta-driver 的回答**，内容是「只报告、不代裁」并路由为
  needs-human-task ⇒ **没有人对 (a)/(b)/(c) 作出选择**。
- 裁定请求任务 `tasks/gap-meta-call-heavy-files-ac1-ac3-ac4-2026-10-15-32g-1.md` 在 `author` 与 `develop` 上
  都是 `status: needs-human`、四条 AC 全未勾。

**② 新事实：重派速率 + 「兜底」实测不可靠（两条都是读数，不是推断）。**
- `.quay/worker-outcome.jsonl` 中该任务末 5 条：`21:08:47 / 21:15:45 / 21:27:05 / 21:34:30 / 21:37:32Z`，
  **全部** `short_circuit: "ac-not-checked"` ⇒ 每 **~7–12 分钟**烧一个完整 worker 会话（每个会话一轮独立 recon）。
- `.quay/task-status-events.jsonl`：重试上限那次 `ready→needs-human`（21:15:46.271Z，actor
  `driver-filters markNeedsHuman`）在 **42 秒后**被一次 `needs-human→todo` retreat（21:16:28.719Z，
  `actor.kind: cli`）撤销，14 秒后又由 promotion-driver 晋升回 ready ⇒ **「连续 N 次未落地即停下等人」这条兜底
  在本环境实测不可依赖**（与 `RetryState.counts` 是内存态、驱动重启即清零一致）。

**③ 因此本轮的动作 = 用有读者的机制停止重派。** 任务体首行加 `**PARKED**`
（读者 = `ready-pool-check.ts` 的 `PARKED_MARKER_RE` / `isParked` ⇒ `reasons.push("parked")`，逐字排除出货池）。
**它是可逆的**：裁定一到删掉该行即恢复可派，解除条件就写在标记旁。⛔ 未改 AC 文本、未勾选、未动 `status:`、未改任何代码文件。

**④ 分支仍 fan-in-ready（本轮唯一的仓库动作是 merge develop）。**
`git -C <worktree> merge --no-edit develop` ⇒ 仅任务文件一处冲突（`HEAD` 侧是 `develop` 侧的**真子集**：
`develop` 那侧含同一句 + META-016 引用 + 第 4 轮段落）⇒ 按超集解；解后 `git diff develop -- tasks/<id>.md` **空**、
`git diff --diff-filter=U` **空**。`git diff --name-only develop...HEAD` 仍是那 6 个源/测试文件（未新增）。

**⑤ 仍未勾的部分。** AC1/AC3/AC4 缺的是**人的裁定**（ruling-dependent），故不标 `（待外部）`
——标了会把「没人裁定」改名成「正在采集」（硬规则 3b）。AC2/AC5 保持已勾，读数未变。

## Touches
- tasks/gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison.md
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/suite-params.ts
- plugin/scripts/suite-scheduler.ts
- scripts/test.sh
- packages/quay/src/goal-store.ts
- plugin/test/suite-params.test.mjs
- plugin/test/suite-scheduler.test.mjs
- plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs
- plugin/test/ac260-ac261-delivery-face-ref-source.test.mjs
- plugin/test/ac272-rolling-channel-version-selfproof.test.mjs
- packages/quay/test/gap-dashboard-goal-card-ac-denominator-includes-superseded-retired.test.mjs
- plugin/test/workflow-runner-self-hosted-check.test.mjs

## Blocker

**2026-10-15T21:08:47.586Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 2/5，剩余未勾 3）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：8f6ea38f-3f92-4864-83ca-cce156885573

## Needs-Human

**执行 2026-10-15T21:15:46.271Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：AC 未全勾（checked 2/5，剩余未勾 3）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：e7b51858-02c8-47b5-baa1-9040d5172010
## Needs-Human

**执行 2026-10-15T21:43:46.509Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：AC 未全勾（checked 2/5，剩余未勾 3）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：bf7487c0-cc37-4c95-a1ca-2745cabaf510
