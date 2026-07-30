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

DIR-126-D/M203 (landed `6a24bf3`) shipped a real, production-wired committed telemetry record
(`buildTelemetryRecord`/`validateTelemetryRecord`/`_writeTelemetryRecord` in
`experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`, byte-identical mirror
`plugin/scripts/proposal-convergence.ts` — reconfirmed via `cmp`, empty diff) at
`milestones/prepare-telemetry/<taskId>/<recordId>.json`, `schemaVersion: 2`. A real committed
example confirms the exact frozen shape (`milestones/prepare-telemetry/DIR-126-E/2a107fcb5cc9.json`):
`terminal:{outcome,reason,phase,cacheable}`, `hashes:{...}`, `decision:{kind,reason,priorGenerationId,
priorReason,createsContentGeneration}` — no phase-timing field, no recurrence field. Both ideas
(per-phase-boundary `nowMs` timing and `findingCodes[]`/`recurrenceKey` recurrence) were added
in-flight during DIR-126-D's own ProposalReview convergence, then deliberately trimmed two rounds
later once a direct grep of `M203-dir126d-prepare-telemetry.md`'s Scope/Done-when text confirmed
neither was charter-mandated — the trim is what let `mechanismCount` drop below
`checkSplitRecommendation()`'s `split-multi-mechanism` threshold and converge. Both ideas are real
and still wanted; this child picks them up as their own explicitly-chartered scope.

Verified current call graph and constraints (direct reads, not inherited from the task body):

- `prepare-admission-check.ts`'s CLI `main()` (`:601-714`, byte-identical `plugin/scripts/`
  mirror) computes one `const now = Date.now()` (line ~648) shared by all six CLI modes
  (`--acquire`/`--renew`/`--release`/`--force-release`/`--preflight`/`--preflight-plan`) and never
  emits it in JSON stdout today.
- `.claude/workflows/prepare-milestone.js` (byte-identical mirror `plugin/workflows/prepare-milestone.js`, reconfirmed via `cmp`) is a self-contained workflow-DSL file with **zero**
  `import` statements and **zero** live `Date.now()`/`new Date()`/`import()` call sites — the
  sandbox throws on any of these (confirmed live: the file's own comment at line ~410 documents it,
  and `plugin/test/prepare-milestone-convergence.test.mjs`'s `AC19` test,
  `zero LIVE (non-comment) Date.now()/new Date(/await import(/bare import( call sites`, citing the
  two real production-crash commits `f6db2a8`/`7357a91` by hash, already enforces it on every test
  run). **This is the load-bearing constraint for the timing mechanism** — any new timestamp value
  `prepare-milestone.js` touches must be read out of already-parsed subprocess JSON, never computed
  locally, and this child's own new code must keep passing AC19 unmodified.
- `_renewLease(stageLabel)` (comment: "Renewal at every phase boundary (WIRING-CLAIM 3) — six
  distinct call sites") is dispatched at exactly 6 static call sites — `Adjudicate`, `ProposalReview`,
  `ProposalReview-delta-round-${_deltaRound}` (up to 2-3 times), `PlanAuthor`,
  `PlanCheck-round-${_planCheckRound}` (up to 3 times), `Receipt`. **Corrected grounding (this
  round's ProposalReview independently re-verified the original claim below and found it wrong for
  2 of 3 named responses — direct source read, not inference):** `_renewLease`'s own response is
  genuinely, completely discarded at all 6 call sites today — every call site is a bare
  `await _renewLease(stageLabel)` with no variable capture, and `_renewLease` itself is just
  `return _admissionAgentCall(...)` with no parsing inside it either; this child is genuinely the
  first to read anything out of it. `--acquire`'s response, by contrast, is **already parsed**
  today into `_admissionVerdict` (`.outcome`/`.lease`/`.reclaimed` are all read and checked before
  Admission proceeds) — it is not discarded, it simply has no `.nowMs` field to read yet (that field
  doesn't exist until this child's Mechanism 1 adds it to `prepare-admission-check.ts`'s JSON
  output); this child extends an *already-consumed* verdict object to also read one new field, it
  does not "for the first time parse a discarded response." The Receipt-site
  `_writeGenerationTelemetry(...)` call's own response is likewise **already parsed** today into
  `_writeTelVerdict` (checked for `.ok`/`.telemetryWriteOk` before `--build` runs) — also not
  discarded, and not touched by this child's timing mechanism at all (its role in the design below
  is only as one of the two terminal call shapes that gains the new `--phaseTimings`/
  `--findingCodes` CLI flags, not as a response this child newly starts parsing). The
  "fire-and-forget: callers await and never parse the result" comment this task's earlier draft
  quoted is `_releaseLeaseAndRecord`'s own comment about *its* `--record-generation` release-call
  response — a fourth, separate call/response pair, not renewal or acquire — and was misattributed
  here; that comment stays accurate and unchanged, since this child never parses that particular
  response either. Net effect: this child's real, narrower scope is parsing `_renewLease`'s
  response (genuinely new) and extending `--acquire`'s already-parsed verdict to one new field
  (genuinely new field, not a newly-discovered discarded response) — Mechanism 1's own technical
  design below already matches this narrower reality; only the Problem-framing's *description* of
  current state needed correcting, not the mechanism itself. Separately, the 3
  `_recordAttemptAgentCall` pre-lease sites (`missing-required-args`, `admission-check-failed`,
  `prepare-already-running`) fire before any `_renewLease`/`--acquire` call exists at all — they are
  not part of this discarded-response question, only relevant to Mechanism 2's `findingCodes[]`
  pre-ledger enumeration below.
