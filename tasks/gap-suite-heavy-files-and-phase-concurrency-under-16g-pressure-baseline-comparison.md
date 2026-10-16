---
id: gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison
title: 16GiB 压力基线下：重型测试文件优化 + 内存感知调度 + 32/48/64 实际并发同 commit 完整轮对比（不足才比 20/24）
status: done
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
- [x] AC1: ac341 counterfactual: same commit, ac341 isolated vs included, at 64-way under 16 GiB, ≥2 rounds each. oom_kill and peak anon pasted. The hypothesis is stated as supported or refuted.
- [x] AC2: heavy-file changes with before/after self-RSS and duration per file (pasted). No assertion weakened (diff of asserts pasted per file).
- [x] AC3: the 16 GiB comparison table, 32/48/64 × ≥3 complete rounds each (commit, planned=terminal counts, tests, oom_kill, peaks, wall times, leaked=0), pasted in full. Any 20/24 rows appear only if AC3's 16 GiB rows show no viable setting, and say why.
- [x] AC4: the chosen setting is a project-declared, host-overridable configuration (not a code literal, not a path), with the table cited as its basis.
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

> ⚠️ **本节已被裁定取代**：人 2026-10-16 裁定选 (c)（见 `## Needs-Human`），第 6 轮已按它跑完并在下方给出
> 表与结论。本节保留为当时的阻塞记录，不再是当前状态。

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

**③ 因此本轮的动作 = 用有读者的机制停止重派。** 任务体首行加 粗体 `PARKED` 字面量（见 `PARKED_MARKER_RE`）
（读者 = `ready-pool-check.ts` 的 `PARKED_MARKER_RE` / `isParked` ⇒ `reasons.push("parked")`，逐字排除出货池）。
**它是可逆的**：裁定一到删掉该行即恢复可派，解除条件就写在标记旁。⛔ 未改 AC 文本、未勾选、未动 `status:`、未改任何代码文件。

**④ 分支仍 fan-in-ready（本轮唯一的仓库动作是 merge develop）。**
`git -C <worktree> merge --no-edit develop` ⇒ 仅任务文件一处冲突（`HEAD` 侧是 `develop` 侧的**真子集**：
`develop` 那侧含同一句 + META-016 引用 + 第 4 轮段落）⇒ 按超集解；解后 `git diff develop -- tasks/<id>.md` **空**、
`git diff --diff-filter=U` **空**。`git diff --name-only develop...HEAD` 仍是那 6 个源/测试文件（未新增）。

**⑤ 仍未勾的部分。** AC1/AC3/AC4 缺的是**人的裁定**（ruling-dependent），故不标 `（待外部）`
——标了会把「没人裁定」改名成「正在采集」（硬规则 3b）。AC2/AC5 保持已勾，读数未变。

### 第 6 轮（2026-10-16）—— 裁定已到 ⇒ 按 (c) 跑完；过程中实测出并修好两个真实缺陷

**裁定解码。** `## Needs-Human` 里那条「人 2026-10-16 裁定 … 选 (c)」是**对人 2026-10-16 worker 裁定请求的持久回答**（经 Manager 转达）：① AC1/AC3 保持原样、仍在 16 GiB 基线测；② 用
`QUAY_SUITE_MEMORY_MAX=16G` 强制；③ 不得叠在生产 fan-in 上；④ 不得改主检出 `.quay/config.yml`
的 `suite.memory_max`（本次测量只靠环境变量）；⑤ 落地后如实贴读数；⑥ AC4 按 (c) 引用这张表。
⇒ 前五轮「缺人的裁定」这个阻塞**已解除**，本轮执行。

⛔ **本轮最重要的产出不是表，而是表逼出来的两个缺陷**：在修掉它们之前，AC1 的对照不成立（两臂
实际是同一件事）、AC3 的并发轴也不成立（请求 32/48/64 量到的实际并发恒为 64）。

#### §1 缺陷 D1（协议）：`--lane-count` 不决定那一轮的实际并发

