---
id: gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7
title: "NEW uncovered category: tests depend on real wall-clock timing for
  sequencing — session-liveness.test.mjs's two noise-gate tests use real
  sleep(2500) + 10-25s wait windows to judge a real polling process flips state,
  which fails under load (scheduling delay exceeds the window); same pattern in
  send-keys-verified/monitor-mount-check/measure-suite (4 files);
  test-isolation-contract.md R1-R7 cover ONLY filesystem/process isolation, NOT
  wall-clock — propose R8: tests must not depend on wall-clock timing for
  sequencing (use controlled fake-clock/events); this is the root cause of the
  KNOWN-LOAD-SENSITIVE family's persistent concurrency failures (blocks the
  concurrency-8 strategy)"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**测试依赖真实挂钟计时判定时序——test-isolation-contract.md 的 R1-R7 完全没覆盖这个类别。**

### 实测（管理者 2026-08-07 09:4x，并发 8 恒红根因分析）

`session-liveness.test.mjs` 的两条 **noise-gate** 测试：
- 用**真 `sleep(2500)` + 10-25 秒等待窗口**判定一个真实轮询进程翻转状态；
- 负载下调度延迟导致**等待窗口不够** ⇒ 断言失败（并发 8 恒红，偶尔并发 1 也红）。

**同款写法**：`send-keys-verified.test.mjs` / `monitor-mount-check.test.mjs` / `measure-suite.test.mjs`
（共 4 个文件）。

### 为什么是新类别（未被任何现有规则覆盖）

`test-isolation-contract.md` 的 **R1-R7 全部关于文件系统/进程隔离**（mkdtemp 位置、进程生命周期、
共享检出写入等），**没有一条覆盖「挂钟计时依赖」**。⇒ 这是一个**全新的设计缺陷类别**，现有规则
机制上无法捕获。

### 为什么值得立 R8（判断：是）

1. **这是 KNOWN-LOAD-SENSITIVE 族的根因**——它们依赖真时序，负载下必然失败；
2. **它阻塞并发 8 策略**——人指示并发 8 提速，但挂钟依赖测试在并发 8 下恒失败 ⇒ 套件无法绿；
3. **R1-R7 的机制缺陷**——规则没覆盖的类别，测试怎么写都不被拦。

### 修复方向（接法留执行时）

1. **R8 规则**：`test-isolation-contract.md` 加 R8——测试**不得依赖挂钟计时判定时序**；
   须用受控假时钟/事件驱动（注入时钟、事件序列、确定性等待）；
2. **修 4 个文件**：session-liveness noise-gate（假时钟/受控轮询）、send-keys-verified、
   monitor-mount-check、measure-suite——从真 sleep 改事件/受控等待；
3. **机械检查**：静态扫 `sleep(` / 长等待窗口在测试中的使用（或标 KNOWN-LOAD-SENSITIVE 但明确根因）。

## Contract

```
measure wall_clock_tests = `grep -rlE 'sleep\(2[0-9]{3}|sleep\([0-9]{4,}' plugin/test/ packages/*/test/ 2>/dev/null | wc -l` stdout 数字段（当前 4+，含 session-liveness/send-keys-verified/monitor-mount-check/measure-suite）
band wall_clock_tests = 0（R8 落地后，挂钟依赖测试清零）
invariant 测试不得依赖挂钟计时判定时序；时序判定必须用受控假时钟/事件驱动
invoke `grep -rlE 'sleep\(2[0-9]{3}|sleep\([0-9]{4,}' plugin/test/ packages/*/test/`
control 人为在负载下跑 session-liveness noise-gate ⇒ 必须不因调度延迟失败（受控时序后）；改回真 sleep ⇒ 必须复现负载失败
resume 若中断，先跑 measure 读当前挂钟依赖测试数
```

## Acceptance Criteria

- [ ] AC1: **R8 规则写入**——`test-isolation-contract.md` 加 R8（不得依赖挂钟计时判定时序，须受控假时钟/事件）
- [ ] AC2: **修 4 个文件**——session-liveness noise-gate / send-keys-verified / monitor-mount-check /
      measure-suite 从真 sleep 改受控时序，隔离 + 负载下都过
- [ ] AC3: **负控制**——人为改回真 sleep ⇒ 负载下复现失败（证明受控时序是修复）
- [ ] AC4: 与 `gap-test-isolation-backlog-44-violations-unmeasured`（spawns-test-sh 另一类负载红）、
      `gap-load-sensitive-session-family-confounds-step-three`（KNOWN-LOAD-SENSITIVE 族）交叉标注

## Definition of Done

- [ ] AC1-AC4 实跑输出贴进任务体
- [ ] 并发 8 下套件不再因挂钟依赖恒红（负载敏感族根因消除）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## Touches
- docs/references/test-isolation-contract.md（R8 规则）
- plugin/test/session-liveness.test.mjs（noise-gate 受控时序）
- plugin/test/send-keys-verified.test.mjs / monitor-mount-check.test.mjs / measure-suite.test.mjs
- tasks/gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7.md（自身文件）
- tasks/gap-test-isolation-backlog-44-violations-unmeasured.md（交叉标注）
- tasks/gap-load-sensitive-session-family-confounds-step-three.md（交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-07T09:5xZ
changed: 管理者 2026-08-07 根因分析（挂钟依赖 + 4 文件），请外层判断 → 裁定立案 R8：新类别（R1-R7
  未覆盖）、负载敏感族根因、阻塞并发 8 策略。