- `proposal-convergence.ts` writes a telemetry record from exactly **three** CLI submodes (confirmed
  by grep, matching the task's own AC5 grounding bullet): `_writeCommittedTelemetry` (shared by
  `--record-generation` and `--record-generation --no-release`), `_decideResumeCli`'s inline
  `reuse-terminal` block (`--decide-resume`), and `_recordAttemptCli` (`--record-attempt`, the 3
  pre-lease sites, which hold no lease/`generationId`). `--release-only` does not write telemetry.
- The real import graph is a pre-existing 3-file cycle, confirmed by direct grep of every `./`
  import: `prepare-admission-check.ts → milestone-preparation-check.ts` (imports
  `parsePlanStages`/`validatePlanStructure`) `→ proposal-convergence.ts` (imports `blockingOpen`/
  `validateConvergenceCounters`/`computeConvergenceMetrics`) `→ prepare-admission-check.ts` (imports
  `PREFLIGHT_POLICY_VERSION`/`releaseLease`). Not introduced by this child, but relevant to the
  recurrence-scan design below.
- `milestone-preparation-check.ts`'s `queryTelemetryReport` (line ~159) already scans the whole
  `milestones/prepare-telemetry/**/*.json` tree and explicitly skips malformed files ("Malformed
  telemetry file — skipped, never crashes the report query", line ~173) — the established precedent
  for tolerant reads over this same committed tree.
- `_recordAttemptAgentCall`'s existing `--detail ${JSON.stringify(JSON.stringify(detailObj || {}))}`
  (line 83) is the live, confirmed precedent for the double-`JSON.stringify` CLI-flag idiom this
  child reuses for its two new flags.
- `scripts/test.sh`'s canonical glob (`packages/*/test/*.test.mjs plugin/test/*.test.mjs`, confirmed
  by direct read) does **not** reach `experiments/quay-perpetual-stream/test/*.test.mjs`. There is
  **no** `plugin/test/proposal-convergence.test.mjs` (confirmed absent) — the experiments-side file
  is this task's own listed Touches entry and the correct, pre-existing convention (its own relative
  import is `../scripts/proposal-convergence.ts`, no plugin counterpart needed). This is pre-existing
  repo behavior, not a defect this child introduces, but the Plan/DoD evidence for the
  recurrence-tracking fixture must cite a direct `node --experimental-strip-types --test` invocation,
  not a `scripts/test.sh` green run.

**Grounding gap the task's own `## Touches` list has, flagged explicitly**: AC bullet 1's own text
("`prepare-milestone.js` (both mirrors) accumulates `{phase, round, startedAtMs, endedAtMs}` purely
by reading already-parsed subprocess output") cannot be satisfied without editing
`.claude/workflows/prepare-milestone.js` and `plugin/workflows/prepare-milestone.js` — **neither
file is in the task's current `## Touches` list**, and neither is
`plugin/test/prepare-milestone-convergence.test.mjs`, which already contains the AC19 regression
guard this child's timing code must keep passing. Given the task is `highRisk` specifically because
it touches `prepare-admission-check.ts`/`proposal-convergence.ts` as shared dependencies, the
workflow-file edit is arguably the *highest*-blast-radius change here (every real
`prepare-milestone` dispatch runs through `_renewLease` at least 6 times per generation) and
deserves at least as much AC scrutiny — **this is a required Touches-list amendment for PlanAuthor
to make, not an optional nice-to-have**, and is carried forward as an explicit Plan-authoring input
rather than silently worked around.

### Chosen mechanism

Two independent, additive extensions layered onto the already-landed DIR-126-D telemetry pipeline,
confined to the (amended) in-Touches files, with zero reshaping of anything DIR-126-D itself lands.

**Mechanism 1 — phase-boundary timing.** `prepare-admission-check.ts`'s `main()` and
`proposal-convergence.ts`'s CLI tail (`_decideResumeCli`/`_recordGenerationCli`/
`_writeGenerationTelemetryCli`/`_releaseLeaseOnlyCli`/`_recordAttemptCli`) each gain one additive
top-level `nowMs` field wrapped around their existing `console.log(JSON.stringify(...))` call, for
every CLI mode on both scripts — reusing each function's own already-computed `now`/`recordedAtMs`
value (zero new `Date.now()` call sites). This is added strictly at the CLI/`main()` boundary, never
inside the exported pure decision functions (`acquireLease`/`renewLease`/`releaseLease`/
`checkStaleOwner`/`decideResumeGeneration`) — preserving the "pure decision + thin CLI" architecture
those files already document and leaving every existing direct-import unit test of those functions
byte-for-byte unaffected.