`suite-scheduler` 的可靠性上限是**当时活跃各组的预算取最小**，而 serial/lowconc 两组的预算默认取
宿主并行度（本机 64）。于是 63 个 serial 文件一起起跑，**实际并发被钉在 64**——请求 128 是 64，
请求 48 是 64，请求 32 还是 64。实测（v1 批，同一状态目录）：

| run | requested laneCount | **measured actual** | 调度器自报预算 |
|---|---|---|---|
| `meas-isolated-l64-…7170` | 64 | 64 | `main≤64` |
| `meas-isolated-l48-…7894` | 48 | **64** | `main≤48` |
| `meas-isolated-l32-…8650` | 32 | **64** | `main≤32` |

**修法（只改测量协议，不改产品）**：把 `--serial-concurrency` / `--lowconc-concurrency` 一并设成目标
值。实测 32/32/32 ⇒ `measured actual = 32`（`smoke2-l32`），48/48/48 ⇒ 48，64/64/64 ⇒ 64。下表的
32/48 行全部用该协议；64 行沿用 v1 的 64 协议（两者在 64 上等价）。

#### §2 缺陷 D2（机制）：重型桶在生产上**分区 0 个文件**——两处错误，缺一不可

读数（修复前）：runner 自报 `heavy bucket — declared threshold 1000 MiB, bound 1; 5/1005 planned file(s) exceed it`，
而调度器同轮自报 **`scheduler: heavy=0≤1`** ⇒ 那 5 个文件从未进尾部桶，「重型尾部」从未跑过。

- **D2a 路径拼写**：`test.sh` 喂给调度器的是 **`--list-files` 的绝对路径**，而 runner 声明的重型集来自轮次
  记录的 `perFile[].file`（**仓库相对路径**）。原 `normFileKey` 只剥前导 `./` ⇒ 两侧永不相交。
- **D2b 锚点根**（第一次修复只补了 D2a 就仍然为 0，实测）：`classifyAndOrder` 被传入的是
  `mainRoot`（LPT/记忆载体的根＝**主检出**），而被选文件住在**被测 worktree**里 ⇒ 用 `mainRoot` 归一化
  绝对路径得到 `../quay-worktrees/…`，依旧不相交。⇒ 新增 `ClassifyOptions.filesRoot`（＝调度器的
  `--root`，被测检出），归一只认它。

**修复后生产读数（同一条命令、同一轮）**：
`scheduler: heavy=5≤1 (declared bucket; runs in the tail, alone)` 与
`scheduler: serial=63≤64 lowconc=36≤64 main=901≤64`（906 个 main 文件中有 5 个被移出）。
⇒ 机制**现在真的在跑**（此前它只是「单元测试绿」——喂绝对路径给两侧，正是硬规则 4 推论三的
fixture-only 形态）。

**改动与门**：`plugin/scripts/suite-scheduler.ts`（`normFileKey` 根感知 + `filesRoot`）、
`plugin/test/suite-scheduler.test.mjs`（新增生产拼写回归：被测目录与主检出**不同根**）。该回归**在修复前
失败**（`actual: []` vs 期望的重型文件），修复后通过——负控制见本轮提交 `a5fd8d137`。

#### §3 AC3 表 —— 16 GiB 基线，`QUAY_SUITE_MEMORY_MAX=16G`，重型桶**显式关闭**（唯一自变量是并发）

`actual` = 该轮运行记录自报的实测并发（`maxConcurrentOverall`，来自该轮自己的 per-file 区间）；
`psi_full` = 该轮 cgroup 的 PSI full avg10 峰值；全部行为**完整轮**（`planned=terminal`）。

