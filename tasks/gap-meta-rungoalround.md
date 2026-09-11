---
id: gap-meta-rungoalround
title: goal 机械环把 long-term AC 纳入复验域【读数】却从不重跑它们——gate 作用域补上 inScope（AC-161
  台账尾冻结在裸 fail ⇒ AC-241 恒红）
status: done
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
- [x] `node --no-warnings --experimental-strip-types -e 'const drv = await import("./plugin/scripts/goal-driver.ts"); const r = await drv.runGoalRound(process.cwd(), { spawnCap: 0, sufficiencyCmd: [], resourceGateArgv: ["true"] }); const v = r.fact.value; const af = v.achievedFailing; if (!af || !af.evaluated || !Array.isArray(af.inScope) || af.inScope.length === 0) { console.error("NOT-EVALUATED: achievedFailing.inScope unavailable or empty"); process.exit(3); } if (!Array.isArray(v.criteria)) { console.error("NOT-EVALUATED: round criteria reading missing"); process.exit(3); } const gated = new Set(v.criteria.map((c) => c.id)); const missed = af.inScope.filter((id) => !gated.has(id)); if (missed.length) { console.error("in re-verify scope but never gated in the same round: " + missed.join(",")); process.exit(1); } console.log("ok: all " + af.inScope.length + " in-scope AC(s) gated this round"); process.exit(0);'` ⇒ exit 0 = 同一轮里 runGoalRound 真的跑过 inScope 的每一条 AC（判据读本轮 fact 的 criteria 与实际 gate 集合，⛔ 不读源码行形）；现为红（AC-161/188/189/190 在 inScope 却不在 criteria），修好后转绿；exit 3 专表读数不可得，与「通过」不同形。

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Evidence

**结论：本任务立案的缺陷已由并行任务 `gap-meta-computegoalgaps`（done）在立案读数之后落地修复 ⇒ 本轮是核验，⛔ 未改动任何代码（worktree `git diff` 为空、`git status` 干净）。**

- **同一缺陷两个任务，不是两处欠修**：`gap-meta-computegoalgaps` 的 Finding/AC/DoD 与本任务逐字同源（同为「AC-216 复验域只被 I5 读、从不被执行」）；其读数采于 `2026-09-11T12:54:24Z`、本任务采于 `13:14:49Z`；修复提交 `cc4f2f9dd`（`goal-driver: wire the AC-216 reverify scope into the per-round gate set and the gap-filing set`）提交于 `13:16:33Z`、合入 develop `13:27:45Z`、翻 done `13:48:24Z`。⇒ 本任务立案那一刻缺陷**确实**在（Finding 无误），它只是撞上了一个在飞、2 分钟后落地的并行任务。
- **判据实跑（本任务 AC 原样，⛔ 未改一字）**：`exit 0`，打印 `ok: all 19 in-scope AC(s) gated this round`。
- **取假控制（DoD① 后半；实测后已还原）**：把 pass 1b 的实现改坏（`standingReverifyAcs` 恒返回 `[]`）⇒ 同一判据 `exit 1`，逐字点名 `missed: AC-161,AC-188,AC-189,AC-190`——**恰为 Finding 里那 4 条**；同时持久钉 `plugin/test/goal-driver.test.mjs` 的 AC-216 两条转红（`✖ 域内 achieved AC 逐轮进 criteria…`、`✖ done 的关联任务⛔ 不覆盖常设不变式的回归`）。还原后 worktree 干净。
- **生产载体（硬规则 4 推论三：⛔ 非 fixture）**：`.quay/gate-events.jsonl` 里 AC-161/188/189/190 的台账尾原分别冻结在 `2026-09-08`/`2026-09-07`；实测四条尾均为 `2026-09-11T13:58:3xZ`，且 AC-161 的 reason 已携带判据自己写出的成因 `acceptance failed (exit 1) — CAUSE=user-enabled-plugins — user-level enabledPlugins still enables quay plugin(s): quay@quay`（冻结期那条是**裸 fail、无成因**）。AC-241 尾 = `verdict=pass` ⇒「AC-241 恒红」这一后果在载体上已消失。
- **闭环的执行侧也在跑**：AC-161 `standing-violated` ⇒ 已产出一条在飞任务 `gap-ac161-user-scope-enable-repolluted-by-cli-materialization`（`13:53:36Z` 晋升 ready）——即 `cc4f2f9dd` 的第二条线（缺口立案侧）在生产上确有执行者，不是只接了一半。
- **5b 枚举（修一处 ≠ 只有一处）**：复验域的消费点只有两处机械面（gate 集合 `goal-driver.ts:1382`、缺口立案集合 `goal-driver.ts:863`）＋ Core 的 I5（`goal-store.ts:633`），三者读**同一个** `inAchievedReverifyScope`；`goal-driver.ts:1461` 的分诊遍历 active GOAL 名下的 **draft** AC，与「achieved AC 复验域」不相交 ⇒ 无同族漏接点。Touches 点名的 `plugin/test/goal-standing-ac-reverify-scope.test.mjs` 未改：它测的是**枚举侧**，执行侧的持久钉已在 `plugin/test/goal-driver.test.mjs`，再写一份是重复覆盖（DoD② 的同一条纪律）。
- **DoD②**：结论是「已有机制在管」⇒ 修的是那个既有机制，本轮 ⛔ 未新建并行机制、⛔ 未新建并行读数载体、⛔ 未改判据口径。
- **过程读数（非本任务结论，供 manager）**：ABI 的 `task_check`（native gate）把本任务的 `## AC（draft）`/`## DoD（draft）` 读成 `0/0 AC checkboxes checked`（`packages/quay-native/src/store.ts:1745` 的 `sectionAfterHeading(body, ["AC","Acceptance Criteria"])` 不认 draft 变体，而 `plugin/scripts/shape-sections.ts:40` 认）⇒ 它的 `ok:false` 是「读不到段」而非「未勾」，两者同形（硬规则 3 上半条）。fan-in 的 ac-precheck（`fan-in-ac-completion-gate.ts`）认 draft 变体：勾选前实测 `checked 0 / total 3`（= 1 条 AC + 2 条 DoD），故落地不受影响。

## Touches
- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-standing-ac-reverify-scope.test.mjs`
- `tasks/gap-meta-rungoalround.md`