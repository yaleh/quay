---
id: gap-no-resource-awareness-heavy-ops-run-blind
title: "Heavy operations run blind to CPU/memory — the box is 2x oversubscribed
  by design and swap is 0, so OOM is a cliff"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

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
| `scripts/test.sh` 默认并发 | **8（常量）** | **4 核上设计性 2× 超订** |
| `MemAvailable` | 5.0 GB / 16 GB | 单个 `node --test` RSS 106–255 MB |
| 4 个 `claude` 进程 | 合计 ~2.4 GB | **OOM 真发生时被杀的就是内外层会话本身** |

### 两个独立的结论

**1. 超时的根因是 CPU 饥饿，且这是设计出来的。** `--test-concurrency=8` 是写死的常量，
而这台机器 `nproc=4`。两层同时跑全量套件 ⇒ 16 个 node 进程抢 4 个核。
ADR-019 当初测得 8 比运行时默认快 10.3%，但那是**在没有第二层并发跑的前提下**测的。

**2. OOM 是悬崖不是斜坡。** `swap=0` 意味着没有渐进降级：`MemAvailable` 掉到阈值以下时
OOM killer 直接动手，**而 RSS 最大的进程正是 `claude` 本身**（793/681/518/424 MB）。
后果不是测试失败，是**内层或外层会话被杀**——一个连自己被杀了都无法记录的失败。

### 为什么这是机制问题而不是调参

内层此刻在「等 load 降」，外层同时在跑核实命令——**两层都在用目测判断资源，且互为负载源**。
`orchestrator-loop-tick.md` 步骤 0c 已经写了「外层核实会和内层抢 CPU」，但它是**一条散文规则**，
没有任何东西执行它。今晚重型测试超时至少 3 次，每次都靠人或外层事后诊断。

**这还解释了 AC1 的不可重现**：同一提交 run1 零失败、run2 一个失败。
若失败源是 CPU 饥饿而非测试缺陷，那么「连跑 2 次全绿」在一台 2× 超订的机器上
**本来就不是一个关于代码的判据**。这条要写进 AC1 的解释里。

## Contract

```
measure   cpu_stall   = `cat /proc/pressure/cpu` 的 some avg10 字段      # 直接测「有任务在等 CPU」
measure   mem_avail   = `free -m` 的 available 列（MB）                  # 非 free 列
measure   heavy_procs = `pgrep -xc node` 的计数                          # comm 精确匹配，非 pgrep -f
band      cpu_ok      = some avg10 < 40                                  # 实测：84.77 时重型测试超时
invariant nproc 在判定前后一致                                            # 判据必须相对核数，不是绝对数
invoke    `scripts/resource-gate.sh --for full-suite`                    # 退出码 0=GO 非 0=WAIT
control   人为把 cpu some avg10 压高（起 N 个 busy loop）⇒ gate 必须返回 WAIT
resume    n/a: gate 是无状态判定，无中途产物
```

## Chosen mechanism

**一个两层共用的资源闸，把「目测 load」换成「读 PSI 的结构信号」。**

### 一、`scripts/resource-gate.sh`

读 `/proc/pressure/cpu`、`/proc/pressure/memory`、`MemAvailable`、`nproc`、`pgrep -xc node`，
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

默认改为 `min(8, nproc*2)`（当前机器 ⇒ 8，**与现状一致，不改变已测基线**），
但当 gate 报 CPU 饥饿时降为 `max(1, nproc/2)`。
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

- [ ] AC1: `scripts/resource-gate.sh` 实现，输出**数字与限值**（不只 GO/WAIT），退出码 0/非 0
- [ ] AC2: 判据用 `/proc/pressure/cpu` 的 `some avg10`，**不用 load average**；
      任务体记录为什么（PSI 是结构信号，load 是代理）
- [ ] AC3: **负控制**——人为起 N 个 busy loop 把 `some avg10` 压过阈值，gate 必须返回 WAIT；
      停掉后必须返回 GO。两个方向都要有实跑输出
- [ ] AC4: `pgrep -xc node`（或 `comm` 精确匹配）计数，**不得用 `pgrep -f`**——
      后者会匹配任何命令行含 "node" 的进程，包括调用方自己（本仓库已踩两次）
- [ ] AC5: `--test-concurrency` 默认改为从 `nproc` 推导；当前机器上推导值 = 8，
      **实跑证明与改前选中文件数、并发数完全一致**（不改变已测基线）
- [ ] AC6: `mem_avail < 2048MB` 时拒绝启动全量套件，并打印 RSS 前 5 进程
- [ ] AC7: `scripts/test.sh` 接入；WAIT 时打印数字后退出非 0，**不静默等待**
- [ ] AC8: 两个 tick 文件（外层 `orchestrator-loop-tick.md` 步骤 0c、内层
      `fast-mode-loop-tick.md`）里的散文规则改为调用 gate
- [ ] AC9: 在 `gap-suite-cost-model-is-wrong-optimizations-buy-nothing` 与 AC1 的记录里补一条：
      **同一提交两次结果不同，可能是 CPU 饥饿而非测试缺陷**——「连跑 2 次全绿」在 2× 超订的机器上
      不是一个关于代码的判据
- [ ] AC10: 测试带 `// @test-group engine` 声明

## Definition of Done

- [ ] AC3 的双向负控制实跑输出贴进任务体
- [ ] AC5 的「推导值 = 8、基线未变」实跑对照贴进任务体
- [ ] `scripts/test.sh` 连跑 2 次全绿（**在 gate 报 GO 的窗口里跑**——这本身就是本任务的用法演示）
- [ ] 明确记录：**两层互为负载源，而两层都在目测**。gate 的作用不是让测试更快，
      是让「现在能不能跑」成为一个可核对的数字，而不是各自的印象

## Touches

- scripts/resource-gate.sh
- scripts/test.sh
- plugin/test/resource-gate.test.mjs
- orchestration/orchestrator-loop-tick.md
- docs/analysis/fast-mode-loop-tick.md