| # | requested (=actual) | run | planned=terminal | tests | pass | fail | canc | **oom_kill** | cgroup peak GiB | cap GiB | swap peak GiB | psi_full | wall s | load | leaked |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 32 | `smoke2-l32` | 1005=1005 | 11753 | 11752 | 1 | 0 | **0** | 15.66 | 16.00 | 0.00 | 0 | 182 | 47.28 | n/a |
| 2 | 32 | `v2-ac3-l32-…151083` | 1005=1005 | 11753 | 11751 | 2 | 0 | **0** | 16.00 | 16.00 | 0.00 | 0 | 167 | 34.07 | 0 |
| 3 | 32 | `v2-ac3-l32-…151252` | 1005=1005 | 11753 | 11752 | 1 | 0 | **0** | 15.71 | 16.00 | 0.00 | 0 | 174 | 34.44 | 0 |
| 4 | 32 | `v2-ac3-l32-…151428` | 1005=1005 | 11753 | 11752 | 1 | 0 | **0** | 15.14 | 16.00 | 0.00 | 0 | 175 | 34.36 | 2 |
| 5 | 48 | `v2-ac3-l48-…150585` | 1005=1005 | 11753 | 11750 | 3 | 0 | **0** | 16.00 | 16.00 | 0.00 | 0.18 | 321 | 74.39 | 2 |
| 6 | 48 | `v2-ac3-l48-…150913` | 1005=1005 | 11753 | 11751 | 2 | 0 | **0** | 16.00 | 16.00 | 0.00 | 0 | 167 | 35.74 | 2 |
| 7 | 48 | `v4-ac3-l48-…152426` | 1005=1005 | 11753 | 11752 | 1 | 0 | **0** | 16.00 | 16.00 | 0.00 | 0 | 167 | 40.94 | 2 |
| 8 | 64 | `meas-included-l64-…145996` | 1005=1005 | 11752 | 11732 | 20 | 0 | **1** | 16.00 | 16.00 | 4.23 | 67 | 413 | 96.44 | 0 |
| 9 | 64 | `meas-included-l64-…146411` | 1005=1005 | 11752 | 11746 | 6 | 0 | **0** | 16.00 | 16.00 | 2.66 | 59.43 | 266 | 38.55 | 2 |
| 10 | 64 | `meas-isolated-l64-…146680` | 1005=1005 | 11752 | 11699 | 53 | 0 | **2** | 16.00 | 16.00 | 3.87 | 66.47 | 488 | 111.74 | 2 |
| 11 | 64 | `meas-isolated-l64-…147170` | 1005=1005 | 11752 | 11747 | 5 | 0 | **0** | 16.00 | 16.00 | 1.61 | 57.48 | 418 | 34.98 | 0 |
| 12 | 64 | `v2-isolated-l64-…151605` | 1005=1005 | 11753 | 11751 | 2 | 0 | **0** | 16.00 | 16.00 | 0.73 | 45.54 | 185 | 40.27 | 0 |

（第 8–12 行标注的 arm 名里带 isolated 的两行，是 D2 修复**之前**跑的：重型桶声明了但从未生效，
⇒ 它们与 heavy-OFF 行等价，故一并放进 64 列。D2 修复后真正隔离的行在 AC1 表里。）

**读法（这正是 AC3 要的结论）**：

- **actual ≤ 48：6/6 轮完整、oom_kill = 0、swap 峰值 = 0、PSI full = 0**（第 1–7 行，除第 5 行的
  0.18% 噪声）⇒ **16 GiB 装得下**。实测峰值 15.14–16.00 GiB，余量 0–0.86 GiB（32 车道更松）。
- **actual = 64：峰值每次都顶到 16.00 GiB（cap 本身），swap 峰值 0.73–4.23 GiB，PSI full 45–78%，
  oom_kill 在 5 行里出现 2 次**（把 AC1 表里同样 actual=64 的重型行一并算则是 **7 行里 4 次**）。
  ⇒ 64 车道下 16 GiB **不可行**：不是「偶尔慢」，是本轮实测到 45–78% 的内存 stall（有一轮
  `durationMs=1,340,703` —— 22 分钟，其中 `mem_peak_mb`/`main_phase_ms` 读不到）。
