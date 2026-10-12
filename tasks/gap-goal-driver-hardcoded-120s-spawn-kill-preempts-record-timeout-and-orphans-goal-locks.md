---
id: gap-goal-driver-hardcoded-120s-spawn-kill-preempts-record-timeout-and-orphans-goal-locks
title: "cross-project: goal-driver/meta-driver hard-coded 120s SIGKILL pre-empts
  record timeoutMs on gate + activation (which also ignores record timeoutMs)
  and orphans goals/<id>.lock that blocks fan-in ff — 104 kills in 4 projects"
status: ready
labels:
  - gap
  - defect
  - cross-project-dogfood
parent: null
children: []
extra: {}
---
## Proposal
**Cross-project Quay Finding (semantic dogfooding, 2026-10-13; first cross-project finding of the open semantic discovery effort; report → task, no Goal).**

`plugin/scripts/goal-driver.ts:107` (and `meta-driver.ts:87`) wrap EVERY goal-store child spawn in a hard-coded `CRITERION_TIMEOUT_MS = 120_000` SIGKILL. The comment says these are "全部是快速机械 node 调用". That is false. Two of the wrapped spawns run arbitrarily slow user work whose deadline Quay itself declares to be configurable:
1. **`goal gate <id>`** (`goal-driver.ts:291`) runs the criterion under the RECORD's `timeoutMs`. That is the highest-priority knob, delivered by `gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout` and `gap-goal-gate-verdict-single-mapping-not-evaluated`. Any record `timeoutMs ≥ 120000` is pre-empted by the outer SIGKILL and recorded as the opaque `gate spawn error: spawn timeout after 120000ms (SIGKILL)` instead of the gate's own verdict.
2. **`goal write <id> --status active`** (`goal-driver.ts:332`, triage activation) runs the P6 activation gate. It runs the criterion (`goal-store.ts:~2890`) with `resolveAcceptanceTimeoutMs()`, which IGNORES the record's `timeoutMs` (env/default only; this is a second inconsistency with the gate path at `goal-store.ts:~3714`), plus an LLM fidelity judge (`--fidelity-judge-argv`). All of it runs inside `withFileLock(goalDir, id, …)` (`goal-store.ts:~2588`), under the same 120 s outer kill.

**Consequence chain (each link observed in production, not inferred):**
- Slow-but-legal criteria are never evaluated by the driver, and slow activations never complete.
- A SIGKILL inside `withFileLock` orphans `goals/<id>.lock` (`frontmatter-store-base.ts:147-173`; stale removal only happens on the NEXT write of the same id, which is killed again, so the lock is re-orphaned every round).
- The orphan lock is an untracked file in the main checkout. `fan-in/ff-merge.ts` `cleanTreeCheck` refuses every fan-in fast-forward on it (`plugin/scripts/quay-runtime-artifacts.txt` has no lockfile pattern).

**Evidence (read 2026-10-13; counts are grep hits on `<project>/.quay/goal-round.jsonl`, samples printed before counting):**

| project | `gate spawn error … 120000ms` | `write spawn error … 120000ms` | span |
|---|---|---|---|
| quay | 41 | 10 | 2026-09-10 → 10-10 |
| claudecodeui | 13 | 28 (AC-322 ×13, AC-317 ×5, …) | 2026-09-21 → 10-12 |
| cantus | 0 | 5 (AC-015, AC-020, …) | 2026-10-05 |
| quay-fleet | 0 | 7 (AC-031, AC-038, …) | 2026-10-12 |

That is **4 independent host projects, 104 SIGKILLs**.
- **Lock link, timestamped:** claudecodeui's quarantined `goals/AC-322.lock` (in `/data/home/yale/work/claudecodeui-main-checkout-residue-quarantine-20261010T0244Z/goals/`) has mtime `2026-10-10T02:40:43Z` and contains pid `597894`. goal-round 2898 at `02:44:52Z` records `AC-322 to:active ok:false write spawn error: spawn timeout after 120000ms (SIGKILL)`. claudecodeui fan-in logs show ≥5 `step:ff` "working tree not clean" refusals listing `?? goals/AC-322.lock` (2026-10-09T08:04Z → 10-10T06:19Z). Host commit `ecff2f90` records "no task able to land for ~3h, six ready tasks stuck". The other untracked files in those refusals were host screenshots (host hygiene, not claimed here).
- **User/host adaptation cost:** claudecodeui filed ~20 host tasks against this one mechanism (e.g. `gap-ac317-criterion-killed-by-its-own-budget`, `gap-ac323-gate-deadline-below-criterion-serial-time`, `gap-ac345-gate-deadline-below-criterion-wallclock`). Every declared host `timeoutMs` is squeezed under the clamp (100000 ×1, 115000 ×8, 118000 ×2). `gap-ac345`'s own text: "驱动侧 `CRITERION_TIMEOUT_MS = 12e4` 是不可配置的字面量硬闸 … 必须 < 120000".
- **Misleading surface:** `quay goal gate --help` (`cli/help.ts:~463-470`) lists only `--timeout > QUAY_ACCEPTANCE_TIMEOUT_MS > 60000`. It omits the record `timeoutMs`, which is the highest priority, and it still says a timeout is "recorded as a fail", whereas it is now `not-evaluated`.

