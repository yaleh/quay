---
id: gap-monitor-mount-check-ac5-timing-flaky
title: monitor-mount-check.test.mjs AC5 时序 flaky——~5s 等 fake monitor pid 落盘，8
  路并发下稳定超时（阻塞 lane-formula + observability-holes）
status: done
labels:
  - gap
  - test-flaky
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`plugin/test/monitor-mount-check.test.mjs` AC5（:252）等 fake monitor 的 pid 文件落盘 ~5s，在 8 路并发 + 重载下【稳定】超时（`AssertionError: orphaned fake monitor pid must be readable`）。**非间歇**——lane-formula 重 fan-in 两轮都撞（11:47 首红 + 12:04 重试仍红同因），说明是并发下的确定性时序缺陷，不是随机 flake。

这阻塞了 lane-formula（gap-lane-formula-ignores-phase-overlap-concurrency，它只碰 scripts/test.sh + full-suite-runner.ts，不碰 monitor-mount-check）以及其后的 observability-holes（也碰 full-suite-runner.ts）——suite-fix 正确判 reason=other-task（inScope=[] 零修复零 relaunch），但 out-of-scope 的 flaky 挡在真实任务前面。

## Acceptance Criteria

- [x] AC1: monitor-mount-check AC5 改为更鲁棒的等待——轮询 pid 文件（带超时上限 + 重试）而非固定 ~5s sleep 后断言，8 路并发下稳定过。
- [x] AC2: 负控制落在生产载体——8 路并发重载下 AC5 稳定过（多次全量 suite 不红），非单次侥幸。
- [x] AC3: scoped 绿 + monitor-mount-check 相关测试不红。

## Definition of Done

- [x] 8 路并发下 monitor-mount-check AC5 稳定过（真实输出，多轮复现不红），scoped 绿。

## Touches

- tasks/gap-monitor-mount-check-ac5-timing-flaky.md（自身）
- plugin/test/monitor-mount-check.test.mjs（AC5 鲁棒等待：轮询 pid + 超时上限）

## Evidence

- AC1 实现：`plugin/test/monitor-mount-check.test.mjs` 新增 `waitForPidFile(pidFile, { timeoutMs=15000, intervalMs=25 })` —— 轮询 pid 文件【存在且含合法整数 pid】（`raw !== "" && Number.isInteger(pid) && pid > 0`），带 15s 超时上限 + 重试；超时报错带 `last raw content` 供诊断（不再是裸 `Number.isInteger` 断言）。AC5 的 `for (… 200 …) sleep(25)` + `fs.existsSync` + 断言 被替换为 `fakePid = await waitForPidFile(pidFile)`。根因：double-fork wrapper 的 `echo $! > pidFile` 非原子，lowconc 相 host-derived 并发（本机 nproc/2 = 8）下 wrapper 被饿死可超旧 5s 上限，或文件「已建但空」（`>` 重定向先创建后 flush `$!`）被 `existsSync` 误判为就绪。
- AC2 负控制（真实输出）：
  - 空载 10 轮 `node --test plugin/test/monitor-mount-check.test.mjs`：全部 `pass 13 / fail 0`（run 1–10）。
  - 8 路 CPU 烧进程（8× `while true; do :; done` 后台 + `jobs -p` 确认 8 个 pid）下 5 轮：全部 `pass 13 / fail 0`（contended run 1–5）。
  - 用后清理：`after()` 的 `killTmpdirMonitors()` + 每测试 `finally` kill fakePid，无 `/tmp/mmc-*` 假 monitor 泄漏（`pgrep -af session-liveness.sh` 仅剩主检出的 2 个真实 monitor）。
- AC3 scoped 门：`bash scripts/test.sh --for-task gap-monitor-mount-check-ac5-timing-flaky` —— scoped static checks 全过（task-contract-check / malformed-task-check / touches-one-entry-one-path / superseded-capability / landing-target / test-framework-policy / test-isolation / tmp-leak-pairing / test-impl-census 等），`monitor-mount-check.test.mjs` 13 tests `pass 13 / fail 0 / cancelled 0`。
- 未翻 status / 未 fan-in / 未 ff-merge —— 由 fan-in-execute workflow 承担。