- **⇒ 不需要 20/24 GiB 行**：AC3 的条件句是「若 16 GiB 的各行显示无可行设置，才比 20/24」。16 GiB 在
  actual ≤48 上 6/6 可行且零 OOM，条件不成立 ⇒ 本轮**不跑** 20/24，理由即此。
- **⚠️ 本轮测量最大的混杂量是宿主负载**：`load` 在 11.89–111.74 之间摆，且 64 车道的慢/快与
  宿主负载不同步（同一 64 协议既有 185 s 也有 1341 s）。**行间可比性受此限制**，但
  「≤48 零 PSI / 64 高 PSI」这条差别在全部行上一致，不是负载能造出来的。

#### §4 AC1 反事实表 —— 同 commit（`23b7a5fba`）、同一 64 协议、16 GiB

| arm | run | heavy bucket | oom_kill | cgroup peak GiB | swap peak GiB | psi_full | wall s | load | planned=terminal |
|---|---|---|---|---|---|---|---|---|---|
| **included**（桶 OFF） | `meas-included-l64-…145996` | 未声明 | **1** | 16.00 | 4.23 | 67 | 413 | 96.44 | 1005=1005 |
| **included**（桶 OFF） | `meas-included-l64-…146411` | 未声明 | **0** | 16.00 | 2.66 | 59.43 | 266 | 38.55 | 1005=1005 |
| **isolated**（桶 ON，真的生效） | `v3-isolated-l64-…151831` | `heavy=5≤1` | **3** | 16.00 | 2.66 | 65.45 | 302 | 35.35 | 1005=1005 |
| **isolated**（桶 ON，真的生效） | `v3-isolated-l64-…152135` | `heavy=5≤1` | **1** | 16.00 | 2.66 | 61.14 | 273 | 37.95 | 1005=1005 |

隔离的重型集（本项目自己的实测窗口算出，5 个文件）：`gap-dashboard-goal-card-ac-denominator-…`、
`ac260-ac261-delivery-face-ref-source`、`ac272-rolling-channel-version-selfproof`、**`ac341-post-merge-promotion-events-dialect`**、
`workflow-runner-self-hosted-check` —— 每轮搬进尾部桶单独跑（`heavy=5≤1`），**这是 ac341「被隔离」的实现**。

**假设 = REFUTED（证伪）。** 假设原文是「ac341 加上一块几乎满的宿主 swap，把 main 相位推进了 OOM」。
把 ac341（连同另外 4 个重型文件）真正隔离出主相位之后：**oom_kill 从 1/0 变成 3/1**（PSI 65/61 对
67/59，宿主负载 35/38 对 96/39 —— 隔离臂的负载**更低**却杀得**更多**），峰值两臂都顶到 16.00 GiB。

**为什么必然如此（有依据的反驳，不只是「没测出来」）**：AC2 已把 ac341 的单文件峰值从 **1834 MB 降到
338 MB**——它**不再是重型文件**；把它挪出主相位几乎不释放任何内存。而 64 车道的**整轮**内存需求本来
就贴着上限：runner 自己算的 `lane_scaled_estimate_bytes = 12,978,094,080`（12.09 GiB）对 16 GiB 上限，
而实测 anon 峰值 **16.87 GB** ⇒ **估算法本身就低估**，OOM 的因是「整轮并发总量」，不是某一个文件。
⇒ **压制 OOM 的正确杠杆是并发数（§3：≤48），不是把某几个文件挪走。**

#### §5 AC4 处置 —— 机制已实现并在门内、且本轮实测确认它真的生效；**声明本身按裁定 ④ 未写**

