---
id: gap-anchor-polling-git-fork-storm
title: driver-anchor 轮询脚本每轮几百次 git：全机 3,190 git/s、process-budget 16 次/秒
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**实测（2026-11-06，10 秒 bpftrace execve trace，宿主 128 vCPU / 246 GB，共享机）**：窗口内记录 **46,489 次 exec**，其中 uid 1004 独占 **44,908**，而 **31,918 次是 `git`**（≈ **3,190 git/s**）。父进程归属：

| 父进程 | git exec 速率 | 窗口内读数 |
|---|---|---|
| `ready-pool-check.ts` | ≈207 git/s | 两次调用 9 秒内 960 + 900 exec |
| `task-status-drift-check.js` | ≈96 git/s | 867 / 9s |
| quay-fleet 及其它 anchor | 其余 | — |

**30 秒内全机 spawn 的机件**：`process-budget.sh` 489 次（**16/s**）、`resource-gate.sh` 211 次（7/s）、`ready-pool-check` 83 次、`closure-lag-check` 53 次、`slot-refill` 30 次。每一个都要走 `/proc`（本机 **34,000 个线程**）和/或 shell 出去跑 git。

**规模**：全机 **25 个 driver anchor**，跨 **8 个用户 / 21 个项目根**。同一 root 上观察到两个 anchor。

> 判读：这条与 `gap-direct-to-develop-bypass-check-per-commit-git-subprocess-cost`（done）同族但**不同载体** —— 那条修的是**单个 checker 内部**的逐 commit git 调用；本条是**每 tick 每任务**的 git 派生（cache-less 重算），以及 anchor 的 **tick 频率/重复度**。10 秒内 31,918 次 git 是跨进程量的读数，任何单文件优化都解释不了它。

### Proposed fix

- (a) 对每个任务的 git 派生事实（指纹 / 状态）按**便宜的失效键**（repo HEAD / mtime）缓存，而不是每任务每 tick 重跑 git；
- (b) 降 tick 频率，或在上次 tick 没有任何变化时**退避**；
- (c) 保证每个 root 只有一个 anchor（已观察到同一 root 有两个）。

### Dedup / merge 决定

按机制去重：`task-status-drift-check` / `anchor` / `fork` / `execve` 在 todo/ready 池内命中均为 **0**（`execve` 的既有任务是 `gap-cli-import-refactor-run-shell-architecture`（done，测试内 execve 次数）与 `gap-quay-init-install-wall-clock-slow`（done，安装期 fork），**机制不同、载体不同**）。merge-candidate：无 open 任务声明 `ready-pool-check.ts` / `driver-anchor.ts` 为 Touches ⇒ **独立立案**（与 `gap-routine-semantic-dedup-scan-readtasks-duplicate` 同声明一个文件但那是语义去重、readTasks 抽取，机制无关）。

## AC

- [ ] 计数夹具（⛔ 不是墙钟推断）：一次 `ready-pool-check` 调用产生的 git 子进程数**有上界且不随任务数线性增长** —— 在 N=10 与 N=100 的合成 workspace 上各跑一次，两次计数的**比值 < 2**，两个数都贴进任务体。
- [ ] 缓存命中：同一 workspace 连续两次 tick、状态不变 ⇒ 第二次 tick 的 git exec 计数 = **0**（或只允许 O(1) 条 HEAD/mtime 探测，逐条枚举打印）。
- [ ] 失效正确性（能取假、双向）：第二次 tick 之前改一个任务文件的指纹/状态 ⇒ 缓存必须失效，第二次 tick 的 git exec > 0 **且该任务的读数正确**；不改任何东西 ⇒ 仍是 0。两个方向都要实跑。
- [ ] 同一 root 的重复 anchor 被**拒绝或具名上报**：构造两个 anchor 指向同一 root ⇒ 第二个要么拒绝启动，要么在读数里具名报告该冲突（⛔ 静默共存，这是硬规则 3b）。
- [ ] 退避可核：连续 K=3 次无变化的 tick 之后，下一 tick 的 exec 计数/墙钟较第一个 tick 下降（贴 K=1 与 K=4 两个读数）。
- [ ] `bash scripts/test.sh --for-task gap-anchor-polling-git-fork-storm --allow-thin` exit 0。
- [ ] 全量 `bash scripts/test.sh` 绿（由 driver 机械 fan-in 验证）（待外部）。

## DoD

在真实宿主上用**同口径**复采一次 bpftrace execve trace（同一个 10 秒窗口、同一谓词），`git` exec 总量较基线 31,918/10s 显著下降，且归属表里 `ready-pool-check.ts` 与 `task-status-drift-check.js` 不再是前两名 —— 修复前后的归属表逐字贴进任务体。只证明「加了缓存代码」或只跑单测不算（DIR-026 Reading A）；fixture 计数是必要不充分条件，生产 execve 读数是判据。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/scripts/task-status-drift-check.js
- plugin/scripts/driver-anchor.ts
- plugin/test/ready-pool-check-git-exec-count.test.mjs (new)
- tasks/gap-anchor-polling-git-fork-storm.md

> 文件名待执行器核实一处：bpftrace 的父进程名为 `task-status-drift-check.js`（本任务证据即如此记录），若实际载体是 `.ts`，按实情登记并在落地时把真实路径补进本段（⛔ 不要为了迁就 Touches 去改名）。
