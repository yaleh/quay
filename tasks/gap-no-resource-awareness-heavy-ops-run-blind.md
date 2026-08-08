---
id: gap-no-resource-awareness-heavy-ops-run-blind
title: Heavy operations run blind to CPU/memory — measured 4.25x
  oversubscription and swap is 0, so OOM is a cliff
status: needs-human
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

> **内层 fan-in 处理（2026-08-05 12:5xZ）：fail/timeout，needs-human。** 外层裁定：本任务 scoped 套件
> 已中止（25 分钟超时；嵌套套件 2529066 内部又跑 40+ 文件 coverage，PSI 80+，疑似自指死锁）。agent
> （a79458bb）首轮 scoped 已 42/42 过，但第二轮（加入 full-suite-runner.test.mjs 后）死锁。已停 agent。
> **不重跑全 scoped**（外层指令）。
>
> **seam 调查（外层点名 RESOURCE_GATE_TEST_CPU_AVG10）**：seam **存在且两处测试都用对了**——
> `resource-gate.test.mjs` 的 `runGate` 传 seam env；`full-suite-runner.test.mjs` AC3 用
> `QUAY_TEST_SKIP_RESOURCE_GATE=0` + `RESOURCE_GATE_TEST_CPU_AVG10` 强制 WAIT/GO（确定性）。死锁
> **不是「seam 没生效」**——是 `--for-task` 选中集把 gate 测试与 `full-suite-runner.test.mjs` 同跑，
> 后者嵌套起真实 `test.sh`（40+ 文件 coverage）把 PSI 推到 80+；gate 的**非 CPU 检查**（mem/
> node_procs/orphans）读真实值，负载下可能触 WAIT，测试等死。**建议**：gate 测试全量密封（全部检查
> 都 seam 化）或调整选中集避免二者同跑。
>
> **保留**：worktree `/home/yale/work/quay-worktrees/resource-aware`（agent 未提交的 source-pin 测试
> ——assert runner 查 gate / nproc 派生 / replace splice，价值保留，修复后可 reland）。

**type:** execution

## Proposal

2026-08-03 02:1xZ 批量全量 #1 崩溃：5 个文件失败，**全部是重型测试超时**
（`prepare-milestone-convergence` 48.8s、`runner-grouping` 39.5s），而同一提交上
AC11 的显式文件形式 **2089ms 绿**。内层的判断是「负载过高，不是代码缺陷，等 load 降」——
方向对，但用的是代理信号，而且**没有任何机制**，只有目测。

### 实测（2026-08-03 02:1xZ）

| 指标 | 值 | 含义 |
|---|---|---|
| `/proc/pressure/cpu` `some avg10` | **84.77**（avg300=51.63） | 85% 的时间有任务在等 CPU——**CPU 饥饿已确证** |
| `/proc/pressure/memory` `some avg10` | **0.00** | 内存压力当前为零 |
| **Swap** | **0** | **没有缓冲**——内存一旦不够就是 OOM，没有降级段 |
| `nproc` / load1 | 4 / 9.07 | 2.3× 超订 |
| `scripts/test.sh` 默认并发 | **8（常量）** | **实测真实进程 17 个 ⇒ 4.25× 超订**（见下方修正） |
| `MemAvailable` | 5.0 GB / 16 GB | 单个 `node --test` RSS 106–255 MB |
| 4 个 `claude` 进程 | 合计 ~2.4 GB | **OOM 真发生时被杀的就是内外层会话本身** |

### 修正（2026-08-03 02:23Z 实测）：`--test-concurrency=8` 实际是 17 个进程

本任务初稿写「4 核跑 8 = 2× 超订」。**实测推翻了这个数字**：

```
套件根 pid 3599012（node --test --test-concurrency=8），已运行 403s
  直接子进程（test worker）: 8
  这些 worker 各自派生的子进程: 8
  ⇒ 实际 node 进程 ≈ 17，不是 8
```

**测试自己会派生 node 子进程**，且每个都是完整的 `node --experimental-strip-types`
（启动时做 TypeScript 剥离，CPU 开销显著）。抽样到的子进程：

```
node packages/quay/bin/quay.ts retreat DONE-RET --reason rework needed
node --experimental-strip-types plugin/scripts/prepare-admission-check.ts --release
node --experimental-strip-types .../run-identity.ts --create
bash scripts/test.sh --group product,engine --list-files
node --experimental-strip-types plugin/scripts/select-tests-for-touches.ts
```

**⇒ 真实超订是 4.25×（17/4），不是 2×。** 这直接改掉了本任务的机制设计：

