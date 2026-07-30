---
id: gap-dir126d-deferred-phase-timing-recurrence-tracking
title: DIR-126-D deferred two enrichment ideas that were never actually
  charter-mandated -- per-phase-boundary timing (nowMs threaded through
  prepare-admission-check.ts, a {phase, round, startedAtMs, endedAtMs}
  breakdown) and findingCodes[] recurrence tracking (recurrenceKey,
  firstSeenGeneration, lastSeenGeneration) -- record them as real,
  well-specified follow-up work
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---
## Proposal

### Problem framing (grounded in current code)

DIR-126-D/M203 (landed `6a24bf3`) shipped a production-wired committed telemetry record. Every
structural claim below was re-verified by direct source read of the current tree this round
(2026-07-30), not inherited:

- `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` materializes the record via
  `buildTelemetryRecord` (:392, `schemaVersion: 2` via `TELEMETRY_SCHEMA_VERSION` at :402) and
  guards it with `validateTelemetryRecord` (:430) whose `REQUIRED_TOP` array (:437-441) freezes
  exactly 18 keys: `recordId, attemptId, generationId, admission, workspace, taskId, milestoneId,
  class, highRisk, hashes, decision, contentAgentDispatchCount, contentAgentMs, terminal,
  leaseRelease, sessionId, recordedAtMs, telemetryWriteOk`, each materialized with an explicit
  `?? null` (no-fabrication discipline). Committed records
  (`milestones/prepare-telemetry/DIR-126-E/2a107fcb5cc9.json`,
  `milestones/prepare-telemetry/gap-dir126d-deferred-phase-timing-recurrence-tracking/dd06ce1ed5b8.json`)
  match that key set byte-for-byte. **No timing array and no recurrence field exists anywhere
  today**: a repo-wide grep for `phaseTimings|findingCodes|recurrenceKey|firstSeenGeneration|
  lastSeenGeneration` across both `scripts/` mirrors and both `prepare-milestone.js` mirrors
  returns zero hits — genuinely greenfield, not a rename.
- This task's own prior Prepare run has already committed a record (`dd06ce1ed5b8.json`,
  `terminal.reason: "split-recommended"`, `phase: ProposalReview`) — direct mechanical evidence
  that the DIR-126-D deferral happened exactly as the Finding section describes, and the recurrence
  scanner's first real input for this `taskId` already exists on disk.
- `prepare-admission-check.ts` has a single CLI `main(argv)` (:601) parsing six mutually-exclusive
  modes (`--acquire|--renew|--release|--force-release|--preflight|--preflight-plan`, usage string
  :603, mode selection :631-643), computes exactly one `const now = Date.now()` (:648) shared by
  every mode, injects it into the pure decision functions (e.g. `renewLease({ workspace, taskId,
  stage, now })` :190), and never includes it in any `console.log(JSON.stringify(...))` site.
  **The print sites are not uniform**: `acquire`/`renew`/`release`/`force-release` print
  locally-built `result` objects (:688/:693/:698/:708), but `preflight`/`preflight-plan` print the
  object RETURNED by `runPreflightChecks(...)` directly (:662/:672), and there are error-path
  prints — `missing-session-id` (:678), `preflight-check-failed` (:653/:667), and a catch-all
  `admission-check-failed` (:711). The architecture already endorses CLI-side time computation in
  the code's own words: `acquireLease` fails closed at :174 with `"missing-now: a real epoch-ms
  'now' is required (workflow scripts cannot call Date.now(); this CLI computes it itself when run
  directly)"`. The timestamp is real subprocess wall-clock, already computed, currently discarded.
- Verdict shapes differ by mode (load-bearing for the workflow-side push rule): `--acquire` prints
  an `outcome`-keyed verdict (`acquireLease` → `outcome: "acquired"` on success, checked at
  `prepare-milestone.js` :223); `--renew` prints an `ok`-keyed verdict (`renewLease` → `{ok: true,
  lease}` on success, `{ok: false, error: "lease-missing"|"missing-now"}` on failure; CLI returns
  `result.ok ? 0 : 1` at :695). `ok === true` is the renewal-success signal — not an invented
  `outcome: 'renewed'` literal, and not `nowMs`-presence alone (failure verdicts carry `nowMs` too,
  by design).
- `.claude/workflows/prepare-milestone.js` (byte-identical `plugin/workflows/` mirror, reconfirmed
  by `cmp`) is a sandboxed workflow-DSL file with zero `import` statements. `_renewLease(stageLabel)`
  (:147) is `return _admissionAgentCall(...)` (:134, the agent reports the CLI's stdout verbatim as
  `{raw}`) with zero parsing inside it, dispatched at exactly 6 static sites — `Adjudicate` (:372),
  `ProposalReview` (:407), `` `ProposalReview-delta-round-${_deltaRound}` `` (:577, up to
  `_maxDeltaRounds`), `PlanAuthor` (:638), `` `PlanCheck-round-${_planCheckRound}` `` (:719, `while
  _planCheckRound < MAX_PLANCHECK_ROUNDS` = 3, :714-717), `Receipt` (:755) — every one a bare
  `await _renewLease(stageLabel)` whose response is **completely discarded today**. This task is
  the first code to read anything out of a renewal response. By contrast `--acquire`'s response is
  already parsed today: `let _admissionVerdict = _parseAgentJson(_admissionResult.raw)` (:221),
  with `.outcome`/`.lease.fencingToken`/`.reclaimed` read at :223/:238 — it just has no `.nowMs`
  yet. `_parseAgentJson` (:32, balanced-brace scanner, never naive `JSON.parse`) exists because
  agent stdout can carry non-JSON noise (`gap-prepare-milestone-noisy-agent-raw-json-parse`/M202) —
  every new parse must go through it.
