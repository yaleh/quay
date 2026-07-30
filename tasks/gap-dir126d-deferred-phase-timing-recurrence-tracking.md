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

DIR-126-D/M203 (landed `6a24bf3`, `milestone_counter` 199→200) shipped a real, production-wired
committed telemetry record — `buildTelemetryRecord`/`validateTelemetryRecord`/
`_writeCommittedTelemetry` in `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts`,
byte-identical mirror `plugin/scripts/proposal-convergence.ts` (reconfirmed this round via `cmp`,
empty diff) — written to `milestones/prepare-telemetry/<taskId>/<recordId>.json`, `schemaVersion: 2`.
A real committed example (`milestones/prepare-telemetry/DIR-126-E/2a107fcb5cc9.json`) confirms the
exact frozen top-level key set: `schemaVersion, recordId, attemptId, generationId, admission,
workspace, taskId, milestoneId, class, highRisk, hashes, decision, contentAgentDispatchCount,
contentAgentMs, terminal, leaseRelease, sessionId, recordedAtMs, telemetryWriteOk` — matching
`buildTelemetryRecord`'s own materialization and `validateTelemetryRecord`'s `REQUIRED_TOP` array
exactly. No phase-timing field and no recurrence field exists today (a repo-wide grep for
`phaseTimings|findingCodes|recurrenceKey|firstSeenGeneration|lastSeenGeneration` across
`experiments/quay-perpetual-stream/scripts/`, `plugin/scripts/`, and both `prepare-milestone.js`
mirrors returns zero hits — this is genuinely greenfield, not a rename).

Both enrichment ideas — per-phase-boundary `nowMs` timing and `findingCodes[]`/`recurrenceKey`
finding-recurrence tracking — were added in-flight during DIR-126-D's own ProposalReview convergence
and then deliberately trimmed once a direct grep of the M203 charter
(`experiments/quay-perpetual-stream/charters/M203-dir126d-prepare-telemetry.md`)'s Scope/Done-when
text confirmed neither was actually charter-mandated; the trim is what let `mechanismCount` drop
under `checkSplitRecommendation()`'s `split-multi-mechanism` threshold and let DIR-126-D converge.
Both ideas are real, additive, still-wanted extensions to a telemetry record already in production —
this task picks them up as their own explicitly-chartered scope, closing the "re-derive
charter-mandate status from scratch" gap that caused the original deferral.

Independently re-verified call-graph and constraint facts (grepped/read directly this round, not
inherited from any prior draft):

- `prepare-admission-check.ts`'s CLI `main()` (`:601-718`, byte-identical mirror) parses one of six
  mutually-exclusive modes — `--acquire`/`--renew`/`--release`/`--force-release`/`--preflight`/
  `--preflight-plan` — computes a single `const now = Date.now()` at line 648 shared by every mode,
  and never includes it in any of the ten `console.log(JSON.stringify(...))` call sites today. This
  is the correct, safe place to add a `nowMs` field: real subprocess-computed wall-clock time,
  already available, currently discarded on the way to stdout.
