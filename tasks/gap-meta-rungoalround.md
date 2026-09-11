---
id: gap-meta-rungoalround
title: goal 机械环把 long-term AC 纳入复验域【读数】却从不重跑它们——gate 作用域补上 inScope（AC-161
  台账尾冻结在裸 fail ⇒ AC-241 恒红）
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
runGoalRound pass 1 只对 active GOAL 的 AC 跑 criterion（`for (const goal of activeGoals)`），而 AC-216 已把 `long-term: true` 的 achieved AC（其 GOAL 已 achieved）纳入 I5 `checkAchievedFailing.inScope` ⇒ 该域被读出但从不执行，AC-161/188/189/190 的台账尾分别冻结在 2026-09-08/2026-09-07；AC-161 的尾是裸 fail，使 AC-241 结构上不可满足。AC-216（gap-goal-standing-ac-reverify-scope）与 AC-242（gap-goal-closure-freezes-failing-ac-outside-reverify-scope）两个 done 任务只放宽了读数侧与关闭侧，未动执行侧——故这是同一机制上的欠修，不是新机制。

本轮读数（criteria.AC-241.reason）= `"acceptance failed (exit 1) — unattributable failing goal AC(s): AC-161: acceptance failed (exit 1)"`，采于 2026-09-11T13:14:49Z，由 meta-driver 机械采集。
⚠️ 机制词 `runGoalRound` 命中【已完成】任务：gap-goal-driver-ac-activation-gated-on-traction-not-goal-semantics.md[done]、gap-goal-driver-draft-ac-triage.md[done]、gap-goal-sufficiency-gate.md[done]、gap-goal-sufficiency-not-evaluated.md[done]、gap-goal-triage-activate-executed.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node --no-warnings --experimental-strip-types -e 'const drv = await import("./plugin/scripts/goal-driver.ts"); const r = await drv.runGoalRound(process.cwd(), { spawnCap: 0, sufficiencyCmd: [], resourceGateArgv: ["true"] }); const v = r.fact.value; const af = v.achievedFailing; if (!af || !af.evaluated || !Array.isArray(af.inScope) || af.inScope.length === 0) { console.error("NOT-EVALUATED: achievedFailing.inScope unavailable or empty"); process.exit(3); } if (!Array.isArray(v.criteria)) { console.error("NOT-EVALUATED: round criteria reading missing"); process.exit(3); } const gated = new Set(v.criteria.map((c) => c.id)); const missed = af.inScope.filter((id) => !gated.has(id)); if (missed.length) { console.error("in re-verify scope but never gated in the same round: " + missed.join(",")); process.exit(1); } console.log("ok: all " + af.inScope.length + " in-scope AC(s) gated this round"); process.exit(0);'` ⇒ exit 0 = 同一轮里 runGoalRound 真的跑过 inScope 的每一条 AC（判据读本轮 fact 的 criteria 与实际 gate 集合，⛔ 不读源码行形）；现为红（AC-161/188/189/190 在 inScope 却不在 criteria），修好后转绿；exit 3 专表读数不可得，与「通过」不同形。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-standing-ac-reverify-scope.test.mjs`
- `tasks/gap-meta-rungoalround.md`