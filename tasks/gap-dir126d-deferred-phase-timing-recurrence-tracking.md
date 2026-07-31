---
id: gap-dir126d-deferred-phase-timing-recurrence-tracking
title: DIR-126-D deferred two enrichment ideas that were never actually
  charter-mandated -- per-phase-boundary timing (nowMs threaded through
  prepare-admission-check.ts, a {phase, round, startedAtMs, endedAtMs}
  breakdown) and findingCodes[] recurrence tracking (recurrenceKey,
  firstSeenGeneration, lastSeenGeneration) -- record them as real,
  well-specified follow-up work
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    gap-dir126d-deferred-phase-timing-recurrence-tracking
    experiments/quay-perpetual-stream/charters/M207-gap-dir126d-deferred-enrichment.md
    milestones/M207/absorb-entry.md
---
## Proposal

### Problem framing (grounded in a fresh read of the current tree, 2026-07-30)

DIR-126-D/M203 (landed `6a24bf3`) shipped a production-wired, committed per-attempt telemetry
record. During its own ProposalReview convergence two enrichment ideas were added in-flight and then
deliberately trimmed once a direct grep of the M203 charter's Scope/Done-when confirmed neither was
charter-mandated — that trim is what let DIR-126-D's `mechanismCount` drop below the
`split-multi-mechanism` threshold. The M207 charter
(`experiments/quay-perpetual-stream/charters/M207-gap-dir126d-deferred-enrichment.md`) now explicitly
scopes both in its own words — "add per-phase-boundary `nowMs` self-reporting to
`prepare-admission-check.ts`'s existing JSON output (additive field only…)" and
"`findingCodes[]`/`recurrenceKey`/`firstSeenGeneration`/`lastSeenGeneration` to the committed
telemetry record's frozen schema" — so this is re-chartered follow-up work, not re-litigation; no
future round re-derives mandate status from scratch. Every structural claim below was re-derived by
reading the current sources directly this round, not inherited from the prior task body.

**The landed record (what we extend, do not reshape).** `proposal-convergence.ts` (byte-identical
`plugin/scripts/` mirror, `cmp`-verified) materializes the record in exactly one place —
`buildTelemetryRecord` (:392) — which always materializes all 18 keys (each with an explicit
`?? null` / `=== undefined ? null` no-fabrication discipline), and freezes `schemaVersion: 2` via
`TELEMETRY_SCHEMA_VERSION` (:360, applied :402). `validateTelemetryRecord` (:430) holds a
`REQUIRED_TOP` array of exactly those 18 keys (:437-441) and fails closed with
`telemetry-field-missing` (:444). Critically, the validator has **exactly one live call site** —
inside `_decideResumeCli`'s reuse-terminal branch (:582). The two high-volume writers,
`_writeCommittedTelemetry` (:653, used by `--record-generation` with and without `--no-release`,
`buildTelemetryRecord` :658, `recordedAtMs: Date.now()` :668) and `_recordAttemptCli` (:738, the three
pre-lease sites, `buildTelemetryRecord` :746, `generationId: null`, keyed by `computeAttemptId` :384),
do **not** call the validator at all — they lean on `buildTelemetryRecord`'s always-materialize
guarantee. `_cliMain` (:766) routes the three submodes. This asymmetry is load-bearing for the
compatibility story below. Confirmed on-disk records (`milestones/prepare-telemetry/DIR-126-E/2a107fcb5cc9.json`,
and three already written for THIS task's own `taskId`: `dd06ce1ed5b8.json`, `86de375b56db.json`,
`ffc333d19352.json`) match the 18-key set byte-for-byte (`dd06ce1ed5b8` carries
`terminal: {outcome: "needs-human", reason: "split-recommended", phase: "ProposalReview", cacheable: true}`).
A repo-wide grep for `phaseTimings|findingCodes|recurrenceKey|firstSeenGeneration|lastSeenGeneration|
_lastBoundaryMs` across both `scripts/` mirrors and both workflow mirrors returns **zero hits** — this
is genuinely greenfield, not a rename. Notably, this task's own archive already holds a genuinely
recurred code (`split-recommended`, twice), so the first post-landing generation for this taskId
exercises the recurrence scanner against real prior history — the DoD's real-evidence bar is reachable
without a synthetic fixture task.

**The timing source (already computed, currently discarded).** `prepare-admission-check.ts`'s CLI
`main(argv)` (:601) selects one of six mutually-exclusive modes (usage :603:
`--acquire|--renew|--release|--force-release <reason>|--preflight|--preflight-plan`; dispatch :631-643),
computes exactly one `const now = Date.now()` (:648) shared by every mode, injects it into the pure
decision functions (e.g. `renewLease({workspace, taskId, stage, now})` :190), and never emits it. The
architecture already endorses CLI-side time computation in its own words: `acquireLease` fails closed
at :173-177 with `"missing-now: a real epoch-ms 'now' is required (workflow scripts cannot call
Date.now(); this CLI computes it itself when run directly)"`. The timestamp is real subprocess
wall-clock, already paid for, thrown away. The print sites are **non-uniform**, which matters:
`acquire` (:688), `renew` (:693), `release` (:698), `force-release` (:708) print locally-built `result`
objects, but `preflight` (:662) and `preflight-plan` (:672) print the object RETURNED by
`runPreflightChecks(...)` directly, and there are three inline error literals (:653 task-file-not-found,
:667 planFile-not-found, :678 `missing-session-id`) plus a catch-all `admission-check-failed` (:711,
exit 2). Verdict shapes also differ by mode: `acquire` is `outcome`-keyed (success test
`result.outcome === "acquired"` at :689); `renew` is `ok`-keyed (`renewLease` returns `{ok: true, lease}`
on success at :196, `{ok: false, error: "lease-missing"|"missing-now"}` on failure at :192-193; CLI exits
`result.ok ? 0 : 1` at :694). The renewal-success signal is `ok === true`, not an invented
`outcome: "renewed"` literal.

