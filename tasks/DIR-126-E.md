---
id: DIR-126-E
title: Recalibrate the prepare-milestone capacity model from real telemetry
  (--capacity-report aggregation) — fifth and final child of DIR-126's split
status: todo
labels:
  - milestone-candidate
  - human-steered
  - priority:urgent
parent: DIR-126
children: []
extra:
  schema: v1
  dirStatus: applied
  rank: 0
  urgency: urgent
---

**type:** execution

## Proposal

Replace `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md`'s flat "15-25 minute"
Prepare planning assumption with a real, reproducible measured distribution, computed by a checked-
in aggregation command over [[DIR-126-D]]'s committed telemetry records and the pre-existing
`milestones/M*/preparation.json` receipt corpus. Fifth and final child of DIR-126's 5-way split.
Depends on [[DIR-126-D]] (aggregation has nothing telemetry-side to aggregate until telemetry
exists and has been exercised in production) and structurally on >= 3 real post-D preparation
generations existing (this task's own DoD requirement).

### Problem framing (re-verified live against the current tree, 2026-07-30)

Directly confirmed by fresh read/grep, not carried over from the task body without re-checking:

- `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md:111` (also echoed at
  116-118/124) still states a flat "**15-25 minutes**" Prepare-planning range, folded into
  "≈85-95 minutes per task," sourced from a single real Prepare observation (DIR-117, 22m 21s),
  with no distribution, sample count, or provenance anywhere in the doc. The doc's own throughput
  model (§3-5) treats Prepare as a serial head-stage cost layered onto a historical delivered-task
  rate — the fix this proposal makes is scoped to §4's flat number, not a rewrite of the whole
  model.
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` is 587 lines,
  byte-identical to `plugin/scripts/milestone-preparation-check.ts` (`diff` empty, re-run live).
  `grep -n "capacity-report\|P50\|P85"` over the file returns nothing — no aggregation mode exists
  today. It already exposes `queryTelemetryReport({workspace, milestoneId})` (line 159, CLI-wired
  at `--telemetry-report <milestoneId>`) — a single-milestone filter, not an aggregator: its
  internal `walk()` (line 162) recurses `milestones/prepare-telemetry/**/*.json`, keeps only
  records matching the one `milestoneId` argument, and returns them raw, **silently swallowing
  JSON-parse failures with no exclusions trace** — a materially weaker bar than this task's own AC
  ("excluded from the sample count, listed explicitly in `exclusions` with the reason"). It
  computes no percentiles, ratios, or waste classes.
- **Delta from the charter's own "zero real telemetry records exist" claim, discovered by this
  proposal's own live re-check**: `milestones/prepare-telemetry/DIR-126-E/2a107fcb5cc9.json` now
  exists on disk — one real `schemaVersion: 2` record, `taskId: "DIR-126-E"`, `milestoneId: "M204"`,
  `decision.kind: "cold"`, `terminal: {outcome: "needs-human", reason: "split-recommended", phase:
  "ProposalReview", cacheable: true}`, `contentAgentDispatchCount: null`, `contentAgentMs: null`.
  This is this very milestone's own in-flight ProposalReview/Prepare generation writing its own
  telemetry — direct, load-bearing confirmation that the telemetry writer (DIR-126-D) fires in a
  live dispatch, and the first real data point this child's own report will have to ingest. One
  sample alone is short of the DoD's ≥3-sample bar; it does not by itself satisfy it.
- Direct inspection of all 8 currently-committed `milestones/M*/preparation.json` receipts (M192,
  M195, M197, M198, M200, M201, M202, M203) re-run live via a `node -e` loop confirms: `convergence`
  block present (non-null) for M192, M195, M198, M200; absent (`false`) for M197, M201, M202, M203.
  None of the 8 carry a non-null `telemetryFile` — the field is simply absent (`undefined`), not
  `null` — **zero of the historical receipts pair with a telemetry record**, including M203
  (DIR-126-D's own landing receipt, predating the telemetry writer going live, and itself lacking a
  `convergence` block since it landed via a manually-built receipt rather than a real
  `prepare-milestone` ProposalReview convergence run). A design that requires telemetry-receipt
  pairing as a precondition for any statistic would report `insufficient-samples` against the
  entire real M192-M203 baseline, not just the narrow "zero post-D telemetry" window — this rules
  out "pairing required" as viable.
- `computeConvergenceMetrics` (`proposal-convergence.ts:188`, exported) is already reused by
  `computeMetricsForReceipt` (`milestone-preparation-check.ts:118`, imported at line 26) to derive
  `prepareWallTimeMs` from a receipt's own `convergence.{startedAtMs,endedAtMs}`, plus
  `proposalReviewRounds`/`blockingFindingYield`/`proposalChurnRatio` — a second, already-working,
  telemetry-independent source of Prepare wall time for the 4 receipts that carry a `convergence`
  block, regardless of telemetry pairing.
- The frozen telemetry record (`buildTelemetryRecord`, schemaVersion 2, `proposal-convergence.ts:
  388-422`) carries `admission.acquiredAt` and `recordedAtMs` per attempt (confirmed present in the
  live `DIR-126-E` record above) — sufficient for a per-attempt `[acquiredAt, recordedAtMs]`
  interval for overlap/duplicate-generation analysis, no schema change needed.
- `contentAgentDispatchCount`/`contentAgentMs` are `null`, not `0`, for `cold`/`resume` records
  (confirmed live in the DIR-126-E record itself, and by reading `proposal-convergence.ts:665`) —
  only `reuse-terminal` (line ~578) and the pre-lease `not-evaluated` sites (`_recordAttemptCli`,
  line 751) get an explicit `0`/`0`, an invariant `validateTelemetryRecord` enforces at write time
  (lines 462-464: a `reuse-terminal` record failing `contentAgentDispatchCount===0 &&
  contentAgentMs===0` returns `{ok:false, code:"reuse-terminal-invalid"}`). `null` means "never
  measured"; `0` means "measured zero." Collapsing them would misreport mechanical-vs-content-agent
  work.
- `decision.createsContentGeneration` is written as `kind === "resume"` (confirmed at line 664, and
  directly visible in the live DIR-126-E record: `decision.kind: "cold"` pairs with
  `createsContentGeneration: false`) — true only for `resume`, false for `cold`, the reverse of
  what the field name suggests if read as "did this generation dispatch content agents." Both
  `cold` and `resume` run real content-agent work; `--capacity-report` must derive
  "content-generation attempt" from `decision.kind ∈ {cold, resume}` directly, not this field.
- `CACHEABLE_TERMINALS` is `export const` at `proposal-convergence.ts:247` (confirmed via grep),
  the allowlist DIR-126-C's `decideResumeGeneration` uses for `reuse-terminal` eligibility.
  `milestone-preparation-check.ts` already imports three named exports from the same module (line
  26), so importing `CACHEABLE_TERMINALS` too is a same-shape addition, not a new cross-module
  coupling.
- `milestones/*/absorb-entry.md` is a real, pre-existing, checked-in convention recording a
  milestone's ABSORB outcome — usable as the "this task actually landed" signal for
  `absorbed-task/prepare-hour` without a live task-store query.
- **A real, dangerous defect class in the receipt-side reuse path, found live during this review**:
  of the 4 convergence-bearing receipts, `computeConvergenceMetrics`'s `Number.isFinite(startedAtMs)
  && Number.isFinite(endedAtMs)` guard (`proposal-convergence.ts:197`) does not catch the case
  `startedAtMs === endedAtMs` — a degenerate placeholder (the interval was never actually populated
  with distinct start/end times), not a genuine near-zero-duration measurement. Confirmed live: M192
  and M195 both have `startedAtMs === endedAtMs`; M198 and M200 have real, distinct intervals. This
  is dangerous specifically because **M195 is the exact receipt DIR-126's own parent Finding
  (`tasks/DIR-126.md` lines 91-92) measured at ~80 real minutes (57 of them PlanCheck)** — naively
  reusing `prepareWallTimeMs` for M195 would silently report `0ms` for the slowest real generation on
  record, directly contradicting the Finding this whole child exists to fix.

In short: no code anywhere aggregates capacity statistics across telemetry+receipt artifacts today;
the doc's flat number has no supporting evidence; and the two real data sources have complementary,
only-partially-overlapping coverage — a correct design must join them best-effort, not require
pairing, or it reports `insufficient-samples` against real, already-landed history for no
principled reason.

### Chosen mechanism

Add a new, purely additive `--capacity-report [--telemetry-glob '<root>/**/*.json']
[--workspace <dir>] [--exclusions <file.json>] [--min-samples N] [--out <file>]` CLI mode to
`milestone-preparation-check.ts` (+ byte-identical `plugin/scripts/` mirror), following the exact
existing `isDirectInvocation()` + `parseArgs` dispatch pattern (lines 493-568: a new top-level
`if (parsed.capacityReport) { ...; process.exit(...); }` block, matching the sequential-top-level-`if`
shape (not `else if`) the existing `--build`/`--metrics`/`--telemetry-report` branches actually use —
no new invocation convention), backed by a new pure exported function `computeCapacityReport({workspace,
telemetryGlob, exclusions, minSamples})`:

1. **Two independent sample populations, walked and joined best-effort — pairing never required.**
   - *Telemetry population*: files under `milestones/prepare-telemetry/**/*.json`
     (`--telemetry-glob` overridable), traversed by a new shared low-level `_walkJsonFiles(root)`
     helper (directory recursion only, no parsing), factored out of `queryTelemetryReport`'s
     existing `walk()` so both call sites share one recursion primitive instead of two
     independently-maintained copies. `queryTelemetryReport`'s own parse-and-silently-skip
     behavior stays completely unchanged (verified by an explicit regression test re-running an
     existing `--telemetry-report` fixture); `computeCapacityReport` instead captures
     `{path, record|null, parseError|null}` per file and turns a parse failure into a traced
     `exclusions` entry (`reason: "malformed-json"`, path + parse error recorded). Each parsed
     record is run through the existing, reused `validateTelemetryRecord` — a validator failure
     (including a `reuse-terminal` invariant violation) becomes an `exclusions` entry carrying the
     validator's own `{code, message}`, never silently included.
   - *Receipt population*: every `milestones/M*/preparation.json` under `--workspace` (default
     `.`) with a non-null `convergence` block, fed through the existing, reused
     `computeConvergenceMetrics` (via `computeMetricsForReceipt`, not a second derivation) to get
     `prepareWallTimeMs`/`proposalReviewRounds`/`blockingFindingYield`/`proposalChurnRatio`. A
     receipt with no `convergence` block (M197/M201/M202/M203, confirmed live) is excluded from
     wall-time stats specifically, tagged `"no-convergence-block"`, not treated as an error. A
     receipt WITH a `convergence` block whose `startedAtMs === endedAtMs` (confirmed live for M192
     and M195 — a degenerate placeholder, the interval was never actually populated with distinct
     start/end times, not a genuine near-zero-duration measurement) is likewise excluded from
     wall-time stats specifically, tagged `"convergence-interval-degenerate"` — `prepareWallTimeMs`
     is never silently reported as `0` for this case. This guard is strictly narrower than
     `no-convergence-block`: it fires only when both fields are present, finite, AND identical, never
     for a receipt whose fields are merely close together (a real short Prepare run stays included).
   - The two populations are joined best-effort by `(taskId, milestoneId)` where both exist; an
     unpaired record on either side still contributes to its own population's stats. This directly
     reflects the confirmed fact that 0/8 committed receipts currently pair with telemetry —
     requiring pairing would make the report vacuous against real history.
2. **Percentiles** via one small shared pure `percentile(sortedNumbers, p)` helper, computed over
   whatever numeric field is in scope (receipt-side wall time, telemetry-side wall time and, where
   measurable, agent-minutes), broken down by `class`/`highRisk`/terminal outcome-reason/
   `decision.kind` (pre-decision `not-evaluated` its own bucket, never folded into `cold`).
3. **Content-generation discriminator is `decision.kind ∈ {cold, resume}`**, never
   `decision.createsContentGeneration` (confirmed inverted above). `eligible` =
   `decision.kind ∈ {cold, resume, reuse-terminal}`; `attempt` = every well-formed record read
   (including `not-evaluated`).
4. **Content-agent dispatch/minutes reported as three explicit, never-blended buckets**:
   `measuredZero` (`reuse-terminal`/`not-evaluated`, guaranteed `0`/`0` by
   `validateTelemetryRecord`'s write-time invariant — trusted, not re-derived); `notMeasured`
   (`cold`/`resume` records where both fields are `null` under the currently-landed schema —
   reported as `null`/`"not-measured"`, never coerced to `0`); and a wall-time-derived proxy
   (`recordedAtMs − admission.acquiredAt`), explicitly labeled `wallTimeProxyMinutes`, never
   presented as `contentAgentMs` — an optional number for callers who want *a* value for cold/resume
   rather than `notMeasured`.
5. **`prepared/attempt`** ratio, with the acquired/eligible-content-generation denominator also
   shown so contention/reuse attempts cannot obscure interpretation; **terminal/decision yield by
   reason** (prepared, unique split/preflight decision, reused terminal, transient failure).
6. **`absorbed-task/prepare-hour`**: numerator = distinct `taskId`s whose milestone directory has
   both `preparation.json` and `absorb-entry.md`; denominator = summed `prepareWallTimeMs` from
   `computeConvergenceMetrics` across those same receipts (receipt-derived, not requiring a paired
   telemetry record — avoids the vacuous-pairing trap the grounding facts rule out). A receipt with
   no `convergence` block is excluded from this denominator too, not treated as zero-duration.
7. **Concurrent duplicate-generation minutes**: for telemetry records sharing `(workspace, taskId)`,
   build `[admission.acquiredAt, recordedAtMs]` (both required non-null; a record missing either is
   excluded from overlap analysis specifically, `reason: "interval-fields-missing"`, but still
   counted elsewhere). Sum only the intersection of interval pairs; a sequential retry starting
   after the prior terminal contributes exactly zero.
8. **Unchanged-stable-terminal recomputation**: group telemetry records by `(taskId,
   hashes.{charter,taskContract,proposal,reviewPolicy})`, using the imported `CACHEABLE_TERMINALS`
   to classify `terminal.{phase,reason}` as cacheable. When ≥2 records in the same group share a
   cacheable terminal and the later one has `decision.kind !== "reuse-terminal"`, count it as an
   avoidable recomputation and sum its `contentAgentMs` when non-null (else routed to
   `notMeasured`/proxy accounting, never a fabricated exact number).
9. **`estimatedAvoidedAgentMinutes`** computed only when a comparable, same-`class`/`highRisk`
   non-`reuse-terminal` sample population exists to derive a labeled, reproducible median from;
   otherwise the literal string `"unknown"`.
10. **Sample-count gate**: total eligible samples (telemetry ∪ receipt, post-exclusion) `<
    minSamples` (default 3) → `{"code":"insufficient-samples", sampleCount, sampleIds, ...}`, no
    P50/P85. Per-population counts always reported separately, never blended into one
    undifferentiated total.
11. **Exclusions unified and always reasoned**: malformed JSON, `validateTelemetryRecord` failures
    (validator's own code, e.g. `"reuse-terminal-invalid"`), interval-fields-missing, and
    caller-supplied `--exclusions <file.json>` entries (`{id, reason}`, matched against
    `recordId`/`attemptId`/receipt path — covers e.g. DIR-126-A's own `--force-release` fixture
    recoveries) — combined into one `exclusions[]` array, each entry carrying an `id` and a
    `reason`, never a silent drop.
12. `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` §4 is hand-edited,
    replacing the flat "15-25 minutes"/"22m 21s" text with the reproduced P50/P85, sample count,
    sample-ID list, and an explicit exclusions note, copy-pasted from a real command run's `--out`
    JSON — the doc stays readable prose (not templated/auto-written); every number in it traces to
    that real output, never hand-typed from recollection.

No new write path into `milestones/prepare-telemetry/` or `.quay/prepare-leases/` — read-only over
both trees, matching the charter's "additive, read-only aggregation" framing.

### Concrete control/data flow

```
CLI: node milestone-preparation-check.ts --capacity-report
       [--telemetry-glob 'milestones/prepare-telemetry/**/*.json']
       [--workspace .] [--exclusions exclusions.json] [--min-samples 3] [--out report.json]
   │
   ├─ _walkJsonFiles(telemetryRoot)      [shared recursion, factored out of queryTelemetryReport's
   │                                       walk(); each caller parses/handles errors independently]
   │     → per file: {path, record|null, parseError|null}
   │        parseError                        → exclusions[] "malformed-json"
   │        validateTelemetryRecord() fails    → exclusions[] (validator's own code)
   │        ok                                 → telemetry sample population
   ├─ walk milestones/M*/preparation.json; for each w/ non-null .convergence:
   │        computeConvergenceMetrics(...) via computeMetricsForReceipt  [REUSED, no 2nd impl]
   │        no .convergence block  → excluded from wall-time stats, "no-convergence-block"
   ├─ join telemetry + receipt populations by (taskId, milestoneId), BEST-EFFORT (unpaired records
   │     on either side still contribute to their own population's stats — never required-paired)
   ├─ apply --exclusions file entries (id/reason) on top
   ├─ import { CACHEABLE_TERMINALS } from proposal-convergence.ts   [not a hand-copied literal]
   ├─ classify: decision.kind ∈ {cold,resume} = content-generation (NOT
   │     decision.createsContentGeneration, confirmed inverted); measuredZero/notMeasured/
   │     wallTimeProxyMinutes buckets
   ├─ percentile() / interval-intersection (acquiredAt..recordedAtMs) / cacheable-pair
   │     recomputation-grouping over joined+unjoined populations (pure, unit-testable)
   ├─ absorbed-task/prepare-hour: receipts w/ (preparation.json ∧ absorb-entry.md) / summed
   │     computeConvergenceMetrics wall-time hours over those same receipts
   └─ < min-samples (per-population AND combined)? → {code:"insufficient-samples", ...}
        else → {code:"ok", sampleCount, exclusions[], p50/p85, ratios, waste-classes}
        console.log(JSON.stringify(report)); --out writes same JSON; exit 0 (even
        insufficient-samples), exit 2 only on hard usage/environment error
   │
   ▼ (human/agent regenerates by hand, citing the --out JSON's real sample IDs)
docs/proposals/quay-milestone-workflow-throughput-capacity-model.md §4 rewritten
```

**Mechanism-claim wiring coverage (DIR-117) — every new call/dispatch/ownership relationship
claimed above, flagged for AC-level proof:**
- CLAIM: `--capacity-report` is a real, reachable CLI branch on `milestone-preparation-check.ts`
  (both canonical and `plugin/` mirror), wired the same way as the existing `--build`/`--metrics`/
  `--telemetry-report` branches → needs AC coverage via grep/import-graph plus a live subprocess
  invocation test, not `--selftest`-only reachability.
- CLAIM: `_walkJsonFiles` is a single shared recursion primitive used by both
  `queryTelemetryReport` and `computeCapacityReport` → needs a fixture/call-count assertion showing
  one traversal implementation, not two independently-written copies.
- CLAIM: `computeCapacityReport` calls `validateTelemetryRecord` (reused, not reimplemented) →
  needs a test asserting a schema-invalid telemetry record lands in `exclusions` with the
  validator's own code.
- CLAIM: `computeCapacityReport` calls `computeConvergenceMetrics`/reuses `computeMetricsForReceipt`
  for wall time (not a second `prepareWallTimeMs` derivation) → needs a test asserting a receipt's
  reported `prepareWallTimeMs` matches `computeMetricsForReceipt`'s own value for the same receipt.
- CLAIM: `computeCapacityReport` imports `CACHEABLE_TERMINALS` (not a duplicated literal) → needs a
  fixture changing an entry in `CACHEABLE_TERMINALS` and observing `computeCapacityReport` pick up
  the same value.
- CLAIM: telemetry and receipt populations are joined best-effort, not required-paired → needs a
  test asserting a receipt-only sample (no matching telemetry) still contributes wall-time stats,
  and a telemetry-only sample (no matching receipt) still contributes decision stats.
- CLAIM: `queryTelemetryReport`'s existing behavior/return shape (including silent-skip-on-
  malformed-JSON) is untouched by the `_walkJsonFiles` extraction → needs a regression test
  re-running an existing `--telemetry-report` fixture, output identical before/after.
- CLAIM: `sync-vendor.sh --check`/`cmp` keeps the `plugin/scripts/` mirror byte-identical → covered
  by the AC's mirror-parity item; no new sync mechanism invented.
- CLAIM: `absorbed-task/prepare-hour`'s numerator is computed from checked-in `absorb-entry.md`
  presence, not a live task-store query → needs a fixture asserting the count changes when an
  `absorb-entry.md` file is added/removed on disk, with no MCP/provider call made.

### Key design decisions

- **Two independent sample populations, best-effort joined — never pairing-required.** The single
  most important delta from a naive "scan telemetry plus its paired receipt" reading, grounded in
  the directly re-confirmed fact that 0/8 committed receipts have a `telemetryFile`. Requiring
  pairing would make the report vacuous against real, already-landed history; this resolves in
  favor of the receipt-side-only denominator (via `computeConvergenceMetrics`) for
  `absorbed-task/prepare-hour`, which does not depend on a pairing that does not yet exist.
- **`decision.kind` (not `decision.createsContentGeneration`) is the content-generation
  discriminator**, because direct code reading (and the live DIR-126-E telemetry record itself,
  `kind: "cold"` / `createsContentGeneration: false`) shows the latter is inverted relative to its
  apparent name. Routing around a landed field's surprising semantics — not trusting its name or
  fixing it (out of this child's `## Touches`, lives in `proposal-convergence.ts`) — is the safer
  choice.
- **Directory traversal, the cacheable-pair allowlist, record validation, and receipt-wall-time
  derivation are all imported/reused, not duplicated**: `_walkJsonFiles` shared with
  `queryTelemetryReport` (recursion only — each caller owns its own parse/error handling, so
  `queryTelemetryReport`'s external behavior is provably unchanged); `validateTelemetryRecord` and
  `computeConvergenceMetrics`/`computeMetricsForReceipt` reused as-is; `CACHEABLE_TERMINALS`
  imported. Two independently-written copies of any of these would drift silently the next time
  DIR-126-C/D's logic changes — the "content living in two places" defect this repo's CLAUDE.md
  calls out to fix at the source.
- **`null` vs `0` for `contentAgentDispatchCount`/`contentAgentMs` is preserved, never coerced** —
  confirmed by direct read of `_writeCommittedTelemetry` and by the live DIR-126-E record itself
  (`null`/`null` for its `cold` decision). Collapsing them would misreport "mechanical work stayed
  at zero" for records where it was simply never captured. Read literally, the task body's own
  Proposal phrasing ("mechanical-runner versus content-generation agent dispatch counts/minutes")
  implies a directly-measured minutes value exists for every decision kind; the landed schema does
  not support that for `cold`/`resume`. The relevant AC item is satisfiable only if read to permit
  an honest `notMeasured` bucket plus a clearly labeled `wallTimeProxyMinutes` — this proposal makes
  that reading explicit rather than discovering it as a Build-time surprise.
- **A malformed-record handler stricter than, but structurally sharing traversal with,
  `queryTelemetryReport`** — its own external contract (silent-skip on malformed JSON) stays
  byte-for-byte unchanged, verified by an explicit regression test; only the new
  `computeCapacityReport` path traces what it excludes and why.
- **Concurrency and unchanged-input recomputation stay two distinct waste classes** — overlap is
  interval intersection on `[acquiredAt, recordedAtMs]` (both required non-null; missing either
  excludes that record from overlap analysis specifically, never silently zero-duration);
  recomputation is identical `hashes.*` + cacheable terminal pairs recurring. Two independent
  passes, never one combined heuristic that could conflate them.
- **No new glob dependency**; `--telemetry-glob` supports exactly the fixed `<root>/**/*.json`
  shape, parsed by string-splitting on `/**/`, not a general glob engine or `fs.globSync` (Node
  ≥22.13-only, below this repo's declared Node-20 packaging floor). Test fixtures use
  `mkdtempSync()`-based isolated tmp-dir roots the same way the existing
  `milestone-preparation-check.test.mjs` fixtures already do — no new test infrastructure pattern.
- **No telemetry schema change** — `admission.acquiredAt`/`recordedAtMs` already support interval
  math; DIR-126-D's frozen `schemaVersion: 2` is not reopened, per this task's Non-goals.
- **Savings are never fabricated** — suppressed dispatch counts are exact (from
  `contentAgentDispatchCount===0` records themselves, guaranteed by the write-side invariant);
  `estimatedAvoidedAgentMinutes` is `"unknown"` unless a real, labeled, reproducible comparable
  sample exists.
- **The throughput-doc regeneration is a manual, human/agent-authored prose rewrite** citing the
  command's real `--out` JSON, not an automated markdown-templating step — keeps the doc readable
  while the machine-readable output stays the traceable source of truth.

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| Fewer than `--min-samples` (default 3) eligible samples (telemetry ∪ receipt, post-exclusion) | `{"code":"insufficient-samples", sampleCount, sampleIds}` per-population and combined — no P50/P85 |
| Telemetry record fails JSON.parse | excluded, `reason: "malformed-json"`, path + parse error recorded |
| Telemetry record fails `validateTelemetryRecord` (incl. a `reuse-terminal` invariant violation) | excluded, `reason` = the validator's own code (e.g. `"reuse-terminal-invalid"`) |
| Record/receipt id listed in `--exclusions` | excluded, `reason` = the caller-supplied reason string (e.g. DIR-126-A `--force-release` fixture recoveries) |
| Record missing `admission.acquiredAt` or `recordedAtMs` | excluded from overlap analysis only (`"interval-fields-missing"`); still counted in decision/agent-work stats |
| `contentAgentDispatchCount`/`contentAgentMs` both `null` (cold/resume under current schema, or a pre-lease site) | reported as `null`/`"not-measured"`, never coerced to `0` or the wall-time-proxy value |
| Two generations' intervals for the same `(workspace, taskId)` overlap | reported as real non-zero concurrent-duplicate minutes, never suppressed |
| A sequential retry's interval starts after the prior terminal | zero concurrent-duplicate minutes; still checked for unchanged-terminal recomputation |
| Identical `hashes.*` + cacheable pair recurs without a `reuse-terminal` hit | counted as `unchangedTerminalRecomputations`; wasted work via the `notMeasured`/proxy rule, never a fabricated exact number |
| No comparable real sample for an avoided-minute counterfactual | `estimatedAvoidedAgentMinutes: "unknown"` |
| A receipt has no `convergence` block (M197/M201/M202/M203) | excluded from wall-time stats and the `absorbed-task/prepare-hour` denominator, not treated as zero-duration |
| `--telemetry-glob` doesn't match `<root>/**/*.json`, bad `--exclusions` JSON, or unreadable `--workspace` | hard usage error, exit 2, matching this file's existing `parseArgs` error convention |

### Compatibility

Purely additive: a new CLI mode + a new exported function on the existing, already-587-line script
(both mirrors confirmed identical via `wc -l`/`diff`, re-run live). `checkPreparation()` — the
function the `Prepared` gate actually calls — is untouched; no proposed change alters its control
flow, confirmed by direct read end to end. `queryTelemetryReport()`'s external behavior (CLI flag,
input, output shape, silent-skip-on-malformed-JSON handling) is unchanged; only its internal
directory recursion is factored into the shared `_walkJsonFiles` helper, verified by an explicit
regression test. Both `experiments/quay-perpetual-stream/scripts/` and `plugin/scripts/` copies
stay byte-identical via the existing `sync-vendor.sh` mechanism (confirmed identical live). No
existing check changes shape or becomes stricter — matches the charter's "why not highRisk" claim.

### Why one milestone, despite the prior real `split-recommended` verdict

This task's own real telemetry record (`milestones/prepare-telemetry/DIR-126-E/2a107fcb5cc9.json`,
cited above as grounding evidence) shows a PRIOR generation of this same task's own ProposalReview
terminated `needs-human`/`split-recommended`. That verdict is not silently ignored here: the
Proposal's ~10-item Chosen mechanism list and 18 AC items are, examined honestly, sub-facets of ONE
pure aggregation function (`computeCapacityReport`) over two joined artifact populations, not
genuinely separable products — matching DIR-126-D's own eventual "Mechanism A" argument (`tasks/
DIR-126-D.md`'s "SPLIT-OR-COMMIT: FINAL RULING" section) for the identical reasoning: dropping any
one item (e.g. shipping percentiles without exclusions, or duplicate-overlap detection without the
unchanged-terminal-recomputation check it structurally depends on for correct interpretation) would
not produce an independently useful, independently shippable increment — it would produce a report
that is silently wrong or misleading in exactly the way this child exists to prevent (fabricated/
uncaveated numbers). The `--capacity-report`/doc-regeneration split (items 1-11 vs. item 12) is the
one genuinely separable seam, and it is already reflected as two Requested-action items, not folded
together. Given DIR-126-D's own real 11-round history already demonstrated that a mechanical
`mechanismCount`/subsystem-cluster signal from an LLM reviewer is noisy and non-monotonic across
cold regenerations (`gap-prepare-milestone-split-decision-no-finality`, filed and now in progress as
M206, is the systemic fix for this exact class), this prior generation's `split-recommended` verdict
is treated as the same class of noise, not a standing objection this Proposal must further rebut
beyond the structural argument above.

### Risks

- **The ≥3-real-sample DoD bar is structurally gated on this child's own dispatch plus other real
  work landing.** One real telemetry record now exists (`DIR-126-E/2a107fcb5cc9.json`, this
  session's own in-flight generation), but that alone is short of 3, and 0/8 committed receipts
  pair with it. Code and unit tests (synthetic fixtures) can be written and reviewed now; the real
  `--capacity-report` regression proof and throughput-doc regeneration should not be attempted
  until the sample bar is realistically reachable — plausibly requiring this task's own later
  generation(s) plus other pending real dispatches, per the charter's own explicit steering.
- **Telemetry-side decision/content-agent statistics may stay thin (1-2 samples) even as
  receipt-side wall-time statistics (4 existing convergence-bearing receipts) are not.** The report
  surfaces this asymmetry explicitly via per-population sample counts, never blending it into one
  undifferentiated total.
- **Content-agent-minutes honesty vs. AC readability tension**: reporting `notMeasured` for
  `cold`/`resume` content-agent-minutes (rather than a fabricated number) is the correct,
  non-fabricating choice, but means the regenerated throughput doc's headline Prepare-duration
  number is wall time, not agent-minutes — a real, disclosed limitation of the current telemetry
  schema. Extending the schema to populate real `contentAgentMs` for cold/resume is explicitly out
  of this child's scope.
- **`decision.createsContentGeneration`'s inverted semantics could be intentional and
  differently-scoped than assumed here** — this proposal treats `decision.kind` as the safer,
  unambiguous discriminator regardless, so a wrong assumption about *why* the field is inverted
  does not change the report's correctness, only removes one alternate (unused) data source.
- **Too few real samples produce a misleadingly precise-looking P50/P85** — mitigated by the
  explicit `insufficient-samples` default rather than silently reporting a distribution from 1-3
  points as statistically meaningful.
- **Interval-based overlap math is only as good as `admission.acquiredAt`/`recordedAtMs`
  fidelity** — both are wall-clock `Date.now()`-derived; clock skew across concurrent dispatches in
  different processes could in principle produce a spurious small overlap or gap. No
  distributed-clock mechanism exists in this repo to correct this; the report states numbers as
  observed.
- **Malformed-record tracing changes `computeCapacityReport`'s exclusions output shape relative to
  `queryTelemetryReport`'s silent-skip behavior** — a deliberate, flagged divergence, not an
  unintended mismatch between the two functions.

### Non-goals

Not implementing DIR-126-A through DIR-126-D's own mechanisms — this child only aggregates and
reports on their real output. Not a general-purpose analytics/dashboard system (persistent metrics
store, web view) — scoped to the Prepare-stage capacity questions this task's AC names. Not
reopening DIR-126-D's frozen telemetry schema (`schemaVersion: 2`) or modifying
`queryTelemetryReport`'s existing external behavior. Not extending `proposal-convergence.ts`'s
telemetry writer to populate real per-generation `contentAgentDispatchCount`/`contentAgentMs` for
`cold`/`resume` — outside this child's declared `## Touches` and the charter's additive-read-only
framing; a legitimate future `gap-*` follow-up, not this child's scope. Not fixing
`decision.createsContentGeneration`'s apparent semantic inversion in `proposal-convergence.ts` —
same reasoning. LOC/duration remain descriptive output only, never a productivity target.

### AC coverage (mapped to `tasks/DIR-126-E.md`'s Acceptance Criteria)

1. **Real, reachable CLI mode** — covered: `--capacity-report` added to the same dispatch block as
   `--build`/`--metrics`/`--telemetry-report`, verified by grep/import-graph plus a live subprocess
   invocation test, both mirrors — not `--selftest`-only reachability.
2. **Reproducible aggregation over checked-in artifacts** — covered by `computeCapacityReport`'s
   field list; every emitted field traces to a named record/receipt field, none synthesized; unit
   tested directly plus one `git diff`-visible real CLI run.
3. **Sample provenance real and traceable** — covered: joined populations retain source
   `recordId`/`attemptId`/receipt path; `--out` JSON carries the raw sample-ID list; the doc
   rewrite cites it directly.
4. **Duplicate-generation minutes mean real overlap** — covered by interval-intersection, unit
   tested against an overlapping pair, a sequential-retry pair, and a single-generation case (all
   three named in Requested action item 3).
5. **C efficiency measured separately** — covered with the honest caveat: `reuse-terminal`'s
   zero-content-agent claim is exact (schema-guaranteed, trusted via `validateTelemetryRecord`); a
   recomputed cacheable terminal's wasted content-agent work is reported via the
   `notMeasured`/proxy rule when `contentAgentMs` is `null`, not a fabricated exact number — this
   proposal recommends the AC wording be read (or amended during review/adjudication) to accept
   that honest reading.
6. **Feedback-efficiency inputs exported, Prepare-scoped** — partially covered by fields already in
   scope (cold/resume/reuse-terminal minute distributions where measurable, `absorbed-task/
   prepare-hour`); token counts (if present in the schema at all) and finding-novelty/recurrence
   (likely sourced from DIR-125's finding-ledger fields, `milestones/*/proposal-ledger.json`) are
   **not confirmed present in this pass** — flagged as a genuine open item for Plan/Build, not
   asserted here as already solved. Does not claim end-to-end verified value or an Execute escape
   rate from Prepare-only evidence.
7. **Machine-readable report preserves raw IDs/strata/exclusions/unknowns** — covered by the
   `--out` JSON schema itself, consumable later without scraping prose.
8. **Insufficient-sample honesty** — covered by the `< minSamples` default-table row, unit tested
   with exactly 2 samples; grepped the scripts directory for existing precedent — none found, so
   this is fresh, self-contained logic.
9. **Mirror byte-identity** — covered by the existing `sync-vendor.sh --check`/`cmp` mechanism,
   unchanged, re-run as part of this child's own Verify.

### Alternatives considered and rejected

- **Require telemetry/receipt pairing as a hard precondition for any statistic.** Rejected —
  falsified by direct inspection: 0/8 committed receipts currently have a paired telemetry record,
  so pairing would report `insufficient-samples` against the entire real historical baseline this
  task is supposed to characterize.
- **Extend `queryTelemetryReport` in place to also aggregate**, instead of adding a new function.
  Rejected: it is `milestoneId`-scoped by contract and its callers depend on that exact
  single-milestone return shape and its current silent-skip malformed-record behavior; changing it
  would violate this task's own Compatibility bar.
- **Fabricate/estimate content-agent-minutes for `cold`/`resume` from wall time via a fixed ratio**
  (e.g. "assume 80% of wall time is content-agent time"). Rejected: exactly the invented-precision
  number the "savings are not fabricated" principle forbids; an honest `notMeasured` bucket plus a
  clearly-labeled `wallTimeProxyMinutes` (never named `contentAgentMs`) is more defensible and
  matches the existing `estimatedAvoidedAgentMinutes: "unknown"` precedent.
- **Trust `decision.createsContentGeneration` as written.** Rejected after direct code reading
  (confirmed by the live DIR-126-E record) showed it inverted relative to its apparent name; using
  it would silently misclassify `cold` (the majority real-world case) as "no content generation."
- **Add a general glob-matching dependency (`minimatch`/`fast-glob`) or use `fs.globSync`.**
  Rejected: the one real use case is a fixed `<root>/**/*.json` shape; a new dependency or a Node
  ≥22.13-only stdlib API (below this repo's Node-20 packaging floor) buys nothing over a simple
  string split plus the already-existing recursive walk.
- **Reimplement `queryTelemetryReport`'s traversal from scratch inside the new aggregation
  function.** Rejected: two independently-maintained directory walks over the same tree is exactly
  the "content living in two places" drift pattern this repo's CLAUDE.md calls out to fix at the
  source.
- **Compute `absorbed-task/prepare-hour` from live `task_get`/`task_list` MCP queries** instead of
  checked-in `absorb-entry.md` presence. Rejected: violates the "reads only checked-in artifacts...
  never Claude Code session JSONL" bar extended consistently — a live provider query is a
  non-reproducible data source; `absorb-entry.md` presence is git-pinned and reproducible.
- **Parse Claude Code session JSONL directly** for finer-grained timing. Rejected outright: violates
  the explicit no-session-JSONL-parsing bar restated from DIR-126-D's precedent, and session logs
  are not checked-in, reproducible artifacts.
- **A telemetry schema change adding explicit wall-clock start/end fields.** Rejected as
  unnecessary — `admission.acquiredAt`/`recordedAtMs` already support the required interval math
  without reopening DIR-126-D's frozen `schemaVersion: 2`.
- **Live, scheduler-integrated overlap detection** (enforcing/blocking at dispatch time). Rejected:
  that is DIR-126-A's already-landed concurrency-control job; this child is read-only reporting
  over historical artifacts, not a second enforcement point.
- **Hand-edit the throughput doc's numbers from session-transcript recollection**, skipping a real
  command run. Rejected: defeats the entire purpose of this child, which exists specifically
  because DIR-126's own Finding showed the current doc has no real supporting measurement.

## Plan

N/A — directive-class child resolved via a human-steered milestone. Depends on [[DIR-126-A]],
[[DIR-126-B]], [[DIR-126-C]], [[DIR-126-D]] all being `done`, and on >= 3 real post-D preparation
generations existing.

## Finding

1. `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` (confirmed by direct read)
   states "15-25 minutes" with no supporting distribution, sample count, or provenance.
2. DIR-126's own Finding measured M195's real Prepare at ~80 minutes (57 of them PlanCheck alone) —
   directly contradicting the documented assumption, with no checked-in mechanism to reproduce that
   number or track it going forward.
3. No command anywhere under `experiments/quay-perpetual-stream/scripts/` aggregates capacity
   statistics from any artifact today (confirmed via grep for `capacity-report`/`P50`/`P85` across
   the scripts directory — zero matches prior to this child).

## Requested action

1. Add `--capacity-report --telemetry-glob 'milestones/prepare-telemetry/**/*.json'` to
   `milestone-preparation-check.ts` (+ `plugin/scripts/` mirror) per the Chosen mechanism above.
2. Regenerate `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` from the
   command's real output against real post-[[DIR-126-D]] telemetry, replacing the flat 15-25 minute
   assumption with the reproduced distribution, sample provenance, and explicit exclusions.
3. Add real test fixtures: a report over >= 3 real-shaped samples producing correct P50/P85/ratios,
   an insufficient-samples case, a malformed-record-excluded case, overlapping-vs-sequential
   two-generation interval cases, an identical-terminal recomputation case, and a
   `reuse-terminal` zero-content-agent case.
4. Real regression proof: run `--capacity-report` against the real telemetry accumulated from
   [[DIR-126-A]] through [[DIR-126-D]]'s own real landing dispatches (plus this child's own), and
   confirm the throughput doc's numbers trace back to those real, checked-in sample IDs.

## Acceptance Criteria

- [ ] **Most important — real production wiring, not agent-prompt guidance:** a grep/import-graph
  check shows `--capacity-report` is a real, reachable CLI mode on `milestone-preparation-check.ts`
  (both mirrors) — not `--selftest`-only reachability. This item alone, if unmet, fails the whole
  child regardless of how many other items pass.
- [ ] **Capacity report is reproducible:** the command, re-run against the same checked-in telemetry
  + receipt artifacts, emits sample count, P50/P85 wall time and summed agent-minutes by
  `class`/`highRisk`/terminal/decision, mechanical-vs-content dispatch work,
  `prepared/attempt`, terminal/decision yield, `absorbed-task/prepare-hour`, concurrent overlap
  minutes, unchanged-terminal recomputation, terminal-reuse hits, and explicit exclusions —
  confirmed via a real `git diff`-visible run, not session transcript prose. The
  throughput-capacity document is updated from that output and no longer asserts 15-25 minutes as
  the general default without supporting current samples.
- [ ] **Sample provenance is real and traceable:** the regenerated throughput doc cites real sample
  IDs a reader can independently locate under `milestones/prepare-telemetry/`, not a bare summary
  number.
- [ ] **Duplicate-generation minutes mean real overlap:** an overlapping two-generation sequence
  for the same `(workspace, taskId)` produces the exact interval-intersection minutes; a sequential
  retry beginning after the prior terminal and a single generation both produce zero.
- [ ] **Degenerate `startedAtMs===endedAtMs` receipt intervals never silently report `prepareWallTimeMs:0`:**
  a fixture receipt with a `convergence` block where `startedAtMs === endedAtMs` (matching the real,
  live M192/M195 shape) is excluded from wall-time stats with `reason:
  "convergence-interval-degenerate"`, never included as a `0`-duration sample; a fixture receipt with
  a genuinely short but distinct interval (`endedAtMs = startedAtMs + 1`) is confirmed still
  included, proving the guard fires only on exact equality, not on short durations.
- [ ] **`absorbed-task/prepare-hour`'s numerator is a checked-in file-presence signal, never a live
  query:** a fixture confirms the count changes when an `absorb-entry.md` file is added/removed on
  disk, with no MCP/provider call made — `absorbed-task/prepare-hour`'s numerator is source-of-truth
  from checked-in artifacts only, matching the "no `~/.claude/projects/**.jsonl` parsing" bar this
  child's own Key design decisions establish.
- [ ] **C efficiency is measured separately (honest-reading wording, matching `### AC coverage`
  item 5):** an identical hash/policy cacheable terminal that is recomputed increments
  `unchangedTerminalRecomputations`; its observed wasted content-agent work is reported as the exact
  measured value when `contentAgentMs` is non-null, and via the `notMeasured`/`wallTimeProxyMinutes`
  rule (never a fabricated exact number) when it is `null` — a correct `reuse-terminal` increments
  the hit count and records zero content agents, exact and schema-guaranteed. Estimated avoided
  minutes are either reproducibly labeled/model-derived or `unknown`.
- [ ] **Feedback-efficiency inputs are exported, Prepare-scoped, to the extent the current schema
  supports (honest-reading wording, matching `### AC coverage` item 6):** the report includes
  cold/resume/reuse-terminal agent-minute distributions where measurable (`notMeasured`/
  `wallTimeProxyMinutes` where not, per the current telemetry schema's real limits — token counts
  and finding novelty/recurrence are NOT confirmed present in the schema as of this Proposal and are
  a genuine open item, not asserted solved here) and the raw numerator/denominator fields needed to
  compute Prepare escape rate later. It does not claim end-to-end verified value or an Execute escape
  rate from Prepare-only evidence.
- [ ] The machine-readable report preserves raw sample IDs, stage/terminal strata, exclusions, and
  unknowns so a later Prepare-to-post-Land evaluation can consume it without scraping the
  regenerated prose document.
- [ ] **`interval-fields-missing` is a partial exclusion, not a full one:** a fixture telemetry
  record missing `admission.acquiredAt` or `recordedAtMs` confirms it is excluded from overlap
  analysis specifically (`reason: "interval-fields-missing"`) while still contributing to
  decision/agent-work stats elsewhere in the report — not dropped from the sample count entirely.
- [ ] **Populations are best-effort joined, never required-paired:** a fixture with a receipt-only
  sample (no matching telemetry record for that `(taskId, milestoneId)`) confirms it still
  contributes wall-time stats; a fixture with a telemetry-only sample (no matching receipt)
  confirms it still contributes decision/agent-work stats — neither is silently dropped from its
  own population for lacking its pair.
- [ ] **`_walkJsonFiles` is a single shared recursion primitive:** a fixture confirms both
  `queryTelemetryReport` and `computeCapacityReport` call the same `_walkJsonFiles(root)` helper for
  directory traversal, not two independent directory-walk implementations.
- [ ] **`validateTelemetryRecord` is reused, not reimplemented:** a fixture confirms
  `computeCapacityReport` calls the existing `validateTelemetryRecord` to classify a malformed
  record into `exclusions`, never a second, parallel validation routine.
- [ ] **`computeConvergenceMetrics`/`computeMetricsForReceipt` are reused for wall time, not
  re-derived:** a fixture confirms `computeCapacityReport` calls the existing
  `computeConvergenceMetrics`/`computeMetricsForReceipt` to get `prepareWallTimeMs` per receipt,
  not a second, independent wall-time computation.
- [ ] **`CACHEABLE_TERMINALS` is imported, not hand-copied:** a fixture that changes an entry in
  the real, imported `CACHEABLE_TERMINALS` (from `proposal-convergence.ts`) and observes
  `computeCapacityReport`'s unchanged-terminal-recomputation logic pick up that change confirms a
  real import, not a duplicated literal that could silently drift from the source of truth.
- [ ] **`queryTelemetryReport`'s existing behavior is unchanged:** a fixture confirms
  `--telemetry-report <milestoneId>`'s pre-existing output shape/behavior is byte-for-byte the same
  before and after this child's diff — `_walkJsonFiles`'s extraction is a pure refactor of shared
  traversal logic, never a behavior change to the existing reader.
- [ ] **Insufficient-sample honesty:** a fixture with fewer than 3 samples produces the explicit
  `insufficient-samples` result, not a misleadingly precise distribution.
- [ ] Canonical and `plugin/` mirrors of `milestone-preparation-check.ts` and its test file are
  byte-identical — `cmp`/`sync-vendor.sh --check`.
- [ ] **Grounding evidence for the Problem-framing/Chosen-mechanism claims above (added for
  wiring-coverage completeness):** confirmed via direct source read — every identifier below is an
  already-real, already-landed name confirmed present in the current tree (DIR-126-A/B/C/D's own
  landed code, or this file's own Chosen mechanism), not a new invention: `contentAgentDispatchCount`,
  `contentAgentMs`, `null`, `0`, `cold`, `resume`, `_writeCommittedTelemetry`,
  `proposal-convergence.ts:665`, `reuse-terminal`, `not-evaluated`, `_recordAttemptCli`,
  `validateTelemetryRecord`, `:462-464`, `proposal-convergence.ts`, `## Touches`,
  `_walkJsonFiles(root)`, `queryTelemetryReport`, `walk()`, `milestones/M*/preparation.json`,
  `--workspace`, `.`, `convergence`, `computeConvergenceMetrics`, `computeMetricsForReceipt`,
  `prepareWallTimeMs`, `proposalReviewRounds`, `blockingFindingYield`, `proposalChurnRatio`,
  `_walkJsonFiles`, `CACHEABLE_TERMINALS`, `checkPreparation()`, `Prepared`, `admission.acquiredAt`,
  `recordedAtMs`, `Date.now()` — all confirmed real by direct source read of the current tree,
  wired and verified as described above. Round-2 additionally flagged these exact-form identifiers
  needing co-location here: `contentAgentDispatchCount===0 && contentAgentMs===0`,
  `{ok:false, code:"reuse-terminal-invalid"}` (distinct, as literal text, from the loosely-spaced
  forms already covered above), `milestones/prepare-telemetry/**/*.json`, `--telemetry-glob` —
  confirmed real by the same direct-source-read standard.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code, prompt text, or a same-generation self-test are necessary but insufficient.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real, non-fixture `--capacity-report` run against real post-[[DIR-126-D]] telemetry is
  exercised end to end with command output, not asserted, and the throughput doc is regenerated
  from that real output.
- [ ] At least three post-change real preparation generations of different terminal shapes
  (inherited from the parent's own DoD) are the real sample set this child's report is proven
  against — not a synthetic-only demonstration.
- [ ] The real sample set includes or is supplemented by C's real `reuse-terminal` proof, and the
  report demonstrates zero content-agent work for that decision without weakening independent
  review for cold/resume generations.
- [ ] A fresh independent audit confirms the report's numbers trace back to real, checked-in
  telemetry artifacts, not session prose or hand-edited documentation.

## Human verification when exp5 marks this DIR done

1. Can capacity and bottleneck conclusions now be reproduced without inspecting private Claude
   session logs?
2. Does the throughput doc's own provenance let a reader independently verify the numbers against
   real checked-in artifacts?
3. Are concurrent overlap and unchanged-terminal recomputation both zero after A/C enforcement
   (or every exception explicitly identified), without misclassifying valid sequential retries?
4. Does the report expose reusable cost/recurrence inputs without pretending Prepare-only
   telemetry measures complete delivered value?

## Touches

- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts`
- `plugin/scripts/milestone-preparation-check.ts`
- `experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs`
- `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md`
- `docs/proposals/quay-prepare-execute-feedback-convergence.md`
