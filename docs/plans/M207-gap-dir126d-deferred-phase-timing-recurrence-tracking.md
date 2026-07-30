# M207 Plan — gap-dir126d-deferred-phase-timing-recurrence-tracking

**Milestone:** M207 · **Task:** gap-dir126d-deferred-phase-timing-recurrence-tracking
**Charter:** experiments/quay-perpetual-stream/charters/M207-gap-dir126d-deferred-enrichment.md
**Base revision:** c82efac (current HEAD short-sha, 2026-07-30; 2d67a92 is HEAD~1)
**Class:** development / execution · **Value type:** capabilityGrowth · **highRisk:** yes
**Discipline:** human-steered, direct-to-master (DIR-027 hygiene; never concurrent with another `execute-milestone` dispatch)

## 0. Problem in one line

DIR-126-D/M203 (landed `6a24bf3`) trimmed two enrichment ideas that its own ProposalReview found
were never M203-charter-mandated; the M207 charter now re-scopes both in its own words — additive
per-phase-boundary `nowMs` self-reporting on `prepare-admission-check.ts`'s JSON output and
`findingCodes[]`/`recurrenceKey`/`firstSeenGeneration`/`lastSeenGeneration` on the committed
telemetry record's frozen schema — and this Plan implements them as two purely-additive extensions
(`mechanismCount = 2`, charter is the scope authority), reshaping nothing DIR-126-D landed.

All anchors below were re-verified by direct source read at base revision `c82efac` (current HEAD).
Where the task's Proposal cited anchors for `prepare-admission-check.ts` that resolve to the prior
revision `2d67a92` (HEAD~1) — `main(argv)` :601 and the single `const now = Date.now()` :648, the
positions that held BEFORE `c82efac`'s +33-line insert of `_splitTopLevelCommas`/
`_stripWrappingBacktick` at :465 — this Plan uses the current-base ones (`main(argv)` :634; the
single `const now = Date.now()` :681; CLI print sites :686/:695/:700/:705/:711/:721/:726/:731/:741/
:744; `--release-only` command string :202). The Proposal's :601/:648 were not drift but the correct
`@2d67a92` values; every other anchor (prepare-milestone.js, proposal-convergence.ts, the AC19 guard,
`scripts/test.sh`, milestone-preparation-check.ts) is unchanged between the two revisions and
verifies clean. Stage 8 records the full table as grounding evidence (AC12).

## 1. Complete touch set (matches task `## Touches` exactly — verified complete, no amendment)

Source (all line counts @ c82efac, the declared base):
1. `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` (751 lines) — CLI wrapper: `nowMs` stamping on all six modes.
2. `plugin/scripts/prepare-admission-check.ts` (byte-identical mirror of 1, `cmp`-verified pre-task).
3. `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` (851 lines) — receiver: flag parsing, trailing-span close, recurrence scan, `buildTelemetryRecord`/`REQUIRED_TOP` widening.
4. `plugin/scripts/proposal-convergence.ts` (byte-identical mirror of 3).
5. `.claude/workflows/prepare-milestone.js` (863 lines) — sandbox: `_renewLease` round param, `_recordPhaseBoundary`, `_phaseTimings`/`_lastBoundaryMs`, `_findingCodesFor`/`_ledgerLive`, flag threading onto existing dispatches.
6. `plugin/workflows/prepare-milestone.js` (byte-identical mirror of 5).