- **`--test-concurrency` 不是正确的控制旋钮**——它控制 worker 数，而真实进程数 ≈ 2.1× worker 数
- **AC5 原写「默认从 nproc 推导 ⇒ 本机 = 8」，那仍然是 4.25× 超订**。推导必须除以放大系数，
  或者直接以**实测进程数**为准
- **gate 必须数真实进程**（`pgrep -xc node-MainThread`），不能相信 `--test-concurrency` 的字面值

**这也解释了为什么重型测试从隔离下 2.0s 变成 48.8s**：它们不是计算慢，是**进程启动争抢**——
`prepare-milestone-convergence` 这类测试正是派生子进程最多的。

### 顺带发现：孤儿 MCP 进程（内存泄漏，非 CPU）

```
pid 683651  ppid=1  已运行 62594s (17.4h)  cwd=/tmp/quay-prof-ws-gp4rms      CPU 累计 00:00:01
pid 683658  ppid=683651  已运行 62593s     cwd=/tmp/quay-wt-speedup/... (deleted)
```

父进程已死（ppid=1），**工作目录已被删除但进程仍持有句柄**，17.4 小时。
CPU 累计仅 1 秒 ⇒ **它们是内存占用（合计约 200MB），不是 CPU 来源**。
与滞留 worktree 同一形态：**做完的工作留下的东西没人回收，且没有告警通道**。
gate 的输出里应当把「ppid=1 且 cwd 已删除的 node 进程」单列一行——它们不影响 GO/WAIT 判定，
但**不列出来就永远不会被发现**。

### 两个独立的结论

**1. 超时的根因是 CPU 饥饿，且这是设计出来的。** `--test-concurrency=8` 是写死的常量，
而这台机器 `nproc=4`，且实测每个 worker 再派生约 1 个 node 子进程 ⇒ **单层就是 17 个进程抢 4 个核**。
两层同时跑 ⇒ 约 34 个。
ADR-019 当初测得 8 比运行时默认快 10.3%，但那是**在没有第二层并发跑的前提下**测的。

**2. OOM 是悬崖不是斜坡。** `swap=0` 意味着没有渐进降级：`MemAvailable` 掉到阈值以下时
OOM killer 直接动手，**而 RSS 最大的进程正是 `claude` 本身**（793/681/518/424 MB）。
后果不是测试失败，是**内层或外层会话被杀**——一个连自己被杀了都无法记录的失败。

### 为什么这是机制问题而不是调参

内层此刻在「等 load 降」，外层同时在跑核实命令——**两层都在用目测判断资源，且互为负载源**。
`orchestrator-loop-tick.md` 步骤 0c 已经写了「外层核实会和内层抢 CPU」，但它是**一条散文规则**，
没有任何东西执行它。今晚重型测试超时至少 3 次，每次都靠人或外层事后诊断。

**这还解释了 AC1 的不可重现**：同一提交 run1 零失败、run2 一个失败。
若失败源是 CPU 饥饿而非测试缺陷，那么「连跑 2 次全绿」在一台 4.25× 超订的机器上
**本来就不是一个关于代码的判据**。这条要写进 AC1 的解释里。

## Contract

```
measure   cpu_stall   = `cat /proc/pressure/cpu` 的 some avg10 字段      # 直接测「有任务在等 CPU」
measure   mem_avail   = `free -m` 的 available 列（MB）                  # 非 free 列
measure   heavy_procs = `pgrep -xc node-MainThread` 的计数                # 真实进程数；--test-concurrency 的字面值低估 2.1×
band      cpu_ok      = some avg10 < 40                                  # 实测：84.77 时重型测试超时
invariant nproc 在判定前后一致                                            # 判据必须相对核数，不是绝对数
invoke    `scripts/resource-gate.sh --for full-suite`                    # 退出码 0=GO 非 0=WAIT
control   人为把 cpu some avg10 压高（起 N 个 busy loop）⇒ gate 必须返回 WAIT
resume    n/a: gate 是无状态判定，无中途产物
```

## Chosen mechanism

**一个两层共用的资源闸，把「目测 load」换成「读 PSI 的结构信号」。**

### 一、`scripts/resource-gate.sh`

读 `/proc/pressure/cpu`、`/proc/pressure/memory`、`MemAvailable`、`nproc`、`pgrep -xc node-MainThread`，
输出**数字与判定**，退出码 0=GO / 非 0=WAIT：

```
cpu_stall(some avg10)=84.77  [限 40]   WAIT
mem_avail=5099MB             [限 2048] ok
nproc=4  node_procs=32  swap=0
⇒ WAIT: CPU 饥饿。重型测试在此负载下会超时（实测 48.8s vs 隔离 2.0s）
```