- `.claude/workflows/prepare-milestone.js` (byte-identical to `plugin/workflows/prepare-milestone.js`,
  reconfirmed via `cmp` this round) is a sandboxed workflow-DSL file with zero `import` statements.
  Its own header comment explains why `_parseAgentJson` exists (an `agent()` dispatch's reported
  stdout can carry non-JSON noise ahead of the real object —
  `gap-prepare-milestone-noisy-agent-raw-json-parse`/M202 — so every verdict is parsed with a
  balanced-brace scanner, never a naive `JSON.parse`). Separately,
  `plugin/test/prepare-milestone-convergence.test.mjs`'s AC19 test (`:1103`, "zero LIVE (non-comment)
  Date.now()/new Date(/await import(/bare import( call sites") greps the whole file with comment-stripping and
  cites two real production-crash commits by hash (`f6db2a8`, `7357a91`) as the regression class it
  guards against. **This is the load-bearing constraint on Mechanism 1's design**: any new timestamp
  value `prepare-milestone.js` touches must be read out of already-parsed subprocess JSON, never
  computed locally, and this task's new code must keep passing AC19 unmodified.
- `_renewLease(stageLabel)` (`:147`, `return _admissionAgentCall(...)`, zero parsing inside it) is
  dispatched at exactly 6 static call sites, reconfirmed by direct grep this round: `Adjudicate`
  (`:372`), `ProposalReview` (`:407`), `` `ProposalReview-delta-round-${_deltaRound}` `` (`:577`, up
  to `_maxDeltaRounds` times), `PlanAuthor` (`:638`), `` `PlanCheck-round-${_planCheckRound}` ``
  (`:719`, up to `MAX_PLANCHECK_ROUNDS` times), `Receipt` (`:755`) — every one a bare `await
  _renewLease(stageLabel)` with no variable capture. The renewal response is genuinely, completely
  discarded today at all 6 sites; this task is the first code to read anything out of it. By
  contrast, `--acquire`'s response is already parsed today into `_admissionVerdict` (`:221`,
  `_parseAgentJson(_admissionResult?.raw)`), whose `.outcome`/`.lease`/`.reclaimed` are already read
  and checked before Admission proceeds — it just has no `.nowMs` field to read yet, since that field
  doesn't exist until this task's Mechanism 1 adds it. So the real, narrower scope is: parse
  `_renewLease`'s response for the first time (genuinely new), and extend the already-parsed
  `_admissionVerdict` to read one new field (an extension, not a first-time-discarded-response
  discovery). The only "fire-and-forget: callers await and never parse the result" comment in the
  file (`:171`) belongs to `_releaseLeaseAndRecord`, describing its own `--record-generation`
  release-call response — a fourth, separate call/response pair this task does not touch; that
  comment stays accurate and needs no update. `_ledger` (`let _ledger = []`, confirmed at `:444`) is
  declared textually after 7 real terminal-return sites: the 3 pre-lease `_recordAttemptAgentCall`
  exits (`missing-required-args` `:90`, `admission-check-failed` `:228`, `prepare-already-running`
  `:234`, none holding a lease or `generationId`) plus 4 pre-ledger `_releaseLeaseAndRecord` exits
  (`preflight-check-failed` `:313`, `preflight-rejected` `:323`, `proposal-author-incomplete` `:366`,
  `adjudicate-failed` `:390`). At all 7 of these, `findingCodes` can only ever be
  `[terminal.reason]` — correct behavior, not a gap (fabricating ledger entries that were never
  produced would violate `buildTelemetryRecord`'s own no-fabrication discipline).
- `proposal-convergence.ts` writes a telemetry record from exactly three CLI submodes, confirmed by
  direct read: the shared `_writeCommittedTelemetry` helper (`:653`, used by `--record-generation`
  and `--record-generation --no-release`), the `--decide-resume` reuse-terminal inline block inside
  `_decideResumeCli` (`:512-587`, its own `buildTelemetryRecord` call, reached via early return — a
  fourth write *site* sharing the same underlying function, not a fourth independent CLI mode), and
  `_recordAttemptCli` (`--record-attempt`, `:738`, the 3 pre-lease sites, `generationId: null`, keyed
  by `computeAttemptId` instead). `--release-only` writes no telemetry.
- `telemetryPath`/`_safeTaskIdSegment` (`:341-371`) and `_writeTelemetryRecord` are existing,
  reusable primitives for locating/writing a task's telemetry tree — a recurrence scanner can reuse
  `telemetryPath`'s path-resolution logic verbatim rather than reimplementing it.
- `milestone-preparation-check.ts`'s `queryTelemetryReport` (`:159`) already walks the whole
  `milestones/prepare-telemetry/**/*.json` tree and explicitly skips any file that fails to parse
  ("Malformed telemetry file — skipped, never crashes the report query", `:173`) — the established,
  reusable precedent for tolerant reads over this same committed tree, which Mechanism 2's recurrence
  scan should mirror rather than invent a new failure posture for.
- `fingerprintFinding({subsystem, claimRef, summary})` (`:64`) already establishes a stable-hash
  identity idiom for findings (claimRef-anchored where present) — Mechanism 2's `recurrenceKey`
  reuses this same stability property (summary text may reword round to round; the code/id must not)
  rather than inventing a second one.
- The real import graph is a pre-existing 3-file cycle, reconfirmed this round by direct grep of
  every `./` import: `prepare-admission-check.ts → milestone-preparation-check.ts` (imports
  `parsePlanStages`/`validatePlanStructure`) `→ proposal-convergence.ts` (imports `blockingOpen`/
  `validateConvergenceCounters`/`computeConvergenceMetrics`) `→ prepare-admission-check.ts` (imports
  `PREFLIGHT_POLICY_VERSION`/`releaseLease`). Not introduced by this task, but constrains where the
  recurrence-scan helper can live without tightening an already-fragile cycle.
- `_recordAttemptAgentCall`'s existing double-`JSON.stringify` CLI-flag idiom (`--detail
  ${JSON.stringify(JSON.stringify(detailObj || {}))}`, `:83`) is the live, confirmed precedent for
  threading structured JSON as a CLI flag — this task reuses that exact idiom for its two new flags.
- `scripts/test.sh`'s canonical glob (`scripts/test.sh:37`, `packages/*/test/*.test.mjs
  plugin/test/*.test.mjs`, reconfirmed this round) does not reach
  `experiments/quay-perpetual-stream/test/*.test.mjs`. There is no
  `plugin/test/proposal-convergence.test.mjs` — the experiments-side test file is this task's own
  Touches entry, matching the file's own pre-existing convention (its relative import is
  `../scripts/proposal-convergence.ts`, no plugin counterpart needed). This is pre-existing repo
  behavior, not something this task fixes, but AC/DoD evidence for anything landing only in that file
  must cite a direct `node --experimental-strip-types --test` invocation, not a green
  `scripts/test.sh` run.

**Touches-list gap: already resolved, reconfirmed this round — not an open item.** All three input
drafts for this reconciliation independently flagged that satisfying AC bullet 1
(`prepare-milestone.js` accumulating `{phase, round, startedAtMs, endedAtMs}`) requires editing
`.claude/workflows/prepare-milestone.js`, `plugin/workflows/prepare-milestone.js`, and re-running
`plugin/test/prepare-milestone-convergence.test.mjs`'s AC19 fixture, and treated this as a required
Touches-list amendment. Reading the task's live `## Touches` list directly this round shows all three
files are already present there — the amendment has already landed on the task. This reconciliation
therefore treats the amendment as **done**, not as an outstanding risk; PlanAuthor needs no further
Touches-list change on this point, only to actually exercise the AC19 fixture and the workflow-file
edit the (already-correct) Touches list calls for.

### Chosen mechanism

Two independent, purely-additive extensions layered onto the already-landed DIR-126-D telemetry
pipeline, confined to the (already-amended) Touches set, with zero reshaping of anything DIR-126-D
itself lands.

**Mechanism 1 — phase-boundary timing.**

- `prepare-admission-check.ts`'s `main()` gains one additive `nowMs` field on the JSON object it
  already logs, for every one of the six CLI modes, reusing the already-computed `const now =
  Date.now()` at line 648 (zero new `Date.now()` call sites in this file). This lands strictly at the
  CLI/`main()` boundary — the exported pure decision functions (`acquireLease`/`renewLease`/
  `releaseLease`/`checkStaleOwner`/`decideResumeGeneration`) are untouched, preserving the documented
  pure-decision/thin-CLI split and leaving every existing direct-import unit test of those functions
  unaffected. **CLAIM (needs AC): `main()`'s JSON output for all six modes gains `nowMs`, verified
  per-mode by a fixture.**
- `proposal-convergence.ts`'s CLI tail (`_decideResumeCli`, the shared `_writeCommittedTelemetry`
  path, `_recordAttemptCli`) gains the equivalent additive field on its own already-computed
  `now`/`recordedAtMs` value — zero new `Date.now()` call sites there either.
- `.claude/workflows/prepare-milestone.js` (both mirrors) is extended so that:
  - `_renewLease` gains a second parameter, `round` (an already-in-scope integer the caller already
    owns — `_deltaRound`/`_planCheckRound` — never derived by regex-parsing the formatted
    `stageLabel` string). **CLAIM (needs AC): `_renewLease(stageLabel, round)`'s six call sites are
    updated to pass the caller's own round int, verified by a fixture asserting no regex/string-
    parsing of `stageLabel` is used to recover `round`.**
  - Each `_renewLease` call site's response is parsed for the first time via the existing
    `_parseAgentJson` helper to read `.nowMs`. **CLAIM (needs AC): `_renewLease`'s response is parsed
    at all 6 call sites and a phase-boundary entry is pushed only when `.nowMs` is present.**
  - `--acquire`'s already-parsed `_admissionVerdict` is extended to also read `.nowMs`, seeding a new
    module-level `_lastBoundaryMs` (no `_phaseTimings` entry is pushed at this step — no prior
    boundary exists yet to pair against).
  - At each successful `_renewLease` call, `{phase: stageLabel, round, startedAtMs:
    _lastBoundaryMs, endedAtMs: r.nowMs}` is pushed onto a new module-level `_phaseTimings` array and
    `_lastBoundaryMs` is advanced to `r.nowMs`.
  - The final, still-open span (active when a terminal call fires) is closed server-side, not in the
    sandboxed workflow file: `prepare-milestone.js` threads the accumulated `_phaseTimings` (closed
    spans + one trailing `{..., endedAtMs: null}` entry) as a new `--phaseTimings <json>` flag
    (double-`JSON.stringify`, matching `--detail`'s idiom) on the same terminal
    `--record-generation`/`--record-attempt` dispatch it already makes; `proposal-convergence.ts`
    closes the trailing entry using its own already-computed `now`/`recordedAtMs` before calling
    `buildTelemetryRecord`. **CLAIM (needs AC): the terminal call's `--phaseTimings` flag is parsed
    inside `proposal-convergence.ts` and the trailing open entry is closed with the receiver's own
    timestamp, never a value invented in the sandboxed caller.**

**Mechanism 2 — `findingCodes[]` recurrence tracking.**

- Every telemetry-writing call always contributes at least one code: `terminal.reason` (a parameter
  every one of the three writing CLI submodes already receives — zero new plumbing for this baseline
  code), plus, where the DIR-125 `_ledger` array is in scope, one entry per ledger finding's own
  stable `id` (`_ledger.map(f => f.id)`). At the 7 pre-ledger terminal-return sites identified above
  (3 pre-lease `_recordAttemptAgentCall` exits + 4 pre-ledger `_releaseLeaseAndRecord` exits),
  `findingCodes = [terminal.reason]` only — correct, not a gap.
  **CLAIM (needs AC): `prepare-milestone.js` threads
  `--findingCodes <json-of-[terminal.reason, ...(_ledger?.map(f=>f.id) ?? [])]>` alongside
  `--phaseTimings` on the same terminal dispatch sites.**
- Inside `proposal-convergence.ts`, for each code, `recurrenceKey = sha256(`${taskId}::${code}`).
  slice(0,12)` reuses `fingerprintFinding`'s established stability property.
- A new, small, locally-implemented helper inside `proposal-convergence.ts` (not an import of
  `milestone-preparation-check.ts`'s `queryTelemetryReport`) lists prior committed records under
  `milestones/prepare-telemetry/<taskId>/`, reusing `telemetryPath`/`_safeTaskIdSegment`'s existing
  path-resolution logic verbatim, `JSON.parse`s each, and — mirroring the confirmed
  malformed-file-skip precedent — silently skips any file that fails to parse or lacks a
  `findingCodes` array (covering every record committed before this task lands).
  **CLAIM (needs AC): the recurrence scan is implemented as a local helper reusing
  `_safeTaskIdSegment`/`telemetryPath`, not a new import edge into `milestone-preparation-check.ts`.**
- For a given `recurrenceKey`: `firstSeenGeneration` is the earliest matching prior record's own
  `generationId` (or `attemptId` at the 3 pre-lease sites, a distinct sub-case keyed independently),
  or the current record's own id if no prior match exists; `lastSeenGeneration` is always the current
  record's own id.
- The `--decide-resume` reuse-terminal write path gets `phaseTimings: []` (no phase ran — it's a
  cache hit) and `findingCodes` computed from the reused terminal's own `reason` alone.
- `buildTelemetryRecord`'s frozen shape gains two new additive top-level parameters/fields,
  `phaseTimings` and `findingCodes`, both always explicit (`[]` when empty, never a dropped key,
  matching the function's existing `?? null`/always-materialized discipline). `validateTelemetryRecord`'s
  `REQUIRED_TOP` array grows to include both. **CLAIM (needs AC): `REQUIRED_TOP` includes
  `phaseTimings`/`findingCodes` and a record missing either fails validation with
  `telemetry-field-missing`, verified by a fixture.**

### Concrete control/data flow

1. `--acquire` returns `{outcome, lease, nowMs, ...}`; `nowMs` seeds `_lastBoundaryMs` in
   `prepare-milestone.js`. No `_phaseTimings` entry is pushed yet (no prior boundary exists).
2. At each `_renewLease(stageLabel, round)` call: `const r = await _renewLease(stageLabel, round);
   _recordPhaseBoundary(stageLabel, round, r)` parses `r.raw` via `_parseAgentJson`; if `.nowMs` is
   present, pushes `{phase: stageLabel, round, startedAtMs: _lastBoundaryMs, endedAtMs: r.nowMs}`
   onto `_phaseTimings` and advances `_lastBoundaryMs = r.nowMs`. A failed/unparseable renewal
   records nothing for that boundary and leaves `_lastBoundaryMs` unchanged (fail-soft — renewal
   failures are not fatal today either, and the next successful boundary still produces a wider,
   correctly bounded, just coarser span).
3. At whichever terminal call fires (`_releaseLeaseAndRecord`/`_writeGenerationTelemetry`), the CLI
   command line gains `--phaseTimings <json>` (closed spans + 1 open trailing entry) and
   `--findingCodes <json>` (double-`JSON.stringify`).
4. `proposal-convergence.ts`'s CLI entry parses both new flags (same optional-JSON-flag shape as
   every other flag in this file), closes the trailing open `_phaseTimings` entry with its own
   `now`/`recordedAtMs`, computes `recurrenceKey`/`firstSeenGeneration`/`lastSeenGeneration` per code
   via the local scan helper, and calls `buildTelemetryRecord({..., phaseTimings, findingCodes})`.
5. For `--record-attempt` (the 3 pre-lease sites): no boundary has fired yet, so `phaseTimings: []`
   by construction; `findingCodes: [terminal.reason]`; `firstSeenGeneration`/`lastSeenGeneration` are
   derived by scanning only other `--record-attempt`-written records for the same `taskId`, keyed on
   `attemptId` — a distinct, independently-fixtured sub-case, not folded into the lease-holding path.
6. `validateTelemetryRecord`'s widened `REQUIRED_TOP` is enforced only at write time (the single live
   pre-write call); nothing re-validates already-committed historical files, so DIR-126-D/E-era
   records with no `phaseTimings`/`findingCodes` keys (e.g. the confirmed
   `DIR-126-E/2a107fcb5cc9.json`) are never retroactively invalidated.

### Key design decisions

- `buildTelemetryRecord` stays the single schema-materializer; the two new fields are new function
  parameters there, not duplicated ad hoc at each write site.
- `schemaVersion` stays `2`, not bumped to `3` (default position, reviewer-adjustable — see
  Alternatives): DIR-126-D's own precedent treats a version bump as marking supersession of a
  different record *family* (v2 superseding `.generation.json`'s v1), not additive-field growth
  within the same family, and nothing re-validates historical records so there is no
  forward-compatibility hazard forcing a bump.
- `nowMs` is added strictly at the CLI/`main()` boundary, never inside exported pure decision
  functions, preserving the documented architecture split.
- `round` is threaded as an explicit already-in-scope JS int, never regex-parsed out of
  `stageLabel` — avoids a second, fragile source of truth for structured data the caller already
  owns as a real variable.
- Timing granularity is bounded to existing `_renewLease`-touching dispatch points (no new dispatch
  purely for a timestamp) — `Preflight`/`ProposalAuthors` have no renewal call today and gain no new
  one under this design, a deliberate coarsening favored over `phase()`-DSL-exact granularity that
  would cost new agent turns.
- Recurrence identity is `sha256(taskId::code)`, reusing `fingerprintFinding`'s established
  stability property rather than inventing a second identity scheme.
- The recurrence scan is a small, local helper inside `proposal-convergence.ts`, not an import of
  `milestone-preparation-check.ts`'s `queryTelemetryReport` — the real import graph already forms a
  3-file cycle; adding a 4th edge in the opposite direction would tighten an already-fragile cycle
  for a ~15-line primitive, the same justification `prepare-admission-check.ts`'s own header comment
  already gives for locally reimplementing its lease primitive instead of importing
  `packages/quay/src/frontmatter-store-base.ts`'s `withFileLock()`.
- The recurrence read is fail-closed per-file, not fail-closed for the whole write — a corrupt/
  unparseable/pre-this-task record is skipped individually, mirroring the established
  malformed-file-skip precedent rather than introducing a new failure mode.
- No stale-comment fix is needed anywhere in `prepare-milestone.js`: the file's one
  "fire-and-forget" comment belongs to `_releaseLeaseAndRecord`, whose response this task never
  starts parsing.

### Defaults and failure behavior

- Missing/unparseable `nowMs` at any boundary: no `_phaseTimings` entry is pushed for that boundary,
  `_lastBoundaryMs` is left unchanged — fail-soft, matching the existing "telemetry is additive,
  never blocks the real gate" posture (renewal failures are not fatal today either).
- No prior telemetry records for a `taskId`: `firstSeenGeneration === lastSeenGeneration ===` the
  current record's own id for every code — the expected first-occurrence shape, not an error.
- `--findingCodes`/`--phaseTimings` omitted or unparseable (older caller, malformed JSON): default to
  `phaseTimings: []` / `findingCodes: [{code: terminal.reason, recurrenceKey: ..., firstSeenGeneration:
  <self>, lastSeenGeneration: <self>}]`, never throw — matches every other optional JSON-flag's
  existing tolerance in this file; a secondary-field parse failure must never block the primary
  record write (mirrors the existing `telemetryWriteOk`-isolation posture already applied to the
  whole record write).
- A malformed/schema-lacking prior record hit during the recurrence scan is skipped individually,
  never aborting the scan or the current write.
- Any throw inside the new timing/recurrence logic is caught by the existing enclosing try/catch and
  surfaces as `telemetryWriteOk: false` — never prevents or retroactively invalidates a lease release
  that already happened (preserves DIR-126-D's AC13 guarantee, the existing
  lease-release-independent-of-telemetry-write posture, unchanged).

### Compatibility

- Purely additive JSON fields on the committed telemetry record — no existing key renamed or removed.
  `queryTelemetryReport` and `checkPreparation`'s hash-binding checks only hash-compare a named file
  or skip malformed ones; neither performs field-level schema validation against old records, so both
  stay unaffected. No other confirmed consumer reads this archive today besides this task's own new
  recurrence scanner (reading its own sibling files inside the same write call).
- `prepare-admission-check.ts`'s pure decision functions and preflight detector functions
  (`preflightMergedMarkdownClaims`, `preflightStaleAcRefs`, etc.) are untouched — only the CLI
  wrapper's printed JSON grows a field.
- `.quay/prepare-leases/<taskId>.generation.json` (v1, gitignored) is not touched;
  `_writeLegacyGenerationRecord` stays byte-for-byte unchanged.
- The existing AC19 grep-based fixture already scans the whole `prepare-milestone.js` file for live
  `Date.now()`/`new Date()`/`import()` call sites with comment-stripping; since this task adds zero
  such call sites by design, the existing fixture is sufficient re-verification (confirm it still
  passes; no new fixture needed for that specific guard).
- Mirror parity: `experiments/quay-perpetual-stream/scripts/{prepare-admission-check,
  proposal-convergence}.ts` vs `plugin/scripts/{...}` and `.claude/workflows/prepare-milestone.js` vs
  `plugin/workflows/prepare-milestone.js` — all four confirmed byte-identical pre-this-task via `cmp`
  this round — must stay identical after every edit.
- `plugin/test/prepare-admission-check.test.mjs` is `scripts/test.sh`-covered; the recurrence
  fixture's home, `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`, is not and
  never has been (confirmed: `scripts/test.sh`'s canonical glob does not reach
  `experiments/quay-perpetual-stream/test/*.test.mjs`) — its AC/DoD evidence must cite a direct
  `node --experimental-strip-types --test` invocation, not a `scripts/test.sh` green run.
- **Touches list**: already amended and correct as read this round — `.claude/workflows/
  prepare-milestone.js`, `plugin/workflows/prepare-milestone.js`, and
  `plugin/test/prepare-milestone-convergence.test.mjs` are all present in the task's live `##
  Touches` list. No further amendment needed; PlanAuthor should treat these as in-scope files to
  edit, with AC4 explicitly covering their mirror-parity re-verification.

### Risks

- `highRisk` because this touches `prepare-admission-check.ts`/`proposal-convergence.ts` as shared
  dependencies of every real `prepare-milestone` dispatch's Admission/Preflight/`_renewLease` calls —
  a regression in either CLI wrapper's JSON-printing path (e.g. a malformed `nowMs` interpolation
  breaking `_parseAgentJson`'s balanced-brace scan) fails closed on every future milestone's Prepare
  stage. Both new CLI flags on this shared surface must degrade to their documented defaults on any
  malformed value, never throw and break a terminal-return path that worked before this task — needs
  its own dedicated fixture given the blast radius, beyond the general Defaults coverage above.
- Read-amplification: the recurrence scan reads every prior committed record for a task on every
  write (O(n) `JSON.parse` per write). Acceptable at current observed scale (single-digit generations
  per task); called out as a Non-goal to optimize, not silently ignored.
- `REQUIRED_TOP` gaining two keys is forward-only-safe today (nothing revalidates historical
  records) but is a latent trap if a future change ever adds a re-validate-all-committed-telemetry
  sweep — worth a code comment at the `REQUIRED_TOP` definition flagging this.
- The double-`JSON.stringify` CLI-flag idiom is an existing, proven pattern, not new risk in itself,
  but a sufficiently large `_ledger`/`_phaseTimings` array could still lengthen the shell command
  line — bounded in practice by the existing delta-round/plan-check-round caps, but worth a sanity
  bound if `_ledger` ever grows unusually large.
- The live-dispatch AC ("phase-dispatch count equals the telemetry record's own phase-transition
  entry count", on a real production callsite) cannot be satisfied by unit tests alone — it requires
  a real `prepare-milestone` dispatch post-landing, examined via its own workflow journal, matching
  the DoD's "fresh independent audit... real, non-fixture evidence" bar. Must stay explicit in the
  Plan so it is not quietly downgraded to a mocked-agent e2e check.

### Non-goals

- Not redesigning `.generation.json`'s v1 shape, `decideResumeGeneration`'s decision logic, or any
  already-landed lease/preflight/resume mechanics from earlier DIR-126 children.
- Not achieving `phase()`-DSL-exact timing granularity — no new dispatch is added purely for timing.
- Not introducing a new committed-artifact type — both new fields live inside the existing telemetry
  record, not a parallel file.
- Not building a recurrence index/cache file — the committed telemetry archive itself is scanned
  directly, staying single-source-of-truth; not performance-optimizing the O(n) per-write scan until
  real generation counts justify it.
- Not carrying full finding objects (severity/disposition/evidence) into `findingCodes[]` — only the
  code/recurrenceKey/firstSeenGeneration/lastSeenGeneration identity quad; the ledger file stays the
  one place full finding detail lives.
- Not extending any read-only telemetry-report query mode to aggregate or surface the new fields —
  a natural follow-up once real recurrence data has accumulated, out of scope here.
- Not retroactively backfilling `phaseTimings`/`findingCodes` into already-committed pre-this-task
  records, and not pruning/compacting telemetry history.
- Not fixing the pre-existing `scripts/test.sh` glob gap for `experiments/quay-perpetual-stream/
  test/*.test.mjs` — a grounding fact for how this task's own AC evidence must be gathered, not
  something this task's scope repairs.
- Not changing any bounded-convergence caps or round limits — this task only observes and records
  timing/recurrence, never gates on it.

### AC coverage

- **AC1** (additive `nowMs`, zero new `Date.now()`/`import()` call sites in `prepare-milestone.js`,
  grep-based regression fixture): covered by Mechanism 1's CLI-boundary placement, the explicit
  `round`-parameter design, and reuse of the existing AC19 fixture. Needs explicit wording that all
  six `prepare-admission-check.ts` CLI modes gain `nowMs`, fixture-asserted per mode. The Touches
  list already names all three required files (`prepare-milestone.js` both mirrors,
  `plugin/test/prepare-milestone-convergence.test.mjs`); no further Touches amendment is needed.
- **AC2** (phase-dispatch count == telemetry phase-transition entry count on a real multi-round
  generation, incl. a ProposalReview delta round and a PlanCheck round): covered by the
  `_lastBoundaryMs`-pairing accumulation (one entry per successful renewal) with the terminal span
  closed server-side. Needs a real fixture asserting `_phaseTimings.length` against actual
  renewal-call count for a multi-round generation, plus the real post-dispatch journal check flagged
  under Risks (cannot be satisfied by unit tests alone).
- **AC3** (`findingCodes[]`/`recurrenceKey`/`firstSeenGeneration`/`lastSeenGeneration`, two-generation
  fixture confirming `lastSeenGeneration` advances while `firstSeenGeneration` pins): covered by
  Mechanism 2. Needs dedicated fixtures for: (a) every one of the 7 pre-ledger terminal-return
  classes (3 pre-lease `--record-attempt` sites + 4 pre-ledger `_releaseLeaseAndRecord` exits)
  producing a non-empty `findingCodes[]` containing at minimum `{code: terminal.reason}`; (b)
  graceful degradation when a sibling prior record is malformed/pre-this-task-schema; (c) the
  `--record-attempt` sites' `attemptId`-keyed recurrence as an independently-proven, distinct code
  path from the lease-holding sites' `generationId`-keyed recurrence.
- **AC4** (byte-identical mirrors re-verified): covered by `cmp`/`sync-vendor.sh --check` over every
  edited file, explicitly including `.claude/workflows/prepare-milestone.js` vs
  `plugin/workflows/prepare-milestone.js` (both already in Touches, confirmed byte-identical
  pre-this-task via `cmp` this round).
- **AC5** (grounding evidence that `--record-generation`/`--decide-resume`/`--record-attempt` are the
  exact three extension points): reconfirmed above by direct source read (three writing CLI
  submodes, plus the `--decide-resume` reuse-terminal early-return sharing the same
  `buildTelemetryRecord` call as a documented fourth *site*, not a contradiction of "exact three"
  CLI *modes*).
- **DoD** (real, non-fixture production callsite, not merely unit-reachable): satisfied the same way
  DIR-126-D itself satisfied it — a real `prepare-milestone` dispatch's committed telemetry file
  inspected post-hoc for non-null `phaseTimings`/`findingCodes` content, plus an independent audit of
  the diff itself.

Recommended AC clarifications for PlanAuthor to incorporate (consolidating the gaps above, not
replacing the task's existing 5 bullets; the Touches-list amendment all three drafts recommended is
already reflected in the live task and needs no further action): (1) a fixture confirming
`_phaseTimings`/`--findingCodes` construction reads exclusively from already-parsed
`_parseAgentJson(...).nowMs` values and the existing `_ledger`/`_deltaRound`/`_planCheckRound`
variables (no `Date.now()`, no regex-parsing of `stageLabel`); (2) a fixture confirming every real
terminal-return class (all 7 pre-ledger sites plus the lease-holding sites) produces a non-empty
`findingCodes[]`; (3) a fixture with a corrupted/pre-this-task-schema sibling record confirming the
current write still succeeds and the malformed sibling is excluded from recurrence; (4) a fixture
explicitly naming and diffing every touched mirror pair.

### Alternatives considered and rejected

1. **Compute `nowMs` inside `prepare-milestone.js` via a raw `Date.now()`/`new Date()` call.**
   Rejected: the sandbox throws on this (AC19 fixture), and it is the exact class of two real
   production crashes this codebase has already paid for twice (`f6db2a8`, `7357a91`).
2. **A dedicated new CLI script for timing/recurrence**, instead of extending
   `prepare-admission-check.ts`/`proposal-convergence.ts` in place. Rejected: the task's own scope
   names exactly these two existing files; a third script would fragment single-record ownership and
   require yet another mirror pair.
3. **A brand-new agent dispatch solely to sample a timestamp at each phase boundary.** Rejected: every
   phase boundary already dispatches `_renewLease` (or `--acquire`/the terminal call) — doubling
   agent turns purely for a timestamp contradicts this file's own "zero new dispatch" design ethos.
   Piggybacking `nowMs` onto calls that already fire costs nothing extra.
4. **A separate committed file for phase timings/findingCodes**, parallel to the existing ledger file.
   Rejected: both are framed as extensions to the telemetry record already in production, and a
   second file would need its own hash-binding/staleness story duplicating what
   `buildTelemetryRecord`/`validateTelemetryRecord` already provide.
5. **Regex-parse `round` out of `stageLabel`** (e.g. `/round-(\d+)$/`). Rejected in favor of an
   explicit already-in-scope parameter — a formatted label is a presentation string, not a
   structured-data source, and coupling a parser to its exact format is a fragile, avoidable second
   source of truth.
6. **Bump `schemaVersion` to 3.** Considered viable, rejected as the default position
   (reviewer-adjustable): adds no real safety here (nothing re-validates historical records) and
   departs from the existing precedent of reserving version bumps for genuinely new record shapes,
   not field additions within an existing one.
7. **Import `queryTelemetryReport` from `milestone-preparation-check.ts` into
   `proposal-convergence.ts`** for the prior-record scan. Rejected: would add a 4th edge to an
   already-existing, verified 3-file import cycle for a small, locally-reimplementable primitive —
   the same justification already used elsewhere in this codebase for locally reimplementing a lease
   primitive rather than importing a shared file-lock helper.
8. **Recurrence tracking done in-memory inside `prepare-milestone.js` across a single generation**,
   rather than scanning the committed cross-generation archive on disk from
   `proposal-convergence.ts`. Rejected: each generation is a fresh process with no persistent state
   of its own; only the committed telemetry tree survives across generations, so cross-generation
   recurrence can only be computed in the subprocess that already reads/writes that tree.
9. **Carry full typed finding objects (not just the identity quad) into `findingCodes[]`.** Rejected:
   duplicates the ledger file's content into a second location, a drift risk this repo's own
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
- [ ] **Recurrence scan stays a local helper, never a new import edge:** an import-graph check
  (grep/AST) confirms zero new `import` statements are added between `proposal-convergence.ts` and
  `milestone-preparation-check.ts` — the recurrence scan reuses `_safeTaskIdSegment`/`telemetryPath`
  as a local helper within `proposal-convergence.ts` itself.
- [ ] **`REQUIRED_TOP` extension fails closed:** a fixture record missing either `phaseTimings` or
  `findingCodes` is confirmed to fail `validateTelemetryRecord` with `telemetry-field-missing`,
  distinct from the already-covered "fields are added to the record" claim above.
- [ ] **`round` is threaded explicitly, never regex-parsed from `stageLabel`:** a fixture confirms
  `_phaseTimings`/`--findingCodes` construction reads exclusively from already-parsed
  `_parseAgentJson(...).nowMs` values and the existing `_ledger`/`_deltaRound`/`_planCheckRound`
  variables — no `Date.now()`, no regex-parsing of `stageLabel` to recover `round`.
- [ ] **Missing/unparseable `nowMs` degrades fail-soft:** a fixture forcing a boundary's `nowMs` to
  be absent/unparseable confirms no `_phaseTimings` entry is pushed for that boundary and
  `_lastBoundaryMs` is left unchanged — distinct from the happy-path multi-round journal item above.
- [ ] **All 7 pre-ledger terminal-return classes produce `findingCodes[]`:** the 3 pre-lease
  `_recordAttemptAgentCall` exits (`missing-required-args`, `admission-check-failed`,
  `prepare-already-running`) and the 4 pre-ledger `_releaseLeaseAndRecord` exits
  (`proposal-author-incomplete`, `adjudicate-failed`, plus the 2 pre-`let _ledger = []`
  `preflight-rejected`-shaped exits) each independently produce a non-empty `findingCodes[]` seeded
  from `terminal.reason` alone — distinct from the general `findingCodes[]` item above.
- [ ] **All six `prepare-admission-check.ts` CLI modes gain `nowMs`:** acquire, renew, release,
  force-release, preflight, and preflight-plan are each individually fixture-verified to carry the
  additive `nowMs` field in their JSON output.
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