Tests:
7. `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` (755 lines; NOT in `scripts/test.sh`'s glob — evidence cites direct `node --experimental-strip-types --test`).
8. `plugin/test/prepare-admission-check.test.mjs` (`scripts/test.sh`-covered).
9. `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` (1108 lines; NOT in `scripts/test.sh`'s glob — glob verified at `scripts/test.sh:37`).
10. `plugin/test/prepare-milestone-convergence.test.mjs` (1117 lines; `scripts/test.sh`-covered; holds the AC19 regression guard at :1103-1110).

Runtime artifacts written by the implemented code (declared, not hand-authored; NO new artifact type):
- `milestones/prepare-telemetry/<taskId>/<recordId>.json` — the existing DIR-126-D record, gaining two additive top-level keys (`phaseTimings`, `findingCodes`).

Explicitly NOT touched: `milestone-preparation-check.ts` (both mirrors), `.generation.json`'s v1 shape / `_writeLegacyGenerationRecord`, `decideResumeGeneration`'s output shape, convergence caps/round limits (`MAX_PLANCHECK_ROUNDS` :714, `_maxDeltaRounds`).

## 2. Ordered stages

Line budgets are additive deltas @ c82efac sizes (mirrors counted once each). Dependencies are strict
ordering constraints (a stage starts only after its predecessors are GREEN). Every stage keeps all
three edited mirror pairs byte-identical — `cmp` across all three pairs, with
`plugin/scripts/sync-vendor.sh --check` clean for the two `plugin/scripts/` pairs it actually
covers (its SYNC_SCRIPTS list holds only `proposal-convergence` + `prepare-admission-check`; the
`.claude/workflows/prepare-milestone.js` ↔ `plugin/workflows/prepare-milestone.js` pair is
`cmp`-only) — at its end. RED/implementation/GREEN phases are named per stage with expected exit
behavior.

---

### Stage 1: RED — CLI `nowMs` self-report fixtures (both prepare-admission-check test files)

- AC: 1, 11
- Files: experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs, plugin/test/prepare-admission-check.test.mjs
- Command: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs — RED phase: first add fixtures individually covering all six CLI modes (`--acquire`, `--renew`, `--release`, `--force-release`, `--preflight`, `--preflight-plan`) on BOTH the success path AND the error path (`{ok:false,...}`/`{outcome:"error",...}` shapes), each asserting the additive `nowMs` field is a finite epoch-ms number; for the two preflight modes (which print the returned `runPreflightChecks` object directly) a sub-assertion that the existing `{ok, policyVersion, findings}` keys survive a non-clobbering `{...result, nowMs}` spread unchanged (downstream Preflight verdict parsing depends on them). Run this command — expected exit ≠ 0 (fixtures fail: no `nowMs` emitted yet). The plugin-mirror twin runs via `scripts/test.sh plugin/test/prepare-admission-check.test.mjs` with the same RED expectation (exit ≠ 0).

Classification: code (tests only). Budget: ~130 lines across both test files.
Depends on: none.
RED exit behavior: test-runner exit ≠ 0 (assertions fail on absent `nowMs`).

### Stage 2: GREEN — stamp `nowMs` in `prepare-admission-check.ts` (both mirrors)

- AC: 1, 11
- Files: experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts, plugin/scripts/prepare-admission-check.ts, experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs, plugin/test/prepare-admission-check.test.mjs
- Command: scripts/test.sh plugin/test/prepare-admission-check.test.mjs — implementation: in `main(argv)` (:634) attach `nowMs: now` reusing the already-computed single `const now = Date.now()` (:681) — ZERO new `Date.now()` sites in this file — to the four lease-mode `result` print sites (:721 acquire / :726 renew / :731 release / :741 force-release), via non-clobbering `console.log(JSON.stringify({...result, nowMs: now}))` spread to the two preflight-mode returns (:695 `--preflight`, :705 `--preflight-plan`), and to the three inline error literals (:686 task-file-not-found, :700 planFile-not-found, :711 `missing-session-id`) plus the catch-all (:744 `admission-check-failed`, exit 2) so a failure verdict also self-reports when the subprocess answered; the pure decision functions (`acquireLease` :167, `renewLease` :190 — already `now`-injected) stay untouched, preserving the pure-decision/thin-CLI split and every direct-import unit test. GREEN: re-run this command — expected exit 0; then `bash -c 'node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs && cmp experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts plugin/scripts/prepare-admission-check.ts'` — expected exit 0 (experiments-side GREEN + mirror byte-identity).

Classification: code. Budget: ~12 lines per mirror (~24 total).
Depends on: Stage 1 (fixtures must be red first).
GREEN exit behavior: both test invocations exit 0; `cmp` exits 0.

### Stage 3: RED — workflow-side accumulation + finding-code fixtures

- AC: 1, 7, 8, 10
- Files: plugin/test/prepare-milestone-convergence.test.mjs
- Command: scripts/test.sh plugin/test/prepare-milestone-convergence.test.mjs — RED phase: add fixtures asserting (a) `_renewLease(stageLabel, round)` receives an explicit caller-owned `round` at all 6 call sites (:372 Adjudicate=0, :407 ProposalReview=0, :577 delta=`_deltaRound`, :638 PlanAuthor=0, :719 PlanCheck=`_planCheckRound`, :755 Receipt=0) with a negative assertion that NO regex-parse of the formatted `stageLabel` recovers it (AC7); (b) a new `_recordPhaseBoundary(stageLabel, round, r)` parses each renewal response via the existing `_parseAgentJson` (:32, never naive `JSON.parse`) and pushes `{phase: stageLabel, round, startedAtMs: _lastBoundaryMs, endedAtMs: v.nowMs}` onto a module-level `_phaseTimings` array ONLY under the rule `v.ok === true && Number.isFinite(v.nowMs)` (matching `renewLease`'s real `{ok: true, lease}` success shape — NOT an invented `outcome:"renewed"` literal), then advances `_lastBoundaryMs = v.nowMs` (AC1); (c) `_lastBoundaryMs` is seeded exclusively from the already-parsed `_admissionVerdict.nowMs` (:221) when `outcome === 'acquired'` — never a workflow-local clock read (AC1/AC7); (d) fail-soft: a boundary whose `nowMs` is absent/unparseable (or `ok: false`, e.g. `lease-missing`) pushes nothing and leaves `_lastBoundaryMs` unchanged (AC8); (e) `_findingCodesFor(reason)` returns `[reason, ...(_ledgerLive ? _ledger.map(f => f.id) : [])]` where `let _ledgerLive = false` sits near the module top and flips true immediately after `let _ledger = []` (:444) — a TDZ fixture invokes a pre-ledger exit and asserts a clean `[reason]` result with no `ReferenceError` (the literal `_ledger?.map(...) ?? []` shorthand is TDZ-unsafe and must not appear), and all 7 pre-ledger/pre-lease terminal exits independently produce non-empty `findingCodes[]` (AC10); (f) the existing AC19 guard (:1103-1110, comment-stripped grep of both workflow mirrors for zero LIVE `Date.now()`/`new Date(`/`await import(`/bare `import(`) stays green. Run — expected exit ≠ 0 (helpers do not exist yet).

Classification: code (tests only). Budget: ~190 lines.
Depends on: Stage 2 (workflow consumes the CLI's new `nowMs`).
RED exit behavior: exit ≠ 0 (missing `_recordPhaseBoundary`/`_findingCodesFor`).

### Stage 4: GREEN — workflow accumulation + flag threading (`prepare-milestone.js`, both mirrors)

- AC: 1, 7, 8, 10
- Files: .claude/workflows/prepare-milestone.js, plugin/workflows/prepare-milestone.js, plugin/test/prepare-milestone-convergence.test.mjs
- Command: scripts/test.sh plugin/test/prepare-milestone-convergence.test.mjs — implementation, in BOTH mirrors, with NO new `import` statements (sandbox DSL constraint) and NO new agent dispatches: `_renewLease` (:147) gains the second parameter `round`; all 6 call sites pass it explicitly (:372/:407/:638/:755 pass 0, :577 passes `_deltaRound`, :719 passes `_planCheckRound`) — never regex-parsed from `stageLabel`; new `_recordPhaseBoundary(stageLabel, round, r)` helper parses via `_parseAgentJson` under the `ok === true && Number.isFinite(v.nowMs)` push rule; module-level `_phaseTimings = []` / `_lastBoundaryMs = null` with acquire-seeding from `_admissionVerdict.nowMs`; `let _ledgerLive = false` + `_findingCodesFor(reason)` with the boolean short-circuit; both new flags threaded double-`JSON.stringify` (matching the existing `--detail` idiom at :83) onto the dispatches that already exist — `--phaseTimings <json>` (closed spans + one trailing `{phase, round, startedAtMs, endedAtMs: null}` open entry) and `--findingCodes <json>` onto `_releaseLeaseAndRecord`'s `--record-generation` (command string :181), `_writeGenerationTelemetry`'s `--record-generation --no-release` (:195), and `_recordAttemptAgentCall`'s `--record-attempt` (:83, the 3 pre-lease exits contribute `[site]`); `_releaseLease`'s `--release-only` (:202) gains nothing (writes no telemetry). GREEN: re-run — expected exit 0, including the AC19 guard; then `bash -c 'cmp .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js && plugin/scripts/sync-vendor.sh --check'` — expected exit 0.

Classification: code. Budget: ~85 lines per mirror (~170 total).
Depends on: Stage 3.
GREEN exit behavior: exit 0 (all fixtures + AC19 guard green); `cmp`/`sync-vendor.sh --check` exit 0.

### Stage 5: RED — receiver fixtures (`proposal-convergence.test.mjs`, direct node invocation)

- AC: 3, 5, 6, 9
- Files: experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- Command: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs — RED phase (evidence MUST cite this direct invocation: this file is outside `scripts/test.sh`'s glob, `scripts/test.sh:37`): add fixtures asserting (a) TRAILING CLOSE (CLAIM C5): feeding a `phaseTimings` array whose final entry is `{phase, round, startedAtMs, endedAtMs: null}` → the receiver (`proposal-convergence.ts`, before `buildTelemetryRecord` :392) fills that trailing `endedAtMs` with its own already-computed `recordedAtMs` (:580/:636/:668/:754) — the filled value equals `recordedAtMs` exactly, never a sandbox value (AC9); (b) RECURRENCE: a two-generation fixture for one taskId with a repeated finding code → `recurrenceKey = sha256(`${taskId}::${code}`).slice(0,12)` identical across generations, `firstSeenGeneration` pinned to the earliest matching prior record's own `generationId` while `lastSeenGeneration` advances to the current record's id; a separately-fixtured sub-case for `--record-attempt` records (which carry `generationId: null`) keying `firstSeenGeneration` on `attemptId` via `computeAttemptId` (:384); and a no-prior-records case → `firstSeenGeneration === lastSeenGeneration ===` current id (AC3); (c) SCAN HYGIENE: a corrupted / pre-this-task sibling (no `findingCodes` array) under `milestones/prepare-telemetry/<taskId>/` is skipped individually — mirroring the malformed-skip precedent (`milestone-preparation-check.ts:173`) — without aborting the scan or the current write, and the scan is a LOCAL helper reusing `_safeTaskIdSegment` (:341)/`telemetryPath` (:370, incl. the `_missing-taskId` fallback :371) verbatim (AC5); (d) VALIDATOR: calling `validateTelemetryRecord` (:430) directly with a record missing either `phaseTimings` or `findingCodes` → `{ok:false, code:"telemetry-field-missing"}` (:444) (AC6); (e) RECEIVER FAIL-SOFT (CLAIM C10): a garbage/unparseable AND an oversized `--phaseTimings`/`--findingCodes` flag value fed to the receiver CLI → defaults (`phaseTimings: []`, `findingCodes` computed from `terminal.reason` alone), no throw, and the primary telemetry write still persists — distinct from (d) (a MISSING field vs a MALFORMED flag value). Run — expected exit ≠ 0 (receiver parses neither flag today: greenfield grep for `phaseTimings|findingCodes|recurrenceKey` across all four script/workflow trees returns zero hits at base c82efac).

Classification: code (tests only). Budget: ~210 lines.
Depends on: Stage 4 (the sender-side flag contract is defined first).
RED exit behavior: exit ≠ 0 (receiver behavior absent).

### Stage 6: GREEN — receiver: flag parse, trailing close, recurrence scan, schema widening (`proposal-convergence.ts`, both mirrors)

- AC: 3, 5, 6, 9
- Files: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, plugin/scripts/proposal-convergence.ts, experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs
- Command: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs — implementation, in BOTH mirrors: the receiver CLI tail (`_cliMain` :766 routing `_writeCommittedTelemetry` :653 / `_decideResumeCli` :512 / `_recordAttemptCli` :738) parses the new `--phaseTimings`/`--findingCodes` flags with the same optional-JSON-flag tolerance as every existing flag, degrading fail-soft on malformed/oversized values (defaults, never throw, never block or roll back the primary write — mirrors the existing `telemetryWriteOk`-isolation posture); closes the trailing open span with the writer's own `recordedAtMs` before `buildTelemetryRecord`; a new LOCAL scan helper enumerates prior committed records under `milestones/prepare-telemetry/<taskId>/` reusing `_safeTaskIdSegment`/`telemetryPath` verbatim and skipping malformed/schema-lacking files individually — ZERO new `import` edges (the verified 3-file cycle `prepare-admission-check.ts:45 → milestone-preparation-check.ts:26 → proposal-convergence.ts:27 → prepare-admission-check.ts` is not tightened; no `queryTelemetryReport` import per rejected Alternative #10); `buildTelemetryRecord` (:392) — the single schema-materializer — gains `phaseTimings` and `findingCodes` (an array of `{code, recurrenceKey, firstSeenGeneration, lastSeenGeneration}`) as new parameters, always materialized (`?? []`, never a dropped key, matching the existing `?? null` discipline); `REQUIRED_TOP` (:437) grows by both keys, with a code comment flagging the latent trap (enforcement is write-time only — sole live `validateTelemetryRecord` call :582 — so a future re-validate-all sweep would invalidate every pre-this-task record); `schemaVersion` stays 2 (`TELEMETRY_SCHEMA_VERSION` :360, applied :402 — affirmatively accepted no-bump per the :356-357 family-supersession precedent, Alternative #9); `--decide-resume`'s OUTPUT gains no `nowMs` (not a phase boundary; Alternative #5). GREEN: re-run — expected exit 0; then `bash -c 'cmp experiments/quay-perpetual-stream/scripts/proposal-convergence.ts plugin/scripts/proposal-convergence.ts && plugin/scripts/sync-vendor.sh --check'` — expected exit 0.

Classification: code. Budget: ~125 lines per mirror (~250 total).
Depends on: Stage 5.
GREEN exit behavior: exit 0 (all receiver fixtures green); `cmp`/`sync-vendor.sh --check` exit 0.

### Stage 7: Lockstep verification battery (mechanical checks, zero new code)

- AC: 1, 4, 5, 6, 7
- Files: experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts, plugin/scripts/prepare-admission-check.ts, experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, plugin/scripts/proposal-convergence.ts, experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs, plugin/test/prepare-admission-check.test.mjs, experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs, .claude/workflows/prepare-milestone.js, plugin/workflows/prepare-milestone.js, plugin/test/prepare-milestone-convergence.test.mjs
- Command: bash -c 'scripts/test.sh && node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs && cmp experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts plugin/scripts/prepare-admission-check.ts && cmp experiments/quay-perpetual-stream/scripts/proposal-convergence.ts plugin/scripts/proposal-convergence.ts && cmp .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js && plugin/scripts/sync-vendor.sh --check && ! grep -nE "^\s*import .*milestone-preparation-check" experiments/quay-perpetual-stream/scripts/proposal-convergence.ts plugin/scripts/proposal-convergence.ts && test "$(grep -c "validateTelemetryRecord(" experiments/quay-perpetual-stream/scripts/proposal-convergence.ts)" = 2' — expected exit 0, where the chain mechanically asserts: (a) the full safe-by-default suite is green (`scripts/test.sh` covers both `plugin/test/` files incl. the AC19 guard; AC1), (b) both experiments-side test files pass via the direct invocation their glob-exclusion requires, (c) all three edited mirror pairs are byte-identical (`cmp` × 3 + `sync-vendor.sh --check`; AC4), (d) AC5 import-graph: the negated grep proves zero new `import` edges from `proposal-convergence.ts` to `milestone-preparation-check.ts` (exit 0 iff no match), (e) AC6 negative enforcement (CLAIM C9): `validateTelemetryRecord(` occurs exactly twice (one definition :430 + the ONE live call :582) — no disk-read/historical re-validation anywhere, so widening `REQUIRED_TOP` is forward-only-safe, verified by count not prose; (f) AC7: companion grep that neither workflow mirror contains a `stageLabel`-regex-parse (e.g. `! grep -nE "stageLabel\.match|/round-" .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js`) appended to the chain, exit 0.

Classification: prose + mechanical checks (0 new lines). Budget: 0.
Depends on: Stage 6.
Exit behavior: whole chain exits 0; any non-zero leg names the failing gate.

### Stage 8: Grounding evidence re-read (prose, recorded in the landing commit)

- AC: 11, 12
- Files: .claude/workflows/prepare-milestone.js, plugin/workflows/prepare-milestone.js, experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts, experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- Command: git diff c82efac --stat -- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts plugin/scripts/prepare-admission-check.ts experiments/quay-perpetual-stream/scripts/proposal-convergence.ts plugin/scripts/proposal-convergence.ts experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs plugin/test/prepare-admission-check.test.mjs experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs .claude/workflows/prepare-milestone.js plugin/workflows/prepare-milestone.js plugin/test/prepare-milestone-convergence.test.mjs — expected: stat lists exactly the ten Touches entries and nothing else, exit 0. Then a direct source re-read re-confirms the exhaustive identifier list AC12 demands at the landing revision, recording the anchor table verified at base c82efac for this Plan: `main(argv)` :634 and single `const now = Date.now()` :681 in `prepare-admission-check.ts` (the Proposal's :601/:648 were the correct `@2d67a92` values, superseded by `c82efac`'s +33-line insert of `_splitTopLevelCommas`/`_stripWrappingBacktick` at :465), CLI print sites :686/:695/:700/:705/:711/:721/:726/:731/:741/:744, `--release-only` string :202, the six renewal sites :372/:407/:577/:638/:719/:755, `let _ledger = []` :444, dispatch strings :83/:181/:195, `_decideResumeCli` :512 / `_recordAttemptCli` :738 / `_cliMain` :766, the sole live `validateTelemetryRecord` call :582, `REQUIRED_TOP` :437, `buildTelemetryRecord` :392, `recordedAtMs: Date.now()` :580/:636/:668/:754, malformed-skip precedent `milestone-preparation-check.ts:173`, `plugin/scripts/sync-vendor.sh` as the real sync path — every one an already-landed name (or a design-decision identifier introduced by the Proposal: `_recordPhaseBoundary`, `_phaseTimings`, `_lastBoundaryMs`, `_findingCodesFor`, `_ledgerLive`, `--phaseTimings`, `--findingCodes`, `recurrenceKey`, `firstSeenGeneration`, `lastSeenGeneration`), not a new invention.

Classification: prose (0 code lines). Budget: 0.
Depends on: Stage 7.
Exit behavior: `git diff --stat` exits 0 with exactly the touch set; grounding table committed as landing-commit evidence.

### Stage 9: Real-landing verification (real dispatch, non-fixture evidence — DoD)

- AC: 2, 3, 12
- Files: experiments/quay-perpetual-stream/scripts/proposal-convergence.ts, plugin/scripts/proposal-convergence.ts, .claude/workflows/prepare-milestone.js, plugin/workflows/prepare-milestone.js
- Command: bash -c 'jq -e "(.phaseTimings | length > 0) and (.findingCodes | length > 0)" milestones/prepare-telemetry/gap-dir126d-deferred-phase-timing-recurrence-tracking/<recordId>.json' — expected exit 0 AFTER a real post-landing `prepare-milestone` dispatch for this very taskId that traverses a `ProposalReview` delta round and a `PlanCheck` round (at authoring time this task's own archive holds FOUR prior records — `dd06ce1ed5b8.json`, `86de375b56db.json`, `ffc333d19352.json`, and `ca5bb88535f7.json` (the last a post-authoring split-recommended/ProposalReview needs-human terminal, 19 keys), THREE of which — `dd06ce1ed5b8`, `ffc333d19352`, `ca5bb88535f7` — carry the genuinely-recurred code `split-recommended`, so the first post-landing generation exercises the recurrence scanner against real prior history; the exact count/enumeration MUST be re-read at landing time via `ls milestones/prepare-telemetry/gap-dir126d-deferred-phase-timing-recurrence-tracking/ && jq -r .recordId *.json`, since the archive accrues a record per Plan-check round that lands and the enumeration above is authoring-time-stale by design). The evidence brief (committed prose) additionally asserts: (a) AC2's equality on the renewal-bounded metric — admission-touching dispatch count from the journal (the single `--acquire` + the 6 `_renewLease` classes + the terminal close, NOT the raw 11-live/16-`grep -c` `phase()` count) equals the record's `phaseTimings` entry count (closed spans + 1 receiver-closed trailing entry); (b) AC3 on real data — the recurred code's `firstSeenGeneration` names the earliest prior record's id while `lastSeenGeneration` names the new record's id; (c) the charter Done-when independent audit — both additive fields are production-wired (not `--selftest`-only) and existing consumers of the CLI JSON (`_parseAgentJson` callers) and of the record schema (`queryTelemetryReport`'s malformed-skip walk, `checkPreparation`'s named-file hash binding) are unaffected: no shape became stricter for old records, no existing field renamed/removed.

Classification: prose (evidence; 0 new code lines). Budget: 0.
Depends on: Stage 8 AND the human-steered landing commit on `master`.
Exit behavior: `jq -e` exits 0 on the committed record; the audit brief records pass/fail per sub-assertion.

## 3. Guardrails

- **AC19 sandbox-clock regression guard (two real production crashes already paid for: `f6db2a8`, `7357a91`).** Zero new LIVE (non-comment) `Date.now()` / `new Date(` / `await import(` / bare `import(` sites in either `prepare-milestone.js` mirror — enforced by the existing comment-stripped grep fixture at `plugin/test/prepare-milestone-convergence.test.mjs:1103-1110`, re-verified green at Stages 4/7. The trailing span is closed RECEIVER-side with `recordedAtMs` precisely so the sandbox never computes a timestamp; `acquireLease`'s own `missing-now` contract (:174-175) forbids workflow-side clocks in the code's own words.
- **Mirror parity after every edit:** `cmp` across all three edited pairs, with `plugin/scripts/sync-vendor.sh --check` (verified real path) additionally covering the two `plugin/scripts/` pairs its SYNC_SCRIPTS list holds (`proposal-convergence`, `prepare-admission-check`); the `.claude/workflows/prepare-milestone.js` ↔ `plugin/workflows/prepare-milestone.js` pair is `cmp`-only — it is NOT in `sync-vendor.sh`'s scope, so its parity rides the explicit `cmp` at Stages 4 and 7. Byte-identical pre-task, must remain; checked per code stage and wholesale at Stage 7 (AC4).
- **TDZ correctness:** `_findingCodesFor` uses the `_ledgerLive` boolean short-circuit — never `_ledger?.map(...)`; optional chaining does NOT bypass the temporal dead zone at the four pre-ledger exits (:313/:323/:366/:390), where any reference to the uninitialized `let _ledger` (:444) throws `ReferenceError`. A dedicated pre-ledger-exit TDZ fixture guards this (Stage 3e).
- **Fail-soft, never gate:** missing/unparseable `nowMs` or `ok: false` at any renewal pushes nothing (fail-soft; the next successful boundary yields a wider, correctly-bounded span); malformed/oversized `--phaseTimings`/`--findingCodes` flag values default (`phaseTimings: []` / `findingCodes` from `terminal.reason` alone), never throw, and never block or roll back the primary telemetry write (CLAIM C10's dedicated fixture, Stage 5e — the `highRisk` shared-surface blast-radius guard the Risks section demands beyond general Defaults coverage). Telemetry stays additive: it never blocks the real gate, and any throw inside the new logic is caught by the existing enclosing try/catch surfacing as `telemetryWriteOk: false`, never preventing a lease release that already happened.
- **No new dispatches, no tightened cycle:** every flag rides a dispatch that already exists (:83/:181/:195); `--release-only` (:202) stays unchanged; the recurrence scan is a local helper — zero new `import` edges onto the verified 3-file import cycle (Stage 7d grep).
- **Push-rule precision:** a boundary is recorded iff `v.ok === true && Number.isFinite(v.nowMs)` — not `nowMs`-presence alone (error verdicts also carry `nowMs` by design) and not an invented `outcome:"renewed"` literal (renewal success is `ok: true`, verified :193/:196). `round` is data the caller already owns (`_deltaRound` :577, `_planCheckRound` :719) — a formatted label is presentation, never a structured-data source (AC7).
- **`schemaVersion` stays 2** (affirmatively accepted, not passed by default): additive in-family growth; bumps are reserved for family supersession (:356-357 precedent); nothing re-validates history, so no forward-compat hazard forces a bump.
- **Wiring claims C1-C10** in the task's Proposal each map to a falsifiable AC bullet and thus to a stage above (C1/C10→S1/S2/S5, C2→S3/S4, C3/C4→S3/S4, C5→S5/S6/S9, C6→S3/S4, C7→S5/S6/S7, C8→S5/S6, C9→S6/S7).

## 4. Rollback

- Purely-additive JSON fields — no key renamed/removed, no existing dispatch reshaped. Rollback = `git revert` of the landing commit.
- Post-revert safety both directions: records written WITH the two keys remain readable by reverted code (the validator checks presence of `REQUIRED_TOP` keys, never absence of extras; and validation is write-time-only at the sole live call :582 — nothing re-validates committed history); records written after revert simply lack the keys, exactly the pre-this-task state (the archive already holds such records).
- `queryTelemetryReport` only `JSON.parse`s with malformed-skip (:173) and `checkPreparation` hash-binds a named file — neither field-validates old records, so both are unaffected under revert or under the additive extension.
- `_releaseLease`/`--release-only` (:202) is untouched, so lease release — the safety-critical path — is identical under any failure mode (DIR-126-D's lease-release-independent-of-telemetry guarantee, unchanged).

## 5. Real-landing verification (DoD)

- Landed on `master` under human-steered discipline (DIR-027: root-level `.halt` or private worktree; never race the loop; single `execute-milestone` dispatch at a time — the shared-working-tree constraint, not task-level file overlap, is the hazard).
- Real, non-fixture evidence per Stage 9: a real `prepare-milestone` dispatch's committed record inspected post-hoc for non-`[]` `phaseTimings`/`findingCodes`, with the journal-vs-record dispatch-count equality (AC2) and the recurrence quad verified against this task's own archived prior records (four at authoring time, incl. three carrying `split-recommended`; the per-record `jq -e` assertions are count-independent, but the enumeration MUST be re-read at landing time since the archive accrues a record per Plan-check round) — the live-dispatch AC is explicitly NOT downgradable to a mocked-agent check (Risks).
- Fresh independent audit confirms both additive fields are production-wired and existing consumers unaffected (charter Done-when).

## 6. Stopping rule (standardized)

At most **3 Plan-check rounds**; success **only at F_i=0** — the live preflight-plan verdict
(`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
--preflight-plan --taskId gap-dir126d-deferred-phase-timing-recurrence-tracking --workspace .
--planFile docs/plans/M207-gap-dir126d-deferred-phase-timing-recurrence-tracking.md`) returns
`ok:true` with zero findings (matching `prepare-milestone.js`'s own PlanCheck loop, :717-737:
"F_i=0" PASSED). If findings remain after round 3, escalate to human (`needs-human`) rather than
waiving findings in prose.