**为什么用 PSI 而不是 load average**：load 是代理——它把不可中断 I/O 也算进去，是 1 分钟平滑的
EWMA，滞后于真实争抢。`/proc/pressure/cpu` 的 `some avg10` 直接测「有任务因等 CPU 而停滞的时间比例」，
正是我们关心的量。这与本仓库反复出现的「代理信号 → 结构信号」是同一条（见
`orchestrator-loop-tick.md` 步骤 0b 的表）。

### 二、`--test-concurrency` 从 `nproc` 推导，不再是常量 8

**不能用 `nproc*2`**——那在本机仍得 8，即实测 17 个进程、4.25× 超订。
默认按 `max(1, floor(nproc / 放大系数))` 推导，**放大系数由 AC5 实测得出**（初测 ≈ 2.1）。
本机 ⇒ `floor(4/2.1) = 1`，这与现状（8）差距很大，**所以 AC5 要求先测再定，不许照初测值直接改**：
真实峰值可能低于抽样瞬时值，且更低的并发会拉长墙钟——这是一个需要数据的取舍，不是一个可以推理出的常数。
**显式传入的 `--test-concurrency=N` 永远优先**——不夺走人的控制权。

### 三、OOM 护栏（swap=0 才使这条必要）

启动全量套件前若 `mem_avail < 2048MB` ⇒ 拒绝启动并打印**当前 RSS 最大的 5 个进程**。
理由写在输出里：`claude` 进程 RSS 424–793MB，OOM killer 会优先杀它们，
**而被杀的会话无法记录自己被杀**。

### 四、两层都调用它

- `scripts/test.sh` 在 exec 前调用；WAIT 时**打印数字后退出非 0**，不静默等待
  （静默等待与卡死不可区分）
- `orchestrator-loop-tick.md` 步骤 0c 那条散文规则改为「跑全量套件前调用 gate」
- `docs/analysis/fast-mode-loop-tick.md` 同样

**不做**：不自动重试、不自动排队、不后台守护。这是一个**判定**，不是一个调度器——
判定便宜且可核对，调度器会变成下一个安静说谎的仪器。

## Acceptance Criteria

- [x] AC1: `scripts/resource-gate.sh` 实现，输出**数字与限值**（不只 GO/WAIT），退出码 0/非 0
- [x] AC2: 判据用 `/proc/pressure/cpu` 的 `some avg10`，**不用 load average**；
      任务体记录为什么（PSI 是结构信号，load 是代理）——见 Measured AC2
- [x] AC3: **负控制**——人为起 N 个 busy loop 把 `some avg10` 压过阈值，gate 必须返回 WAIT；
      停掉后必须返回 GO。两个方向都有实跑输出（见 Measured AC3）
- [x] AC4: `pgrep -xc node-MainThread`（`comm` 精确匹配）计数，**不得用 `pgrep -f`**，也**不得用 `grep -x node`**（Node 的 comm 是 `node-MainThread`，该写法永远返回 0）——
      后者会匹配任何命令行含 "node" 的进程，包括调用方自己（本仓库已踩两次）；单元测试断言了该形态
- [x] AC5: **先实测放大系数**——全量套件实测峰值 17 进程 / concurrency 8 = **2.125**（任务体已记录，
      2026-08-03）；本次 scoped concurrency-2 复测子进程重型文件 = **3.0/worker**。并发默认值按
      `max(1, floor(nproc / 2.1))` 推导，**不是 `nproc*2`**；实测比值与推导见 Measured AC5
- [x] AC5b: 选中文件数在改前后**完全一致**（172→172 对照，不含 AC11 新增测试文件本身；见 Measured AC5b）
- [x] AC6: `mem_avail < 2048MB` 时拒绝启动全量套件，并打印 RSS 前 5 进程（单元测试断言；RSS 前二
      实测为 claude 会话 871MB/761MB，印证「OOM 被杀的是会话本身」）
- [x] AC7: `scripts/test.sh` 接入；WAIT 时打印数字后退出非 0，**不静默等待**（实测见 Measured AC7）
- [x] AC8: 两个 tick 文件（外层 `orchestrator-loop-tick.md` 步骤 0c、内层
      `fast-mode-loop-tick.md`）里的散文规则改为调用 gate
- [x] AC9: 在 `gap-suite-cost-model-is-wrong-optimizations-buy-nothing` 与 AC1 的记录里补一条：
      **同一提交两次结果不同，可能是 CPU 饥饿而非测试缺陷**——「连跑 2 次全绿」在 4.25× 超订的机器上
      不是一个关于代码的判据（见 Measured AC9 与本任务 Measured 段）