**The consumer (a sandbox that must not touch a clock).** `.claude/workflows/prepare-milestone.js`
(byte-identical `plugin/workflows/` mirror, confirmed by `cmp`) is a sandboxed workflow-DSL file with
zero `import` statements. `_renewLease(stageLabel)` (:147) is a one-liner returning
`_admissionAgentCall(...)` (:134; the agent reports the CLI's stdout as `{raw}`), dispatched at exactly
six static sites — `Adjudicate` (:372), `ProposalReview` (:407),
`` `ProposalReview-delta-round-${_deltaRound}` `` (:577), `PlanAuthor` (:638),
`` `PlanCheck-round-${_planCheckRound}` `` (:719, loop cap `MAX_PLANCHECK_ROUNDS = 3` :714/:717),
`Receipt` (:755) — and every response is **100% discarded today** (bare `await _renewLease(stageLabel)`).
This task is the first code to read anything out of a renewal response. By contrast `--acquire`'s
response is already parsed today (`_admissionVerdict = _parseAgentJson(_admissionResult.raw)` :221, with
`.outcome` checked :223 and `.lease?.fencingToken`/`.reclaimed` read :238), and
`--record-generation --no-release`'s response is already parsed at the Receipt write
(`_writeTelVerdict = _parseAgentJson(_writeTelResult.raw)` :805, read for `.ok`/`.telemetryWriteOk` :807,
`.telemetryFile` :812) — the live precedent for reading a parsed terminal-dispatch verdict.
`_parseAgentJson` (:32, a balanced-brace scanner that tries every `{` offset, never naive `JSON.parse`)
exists because agent stdout carries non-JSON noise (`gap-prepare-milestone-noisy-agent-raw-json-parse`);
every new parse must route through it.

The sandbox is **not** clock-blind, but its existing clock is agent-turn-granular: an AC19-compliant
`_now = (typeof $a.now === 'function') ? $a.now : () => _latestKnownNowMs` (:421, `_latestKnownNowMs`
:420), seeded from dispatched agents told to run `date +%s%3N` and return `nowMs` (:505, :608), already
feeding `_startedAtMs`/`_endedAtMs` (:422/:516/:777) threaded into the convergence JSON (:791-792). That
is the pre-existing posture this task reuses ("a subprocess/agent computes the clock; the sandbox only
reads a cached number"), but it is not advanced at the six renewal boundaries and is strictly coarser
than dispatch-boundary-exact subprocess self-report.

**The load-bearing sandbox constraint.** `plugin/test/prepare-milestone-convergence.test.mjs` AC19
(:1103) greps each workflow mirror (it iterates per-mirror via `[${mirrorName}]`) with comment-stripping
for zero LIVE `Date.now()` (:1107), `new Date(` (:1108), `await import(` (:1109), and bare `import(`
(:1110) sites, citing two real production-crash commits (`f6db2a8`, `7357a91`) as the regression class.
Any timestamp the workflow touches must be read out of already-parsed subprocess JSON, never computed
locally.

**A TDZ hazard the design must respect.** `let _ledger = []` is declared at :444, textually AFTER
`_releaseLeaseAndRecord`'s definition (:175) and after four terminal exits that call it — :313
(`preflight-check-failed`), :323 (`preflight-rejected`), :366 (`proposal-author-incomplete`), :390
(`adjudicate-failed`). Optional chaining does **not** bypass the temporal dead zone: `_ledger?.map(…)`
still evaluates the binding at those sites and throws
`ReferenceError: Cannot access '_ledger' before initialization`. Finding-code construction must
therefore use a boolean-flag short-circuit guard, never the literal `_ledger?.map(f=>f.id) ?? []` form.

**Terminal-write topology (all verified by direct read).** `_releaseLeaseAndRecord` (:175) has 13 call
sites — 4 pre-ledger (:313/:323/:366/:390) and 9 post-ledger (:552, :595, :621, :626, :631, :670, :686,
:701, :749) — and dispatches `--record-generation` (command string at :181, fire-and-forget per the :171
comment). `_writeGenerationTelemetry` (:193) dispatches `--record-generation --no-release` (:195, the
Receipt success path at :804) and its response IS parsed (:805). `_recordAttemptAgentCall` (:76)
dispatches `--record-attempt` with the double-`JSON.stringify` `--detail` idiom (:83) from the 3
pre-lease exits (:90 `missing-required-args` / :228 `admission-check-failed` / :234
`prepare-already-running`). Bare `_releaseLease` (:200) dispatches `--release-only`, which writes
nothing; its three sites are :809 (`telemetry-write-failed` — the one terminal that writes NO record,
because :804's write already failed), :837 (`receipt-selfcheck-failed`) and :847 (`prepared`/final, both
after :804 already persisted). There are 11 live `phase()` calls (:130/:304/:336/:338/:342/:371/:406/
:637/:679/:710/:754 — the raw `grep -c` of 16 includes 5 in-code comment mentions at :121/:245/:246/:248/
:278), but only 6 renewal boundaries — so renewal-bounded timing is a deliberate, quantified coarsening.

**Reusable primitives that already exist (so we add, not reinvent).** `telemetryPath(workspace, taskId,
recordId)` (:370, with the `_missing-taskId` fallback at :371) built on `_safeTaskIdSegment` (:341);
`computeAttemptId` (:384) and `_computeGenerationId` (:478) sharing the `sha256(...).slice(0,12)` identity
idiom `fingerprintFinding` (:64) already uses; `_writeTelemetryRecord` (:469) as the write primitive; and
`milestone-preparation-check.ts`'s tolerant tree walk with a malformed-file-skip precedent
(`// Malformed telemetry file — skipped, never crashes the report query.` :172-173). The import graph
already forms a 3-file cycle (verified by grepping every relative import): `prepare-admission-check.ts`
:45 → `milestone-preparation-check.ts` :26 → `proposal-convergence.ts` :27 → `prepare-admission-check.ts`.
Any new helper must not tighten it.

**Reachability/mirror facts for evidence.** `scripts/test.sh`'s canonical glob (:37) is
`packages/*/test/*.test.mjs plugin/test/*.test.mjs` — it does NOT reach
`experiments/quay-perpetual-stream/test/*.test.mjs`. `experiments/.../test/proposal-convergence.test.mjs`
exists and is a Touches entry, but there is NO `plugin/test/proposal-convergence.test.mjs` (confirmed
absent), so AC evidence for that file must cite a direct `node --experimental-strip-types --test`
invocation, never a green `scripts/test.sh` run. `plugin/test/prepare-admission-check.test.mjs` and
`plugin/test/prepare-milestone-convergence.test.mjs` ARE covered. `sync-vendor.sh` lives at
`plugin/scripts/sync-vendor.sh` (NOT `scripts/sync-vendor.sh`); the three edited mirror pairs (both
`scripts/` files and the workflow, each with its `plugin/` mirror) are byte-identical pre-task (`cmp`).

### Chosen mechanism

Two independent, purely-additive extensions layered onto the landed pipeline, confined to the task's
Touches list, reshaping nothing DIR-126-D landed. Each new call/dispatch/ownership/enforcement
relationship is flagged as a numbered wiring claim (DIR-117) so the review phase can confirm a matching
AC bullet.

**Mechanism count for THIS Proposal: `mechanismCount = 2` — stated explicitly, not merely narrated
from DIR-126-D's trim history.** Mechanism 1 = per-phase-boundary timing; Mechanism 2 = `findingCodes[]`
recurrence tracking. These two are the exact scope the M207 charter
(`experiments/quay-perpetual-stream/charters/M207-gap-dir126d-deferred-enrichment.md`) names in its
own words (additive per-phase-boundary `nowMs` self-reporting; `findingCodes[]`/`recurrenceKey`/
`firstSeenGeneration`/`lastSeenGeneration` on the committed record), so the charter is the scope
authority and governs. A clean further split is awkward and would NOT reduce risk: both mechanisms
share the same write-site infrastructure — both widen `REQUIRED_TOP`, both add fields to
`buildTelemetryRecord` (:392), and both thread their flags onto the SAME `--record-generation` /
`--record-attempt` dispatches — so separating them would duplicate the dispatch-plumbing work across
two milestones without isolating any independent failure mode. The count of 2 (>2 is the
split-multi-mechanism trigger) is acceptable here precisely because the charter deliberately scopes
both and the human coordinator confirms this grouping at cutover (the same human-steered confirmation
point DIR-126-D's `b8b87c3` ruling established).

**Mechanism 1 — per-phase-boundary timing.**

1. `prepare-admission-check.ts` `main()` stamps one additive `nowMs: now` field reusing the
   already-computed `const now` (:648) — **zero new `Date.now()` sites in this file**. It is attached to
   the four lease-mode `result` objects; spread non-destructively onto the two preflight-mode returned
   objects (`console.log(JSON.stringify({...result, nowMs: now}))`, preserving the existing
   `{ok, policyVersion, findings}` keys downstream Preflight parsing reads); and added to the inline
   error literals (:653, :667, :678) and the catch object (:711) so a failure verdict also self-reports
   when the subprocess answered. The pure decision functions stay untouched — they already take injected
   `now`, and keeping `nowMs` at the wrapper preserves the pure-decision/thin-CLI split and every
   direct-import unit test. **CLAIM C1 (needs AC): `main()`'s JSON output carries `nowMs` for all six
   modes on BOTH success and error paths, fixture-asserted per mode, with a sub-assertion that the
   preflight verdict's existing keys survive the spread unchanged.**
2. `prepare-milestone.js` (both mirrors): `_renewLease` gains a second parameter `round` — an
   already-in-scope caller-owned integer (`0` for the non-round sites Adjudicate/ProposalReview/
   PlanAuthor/Receipt, `_deltaRound` at :577, `_planCheckRound` at :719), never regex-parsed from the
   formatted `stageLabel`. **CLAIM C2 (needs AC): all 6 `_renewLease` call sites pass `round` explicitly;
   a fixture asserts no string-parsing of `stageLabel` recovers it.**
3. Each `_renewLease` response is parsed for the first time via the existing `_parseAgentJson`, in a new
   `_recordPhaseBoundary(stageLabel, round, r)` helper (a NEW parse relationship — the response was
   previously discarded). An entry is pushed onto a new module-level `_phaseTimings` array **only when
   the parsed verdict has `ok === true` AND `Number.isFinite(v.nowMs)`** (matching `renewLease`'s real
   `{ok: true, lease}` success shape); each entry is `{phase: stageLabel, round, startedAtMs:
   _lastBoundaryMs, endedAtMs: v.nowMs}`, then `_lastBoundaryMs = v.nowMs`. A verdict carrying `nowMs`
   but `ok: false` is deliberately NOT a boundary. **CLAIM C3 (needs AC): `_renewLease` responses are
   parsed at all 6 sites and an entry is pushed only under the success-and-finite rule.**
4. `--acquire`'s already-parsed `_admissionVerdict` is extended to read `.nowMs`, seeding
   `_lastBoundaryMs` when `outcome === 'acquired'` (the `prepare-already-running` path returns at
   :234-235 before any span exists). No `_phaseTimings` entry is pushed at acquire — there is no prior
   boundary to pair against. **CLAIM C4 (needs AC): `_lastBoundaryMs` is seeded exclusively from
   `_admissionVerdict.nowMs` / a parsed renewal `nowMs`, never a workflow-local clock read.**
5. The final, still-open span is closed **receiver-side, never in the sandbox**: both terminal record
   helpers (`_releaseLeaseAndRecord`'s `--record-generation` :181 and `_writeGenerationTelemetry`'s
   `--record-generation --no-release` :195) and `_recordAttemptAgentCall`'s `--record-attempt` (:83) gain
   a `--phaseTimings <json>` flag (double-`JSON.stringify`, matching the existing `--detail` idiom)
   carrying the closed spans plus one trailing `{phase, round, startedAtMs, endedAtMs: null}` entry.
   `proposal-convergence.ts` closes that trailing entry with its own already-computed `recordedAtMs`
   (:668/:754/:580) before `buildTelemetryRecord`. `_releaseLease`'s `--release-only` (:200) gains nothing
   (it writes no telemetry). **CLAIM C5 (needs AC, load-bearing for AC19): the trailing open entry is
   always closed with the receiver's own timestamp; a fixture forces an `endedAtMs: null` input and
   asserts the receiver-filled value equals `recordedAtMs`.**
6. `--decide-resume`'s output does NOT gain `nowMs` under this design: it is not a phase boundary (the
   reuse-terminal short-circuit returns before `phase('Preflight')` at :304) and no accumulation path
   would read it — an unread field violates this file's every-field-has-a-reader discipline (explicit
   Alternative #5).

**Mechanism 2 — `findingCodes[]` recurrence tracking.**

1. Every record-writing dispatch always contributes at least one code. A new `_findingCodesFor(reason)`
   helper in `prepare-milestone.js` returns `[reason, ...(_ledgerLive ? _ledger.map(f => f.id) : [])]`,
   where `let _ledgerLive = false` is declared near the module top and set `true` immediately after
   `let _ledger = []` at :444. The boolean short-circuit is essential: `_releaseLeaseAndRecord` runs
   before :444 executes at the four pre-ledger exits, where any (even optional-chained) reference to
   `_ledger` throws a TDZ `ReferenceError`. The three pre-lease `_recordAttemptAgentCall` sites contribute
   `[site]`. At all 7 pre-ledger/pre-lease sites `findingCodes` is `[reason]` only — correct, not a gap
   (fabricating ledger entries never produced would break the no-fabrication discipline). **CLAIM C6
   (needs AC): `prepare-milestone.js` threads `--findingCodes <json>` alongside `--phaseTimings` on the
   same terminal dispatch sites; all 7 pre-ledger/pre-lease sites independently produce a non-empty array,
   fixture-verified by a pre-ledger-exit TDZ invocation.**
2. Inside `proposal-convergence.ts`, each code maps to `recurrenceKey = sha256(`${taskId}::${code}`).
   slice(0,12)` — reusing the established stability property `fingerprintFinding`/`computeAttemptId`
   already rely on (summaries reword round-to-round; the code/id must not).
3. A new **local** helper inside `proposal-convergence.ts` enumerates prior committed records under
   `milestones/prepare-telemetry/<taskId>/`, reusing `_safeTaskIdSegment`/`telemetryPath`'s path
   resolution verbatim (including the `_missing-taskId` fallback), `JSON.parse`s each, and — mirroring
   the :172-173 malformed-skip precedent — silently skips any file that fails to parse or lacks a
   `findingCodes` array (covering every pre-this-task record, including this task's own three archived
   records). **CLAIM C7 (needs AC): the scan is a local helper reusing `_safeTaskIdSegment`/`telemetryPath`;
   an import-graph check confirms zero new `import` edges between `proposal-convergence.ts` and
   `milestone-preparation-check.ts` (the 3-file cycle is not tightened).**
4. Per matching `recurrenceKey`: `firstSeenGeneration` = the earliest matching prior record's own
   `generationId` (or its `attemptId` for `--record-attempt` records, which carry `generationId: null` —
   a distinct, independently-fixtured sub-case), or the current record's own id when no prior match
   exists; `lastSeenGeneration` is always the current record's own id.
5. `buildTelemetryRecord` (:392) — the single schema-materializer — gains two new parameters/fields,
   `phaseTimings` (array of spans) and `findingCodes` (an array of `{code, recurrenceKey,
   firstSeenGeneration, lastSeenGeneration}`), always explicit (`[]` when empty, never a dropped key,
   matching the existing always-materialized `?? null` discipline). `validateTelemetryRecord`'s
   `REQUIRED_TOP` (:437) grows by both keys. **CLAIM C8 (needs AC): `REQUIRED_TOP` includes both fields and
   a record missing either fails with `telemetry-field-missing`, fixture-asserted by calling the validator
   directly.**
6. **CLAIM C9 (needs AC): enforcement is write-time strict but read-time lenient.** The two additive
   keys are required when a NEW record is validated (write-time: the reuse-terminal branch :582, and
   `buildTelemetryRecord` materializes both keys unconditionally on every write), but they are NOT
   required when an existing committed record is read back for aggregation: `computeCapacityReport`
   (`milestone-preparation-check.ts`) ALSO validates every disk-read record (a second live
   `validateTelemetryRecord` call site the original M207 revision missed), so it validates with
   `{ requireAdditiveFields: false }`, keeping DIR-126-D/E-era records that legitimately predate both
   keys valid and aggregatable. This is what the charter's "no shape becomes stricter / existing
   consumers unaffected" clause requires — the original M207 "write-time only, nothing re-validates
   history" framing was FALSE (caught by M207's own adversarial audit via an A/B `--capacity-report`
   run: unconditional `REQUIRED_TOP` widening excluded every pre-M207 record as
   `telemetry-field-missing`, emptying the telemetry population). Fixture-asserted: a pre-M207-shaped
   record (no `phaseTimings`/`findingCodes`) is (a) rejected by the strict write-time validator and
   (b) accepted by the read-time aggregation path.
7. **CLAIM C10 (needs AC): receiver-side malformed/oversized flag degradation is fail-soft and never
   blocks the primary write.** The receiver CLI tail in `proposal-convergence.ts` that parses the new
   `--phaseTimings`/`--findingCodes` flags must, on a malformed (unparseable) OR oversized value for
   EITHER flag, default to `phaseTimings: []` and `findingCodes` computed from `terminal.reason` alone,
   never throw, and never block or roll back the primary telemetry write (mirrors the existing
   `telemetryWriteOk`-isolation posture). This is genuinely new receiver behavior — a greenfield grep for
   `phaseTimings|findingCodes|recurrenceKey` across all four script/workflow trees returns zero hits, so
   the receiver parses neither flag today. It needs its OWN dedicated fixture beyond general Defaults
   coverage (per Risks), distinct from AC6 (a record MISSING a field, tested against the validator —
   missing != malformed flag value), AC8 (sender-side `nowMs` at a workflow boundary), and AC9 (a
   WELL-FORMED array carrying a null `endedAtMs`, the trailing-close happy path): the fixture feeds a
   garbage/oversized `--phaseTimings` AND `--findingCodes` value to the receiver CLI and asserts all three
   — defaulted fields, no throw, and the primary write still persists. The DoD's independent audit
   exercises a happy-path production callsite, NOT this malformed-input negative path, so it does not
   close this claim.

### Concrete control/data flow

1. `--acquire` → `main()` stamps `nowMs` → the workflow parses `_admissionVerdict` (:221), reads `.nowMs`,
   seeds `_lastBoundaryMs` when `outcome === 'acquired'`. No span pushed (first boundary).
2. Each `const r = await _renewLease(stageLabel, round); _recordPhaseBoundary(stageLabel, round, r)`:
   `_parseAgentJson(r.raw)`; if `v.ok === true && Number.isFinite(v.nowMs)`, push `{phase: stageLabel,
   round, startedAtMs: _lastBoundaryMs, endedAtMs: v.nowMs}` and advance `_lastBoundaryMs = v.nowMs`. A
   failed (`ok: false`, e.g. `lease-missing`) or unparseable/noisy renewal pushes nothing and leaves
   `_lastBoundaryMs` unchanged — fail-soft; the next successful boundary yields a wider, correctly bounded
   span.
3. Whichever terminal fires: `_releaseLeaseAndRecord` (the 13 pre-Receipt exits) or
   `_writeGenerationTelemetry` (Receipt success :804) gains `--phaseTimings <json>` (closed spans + 1
   trailing `endedAtMs: null`) and `--findingCodes <json>` (double-`JSON.stringify`) on the
   `--record-generation` dispatch it already makes; the three pre-lease exits gain both flags on their
   existing `--record-attempt` dispatch. **No new dispatch anywhere.**
4. The receiver CLI tail parses both flags (same optional-JSON-flag tolerance as every existing flag),
   closes the trailing span with its own `recordedAtMs`, computes the recurrence quad per code via the
   local scan helper, and calls `buildTelemetryRecord({…, phaseTimings, findingCodes})`, whose
   always-materialize discipline (`?? []`) guarantees both keys on every write. The widened `REQUIRED_TOP`
   check gates ONLY the reuse-terminal path (its sole live call at :582); the main writes (:653/:738) do
   not call the validator and rely on `buildTelemetryRecord`. So "REQUIRED_TOP is enforced" reads narrowly
   as a reuse-terminal-path/validator unit test, not a gate on every write.
5. `--record-attempt` (3 pre-lease sites): `phaseTimings: []` by construction (`missing-required-args` :90
   precedes `--acquire` entirely; :228/:234 have a possibly-seeded `_lastBoundaryMs` but zero completed
   spans); `findingCodes: [site]`; recurrence keyed on `attemptId`, scanning only sibling attempt records.
6. `--decide-resume` reuse-terminal write (:565): `phaseTimings: []` (cache hit, no phase ran) and
   `findingCodes` from the reused terminal's own `reason` alone, recurrence computed identically. Its
   *output* does NOT gain `nowMs` — it is not a phase boundary and no accumulation path reads it.
7. The one no-record terminal (`telemetry-write-failed` :809-810, bare `_releaseLease`) writes nothing, so
   accumulated `_phaseTimings` are simply never persisted there — correct by construction, not a
   lost-data bug.

### Key design decisions

- **Boundary = admission-touching dispatch, not `phase()` call.** Only acquire + the 6 renewal sites + the
  terminal close produce timing data; 11 live `phase()` calls exist but covering them all would need new
  agent dispatches purely for timestamps, contradicting the zero-new-dispatch ethos. AC2's "phase-dispatch
  count" must be read as "admission-touching dispatch count" (flagged as an AC wording clarification).
- **Two verdict shapes, one push rule.** `--acquire` is `outcome`-keyed; `--renew` is `ok`-keyed (verified
  :192-196, :694). The push rule names `ok === true && Number.isFinite(v.nowMs)` exactly — not
  `nowMs`-presence alone (error verdicts also carry `nowMs` by design) and not an invented
  `outcome: 'renewed'` literal.
- **`round` is data the caller already owns** (`_deltaRound`, `_planCheckRound`) — a formatted label is
  presentation, never a structured-data source.
- **TDZ-safe finding-code construction**: a `_ledgerLive` boolean short-circuit, never `_ledger?.…` — the
  single correctness-critical refinement over naive optional chaining.
- **Trailing span closed receiver-side** so the sandboxed file never computes a timestamp — the only design
  satisfying AC19's regression guard (`f6db2a8`/`7357a91`) and the `missing-now` contract (:174) while
  still closing the final span; it reuses the workflow's existing "subprocess computes the clock, sandbox
  reads a cached number" posture (`_latestKnownNowMs` :420-421) without reusing `_now()` itself.
- **`buildTelemetryRecord` stays the single schema-materializer**: the two fields are new parameters there,
  not ad-hoc duplication per write site.
- **`schemaVersion` stays 2** (default, reviewer-adjustable — **affirmatively accepted, not passed by
  default**): DIR-126-D's precedent (:356-357) reserves bumps for supersession of a different record
  *family* (v2 superseding `.generation.json`'s v1), not additive growth within a family; nothing
  re-validates history (the sole `validateTelemetryRecord` call is :582, write-time only — see the AC6
  negative enforcement sub-assertion), so no forward-compat hazard forces a bump, and Alternative #9
  rejects the bump explicitly. The reviewer consciously signs off on this no-bump posture: adding
  `phaseTimings`/`findingCodes` to `REQUIRED_TOP` without a version bump is the correct forward-compat
  semantics for additive-only growth, confirmed against the live `:356-357` precedent rather than left
  to pass unnoticed.
- **Recurrence lives in `proposal-convergence.ts` as a local helper**, not an import of `queryTelemetryReport`
  — a 4th edge onto the verified 3-file cycle for a ~15-line primitive is the same anti-pattern this
  codebase rejects elsewhere (cf. the header-comment justification for locally reimplementing the lease
  primitive instead of importing `withFileLock()`).
- **Two deliberately different read postures**: the recurrence read is fail-soft per-file (corrupt/
  pre-this-task siblings skipped individually), while the *current* record's two new fields are fail-closed
  mandatory at `REQUIRED_TOP`. Each mirrors an existing precedent.
- **Both new flags are threaded onto BOTH terminal record helpers** (`_releaseLeaseAndRecord` :181 AND
  `_writeGenerationTelemetry` :195) so the Receipt success path and the pre-Receipt terminals are uniformly
  covered; `_releaseLease`'s `--release-only` (:200) stays unchanged.
- **No stale-comment fix needed**: the one "fire-and-forget" comment (:171) belongs to
  `_releaseLeaseAndRecord`'s `--record-generation` response, which this task still does not parse (it parses
  renewals) — the comment stays accurate.

### Defaults and failure behavior

- Missing/unparseable `nowMs`, or `ok: false`, at any renewal: no entry pushed, `_lastBoundaryMs` unchanged
  — fail-soft, matching "telemetry is additive, never blocks the real gate" (renewal failures are non-fatal
  today too).
- `--acquire` verdict without `nowMs` (older-subprocess interop): `_lastBoundaryMs` stays `null`; the first
  successful renewal then pushes an entry with `startedAtMs: null` — an honest "epoch unknown", not a crash.
- No prior records for a `taskId`: `firstSeenGeneration === lastSeenGeneration ===` current id for every code
  — the expected first-occurrence shape.
- `--phaseTimings`/`--findingCodes` omitted or malformed (older caller): default to `phaseTimings: []` /
  `findingCodes` computed from `terminal.reason` alone; never throw — a secondary-field parse failure must
  never block the primary write (mirrors the existing `telemetryWriteOk`-isolation posture).
- A malformed/schema-lacking prior record hit during the scan is skipped individually, never aborting the
  scan or the current write.
- Any throw inside the new logic is caught by the existing enclosing try/catch and surfaces as
  `telemetryWriteOk: false` — never prevents or retroactively invalidates a lease release that already
  happened (DIR-126-D's lease-release-independent-of-telemetry guarantee, unchanged).

### Compatibility

- Purely additive JSON fields — no key renamed/removed. `queryTelemetryReport` only `JSON.parse`s and skips
  malformed files (:172-173); `checkPreparation`'s hash binding compares a named file — neither does
  field-level validation against old records, so both stay unaffected. The only new consumer of the archive
  is this task's own sibling-scanning helper. **Grounding check (needs AC): no existing call site runs
  `validateTelemetryRecord` over a record read back from disk — the widened `REQUIRED_TOP` stays
  write-time-only (sole live call :582, grep-verified).**
- Pure decision/preflight functions untouched; only the CLI wrapper's printed JSON grows (preflight modes via
  a non-clobbering `{...result, nowMs}` spread).
- `.quay/prepare-leases/<taskId>.generation.json` (v1, gitignored) and `_writeLegacyGenerationRecord`
  untouched.
- Zero new `Date.now()`/`new Date()`/`import()` sites in `prepare-milestone.js` by design, so the existing
  AC19 fixture is sufficient re-verification (confirm green; no new fixture for that guard).
- Mirror parity: the three edited pairs are byte-identical pre-task (`cmp`); must stay identical after every
  edit, checked via `cmp` and `plugin/scripts/sync-vendor.sh --check` (verified real path).
- `plugin/test/prepare-admission-check.test.mjs` and `plugin/test/prepare-milestone-convergence.test.mjs` are
  `scripts/test.sh`-covered; `experiments/.../test/proposal-convergence.test.mjs` is not (glob verified at
  `scripts/test.sh:37`) — its evidence cites a direct `node --experimental-strip-types --test` invocation.
- Touches list verified complete against the live task (both workflow mirrors and
  `plugin/test/prepare-milestone-convergence.test.mjs` already present) — no amendment needed.

### Risks

- **`highRisk` — shared-surface blast radius.** Both edited CLI wrappers are dependencies of every future
  Prepare dispatch. A malformed `nowMs` interpolation breaking `_parseAgentJson`'s balanced-brace scan would
  fail closed on every milestone's Prepare. Both new flags must degrade to documented defaults on any
  malformed value — needs its own dedicated fixture beyond general Defaults coverage.
- **Preflight-key preservation**: because `preflight`/`preflight-plan` print the RETURNED
  `runPreflightChecks(...)` object, the `nowMs` attachment there must not clobber or reorder the existing
  `{ok, policyVersion, findings}` keys downstream Preflight verdict parsing reads — a fixture must assert
  those keys survive unchanged alongside `nowMs`.
- **TDZ**: getting `_findingCodesFor`'s guard wrong (e.g. shipping the literal `_ledger?.map(...)` form)
  crashes the four pre-ledger terminal exits with `ReferenceError` — a regression in failure-path telemetry
  that is itself terminal. Needs its own fixture invoking a pre-ledger exit and asserting a clean `[reason]`
  result.
- **Read amplification**: the recurrence scan is O(n) `JSON.parse` per write over a task's archive.
  Acceptable at observed scale (single-digit generations; DIR-126-E has 5, this task already has 3); called
  out as a Non-goal, not silently ignored.
- **`REQUIRED_TOP` additive keys (resolved)**: the two additive keys are required at WRITE time but
  NOT at read/aggregation time (`validateTelemetryRecord({ requireAdditiveFields })`;
  `computeCapacityReport` passes `false`), so pre-this-task records stay valid/aggregatable. The
  original "forward-only-safe / nothing re-validates history" framing was false (computeCapacityReport
  re-validates disk reads) and is corrected by the parameterization.
- **Command-line length**: bounded in practice by existing round caps (`MAX_PLANCHECK_ROUNDS` = 3 :714, the
  `_maxDeltaRounds` policy cap :428) and ledger size, but an unusually large `_ledger` could lengthen the
  `--findingCodes` payload — an optional sanity bound is Plan-discretionary.
- **The live-dispatch AC cannot be unit-satisfied**: "admission-touching dispatch count == phase-transition
  entry count" on a real multi-round generation requires a real post-landing `prepare-milestone` dispatch
  examined via its committed record/journal, matching the DoD's "real, non-fixture evidence" bar. Must stay
  explicit in the Plan so it is never quietly downgraded to a mocked-agent check.

### Non-goals

- Not redesigning `.generation.json`'s v1 shape, `decideResumeGeneration`, or any landed
  lease/preflight/resume mechanics.
- Not `phase()`-exact timing granularity — no new dispatch exists purely for a timestamp.
- Not a new committed-artifact type — both fields live inside the existing record.
- Not a recurrence index/cache file — the committed archive is scanned directly (single source of truth); no
  O(n) optimization until real counts justify it.
- Not carrying full finding objects (severity/disposition/evidence) into `findingCodes[]` — only the identity
  quad; the ledger file stays the one home for full detail.
- Not extending any read-only report mode to aggregate/surface the new fields — a natural follow-up once
  recurrence data accumulates.
- Not backfilling pre-this-task records, not pruning/compacting history.
- Not fixing the `scripts/test.sh` glob gap for `experiments/quay-perpetual-stream/test/` — a grounding fact
  for evidence-gathering, not this task's repair.
- Not changing convergence caps or round limits — this task observes and records, never gates.

### AC coverage

Mapping to the task's existing 11 AC bullets, with claims C1-C10 from the wiring-claim registry above:

- **AC1** (additive `nowMs`; zero new `Date.now()`/`import()` in the workflow; grep guard): covered by
  Mechanism 1's CLI-boundary placement (C1), the explicit `round` parameter (C2), receiver-side span-close
  (C5), and AC19 reuse. Clarify: all six admission modes fixture-asserted individually on success AND error
  paths (C1 doubles as AC10's coverage), with the preflight-key-preservation sub-assertion.
- **AC2** (dispatch count == entry count on a real multi-round generation incl. a delta round and a PlanCheck
  round): covered by `_lastBoundaryMs`-pairing (C3/C4) + receiver-side close (C5). Clarify: "phase-dispatch
  count" = **admission-touching** dispatch count (acquire + 6 renewal classes + terminal), since timing
  granularity is renewal-bounded by design — plus the real post-dispatch journal check flagged under Risks.
- **AC3** (`findingCodes[]`/`recurrenceKey`/`firstSeenGeneration`/`lastSeenGeneration`; two-generation fixture
  pinning `firstSeenGeneration` while `lastSeenGeneration` advances): covered by C6/C7/C8. Needs dedicated
  fixtures for (a) all 7 pre-ledger terminal classes each producing non-empty `findingCodes` from the reason
  alone (C6); (b) a corrupted/pre-this-task sibling skipped without aborting the current write (C7); (c)
  `attemptId`-keyed recurrence at the 3 pre-lease sites proven separately from `generationId`-keyed recurrence.
- **AC4** (mirror parity): covered by `cmp` + `plugin/scripts/sync-vendor.sh --check` over every edited pair,
  explicitly including the workflow mirrors (both already in Touches); a fixture naming and diffing every
  touched mirror pair.
- **AC5** (recurrence scan stays local; zero new import edges / grounding that the three writing submodes are
  the exact extension points): reconfirmed this round by direct source read (`_writeCommittedTelemetry` :653,
  `_decideResumeCli` :512/:565 inline block, `_recordAttemptCli` :738; `--release-only` writes nothing) —
  evidence, not new code; the local-helper decision (C7) keeps zero new import edges.
- **AC6** (`REQUIRED_TOP` fails closed with `telemetry-field-missing`): covered by C8/C9, plus the grounding
  check that `validateTelemetryRecord` is invoked only pre-write, never on records read back from disk.
- **AC7** (`round` explicit, never regex-parsed; construction reads only parsed `nowMs` and in-scope vars):
  covered by C2/C3/C4 and the `_recordPhaseBoundary` source.
- **AC8** (missing/unparseable `nowMs` fail-soft): covered by the conditional push / unchanged-`_lastBoundaryMs`
  rule (C3).
- **AC9** (all 7 pre-ledger terminal-return classes produce non-empty `findingCodes[]`): the 4 pre-ledger
  `_releaseLeaseAndRecord` exits (`preflight-check-failed` :313, `preflight-rejected` :323,
  `proposal-author-incomplete` :366, `adjudicate-failed` :390) and the 3 pre-lease `_recordAttemptAgentCall`
  exits (`missing-required-args` :90, `admission-check-failed` :228, `prepare-already-running` :234) — covered
  by `_findingCodesFor` + the `_ledgerLive` guard (C6), citing the TDZ-safe
  `_ledgerLive ? _ledger.map(f=>f.id) : []` short-circuit form (the `_ledger?.map(...) ?? []` shorthand is
  TDZ-unsafe), plus a pre-ledger-exit TDZ fixture.
- **AC10** (all six CLI modes gain `nowMs`, individually fixtured): covered by C1, including both preflight
  modes via the non-clobbering spread.
- **AC11** (exhaustive identifier grounding): every identifier cited was confirmed by direct source read this
  round; corrections vs inherited text: `sync-vendor.sh`'s real path is `plugin/scripts/sync-vendor.sh`;
  renewal success is `ok: true`, not an `outcome: 'renewed'` literal; `validateTelemetryRecord`'s sole live
  call is :582; experiments-side test evidence cites `node --experimental-strip-types --test`; this task's
  archive now holds three records, so `split-recommended` has already recurred on disk.
- **Receiver-side malformed/oversized flag degradation (CLAIM C10, falsifiable AC):** the receiver CLI
  tail in `proposal-convergence.ts` that parses `--phaseTimings`/`--findingCodes` must, on a malformed
  (unparseable) or oversized value for EITHER flag, default to `phaseTimings: []` and `findingCodes`
  computed from `terminal.reason` alone, never throw, and never block or roll back the primary telemetry
  write. Falsified by a dedicated fixture — distinct from Defaults prose, AC6 (a MISSING field against the
  validator), AC8 (sender-side `nowMs`), and AC9 (a WELL-FORMED array with a null `endedAtMs`) — that feeds
  a garbage/oversized `--phaseTimings` AND `--findingCodes` value to the receiver CLI and asserts all
  three: (a) defaulted fields, (b) no throw, (c) the primary write still persists. This is the dedicated
  fixture Risks flags as required 'beyond general Defaults coverage' for the `highRisk` shared-surface
  blast radius, and it is the AC the Defaults §4 prose and the Risks entry previously lacked.
- **Additional fixtures recommended for the Plan phase**: (1) both `--record-generation` helpers (:181 and
  :195) carry the new flags while `--release-only` (:200) does not; (2) the trailing open span's `endedAtMs`
  equals the receiver's `recordedAtMs`, never a sandbox value; (3) `--findingCodes`/`--phaseTimings`
  construction reads exclusively from already-parsed `_parseAgentJson(...).nowMs` values and the existing
  `_ledger`/`_deltaRound`/`_planCheckRound` variables; (4) a malformed (unparseable) AND an oversized
  `--phaseTimings`/`--findingCodes` value fed to the receiver CLI defaults `phaseTimings: []` /
  `findingCodes` from `terminal.reason`, never throws, and the primary write still persists (CLAIM C10).
- **DoD** (real, non-fixture production callsite): satisfied DIR-126-D-style — a real `prepare-milestone`
  dispatch's committed record inspected post-hoc for non-`[]` `phaseTimings`/`findingCodes`, plus an
  independent diff audit. This task's own archive already holds three prior records (incl. `dd06ce1ed5b8.json`,
  `split-recommended`), so the first post-landing generation for this very `taskId` exercises the recurrence
  scanner against real prior records.

### Alternatives considered and rejected

1. **Compute timestamps inside `prepare-milestone.js` (`Date.now()`/`new Date()`).** Rejected: the sandbox
   throws (AC19 fixture) — the exact class of two real production crashes already paid for twice (`f6db2a8`,
   `7357a91`); `acquireLease`'s own `missing-now` error (:174) forbids it in the code's own words.
2. **A dedicated new CLI script for timing/recurrence.** Rejected: the task's scope names the two existing
   files; a third fragments single-record ownership and adds another mirror pair.
3. **Seed `startedAtMs`/`endedAtMs` purely from the sandbox's existing `_now()`/`_latestKnownNowMs` clock
   (:420-421/:516/:777) with NO subprocess change.** Considered seriously because that clock already exists
   and is AC19-compliant. Rejected as the PRIMARY mechanism (kept as the consistent posture the chosen design
   reuses): (a) the charter-named deliverable is explicitly "add per-phase-boundary `nowMs` self-reporting to
   `prepare-admission-check.ts`'s JSON output", which a sandbox-only change would not satisfy; (b) `_now()`
   returns agent-turn-boundary-approximate times (the last agent that ran `date`), whereas `_renewLease`/
   `--acquire` subprocess self-report gives dispatch-boundary-exact times aligned to the lease transition being
   measured; (c) `_now()` is not advanced at the six renewal boundaries today, so using it would still require
   wiring at each site — for strictly coarser data.
4. **A new agent dispatch per phase boundary purely for a timestamp.** Rejected: all 6 boundaries already
   dispatch `_renewLease`; doubling agent turns for a timestamp is pure cost when piggybacking is free.
5. **Also stamp `nowMs` onto `--decide-resume`'s output for symmetry.** Rejected: it is not a phase boundary
   (early-returns before `phase('Preflight')` :304) and no accumulation path reads it — an unread field
   violates every-field-has-a-reader discipline. (Trivially reversible if a reviewer wants symmetric
   self-reporting.)
6. **Close the trailing open span in the sandbox** using the last boundary's timestamp. Rejected: it would
   embed an inaccurate end time and violate the subprocess-computed-time discipline; receiver-side closing
   with `recordedAtMs` is both more accurate and constraint-compliant.
7. **Regex-parse `round` from `stageLabel`** (`/round-(\d+)$/`). Rejected: a formatted label is presentation;
   coupling a parser to its format is a fragile second source of truth for data the caller already holds as an
   integer.
8. **Optional-chained `_ledger?.map(f=>f.id) ?? []`** for finding-code construction. Rejected: `?.` does not
   bypass the temporal dead zone — at the four pre-ledger exits `_ledger` is an uninitialized module `let` and
   any reference throws `ReferenceError`. The `_ledgerLive` short-circuit guard is the minimal correct form.
9. **Bump `schemaVersion` to 3.** Rejected as the default (reviewer-adjustable): nothing re-validates history,
   so a bump adds no safety and departs from the :356-357 precedent of reserving bumps for new record families.
10. **Import `queryTelemetryReport` for the prior-record scan.** Rejected: a 4th edge onto the verified 3-file
    import cycle for a ~15-line locally-reimplementable primitive.
11. **In-memory recurrence tracking within one generation.** Rejected: each generation is a fresh process with
    no persistent state; only the committed archive survives across generations, so cross-generation recurrence
    is computable only in the subprocess that already reads/writes that tree.
12. **A separate committed file for timings/codes.** Rejected: both are extensions to the telemetry record
    already in production; a second file would need its own hash-binding/staleness story duplicating
    `buildTelemetryRecord`/`validateTelemetryRecord`.
13. **Carry full typed finding objects into `findingCodes[]`.** Rejected: duplicates the ledger into a second
    location — the drift risk this repo's single-source-of-truth principle warns against.
14. **Record a boundary for failed renewals that still carry `nowMs`.** Rejected: `ok: false` (e.g.
    `lease-missing`) means the phase may not have executed; recording it would falsify the timeline. The push
    rule requires success AND a finite `nowMs`.

## Plan

See docs/plans/M207-gap-dir126d-deferred-phase-timing-recurrence-tracking.md (authored 2026-07-30,
base revision c82efac — the Plan's declared base / current HEAD, at which all Plan anchors were
re-verified; 2d67a92 is HEAD~1, whose :601/:648 Proposal anchors for prepare-admission-check.ts were
correct @2d67a92 but superseded by c82efac's +33-line insert). Nine ordered stages (RED CLI `nowMs` fixtures → GREEN admission-check
stamping in both mirrors → RED workflow accumulation fixtures → GREEN workflow accumulation +
flag threading in both mirrors → RED receiver fixtures → GREEN receiver flag-parse + trailing
close + recurrence scan + `REQUIRED_TOP` widening in both mirrors → lockstep verification battery
→ grounding evidence re-read → real-landing verification) each carry the mechanical
`- AC:`/`- Files:`/`- Command:` block, RED/implementation/GREEN checks with expected exit
behavior, code/prose classification, line budgets, and strict dependencies; every 1-based AC index
(1-12) appears in at least one stage's `- AC:` list. Mechanically verified at authoring time:
`validatePlanStructure` returns `plan-structure-ok` (9 stages, all 12 AC items mapped) and the
live `prepare-admission-check.ts --preflight-plan` returns `ok:true` with zero findings.
Standardized stopping rule: at most 3 Plan-check rounds, success only at F_i=0 (live
`prepare-admission-check.ts --preflight-plan` returns `ok:true` with zero findings). Real-landing
verification (DoD): a real post-landing `prepare-milestone` dispatch's committed record inspected
for non-`[]` `phaseTimings`/`findingCodes`, with this task's own three archived records
exercising the recurrence scanner against a real recurred code (`split-recommended`).

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

- [x] `prepare-admission-check.ts` (both mirrors) gain an additive `nowMs: Date.now()` field;
  `prepare-milestone.js` (both mirrors) accumulates `{phase, round, startedAtMs, endedAtMs}` purely
  by reading already-parsed subprocess output — zero new `Date.now()`/`new Date()`/`import()` call
  sites added to `prepare-milestone.js` itself, verified by a grep-based regression fixture.
  *(audit 2026-07-31: confirmed — admission fixtures 74/74 ×2 mirrors; AC19 guard green
  (prepare-milestone-convergence.test.mjs:1124); audit grep: zero LIVE Date.now()/new Date(/import(
  in both workflow mirrors.)*
- [x] A real multi-round generation's journal (including a `ProposalReview` delta round and a
  `PlanCheck` round) has its **admission-touching dispatch count** confirmed equal to the telemetry
  record's own phase-transition entry count. "Admission-touching dispatch count" means the
  dispatches that carry the new phase-timing flags — the single `--acquire` plus the 6 bare
  `await _renewLease(...)` sites (`prepare-milestone.js` :372/:407/:577/:638/:719/:755) plus the
  terminal close — NOT the raw `phase()` call count (11 live `phase()` invocations, 16 by raw
  `grep -c` including comments; timing is renewal-bounded, strictly coarser than phase-exact). The
  fixture asserts equality on this renewal-bounded metric, so it is falsifiable on the correct
  count and cannot be satisfied by mistakenly counting `phase()` calls.
  *(audit 2026-07-31: confirmed — prepare-milestone-convergence.test.mjs:1195 drives the real
  workflow through a multi-round generation (delta + PlanCheck rounds), asserts spans.length ===
  admissionRenews+1 (entry-producing boundaries: 6 renewals + trailing close = 7 = entry count;
  acquire seeds without pushing an entry, by design), acquire-seed, contiguity, caller-owned
  rounds; 68/68 green. End-to-end real-dispatch journal equality is Plan Stage 9, deferred to
  Land by Plan design.)*
- [x] `findingCodes[]` with `recurrenceKey`/`firstSeenGeneration`/`lastSeenGeneration` is added to
  the committed telemetry record (additive to DIR-126-D's frozen schema); a fixture spanning two
  real generations with a repeated finding code confirms `lastSeenGeneration` advances while
  `firstSeenGeneration` stays pinned.
  *(audit 2026-07-31: confirmed — proposal-convergence.test.mjs:1200 (PINNED/ADVANCES) + :1228
  (attemptId sub-case) + :1247 (scan hygiene), 97/97 green; audit's own real-CLI A/B on a copy of
  the real archive reproduced it: recurrenceKey f7bc72448be9 stable, firstSeen pinned to
  4f6aa41bb495, lastSeen advanced to 72af725059ab.)*
- [x] Byte-identical mirrors re-verified (`cmp`/`sync-vendor.sh --check`) across every file this
  child touches, including the newly-touched `prepare-admission-check.ts`.
  *(audit 2026-07-31: confirmed — cmp ×3 edited pairs byte-identical; plugin/scripts/sync-vendor.sh
  --check CLEAN, exit 0.)*
- [x] **Recurrence scan stays a local helper, never a new import edge:** an import-graph check
  (grep/AST) confirms zero new `import` statements are added between `proposal-convergence.ts` and
  `milestone-preparation-check.ts` — the recurrence scan reuses `_safeTaskIdSegment`/`telemetryPath`
  as a local helper within `proposal-convergence.ts` itself.
  *(audit 2026-07-31: confirmed — 4 mentions of milestone-preparation-check in both mirrors are ALL
  comments (:8/:14/:172/:333); git diff shows zero import-line changes; _telemetryDir reuses
  telemetryPath via probe-record dirname.)*
- [x] **`REQUIRED_TOP` extension fails closed (direct validator unit test):** a fixture calling
  `validateTelemetryRecord` directly with a record missing either `phaseTimings` or `findingCodes`
  confirms it returns `telemetry-field-missing`. This is a unit test of the validator itself — the
  gate on the reuse-terminal path (its sole live call at :582) — NOT a gate on every write: the
  main writes (`_writeCommittedTelemetry` :653, `_recordAttemptCli` :738) do not call
  `validateTelemetryRecord` and instead rely on `buildTelemetryRecord`'s always-materialize
  discipline. Distinct from the already-covered "fields are added to the record" claim above.
  **Write-strict / read-lenient enforcement (CLAIM C9, corrected):** `validateTelemetryRecord` takes
  `{ requireAdditiveFields }` (default `true`); the two additive keys are in `REQUIRED_TOP` only when
  `requireAdditiveFields` is true. The reuse-terminal write path (:582) uses the default (strict);
  `computeCapacityReport`'s read-time aggregation (`milestone-preparation-check.ts`) passes
  `{ requireAdditiveFields: false }`, so pre-M207 records that legitimately predate both keys stay
  valid and aggregatable. Fixture-asserted: a pre-M207-shaped record (no `phaseTimings`/
  `findingCodes`) is (a) REJECTED by the strict write-time validator and (b) ACCEPTED by the
  read-time aggregation path (not excluded as `telemetry-field-missing`).
  *(audit 2026-07-31: the original M207 revision claimed "enforcement is write-time only, nothing
  re-validates committed history" and put both keys unconditionally in REQUIRED_TOP — REFUTED,
  because `computeCapacityReport` (milestone-preparation-check.ts, landed M204/DIR-126-E) validates
  every disk-read record, so unconditional widening excluded ALL 27 pre-M207 records as
  telemetry-field-missing, emptying the telemetry population (A/B proof: dc3d6c4~1 → code:ok,
  sampleCount:31, zero telemetry exclusions; dc3d6c4 → all 27 excluded, code:insufficient-samples).
  RESOLVED 2026-07-31 by the requireAdditiveFields parameterization: read-time aggregation is now
  lenient. Re-verified A/B post-fix: `--capacity-report` → code:ok, sampleCount:30, ZERO
  telemetry-field-missing exclusions (the 9 remaining exclusions are the legitimate
  convergence-interval-degenerate/no-convergence-block receipt-population exclusions). The charter's
  "no shape becomes stricter / existing consumers unaffected" clause is now satisfied.)*
- [x] **`round` is threaded explicitly, never regex-parsed from `stageLabel`:** a fixture confirms
  `_phaseTimings`/`--findingCodes` construction reads exclusively from already-parsed
  `_parseAgentJson(...).nowMs` values and the existing `_ledger`/`_deltaRound`/`_planCheckRound`
  variables — no `Date.now()`, no regex-parsing of `stageLabel` to recover `round`.
  *(audit 2026-07-31: confirmed — source-guard fixture
  prepare-milestone-convergence.test.mjs:1340 asserts exactly 6 _renewLease(label, round) sites,
  round ∈ /^(0|_deltaRound|_planCheckRound)$/, NEGATIVE stageLabel-parse asserts, exact push rule
  via _parseAgentJson; green ×2 mirrors.)*
- [x] **Missing/unparseable `nowMs` degrades fail-soft:** a fixture forcing a boundary's `nowMs` to
  be absent/unparseable confirms no `_phaseTimings` entry is pushed for that boundary and
  `_lastBoundaryMs` is left unchanged — distinct from the happy-path multi-round journal item above.
  *(audit 2026-07-31: confirmed — fail-soft fixtures :1240 (nowMs-absent renewal pushes nothing)
  + :1253 (ok:false carrying nowMs pushes nothing — rule is ok===true AND finite nowMs); green.)*
- [x] **Receiver-side trailing-span close uses its own `recordedAtMs`, never a sandbox value
  (CLAIM C5, load-bearing for AC19):** a fixture feeding a `phaseTimings` array whose final entry is
  `{..., endedAtMs: null}` confirms the receiver (`proposal-convergence.ts`, before
  `buildTelemetryRecord`) fills that trailing `endedAtMs` with its own already-computed
  `recordedAtMs` — the filled value equals `recordedAtMs` exactly, and no sandbox-side
  `Date.now()`/`new Date()` is used anywhere in the construction (re-verified by the AC19 guard).
  This is the positive assertion that the trailing span is closed on the receiver side; distinct
  from the fail-soft item above (which covers a missing/unparseable boundary, not the trailing
  close).
  *(audit 2026-07-31: confirmed — proposal-convergence.test.mjs:1181 real-CLI fixture asserts
  filled endedAtMs === recordedAtMs exactly, green; audit's own real --record-generation run:
  trailing endedAtMs 1785456654605 === recordedAtMs 1785456654605; workflow sends endedAtMs:null
  (source-guard fixture :1362).)*
- [x] **All 7 pre-ledger terminal-return classes produce `findingCodes[]`:** the 3 pre-lease
  `_recordAttemptAgentCall` exits (`missing-required-args`, `admission-check-failed`,
  `prepare-already-running`) and the 4 pre-ledger `_releaseLeaseAndRecord` exits
  (`proposal-author-incomplete`, `adjudicate-failed`, plus the 2 pre-`let _ledger = []`
  `preflight-rejected`-shaped exits) each independently produce a non-empty `findingCodes[]` seeded
  from `terminal.reason` alone — distinct from the general `findingCodes[]` item above.
  *(audit 2026-07-31: confirmed — TDZ fixture prepare-milestone-convergence.test.mjs:1267
  (pre-ledger exit produces [reason] with NO ReferenceError via _ledgerLive short-circuit) + :1292
  (all 3 pre-lease --record-attempt sites non-empty, phaseTimings [] by construction); green ×2.)*
- [x] **All six `prepare-admission-check.ts` CLI modes gain `nowMs` (success AND error paths, keys
  preserved):** acquire, renew, release, force-release, preflight, and preflight-plan are each
  individually fixture-verified to carry the additive `nowMs` field in their JSON output on BOTH
  the success path AND the error path (`{ok:false,...}` shapes); and — for the preflight/preflight-
  plan modes specifically, which print the returned `runPreflightChecks` object directly via a
  non-clobbering `{...result, nowMs}` spread — the existing `{ok, policyVersion, findings}` keys
  survive unchanged (a fixture asserts the spread adds `nowMs` without dropping or clobbering any
  pre-existing key, since downstream Preflight verdict parsing depends on those keys).
  *(audit 2026-07-31: confirmed — admission fixtures :761-892 individually cover acquire
  (success/contention/missing-session-id), renew, release, force-release (success + lease-missing
  error each), preflight, preflight-plan (success + error + exact-key-set preservation), catch-all;
  74/74 ×2 mirrors; audit's real CLI runs carried nowMs and preserved keys.)*
- [x] Grounding evidence (exhaustive identifiers, wiring-coverage completeness): confirmed real by
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
  Round-5 additionally flagged these exact-form identifiers (confirmed real by direct source read of the current tree): the committed-telemetry writers set `recordedAtMs: Date.now()` (`proposal-convergence.ts` :580/:636/:668/:754); `_parseAgentJson` (`prepare-milestone.js` :32) is a balanced-brace scanner that tries every `{` offset and never uses naive `JSON.parse` (per `gap-prepare-milestone-noisy-agent-raw-json-parse`); the three bare `_releaseLease` `--release-only` Receipt sites are `telemetry-write-failed` (:809), `receipt-selfcheck-failed` (:837), and `prepared` (:847); the 11-live-vs-16-raw `phase()` count is reconfirmed by `grep -c`; `buildTelemetryRecord({…, phaseTimings, findingCodes})` materializes both new keys; and the mirror-parity / renew-path evidence cites `plugin/scripts/sync-vendor.sh` (`sync-vendor.sh`) `--check` returning `ok: true`, the renew `outcome: 'renewed'` path, the `validateTelemetryRecord` validator, a direct `node --experimental-strip-types --test` invocation, and the `split-recommended` cacheable terminal — all confirmed real by direct source read, not a new invention.
  Round-6 additionally flagged the `schemaVersion`-stays-2 design-decision identifiers (confirmed real by direct source read of the current tree): the additive-growth-within-a-family posture keeps `schemaVersion: 2` (v2 having superseded `.generation.json`'s v1 record family at `:356-357`), and the `validateTelemetryRecord` validator is its sole enforcement point — confirmed real, not a new invention.
  *(audit 2026-07-31: confirmed — spot-checked on the current tree: `missing-now: a real epoch-ms`
  literal (×1), all 6 `_renewLease` sites with caller-owned rounds (:445/:480/:653/:714/:795/:831),
  `MAX_PLANCHECK_ROUNDS = 3`, `_parseAgentJson` (×8), AC19 fixture citing f6db2a8/7357a91,
  `--release-only` (×3) — all real. CAVEAT: the "sole enforcement point" framing is false repo-wide
  (see AC6 note — milestone-preparation-check.ts:287 also enforces against disk-read records).)*

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] Landed on `master` under human-steered discipline (touches `prepare-admission-check.ts`, not
  previously touched by DIR-126-D's own trimmed scope).
  *(audit 2026-07-31: confirmed — dc3d6c4 is HEAD of master; `git merge-base --is-ancestor dc3d6c4
  master` true; touches both prepare-admission-check.ts mirrors; human-steered per charter.)*
- [x] Real, non-fixture evidence: a fresh independent audit confirms the real production callsite
  for both the phase-timing self-report and the recurrence-tracking read, not merely unit-test
  reachability.
  *(audit 2026-07-31: confirmed — this audit's OWN real CLI runs (no fixtures): real
  prepare-admission-check.ts --acquire/--renew/--preflight carry real nowMs (e.g. 1785456570332);
  real proposal-convergence.ts --record-generation ×2 over a copy of the REAL committed archive —
  trailing span closed with the receiver's own recordedAtMs (1785456654605 === 1785456654605) and
  recurrence PINNED/ADVANCED across two real records (f7bc72448be9: 4f6aa41bb495 → 72af725059ab).
  CAVEAT: the end-to-end real-dispatch journal equality (Plan Stage 9) is deferred to Land by Plan
  design; and this same audit REFUTED the AC6 negative sub-assertion — see AC6 note.)*

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

