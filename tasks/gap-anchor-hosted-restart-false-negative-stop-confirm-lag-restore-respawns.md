---
id: gap-anchor-hosted-restart-false-negative-stop-confirm-lag-restore-respawns
title: anchor-hosted kind 的 driver restart 把「已重起」报成 restart-aborted：stop 确认判据
  aliveness 滞后 + restoreDesiredOnFailure 静默拉起新 loop
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（第三方项目 2026-10-20 实测，kind=quality anchor-hosted）。** `quay driver restart --kind quality` 输出 `stop-failed: kind=quality — 该 kind 的循环在 60000ms 内未收尾` + `restart-aborted`，但 anchor.log 同时记录 `kind=quality loop stopped`（06:27:52Z），随后 quality-round.jsonl 出现 round=1（06:28:08Z）且连续 round=1..4，新配置（loop.architecture_review.enabled=false / arch_discovery.enabled=false）已生效，`quay driver start --kind quality` 报 `already-running`。即 CLI 报告的结局（未重启）与真实结局（已用新配置重起并持续运行）相反，操作者无法从命令输出判断到底有没有重起。

**机制。** `plugin/scripts/driver-runtime.ts` 的 `stopKindViaAnchor` stop 确认判据是 `aliveness(root,kind).running` 变 false（60s 窗）；超时后走 `restoreDesiredOnFailure` 调 `updateDesired(kind,true)`（driver-runtime.ts:4607-4609）把 kind 放回期望态——这条 restore 会让 anchor 立刻把 loop 重新拉起，于是 loop 实际重起了、但 CLI 走的是「未确认旧 loop 退出」的 abort 分支（`restartKind` driver-runtime.ts:4709-4716 返回 1）。`restoreDesiredOnFailure` 由 done 任务 `gap-per-kind-stop-is-in-memory-and-never-crosses-dist-bundles`（其 Step 3/AC4）引入，本条是它的一处副作用：restore 拉起新 loop 后，CLI 的 abort 分支与真实结局相反。

**去重。** 与 done 任务 `gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window` 不同机制：那条修的是「在飞长轮导致等满 60s 且 loop 不重起」（safe but unreliable），本条是「stop 确认判据滞后 + restore-desired 静默拉起新 loop」造成的假阴性（已重起却报 abort）。

## Plan

修法方向（三选一或组合）：
1. anchor-hosted kind 的 restart 以「新 loop 的 readiness marker / round generation +1」作为成功判据，而不是旧 aliveness；
2. 输出区分 `restarted-loop (process unchanged)` 与 `restart-aborted`，并带 before/after loop generation 或 round ts；
3. 换 kernel 场景明确提示 per-kind restart 不换 anchor 进程（需 takeoverPid），不要用同一句 restart 表达两件事。

复现材料待补入：完整复现材料（命令输出全文 / anchor-desired.json / anchor.log / quality-round facts）正在从对方项目收集，fix 作者落地时贴全量复现作为证据。

## Acceptance Criteria

- [ ] AC1 复现：anchor-hosted 夹具（或真实宿主）上，改前 `restart --kind quality` 输出 stop-failed + restart-aborted，且 loop 实际已用新配置重起（round generation +1、`driver start` 报 already-running）；贴命令输出全文 + anchor.log + before/after round 证据。
- [ ] AC2 修复后同一夹具：CLI 报告真实结局——loop 已重起时报 restarted-loop（附 before/after generation），绝不把「已重起」报成 restart-aborted；贴全文。
- [ ] AC3 位置判定（双向负控制）：改后 driver-runtime.ts 中 anchor-hosted restart 的成功判据不再只依赖旧 `aliveness(root,kind).running`（grep 命中新判据，或旧判据调用点清零）；负控制用同一谓词对改前 develop 副本命中旧判据（证明谓词可判，非恒零）。
- [ ] AC4 CLI 表层（枚举，非布尔）：输出词表区分 `restarted-loop`（process unchanged）与 `restart-aborted` 两态，且带 before/after loop generation 或 round ts；grep 命中新词表，并对「已知为真」样本干跑非零。
- [ ] AC5 双向负控制：真正未重起的场景（stop 确实失败且无新 loop 被拉起）仍如实报 restart-aborted，不因新判据误报成功。
- [ ] AC6 `scripts/test.sh --for-task gap-anchor-hosted-restart-false-negative-stop-confirm-lag-restore-respawns` 绿。

## Definition of Done

在真实 anchor-hosted 宿主（或等价夹具）上，`quay driver restart --kind quality` 的 CLI 输出与真实结局一致：loop 已重起 ⇒ 报 restarted-loop 并附 before/after generation；loop 未重起 ⇒ 报 restart-aborted。AC1-AC6 勾齐并贴证据；完整复现材料补入正文。

## Touches

- plugin/scripts/driver-runtime.ts
- packages/quay/src/cli/driver.ts
- plugin/test/driver-runtime-s10.test.mjs
- tasks/gap-anchor-hosted-restart-false-negative-stop-confirm-lag-restore-respawns.md