- **The sandbox is NOT clock-blind, but its existing clock is agent-turn-granular**: the workflow
  already has an AC19-compliant clock `_now = (typeof $a.now === 'function') ? $a.now : () =>
  _latestKnownNowMs` (:421), seeded from dispatched agents instructed to run `date +%s%3N` and
  return `nowMs` (:505/:515, :608/:616), already feeding `_startedAtMs`/`_endedAtMs` (:516/:777,
  threaded into the convergence JSON at :791-792). This is the pre-existing precedent for the
  posture this task reuses — "subprocess/agent computes the clock, sandbox only reads a cached
  number" — but it is not advanced at the six renewal boundaries and is strictly coarser than
  dispatch-boundary-exact subprocess self-report (see Alternatives #3).
- **The load-bearing sandbox constraint**: `plugin/test/prepare-milestone-convergence.test.mjs`
  AC19 (:1103) greps the whole workflow file with comment-stripping for zero LIVE `Date.now()`/`new
  Date(`/`await import(`/`import(` sites (regex list :1107-1110) and cites two real
  production-crash commits (`f6db2a8`, `7357a91`) as the regression class. Any timestamp the
  workflow touches must be read out of already-parsed subprocess JSON, never computed locally. The
  test iterates per-mirror (`[${mirrorName}]`), so both mirrors are guarded.
- **A TDZ hazard the design must respect**: `let _ledger = []` is declared at :444, textually AFTER
  `_releaseLeaseAndRecord`'s definition (:175) and after four terminal exits that call it — :313
  (`preflight-check-failed`), :323 (`preflight-rejected`), :366 (`proposal-author-incomplete`),
  :390 (`adjudicate-failed`) — plus the three pre-lease `_recordAttemptAgentCall` exits
  (:90/:228/:234). Optional chaining does NOT bypass the temporal dead zone: `_ledger?.map(...)`
  still evaluates the binding at those sites and throws `ReferenceError: Cannot access '_ledger'
  before initialization`. Finding-code construction must therefore use a boolean-flag short-circuit
  guard (Mechanism 2), never the literal `_ledger?.map(f=>f.id) ?? []` form — the AC9 grounding
  identifier now cites the TDZ-safe `_ledgerLive ? _ledger.map(f=>f.id) : []` form accordingly.
- Terminal-write topology (all sites verified by direct read): `_releaseLeaseAndRecord` (:175)
  dispatches `--record-generation` (command string built at :181, fire-and-forget — the one
  "fire-and-forget" comment at :171 belongs here and stays accurate, since this task does not parse
  that response); `_writeGenerationTelemetry` (:193) dispatches `--record-generation --no-release`
  (:195, the Receipt success path at :804), whose response IS already parsed into `_writeTelVerdict`
  (:805) and read for `.ok`/`.telemetryWriteOk` (:807) — the live precedent for reading a parsed
  terminal-dispatch verdict; `_recordAttemptAgentCall` (:76) dispatches `--record-attempt` with the
  double-`JSON.stringify` `--detail` idiom (:83) from the 3 pre-lease exits; bare `_releaseLease`
  (:200) dispatches `--release-only`, which writes no telemetry. So exactly 4
  `_releaseLeaseAndRecord` exits are **pre-ledger** (:313/:323/:366/:390) and 9 are **post-ledger**
  (`wiring-coverage-check-failed` :552, `proposal-revise-failed` :595, `split-recommended` :621,
  `soft-budget-exceeded` :626, `delta-cap-exhausted` :631, `plan-author-failed` :670,
  `preflight-check-failed` :686, `preflight-rejected` :701, `plancheck-rounds-exceeded` :749) — 13
  `_releaseLeaseAndRecord` exits in total, plus the Receipt success write (:804). There are 3 bare
  `_releaseLease` sites (:809/:837/:847), but only :809 (`telemetry-write-failed`) writes **no
  record at all** — its :804 `_writeGenerationTelemetry` write failed first; :837
  (`receipt-selfcheck-failed`) and :847 (`prepared`/final) run after :804 already persisted the
  record, so those records DO carry the new fields. (All 13 `_releaseLeaseAndRecord` callers
  inherit `--phaseTimings`/`--findingCodes` automatically, since both flags are added inside the
  shared `_releaseLeaseAndRecord` helper's command string at :181 — the mechanism is unaffected by
  the corrected count; remediation was re-enumeration, not a redesign.)
- On the writer side, `proposal-convergence.ts` has exactly three telemetry-writing CLI submodes
  (`_cliMain` :766, usage :768): `--record-generation [--no-release]` via the shared
  `_writeCommittedTelemetry` helper (:653), the `--decide-resume` reuse-terminal inline block
  inside `_decideResumeCli` (:512, own `buildTelemetryRecord` call at :565 — a fourth write *site*
  sharing the materializer, reached via early return, not a fourth CLI mode), and
  `--record-attempt` via `_recordAttemptCli` (:738, the 3 pre-lease sites, `generationId: null`,
  keyed by `computeAttemptId` :384). `--release-only` (:818) writes nothing.
- Reusable primitives that already exist: `telemetryPath(workspace, taskId, recordId)` (:370, with
  the `_missing-taskId` segment fallback at :371) built on `_safeTaskIdSegment` (:341) for locating
  the `milestones/prepare-telemetry/<taskId>/` tree; `fingerprintFinding({subsystem, claimRef,
  summary})` (:64) and `computeAttemptId`/`_computeGenerationId`'s `sha256(...).slice(0,12)` (:478)
  establish the stable-hash identity idiom; `_writeTelemetryRecord` (:469) is the write primitive;
  and `milestone-preparation-check.ts`'s tolerant tree walk with the malformed-file-skip precedent
  (`// Malformed telemetry file — skipped, never crashes the report query.` :172-173).
- The import graph already forms a pre-existing 3-file cycle (verified by direct grep of every
  relative import): `prepare-admission-check.ts` :45 → `milestone-preparation-check.ts`
  (`parsePlanStages`/`validatePlanStructure`) :26 → `proposal-convergence.ts`
  (`blockingOpen`/`validateConvergenceCounters`/`computeConvergenceMetrics`) :27 →
  `prepare-admission-check.ts` (`PREFLIGHT_POLICY_VERSION`/`releaseLease`). Any new helper location
  must not tighten it.
- Timing granularity context: the workflow has **16** `phase(` call sites but only **6**
  `_renewLease` sites — e.g. `phase('ProposalAuthors')` (:336/:342) and `phase('Preflight')` (:304)
  have no renewal today. Piggybacking timing on renewals only is a deliberate, quantified
  coarsening; `phase()`-exact coverage would require new dispatches.
- Test reachability: `scripts/test.sh`'s canonical glob is `packages/*/test/*.test.mjs
  plugin/test/*.test.mjs` (verified at :37) — it does NOT reach
  `experiments/quay-perpetual-stream/test/*.test.mjs`.
  `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` exists and is this task's
  Touches entry; there is no `plugin/test/proposal-convergence.test.mjs` (confirmed absent). AC
  evidence for that file must cite a direct `node --experimental-strip-types --test` invocation,
  never a green `scripts/test.sh` run. `plugin/test/prepare-admission-check.test.mjs` IS
  `scripts/test.sh`-covered.
- Mirror tooling: `sync-vendor.sh` lives at `plugin/scripts/sync-vendor.sh` (verified; it is NOT at
  `scripts/sync-vendor.sh`), and `cmp` confirms all four mirror pairs byte-identical
  pre-this-task.

Why this is a real task and not a re-litigation: both enrichments were added in-flight during
DIR-126-D's ProposalReview convergence, then deliberately trimmed once a direct grep of the M203
charter's Scope/Done-when confirmed neither was charter-mandated; that trim is what let
`mechanismCount` drop below the `split-multi-mechanism` threshold. This task re-charters both under
M207's explicit Scope (`experiments/quay-perpetual-stream/charters/M207-gap-dir126d-deferred-
enrichment.md`) so no future round re-derives mandate status from scratch.

### Chosen mechanism

Two independent, purely-additive extensions layered onto the landed telemetry pipeline, confined to
the task's (already-amended, verified-complete) Touches list, reshaping nothing DIR-126-D landed.

**Mechanism 1 — per-phase-boundary timing.**

1. `prepare-admission-check.ts` `main()` stamps one additive `nowMs: now` field reusing the
   already-computed `const now` at :648 — **zero new `Date.now()` sites in this file**. It is
   attached to the four lease-mode `result` objects, spread non-destructively onto the two
   preflight-mode returned objects (`console.log(JSON.stringify({...result, nowMs: now}))`,
   preserving the existing `{ok, policyVersion, findings}` keys downstream Preflight parsing
   reads), and added to the inline error literals (:653, :667, :678) and the catch object (:711) so
   a failure verdict also self-reports when the subprocess answered. Pure decision functions
   (`acquireLease`/`renewLease`/`releaseLease`/`checkStaleOwner`/`decideResumeGeneration`) are
   untouched — they already take injected `now`, and keeping `nowMs` at the wrapper preserves the
   documented pure-decision/thin-CLI split and every direct-import unit test.
   **CLAIM C1 (needs AC): `main()`'s JSON output carries `nowMs` for all six modes on both success
   AND error paths, fixture-asserted per mode, with a sub-assertion that the preflight verdict's
   existing keys survive unchanged.**
2. `prepare-milestone.js` (both mirrors): `_renewLease` gains a second parameter `round` — an
   already-in-scope caller-owned integer (`0` for the non-round sites Adjudicate/ProposalReview/
   PlanAuthor/Receipt, `_deltaRound` at :577, `_planCheckRound` at :719), never regex-parsed from
   the formatted `stageLabel`. **CLAIM C2 (needs AC): all 6 `_renewLease` call sites pass `round`
   explicitly; fixture asserts no string-parsing of `stageLabel` recovers it.**
3. Each `_renewLease` response is parsed for the first time via the existing `_parseAgentJson`, in
   a new `_recordPhaseBoundary(stageLabel, round, r)` helper (a new parse relationship — the
   response was 100% discarded before). An entry is pushed onto a new module-level `_phaseTimings`
   array **only when the parsed verdict has `ok === true` AND `Number.isFinite(v.nowMs)`**
   (matching `renewLease`'s real `{ok: true, lease}` success shape); each entry is `{phase:
   stageLabel, round, startedAtMs: _lastBoundaryMs, endedAtMs: v.nowMs}`, then `_lastBoundaryMs =
   v.nowMs`. A verdict carrying `nowMs` but `ok: false` is deliberately NOT a boundary (a failed
   renewal means the lease was not renewed and the phase may not have run; recording it would
   falsify the timeline). **CLAIM C3 (needs AC): `_renewLease` responses are parsed at all 6 sites
   and an entry is pushed only under that success-and-finite rule.**
4. `--acquire`'s already-parsed `_admissionVerdict` (:221) is extended to read `.nowMs`, seeding
   `_lastBoundaryMs` when `outcome === 'acquired'` (the `prepare-already-running` path returns at
   :234-235 before any span exists). No `_phaseTimings` entry is pushed at acquire — no prior
   boundary to pair against. **CLAIM C4 (needs AC): `_lastBoundaryMs` is seeded exclusively from
   `_admissionVerdict.nowMs` / parsed renewal `nowMs`, never a workflow-local clock read.**
5. The final, still-open span is closed **receiver-side, never in the sandbox**: both terminal
   record helpers (`_releaseLeaseAndRecord`'s `--record-generation` :181 and
   `_writeGenerationTelemetry`'s `--record-generation --no-release` :195) and
   `_recordAttemptAgentCall`'s `--record-attempt` (:83) gain a `--phaseTimings <json>` flag
   (double-`JSON.stringify`, matching the `--detail` idiom) carrying closed spans + one trailing
   `{phase, round, startedAtMs, endedAtMs: null}` entry. `proposal-convergence.ts` closes the
   trailing entry with its own already-computed `recordedAtMs`/`now` before `buildTelemetryRecord`.
   `_releaseLease`'s `--release-only` (:200) gains nothing (it writes no telemetry).
   **CLAIM C5 (needs AC): the trailing open entry is always closed with the receiver's own
   timestamp, never a value invented in the sandboxed caller; fixture forces an `endedAtMs: null`
   input and asserts the receiver-filled value equals `recordedAtMs`.**
6. `--decide-resume`'s output does **not** gain `nowMs` under this design: its verdict is parsed at
   :266, but it is not a phase boundary (the reuse-terminal short-circuit returns before
   `phase('Preflight')` at :304), and no accumulation path would read it — an unread field violates
   this file's "every field has a reader" discipline. (Explicit alternative #5.)

**Mechanism 2 — `findingCodes[]` recurrence tracking.**

1. Every record-writing dispatch always contributes at least one code. A new `_findingCodesFor(reason)`
   helper in `prepare-milestone.js` returns `[reason, ...(_ledgerLive ? _ledger.map(f => f.id) :
   [])]`, where `let _ledgerLive = false` is declared near the module top and set `true` immediately
   after `let _ledger = []` at :444. The boolean short-circuit is essential, not cosmetic:
   `_releaseLeaseAndRecord` is invoked before :444 executes at the four pre-ledger exits
   (:313/:323/:366/:390), and any direct or optional-chained reference to `_ledger` there throws a
   TDZ `ReferenceError` (`?.` does not bypass the dead zone). The three pre-lease
   `_recordAttemptAgentCall` sites contribute `[site]` (the site string each already passes). At
   all 7 pre-ledger sites `findingCodes` is `[reason]` only — correct, not a gap (fabricating
   ledger entries never produced would break the no-fabrication discipline). **CLAIM C6 (needs AC):
   `prepare-milestone.js` threads `--findingCodes <json>` alongside `--phaseTimings` on the same
   terminal dispatch sites; all 7 pre-ledger sites independently produce a non-empty array,
   fixture-verified by a pre-ledger-exit TDZ invocation.**
2. Inside `proposal-convergence.ts`, each code maps to `recurrenceKey =
   sha256(`${taskId}::${code}`).slice(0,12)` — reusing `fingerprintFinding`'s (:64) established
   stability property (summaries reword round-to-round; the code/id must not).
3. A new **local** helper inside `proposal-convergence.ts` enumerates prior committed records under
   `milestones/prepare-telemetry/<taskId>/`, reusing `_safeTaskIdSegment`/`telemetryPath`'s path
   resolution verbatim (including the `_missing-taskId` fallback), `JSON.parse`s each, and —
   mirroring the :172-173 malformed-skip precedent — silently skips any file that fails to parse or
   lacks a `findingCodes` array (covering every pre-this-task record, e.g. `dd06ce1ed5b8.json`).
   **CLAIM C7 (needs AC): the scan is a local helper reusing
   `_safeTaskIdSegment`/`telemetryPath`; an import-graph check confirms zero new `import` edges
   between `proposal-convergence.ts` and `milestone-preparation-check.ts` (the existing 3-file
   cycle is not tightened).**
4. Per matching `recurrenceKey`: `firstSeenGeneration` = the earliest matching prior record's own
   `generationId` (or its `attemptId` for `--record-attempt` records, which carry `generationId:
   null` — a distinct, independently-fixtured sub-case), or the current record's own id when no
   prior match exists; `lastSeenGeneration` is always the current record's own id.
5. `buildTelemetryRecord` (:392) — the single schema-materializer — gains two new
   parameters/fields, `phaseTimings` and `findingCodes` (array of `{code, recurrenceKey,
   firstSeenGeneration, lastSeenGeneration}`), always explicit (`[]` when empty, never a dropped
   key, matching the existing always-materialized `?? null` discipline). `validateTelemetryRecord`'s
   `REQUIRED_TOP` (:437) grows by both keys. **CLAIM C8 (needs AC): `REQUIRED_TOP` includes both
   fields and a record missing either fails with `telemetry-field-missing`, fixture-asserted.**
6. **CLAIM C9 (needs AC): enforcement is write-time only** — `validateTelemetryRecord`'s sole live
   call is the pre-write path; nothing re-validates committed history, so DIR-126-D/E-era records
   lacking both keys are never retroactively invalidated (a code comment at `REQUIRED_TOP` flags
   this latent trap).

### Concrete control/data flow

1. `--acquire` → `main()` stamps `nowMs` → workflow parses `_admissionVerdict` (:221), reads
   `.nowMs`, seeds `_lastBoundaryMs`. No span pushed (first boundary).
2. Each `const r = await _renewLease(stageLabel, round); _recordPhaseBoundary(stageLabel, round,
   r)`: `_parseAgentJson(r.raw)`; if `v.ok === true && Number.isFinite(v.nowMs)`, push `{phase:
   stageLabel, round, startedAtMs: _lastBoundaryMs, endedAtMs: v.nowMs}` and advance
   `_lastBoundaryMs = v.nowMs`. A failed (`ok: false`, e.g. `lease-missing`) or
   unparseable/noisy renewal pushes nothing and leaves `_lastBoundaryMs` unchanged — fail-soft; the
   next successful boundary produces a wider, correctly bounded span.
3. Whichever terminal fires: `_releaseLeaseAndRecord` (the pre-Receipt sites) or
   `_writeGenerationTelemetry` (the Receipt success path) gains `--phaseTimings <json>` (closed
   spans + 1 trailing `endedAtMs: null`) and `--findingCodes <json>` (double-`JSON.stringify`) on
   the same `--record-generation` dispatch it already makes; the three pre-lease exits gain both
   flags on their existing `--record-attempt` dispatch. No new dispatch.
4. Receiver CLI tail parses both flags (same optional-JSON-flag tolerance as every existing flag),
   closes the trailing span with its own `recordedAtMs`, computes the recurrence quad per code via
   the local scan helper, and calls `buildTelemetryRecord({..., phaseTimings, findingCodes})`, whose
   always-materialize discipline (`?? []`) guarantees both keys are present on every write. The
   widened `REQUIRED_TOP` fail-closed check (`validateTelemetryRecord`) gates ONLY the reuse-terminal
   path (its sole live call at :582, inside `_decideResumeCli`); the main writes
   (`_writeCommittedTelemetry` :653, used by all 13 `_releaseLeaseAndRecord` exits, and
   `_recordAttemptCli` :738) do NOT call `validateTelemetryRecord` at all — they rely on
   `buildTelemetryRecord`'s always-materialize discipline, not the validator. So "REQUIRED_TOP is
   enforced" reads narrowly as a reuse-terminal-path unit test, NOT as a gate on every write.
5. `--record-attempt` (3 pre-lease sites): `phaseTimings: []` by construction
   (`missing-required-args` :90 precedes `--acquire` entirely; :228/:234 have a seeded
   `_lastBoundaryMs` but zero completed spans); `findingCodes: [site]`; recurrence keyed on
   `attemptId` scanning only sibling attempt records.
6. `--decide-resume` reuse-terminal write (:565): `phaseTimings: []` (cache hit, no phase ran) and
   `findingCodes` from the reused terminal's own `reason` alone, recurrence computed identically.
7. The one no-record terminal (`telemetry-write-failed` :809-810, bare `_releaseLease`) writes
   nothing, so accumulated `_phaseTimings` are simply never persisted there — correct by
   construction, not a lost-data bug.

### Key design decisions

- **Boundary = admission-touching dispatch, not `phase()` call.** Only acquire + the 6 renewal
  sites + the terminal close produce timing data. 11 live `phase()` invocations exist (an earlier
  draft's "16" counted 5 in-code comment mentions, not calls); covering them all would require new
  agent dispatches purely for timestamps, contradicting the zero-new-dispatch ethos.
  AC2's "phase-dispatch count" must therefore be read as "admission-touching dispatch count" —
  flagged as an AC wording clarification below.
- **Two verdict shapes, one push rule.** `--acquire` is `outcome`-keyed; `--renew` is `ok`-keyed
  (verified :190-197, :695). The push rule names `ok === true && Number.isFinite(v.nowMs)` exactly
  — not `nowMs`-presence alone (error-path verdicts also carry `nowMs` by design) and not an
  invented `outcome: 'renewed'` literal.
- **`round` is data the caller already owns** (`_deltaRound`, `_planCheckRound`) — a formatted
  label is presentation, never a structured-data source.
- **TDZ-safe finding-code construction**: a `_ledgerLive` boolean short-circuit, never `_ledger?.…`
  — the single correctness-critical refinement over a naive optional-chaining construction.
- **Trailing span closed receiver-side** so the sandboxed file never computes a timestamp — the
  only design that satisfies AC19's regression guard (`f6db2a8`/`7357a91` crash class) and the
  `missing-now` error's stated contract (:174) while still closing the final span; it reuses the
  workflow's existing "subprocess computes the clock, sandbox reads a cached number" posture
  (`_latestKnownNowMs` :421) without reusing `_now()` itself (Alternatives #3).
- **`buildTelemetryRecord` stays the single schema-materializer**: the two fields are new
  parameters there, not ad-hoc duplication at each write site.
- **`schemaVersion` stays 2** (default, reviewer-adjustable): DIR-126-D's own precedent reserves
  bumps for supersession of a different record *family* (v2 superseding `.generation.json`'s v1,
  per the :356 comment), not additive growth within a family; nothing re-validates history, so no
  forward-compat hazard forces a bump.
- **Recurrence lives in `proposal-convergence.ts` as a local helper**, not an import of
  `queryTelemetryReport` — a 4th edge onto the verified 3-file cycle for a ~15-line primitive is
  the same anti-pattern this codebase already rejects elsewhere (the header-comment justification
  for locally reimplementing the lease primitive instead of importing `withFileLock()`).
- **Recurrence read is fail-soft per-file, fail-closed per-write only at `REQUIRED_TOP`**:
  corrupt/pre-this-task siblings are skipped individually; the *current* record's two new fields
  are mandatory. These two postures are deliberately different and each mirrors an existing
  precedent.
- **Both new flags are threaded onto BOTH terminal record helpers** (`_releaseLeaseAndRecord` :181
  AND `_writeGenerationTelemetry` :195) so the Receipt success path and the pre-Receipt terminals
  are uniformly covered; `_releaseLease`'s `--release-only` (:200) stays unchanged.
- **No stale-comment fix needed in `prepare-milestone.js`**: the one "fire-and-forget" comment
  (:171) belongs to `_releaseLeaseAndRecord`'s `--record-generation` response, which this task
  still does not parse (it parses renewals) — the comment stays accurate.

### Defaults and failure behavior

- Missing/unparseable `nowMs`, or `ok: false`, at any renewal: no entry pushed, `_lastBoundaryMs`
  unchanged — fail-soft, matching "telemetry is additive, never blocks the real gate" (renewal
  failures are non-fatal today too).
- `--acquire` verdict without `nowMs` (older-subprocess interop): `_lastBoundaryMs` stays `null`;
  the first successful renewal then pushes an entry with `startedAtMs: null` — an honest "epoch
  unknown", not a crash.
- No prior records for a `taskId`: `firstSeenGeneration === lastSeenGeneration ===` current id for
  every code — the expected first-occurrence shape.
- `--phaseTimings`/`--findingCodes` omitted or malformed (older caller): default to `phaseTimings:
  []` / `findingCodes` computed from `terminal.reason` alone; never throw — a secondary-field parse
  failure must never block the primary write (mirrors the existing `telemetryWriteOk`-isolation
  posture).
- A malformed/schema-lacking prior record hit during the scan is skipped individually, never
  aborting the scan or the current write.
- Any throw inside the new logic is caught by the existing enclosing try/catch and surfaces as
  `telemetryWriteOk: false` — never prevents or retroactively invalidates a lease release that
  already happened (DIR-126-D's lease-release-independent-of-telemetry guarantee, unchanged).

### Compatibility

- Purely additive JSON fields — no key renamed/removed. `queryTelemetryReport` only `JSON.parse`s
  and skips malformed files (:172-173); `checkPreparation`'s hash binding compares a named file —
  neither does field-level validation against old records, so both stay unaffected. The only new
  consumer of the archive is this task's own sibling-scanning helper. **Grounding check (needs AC):
  no existing call site runs `validateTelemetryRecord` over a record read back from disk — the
  widened `REQUIRED_TOP` must stay write-time-only.**
- Pure decision/preflight functions untouched; only the CLI wrapper's printed JSON grows (preflight
  modes via a non-clobbering `{...result, nowMs}` spread).
- `.quay/prepare-leases/<taskId>.generation.json` (v1, gitignored) and
  `_writeLegacyGenerationRecord` untouched.
- Zero new `Date.now()`/`new Date()`/`import()` sites in `prepare-milestone.js` by design, so the
  existing AC19 fixture is sufficient re-verification (confirm green; no new fixture for that
  guard).
- Mirror parity: all four pairs confirmed byte-identical pre-task via `cmp`; must stay identical
  after every edit, checked via `cmp` and `plugin/scripts/sync-vendor.sh --check` (verified real
  path — not `scripts/sync-vendor.sh`).
- `plugin/test/prepare-admission-check.test.mjs` is `scripts/test.sh`-covered;
  `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` is not (glob verified at
  `scripts/test.sh:37`) — its evidence cites direct `node --experimental-strip-types --test`
  invocation.
- Touches list verified complete against the live task this round (both workflow mirrors and
  `plugin/test/prepare-milestone-convergence.test.mjs` already present) — no amendment needed.

### Risks

- **`highRisk` — shared-surface blast radius.** Both edited CLI wrappers are dependencies of every
  future Prepare dispatch. A malformed `nowMs` interpolation breaking `_parseAgentJson`'s
  balanced-brace scan would fail closed on every milestone's Prepare. Both new flags must degrade
  to documented defaults on any malformed value — needs its own dedicated fixture beyond general
  Defaults coverage.
- **Preflight-key preservation**: because `preflight`/`preflight-plan` print the RETURNED
  `runPreflightChecks(...)` object, the `nowMs` attachment there must not clobber or reorder the
  existing `{ok, policyVersion, findings}` keys that downstream Preflight verdict parsing reads —
  a fixture must assert the existing keys survive unchanged alongside `nowMs`.
- **TDZ**: getting `_findingCodesFor`'s guard wrong (e.g. shipping the literal `_ledger?.map(...)`
  form) crashes the four pre-ledger terminal exits with `ReferenceError` — a regression in
  failure-path telemetry that is itself terminal. Needs its own fixture invoking a pre-ledger exit
  and asserting a clean `[reason]` result.
- **Read amplification**: the recurrence scan is O(n) `JSON.parse` per write over a task's archive.
  Acceptable at observed scale (single-digit generations; DIR-126-E has 4); called out as a
  Non-goal, not silently ignored.
- **`REQUIRED_TOP` latent trap**: forward-only-safe today, but a future re-validate-all sweep would
  invalidate every pre-this-task record — code comment required at :437.
- **Command-line length**: bounded in practice by existing round caps (`MAX_PLANCHECK_ROUNDS` = 3,
  `_maxDeltaRounds` policy cap) and ledger size, but an unusually large `_ledger` could lengthen
  the `--findingCodes` payload — an optional sanity bound is Plan-discretionary.
- **The live-dispatch AC cannot be unit-satisfied**: "admission-touching dispatch count ==
  phase-transition entry count" on a real multi-round generation requires a real post-landing
  `prepare-milestone` dispatch examined via its committed record/journal, matching the DoD's "real,
  non-fixture evidence" bar. Must stay explicit in the Plan so it is never quietly downgraded to a
  mocked-agent check.

### Non-goals

- Not redesigning `.generation.json`'s v1 shape, `decideResumeGeneration`, or any landed
  lease/preflight/resume mechanics.
- Not `phase()`-exact timing granularity — no new dispatch exists purely for a timestamp.
- Not a new committed-artifact type — both fields live inside the existing record.
- Not a recurrence index/cache file — the committed archive is scanned directly (single source of
  truth); no O(n) optimization until real counts justify it.
- Not carrying full finding objects (severity/disposition/evidence) into `findingCodes[]` — only
  the identity quad; the ledger file stays the one home for full detail.
- Not extending any read-only report mode to aggregate/surface the new fields — natural follow-up
  once recurrence data accumulates.
- Not backfilling pre-this-task records, not pruning/compacting history.
- Not fixing the `scripts/test.sh` glob gap for `experiments/quay-perpetual-stream/test/` — a
  grounding fact for evidence-gathering, not this task's repair.
- Not changing convergence caps or round limits — this task observes and records, never gates.

### AC coverage

Mapping to the task's existing 11 AC bullets (5 original + 6 round-added), with claims C1-C9 from
the wiring-claim registry above:

- **AC1** (additive `nowMs`; zero new `Date.now()`/`import()` in the workflow; grep guard): covered
  by Mechanism 1's CLI-boundary placement (C1), the explicit `round` parameter (C2), receiver-side
  span-close (C5), and AC19 reuse. Clarify wording: all six admission modes fixture-asserted
  individually on success AND error paths (C1 doubles as AC10's coverage), with the
  preflight-key-preservation sub-assertion.
- **AC2** (dispatch count == entry count on a real multi-round generation incl. a delta round and a
  PlanCheck round): covered by `_lastBoundaryMs`-pairing (C3/C4) + receiver-side close (C5).
  Clarify wording: "phase-dispatch count" = **admission-touching** dispatch count (acquire + 6
  renewal classes + terminal), since timing granularity is renewal-bounded by design — plus the
  real post-dispatch journal check flagged under Risks.
- **AC3** (`findingCodes[]`/`recurrenceKey`/`firstSeenGeneration`/`lastSeenGeneration`;
  two-generation fixture pinning `firstSeenGeneration` while `lastSeenGeneration` advances):
  covered by C6/C7/C8. Needs dedicated fixtures for (a) all 7 pre-ledger terminal classes each
  producing non-empty `findingCodes` from the reason alone (C6); (b) a corrupted/pre-this-task
  sibling skipped without aborting the current write (C7); (c) `attemptId`-keyed recurrence at the
  3 pre-lease sites proven separately from `generationId`-keyed recurrence.
- **AC4** (mirror parity): covered by `cmp` + `plugin/scripts/sync-vendor.sh --check` over every
  edited pair, explicitly including the workflow mirrors (both already in Touches); a fixture
  naming and diffing every touched mirror pair.
- **AC5** (recurrence scan stays local; zero new import edges / grounding that the three writing
  submodes are the exact extension points): reconfirmed this round by direct source read
  (`_writeCommittedTelemetry` :653, `_decideResumeCli` :512/:565 inline block, `_recordAttemptCli`
  :738; `--release-only` writes nothing) — evidence, not new code; the local-helper decision (C7)
  keeps zero new import edges.
- **AC6** (`REQUIRED_TOP` fails closed with `telemetry-field-missing`): covered by C8/C9, plus the
  grounding check that `validateTelemetryRecord` is invoked only pre-write, never on records read
  back from disk.
- **AC7** (`round` explicit, never regex-parsed; construction reads only parsed `nowMs` and
  in-scope vars): covered by C2/C3/C4 and the `_recordPhaseBoundary` source.
- **AC8** (missing/unparseable `nowMs` fail-soft): covered by the conditional push /
  unchanged-`_lastBoundaryMs` rule (C3).
- **AC9** (all 7 pre-ledger terminal-return classes produce non-empty `findingCodes[]`): covered by
  `_findingCodesFor` + the `_ledgerLive` guard (C6) — **the AC grounding identifier now cites the
  TDZ-safe `_ledgerLive ? _ledger.map(f=>f.id) : []` short-circuit-guarded form (the
  `_ledger?.map(f=>f.id) ?? []` shorthand was TDZ-unsafe and has been corrected)**, plus a
  pre-ledger-exit TDZ fixture.
- **AC10** (all six CLI modes gain `nowMs`, individually fixtured): covered by C1, including both
  preflight modes via the non-clobbering spread.
- **AC11** (exhaustive identifier grounding): every identifier cited was confirmed by direct source
  read this round; corrections vs inherited text: `sync-vendor.sh`'s real path is
  `plugin/scripts/sync-vendor.sh`; renewal success is `ok: true`, not an `outcome: 'renewed'`
  literal; experiments-side test evidence cites `node --experimental-strip-types --test`.
- **Additional fixtures recommended for PlanAuthor**: (1) both `--record-generation` helpers (:181
  and :195) carry the new flags while `--release-only` (:200) does not; (2) the trailing open
  span's `endedAtMs` equals the receiver's `recordedAtMs`, never a sandbox value; (3)
  `--findingCodes`/`--phaseTimings` construction reads exclusively from already-parsed
  `_parseAgentJson(...).nowMs` values and the existing `_ledger`/`_deltaRound`/`_planCheckRound`
  variables.
- **DoD** (real, non-fixture production callsite): satisfied DIR-126-D-style — a real
  `prepare-milestone` dispatch's committed record inspected post-hoc for non-`[]`
  `phaseTimings`/`findingCodes`, plus an independent diff audit. Notably, this task's own archive
  already holds `dd06ce1ed5b8.json` (`split-recommended`), so the first post-landing generation for
  this very `taskId` exercises the recurrence scanner against a real prior record.

### Alternatives considered and rejected

1. **Compute timestamps inside `prepare-milestone.js` (`Date.now()`/`new Date()`).** Rejected: the
   sandbox throws (AC19 fixture) — the exact class of two real production crashes already paid for
   twice (`f6db2a8`, `7357a91`); `acquireLease`'s own `missing-now` error (:174) forbids it in the
   code's own words.
2. **A dedicated new CLI script for timing/recurrence.** Rejected: the task's scope names the two
   existing files; a third fragments single-record ownership and adds another mirror pair.
3. **Seed `startedAtMs`/`endedAtMs` purely from the sandbox's existing
   `_now()`/`_latestKnownNowMs` clock (:421/:516/:777) with NO subprocess change.** Considered
   seriously because that clock already exists and is AC19-compliant. Rejected as the PRIMARY
   mechanism (kept as the consistent posture the chosen design reuses): (a) the charter-named
   deliverable is explicitly "add per-phase-boundary `nowMs` self-reporting to
   `prepare-admission-check.ts`'s JSON output", which a sandbox-only change would not satisfy; (b)
   `_now()` returns agent-turn-boundary-approximate times (the last agent that ran `date`), whereas
   `_renewLease`/`--acquire` subprocess self-report gives dispatch-boundary-exact times aligned to
   the lease transition being measured; (c) `_now()` is not advanced at the six renewal boundaries
   today, so using it would still require wiring at each site — for strictly coarser data.
4. **A new agent dispatch per phase boundary purely for a timestamp.** Rejected: all 6 boundaries
   already dispatch `_renewLease`; doubling agent turns for a timestamp is pure cost when
   piggybacking is free.
5. **Also stamp `nowMs` onto `--decide-resume`'s output for symmetry.** Rejected: it is not a phase
   boundary (early-returns before `phase('Preflight')` :304) and no accumulation path reads it — an
   unread field violates every-field-has-a-reader discipline. (Trivially reversible if a reviewer
   wants symmetric self-reporting.)
6. **Close the trailing open span in the sandbox** using the last boundary's timestamp. Rejected:
   it would embed an inaccurate end time and violate the subprocess-computed-time discipline;
   receiver-side closing with `recordedAtMs` is both more accurate and constraint-compliant.
7. **Regex-parse `round` from `stageLabel`** (`/round-(\d+)$/`). Rejected: a formatted label is
   presentation; coupling a parser to its format is a fragile second source of truth for data the
   caller already holds as an integer.
8. **Optional-chained `_ledger?.map(f=>f.id) ?? []`** for finding-code construction. Rejected: `?.`
   does not bypass the temporal dead zone — at the four pre-ledger exits `_ledger` is an
   uninitialized module `let` and any reference throws `ReferenceError`. The `_ledgerLive`
   short-circuit guard is the minimal correct form.
9. **Bump `schemaVersion` to 3.** Rejected as the default (reviewer-adjustable): nothing
   re-validates history, so a bump adds no safety and departs from the precedent of reserving bumps
   for new record families.
10. **Import `queryTelemetryReport` for the prior-record scan.** Rejected: a 4th edge onto the
    verified 3-file import cycle for a ~15-line locally-reimplementable primitive.
11. **In-memory recurrence tracking within one generation.** Rejected: each generation is a fresh
    process with no persistent state; only the committed archive survives across generations, so
    cross-generation recurrence is computable only in the subprocess that already reads/writes that
    tree.
12. **A separate committed file for timings/codes.** Rejected: both are extensions to the telemetry
    record already in production; a second file would need its own hash-binding/staleness story
    duplicating `buildTelemetryRecord`/`validateTelemetryRecord`.
13. **Carry full typed finding objects into `findingCodes[]`.** Rejected: duplicates the ledger
    into a second location — the drift risk this repo's single-source-of-truth principle warns
    against.
14. **Record a boundary for failed renewals that still carry `nowMs`.** Rejected: `ok: false` (e.g.
    `lease-missing`) means the phase may not have executed; recording it would falsify the
    timeline. The push rule requires success AND a finite `nowMs`.

## Finding

`experiments/quay-perpetual-stream/charters/M203-dir126d-prepare-telemetry.md`'s own Scope/Done-when
text was directly grepped during DIR-126-D's ProposalReview round 7 (`grep -in
'phase|finding|recurrence|mechanical|content.*agent|dispatch count'`) and confirmed to name only:
one committed record per dispatch attempt (written by whichever phase produces the terminal
outcome), a `--telemetry` hash-binding flag on `milestone-preparation-check.ts --build`, and a
`--telemetry-report <milestoneId>` read-only query mode. Neither granular per-phase-boundary timing
nor recurrence tracking is named anywhere in the charter text — both were added during DIR-126-D's
own iterative ProposalReview fix cycle (the "Forward-compatible feedback identity" AC bullet that
introduced `findingCodes[]` was itself an earlier round's reviewer addition, not a charter
requirement; the `nowMs`/phase-timing idea was a plausible-but-unverified reading of the charter's
title phrase "phase telemetry"). Once DIR-126-D's own scope grew to include them, ProposalReview's
`mechanismCount` (an LLM-judged count of independently-landable mechanisms in the Proposal) stayed
stuck above the `split-multi-mechanism` threshold across two rounds of pure document-structure
consolidation — trimming these two ideas out (verified against the real charter, not assumed) was
the fix that let DIR-126-D actually converge.

## Requested action

1. **Phase-boundary timing.** Extend `prepare-admission-check.ts` (+ `plugin/scripts/` mirror) with
   one additive `nowMs: Date.now()` field on its JSON stdout, computed inside the real subprocess
   (never inside the sandboxed `prepare-milestone.js` itself — that constraint is load-bearing, see
   `gap-prepare-milestone-workflow-dynamic-import`). Extend DIR-126-D's landed
   `--record-generation`/`--decide-resume`/`--record-attempt` calls the same way. Accumulate
   `{phase, round, startedAtMs, endedAtMs}` entries into DIR-126-D's committed telemetry record
   (a new array field, additive to DIR-126-D's frozen schema — no renames/removals of what
   DIR-126-D itself lands). Requires its own AC coverage for the two confirmed
   `Date.now()`/`import()` production-crash precedents (`f6db2a8`, `7357a91`) via a grep-based
   regression guard, matching DIR-126-D's own established bar.
2. **`findingCodes[]` recurrence tracking.** One entry per stable finding code a terminal carries
   (at minimum `terminal.reason`, plus each ProposalReview ledger finding's own code).
   `recurrenceKey = sha256(taskId::code).slice(0,12)`; `firstSeenGeneration`/`lastSeenGeneration`
   populated by scanning DIR-126-D's already-committed prior records for a matching
   `recurrenceKey` — a plain glob+JSON-parse read inside `proposal-convergence.ts`, no new
   dispatch. Requires a dedicated fixture spanning two real generations of the same task with a
   repeated finding code, confirming `lastSeenGeneration` advances while `firstSeenGeneration`
   stays pinned.
3. Author a charter (or extend an existing one) that names both explicitly in its own Scope
   section, so a future ProposalReview round doesn't have to re-derive charter-mandate status from
   scratch the way this deferral did.

## Acceptance Criteria

- [ ] `prepare-admission-check.ts` (both mirrors) gain an additive `nowMs: Date.now()` field;
  `prepare-milestone.js` (both mirrors) accumulates `{phase, round, startedAtMs, endedAtMs}` purely
  by reading already-parsed subprocess output — zero new `Date.now()`/`new Date()`/`import()` call
  sites added to `prepare-milestone.js` itself, verified by a grep-based regression fixture.
- [ ] A real multi-round generation's journal (including a `ProposalReview` delta round and a
  `PlanCheck` round) has its phase-dispatch count confirmed equal to the telemetry record's own
  phase-transition entry count.
- [ ] `findingCodes[]` with `recurrenceKey`/`firstSeenGeneration`/`lastSeenGeneration` is added to
  the committed telemetry record (additive to DIR-126-D's frozen schema); a fixture spanning two
  real generations with a repeated finding code confirms `lastSeenGeneration` advances while
  `firstSeenGeneration` stays pinned.
- [ ] Byte-identical mirrors re-verified (`cmp`/`sync-vendor.sh --check`) across every file this
  child touches, including the newly-touched `prepare-admission-check.ts`.
- [ ] **Recurrence scan stays a local helper, never a new import edge:** an import-graph check
  (grep/AST) confirms zero new `import` statements are added between `proposal-convergence.ts` and
  `milestone-preparation-check.ts` — the recurrence scan reuses `_safeTaskIdSegment`/`telemetryPath`
  as a local helper within `proposal-convergence.ts` itself.
- [ ] **`REQUIRED_TOP` extension fails closed (direct validator unit test):** a fixture calling
  `validateTelemetryRecord` directly with a record missing either `phaseTimings` or `findingCodes`
  confirms it returns `telemetry-field-missing`. This is a unit test of the validator itself — the
  gate on the reuse-terminal path (its sole live call at :582) — NOT a gate on every write: the
  main writes (`_writeCommittedTelemetry` :653, `_recordAttemptCli` :738) do not call
  `validateTelemetryRecord` and instead rely on `buildTelemetryRecord`'s always-materialize
  discipline. Distinct from the already-covered "fields are added to the record" claim above.
- [ ] **`round` is threaded explicitly, never regex-parsed from `stageLabel`:** a fixture confirms
  `_phaseTimings`/`--findingCodes` construction reads exclusively from already-parsed
  `_parseAgentJson(...).nowMs` values and the existing `_ledger`/`_deltaRound`/`_planCheckRound`
  variables — no `Date.now()`, no regex-parsing of `stageLabel` to recover `round`.
- [ ] **Missing/unparseable `nowMs` degrades fail-soft:** a fixture forcing a boundary's `nowMs` to
  be absent/unparseable confirms no `_phaseTimings` entry is pushed for that boundary and
  `_lastBoundaryMs` is left unchanged — distinct from the happy-path multi-round journal item above.
- [ ] **Receiver-side trailing-span close uses its own `recordedAtMs`, never a sandbox value
  (CLAIM C5, load-bearing for AC19):** a fixture feeding a `phaseTimings` array whose final entry is
  `{..., endedAtMs: null}` confirms the receiver (`proposal-convergence.ts`, before
  `buildTelemetryRecord`) fills that trailing `endedAtMs` with its own already-computed
  `recordedAtMs` — the filled value equals `recordedAtMs` exactly, and no sandbox-side
  `Date.now()`/`new Date()` is used anywhere in the construction (re-verified by the AC19 guard).
  This is the positive assertion that the trailing span is closed on the receiver side; distinct
  from the fail-soft item above (which covers a missing/unparseable boundary, not the trailing
  close).
- [ ] **All 7 pre-ledger terminal-return classes produce `findingCodes[]`:** the 3 pre-lease
  `_recordAttemptAgentCall` exits (`missing-required-args`, `admission-check-failed`,
  `prepare-already-running`) and the 4 pre-ledger `_releaseLeaseAndRecord` exits
  (`proposal-author-incomplete`, `adjudicate-failed`, plus the 2 pre-`let _ledger = []`
  `preflight-rejected`-shaped exits) each independently produce a non-empty `findingCodes[]` seeded
  from `terminal.reason` alone — distinct from the general `findingCodes[]` item above.
- [ ] **All six `prepare-admission-check.ts` CLI modes gain `nowMs` (success AND error paths, keys
  preserved):** acquire, renew, release, force-release, preflight, and preflight-plan are each
  individually fixture-verified to carry the additive `nowMs` field in their JSON output on BOTH
  the success path AND the error path (`{ok:false,...}` shapes); and — for the preflight/preflight-
  plan modes specifically, which print the returned `runPreflightChecks` object directly via a
  non-clobbering `{...result, nowMs}` spread — the existing `{ok, policyVersion, findings}` keys
  survive unchanged (a fixture asserts the spread adds `nowMs` without dropping or clobbering any
  pre-existing key, since downstream Preflight verdict parsing depends on those keys).
- [ ] Grounding evidence (exhaustive identifiers, wiring-coverage completeness): confirmed real by
  direct source read that DIR-126-D's landed `--record-generation`, `--decide-resume`, and
  `--record-attempt` calls are the exact three extension points this child's phase-timing field
  attaches to, matching Requested action item 1 above. Exhaustive identifier grounding covering
  every Problem-framing/Chosen-mechanism/Key-design-decision/Risks claim above, confirmed real by
  direct source read of the current tree (`.claude/workflows/prepare-milestone.js`,
  `plugin/workflows/prepare-milestone.js`, `experiments/quay-perpetual-stream/scripts/{prepare-
  admission-check.ts,proposal-convergence.ts}`, `plugin/test/prepare-milestone-convergence.test.mjs`)
  — every one of these is an already-real, already-landed name or a genuinely new design-decision
  identifier introduced by this same document, not a new invention: `--acquire`, `--build`,
  `--decide-resume`, `--detail`, `--findingCodes`,
  `--findingCodes <json-of-[terminal.reason,...(_ledgerLive ? _ledger.map(f=>f.id) : [])]>`,
  `--phaseTimings`, `--phaseTimings <json>`, `--record-attempt`,
  `--record-generation`, `.claude/workflows/prepare-milestone.js`, `.lease`, `.nowMs`, `.ok`,
  `.outcome`, `.reclaimed`, `.telemetryWriteOk`, `7357a91`, `AC19`, `Adjudicate`, `Date.now()`,
  `JSON.stringify`, `PlanAuthor`, `PlanCheck-round-${_planCheckRound}`, `Preflight`,
  `ProposalAuthors`, `ProposalReview`, `ProposalReview-delta-round-${_deltaRound}`, `Receipt`,
  `_admissionVerdict`, `_cliMain`, `_decideResumeCli`, `_deltaRound`, `_lastBoundaryMs`,
  `_lastBoundaryMs = r.nowMs`, `_ledger`, `_ledgerLive`, `_parseAgentJson`, `_phaseTimings`,
  `_planCheckRound`,
  `_recordAttemptAgentCall`, `_recordAttemptCli`, `_recordGenerationCli`, `_releaseLeaseAndRecord`,
  `_releaseLeaseOnlyCli`, `_renewLease`, `_renewLease(stageLabel)`, `_renewLease(stageLabel, round)`,
  `_writeGenerationTelemetry`, `_writeGenerationTelemetry(...)`, `_writeGenerationTelemetryCli`,
  `_writeTelVerdict`, `adjudicate-failed`, `admission-check-failed`, `await _renewLease(stageLabel)`,
  `buildTelemetryRecord`, `buildTelemetryRecord({..., phaseTimings, findingCodes})`, `cmp`,
  `console.log(JSON.stringify(...))`, `const r = await _renewLease(stageLabel, round);
  _recordPhaseBoundary(stageLabel, round, r)`, `endedAtMs: null`, `f6db2a8`, `findingCodes`,
  `findingCodes = [terminal.reason]`, `findingCodes[]`, `fingerprintFinding`, `firstSeenGeneration`,
  `gap-prepare-milestone-noisy-agent-raw-json-parse`, `id`, `import`, `import()`,
  `lastSeenGeneration`, `let`, `let _ledger = []`, `main()`, `missing-required-args`, `new Date()`,
  `now`, `nowMs`, `phase`, `phase()`, `phaseTimings: []`, `plugin/test/prepare-milestone-convergence.
  test.mjs`, `plugin/workflows/prepare-milestone.js`, `prepare-admission-check.ts`,
  `prepare-already-running`, `prepare-milestone.js`, `proposal-author-incomplete`,
  `proposal-convergence.ts`, `r.raw`, `reason`, `recordedAtMs`, `recurrenceKey`, `return
  _admissionAgentCall(...)`, `round`, `stageLabel`, `terminal.reason`, `zero LIVE (non-comment)
  Date.now()/new Date(/await import(/bare import( call sites`, `{phase, round, startedAtMs:
  _lastBoundaryMs, endedAtMs: verdict.nowMs}`, `{phase: stageLabel, round, startedAtMs:
  _lastBoundaryMs, endedAtMs: r.nowMs}` — confirmed real by direct source read of the current tree,
  not a new invention. Round-2 additionally flagged these exact identifier forms, not yet
  co-located in this bullet, confirmed real by the same direct-source-read standard: `(`,
  `) — every one a bare`, `),`, `, up to`, `--acquire`, `--decide-resume`, `--detail`,
  `--findingCodes <json>`, `--force-release`, `--phaseTimings`, `--phaseTimings <json>`,
  `--preflight`, `--preflight-plan`, `--record-attempt`, `--record-generation`,
  `--record-generation --no-release`, `--release`, `--renew`, `:1103`, `:147`, `:171`, `:372`,
  `:407`, `:512-587`, `:601-718`, `:653`, `:738`, `DIR-126-E/2a107fcb5cc9.json`,
  `_ledger.map(f => f.id)`, `_recordAttemptCli`, `_renewLease(stageLabel)`,
  `_writeCommittedTelemetry`, `computeAttemptId`, `console.log(JSON.stringify(...))`,
  `const now = Date.now()`, `generationId: null`, `main()`, `now`, `recordedAtMs`,
  `return _admissionAgentCall(...)`, `times),`, `{..., endedAtMs: null}` — all confirmed real by
  direct source read of the current tree, not a new invention. Also citing these exact bare literal
  forms (distinct as text from the already-covered `--`/`_`/bracket-qualified forms above):
  `validateTelemetryRecord`, `REQUIRED_TOP`, `phaseTimings`, `findingCodes`, `highRisk`,
  `prepare-admission-check.ts`, `proposal-convergence.ts`, `prepare-milestone`, `_renewLease`,
  `nowMs`, `_parseAgentJson` — all confirmed real by the same direct-source-read standard.
  Round-4 additionally flagged these exact-form identifiers (confirmed real by direct source read of the current tree, per the Problem-framing topology correction above): `acquireLease`, `"missing-now: a real epoch-ms 'now' is required (workflow scripts cannot call Date.now(); this CLI computes it itself when run directly)"`, `preflight-check-failed`, `preflight-rejected`, `_releaseLease`, `--release-only`, `--record-generation [--no-release]`, `?? []`.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline (touches `prepare-admission-check.ts`, not
  previously touched by DIR-126-D's own trimmed scope).
- [ ] Real, non-fixture evidence: a fresh independent audit confirms the real production callsite
  for both the phase-timing self-report and the recurrence-tracking read, not merely unit-test
  reachability.

## Touches

- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- plugin/scripts/prepare-admission-check.ts
- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- plugin/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs
- plugin/test/prepare-admission-check.test.mjs
- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- .claude/workflows/prepare-milestone.js
- plugin/workflows/prepare-milestone.js
- plugin/test/prepare-milestone-convergence.test.mjs