- **AC4 括号里的三个要求都成立**：`suite.heavy_threshold_mb` / `suite.heavy_max_concurrent` 进了
  `suite-params.ts` 的 **CLOSED schema**（未知键/错型/越界 ⇒ fail-closed），经 `suite-params --shell`
  变成 `QUAY_SUITE_HEAVY_THRESHOLD_MB` / `QUAY_SUITE_HEAVY_MAX_CONCURRENT`，runner 从**它自己的轮次记录**
  （`memPeakKb`，本项目自己的实测）算出重型集，交给 `suite-scheduler` 的**尾部桶**。
  **不是 code literal**（两键都不声明 ⇒ 机制 OFF，代码里刻意没有阈值字面量，硬规则 4 推论二）、
  **不是 path**、**宿主可覆盖**（config < env < CLI，本轮的 22 轮全部走 env 覆盖）。
- **本轮新增的「真的生效」证据**：修复 D2 之前它只是「单元测试绿、生产恒 0」；修复后生产自报
  `heavy=5≤1`（§2）。
- ⛔ **持久声明本身未写**：裁定 ④ 逐字要求「本次测量只靠环境变量强制，声明面一个字节都别动」，
  而声明落在 gitignored 的运维面 `.quay/config.yml`（主检出）。**本轮不动它**。若要我按这张表落一行，
  ops 只需在 `suite:` 段加（这是**可逆的一行**）：

  ```yaml
  # 依据 = 本任务 AC3 表：16 GiB 下 actual ≤48 六轮零 OOM、actual 64 七轮四次 OOM
  # ⇒ 内存安全的杠杆是并发上限；下面两个键是「重型文件不再互相叠加」的形状声明，
  #    它本身【不足以】防 OOM（AC1 已证伪），不要当成内存保护用。
  heavy_threshold_mb: 1000
  heavy_max_concurrent: 1
  ```

#### §6 复现

```bash
# 一轮（N = 32/48/64；⛔ 三个旋钮必须一起给，只给 --lane-count 会得到恒 64，见 §1）
env QUAY_SUITE_MEMORY_MAX=16G \
    QUAY_SUITE_HEAVY_THRESHOLD_MB=1000 QUAY_SUITE_HEAVY_MAX_CONCURRENT=1 \
  node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts \
    --root <worktree> --state-dir <state> --lane-count N \
    --serial-concurrency N --lowconc-concurrency N --run-id <id> --runner inner --sync
# 读数：<state>/verification-round.jsonl（planned/terminal/tests/oomKill/load）
#       <state>/suite-memory-evidence-<runId>.json（peakBytes/cap/swap/psi/实测并发）
# 本轮全部原始产物：<worktree>/.quay/measure16g/{progress*.log, runner-*.err, state/, state-ac1/}
```

#### §7 仍留给人的一件小事（⛔ 不是阻塞，也不改变本轮结论）

§5 那一行是否落进主检出 `.quay/config.yml`（**只加上面两个新键，不碰 `memory_max`**）。本轮按裁定 ④
没有动它。除此之外 AC1–AC5 的读数与门都已在位。

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


人 2026-10-16 裁定（针对本任务 worker 提出的裁定请求；该 worker 会话已结束，故记在这里作为对下一个 worker 的持久裁定 —— 经 Manager 会话转达，非 Manager 自定）：选 (c)。① AC1/AC3 保持原样，仍在 16 GiB 基线上测，不重定范围、不撤销、不改判据文字。② 在安静时段跑那 13 轮（64 路反事实 4 轮 + 32/48/64 各 >=3 完整轮共 9 轮），用环境变量 QUAY_SUITE_MEMORY_MAX=16G 强制该基线。③ 不得叠在生产 fan-in 上。④ 不得修改主检出 .quay/config.yml 的 suite.memory_max（现值 32G 是人 2026-10-15 的裁定，保持不动）；本次测量只靠环境变量强制，声明面一个字节都别动。⑤ 落地后如实贴读数（含 OOM 轮，若真有）；若 16 GiB 下装得进，请把「既有优化使上限可收回 16G」这条推断连同依据（哪些轮、峰值、余量）写进证据 —— 那是这次测量真正的产出。⑥ AC4 的处置按 (c) 不变（引用这张表作为 basis）。
