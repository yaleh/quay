---
id: gap-anchor-hosted-restart-false-negative-stop-confirm-lag-restore-respawns
title: anchor-hosted kind 的 driver restart 把「已重起」报成 restart-aborted：stop 确认判据
  aliveness 滞后 + restoreDesiredOnFailure 静默拉起新 loop
status: done
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

**采集口径更正。** 对方当时的命令是 `timeout 180 quay driver restart --kind quality 2>&1 | tail -30; echo "exit=$?"`，末尾 `exit=0` 是 `tail` 的退出码，不是 quay 的；quay 的 stop 步骤自己的退出码是 1（`restart-aborted` 行内写了 `exit=1`）。

**机制。** `plugin/scripts/driver-runtime.ts` 的 `stopKindViaAnchor` stop 确认判据是 `aliveness(root,kind).running` 变 false（60s 窗）；超时后走 `restoreDesiredOnFailure` 调 `updateDesired(kind,true)`（driver-runtime.ts:4607-4609）把 kind 放回期望态——这条 restore 会让 anchor 立刻把 loop 重新拉起，于是 loop 实际重起了、但 CLI 走的是「未确认旧 loop 退出」的 abort 分支（`restartKind` driver-runtime.ts:4709-4716 返回 1）。`restoreDesiredOnFailure` 由 done 任务 `gap-per-kind-stop-is-in-memory-and-never-crosses-dist-bundles`（其 Step 3/AC4）引入，本条是它的一处副作用：restore 拉起新 loop 后，CLI 的 abort 分支与真实结局相反。

**去重。** 与 done 任务 `gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window` 不同机制：那条修的是「在飞长轮导致等满 60s 且 loop 不重起」（safe but unreliable），本条是「stop 确认判据滞后 + restore-desired 静默拉起新 loop」造成的假阴性（已重起却报 abort）。

**复现材料（2026-10-20 实测，完整；AC1 基线）。**

① 命令输出（stdout/stderr）：
```
stop-failed: kind=quality — 该 kind 的循环在 60000ms 内未收尾（anchor pid=1376399）。⛔ 本条不报成 not-running：循环仍在 ⇒ 接着 start 会得到两份 loop（双派发）。期望态：已把 quality 放回（restart 中止 ⇒ 「该 kind 应该在跑」仍成立）。锚日志尾:
## Gates ...（无关任务正文，原样保留）
2026-10-20T06:27:52Z anchor: kind=quality loop returned code=0 after 498224423ms
2026-10-20T06:27:52Z anchor: kind=quality loop stopped
restart-aborted: kind=quality — stop 未确认旧进程树已退出（exit=1）；⛔ 不起新循环（否则与旧 loop 双派发）。...
```

② `.quay/anchor-desired.json`（restart 后）：`kinds:["promotion","outer","worker","quality"]`，`updatedBy:"quay-driver-restart-aborted"`，`updatedAt:"2026-10-20T06:27:56Z"`。

③ `.quay/anchor.log` 关键行：
```
39303 2026-10-20T06:27:52Z anchor: kind=quality loop returned code=0 after 498224423ms
39304 2026-10-20T06:27:52Z anchor: kind=quality loop stopped
39305 2026-10-20T06:28:08Z anchor: kind=quality loop started (pid=1376399)
39306 quality-gate-driver: arch-discovery 例程已装配（enabled:false ...）
39310 quality-gate-driver: architecture-review 例程已装配（enabled:false ...）
```
`loop stopped` 与 `loop started` 只差 16 秒，而 CLI 在 60s 停等窗口里仍报 stop-failed；`updatedBy: quay-driver-restart-aborted` 是 CLI 超时后写回的期望态，不是「没重起」的证据。anchor.json 同期 `pid=1376399`、`takeover:null`——loop 与 anchor 同 pid（loop 在 anchor 进程内跑）。

④ `.quay/quality-round.jsonl` round 1–4：
```
{"ts":"2026-10-20T06:28:08.703Z","round":1,"facts":[
 {"name":"architecture-review","state":"not-evaluated","reason":"not-evaluated:disabled — loop.architecture_review.enabled=false","value":null},
 {"name":"arch-discovery","state":"not-evaluated","reason":"disabled: ... enabled:false","value":{...enabled:false}}]}
{"ts":"2026-10-20T06:28:54.082Z","round":2,"facts":[]}
{"ts":"2026-10-20T06:29:40.250Z","round":3,"facts":[]}
{"ts":"2026-10-20T06:30:26.581Z","round":4,"facts":[]}
```
round 1 的新配置 disabled facts + round 2–4 空 facts 心跳轮 ⇒ loop 已用新配置持续运行，不是只起了一轮。

