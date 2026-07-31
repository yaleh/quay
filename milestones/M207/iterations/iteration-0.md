# M207 iteration-0 — BUILD: gap-dir126d-deferred-phase-timing-recurrence-tracking

**Milestone:** M207 · **Task:** gap-dir126d-deferred-phase-timing-recurrence-tracking
**Charter:** experiments/quay-perpetual-stream/charters/M207-gap-dir126d-deferred-enrichment.md
**Plan:** docs/plans/M207-gap-dir126d-deferred-phase-timing-recurrence-tracking.md (9 stages)
**Base revision:** 386bec0 · **Discipline:** human-steered, direct-to-master
**Outcome:** done (all fixture-verifiable AC/claims green; Stage 9 real-landing evidence deferred to Land by Plan design)

## What was implemented

Two purely-additive extensions to DIR-126-D's landed telemetry pipeline (`mechanismCount = 2`,
charter is the scope authority), reshaping nothing DIR-126-D landed — no key renamed/removed,
`schemaVersion` held at 2, no new dispatch, no new `import` edge, zero new sandbox clock reads.

### Mechanism 1 — per-phase-boundary timing

1. **`prepare-admission-check.ts` (both mirrors):** `main()` stamps ONE additive `nowMs: now`
   field — reusing the already-computed single `const now = Date.now()` (ZERO new `Date.now()`
   sites) — on every JSON verdict it prints: the four lease-mode `result` objects via
   non-clobbering `{...result, nowMs: now}` spread, the two preflight-mode returned
   `runPreflightChecks` objects via the same spread (existing `{ok, policyVersion, findings}`
   keys survive unchanged), the three inline error literals (task-file-not-found,
   planFile-not-found, missing-session-id), and the catch-all `admission-check-failed` shape.
   Pure decision functions untouched.
2. **`prepare-milestone.js` (both mirrors):** `_renewLease(stageLabel, round)` gains a
   caller-owned `round` parameter; new `_recordPhaseBoundary(stageLabel, round, r)` parses each
   renewal response via the existing `_parseAgentJson` (never naive JSON.parse) and pushes
   `{phase, round, startedAtMs: _lastBoundaryMs, endedAtMs: v.nowMs}` onto module-level
   `_phaseTimings` ONLY under the rule `v.ok === true && Number.isFinite(v.nowMs)` (fail-soft:
   failed/noisy/nowMs-less renewals push nothing, `_lastBoundaryMs` unchanged). All 6 call sites
   pass `round` explicitly (0 / `_deltaRound` / `_planCheckRound` — never regex-parsed from the
   label). `_lastBoundaryMs` seeded exclusively from the parsed `--acquire` verdict's `nowMs`
   when `outcome === 'acquired'`. `_phaseTimingsForTerminal(stageLabel)` builds the
   `--phaseTimings` payload: closed spans + one trailing `{phase, round: 0, startedAtMs,
   endedAtMs: null}` open entry — closed RECEIVER-side, never in the sandbox (AC19-safe).
3. **Flag threading:** `--phaseTimings <json>` (double-`JSON.stringify`, the existing `--detail`
   idiom) threaded onto `_releaseLeaseAndRecord`'s `--record-generation`,
   `_writeGenerationTelemetry`'s `--record-generation --no-release`, and
   `_recordAttemptAgentCall`'s `--record-attempt` (`[]` by construction at the 3 pre-lease
   sites). `_releaseLease`'s `--release-only` gains nothing (writes no telemetry). No new dispatch.

### Mechanism 2 — `findingCodes[]` recurrence tracking

1. **Sender:** TDZ-safe `_findingCodesFor(reason)` returns `[reason, ...(_ledgerLive ?
   _ledger.map(f => f.id) : [])]` — `let _ledgerLive = false` declared at module top, flipped
   true immediately after `let _ledger = []`; the boolean short-circuit is essential (optional
   chaining does NOT bypass the temporal dead zone at the four pre-ledger exits). `--findingCodes
   <json>` threaded alongside `--phaseTimings` on the same dispatches.
