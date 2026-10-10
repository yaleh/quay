# Ownership-first architecture review — 2026-10-10

**Status:** investigation only. No Goal has been filed from this report. Per the brief that produced it
("先形成可复查的审查报告...再决定哪些应开 Goal；不要立刻扩大代码改动"), this is a reviewable artifact to
decide FROM, not a work order already executed.

**Method:** four parallel read-only reviews, one per bounded-context cluster (Driver+WorkerPool,
Task+Goal lifecycle, Gate engine+Fan-in, Routine+Session/control-plane), each instructed to cite
file:line/symbol for every claim and separate FACT / JUDGMENT / ASSUMPTION. The combined raw output was
then adversarially re-checked by a fifth, independent pass (model: Opus) instructed to try to falsify the
strongest claims, not confirm them. Findings below carry each claim's post-falsification status; three
claims were corrected (one found *worse* than first reported, two downgraded to cosmetic) and one was
ruled not a defect. This review builds on, and does not re-litigate, the declarative-quota/independent-
policy/global-safety-cap axis already investigated and closed earlier this session (GOAL-034, GOAL-035,
and the DIR-132 re-verification) — none of the findings below are about quota mechanism design.

**Cross-reference:** `docs/references/ownership-first-refactoring-methodology.md` (the GOAL-030~033
method this review applies), GOAL-030 (kernel/task-transition.ts: the Task lifecycle table this report
repeatedly uses as the positive precedent), GOAL-034 (gate/config→kernel primitive extraction, left the
root↔gate↔gate/config↔gate/factories package cycle as deliberate future scope), GOAL-035 (WorkerPool
needs-human transition ownership — the worker-driver.ts retry/backoff code this report's Driver findings
sit next to).

## Bounded contexts and where their state/decision/effect owners actually live

| Context | State owner | Decision owner | Effect owner | Note |
|---|---|---|---|---|
| Task lifecycle | `kernel/task-transition.ts` (`LIFECYCLE_EDGES`) | `kernel/task-transition.ts` (`decideTransition`) | `plugin/scripts/task-ops.ts` (re-exported) | Clean — the GOAL-030 precedent |
| Goal lifecycle | `goal-store.ts` top-level fields, no declared table | scattered inline booleans inside `write()` (goal-store.ts:2404-3065) | same `write()` | Not clean — see Finding 3 |
| Gate verdict (3-state) | `gate/types.ts` `GateVerdictKind` | `gate/acceptance-runner.ts` (`verdictFromAcceptance`/`verdictFromGateCheck`) — single declared mapper | `gate/gate-event-store.ts` (`appendGateEvent`) | Mapper exists and is correct; most real call sites don't call it — see Findings 1, 2 |
| WorkerPool needs-human | `driver-filters.ts` `RetryState` | `driver-filters.ts` `applyNeedsHumanTransition` (GOAL-035) | same | Clean, just fixed |
| Routine quota | `drivers.yml`/`driver-config.ts` | `routine-file-gate.ts` `routineQuotaDecision` | `routine-file-gate.ts` `markNeedsHuman`-adjacent writers | Clean for 2 of 4 quality-gate routines, not the other 2 — see Finding 6 |
| Control-plane caller identity | `kernel/control-state.ts` | `resolveCaller`/`knownCallers` | HTTP transport only | Enforced on the network surface only, not CLI self-halt — see Finding 7 |
| Fan-in landing | `worker-fan-in.ts` internal locals | `worker-fan-in.ts` `runMechanicalFanIn` (own, parallel decision logic) | `worker-fan-in.ts` (writes GateEvents directly) | Does not go through the Gate engine's declared entry point at all — see Finding 4 |

## Ranked findings

Ordered by (confirmed severity × evidence strength), highest first. Each gives the falsification verdict,
not just the original claim.

### 1. [HIGH — CONFIRMED, corrected and found worse] Six of seven shell-running gate factories drop the 3-state verdict; one of them can turn a broken check into a false PASS