**Host cause excluded:** the four hosts use different stacks and criteria. The clamp is one literal in Quay source, identical in installed 0.11/0.15/0.19 and in develop 0.20.0-dev. The host criteria are legal under Quay's own documented record knob, yet that knob cannot take effect. Slow host criteria are the trigger, not the defect.

**Dedup:** no open task names `CRITERION_TIMEOUT_MS` or the driver-side clamp. `gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout` (done) fixed the goal-store 60 s literals only. Its AC was verified through the CLI `quay goal gate` with a 70 s criterion, which is below the 120 s outer clamp and never passes through the driver. So the driver path, which is the production consumer, was never measured. This is an unfixed sibling (hard rule 5b) and a case of hard rule 4c (the measured quantity did not cross the driver layer).

**Discovery-Method note (for the follow-on Experience ingest, not written here):** the finding came from cross-project triangulation of a single error string across host `.quay/goal-round.jsonl` carriers, then a timestamp join between an orphan artifact (lock mtime and pid) and a carrier record. The reusable meta-method: when a fix's AC was verified on a surface that is not the production consumer, grep the production consumer's carriers across ALL host projects for the old failure string.

## Plan
1. **The outer deadline is derived, never a literal below the inner one.** For `gate` and for the activation `write`, the driver's spawn timeout must exceed the inner resolved deadline. Resolve the record's effective deadline: record `timeoutMs` > env > default. For an activation, add the fidelity-judge bound. The outer timeout is that value plus a grace. Keep the 120 s bound only for the genuinely mechanical spawns (`list`, `check --staleness`, …). Do the same in `meta-driver.ts`. Expose the derivation as one exported pure function so a unit test can pin "outer > inner" for every path.
2. **The activation gate honours the record's `timeoutMs`** (`goal-store.ts` P6 site): use `resolveAcceptanceTimeout(rec.timeoutMs)` exactly as `goal gate` does, so the two paths share one precedence.
3. **Lock hygiene on a driver kill:**
   - (a) prefer SIGTERM, then a grace, then SIGKILL for goal-store children, and have goal-store release its lock on SIGTERM;
   - (b) when the driver did kill a child, remove `<goalDir>/<id>.lock` only if its content equals the killed child's pid;
   - (c) add the store lockfile pattern (`goals/*.lock`, and the same for any other frontmatter-store dir) to `plugin/scripts/quay-runtime-artifacts.txt`, so a leftover lock can never block fan-in ff.
4. **Help text:** `goal gate` help lists the record `timeoutMs` as the top of the precedence chain and says a timeout is `not-evaluated`. The `acceptance-runner` timeout reason no longer points goal criteria at `gates.yml timeoutMs`.

## Acceptance Criteria
- [x] AC1 (derivation): unit test on the exported derivation function. For inner deadlines {60000, 150000, 600000}, the gate and activation outer timeouts are strictly greater than inner. Negative control: restore `timeoutMs: CRITERION_TIMEOUT_MS` at `goal-driver.ts` gate site ⇒ the test goes red (paste both outputs).
  - Derivation lives ONCE in `packages/quay/src/goal-store.ts` as `goalDriverChildTimeoutMs(recordTimeoutMs, kind, env)` (kind `gate` → inner+grace; `activation` → inner+`FIDELITY_JUDGE_TIMEOUT_MS`+grace), surfaced to both drivers through Layer 0 (`plugin/scripts/driver-runtime.ts`). Readings: `goalDriverChildTimeoutMs(150000,'gate')=165000`, `goalDriverChildTimeoutMs(150000,'activation')=345000` (150000+180000+15000).
  - Green (post-merge, ran inside the scoped gate too): `✔ AC1: goalDriverChildTimeoutMs 对每个 inner 都严格大于 inner（gate 与 activation 两条路径） (0.251084ms)` and `✔ AC1 负控制: gate/activation 站点绑定派生值，⛔ 不保留 120s 字面量（改回 ⇒ 本测试红） (1.462587ms)`.
  - Negative-control reading (gate site temporarily reverted to `timeoutMs: CRITERION_TIMEOUT_MS`, then restored — `git status` clean afterwards): `✖ AC1 负控制: gate/activation 站点绑定派生值，⛔ 不保留 120s 字面量（改回 ⇒ 本测试红） / AssertionError [ERR_ASSERTION]: gateCriterion 必须从派生函数取外层上限 / expected: /goalDriverChildTimeoutMs\(/`.