2. **Receiver (`proposal-convergence.ts`, both mirrors):** `_computeFindingCodes` maps each code
   to `recurrenceKey = sha256(\`${taskId}::${code}\`).slice(0,12)`; `firstSeenGeneration` = the
   earliest matching prior record's own `generationId` (or `attemptId` for `--record-attempt`
   records, `attemptOnly` scan), or the current record's own id when no prior match;
   `lastSeenGeneration` always the current id. `_scanPriorTelemetryRecords` is a LOCAL helper —
   `_telemetryDir` reuses `telemetryPath` verbatim (probe-record dirname, incl. `_missing-taskId`
   fallback + `_unsafe-taskid` redirect); malformed/schema-lacking siblings skipped individually
   (`milestone-preparation-check.ts:172-173` precedent); ZERO new `import` edges (no
   `queryTelemetryReport` import — rejected Alternative #10).
3. **Schema:** `buildTelemetryRecord` (the single schema-materializer) gains
   `phaseTimings`/`findingCodes`, always materialized (`?? []`); `REQUIRED_TOP` grows by both
   keys with a latent-trap code comment (enforcement is write-time only — sole live
   `validateTelemetryRecord` call is the reuse-terminal branch; nothing re-validates history).
   The reuse-terminal write carries `phaseTimings: []` + codes from the reused terminal's reason
   (load-bearing: it passes through the sole live validator call against the widened
   `REQUIRED_TOP`). `--record-attempt` keys recurrence on `attemptId`, scanning only sibling
   attempt records (`generationId: null`).
4. **Trailing close + fail-soft (CLAIM C5/C10):** writers close any `endedAtMs: null` span with
   their OWN `recordedAtMs`; `_parsePhaseTimingsFlag`/`_parseFindingCodesFlag` degrade fail-soft
   on malformed OR oversized (>64KiB — below the kernel's ~128KiB per-argument execve ceiling, so
   oversized values genuinely reach the CLI) flag values: defaults (`phaseTimings: []`,
   `findingCodes` from `terminal.reason` alone), never throw, never block the primary write.

## Verification evidence (Stages 1-8)

- **`plugin/test/prepare-admission-check.test.mjs` (scripts/test.sh-covered):** 74 pass / 0 fail
  (was 63; +11 M207 nowMs fixtures — all six modes × success+error paths, preflight key-preservation
  exact-key-set sub-assertion, catch-all path).
- **`experiments/.../test/prepare-admission-check.test.mjs` (direct `node
  --experimental-strip-types --test` — outside scripts/test.sh's glob, scripts/test.sh:37):**
  74 pass / 0 fail; byte-identical mirror of the plugin twin (`cmp`).
- **`plugin/test/prepare-milestone-convergence.test.mjs` (scripts/test.sh-covered):** 68 pass /
  0 fail (was 54 with 2 PRE-EXISTING R9 failures — fixed by closing the stale open-ended
  `480cb58..HEAD` pin to the historical `480cb58..68eb5eb^` range the claim actually covers;
  DIR-126-D's 68eb5eb and M205's c82efac legitimately touched the file afterward, so an
  open-ended pin can never be green again). +14 M207 fixtures (per mirror ×2): multi-round
  journal AC2 renewal-bounded equality (delta + PlanCheck rounds; spans == renewals+1; round
  threaded from `_deltaRound`/`_planCheckRound`; acquire-seed; contiguity; trailing
  `endedAtMs:null`), fail-soft nowMs-less and ok:false renewals, pre-ledger TDZ fixture
  (`['preflight-check-failed']`, no ReferenceError), all 3 pre-lease `--record-attempt` sites,
  AC7 source-grep (6 sites, caller-owned rounds, zero stageLabel parsing), CLAIM C5 sender-half
  flag-placement checks. AC19 guard (zero live `Date.now()`/`new Date(`/`import(`) re-verified green.
- **`experiments/.../test/proposal-convergence.test.mjs` (direct invocation — glob-excluded):**
  97 pass / 0 fail (was 88; +9 M207 fixtures): buildTelemetryRecord always-materialize +
  schemaVersion-2, AC6 validator fail-closed for BOTH missing keys, AC9 trailing close
  (`endedAtMs === recordedAtMs` exactly, real CLI), AC3 two-generation recurrence (key stable,
  firstSeen PINNED, lastSeen ADVANCES) + attemptId-keyed sub-case, AC5 scan hygiene
  (corrupt/pre-M207 siblings skipped; local-helper/import-graph source asserts), CLAIM C10
  garbage+oversized fail-soft (defaults, no throw, primary write persists), reuse-terminal
  carries both keys through the sole live validator call + real prior-history recurrence, AC6/C9
  mechanical `validateTelemetryRecord(` count == 2.
- **Stage 7 battery (mechanical):** all three edited mirror pairs byte-identical (`cmp` × 3 +
  `plugin/scripts/sync-vendor.sh --check`); zero new `import` edges to
  milestone-preparation-check.ts (negated grep); `validateTelemetryRecord(` count == 2;
  zero `stageLabel` regex-parsing in both workflow mirrors.
- **Full `scripts/test.sh`:** 721 tests — green (see below for one disclosed incidental repair),
  3 skipped (the live-GitHub opt-in trio).
- **Incidental out-of-Touches repair (disclosed, minimal):** the initial battery runs failed
  exactly ONE test — `packages/quay/test/build-dist-smoke.test.mjs (b) serve --port + HTTP GET
  returns 200`, in a product package this milestone does NOT otherwise touch. Root cause proven
  by direct measurement, not assumed: under full-suite `--test-concurrency=8` load the spawned
  standalone-bundle server genuinely needs ~6s to bind (measured 6.08s PASS / 6.68s FAIL on the
  same machine under the same load), and the test's hardcoded 40 × 150ms = 6s polling window sat
  exactly at that boundary — a coin-flip any test-suite growth tips into deterministic failure.
  Evidence it is load, not behavior: passes 4/4 in isolation, 146/146 when run concurrently with
  this milestone's own spawn-heavy test files, and under low-concurrency full discovery; the
  milestone diff touches zero `packages/quay` source (the bundle is built solely from
  `packages/quay` sources). Repair = widen the poll to 100 × 150ms (~15s), matching sibling test
  (c)'s existing 15s envelope; NO assertion changed, a genuinely broken serve still fails. This
  is the repo's own fix-the-SOURCE principle (exp5-crystallization-strategy): the fragility is in
  the test's timing contract, and leaving it would make every future `scripts/test.sh` (incl. CI)
  intermittently red on this machine regardless of this milestone's content.
- **Stage 8 grounding:** `git diff --stat` lists EXACTLY the ten Touches entries (1353
  insertions / 68 deletions, mirrors counted once each) and nothing else.

## Claims → evidence map

C1 (nowMs all modes, both paths, keys preserved) → admission fixtures ×2 mirrors · C2 (round
explicit at 6 sites) → workflow source-grep fixture + multi-round journal · C3 (parse+push rule)
→ `_recordPhaseBoundary` body assert + fail-soft fixtures · C4 (seed exclusively from parsed
nowMs) → journal `spans[0].startedAtMs === 500` · C5 (receiver-side trailing close) → AC9
`endedAtMs === recordedAtMs` real-CLI fixture + sender-half `endedAtMs:null` source assert · C6
(flag threading; 7 pre-ledger/pre-lease sites non-empty) → TDZ fixture + 3 pre-lease fixtures ·
C7 (local scan; zero new import edges) → scan-hygiene fixture + Stage 7 negated grep · C8
(REQUIRED_TOP fails closed) → direct validator fixture ×2 keys · C9 (write-time-only enforcement)
→ `validateTelemetryRecord(` count == 2 mechanical check + reuse-terminal fixture passing the
validator · C10 (malformed/oversized fail-soft) → dedicated garbage+oversized real-CLI fixture.

## Deferred to Land (by Plan design)

- **Stage 9 (DoD, real non-fixture evidence):** a real post-landing `prepare-milestone` dispatch
  for this very taskId, its committed record inspected for non-`[]` `phaseTimings`/`findingCodes`
  and the journal-vs-record dispatch-count equality (AC2) — explicitly NOT downgradable to a
  mocked-agent check. This task's own archive holds prior records carrying the genuinely-recurred
  code `split-recommended`, so the first post-landing generation exercises the recurrence scanner
  against real prior history. Stage 9 depends on the human-steered landing commit and is the
  Audit/Land phase's responsibility, not this Build iteration's.