- **Where:** `packages/quay/src/gate/factories/{it0,fixed-script,test-pass,red-green,coverage-floor,adr}.ts`.
  Only `factories/goal.ts:50` and the built-in acceptance gate (`gate/registry.ts:61`) call
  `verdictFromAcceptance`. `document-contract.ts` is excluded from the count — it validates in-process,
  no shell, so binary ok/fail is a complete answer for it. That leaves 7 shell-running factories, 6 wrong
  (corrected from the first pass's "6 of 8" — the denominator was wrong, not the numerator).
- **What breaks:** `it0.ts`/`fixed-script.ts`/`test-pass.ts`/`adr.ts` do
  `const {ok, reason} = runAcceptance(...); return {ok, reason};` — discarding `timedOut`/`code`. The
  engine's fallback mapper (`verdictFromGateCheck`, `engine.ts:112`) then collapses a timeout, a spawn
  failure, or any non-zero exit into plain `fail` — hard rule 3b's exact shape (an instrument that cannot
  tell "didn't run" from "ran and failed" reporting the same value as a real failure).
- **Worse than first reported:** `red-green.ts:28-36` treats any non-ok result from the "red" probe command
  as "red confirmed as expected" — so if the red command times out or can't even spawn, the gate can
  return `ok:true`. That is not a lost not-evaluated signal, it is a **false PASS**.
- **Precedent:** the codebase's own comments describe this exact bug class ("61 timeouts + ~370 exit-127
  mis-recorded") as already fixed once — just not propagated to 6 of the 7 factories that share the same
  shape (hard rule 5b: fixed in one place, not checked for siblings).
- **Minimal slice:** route each of the 6 factories' return through `verdictFromAcceptance`/
  `verdictFromGateCheck` the way `goal.ts` already does — same shape, 6 call sites, each independently
  testable with a negative control (inject a timeout, assert the gate reports not-evaluated, not pass or
  fail).
- **Regression risk:** low per-file (each factory is a narrow, already-tested unit), but the 7 call sites
  should land together or in a tracked sequence — a partial fix would leave the exact "fixed in some,
  not others" gap this finding itself describes.

### 2. [HIGH — CONFIRMED, contrast corrected] `goal-store.ts`'s I5 re-verify loop collapses not-evaluated into fail, filing phantom gaps

- **Where:** `goal-store.ts` `checkAchievedFailing` (≈2027-2028): `if (!res.ok) achievedButFailing.push(...)`
  on an `AcceptanceResult` — a timed-out or unrunnable criterion is reported identically to a genuinely
  failing one.
- **Corrected contrast:** the first pass compared this to the file's *activation* gate, but that gate
  doesn't call `verdictFromAcceptance` either (it decides on `code === null && !timedOut` directly). The
  real contrast is elsewhere in the *same file*: lines ≈2316 and ≈3634 do branch on
  `verdictFromAcceptance`'s 3-state output. So the inconsistency is intra-file, not a single clean
  before/after.