**结论口径。** `restoreDesiredOnFailure` 把 quality 放回 desired 后，anchor 在 16 秒内重新拉起 loop，新配置生效；CLI 的 stop 确认判据（`aliveness().running` 变 false）滞后，导致「报告的结局（restart-aborted）与真实结局（已重起并持续运行）相反」。修法就是任务 ①/②/③ 三条。

## Plan

修法方向（三选一或组合）：
1. anchor-hosted kind 的 restart 以「新 loop 的 readiness marker / round generation +1」作为成功判据，而不是旧 aliveness；
2. 输出区分 `restarted-loop (process unchanged)` 与 `restart-aborted`，并带 before/after loop generation 或 round ts；
3. 换 kernel 场景明确提示 per-kind restart 不换 anchor 进程（需 takeoverPid），不要用同一句 restart 表达两件事。

复现基线已贴于 Proposal「复现材料」（2026-10-20 实测）。fix 作者落地时对改前源码复跑同一夹具/宿主仍复现，再按 ①/②/③ 三选一或组合实施，并把全量复现作为 AC 证据贴出。

## Acceptance Criteria

- [x] AC1 复现（基线已贴于 Proposal「复现材料」）：fix 作者对改前源码复跑 anchor-hosted 夹具（或真实宿主）`restart --kind quality`，仍复现 stop-failed + restart-aborted 且 loop 实际已用新配置重起（round generation +1、`driver start` 报 already-running）；贴命令输出全文 + anchor.log + before/after round 证据。 — **复现成立（改前源码 = develop `6fa8fd240`，主检出那份 kernel；夹具：真 anchor 承载 quality + promotion，fake quality driver 收到停机请求后再延迟 2500ms 才收尾，`stopTimeoutMs=800`）。** 读数：`restartKind exit=1 elapsed_ms=1026`；stderr `restart-aborted: kind=quality — stop 未确认旧进程树已退出（exit=1）；⛔ 不起新循环（否则与旧 loop 双派发）…`；`stop-failed: kind=quality — 该 kind 的循环在 800ms 内未收尾（anchor pid=120036）…期望态：已把 quality 放回…`。anchor.log：`07:00:19 loop started (pid=120036)` → `07:00:22 loop stopped` → `07:00:23 loop started (pid=120036)`（**同 pid**）；generation before `{"started":1,"stopped":0}` → after `{"started":2,"stopped":1}`；随后 `start --kind quality` = `already-running: host=anchor anchor pid=120036`；`quality-round.jsonl` 中 `round=1` 行数 = 2（新一代码次）、distinct pids = `120036`。⇒ CLI 说「没重起」，而 loop 实际已重起并持续（与第三方 2026-10-20 现场同形）。
- [x] AC2 修复后同一夹具：CLI 报告真实结局——loop 已重起时报 restarted-loop（附 before/after generation），绝不把「已重起」报成 restart-aborted；贴全文。 — **同一夹具、同一命令，改后（worktree `c5a03cb62`）**：`restartKind exit=0 elapsed_ms=3763`；stdout 全文 `restarted-loop: kind=quality — process unchanged (anchor pid=142766); loop generation 1 -> 2（旧循环在 stop 窗口内未收尾，窗口用尽后由期望态恢复拉起新一代）`；stderr 空。直接量：anchor.log `07:00:33 loop started (pid=142766)` → `07:00:37 loop stopped` → `07:00:37 loop started (pid=142766)`（同 pid）；generation `1 -> 2`；随后 `start --kind quality` = `already-running`；`round=1` 行数 = 2、同一 pid。⛔ 全程未出现 `restart-aborted`。对应测试 `AC2 — anchor 承载 kind 的 stop 窗口用尽后…` 绿。
- [x] AC3 位置判定（双向负控制）：改后 driver-runtime.ts 中 anchor-hosted restart 的成功判据不再只依赖旧 `aliveness(root,kind).running`（grep 命中新判据，或旧判据调用点清零）；负控制用同一谓词对改前 develop 副本命中旧判据（证明谓词可判，非恒零）。 — `stopKindViaAnchor` 的等待判据改为 `readAnchorLoopDelta(root, kind, lifecycleStart)`（新判据 `readAnchorLoopLifecycle` / `readAnchorLoopEventsSince` / `readAnchorLoopDelta` / `anchorLoopStoppedSince`）；旧等待行 `if (!aliveness(root, kind).running) break;` 在改后源码中**零命中**，`anchorLoopStoppedSince` 仍在导出面。测试 `AC3 — 位置判定…` 绿：同一谓词 `waitsOnlyOnOldAliveness` 对**改前原文**（`PRE_FIX_STOP_WAIT`，逐字抄自 develop 的 stop 等待循环）命中 = `true`（负控制，证明可判、非恒零），对改后源码命中 = `false`；并断言新判据真的接在 `loopStopped()` 上（⛔ 不是定义了没用）。
- [x] AC4 CLI 表层（枚举，非布尔）：输出词表区分 `restarted-loop`（process unchanged）与 `restart-aborted` 两态，且带 before/after loop generation 或 round ts；grep 命中新词表，并对「已知为真」样本干跑非零。 — kernel 输出面：`restarted-loop: kind=<k> — process unchanged (anchor pid=<p>); loop generation <before> -> <after>` 与 `restart-aborted: kind=<k> …`；CLI 帮助（`packages/quay/src/cli/driver.ts`，`quay driver --help`）同步列出两态与判据来源。测试 `AC4 — 输出词表…` 绿：`outcomeOf()` 对已知为真样本 `restarted-loop: … generation 1 -> 2` 与 `restart-aborted: …` 各返回非 `null`（非零），对 `stopped` / `started: …` 返回 `null`（⛔ 不与结局同形），并断言 before < after。AC2 的真实输出即 `^restarted-loop: kind=quality … process unchanged … loop generation 1 -> 2`。
- [x] AC5 双向负控制：真正未重起的场景（stop 确实失败且无新 loop 被拉起）仍如实报 restart-aborted，不因新判据误报成功。 — 真 anchor + `FAKE_IGNORE_STOP=1`（循环永不响应停机）：`restartKind exit=1 elapsed_ms=2760`，stderr `restart-aborted: kind=quality — stop 未确认旧进程树已退出（exit=1）…`，stdout 无 `restarted-loop`；generation `{"started":1,"stopped":0}` → `{"started":1,"stopped":0}`（不变）。测试 `AC5 — 双向负控制…` 绿。判据级负控制（AC1 测试内）：增量里只有 `returned`（anchor 仍可 respawn）时 `anchorLoopStoppedSince` 报 `running`（⛔ 不把 returned 当已停）；日志缺失/读不懂 ⇒ `not-evaluated` ⇒ 回退旧判据，不折成「已停止」。
- [x] AC6 `scripts/test.sh --for-task gap-anchor-hosted-restart-false-negative-stop-confirm-lag-restore-respawns` 绿。 — `bash scripts/test.sh --for-task gap-anchor-hosted-restart-false-negative-stop-confirm-lag-restore-respawns --allow-thin` → **exit 0**。选中 `plugin/test/driver-runtime-s10.test.mjs` **10/10 pass**（含新增 AC1–AC5 五条：事故形状对比、restarted-loop 端到端、位置判定、输出词表、restart-aborted 负控制）；scoped static checks 全 PASS（含 task-contract / touches-one-entry / import-graph / enum-surface-parity 等，另一段 `ℹ tests 100 / pass 100 / fail 0`）。⚠️ 选择器报 `test-selection-thin: 1/4 Touches (0.25 < 0.5)`，故按 driver 的同一命令加 `--allow-thin`。

## Definition of Done

在真实 anchor-hosted 宿主（或等价夹具）上，`quay driver restart --kind quality` 的 CLI 输出与真实结局一致：loop 已重起 ⇒ 报 restarted-loop 并附 before/after generation；loop 未重起 ⇒ 报 restart-aborted。AC1-AC6 勾齐并贴证据；完整复现材料（①命令输出全文 / ②anchor-desired.json / ③anchor.log / ④quality-round facts）已在正文。

## Touches

- plugin/scripts/driver-runtime.ts
- packages/quay/src/cli/driver.ts
- plugin/test/driver-runtime-s10.test.mjs
- tasks/gap-anchor-hosted-restart-false-negative-stop-confirm-lag-restore-respawns.md
