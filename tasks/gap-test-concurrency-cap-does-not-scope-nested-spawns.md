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


## 合并说明（2026-08-07 02:1xZ，管理者裁定：这是一个缺陷的三个面，不是三个缺陷）

**共同根因：没有跨层的总资源预算。** 三处各自"局部正确"，而它们相乘作用在同一个 4 核 CPU 上：

| 面 | 机制 | 局部假设 | 当前值 |
|---|---|---|---|
| **A（本任务）** | 跨 worktree 无协调 | 每次 `scripts/test.sh` 假定**自己独占机器** | 实测 2–3 个 worktree 同时跑 |
| **B** | `cap-from-gate.ts` 槽位帽 | 假定**每槽位开销有界且已知** | 压力低时 `cap=5` |
| **C** | `scripts/test.sh` worker 数 | 只读 `nproc`，**完全不读负载** | 4 核 ⇒ **1** |

**两个假设互相否定**：A/C 要求独占，B 一次给出 5 份。

### 实测证据：用它自己的判据检验，矛盾已经显形

`CLAUDE.md:23` 判定**不可接受**的旧状态是「8 workers + spawned subprocesses = **17 processes**，
4 核 4.25 倍超订」。而**新配置下实测**（2026-08-06/07 管理者多轮记录）：

- `node --test` 进程峰值 **19 个**、`load1` 峰值 **18.70**、`cpu some avg10` 峰值 **94.47**
- 某一瞬时全部 node 进程 **17 个**——**正好等于那个被判定为不可接受的数字**

⇒ **为避免 17 个进程而做的修改，实际运行在 17–19 个进程上。慢换来了，超订没换来。**

### 面 B 的补充实测（原未立案，本次并入）

`cap-from-gate` 设计上动态（`avg300<40→cap=5` / `<70→2` / `≥70→1`，滞后 2 次同向确认），
**但实测状态僵死**：`.quay/concurrency-cap-state.json` 停在
`{"band":"GO","consecutive":0,"decided_at":"2026-08-06T22:16:39Z"}`，**223 分钟未重新决策**，
而同期 `avg300` 实测序列 `41.67→28.84→49.60→33.84→52.30→32.34` **至少 5 次穿越 40 边界**。

**原因是滞后设计遇上振荡输入的必然结果**：切档要求**连续 2 次同向**，而 WAIT/GO 交替出现，
`consecutive` 每次被打回 0 ⇒ **这个"自适应"上限在整个观察期等价于固定值 5**。
（非 bug，是设计取舍的后果；但意味着**这条反馈不能替代总预算**。）

### 为什么必须合并而不是分开修

**分开修的后果可以预见**：每处都会被"局部正确"地修好，
而 `5 槽位 × 各自派生` = 17–19 进程这个**总量一点不变**。
⇒ 修复必须落在**跨层总预算**上，不在任何单层。

### 与既有任务的关系

- `gap-concurrency-derivation-reverted-but-doc-ac-and-tests-all-still-report-derived`（`ready`）
  是**面 C 的历史成因**（公式长期不可达、`echo 8; return 0`），**不作废**——它管"代码是否做它声称的事"，
  与本任务的"总预算"是不同问题，但结论互相依赖：**面 C 修好之后才暴露出总预算缺失**。
- `gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible`（新立）
  是**本矛盾的下游后果**：并发降到 1 使单次套件 37.5 分钟，进而使 DoD 吃掉 OVER90 预算 83%。