- [x] AC10: gate 输出单列「ppid=1 且 cwd 已删除的 node 进程」——不参与 GO/WAIT 判定，
      但不列出就永远不会被发现（本次实跑已列出 2 个：`pid=3783799/3818492 cwd=/tmp/quay-wt-m264 (deleted)`）
- [x] AC11: 测试带 `// @test-group engine` 声明（`plugin/test/resource-gate.test.mjs` 首行）

## Definition of Done

- [x] AC3 的双向负控制实跑输出贴进任务体（见 Measured AC3）
- [x] AC5 的实测放大系数、推导值、以及「选中文件数未变」的对照贴进任务体（见 Measured AC5 / AC5b）
- [ ] `scripts/test.sh` 连跑 2 次全绿（**在 gate 报 GO 的窗口里跑**——这本身就是本任务的用法演示）——
      **未勾，理由**：默认并发按本任务改为推导值 `max(1, floor(nproc/2.1)) = 1` 后，全量墙钟约
      ~8 倍于 c8（小时级），且本任务自身的 CPU 纪律要求不得在饥饿态跑全量、不得与其它套件并发；
      单会话内无法完成 2 次全量绿。机制的 GO 方向已由 AC3 方向 1/3（avg10=3.91/16.65 时 gate 报 GO）
      与 AC5b 的 `--list-files` 对照证明；全量连跑需在 gate 报 GO 的窗口由外层/CI 执行
- [x] 明确记录：**两层互为负载源，而两层都在目测**。gate 的作用不是让测试更快，
      是让「现在能不能跑」成为一个可核对的数字，而不是各自的印象（见 Measured DoD）

## Measured & execution record (2026-08-03, worktree `/tmp/quay-wt-resaware`, branch `task/gap-no-resource-awareness-heavy-ops-run-blind`)

### AC2 — 为什么用 PSI 而不是 load average（任务体记录）

load 是代理：它把不可中断 I/O 也计入，且是 1 分钟平滑的 EWMA，滞后于真实争抢；claude 会话常驻使
load 永不降。`/proc/pressure/cpu` `some avg10` 直接测「有任务因等 CPU 而停滞的时间比例」——正是
我们关心的量。gate 的代码路径只读 `/proc/pressure/cpu` 与 `free -m`，不读 `/proc/loadavg`（单元
测试 AC2 断言）。

### AC3 — 双向负控制（实跑输出）

```
=== 方向 1 (GO 基线, 当前 avg10=3.83) ===
cpu_stall(some avg10)=3.91  [limit 40]   ok
mem_avail=5592MB             [limit 2048] ok
=> GO: 资源充足，可以跑            gate exit=0

=== 起 6 个 busy loop 把 CPU 压过阈值 ===
=== 方向 2 (busy loop 下) ===
cpu_stall(some avg10)=55.61  [limit 40]   WAIT
=> WAIT: CPU 饥饿（some avg10 >= 40）。重型测试在此负载下会超时   gate exit=1

=== 停掉 busy loop ===
=== 方向 3 (停掉后) ===
cpu_stall(some avg10)=16.65  [limit 40]   ok
=> GO: 资源充足，可以跑            gate exit=0
```

三个方向全部实跑：GO(3.91) → WAIT(55.61) → GO(16.65)。busy loop 退出码与输出逐字在上。gate 的
单元测试（`plugin/test/resource-gate.test.mjs`）用 env seam 确定性复测同一判定逻辑（低 cpu→GO、
高 cpu→WAIT）。

### AC4 — 进程计数形态

gate 用 `pgrep -xc node-MainThread`（`-x` 精确匹配 comm，`-c` 计数）。`pgrep -f` 会匹配任何命令行
含 "node" 的进程（包括调用方自己）；`grep -x node` 因 Node 的 comm 是 `node-MainThread` 永远返回
0。单元测试 AC4 断言代码路径没有这两种写法（注释里提它们只是警告）。

### AC5 — 实测放大系数与推导

- **全量套件实测**（任务体已记录，2026-08-03）：concurrency 8 时峰值 `pgrep -xc node-MainThread`
  = 17（1 root + 8 worker + 8 子进程）⇒ 比值 **17/8 = 2.125 ≈ 2.1**
- **本次 scoped 复测**（worktree，concurrency 2，4 个子进程重型 plugin 测试文件：
  run-identity / restart-readiness-check / prepare-admission-check / task-contract-check）：
  baseline=17 → 峰值 23，delta=6 ⇒ **3.0/worker**（子进程重型文件的上界）
- **推导**：`default = max(1, floor(nproc / AMPLIFICATION))`，AMPLIFICATION 取全量套件实测 2.1。
  本机 nproc=4 ⇒ `floor(4/2.1) = 1` ⇒ 默认并发 1（~3 进程，低于 4 核）。`--test-concurrency=N`
  显式传入永远优先（node last-flag-wins）。
