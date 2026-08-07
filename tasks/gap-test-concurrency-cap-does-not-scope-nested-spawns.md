---
id: gap-test-concurrency-cap-does-not-scope-nested-spawns
title: --test-concurrency cap only constrains top-level workers —
  quay-init/session tests spawn nested node --test (15 of 19), bypassing the cap
  → 2.5x oversubscription on 4 cores
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
## Finding

并发上限的作用域**不含嵌套派生**：`scripts/test.sh` 的 `--test-concurrency` 只约束**顶层 worker 数**，而 quay-init 族 / 会话族测试（`quay-init-check-drift` / `quay-init-drift-report` / `quay-init-laydown-closure` / `session-liveness` / `session-topology` / `runtime-usage-inventory`）内部再 spawn `node --test`——**嵌套派生绕过上限**。

## 实测（2026-08-06 21:16Z，套件 running 中）

管理者同一轮内三次读数（外层复核 load 一致）：

| 项 | 值 |
|---|---|
| nproc | **4** |
| load1 | 6.14 → 7.99 → **10.05**（持续上升） |
| cpu some avg10 | 80.48 → 84.31 → 83.41 |
| `node --test` 进程 | **19** |
| 其中父进程也是 `node --test` | **15**（嵌套派生） |

即顶层 `--test-concurrency=1`（1 个 worker），实际并发达 **19 进程 = 4 核上 2.5× 超订**。外层复核（21:1x）：load 9.89，嵌套间歇出现（压力随 quay-init/session 族测试进入而升）。

## 为什么值得修

CLAUDE.md 记载并发推导 `max(1, floor(nproc/2.1))` 正是为避免超订（"硬编码 8 在 4 核 = 4.25× 超订——8 workers + spawned subprocesses = 17 进程"）。本轮实测说明：**推导只约束顶层，嵌套派生绕过它**——那条推导修好的是一半问题。且这正是 `gap-no-resource-awareness-heavy-ops-run-blind` AC5（并发推导）与 `gap-tests-leak-tmux-servers-...`（泄漏）**都不覆盖**的形状。

## 性质（改写，2026-08-07；原「嵌套测试合法派生」归因已撤回）

既不是"推导写错了"（单次调用内部的推导是对的），也不是"进程泄漏"或"测试嵌套递归"——
是**并发推导的作用域止于单次 `scripts/test.sh` 调用，不含跨 worktree 协调**。
`node:test` 自身的每文件隔离子进程是正常架构，不是本缺口的成因。

## 修复方向（改写，接法留执行时）

1. 给跨 worktree 的重活加**共享令牌/预算**（`resource-gate.sh` 已有单次运行负载门控，
   缺的是跨调用协调——本仓 08-06 才整删了 `heavy-op-token.sh`，方向需要与那次裁定的
   理由对齐，不是简单复活）；
2. 或 `quay-init` 派生的 worktree 测试在派发前查询"当前有几个 worktree 在跑套件"，
   动态降低自己的 `--test-concurrency`；
3. **不采用**原方向 3（"嵌套测试改 import"）——追查证明这里没有真嵌套，那个方向对错误
   的机制无的放矢。

## AC（draft，改写）

- [ ] 两个 worktree 同时跑全量套件时，总进程数/load 有可观测的协调信号（不是各自盲跑）
- [ ] 负控制：单 worktree 跑套件 ⇒ 行为不变（不因协调机制引入单跑场景的回归）
- [ ] 与 `gap-no-resource-awareness-heavy-ops-run-blind` AC5 交叉标注

## DoD（draft，改写）

- [ ] 2 个 worktree 并发跑全量套件时，`cpu some avg10` 峰值有实测降低（相对本任务记录的基线 61.28/83.41）
- [ ] 完整套件绿

## Evidence

- 21:16Z 三次读数：load1 6.14→7.99→10.05；cpu avg10 80.48→84.31→83.41；19 `node --test`、15 嵌套
- 嵌套目标：quay-init 族（check-drift/drift-report/laydown-closure）+ 会话族（session-liveness/session-topology/runtime-usage-inventory）
- 外层复核（21:1x）：load 9.89，嵌套间歇

## 更正（2026-08-07 00:5xZ，管理者追查父子进程链后自我更正）

**「性质」一节的机制归因是错的，已被逐层追查推翻——不是嵌套测试递归吃自己。**

实测的数字（19 进程、15 个父也是 `node --test`）仍然真实，**但下面这句话不成立**：
「quay-init/session 族测试 spawn 嵌套 `node --test`，绕过并发上限」。逐层追查（追到进程退出、
读了脚本源码，不是猜）：

1. **命令行上那些 `--test-coverage-functions=0`/`--experimental-addon-modules`/
   `--inspect-publish-uid` 等标志是 Node 自己加的**，不是被测脚本传的。这是
   `node:test` **固有架构**——即使 `--test-concurrency=1`，Node 也会为每个测试文件
   派生一个隔离子进程。**这本来就在发生，不是缺陷，也不是"绕过"**。
2. 唯一一条真被 ps 抓到的疑似嵌套链——某测试子进程 fork 出
   `bash quay-init.sh --worktree-root ...`——追查后是无害的：`quay-init.sh` 的
   `detect_test_command` **只 `echo` 探测到的命令给人确认，代码里没有 `eval`/执行**；
   该进程 5 秒后退出，**退出时没有任何子进程**。它是一次真实但短暂的 e2e 调用，
   没有引爆一次全量套件。

**真正在推高进程数的**：实测同一时刻**有 2 个不同 worktree**（`quay-worktrees/manager-layer`、
`quay-worktrees/observer-registry`）**在同时各自跑 `scripts/test.sh`**。每个都按
`max(1, floor(nproc/2.1))` 算出自己"合法"的并发，**但这个推导只管一次调用内部，
不知道另一个 worktree 同时也在跑** ⇒ 4 核机器上两个独立正确的并发套件叠加，
足以把 load 推到 10——**不需要任何一方越界**。

**⇒ 缺口的真实形状是「并发推导的作用域是单次调用，不含跨 worktree 协调」，
不是「测试递归吃自己」。下面「性质」「修复方向」「AC/DoD」三节据此改写，原测量数据保留。**
