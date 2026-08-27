---
id: gap-fan-in-driver-mechanical-orchestration
title: fan-in 机械编排——取消 workflow 子代理、机械部分交 driver、语义部分单独 Claude 会话（SPEC 正本 orchestration/SPEC-fan-in-driver-mechanical-orchestration-2026-08-27.md）
status: ready
labels:
  - gap
  - feature
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

> **正本**：`orchestration/SPEC-fan-in-driver-mechanical-orchestration-2026-08-27.md`（人 2026-08-27 09:0xZ 提方案逐字在 §0.1，manager 三组实测 §1.1）。**取代** `SPEC-fan-in-workflow-lock-and-S1-2026-08-26.md` 的解法（保留其诊断）；不冲突 `SPEC-unified-driver-architecture` 与 `SPEC-worker-driven-inner`。

## Proposal

**取消 `fan-in-execute.js` workflow（子代理串行跑机械步骤），改由 driver 机械驱动 fan-in 的机械部分（锁 / merge / delta 判定 / typecheck / scoped门 / suite / ff）；只有需要语义判断的失败点（冲突、红 suite、typecheck 红、anti-drift 越界）才单独唤起一个 Claude Code 会话。suite 不再 detach，fan-in 锁机械包裹 suite 锁，锁持有时长从「模型的 ~30min」塌缩到「机械的 ~10min」。**

**⊢ 根因（SPEC §1.1 三组实测，非推演）**：S=1 workflow 锁的「ff-race 结构上归零」未兑现——① 锁持有恒 ~30min（1800s watchdog 强制释放）；② suite 跑在锁 release 之后（lifecycle-driver suite 07:20:50 > release 07:16:50）；③ archguard ff 失败二次 acquire 重试。三者同根：机械活不该由一个慢子代理跑（7 条命令每条之间 ~3-5min 模型延迟），「执行载体错」不是「锁对象错」。

**⊢ 三个设计点（SPEC §3.1）**：① driver 不能同步阻塞 26min——不 detach ≠ 同步阻塞，driver 用 spawn 子进程 + 异步 poll（exit 文件），suite 跑时照常派 worker；② 语义循环由 driver 控（检测红 → 调 Claude 会话修 → 重跑 → 再判），Claude 会话是无状态一次性判断；③ worktree 归属——worker 只实现、driver 接管跑机械 fan-in，顺带消掉 outer 报的「worker TaskOutput 收尾慢 30-40min」。

## Plan

1. driver 机械驱动 fan-in 机械部分（锁/merge/delta/typecheck/scoped门/suite/ff），suite 不 detach（driver 子进程 + 异步 poll）。
2. 语义失败点（冲突/红 suite/typecheck 红/anti-drift 越界）单独唤起 Claude 会话。
3. fan-in 锁机械包裹 suite 锁（锁时长 ≤ 机械 ~10min）。

## Acceptance Criteria

- [ ] AC1（能取假，锁时长塌缩）：一次 fan-in 的 fan-in workflow 锁持有 ≤ 机械时长 + 余量，⛔ 不再 ~30min 恒值；实测多任务锁持有显著低于 1800s 且与任务内容相关。
- [ ] AC2（能取假，锁罩住 suite）：fan-in 锁 release 不早于 suite 结束（`lock-events release ≥ suite exit end_iso`），⛔ 不再「suite 跑在 release 之后」。
- [ ] AC3（能取假，无 detach）：suite 进程是 driver 子进程（ppid 指向 driver），⛔ 不是 `setsid & disown` 孤儿（ppid=1）。
- [ ] AC4（能取假，ff-race 真归零）：连续 N 个 code-delta 任务 fan-in，ff 失败 = 0（或仅 inert-delta 毫秒级 re-ff），⛔ 不再 archguard 式「ff 失败 + 二次 acquire」。
- [ ] AC5（能取假，吞吐恢复）：任务落地吞吐 ~1/h → ≥3/h（同 3 在飞下）。

## Definition of Done

driver 机械编排 fan-in 落地；AC1-AC5 全勾；反例判据（SPEC §6）全不触发：锁不再恒 1800s / suite 不晚于 release / suite ppid 不=1 / fan-in-retries 不出现 Diverging branches attempt≥2。

## Touches

- .claude/workflows/fan-in-execute.js（取消/退役，双副本）
- plugin/workflows/fan-in-execute.js（取消/退役，双副本同步）
- plugin/scripts/worker-driver.ts（机械 fan-in 状态机 + 语义会话唤起）
- plugin/scripts/suite-driver.ts（suite 不 detach，driver 子进程 + 异步 poll）
- plugin/scripts/fan-in-ff-merge.sh（锁机械包裹 suite 锁）
- plugin/test/（AC1-AC5 + 反例判据负控制）
- tasks/gap-fan-in-driver-mechanical-orchestration.md（自身）

## 待裁定（人，SPEC §4，⛔ 本任务不擅自定）

- ① 是否先做「driver 机械 fan-in」happy-path（失败仍走旧 workflow 兜底）再逐步搬语义失败点，还是整体一步到位。
- ② 语义会话唤起粒度（每个失败点一个会话 vs 一个修复会话循环）。
