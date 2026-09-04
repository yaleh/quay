---
id: gap-fan-in-token-gate-version-mismatch-self-lock
title: 机械 fan-in 版本错位自锁——旧守护 in-process × worktree 编排（每任务新进程修法；token 闸
  半已由 fd902a824 重定范围到 P2 TS 模块）
status: done
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

## Proposal

`gap-fan-in-ff-merge-token-gate-fail-closed`（L1 token 闸）曾 needs-human（3× exited-not-landed）。根因不是实现错，是**版本错位**：闸在任务 worktree 的 `fan-in-ff-merge.sh`，注入在 `worker-driver.ts`，但发起 fan-in 的守护是主检出旧代码 ⇒ 旧签发者 × 新校验者自锁。

**类级缺陷**：任何「改了 worker-driver.ts 但守护仍是旧的」的任务都会命中——不是 token 闸一例，是「fan-in 编排脚本从 worktree 加载、但发起者从主检出旧进程运行」的**架构错位**。

**⛔ 范围变更（2026-08-28 develop 演进，人裁定）**：ADR-034（`afba4ae23`/`055cf9fdd`）已把 fan-in 锁收进 driver（`acquireFanInWorkflowLock`，废除 bash `--acquire/--release-workflow-lock` 分离 holder）；`fd902a824` 把 **L1 token 闸重定范围到 P2（`gap-execution-loop-productization-p2-p4` AC1）的 TS 模块 ff 入口**（`fan-in-ff-merge.sh` → 被 import 的 .ts 模块）。⇒ 本任务**不再实现 bash token 闸**（闸半已不在 bash、且随 P2 TS 化落地）；**保留并落地的是类级修法——每任务新进程**，它消灭「改了 worker-driver.ts 但守护仍是旧的」整个类，P2 的产品化（fan-in → verb）是同一类级修法的产品层正解。

## Plan

机制修法（⛔ 不打补丁）：

1. **每任务新进程执行**：机械 fan-in 不再在守护进程 in-process 跑（守护是主检出旧代码、但编排脚本从 worktree 加载 ⇒ 版本错位），改为每任务 spawn 一个 fresh node 进程加载 worktree 的 `worker-driver.ts --mechanical-fan-in`——锁半（`acquireFanInWorkflowLock`，ADR-034）与编排半（`fan-in-ff-merge.sh`）同源（都在 worktree），改了 worker-driver.ts 的任务 fan-in 用它自己的新锁/新编排。
2. **`--mechanical-fan-in` CLI 入口**：fresh 进程跑 `runMechanicalFanIn`、stdout 打单行 JSON result（exit 0=landed / 2=red），spawn 方解析——spawn 失败/输出不可解析 fail-closed 为 red（硬规则 3b：读不懂 ≠ 合格）。
3. **⛔ 不实现 bash token 闸**：L1 token 闸已由 `fd902a824` 重定范围到 P2 的 TS 模块 ff 入口，本任务不重复实现（bash `--acquire-workflow-lock` 已被 ADR-034 废除）。

## Acceptance Criteria

- [x] AC1（能取假，版本错位已消）：finishAsync 机械 fan-in 改为每任务 spawn fresh 进程加载 worktree 的 `worker-driver.ts --mechanical-fan-in`（⛔ 仍 in-process 旧守护 ⇒ 假）。
- [x] AC2（能取假，fresh 进程真实执行）：fresh 进程 `--mechanical-fan-in` 真实 spawn 执行、stdout 单行 JSON result round-trip 可解析（⛔ 只测结构断言/fixture-only ⇒ 假，硬规则 4 推论三）。
- [x] AC3（能取假，不自锁 + L1 重定范围一致）：本任务不再实现 bash token 闸（L1 已由 `fd902a824` 重定范围到 P2 TS 模块 ff 入口；⛔ 仍实现 bash token 闸 ⇒ 与裁定冲突 ⇒ 假）。

## Definition of Done

每任务新进程落地（finishAsync → `spawnMechanicalFanIn` → `--mechanical-fan-in`）；AC1-AC3 全勾；版本错位自锁类（旧守护 in-process × worktree 编排）被每任务新进程消灭；token 闸不再由本任务实现（L1 已重定范围到 P2）。

## Touches

- plugin/scripts/worker-driver.ts（每任务新进程 spawnMechanicalFanIn + --mechanical-fan-in CLI 入口）
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs（AC1 结构 + AC2 fresh 进程 round-trip）
- plugin/test/worker-driver.test.mjs（AC1 结构）
- tasks/gap-fan-in-token-gate-version-mismatch-self-lock.md（自身）