`prepare-milestone.js` (both mirrors) then **parses `_renewLease`'s response for the first time**
(genuinely discarded today at all 6 call sites) and **extends `--acquire`'s already-parsed
`_admissionVerdict` to also read the new `.nowMs` field** (the verdict object itself is not new —
only the field being read from it is) — both reusing the existing `_parseAgentJson` balanced-brace
helper, the same one that already fixed the noisy-stdout defect `gap-prepare-milestone-noisy-agent-raw-json-parse`/M202) to read `.nowMs`, seeding `_lastBoundaryMs` from the first `--acquire` call and, at each
subsequent `_renewLease(stageLabel, round)` call, pushing `{phase, round, startedAtMs:
_lastBoundaryMs, endedAtMs: verdict.nowMs}` before advancing `_lastBoundaryMs`. `phase`/`round` are
threaded as an **explicit, already-in-scope integer parameter** (`_deltaRound`/`_planCheckRound`,
the same ints already used to build the `stageLabel` strings), **not** regex-parsed back out of the
formatted `stageLabel` string — a formatted label is a presentation string for human-readable
renewal audit trails, and coupling a parser to its exact format is a second, fragile source of truth
for structured data the caller already owns as a real variable; this costs one extra `_renewLease`
parameter, nothing else. The **final, still-open** phase span (the phase active when the terminal
call fires) is closed **server-side**: `prepare-milestone.js` threads `_phaseTimings` — the closed
spans plus one trailing open entry (`endedAtMs: null`) — as a new `--phaseTimings <json>` flag on
the SAME `--record-generation`/`--record-attempt` dispatch it already makes (double-`JSON.stringify`
idiom, matching `--detail`); the receiving `proposal-convergence.ts` call closes that trailing entry
using its own already-computed `now`/`recordedAtMs` before writing — never a value
`prepare-milestone.js` invents locally, and never a second round trip.

**Correction (this round):** only `_releaseLeaseAndRecord` carries a "fire-and-forget: callers await
and never parse the result" comment (about its own `--record-generation` release-call response) —
`_renewLease` carries no such comment (its own comment is about try/finally semantics, unrelated).
Since this child never starts parsing `_releaseLeaseAndRecord`'s release-call response (only
`_renewLease`'s renewal response and `--acquire`'s already-parsed verdict, per the corrected
Problem-framing above), `_releaseLeaseAndRecord`'s comment stays accurate and is NOT touched by this
child — no stale-comment update is needed here at all.

**Mechanism 2 — `findingCodes[]` recurrence tracking.** Every telemetry-writing call always includes
at least one code — `terminal.reason` (a parameter every one of the three writing CLI submodes
already receives, zero new plumbing) — plus, where `_ledger` (the DIR-125 `fingerprintFinding`-
derived stable-identity array) is in scope, one entry per `_ledger` entry's own `id`. `_ledger` is a
module-level `let` in `prepare-milestone.js`, declared before the ProposalReview/PlanAuthor/
PlanCheck/Receipt exits but **not yet declared** at 4 distinct pre-ledger terminal-return sites —
the 3 pre-lease `_recordAttemptAgentCall` exits, the 2 pre-ledger Preflight-rejected exits, AND
`ProposalAuthors`' own `proposal-author-incomplete` exit plus `Adjudicate`'s own `adjudicate-failed`
exit (both `_releaseLeaseAndRecord` calls confirmed textually before `let _ledger = []`, direct
source read) — those sites pass `findingCodes = [terminal.reason]` only, which is correct (not a
gap): conflating "no ledger yet" with "record everything as unresolved" would fabricate data
`buildTelemetryRecord`'s own no-fabrication discipline forbids.
`_ledger.map(f => f.id)` is threaded, JSON-stringified, as a new `--findingCodes <json>` flag
alongside `--phaseTimings` on the same dispatch sites.

