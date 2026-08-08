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
status: ready
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
（共 4 个文件）。**人裁定后扩展到 6 个文件**（B类：另加 `quay-init-tmux-detection` / `build-dist-smoke`，
管理者机械识别 2026-08-07 10:2x）。

### 为什么是新类别（未被任何现有规则覆盖）

`test-isolation-contract.md` 的 **R1-R7 全部关于文件系统/进程隔离**（mkdtemp 位置、进程生命周期、
共享检出写入等），**没有一条覆盖「挂钟计时依赖」**。⇒ 这是一个**全新的设计缺陷类别**，现有规则
机制上无法捕获。

### 人裁定覆盖（2026-08-07 10:2x——本任务 AC2 的修复方向被覆盖）

**人裁定：并发 8 不降，为不能并发跑的测试应用相应机制，并发拿真绿。** 管理者落点建议：serial 组
（复用 scripts/test.sh 的 --group 机制）。**B类现有测试（6 个）通过 serial 组串行路由解决**——不再用
假时钟逐文件重写（本任务原 AC2 被此覆盖）。**R8 规则本身仍有效**（新测试不得依赖挂钟计时判定时序，
须受控假时钟/事件）——serial 组是处理既有测试的机制，R8 是约束新测试的原则，两者互补。
落地任务：`gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests`。

### 交叉标注（2026-08-07，serial 组已落地）

`gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests` 已落地：6 个 B类文件
（session-liveness / measure-suite / monitor-mount-check / quay-init-tmux-detection /
send-keys-verified / build-dist-smoke）与 A 类、KNOWN-LOAD-SENSITIVE 族一起声明 `@test-group serial`，
由 `scripts/test.sh` 的 serial 阶段在并发主体之后以 concurrency 1 单独串行跑——B类挂钟等待不再被
并发主体 CPU 饥饿击穿（本任务 AC2 的"既有 B类经 serial 组隔离"已由落地任务完成）。本任务的 R8 规则
（约束**新**测试不得依赖挂钟计时）仍是独立的后续工作。

## Contract

```
measure wall_clock_tests = `grep -rlE 'sleep\(2[0-9]{3}|sleep\([0-9]{4,}' plugin/test/ packages/*/test/ 2>/dev/null | wc -l` stdout 数字段（当前 6，含 session-liveness/send-keys-verified/monitor-mount-check/measure-suite/quay-init-tmux-detection/build-dist-smoke）
band wall_clock_tests = 0（R8 落地后，挂钟依赖测试清零）
invariant 测试不得依赖挂钟计时判定时序；时序判定必须用受控假时钟/事件驱动
invoke `grep -rlE 'sleep\(2[0-9]{3}|sleep\([0-9]{4,}' plugin/test/ packages/*/test/`
control 人为在负载下跑 session-liveness noise-gate ⇒ 必须不因调度延迟失败（serial 组隔离后）；改回真 sleep ⇒ 必须复现负载失败
resume 若中断，先跑 measure 读当前挂钟依赖测试数
```

## Acceptance Criteria

- [ ] AC1: **R8 规则写入**——`test-isolation-contract.md` 加 R8（不得依赖挂钟计时判定时序，须受控假时钟/事件）
- [ ] AC2: **既有 B类测试经 serial 组隔离**（人裁定覆盖原"假时钟逐文件重写"方向；serial 组落地见
      `gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests`）
- [ ] AC3: **负控制**——人为改回真 sleep 且不 serial ⇒ 负载下复现失败（证明 serial 隔离是修复）
- [ ] AC4: 与 `gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests`（落地任务）、
      `gap-test-isolation-backlog-44-violations-unmeasured`（A/D 类另一面）、
      `gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage`（族分诊机械化）交叉标注

## Definition of Done

- [ ] AC1-AC4 实跑输出贴进任务体
- [ ] 并发 8 下套件不再因挂钟依赖恒红（serial 组隔离后 B类测试过）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## Touches
- docs/references/test-isolation-contract.md（R8 规则）
- plugin/test/session-liveness.test.mjs 等 B类测试（serial 路由，见落地任务）
- tasks/gap-wall-clock-timing-dependency-in-tests-not-covered-by-r1-r7.md（自身文件）
- tasks/gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests.md（AC4 交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-07T09:5xZ
changed: 管理者 2026-08-07 根因分析（挂钟依赖 + 4 文件），请外层判断 → 裁定立案 R8：新类别（R1-R7
  未覆盖）、负载敏感族根因、阻塞并发 8 策略。
追加 2026-08-07 10:3xZ：人裁定覆盖 AC2 修复方向——B类 6 个文件走 serial 组（不逐文件假时钟重写），
  R8 规则本身保留（约束新测试）。落地任务已立。