- 单元测试 AC5 用 env seam（RESOURCE_GATE_NPROC / RESOURCE_GATE_AMPLIFICATION）跑真实
  `default_test_concurrency()`：4/2.1→1、16/2.1→7、4/1→4、1/2.1→1、8/2.1→3。
- **CI 的推导后果**：`.github/workflows/ci.yml` 的测试步骤是 `bash scripts/test.sh`（10 分钟预算）。
  推导默认在本机（4 核）= 1，在 GitHub 4-vCPU runner 上也是 1——全量会超出 10 分钟预算。
  因此 CI 步骤改为显式 `--test-concurrency=8`（任务保留的逃生口「显式传入永远优先」）；gate 仍
  在 CI 的默认全量路径生效（新 runner 的 `/proc/pressure/cpu` ≈ 0，通常直接 GO）。

### AC5b — 选中文件数前后一致（test.sh 改动不改变基线）

```
# 在加入 AC11 新测试文件之前测量的对照（test.sh 的改动本身）：
scripts/test.sh --list-files | wc -l   # 改前（master 检出）与改后（本 worktree）均为 172
diff <(master --list-files) <(本 worktree --list-files)   # 仅 realpath 前缀不同；相对路径集合逐字节一致
```

test.sh 的 glob/dedup 逻辑未动；`--list-files` 的 realpath-dedup 行为未动，
`test-coverage-check.ts` 的 AC5 契约（canonical 集合 == `--list-files`，realpath-dedup）selftest 通过。
**加入本任务的 AC11 测试文件后，当前 glob 为 173 = 172 + 1（`plugin/test/resource-gate.test.mjs` 本身）**——
那个 +1 是本任务新增的测试，不是 test.sh 改动造成的基线漂移。

### AC6 — 内存护栏（实测）

```
RESOURCE_GATE_TEST_MEM_AVAIL_MB=1000 scripts/resource-gate.sh --for full-suite
mem_avail=1000MB             [limit 2048] WAIT
=> WAIT: 内存不足（mem_avail < 2048MB，swap 有限）。OOM 时最先被杀的仍是 RSS 最大的 claude 会话
== RSS top-5 (AC6: OOM killer 的目标 — claude 会话 RSS 424-793MB) ==
    PID    PPID   RSS COMMAND
 270244 1997955 871492 claude
 120373 3036446 761080 claude
```

RSS 前二正是 claude 会话（871MB/761MB）——印证「OOM 真发生时被杀的是内外层会话本身」。
（本机当前 swap=8191MB，故 verdict 走「swap 有限」分支；swap=0 的机器走「OOM 是悬崖」分支——两者
都由 gate 按实测 swap 值输出。）

### AC7 — test.sh 接入（实测 fail-closed 与 scoped 放行）

```
# 全量路径 + 模拟 WAIT（RESOURCE_GATE_TEST_CPU_AVG10=99）：gate 先触发，打印数字后退出非 0，不静默等待
== resource gate ==
cpu_stall(some avg10)=99.00  [limit 40]   WAIT
=> WAIT: CPU 饥饿 ...
scripts/test.sh: resource gate says WAIT — not running the full suite   exit=1

# scoped 路径 + 同样模拟 WAIT：gate 被跳过（全量专用），验证路径在负载下仍可用
scripts/test.sh plugin/test/resource-gate.test.mjs   # 12/12 pass, exit=0
```

gate 只守默认全量集合（`is_default_set "product,engine"`）；`--group <子集>`、显式文件、`--for-task`
均跳过。嵌套 runner 用 `QUAY_TEST_SKIP_RESOURCE_GATE=1` 逃生（与 QUAY_TEST_SKIP_DIST_BUILD 同形态）。

### AC8 — 两个 tick 文件已改

- `orchestration/orchestrator-loop-tick.md` 步骤 0c：散文规则改为「跑全量前调用
  `bash scripts/resource-gate.sh --for full-suite`，非 0=WAIT 不跑」
- `docs/analysis/fast-mode-loop-tick.md`：同样改为调用 gate；并更新「默认 --test-concurrency=8
  （设计性 2 倍超订）」为「默认并发已改为推导值 = 1」

**交叉标注（AC3，`gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red`）**：本任务
的 `--test-concurrency` 是 **node:test/test.sh 项目的旋钮**；同一份机制文档服务 vitest 项目时
分叉已写清——vitest 真实文件级并行 flag 是 `--maxWorkers`（archguard 用 `--maxWorkers=8` 跑通
全量 4902 passed），两个 tick 文件与 full-suite-runner 用法均不再对 vitest 项目指导
`--test-concurrency`。判红模式也不再匹配裸 `✖`（vitest 假红负控制实证）。