Inside `proposal-convergence.ts`, for each code in `{terminal.reason} ∪ findingCodesFromCaller`:
`recurrenceKey = sha256(`${taskId}::${code}`).slice(0,12)` — reusing the stability property DIR-125's
own `fingerprintFinding` already established (summary text may be reworded round-to-round; the
code/id must not change). A new, small, **locally-implemented** helper inside
`proposal-convergence.ts` (not imported from `milestone-preparation-check.ts`'s
`queryTelemetryReport`) lists prior committed records under `milestones/prepare-telemetry/<taskId>/`
(reusing `telemetryPath`'s/`_safeTaskIdSegment`'s existing path-resolution logic verbatim, never a
second implementation), `JSON.parse`s each, and — mirroring `queryTelemetryReport`'s own established
"malformed file, skip, never crash" precedent — silently skips any file that fails to parse or lacks
a `findingCodes` array (tolerantly covering every record committed before this child lands). For a
given `recurrenceKey`, `firstSeenGeneration` is the earliest matching prior record's own
`generationId` (or `attemptId` at the 3 pre-lease sites, which have no `generationId` — a distinct
sub-case keyed independently, not conflated with the lease-holding sites), or the CURRENT record's
own id if no prior match exists; `lastSeenGeneration` is always the CURRENT record's own id (this
write is, by construction, the most recent sighting). The `--decide-resume` reuse-terminal block is
a fourth, already-existing write site sharing the same `buildTelemetryRecord` call (reached via an
early return, not a fourth independent CLI mode) — it gets `phaseTimings: []` (no phase ran, it's a
cache hit) and `findingCodes` computed from the reused terminal's own `reason` alone.

`buildTelemetryRecord`'s frozen `schemaVersion:2` shape gains two new additive top-level fields,
`phaseTimings` and `findingCodes`, both always explicit (never omitted, matching the function's
existing no-fabrication discipline — `[]` when empty, never a missing key). `validateTelemetryRecord`'s
`REQUIRED_TOP` grows to include both.

### Concrete control/data flow

1. Admission `--acquire` returns `{outcome, lease, nowMs}` — `nowMs` seeds `_lastBoundaryMs` in
   `prepare-milestone.js` (no `_phaseTimings` entry pushed yet — no prior boundary exists).
2. At each `_renewLease(stageLabel, round)` call: `const r = await _renewLease(stageLabel, round);
   _recordPhaseBoundary(stageLabel, round, r)` parses `r.raw` via `_parseAgentJson`; if `.nowMs` is
   present, pushes `{phase: stageLabel, round, startedAtMs: _lastBoundaryMs, endedAtMs: r.nowMs}`
   onto `_phaseTimings` and advances `_lastBoundaryMs = r.nowMs`. (A failed/unparseable renewal
   records nothing for that boundary and leaves `_lastBoundaryMs` unchanged — the file's existing
   fail-open-on-renewal-noise posture, since renewal failures are not today treated as fatal either.)
3. At whichever terminal `_releaseLeaseAndRecord`/`_writeGenerationTelemetry` call fires, the CLI
   command line gains `--phaseTimings <json>` (closed spans + 1 open trailing entry) and
   `--findingCodes <json-of-[terminal.reason,...(_ledger?.map(f=>f.id) ?? [])]>` (double-
   `JSON.stringify`, matching `--detail`'s existing idiom).
4. `proposal-convergence.ts`'s `_cliMain` parses both new flags (same shape as every other
   JSON-carrying flag), closes the trailing open `_phaseTimings` entry with its own `now`/
   `recordedAtMs`, computes `recurrenceKey`/`firstSeenGeneration`/`lastSeenGeneration` per code via
   the local scan helper, and calls `buildTelemetryRecord({..., phaseTimings, findingCodes})`.
5. For `--record-attempt` (the 3 pre-lease sites): no boundary has been dispatched yet, so
   `phaseTimings` is `[]` by construction; `findingCodes` is `[terminal.reason]`, and
   `firstSeenGeneration`/`lastSeenGeneration` are derived by scanning only other `--record-attempt`-
   written records for the same `taskId`, keyed on `attemptId` in place of `generationId` — a
   deliberate, distinct sub-case needing its own fixture, not an oversight.
6. `validateTelemetryRecord`'s widened `REQUIRED_TOP` is enforced only at write time (the one live
   caller, the pre-write `validateTelemetryRecord(telRecord)` check); nothing re-validates
   already-committed historical files, so DIR-126-E's existing `2a107fcb5cc9.json` (no
   `phaseTimings`/`findingCodes` keys) is never retroactively invalidated.

### Key design decisions

- **`buildTelemetryRecord` stays the single schema-materializer**; new fields are two new parameters
  there, not duplicated ad hoc at each of the 3-4 call sites.
- **`schemaVersion` stays 2, not bumped to 3.** DIR-126-D's own precedent frames a version bump as
  marking supersession of a *different* record family (v2 as superset of `.generation.json`'s own
  `schemaVersion:1`), not additive-field growth within the same family; `validateTelemetryRecord` is
  never invoked against already-committed records, so there is no forward-compatibility hazard
  forcing a bump. Reviewer-adjustable if a stricter reading of "frozen schema" is preferred (see
  Alternatives).