- **Why it matters:** this is the I5 diagnostic surface specifically built to catch "achieved but now
  failing" goals — a false positive here (a spawn hiccup reported as "achieved but failing") files a real
  gap task for a non-defect, which is exactly the cost class the file's own `gap-activation-gates-
  bypassed...`/GOAL-013/018 history already documents for a related bug.
- **Minimal slice:** swap the `!res.ok` check for a verdict-aware check with a distinguishable
  not-evaluated bucket (same mapper as Finding 1, different call site, same theme — these two findings
  are independent instances of one architectural gap: **"not-evaluated has a declared 3-state type, but
  most of its real consumers only check 2 states."**
- **Regression risk:** low — single function, clear before/after test (inject a timeout fixture, assert
  it no longer lands in `achievedButFailing`).

### 3. [HIGH — CONFIRMED, large, not a quick slice] Goal lifecycle has no declared transition table; Task's already does

- **Where:** `goal-store.ts`'s `write()` (2404-3065, ~660 lines) computes status-change classification as
  inline booleans recomputed per call (`activating`, `discarding`, `goalInAcScope`, the I1′ cap
  dispositions) rather than a `GOAL_EDGES`-style table; `flipGoal` (2364) performs a second, separate
  status flip entirely outside `write()`. `VALID_GOAL_STATUSES` only checks set membership, not transition
  legality.
- **Why it's the same shape Task had before GOAL-030:** the surrounding comments cite three real
  incidents (GOAL-013/014/018/022) caused by exactly this kind of scatter — this isn't a hypothetical risk,
  it has a track record in this codebase.
- **Why it's not a clean port of the Task fix:** per-edge side effects (human merge request via
  `goal-merge.ts`, AC-sufficiency, branch existence) genuinely vary by trigger in ways Task's transitions
  don't — a literal mirror of `LIFECYCLE_EDGES`+`decideTransition` would likely be the wrong shape.
- **Recommendation:** do NOT scope this as a quick slice. It needs a dedicated investigation phase first
  (enumerate the ~6 gates currently inlined in `write()`, decide what a legal-(from,to)-plus-gate-class
  table should even look like) before any branch Goal — exactly the kind of item the brief asked to flag
  rather than rush.

### 4. [MEDIUM — CONFIRMED, but known/documented, large, defer] `worker-fan-in.ts`'s landing path never calls the Gate engine's `runGate`

- **Where:** `runMechanicalFanIn` (`worker-fan-in.ts`, starts ≈1664). Zero matches for `runGate(` or
  `gate/engine` anywhere in the file — grep-confirmed by the falsification pass.
- **Correction from the first pass:** this is not a hidden defect — the code's own comment (≈2290-2293)
  states openly that mechanical fan-in bypasses the gate engine, and the chosen mitigation was to append
  GateEvents through the event store directly afterward.
- **Why it still matters:** `gate/engine.ts`'s `runGate` is the single place the engine's cost-ledger
  recording and dry-run skip-append logic live (`engine.ts:100-116`, `:127-132`) — fan-in's parallel path
  doesn't get either, by construction, and this is the actual production landing path for every task in
  the system (highest blast radius of anything in this report).
- **Recommendation:** report only. This is a known, deliberate architectural trade-off, not a bug to fix
  reflexively — and its blast radius (touches the mechanism that lands every task) means any change here
  needs its own dedicated scoping pass, explicitly NOT a same-session slice. Flagging it is the point of
  this review; acting on it is not.

### 5. [MEDIUM — FACT, not yet adversarially re-checked] `spawnSyncCapture` is duplicated verbatim and has already diverged

- **Where:** `gate/factories/coverage-floor.ts:24-40` vs `gate/acceptance-runner.ts:396-422`
  (`runAcceptanceCapture`) — the latter's own comment admits it "mirrors coverage-floor.ts's
  spawnSyncCapture exactly" instead of importing it. The two return shapes have already drifted (one is
  missing a `signal` field).
- **Confidence note:** this claim was in the original four reviews but was NOT one of the five checked by
  the adversarial pass — treat as FACT (the duplication and the comment admitting it are directly
  readable) but not yet independently stress-tested the way Findings 1-4 were.
- **Minimal slice:** small — one shared implementation, both call sites switch to it, with a test
  asserting the two previously-diverged shapes now agree.

### 6. [LOW-MEDIUM — FACT] Two of four quality-gate routines bypass the converged routine-quota policy

- **Where:** `quality-gate-driver.ts`'s packaging-hygiene (≈269-270) and architecture-review (≈661-662)
  routines file their gap tasks via a generic agent invoking the `quay-file-task` skill's own
  mechanism-based dedup — never calling `routineQuotaDecision`/`gateFinding` the way `probe-routine.ts`
  and `meta-driver.ts` do.
- **This is not a quota-redesign question** (the mechanism itself, per this session's earlier work, is
  sound) — it's a consistency question: the already-decided policy isn't applied uniformly across all
  four routines that could file tasks. Whether the two routines are deliberately exempt (lower-frequency,
  LLM-judged) is not stated anywhere in the code.
- **Minimal slice:** small-medium — either route both through `routineQuotaDecision` before their spawn,
  or add an explicit comment stating why they're exempt.

### 7. [LOW-MEDIUM — FACT] Divergent self-report trust between two task-creation call sites

- **Where:** `probe-routine.ts:568` (`fileRoutineTask`) re-checks `fs.existsSync` after spawning the
  create CLI and refuses to trust a reported-ok exit code alone; `meta-driver.ts:1736` (`createTask`)
  trusts the exit code with no existence check, for the structurally identical operation.
- **Minimal slice:** small — factor one shared `fileRoutineTask`-shaped helper; have `createAutoDriveTask`
  call it.

### 8. [LOW — CONFIRMED-DOWNGRADED, informational] `goal-driver.ts`'s two disk caches look like a class-in-disguise but aren't a clean duplicate

- First pass read this as a textbook "second instance justifies extraction" (GOAL-030-032 rule).
  Falsification found the disk I/O (`readCacheMap`/`writeCacheMap`) is **already shared**; what remains
  duplicated is ~10 lines of module-level bookkeeping (map/dir var/ensure/reset-for-test/snapshot), and the
  two caches' validation callbacks differ in a load-bearing way (different field shapes), and one cache
  doesn't even have a `persist*` function (writes inline). **Not a recommended slice** — cosmetic at most.

### 9. [LOW — CONFIRMED-DOWNGRADED, informational] `worker-driver.ts`'s `final_state` is not a missing transition table

- First pass compared this to Task's `LIFECYCLE_EDGES` gap. Falsification found a single declared
  vocabulary already exists (`FINAL_STATES`, enforced via `assertFinalState`), and the "three independent
  derivations" are actually two functions answering **different questions** (a live worker's exit vs. an
  adopted orphan's, which structurally cannot observe the same inputs) plus one reverse mapping. The one
  real (minor) duplication is the `final_state`→exit-code mapping existing twice (≈4985-4989 and
  ≈4697-4698). Not worth a dedicated slice on its own; worth folding into any unrelated future touch of
  that code.

### Ruled out (reported for the audit trail, not a defect)

- **`goal-store.ts`/`goal-merge.ts` reaching into `gate/gate-event-store.ts` directly** — read as a
  layering violation by the first pass. Falsification found `gate/engine.ts` exports no event-query
  surface at all (no barrel, no public read API) — there is nothing to "bypass". `gate-event-store.ts` is
  a shared, dependency-free, deliberately cross-cutting primitive (its own header says so), already
  consumed the same way by `engine.ts`, `gate-log.ts`, and `lifecycle.ts` from inside `gate/` itself. Not a
  finding.

### Noted but not independently falsified (lower priority, large slices, flagged for awareness only)

- **`worker-driver.ts`'s `main()`** (≈5831-6162, ~330 lines) mixes a 35-flag CLI parser with ~15
  structurally unrelated effect branches. **`driver-runtime.ts`** is simultaneously a shared library, a
  CLI binary, and the anchor's process supervisor in one file. Both are real god-module shapes by the
  review's own read, high severity by blast radius (sole entry points for their kinds), but large slices
  and not run through the adversarial pass — do not act on these without a dedicated scoping pass first.
- **`driver-filters.ts`** owns the actual filter pipeline AND an unrelated doc↔develop git-sync/conflict
  resolution implementation (≈292-762) in the same file — a misplaced-responsibility shape, medium
  slice, not falsification-checked.

## Recommended candidates (unrelated to the quota axis), in priority order

These are the findings this report recommends treating as **real, independently-verifiable minimal
slices** — not yet scoped as Goals, per the instruction not to expand code changes this round:

1. **Finding 1** — gate factories' 3-state verdict mapping (6 shell-running factories, highest severity,
   confirmed and found worse than first reported, cleanly bounded, each factory independently testable).
2. **Finding 2** — `goal-store.ts`'s `checkAchievedFailing` not-evaluated collapse (same architectural
   theme as #1 in a different module — two independently confirmed instances of "the 3-state type exists,
   most consumers only check 2 states" is itself evidence this is a real, recurring gap, not a one-off).
3. **Finding 4** — fan-in's bypass of the Gate engine's `runGate` — recommended as a **investigate-further,
   do-not-rush** item given it is the production task-landing path, not an immediate slice.

Findings 5-7 are legitimate smaller items worth a task each, not a branch Goal. Findings 8-9 and the
ruled-out item are recorded so this review doesn't need to be re-litigated if raised again later.

## Open questions for the next phase

- Should Finding 1 and Finding 2 land as one Goal (shared theme: "3-state verdict must reach every real
  consumer") or two independent branch Goals (different modules, different owners, different risk
  profiles)? This report doesn't decide that — it's a scoping question for whoever picks this up.
- Finding 4 needs its own investigation pass (what would it take to make fan-in call `runGate` without
  losing its current lock/merge/anti-drift sequencing?) before it can even be scoped as a slice, let alone
  executed.