### AC9 — 记录已补

`tasks/gap-suite-cost-model-is-wrong-optimizations-buy-nothing.md` 的 Execution record 后新增
Addendum（2026-08-03）：同一提交两次结果不同可能是 CPU 饥饿而非测试缺陷；run-to-run 噪声
（17–63s 极差）里有一部分就是未分解的争用。本任务 Measured 段本身也是这条记录。

### AC10 — 孤儿进程（实测）

gate 实跑输出单列两行（不影响 GO/WAIT）：
```
orphan_node: pid=3783799 ppid=1 cwd=/tmp/quay-wt-m264 (deleted)
orphan_node: pid=3818492 ppid=1 cwd=/tmp/quay-wt-m264 (deleted)
```

### DoD — 两层互为负载源

gate 的作用不是让测试更快，是让「现在能不能跑」成为一个可核对的数字。内层此刻在「等 load 降」、
外层同时在跑核实命令——两层都在目测且互为负载源。现在 `scripts/test.sh` 与两个 tick 文件都调用
同一个 gate：同一套 `/proc/pressure/cpu` 读数、同一个 `pgrep -xc node-MainThread`、同一个
`free -m` available。WAIT 的「原因」是打印出来的数字，不是各自脑中的印象。

## Touches
- tasks/gap-no-resource-awareness-heavy-ops-run-blind.md（自身文件：勾 AC + 贴 invoke 证据授权）

- scripts/resource-gate.sh（新增，本任务核心产出）
- scripts/test.sh
- plugin/test/resource-gate.test.mjs（新增，AC11）
- orchestration/orchestrator-loop-tick.md
- docs/analysis/fast-mode-loop-tick.md
- plugin/test/select-tests-for-touches.test.mjs（AC5 改了 exec 行，结构性断言同步更新）
- plugin/test/runner-grouping.test.mjs（同上）
- tasks/gap-suite-cost-model-is-wrong-optimizations-buy-nothing.md（AC9 记录）
- .github/workflows/ci.yml（AC5 推导默认并发后，CI 的 10 分钟预算需要显式 `--test-concurrency=8`，
  否则推导值 1 会把全量推到预算外——显式覆盖正是本任务保留的逃生口）
- CLAUDE.md（测试条目里的「默认 --test-concurrency=8」改为「推导并发 + 资源闸」，防漂移）

## Dispatch review

reviewer: outer
at: 2026-08-03T03:19:46Z
changed: 初稿写「4 核跑 8 = 2× 超订」，外层实测在跑套件的真实进程数后改为 **17 个进程、4.25×**；
  据此改掉机制设计（`--test-concurrency` 不是正确旋钮）与 AC5（先实测放大系数，不许照 `nproc*2` 推导）；
  并加 AC10（gate 输出单列 ppid=1 且 cwd 已删除的孤儿进程）

## Re-open 2026-08-05T07:30Z — 修复未接线生产调用方（外层，资源安全，最高优先）

**触发**：管理者 07:24Z 高优先级资源安全告警 + 外层实测坐实。**机器今晚已崩三次，负载是从未被排除的
候选根因。**

**证据链（外层逐条核实）**：
1. `nproc = 4`。
2. `scripts/test.sh` 第 82-83 行派生默认（本任务 AC5 产出）：`max(1, floor(nproc / 2.1))` ⇒ 本机应为 **1**。
3. 但当前全量套件进程实参是 `--test-concurrency=8`（ps 实证，约 200 个测试文件）。
4. **根因**：`plugin/scripts/full-suite-runner.ts` 第 94 行
   `const laneCount = Number(parseArg(argv, '--lane-count') ?? '8')`，第 32 行注释 `default: 8
   (canonical full-suite concurrency)`——**硬编码 8，不读 nproc**。CLAUDE.md 明写「显式
   --test-concurrency=N 永远覆盖派生默认」，test.sh 的资源感知对这条路径**完全失效**。
5. **resource-gate 也未接线**：`grep -n 'resource-gate' plugin/scripts/full-suite-runner.ts` = NOT
   REFERENCED——外层后台 runner 起跑前没有过闸。
6. 当前 load average **30.91**（4 核 ⇒ 7.7× 超订），`/proc/pressure/cpu` some avg10=95.49，claude
   进程 34 个。

**后果（为什么比其它缺口都急）**：本任务 AC5 的原始论据是「硬编码 8 在 4 核上 4.25× 超订、8 workers +
派生子进程 = 17 个进程」。修复只改了 test.sh 默认，**没改真正在生产里跑全套件的调用方
（full-suite-runner）**——所以本任务的收益是 **0**，超订反而更严重（7.7×）。后果不是慢，是**整机
崩溃**。属于「修复 landed 但生产路径未接线」族。