- **`nowMs` is added at the CLI/`main()` boundary only, never inside the exported pure decision
  functions** — preserves the documented pure-decision/thin-CLI architecture and leaves every
  existing direct-import unit test unaffected.
- **`round`/`phase` are threaded as explicit already-in-scope JS variables, never regex-parsed from
  the formatted `stageLabel` string** — avoids a second, fragile source of truth for structured data
  the caller already owns (see Alternatives #5).
- **Timing granularity is bounded to existing lease-touching dispatch points**, not finer-grained
  workflow-DSL `phase()` boundaries (e.g. `Preflight`/`ProposalAuthors`, which have no `_renewLease`
  call today) — a deliberate coarsening that costs zero new agent turns, over `phase()`-exact
  granularity that would require new dispatches purely for timestamps.
- **Recurrence identity is `sha256(taskId::code)`**, not a raw finding-summary hash — reusing the
  stability property DIR-125's `fingerprintFinding` already established.
- **The recurrence scan is a small, locally-implemented helper inside `proposal-convergence.ts`, not
  an import of `milestone-preparation-check.ts`'s `queryTelemetryReport`.** The real import graph
  already forms a verified 3-file cycle (`prepare-admission-check.ts → milestone-preparation-
  check.ts → proposal-convergence.ts → prepare-admission-check.ts`); adding a 4th edge in the
  opposite direction would tighten an already-fragile cycle for a ~15-line primitive. This mirrors
  the exact justification `prepare-admission-check.ts`'s own header comment already gives for
  locally reimplementing its lease primitive instead of importing `packages/quay/src/
  frontmatter-store-base.ts`'s `withFileLock()`.
- **Recurrence read is fail-closed per-file, not fail-closed for the whole write.** A corrupt/
  unparseable/pre-this-child (schema-lacking) prior record is skipped individually (treated as "no
  match from this file"), never fatal to the current write — mirrors `queryTelemetryReport`'s own
  established precedent exactly, rather than introducing a new failure mode.
- **No stale-comment update needed (corrected this round):** `_releaseLeaseAndRecord`'s own
  "fire-and-forget: callers await and never parse the result" comment describes its release-call
  response specifically, which this child never starts parsing — see the corrected Problem-framing
  above. The comment stays accurate.

### Defaults and failure behavior

- Missing/unparseable `nowMs` at any boundary: that boundary contributes no `_phaseTimings` entry
  and `_lastBoundaryMs` is left unchanged (so the next successful boundary still produces a wider,
  correctly bounded, just coarser duration) — fail-soft, matching the file's existing "telemetry is
  additive, never blocks the real gate" posture.
- No prior telemetry records exist for a `taskId` (first-ever generation): `firstSeenGeneration ===
  lastSeenGeneration === currentGenerationId` (or `attemptId`) for every code — the expected "first
  occurrence" shape, not an error state.
- `--findingCodes`/`--phaseTimings` flags omitted or unparseable (e.g. an older caller, or a
  malformed JSON string): default to `phaseTimings: []` / `findingCodes: [{code: terminal.reason,
  recurrenceKey: ..., firstSeenGeneration: <self>, lastSeenGeneration: <self>}]`, never throw —
  matches every other optional JSON-carrying CLI flag's existing tolerance in this file, and the
  write of the primary record must never be blocked by a secondary-field parse failure (matches the
  existing `telemetryWriteOk`-isolation posture `_writeCommittedTelemetry` already applies to the
  whole record write).
- A malformed/schema-lacking prior record encountered during the recurrence scan is skipped
  individually, never aborting the scan or the current write.
- A `_writeCommittedTelemetry`/recurrence-scan/timing-materialization throw anywhere in the new logic
  is caught by that function's own existing try/catch and surfaces as `telemetryWriteOk: false` —
  never prevents or retroactively invalidates the lease release that already happened (preserves
  DIR-126-D's AC13 guarantee unchanged).

### Compatibility

- Purely additive JSON fields on `milestones/prepare-telemetry/<taskId>/<recordId>.json` — no
  existing key renamed or removed; `queryTelemetryReport` and `checkPreparation`'s `telemetry-
  stale`/`telemetry-missing` hash-binding checks only ever hash-compare the exact file named by a
  receipt or skip malformed files, and neither performs field-level schema validation against old
  records, so both are unaffected. DIR-126-D's own header comment confirms nothing upstream reads
  this archive today besides this child's own new recurrence scanner (reading its own sibling files
  inside the same write call — no cross-version consumer to break).
- `prepare-admission-check.ts`'s pure decision functions (`acquireLease`/`renewLease`/`releaseLease`/
  `checkStaleOwner`/`decideResumeGeneration`) are untouched — only their CLI wrappers' printed JSON
  grows a field; `PREFLIGHT_CALIBRATED`/detector functions (`preflightMergedMarkdownClaims`,
  `preflightStaleAcRefs`, etc.) are untouched, confirmed with a diff-scoped check restricting the
  change to `main()`'s output-shaping.
- `.quay/prepare-leases/<taskId>.generation.json` (v1, gitignored) is explicitly not touched —
  `_writeLegacyGenerationRecord` stays byte-for-byte as today.
- `plugin/test/prepare-milestone-convergence.test.mjs`'s existing AC19 grep-based regression fixture
  already scans the whole `prepare-milestone.js` file with comment-stripping — since this child adds
  zero new `Date.now()`/`new Date()`/`import()` call sites to that file by design, this existing
  fixture is sufficient re-verification; no new fixture is needed for that specific guard (only
  confirmation it still passes).
- Mirror parity: `experiments/quay-perpetual-stream/scripts/{prepare-admission-check,
  proposal-convergence}.ts` vs `plugin/scripts/{...}` (confirmed byte-identical pre-this-child via
  `cmp`), and — once the Touches-list gap above is resolved —
  `.claude/workflows/prepare-milestone.js` vs `plugin/workflows/prepare-milestone.js` (also
  confirmed byte-identical pre-this-child) must stay identical after every edit.
- CI reality check: `plugin/test/prepare-admission-check.test.mjs` is `scripts/test.sh`-covered (via
  the plugin glob); `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` (the
  recurrence fixture's actual home per Touches) is not, and never has been — its AC/DoD evidence
  must cite a direct `node --experimental-strip-types --test` invocation.

### Risks

- **Touches-list/AC mismatch (flagged above) is the highest-priority open item.** This child cannot
  satisfy its own AC bullet 1/2 without editing `prepare-milestone.js` (both mirrors) and
  `plugin/test/prepare-milestone-convergence.test.mjs`, none of which the task's `## Touches` list
  names today. Must be resolved (Touches amendment) before Plan authoring, not discovered mid-Build.
- **Resolved (corrected this round):** `_renewLease` carries no "fire-and-forget" comment to reverse
  (that comment belongs to `_releaseLeaseAndRecord`, a different, untouched call) — see the
  corrected Problem-framing above. No AC bullet needed for a comment update.
- **This is `highRisk` because it touches `prepare-admission-check.ts`/`proposal-convergence.ts` as
  shared dependencies of every real `prepare-milestone` dispatch** — a regression in either CLI
  wrapper's JSON-printing path (e.g. a malformed `nowMs` interpolation breaking `_parseAgentJson`'s
  balanced-brace scan) would fail closed on every future milestone's Prepare stage. Two brand-new CLI
  flags on this shared surface must degrade to `[]`/self-referential defaults on any malformed value,
  never throw and break a terminal-return path that worked before this child — covered under
  Defaults above, but worth its own dedicated fixture given the blast radius.
- **Read-amplification**: the recurrence scan reads every prior committed record for a task on every
  write — O(n) `JSON.parse` calls per write. Acceptable at current scale (single-digit generations
  per task observed) but worth a Non-goal callout rather than silently ignored.
- **`REQUIRED_TOP` gaining two keys is forward-only-safe today** (nothing revalidates historical
  records) but is a latent trap if a future change ever adds a "re-validate all committed telemetry"
  sweep — worth a code comment at the `REQUIRED_TOP` definition itself flagging that constraint.
- **Double-`JSON.stringify` CLI-flag threading** reuses the existing `--detail`-flag idiom, so it is
  not new risk, but a sufficiently large `_ledger`/`_phaseTimings` array could still produce a long
  shell command line — bounded in practice by DIR-125's own `maxDeltaRounds` cap, but worth a sanity
  bound if `_ledger` ever grows unusually large.
- **The live-dispatch AC** ("phase-dispatch count confirmed equal to the telemetry record's own
  phase-transition entry count", "a real production callsite, not merely unit-test reachability")
  cannot be satisfied by unit tests alone — it requires a real `prepare-milestone` dispatch
  post-landing, examined via its workflow journal, as the DoD's own "fresh independent audit... real,
  non-fixture evidence" bullet already anticipates. Flag this explicitly in the Plan so it isn't
  quietly downgraded to a mocked-agent e2e check.

### Non-goals

- Not redesigning `.generation.json`'s v1 shape, `decideResumeGeneration`'s decision logic, or any
  of DIR-126-A/B/C's landed lease/preflight/resume mechanics.
- Not achieving `phase()`-DSL-exact timing granularity (`Preflight`/`ProposalAuthors` have no
  dedicated boundary dispatch today and none is added purely for timing).
- Not introducing a new committed-artifact type — both new fields live inside the existing telemetry
  record, not a parallel file.
- Not building a recurrence index/cache file — the committed telemetry archive itself is scanned
  directly, staying single-source-of-truth; not performance-optimizing the O(n) per-write scan (e.g.
  an index) until real generation counts justify it.
- Not carrying full finding objects (severity/disposition/evidence) into `findingCodes[]` — only the
  code/recurrenceKey/firstSeenGeneration/lastSeenGeneration identity quad; `proposal-ledger.json`
  stays the one place full finding detail lives.
- Not extending `--telemetry-report`'s read-only query/report output to aggregate or surface the new
  fields — a natural follow-up once real recurrence data has accumulated, out of scope here.
- Not retroactively backfilling `phaseTimings`/`findingCodes` into already-committed pre-this-child
  records, and not pruning/compacting `milestones/prepare-telemetry/<taskId>/` history.
- Not fixing the pre-existing `scripts/test.sh` glob gap for `experiments/quay-perpetual-stream/
  test/*.test.mjs` — noted as a grounding fact for how this child's own AC evidence must be gathered,
  not something this child's scope repairs.
- Not changing `capsFor()`/DIR-125's bounded-convergence caps or round limits — this child only
  observes and records timing/recurrence, never gates on it.

### AC coverage

- **AC1** (additive `nowMs`, zero new `Date.now()`/`import()` call sites in `prepare-milestone.js`,
  grep-based regression fixture): covered by Mechanism 1's CLI-boundary placement, the explicit
  `round`-parameter design (no string-parsing), and reuse of the existing AC19 fixture.
  **Gap/requirement**: AC1's wording doesn't name which of the six CLI modes gain `nowMs` — recommend
  explicit wording that all six do, fixture-asserted per mode; **also requires the Touches-list
  amendment flagged above** (`prepare-milestone.js`, both mirrors, plus
  `plugin/test/prepare-milestone-convergence.test.mjs`).
- **AC2** (phase-dispatch count == telemetry phase-transition entry count, across a real multi-round
  generation incl. a ProposalReview delta round and a PlanCheck round): covered by the
  `_lastBoundaryMs`-pairing accumulation (one entry per successful renewal, by construction), with
  the terminal span closed server-side using the terminal call's own `nowMs`. Needs a real fixture
  asserting `_phaseTimings.length` against actual renewal-call count for a multi-round generation,
  not just the count check.
- **AC3** (`findingCodes[]`/`recurrenceKey`/`firstSeenGeneration`/`lastSeenGeneration`, two-generation
  fixture confirming `lastSeenGeneration` advances while `firstSeenGeneration` pins): covered by
  Mechanism 2. **Gaps needing their own fixtures**: (a) every telemetry record — including the 3
  pre-lease `--record-attempt` sites and the 2 pre-ledger Preflight-rejected sites — has a non-empty
  `findingCodes[]` containing at minimum `{code: terminal.reason}`, not just the two-generation happy
  path; (b) graceful degradation when a sibling prior record is malformed/pre-this-child-schema
  (mirrors `queryTelemetryReport`'s precedent); (c) the `--record-attempt` sites' `attemptId`-keyed
  recurrence is a distinct code path from the lease-holding sites' `generationId`-keyed recurrence
  and needs independent proof.
- **AC4** (byte-identical mirrors re-verified): covered by `cmp`/`sync-vendor.sh --check` over all
  edited files — must explicitly also cover `.claude/workflows/prepare-milestone.js` vs
  `plugin/workflows/prepare-milestone.js` once the Touches-list gap is resolved.
- **AC5** (grounding evidence: `--record-generation`/`--decide-resume`/`--record-attempt` are the
  exact three extension points): reconfirmed above by direct source read. `--decide-resume`'s own
  reuse-terminal write path is a fourth site sharing the same underlying `buildTelemetryRecord` call
  (reached via an early return, not a fourth independent CLI mode) — not a contradiction of AC5's
  "exact three" framing, but flagged as its own sub-case needing coverage in Concrete control/data
  flow step 5 above.
- **DoD** (real, non-fixture production callsite, not merely unit-reachable): satisfied by the same
  mechanism DIR-126-D itself used — a real `prepare-milestone` dispatch's committed telemetry file
  inspected post-hoc for non-null `phaseTimings`/`findingCodes` content, plus an independent audit of
  the diff itself.

Recommended new/expanded AC bullets for PlanAuthor to incorporate (consolidating the gaps above,
not replacing the task's existing 5 bullets): (1) amend `## Touches` to add
`.claude/workflows/prepare-milestone.js`, `plugin/workflows/prepare-milestone.js`, and
`plugin/test/prepare-milestone-convergence.test.mjs`; (2) a fixture confirming
`_phaseTimings`/`--findingCodes` flag construction reads exclusively from already-parsed
`_parseAgentJson(...).nowMs` values and the existing `_ledger`/`_deltaRound`/`_planCheckRound`
variables; (3) a fixture confirming every one of the ~8 real terminal-return classes produces a
non-empty `findingCodes[]`; (4) a fixture with a corrupted/pre-this-child-schema sibling record
confirming the current write still succeeds and the malformed sibling is excluded from recurrence.

### Alternatives considered and rejected

1. **Compute `nowMs` inside `prepare-milestone.js` via a raw `Date.now()`/`new Date()` call.**
   Rejected: the workflow-DSL sandbox throws on this (confirmed live, AC19 fixture), and it is the
   exact class of two real production crashes (`f6db2a8`, `7357a91`) this codebase has already paid
   for twice.
2. **A dedicated new CLI script for timing/recurrence** instead of extending
   `prepare-admission-check.ts`/`proposal-convergence.ts` in place. Rejected: the task's own Touches
   list names exactly the two existing files; a third script would fragment DIR-126-D's single
   committed-telemetry-record ownership and require yet another mirror pair.
3. **A brand-new agent dispatch solely to sample a timestamp at each phase boundary**, matching
   commit `f6db2a8`'s own precedent shape. Rejected: every phase boundary already dispatches
   `_renewLease` (or `--acquire`/the terminal call) — doubling agent turns purely for a timestamp
   directly contradicts this file's own repeatedly-stated "zero new dispatch" design ethos.
   Piggybacking `nowMs` onto calls that already fire costs nothing extra.
4. **A separate committed file for phase timings/findingCodes** (parallel to
   `proposal-ledger.json`). Rejected: the task's own Requested action explicitly frames both as
   extensions to the telemetry record DIR-126-D already lands, and a second file would need its own
   hash-binding/staleness story duplicating what `buildTelemetryRecord`/`validateTelemetryRecord`
   already provide.
5. **Regex-parse `round` out of `stageLabel`** (e.g. `/round-(\d+)$/`). Rejected in favor of an
   explicit already-in-scope parameter — a formatted label is a presentation string, not a
   structured-data source, and coupling a parser to its exact format is the kind of implicit drift
   this repo's own CLAUDE.md flags as an anti-pattern.
6. **Bump `schemaVersion` to 3.** Considered viable; rejected as the default position (reviewer-
   adjustable) — it adds no real safety here (nothing re-validates historical records) and departs
   from DIR-126-D's own precedent of additive Claims within v2 and of reserving version bumps for
   genuinely new record *shapes* (v1→v2 was `.generation.json` → a whole new committed-telemetry
   tree), not field additions to an existing tree.
7. **Import `queryTelemetryReport` from `milestone-preparation-check.ts` into
   `proposal-convergence.ts`** for the prior-record scan. Rejected: would add a 4th edge to an
   already-existing, verified 3-file import cycle for a small, locally-reimplementable primitive —
   the same justification `prepare-admission-check.ts`'s own header comment already documents for
   locally reimplementing its lease primitive rather than importing `withFileLock()`.
8. **Recurrence tracking done in-memory inside `prepare-milestone.js` across a single generation**,
   rather than scanning the committed cross-generation archive on disk from
   `proposal-convergence.ts`. Rejected: each generation is a fresh process with no persistent state
   of its own; only the `milestones/prepare-telemetry/<taskId>/*.json` tree survives across
   generations, so cross-generation recurrence computation can only live in the subprocess that
   already reads/writes that tree.
9. **Carry full typed finding objects (not just the identity quad) into `findingCodes[]`.** Rejected:
   duplicates `proposal-ledger.json`'s content into a second location, a drift risk this repo's own
   single-source-of-truth principle warns against.

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
  `--findingCodes <json-of-[terminal.reason,...(_ledger?.map(f=>f.id) ?? [])]>`,
  `--phaseTimings`, `--phaseTimings <json>`, `--record-attempt`,
  `--record-generation`, `.claude/workflows/prepare-milestone.js`, `.lease`, `.nowMs`, `.ok`,
  `.outcome`, `.reclaimed`, `.telemetryWriteOk`, `7357a91`, `AC19`, `Adjudicate`, `Date.now()`,
  `JSON.stringify`, `PlanAuthor`, `PlanCheck-round-${_planCheckRound}`, `Preflight`,
  `ProposalAuthors`, `ProposalReview`, `ProposalReview-delta-round-${_deltaRound}`, `Receipt`,
  `_admissionVerdict`, `_cliMain`, `_decideResumeCli`, `_deltaRound`, `_lastBoundaryMs`,
  `_lastBoundaryMs = r.nowMs`, `_ledger`, `_parseAgentJson`, `_phaseTimings`, `_planCheckRound`,
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
  not a new invention.

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
