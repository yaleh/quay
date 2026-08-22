---
id: gap-fan-in-relaunch-retry-cap
title: fan-in-execute 对 suite 失败 relaunch 设重试上限/退避（非 load-sensitive 确定性失败无界循环，单点放大停摆 2h）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 投改进建议①（hub-strip 无限 relaunch 停摆 2h 事件）。⛔ 与既有 ff-retry（单次 ff 失败 revert→重试→自愈）区分——本任务针对「**flaky 非 load-sensitive 失败的无上限循环**」这一半。

**证据（能取假）**：hub-strip 因 PHASE_OVERLAP flake，suite 每次失败 → fan-in-execute 的「other-task defer → relaunch」路径**无限 relaunch**（06:12→08:00，~2h）→ 占住 suite 锁 → 阻塞 AC111/AC115/slice 三个在飞任务的 fan-in → 「2h 零任务完成」。08:00 手动 TaskStop 才解。既有 anti-livelock（`releaseLivelockRounds`）只覆盖 load-sensitive 红，**不覆盖非 load-sensitive 的确定性失败**（PHASE_OVERLAP 未标 @load-sensitive）。

**⊢ 为什么要紧**：一个 flake 就能停摆整条流水线 2h——「单点放大」缺陷，比 flake 本身贵得多（flake 有 e2f30318 修，但「无限 relaunch」这个放大器没有）。

**为什么 inner 执行**：改 `.claude/workflows/fan-in-execute.js` 的 relaunch 控制流 → inner 域。

## Plan

1. fan-in-execute 的「other-task defer → relaunch」路径设重试上限（如 N 次）或退避，超限 → retreat→needs-human / 交 outer 接手，⛔ 不得无限重跑。
2. flaky（非确定性）失败应更早放弃——重跑几次仍是同一个 flake，无限重跑零信息。
3. 与既有 releaseLivelockRounds（load-sensitive）区分，两者互补不重复。

## Acceptance Criteria

- [x] AC1：非 load-sensitive 的 suite 失败 relaunch 有上限（N 次），超限 retreat→needs-human（⛔ 无限重跑）。
- [x] AC2（能取假，负控制）：构造一个确定性 flake ⇒ relaunch 到上限后 retreat/交人，不再无界循环。
- [x] AC3：与既有 ff-retry（单次 ff 失败）与 releaseLivelockRounds（load-sensitive）不冲突。

## Definition of Done

- [x] relaunch 上限/退避落地 + 确定性 flake 负控制通过；AC1-3 全勾；land 到 develop。

## Touches

- .claude/workflows/fan-in-execute.js（relaunch 控制流 + defer 侧 anti-livelock）
- plugin/workflows/fan-in-execute.js（双副本，逐字节一致）
- plugin/test/fan-in-execute-paths.test.mjs（defer anti-livelock 组测试）
- tasks/gap-fan-in-relaunch-retry-cap.md（自身）