**外层已止血**：07:26Z 中止当前套件（state→red + note），load 从 31.74 回落。**修复归内层**。

### 新增 Acceptance Criteria（re-open）

- [ ] AC12: **full-suite-runner laneCount 派生统一**——`plugin/scripts/full-suite-runner.ts` 的
      laneCount 默认改为与 test.sh 同一派生（读 nproc，`max(1, floor(nproc / 2.1))`，不硬编码 8），
      或干脆不传 `--lane-count` 让 test.sh 自己派生；显式 `--lane-count=N` 保留为覆盖手段。
      本机 ⇒ 1。
- [ ] AC13: **full-suite-runner 启动前过资源闸**——runner 起跑前调用
      `scripts/resource-gate.sh --for full-suite`，WAIT 时打印数字退出非 0（与本任务 AC7 对 test.sh
      的接入同一纪律）；当前路径 NOT REFERENCED。
- [ ] AC14: **回归控制**——修复后全量套件进程实参必须不再出现 `--test-concurrency=8` 而按派生 1 跑
      （ps 实证贴任务体）；显式 `--lane-count=8` 仍能覆盖（逃生口保留）。
- [ ] AC15: 测试用 `node:test` 且带 `// @test-group engine`（沿用本任务 AC11 声明）。
- [ ] AC17: **`--test-concurrency=*` 替换非追加**（管理者 09:03Z 隐患）——runner 拼接前**剥掉命令里
      已有 `--test-concurrency=*` 再拼**（或设环境变量让 test.sh 自己派生），让它是替换不是追加。
      当前实跑命令行同时出现 `--test-concurrency=8 --test-concurrency=1`（node 取最后一个生效 1，
      行为正确），但**生效值依赖拼接顺序**——重构调换次序就静默回到 8，无判据会发现（两个值都合法，
      退化只表现为负载升高 → 一路到 PSI 94 + 整机崩溃）。node 取值规则实测：`=8 =1` 同时给 8.72s（=1
      生效）、`=1 =8` 同时给 2.62s（=8 生效）——**取最后一个**。
- [ ] AC16: **显式传参必须传播到 test.sh**——`full-suite-runner.ts` 的 `--lane-count N` 必须真正拼进
      传给 test.sh 的 command（转成 `--test-concurrency=N` 或 `--lane-count N` 传递），**不能只写
      state 字段**；ps 实证 `--test-concurrency=<传值>` 生效（ABORT #2 根因：runner.ts:91 command 静态、
      lane-count 从不到达 test.sh，显式 1 实际跑 8）。

### ABORT #2（2026-08-05 07:48Z）——显式传参也不生效（比硬编码更危险）

**触发**：管理者紧急告警 + 外层核实——外层 07:42 传 `--lane-count 1` 重跑 M3 验证套件，但 ps 实证
**实际跑的是 `--test-concurrency=8`**（9 个并发 8 进程，load 26.92/PSI 94，07:26 ABORT 状态复现）。

**根因定位（问题②，比硬编码更严重）**：`full-suite-runner.ts:91`
`const command = parseArg(argv, "--command") ?? "bash scripts/test.sh"`——`--lane-count` **只写进 state
文件的 laneCount 字段**（第 94/97 行），**从没拼进传给 test.sh 的 command**（第 102 行 spawn 只传
静态 command）。test.sh 收不到任何并发覆盖，走自己默认 8。⇒ **`--lane-count 1` 完全没到达 test.sh**，
它只影响 state 字段不影响实际并发。**「对并发的控制失效，且你以为它生效了」**——这比硬编码 8 更危险，
因为它在错误安全感下重启了一轮。

**外层决定：ABORT #2**（07:48Z）——PSI 94 = 07:26 复现状态，机器今晚已崩三次，8 并发下 M3 验证套件
必然负载敏感假红 + 有崩溃风险。state=red + reason=aborted 已标记。

**连带（管理者自曝，归因完整）**：跨项目 .halt 暂停有帮助但不是修复——做决定时还不知 quay 自己套件
跑在 8，真正主因在 quay 这边。真修复是 laneCount 链路，且现在多了「显式传参也不生效」这一条。

### Re-open Touches 增补

- plugin/scripts/full-suite-runner.ts（AC12/AC13：laneCount 派生 + 过闸）
- plugin/test/full-suite-runner.test.mjs（AC12/AC14 fixture）
- plugin/scripts/（resource-gate 接线验证，若 runner 调用路径需包装）