- [x] AC2 (driver path, real spawn): a fixture workspace goal record with `timeoutMs: 150000` and criterion `sleep 125; exit 0`, run through the goal-driver's gate function (not the CLI), yields `verdict:"pass"`, not `gate spawn error`. Paste the wall time and verdict. (May be a `@test-group serial` test or a recorded manual run; either way paste the reading.)
  - Recorded manual run through `gateCriterion(repoRoot, 'AC-001', tmp, { recordTimeoutMs: 150000 })` (fixture `goals/AC-001` = `criterion: sleep 125; exit 0`, `timeoutMs: 150000`): `FIXED wall_ms=125203 verdict=pass cause=null reason=acceptance passed (exit 0)`.
  - Same record against the OLD bound (the gate site's exact `timeoutMs: 120_000` literal): `OLD wall_ms=120035 error=spawn timeout after 120000ms (SIGKILL): …/node status=null` — i.e. the production failure string this task exists to remove.
- [x] AC3 (activation precedence): record `timeoutMs: 5000`, criterion `sleep 2; exit 0`, `QUAY_ACCEPTANCE_TIMEOUT_MS=1000` ⇒ `goal write <id> --status active` succeeds (record wins). Without the record field it is refused as not-evaluated(timeout). Paste both.
  - `packages/quay/test/goal-store.test.mjs`: `✔ AC3: 激活的 criterion deadline 认 record 的 timeoutMs（record > env）；无 record 字段 ⇒ env 生效并判 not-evaluated (3236.175625ms)`. Positive: AC-001 (`timeoutMs: 5000`, criterion `sleep 2`) activates **exit 0** although the env is only 1000 (the record is the top of the chain). Negative control: AC-002 (same `sleep 2`, NO record field) is refused with `cannot activate AC-002: criterion not-evaluated (acceptance timed out after 1000ms (killed) — …)`, status stays `draft`.
  - ⚠️ This required one deliberate semantic tightening at the P6 site: a TIMEOUT used to be ALLOWED at activation ("a timeout is a definitive fail ⇒ evaluable"). Under the record-aware deadline that reasoning is dead (a timeout is `not-evaluated`, not a fail), and letting it through ACTIVATES a criterion that then re-runs and times out every round forever — the exact pathology of the parent finding. The gate now refuses when `code === null || timedOut`; `--force` still overrides. fail / exit-3 / exit-126 cases are unchanged (they keep their exit codes).
  - ⚠️ SAME-ROUND CONSEQUENCE (2026-10-13): `packages/quay/test/goal-criterion-timeout-resolution.test.mjs` AC6(c) pinned that old allowance VERBATIM (`a timeout is a definitive verdict ⇒ evaluable ⇒ activation allowed`) and therefore went red on the untouched tree; it is re-anchored to the new semantics and DECLARED in Touches. Its killed arm now reads the refusal — `assert.notEqual(status, 0)` + `cannot activate AC-905: criterion not-evaluated (acceptance timed out after 1000ms …)`, a reading a literal 60 s bound structurally cannot produce — and its elapsed arm moved onto the record rung (`AC-906`, record `timeoutMs: 5000` outranking the 1000 ms env ⇒ `pass`, elapsed ≥1900 ms). Negative control (P6 site reverted to `resolveAcceptanceTimeoutMs()`): `✖ AC6(c) — 激活检查走同一解析来源：解析后的界（而非字面 60s）决定激活是否被接受`, red at the AC-906 arm; restored ⇒ `✔` green, `git status` clean.
- [x] AC4 (lock): kill a goal-store `write` child while it holds `withFileLock` through the driver's spawn path ⇒ no `goals/<id>.lock` remains. Separately, `ff-merge` `cleanTreeCheck` on a tree whose only untracked file is `goals/AC-001.lock` returns clean. Negative control for each (paste).
  - `plugin/test/goal-driver-s01.test.mjs`: `✔ AC4: 驱动杀掉持锁的 activate 子进程 ⇒ 孤儿 goals/<id>.lock 被按 pid 清除；pid 不匹配不删 (3511.164069ms)`. End-to-end (real spawn path): a draft AC whose criterion is `sleep 5` is activated with a short outer bound ⇒ the child is SIGTERM→SIGKILL'd while holding the lock (the test first asserts it really HELD it — `前置：子进程必须真的持有过 goals/AC-001.lock`), `write spawn error: spawn timeout` is returned, and NO `goals/AC-001.lock` remains. Negative control (pid guard, direct): a lock containing pid `999999` is NOT removed when asked to remove pid `424242`; it IS removed when the pid matches.
  - `packages/quay/test/ff-merge.test.mjs`: `✔ cleanTreeCheck — goals/<id>.lock 是 manifest 运行产物 ⇒ clean；非 manifest 的未跟踪文件仍拒 (54.975037ms)`. Real temp git tree whose ONLY untracked file is `goals/AC-001.lock` (the production shape — `goals/*.md` are tracked, so git lists the lock individually rather than collapsing the dir) ⇒ `ok:true`. Negative control: the same shape at a path NOT in the manifest (`residue.lock`) ⇒ `ok:false` with the path named — so the pass-through comes from the manifest pattern, not a blanket allowance. (Manifest gained `goals/*.lock`, `adr/*.lock`, `docs-managed/*.lock`, `meta/*.lock`; each carries its `@quay-runtime-artifact` marker in `.gitignore`, asserted equal by `gitignore-runtime-coverage-check.test.mjs`.)
  - ⚠️ SAME-ROUND CONSEQUENCE: the manifest change propagates into the block `quay-init` appends to a consumer `.gitignore`, so `plugin/test/quay-init-characterization.test.mjs`'s fresh-install `.gitignore` hash pin re-anchored `f9e6655a…` → `744f2416…` (the other FIVE files in that pinned surface hash unchanged — the targeted cross-check); it is likewise DECLARED in Touches.
- [x] AC5 (help): `quay goal gate --help` output contains the record `timeoutMs` and `not-evaluated`. Paste the lines.
  - `node --experimental-strip-types packages/quay/bin/quay.ts goal gate --help` (the gate section):
    `The kill deadline (resolveAcceptanceTimeout) is:`
    `  the RECORD's own 'timeoutMs'  >  --timeout <ms>  >  QUAY_ACCEPTANCE_TIMEOUT_MS  >  60000`
    `— the record's 'timeoutMs' is the TOP of the chain, so a per-record deadline is the deadline in force and --timeout only overrides the env/default fallback. …`
    `that legitimately needs longer is KILLED at the deadline and recorded as 'not-evaluated' (a timeout is "we could not measure this", never "this is false") — raise the record's 'timeoutMs' rather than accept the verdict.`
    The `--timeout <ms>` option block likewise now reads `the RECORD's 'timeoutMs' > --timeout > QUAY_ACCEPTANCE_TIMEOUT_MS > 60000`. ⛔ `acceptance-runner.ts` did NOT need a change: every goal criterion path (`gate`, P6 activation, I5 sweep, frozen rotation) now passes its own `timeoutKnob: timeoutKnobHint(t)`, so the default `gates.yml` wording is reached only by task gates.
- [ ] AC6 production reading on quay's own `.quay/goal-round.jsonl`: zero `spawn timeout after 120000ms` records on gate/write spawns with ts after the landing commit, over a ≥24h window that contains ≥1 goal-driver round（待外部）
- [ ] AC7 cross-project production reading after the host plugin is upgraded: claudecodeui `.quay/goal-round.jsonl` shows zero new `write|gate spawn error … 120000ms` and no new `goals/*.lock` in `git status --porcelain` over ≥24h（待外部）

## Definition of Done
- `scripts/test.sh --for-task <this task>` green; `tsc` clean on touched `.ts`.
- AC1–AC5 checked with pasted readings; AC6/AC7 stay `（待外部）` until their window passes.
- No change to which criteria pass or fail on their own merits; only the deadline that governs them.

## Touches
- tasks/gap-goal-driver-hardcoded-120s-spawn-kill-preempts-record-timeout-and-orphans-goal-locks.md
- plugin/scripts/goal-driver.ts
- plugin/scripts/meta-driver.ts
- plugin/scripts/driver-runtime.ts
- packages/quay/src/goal-store.ts
- packages/quay/src/frontmatter-store-base.ts
- packages/quay/src/gate/acceptance-runner.ts
- packages/quay/src/cli/help.ts
- plugin/scripts/quay-runtime-artifacts.txt
- .gitignore
- packages/quay/src/fan-in/ff-merge.ts
- packages/quay/test/goal-store.test.mjs
- packages/quay/test/ff-merge.test.mjs
- plugin/test/goal-driver-s01.test.mjs
- packages/quay/test/goal-criterion-timeout-resolution.test.mjs
- plugin/test/quay-init-characterization.test.mjs

## Blocker

**2026-10-12T17:14:52.685Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: a timeout is a definitive verdict ⇒ evaluable ⇒ activation allowed:
- run_id：wk-prod-anchor
- session_id：769b3c4c-ccf7-4211-9d0a-204d0ca35e86
