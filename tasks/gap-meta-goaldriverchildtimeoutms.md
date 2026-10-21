---
id: gap-meta-goaldriverchildtimeoutms
title: Goal-gate child is SIGKILLed at its outer bound before writing a verdict
  — AC-911 has been unmeasured for 13 rounds
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
`goal-store gate AC-911` is killed at the driver's derived 75000ms bound (60s inner + 15s grace) on 13 consecutive rounds, so a one-line `grep | wc -l` criterion has never produced pass or fail; the instrument, not the criterion's truth, is the failure — and nothing escalates a standing AC whose verdict stays `not-evaluated`.

本轮读数（criteria.AC-911.verdict）= `"not-evaluated"`，采于 2026-10-21T04:08:39Z，由 meta-driver 机械采集。
⚠️ 机制词 `goalDriverChildTimeoutMs` 命中【已完成】任务：gap-cross-project-replay-verify-goal-timeout-and-anti-drift-fixes-on-claudecodeui-and-quay-fleet.md[done]、gap-goal-driver-hardcoded-120s-spawn-kill-preempts-record-timeout-and-orphans-goal-locks.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

### 修复轮补记（2026-10-21，worker 实测）
机械证据只有「值 = `not-evaluated`」这一项——它由 `renderAutoDriveBody` 从 `resolveEvidence(readings, "criteria.AC-911.verdict")` 机械渲染，**不是** probe 的自述。probe 在 Finding 里补写的三句实测**不被账本支持**：
- **「从未产生 pass 或 fail」不成立**：生产账本 `.quay/gate-events.jsonl` 中 AC-911 在立案轮（2026-10-21T04:14:54Z）之前已有 **21 条 definitive `fail`** 事件（到 05:00Z 共 30 条 `fail`），此后 2 条 `pass`（05:18:58.061Z / .343Z，sibling task `gap-ac911-src-root-forwarding-shim-deletion` 落地后判据转绿）。
- **「13」不是「13 轮未测」**：它是 `goal:AC-911:verdict` 的 `unchanged` streak 计数，取自 **goal-round 载体**，而那 13 轮取值都是 `fail`。派生信号当时不带取值 ⇒ 「连续失败」与「连续未测」在读数上同形，probe 读成了后者。
- **真正成立的事实**：meta-driver 自己那一轮的读数是 `not-evaluated`，而它 (a) 不带 `cause`（无法归因是外层上限杀、用法错、还是读不懂输出），(b) `computeDivergences` 里穿透所有分支、**产出 0 条偏离**（没有任何处理者被告知），(c) 派生 streak 不携带取值。修的是这条**读/升级链**（见 DoD 第 2 条），⛔ 未新建任何并行上限机制。

## AC
- [x] `node -e 'const fs=require("fs");const p=".quay/gate-events.jsonl";if(!fs.existsSync(p)){console.error("no gate ledger");process.exit(1)}const rows=fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean).filter(e=>e&&e.item_id==="AC-911");if(rows.length===0){console.error("no AC-911 gate event — the child never reached appendGateEvent");process.exit(1)}const v=rows[rows.length-1].verdict;if(v!=="pass"&&v!=="fail"){console.error("last AC-911 verdict is "+v);process.exit(1)}console.log("definitive verdict: "+v)'` ⇒ A definitive (pass or fail) gate event for AC-911 exists in the production ledger. Today it exits 1 with 'no AC-911 gate event', because the child is SIGKILLed at the driver's bound before it ever appends one; after the repair the same command exits 0 carrying the real verdict.
  - 实跑（主检出 `/data/home/yale/work/quay`，2026-10-21T13:2xZ）：`definitive verdict: pass`，exit 0。账本末条 AC-911 事件 = `{"verdict":"pass","timestamp":"2026-10-21T05:18:58.343Z","payload.reason":"acceptance passed (exit 0)"}`。
  - 能取假（同一 predicate，在 /tmp 空工作区里跑三次）：无 AC-911 事件 ⇒ `no AC-911 gate event — the child never reached appendGateEvent` / exit 1；账本末条 verdict=`not-evaluated` ⇒ `last AC-911 verdict is not-evaluated` / exit 1；无账本 ⇒ `no gate ledger` / exit 1。

## DoD
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
  - 判据实跑与三条负控制见 AC。
  - 实现侧取假控制（本轮实做，跑完即恢复）：删掉 `computeDivergences` 的 `not-evaluated` 分支 ⇒ `✖ computeDivergences: verdict=not-evaluated ⇒ 独立 kind "not-evaluated"`（pass 140 / fail 1）；把 `TimeSeriesSignal.value` 改成恒 `null` ⇒ `✖ gap-meta-goaldriverchildtimeoutms AC: unchanged 信号的 value 能把「未评估」与「稳定失败」分开`（pass 139 / fail 2）。恢复后 `node --test plugin/test/meta-driver.test.mjs` = **142 pass / 0 fail**，`git status` 干净。
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制
  - 结论：外层上限派生（`goalDriverChildTimeoutMs` = inner + grace，`packages/quay/src/core/goal-store.ts`）已由前序任务落地且正确 ⇒ **不动它、不新建任何并行上限**。
  - 缺口在读数/升级侧，本轮扩展既有的两条链（⛔ 不是新机制）：① `not-evaluated` 成为独立 `DivergenceKind`（`DIVERGENCE_HANDLER_KIND` = `none` ⇒ `handler.state=absent` ⇒ probe 规格要求 escalate）——此前它穿透所有分支、产出 0 条偏离；② `CriterionReading.cause`（spawn / usage / unreadable / 存储侧 timeout、capability、declared）指名「为何测不了」，并进 `readingsDigest`（稳定量，不 churn）；③ `TimeSeriesSignal.value` 携带 `unchanged` streak 的被重复取值 ⇒ `unchanged:13` 不再在「连续失败」与「连续未测」之间歧义。
  - `plugin/probes/meta-driver.md` 同步登记第四类 kind、`cause` 字段与 handler=none 的裁定理由（probe 的契约不更新就会与代码漂移）。
  - `packages/quay/src/core/goal-store.ts` / `packages/quay/test/goal-store.test.mjs` **未改动**：`## Touches` 是白名单不是必改清单；child 侧派生上限本身无需修复，改它才是新造并行机制。
  - 顺带发现（未在本任务处置，留作观察）：`packages/quay-native/src/store.ts` 的 `check()` 用 `["AC","Acceptance Criteria"]` / `["DoD","Definition of Done"]` 读段，不认 finding 形状的 `## AC（draft）` 变体（`kernel/shape-sections.ts` 的 author→ready 判据认）⇒ 本任务体按既有先例把标题规范成 `## AC` / `## DoD`。若该不对称仍需修，应另立任务，不塞进本条。

## Touches
- `packages/quay/src/core/goal-store.ts`
- `plugin/scripts/meta-driver.ts`
- `plugin/probes/meta-driver.md`
- `packages/quay/test/goal-store.test.mjs`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-goaldriverchildtimeoutms.md`