### Re-open Contract

measure   runner_lane_count = `grep -n "lane-count" plugin/scripts/full-suite-runner.ts` stdout 的默认值段
band      runner_lane_count = 派生（max(1, floor(nproc/2.1))，本机 1）或取消默认让 test.sh 派生
invariant no_hardcoded_oversubscription = 1（生产 runner 与 test.sh 同源派生，不硬编码 8）
invoke    `ps -eo args | grep -c -- '--test-concurrency=8'`
control   本机跑全量 ⇒ 进程实参不得再出现 concurrency=8（AC14）；显式 --lane-count=1 ⇒ 实跑 concurrency=1（AC16 负向——ABORT #2 根因必须消失）
resume    laneCount 派生与过闸分两步提交，任一步完成即写盘

reviewer: outer (re-open)
at: 2026-08-05T07:30Z
changed: done→ready——原 AC5 只改 test.sh，未接线的生产调用方 full-suite-runner 仍硬编码 8（7.7×
  超订、本机已崩三次、resource-gate NOT REFERENCED）。AC12/AC13/AC14/AC15 新增。外层已中止套件止血。
  AC10 记账：post-friction（被管理者资源告警撞出），不计分。

## Addendum 2026-08-06 — 回退记录 + 恢复（gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived）

**回退记录（本任务 AC5 要求的追溯）**：`scripts/test.sh` 的默认并发推导在
**623d662b**（2026-08-03 07:29，"fix(test.sh): TEMPORARILY pin default concurrency back to 8
(outer urgent correction)"）被**临时回退**为硬编码 8——推导默认 1 把全量墙钟从 ~8min 推到
~55min（stranded 的 OVER90 直接因此），AC5 的 cost-side tradeoff 实验未跑，注释明写
「REVERT this override to the derived formula once AC5's tradeoff experiment is run」。回退后：
- `default_test_concurrency()` 变成 `echo "8"; return 0; default_concurrency_formula`——
  **公式在 return 之后，不可达**；
- 但 CLAUDE.md、两个 tick 文档、本任务 AC5 的勾、resource-gate.test.mjs（正则抽取不可达公式）
  与 runner-grouping.test.mjs（只断言拼写、消息却称 "derived"）**三层全部仍报告「已推导」**；
- 实测本机 nproc=4 ⇒ 声称值 `floor(4/2.1)=1` vs 实际 8 = **恰好 4.25× 超订**——CLAUDE.md 自己
  描述为「已消除」的那个缺陷仍在生效。

**恢复（2026-08-06，由 `gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived` 执行）**：
走「让现实追上声称」方向——推导就是 AC5 的交付物，回退是没等到实验的临时覆盖，且 cost 侧已被
ci.yml 显式 `--test-concurrency=N`（10 分钟预算逃生口）与 full-suite-runner.ts 的 nproc 派生
laneCount 覆盖。`default_test_concurrency()` 恢复为直接调用 `default_concurrency_formula`
（公式可达，`formula_reachable = 1`），doc/AC/测试三层回归一致。

**AC5 勾选状态**：保持 `[x]`——推导已恢复且真实生效（本机实测 `default_test_concurrency`
返回值 = `floor(4/2.1)` = 1，与 CLAUDE.md/文档一致）。回退期间（623d662b → 恢复）该勾是
「勾在一个被回退的机制上」——**本任务是这一形态的首个实例**（DoD 记录）。

**交叉标注**：本任务 ↔ `gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived`
（回退与恢复的完整记录；新增 `dead-code-after-return-check` 静态检查禁止该形态复发）。

**交叉标注（AC5，`gap-systemd-run-limits-for-suite-and-heavy-ops`，2026-08-08）**：本任务把资源感知
做成「必须被主动调用才生效」的 gate（AC7/AC13）——而 ABORT #5 实证它被绕过（full-suite-runner 0 次
调用）。`gap-systemd-run-limits-for-suite-and-heavy-ops` 是**同源的 cgroup 硬限额上位解**：套件 runner
起跑时包 `systemd-run --user --scope`（MemoryMax/CPUQuota/TasksMax），限额由内核强制、无法被「忘记
调用」，且只作用于该套件的进程组——PID 爆（tmux 泄漏类）被 TasksMax 挡、内存爆（ugrep 类）被
MemoryMax 杀单进程不进全机 swap（AC2/AC3 负控制实测）。两者同源于
`orchestration/SPEC-isolation-and-resource-governance-2026-08-05.md`：gate 补「调用纪律」、
cgroup 限额补「不可被绕过」。

## Touches 增补（Addendum 2026-08-06）
- tasks/gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived.md（新增，恢复与防复发）
