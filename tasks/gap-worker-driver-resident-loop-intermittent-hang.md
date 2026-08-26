---
id: gap-worker-driver-resident-loop-intermittent-hang
title: worker-driver.ts 常驻派发循环间歇性挂起——并发/负载触发的竞态，driver 子进程不退出无限占槽（3 次独立复现，治本）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

> **优先级（人 2026-08-26 裁定）**：高于其它 in-flight 工作——优先深挖/修本条。与 `gap-fan-in-per-task-suite-no-silence-timeout-watchdog`（治标：卡死能杀）分工：本条治本（为什么会卡死）。

## Proposal

`plugin/scripts/worker-driver.ts` 常驻派发循环本身有一个**真实的、由并发/负载触发的间歇性挂起 bug**——不是测试文件的问题，是**被测的生产机制本身**。

### 证据链（manager 全部直接测量 + outer 读码复核）

**① 三次独立复现，全卡在 `worker-driver.test.mjs`**：
```
ac143（已被 kill）                          卡 33.7 分钟
gap-compute-inflight-worktree-touches        卡 85+ 分钟后自行恢复/重跑（新 suite_pid 13:31:42Z）
gap-suite-lpt-lookback                       此刻仍卡住，已 172.7 分钟（pid 819605 起于 10:39:56Z）
同一份代码，gap-quiet-window-holder 那次正常跑完（133.6s）⇒ 间歇性，非每次必现
```

**② 直接测量：`--interval 20`（20s）实际轮询速率快 ~34 倍**：fixture `/tmp/worker-driver-liveness-wire-ULc5eO`（对应 worker-driver.test.mjs:1499 liveness-wiring 用例）创建于 10:39:56Z、存活 10359s，`rpc.cnt/liveness.cnt` 从 0 涨到 18126+ 仍在增长 ⇒ 平均每 ~0.57s 一次调用（配置 20000ms ⇒ 快 ~35 倍）。

**③ Node 内建诊断（`kill -SIGUSR2 <pid>`，非侵入）**：卡住进程（pid 776573，node --test 文件级）此刻 `javascriptStack.message=""`（不在跑 JS，排除测试自己的 waitFor(fn,5000) 死循环——它硬编码 5s 超时）；libuv 活跃句柄仅 14 个，核心是 **1 个 process handle（pid 819605，常驻 driver 子进程本身）+ 1 个活跃 pipe（其 stdout）** ⇒ **真正卡住的是被 spawn 出来的 worker-driver.ts 子进程没正常退出，不是 JS 测试逻辑**。

**④ 读码定位（worker-driver.ts:1592-1682 主循环，outer 已读）**：0.57s 的节奏**既对不上 20s 的 intervalMs（:1662-1666 空闲睡眠分支）、也对不上 300s 的 reconcileMs 地板（:1668-1681）**——说明循环既没落进「空闲睡眠」分支、也没卡在「地板等待」分支，而是在 `while (running.length < cap && !stopReason)`（:1623-1654 内层选择环，**本身无任何延迟**）里高速空转，或反复误判「还有 worker 在飞」。

**⑤ `.done`/`.promise` 赋值顺序（:1533-1573 spawnSelected）单看是对的**（`done=true` 在 `.then()` 里同步设，理论上不滞后于 `rw.promise` resolve）。⇒ **根因未锁定到具体行**——需在高负载下对活的卡死实例接 debugger（`--inspect-port=127.0.0.1:9229` 已开）或加时序日志复现（已超出 manager「读码定位根因」边界）。

### 为什么比看门狗更重要

worker-driver.ts 是**当前生产驱动的核心机制本身**（`--root /home/yale/work/quay --concurrency 5` 此刻正用同一份代码驱动全部 5 个在飞任务）——机制上完全可能在生产上以同样方式挂起，一旦触发就是**无限占用槽位、不会自愈**。看门狗能兜底「卡死能发现」，但这条不修，卡死会持续发生。

### 现场取证入口（供实现方复现）

