---
id: gap-fake-suite-release-gate-sleep-zero
title: full-suite-runner.test.mjs 固定 sleep 换释放闸——fake suite 阻塞在「测试触碰释放文件」上，墙钟归零（Tier 1）
status: done
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`full-suite-runner.test.mjs`（全套件最长文件 ~199s）里 ~15 处 fake suite 用固定 `sleep N`（3×`sleep 10`=30s + 一堆 1–5s）由 runner 活活等完，墙钟被硬等待顶高。改为 fake suite 阻塞在「测试触碰释放文件」上：in-flight / early-red 语义不变，硬等待墙钟归零。证据 :2651,:2679,:3374（sleep 10）及各 sleep 3/2/1 处（peer 两只读 subagent 逐行核）。

**⛔ 不可盲切 sleep 10→3**：那是 load-hardening 产物（注释明说 2s running window 在 16 路争用下 flake，特意加宽到 10s）。释放闸位法（释放文件信号）才安全等价。

## Plan

1. 逐个 fake suite 把固定 `sleep` 换成「轮询等待测试触碰的释放文件」（或等价信号），in-flight/early-red/terminal 三类语义不变。
2. ⛔ 不删测试换时间（每测一条 AC，flip-no-ac 闸守着）。

## Acceptance Criteria

- [x] AC1（能取假）：fake suite 无固定 `sleep` 可归零 in-flight 窗口——grep 该文件无 `sleep 10` 等硬等待，改释放文件信号；（⛔ 仍硬 sleep ⇒ 假）。
- [x] AC2（能取假）：early-red / in-flight / terminal 三类断言仍绿（scoped 跑该文件全绿）；（⛔ 任一类红 ⇒ 假）。
- [x] AC3（能取假，墙钟）：scoped 该文件墙钟较基线显著下降（贴前后读数）；（⛔ 无下降 ⇒ 假）。

## Implementation

新增 helper `releaseGate(base, tag)`（`plugin/test/full-suite-runner.test.mjs`，`fakeSuite` 旁）：返回 `{release, wait}`——`wait` 是 bash 轮询循环（50ms 间隔、~30s 兜底上限防泄漏套件永阻），阻塞到测试 `fs.writeFileSync(release, "go")` 触碰释放文件为止。替换清单（9 处固定 sleep 全归零）：

- 3× `sleep 10`（AC1 in-flight / AC2 early-red / AC2 vitest early-red）→ 释放闸（测试观察到 intermediate state 后触碰 release）。
- 1× `sleep 3`（两 runner 竞态 :4539）→ 释放闸（B 接管后触碰 release 让 A 落红）。
- 1× `sleep 1.5`（load-sampler 采样窗口）→ 释放闸（观察首条采样后触碰 release）。
- 4× `sleep 1`（concurrent-writer / assertion-surface-edit 的 mid-round mutation 前）→ 直接删除（runner 捕获 start HEAD / assertion snapshot **之后**才 spawn 套件 ⇒ mutation 结构性 mid-round，sleep 冗余）。

**AC3 前后读数**（同 9 个测试，`node --experimental-strip-types --test --test-name-pattern=…` 串行）：

- 总墙钟 **61.9s → 38.4s**（−23.5s，−38%）。
- 3 个 sleep-10 测试逐个：12.5s→3.4s / 12.0s→4.5s / 11.8s→3.5s（hard wait 归零，余下为真实 runner bootstrap ~3-4s/次）。

**残留且不可归零的 sleep（非 in-flight 窗口，属 hang/crash/测量/非-fake-suite 载体）**：`sleep 30` 挂起 seam（max-runtime/silence/red-grace 三测试——挂起即被测对象）；`sleep 30 &` 后台子进程（立即 SIGKILL）；`sleep 0.1` 连续输出循环；`sleep 5` red 后静默；`sleep 2/3` crash seam（套件须活过 ~30ms crash 缝）；`sleep 1` lock_wait_ms 测量（sleep 即被测量 flock 等待）；`sleep 3` systemd 证据捕获（skip 守卫）；`sleep 60` host 占位（被 SIGKILL）；`time.sleep(60)` Python fork 测试（非 fake suite）。

## Definition of Done

fake suite 释放闸替换落地；AC1-AC3 全勾；scoped 全绿 + 全量低conc 泳道 floor 较基线下降。

## Touches

- plugin/test/full-suite-runner.test.mjs（fake suite 固定 sleep → 释放闸）
- tasks/gap-fake-suite-release-gate-sleep-zero.md（自身）
