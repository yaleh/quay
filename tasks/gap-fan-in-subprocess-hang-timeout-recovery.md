---
id: gap-fan-in-subprocess-hang-timeout-recovery
title: fan-in 子进程挂起无超时恢复——A+B fan-in 持锁 53min（instrument + 修超时盲区）
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

A+B 任务（gap-fan-in-merge-develop-derived-recompute-and-reason）的机械 fan-in **持 `fan-in-workflow.lock` 53 分钟挂死**（2026-08-29 实测，TaskStop 才解堵）。worker 实现已正确提交（退休 A + 保留 B + 修 import，56461213a），挂起在 fan-in 本身。

**已查明的锁机制（正常部分）**：`acquireFanInWorkflowLock` spawn 一个非分离 bash holder（`cat >/dev/null` 阻塞 stdin）；driver 死/release 关 stdin 写端 ⇒ holder 读 EOF ⇒ 写 release + `flock -u` ⇒ 释放。这是 ADR-034 的正确设计。

**挂起所在**：driver 的 `runMechanicalFanIn` 卡在某个子进程步（merge 已过、无 suite 日志 ⇒ 卡在 anti-drift/delta/typecheck/scoped/suite 之一），**没走到 finally 的 releaseLock**。而 `mechSh` 各步都有超时（120s/300s/600s）、suite 有 silence watchdog（15min）——**53min 无恢复说明超时/看门狗有盲区**（疑似：子进程 SIGKILL 后 stdout/stderr 管道被孤儿孙进程持有 ⇒ `runAsync` 的 close 事件永不触发；或某步 spawnSync 阻塞 event loop ⇒ setTimeout 不 fire）。

## Plan

1. **instrument**：给 `runMechanicalFanIn` 每步（merge/delta/typecheck/scoped/suite）加开始/结束时间戳日志（落 `.quay/` 或复用锁事件载体），复现时直接定位挂起在哪一步。
2. **定位超时盲区**：核对 `runAsync` 的 timeout 在「子进程 spawn 了继承 stdout/stderr 管道的孙进程」场景下是否真能 resolve（SIGKILL 只杀直接子进程，孙进程持管道写端 ⇒ close 不触发）；`spawnSuiteAndWait` 的 silence watchdog 是否覆盖「suite 未起、还在等 suite slot 锁」阶段。
3. **修**：给挂起步补可靠超时恢复（如 process-group kill / 显式超时 resolve 不依赖 close 事件），保证 fan-in 任何子进程挂起都能在有限时间内释放锁（⛔ 不设业务阈值，只设「挂起探测」）。

## Acceptance Criteria

- [x] AC1（能取假，instrument）：fan-in 每步有开始/结束日志，可据日志定位挂起步（改掉 ⇒ 日志缺失）。
- [x] AC2（能取假，超时盲区）：构造「子进程 spawn 孙进程持有 stdout/stderr 管道」场景，断言 `runAsync` 在 timeout 后**仍能 resolve**（不依赖 close 事件，孙进程持管道不阻塞返回）。
- [x] AC3（能取假，suite 未起）：`spawnSuiteAndWait` 在「suite 子进程卡在等 suite slot 锁、未产生日志」时，silence watchdog 或显式超时能在有限时间 kill 并返回（非 53min 挂死）。
- [x] AC4（能取假，锁释放）：任一 fan-in 子进程挂起 ⇒ fan-in 在有限时间失败并**释放 fan-in-workflow.lock**（`releaseLock` 必达，锁不残留）。

## Definition of Done

fan-in 的任何子进程挂起都能被 instrument 定位、被超时恢复，锁在有限时间内释放，不再出现 53min 持锁挂死阻塞全仓 fan-in。

## Touches

- plugin/scripts/worker-driver.ts（runMechanicalFanIn instrument + runAsync/超时恢复）
- plugin/scripts/suite-driver.ts（spawnSuiteAndWait 的 suite-未起超时覆盖）
- plugin/test/worker-driver.test.mjs（AC2 超时盲区单测）
- tasks/gap-fan-in-subprocess-hang-timeout-recovery.md（自身）