- 活的卡死实例：pid 819605（`--root /tmp/worker-driver-liveness-wire-ULc5eO`），已存活 172.7 分钟，`--inspect-port=127.0.0.1:9229` 开着可连
- 对应测试：`plugin/test/worker-driver.test.mjs:1499-1531`（「liveness wiring — resident loop calls the liveness checker each round」）
- 主循环：`plugin/scripts/worker-driver.ts:1592-1682`

## 根因（实现方实测锁定，⛔ 推翻了 Proposal 的「主循环 0.57s 空转」假说）

**实测复现（RUN 8，liveness-wiring 用例隔离跑 25 次内命中）**：`t.after(() => fs.rmSync(root))` 抛 `ENOTEMPTY, Directory not empty: /tmp/worker-driver-liveness-wire-<rand>`，栈指向 worker-driver.test.mjs 的 rmSync after 钩。

**机制（三步，全部实证）**：
1. **after 钩按注册序 FIFO 运行**，且一个 after 钩抛错会**跳过后续 after 钩**（node:test 实测：hook-1 抛 ⇒ hook-2 不跑）。
2. 常驻测试的 `t.after(() => fs.rmSync(root))` **先注册**（紧跟 makeGitRoot）、`t.after(() => drv.stop())` **后注册**（紧跟 spawnResident）⇒ rmSync 先跑，此刻驱动仍活、每轮写 `root/.quay/worker-round.jsonl` ⇒ rmSync 竞态 ENOTEMPTY。
3. ENOTEMPTY 抛错跳过 `drv.stop()` ⇒ **驱动泄漏**（常驻驱动永不自行退出、继续 spinning、持 stdout pipe）⇒ `node --test` 等不到 EOF ⇒ 文件级测试永不 resolve ⇒ 整个 suite 挂死。

**关于 Proposal ② 的「0.57s 空转」**：`--interval 20` 的单位是 **毫秒**（`parseIntervalMs` 直接 `Number(raw)`），不是 Proposal 读的 20 秒 ⇒ 驱动「每 0.57s 一轮」正是 `--interval 20`（20ms）+ 每轮 3 次 node/git spawn 在满载机上的**正常轮询速率**，不是主循环空转。**主循环没有挂起 bug**——挂起的是「测试没把驱动杀掉」。故 Touches 收敛到测试文件，不改 worker-driver.ts。

## Plan

1. **复现 + 锁定根因**：隔离跑 liveness-wiring 用例 25 次，命中 ENOTEMPTY（RUN 8），锁定到 after 钩 FIFO 顺序 + rmSync 竞态 + drv.stop 被跳过（⛔ 已到具体行/条件，非「疑似」）。
2. **修复**：① `spawnResident` 用 `detached:true` 让驱动成进程组组长、`stop()` 杀整组（driver+worker+counter 一起死）并 await 真退出；② 常驻测试统一「先 drv.stop 再 rmSync」的 after 钩顺序（多行 rmSync 的冷启动 3 测用 body 末 inline drv.stop）。
3. `.claude/workflows/`/`plugin/workflows/` 未涉及，双副本无需核对。

## Acceptance Criteria

- [x] AC1（能取假，锁定根因）：锁定到 after 钩 FIFO 顺序 + rmSync ENOTEMPTY 竞态 + drv.stop 被跳过 → 驱动泄漏（⛔ 非「疑似 0.57s 空转」——那是对 `--interval 20` 单位的误读）。
- [x] AC2（能取假，修复不挂起）：修复后常驻测试的驱动被 `stop()` 正常杀掉（杀整组 + await 真退出），不再泄漏/占槽。
- [x] AC3（能取假，负控制）：liveness-wiring 用例 + 新增负控制（长命 worker sleep 100 在 stop 后不得持 stdout pipe）跑 N 次都完成；全文件 88 测绿。

## Definition of Done

常驻测试间歇挂起竞态已定位并修复（after 钩顺序 + 孤儿 worker 持 pipe）；AC1-AC3 全勾；driver 子进程不再间歇挂起、不再无限占槽。

## Touches

- plugin/test/worker-driver.test.mjs（常驻测试 after 钩顺序修复 + 挂起复现负控制）
- tasks/gap-worker-driver-resident-loop-intermittent-hang.md（自身）
