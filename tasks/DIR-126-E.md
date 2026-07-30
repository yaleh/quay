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

Confirmed by direct read/grep against the current tree (not carried over from the task body's prior
text without re-verification):

- `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md:111` (also echoed at
  116-118/124) still states "**15-25 minutes**" as the Prepare planning range, folded into
  "≈85-95 minutes per task," sourced from a single real Prepare observation (DIR-117, 22m 21s) with
  no distribution, no sample count, and no provenance anywhere in the doc.
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` is **587 lines**,
  byte-identical to `plugin/scripts/milestone-preparation-check.ts` (confirmed via `diff`, re-run
  live for this pass). It already exposes `queryTelemetryReport({workspace, milestoneId})`
  (line 159, CLI-wired at `--telemetry-report <milestoneId>`, DIR-126-D/M203 Claim B.1) — a
  **single-milestone filter**, not an aggregator: its internal `walk()` (line 162) recurses
  `milestones/prepare-telemetry/**/*.json`, keeps only records matching the one `milestoneId`
  argument, and returns them raw. It computes no P50/P85, no ratios, no waste classes, and its
  `walk()` **silently swallows JSON-parse failures** with no exclusions trace — a materially weaker
  bar than this task's own AC ("excluded from the sample count, listed explicitly in `exclusions`
  with the reason"). `grep -n "capacity-report\|P50\|P85"` over the file returns nothing — the
  aggregation mode this task requires does not exist yet.
- `find milestones/prepare-telemetry` confirms the directory **does not exist** — zero real
  telemetry records exist anywhere on disk today. This milestone's (M204/DIR-126-E's) own
  `prepare-milestone` dispatch will produce the first real record.
- Direct inspection of **all 8** currently-committed `milestones/M*/preparation.json` receipts
  (M192, M195, M197, M198, M200, M201, M202, M203 — re-confirmed live via `ls`/`grep` for this
  pass) shows **zero of the eight** carry a non-null `telemetryFile` field — including M203,
  DIR-126-D's own landing receipt, whose Prepare predates the telemetry writer going live. This is
  the single most important grounding fact for this proposal's design: even after DIR-126-D landed
  the telemetry-writing code, the receipt/telemetry **pairing** it enables has never been exercised
  on a single committed artifact. **A design that requires telemetry-receipt pairing as a
  precondition for any statistic would report `insufficient-samples` against the entire real
  M192-M203 historical baseline**, not just the narrow "zero post-D telemetry" window the charter
  names — this rules out "pairing required" as a viable design (see Chosen mechanism and
  Alternatives below).
- `computeConvergenceMetrics` (`proposal-convergence.ts:188`, exported) is already reused by
  `computeMetricsForReceipt` (`milestone-preparation-check.ts:118`, also exported) to derive
  `prepareWallTimeMs` directly from a receipt's own `convergence.{startedAtMs,endedAtMs}`, plus
  `proposalReviewRounds`, `blockingFindingYield`, `proposalChurnRatio` — this is a second, already-
  working, telemetry-independent source of Prepare wall time, available for every receipt with a
  `convergence` block (4 of the 8: M192, M195, M198, M200 — re-verified live via
  `for f in M192 M195 M197 M198 M200 M201 M202 M203; do node -e "console.log('$f',
  JSON.parse(require('fs').readFileSync('milestones/$f/preparation.json')).convergence!=null)";
  done`, which returns `true` for M192/M195/M198/M200 and `false` for M197/M201/M202/M203 — M203
  itself has no `convergence` block, since it landed via a manually-built receipt, not a real
  `prepare-milestone` ProposalReview convergence run) regardless of whether a paired telemetry
  record exists.
- The frozen telemetry record (`buildTelemetryRecord`, schemaVersion 2, `proposal-convergence.ts:
  388-422`) carries `admission.acquiredAt` (lease-acquisition timestamp) and `recordedAtMs`
  (record-write timestamp) per attempt — sufficient to derive a per-attempt `[acquiredAt,
  recordedAtMs]` interval for overlap/duplicate-generation analysis without any schema change.
- **`contentAgentDispatchCount`/`contentAgentMs` are `null`, not `0`, for `cold` and `resume`
  records** (`_writeCommittedTelemetry`, `proposal-convergence.ts:665`, confirmed by direct read)
  — only `reuse-terminal` (line ~578) and the three pre-lease `not-evaluated` sites
  (`_recordAttemptCli`, line 751) get an explicit `0`/`0`, an invariant `validateTelemetryRecord`
  itself enforces at write time (`:462-464`). `null` means "a lease was never held, dispatch was
  never even measurable"; `0` means "measured, and confirmed zero." **The two decision kinds that
  actually dispatch content agents (cold, resume) never get a measured minutes/count value in the
  schema landed today** — collapsing `null` into `0` would misreport mechanical-vs-content-agent
  work as "stayed at zero" when it was in fact simply never captured.
- **`decision.createsContentGeneration` is written as `kind === "resume"`**
  (`proposal-convergence.ts:664`, confirmed by direct read) — **true only for `resume`, false for
  `cold`** — the reverse of what the field name suggests if read as "did this generation dispatch
  content agents." Both `cold` and `resume` demonstrably run real content-agent work
  (ProposalAuthors/Adjudicate/ProposalReview/PlanAuthor/PlanCheck, minus whatever `resume` skips);
  only `reuse-terminal` truly creates zero content generation. **`--capacity-report` must not use
  `decision.createsContentGeneration` as the content-generation discriminator** — trusting it would
  silently misclassify `cold` (the majority real-world case) as "no content generation," corrupting
  the headline `prepared/attempt` and content-generation-count metrics. It must derive "content-
  generation attempt" from `decision.kind ∈ {cold, resume}` directly, the frozen, unambiguous field.
  Fixing the field itself is out of this child's scope (it lives in `proposal-convergence.ts`,
  outside DIR-126-E's declared `## Touches` and the charter's "why not highRisk" boundary) — this
  proposal treats it as a landed quirk to route around, not to repair.
- `CACHEABLE_TERMINALS` (the allowlist DIR-126-C's `decideResumeGeneration` uses for
  `reuse-terminal` eligibility) is already `export const` at `proposal-convergence.ts:247`
  (confirmed via grep). `milestone-preparation-check.ts` already imports three other named exports
  from the same module, so importing `CACHEABLE_TERMINALS` too is a same-shape addition, not a new
  cross-module coupling.
- `milestones/*/absorb-entry.md` is a real, checked-in, pre-existing convention recording a
  milestone's ABSORB gate outcome — usable as the "this task was actually landed" signal for
  `absorbed-task/prepare-hour` without a live task-store query, keeping the "checked-in artifacts
  only" discipline this task's own Key design decisions already commit to.

In short: no code anywhere aggregates capacity statistics across telemetry+receipt artifacts today;
the doc's flat number has no supporting evidence; and the two real data sources (telemetry records,
preparation receipts) have complementary, only-partially-overlapping coverage — any correct design
must join them best-effort, not require pairing.

### Chosen mechanism

Add a new, additive `--capacity-report [--telemetry-glob '<root>/**/*.json'] [--workspace <dir>]
[--exclusions <file.json>] [--min-samples N] [--out <file>]` CLI mode to
`milestone-preparation-check.ts` (+ byte-identical `plugin/scripts/` mirror), following the exact
existing `isDirectInvocation()` + `parseArgs` else-if dispatch pattern at lines 493-568 (a new
`else if (parsed.capacityReport)` branch alongside the existing `metrics`/
`telemetryReportMilestoneId` branches, before the default `checkPreparation` dispatch — no new
invocation convention introduced), backed by a new pure exported function `computeCapacityReport({
workspace, telemetryGlob, exclusions, minSamples })` that:

1. **Walks two artifact populations independently and joins best-effort — never requires pairing.**
   - *Telemetry population*: every file under `milestones/prepare-telemetry/**/*.json`
     (`--telemetry-glob` overridable; default matches the task's own requested default). Traversal
     uses a **new, shared, low-level `_walkJsonFiles(root)` helper** that does directory recursion
     only (returns file paths, no parsing) — refactored out of `queryTelemetryReport`'s existing
     `walk()` so both call sites share one recursion primitive instead of two independently-
     maintained copies (avoiding exactly the "content living in two places" drift this repo's own
     CLAUDE.md calls out). Each file is then read/parsed **by its caller**: `queryTelemetryReport`
     keeps its own existing silent-skip-on-parse-failure behavior completely unchanged (back-compat,
     confirmed by an explicit regression test re-running an existing `--telemetry-report` fixture);
     `computeCapacityReport` uses its own parse step that captures `{path, record|null, parseError|
     null}` per file, turning a parse failure into a **traced** `exclusions` entry
     (`reason: "malformed-json"`, with the file path and parse error) instead of a silent drop. Each
     parsed record is then run through the **existing, reused** `validateTelemetryRecord`
     (`proposal-convergence.ts:430`) — not a new ad hoc validator — to confirm schema well-
     formedness; a validator failure (including a `reuse-terminal` record that fails the write-side
     zero-content-agent invariant) becomes an `exclusions` entry carrying the validator's own
     `{code, message}`, never silently included.
   - *Receipt population*: every `milestones/M*/preparation.json` under `--workspace` (default `.`)
     that has a non-null `convergence` block, fed through the **existing, reused**
     `computeConvergenceMetrics` (via the same call `computeMetricsForReceipt` already makes — not a
     second `prepareWallTimeMs` derivation) to get `prepareWallTimeMs`/`proposalReviewRounds`/
     `blockingFindingYield`/`proposalChurnRatio` per receipt. A receipt with no `convergence` block
     (pre-DIR-125, e.g. M197/M201/M202; or post-DIR-125 but landed via a manually-built receipt rather
     than a real ProposalReview convergence run, e.g. M203) is excluded from wall-time stats specifically, noted as
     `"no-convergence-block"`, not treated as an error.
   - The two populations are **joined best-effort by `(taskId, milestoneId)` where both exist**, but
     a receipt with no matching telemetry record still contributes wall-time samples, and a
     telemetry record with no matching receipt still contributes decision/content-agent samples.
     This directly reflects the grounding fact above (0/8 committed receipts currently pair with a
     telemetry record) — requiring pairing would make the report vacuous against real history.
2. **Percentiles** via one small shared pure helper (`percentile(sortedNumbers, p)`), computed over
   whatever numeric field is in scope (receipt-side wall time, telemetry-side wall time and, where
   measurable, agent-minutes), broken down by `class`/`highRisk`/terminal outcome-reason/
   `decision.kind` per the task's AC (pre-decision `not-evaluated` reported as its own bucket, never
   folded into `cold`).
3. **Content-generation discriminator is `decision.kind ∈ {cold, resume}`**, never
   `decision.createsContentGeneration` (see Problem framing finding above) — `eligible` =
   `decision.kind ∈ {cold, resume, reuse-terminal}` (admitted); `attempt` = every well-formed record
   read (including `not-evaluated`).
4. **Content-agent dispatch/minutes reported as three explicit, never-blended buckets**:
   `measuredZero` (`reuse-terminal`/`not-evaluated`, where `contentAgentDispatchCount===0 &&
   contentAgentMs===0` is guaranteed by `validateTelemetryRecord`'s own write-time invariant, so the
   report trusts and surfaces that guarantee rather than re-deriving it); `notMeasured` (`cold`/
   `resume` records where both fields are `null` under the currently-landed schema — reported as
   `null`/`"not-measured"`, never coerced to `0` or silently treated as a real zero); and a
   **wall-time-derived proxy**, computed from `recordedAtMs − admission.acquiredAt` and explicitly
   labeled `wallTimeProxyMinutes` (never presented as `contentAgentMs`), for callers who want *a*
   number for cold/resume rather than `notMeasured`.
5. **`prepared/attempt`** ratio, with the acquired/eligible-content-generation denominator also
   shown so contention/reuse attempts cannot obscure interpretation; **terminal/decision yield by
   reason** (prepared, unique split/preflight decision, reused terminal, transient failure).
6. **`absorbed-task/prepare-hour`**: numerator = count of distinct `taskId`s whose milestone
   directory has both a `preparation.json` and an `absorb-entry.md`; denominator = summed
   `prepareWallTimeMs` from `computeConvergenceMetrics` across those same receipts (receipt-derived,
   not requiring a paired telemetry record — consistent with the best-effort-join principle above,
   and avoiding the vacuous-pairing trap the grounding fact rules out). A receipt with no
   `convergence` block is excluded from this denominator too, not treated as zero-duration.
7. **Concurrent duplicate-generation minutes**: for telemetry records sharing `(workspace, taskId)`,
   build the interval `[admission.acquiredAt, recordedAtMs]` — both fields required non-null; a
   record missing either is excluded from overlap analysis specifically
   (`reason: "interval-fields-missing"`), but still counted elsewhere. Sum only the
   **intersection** of pairs of intervals; a sequential retry whose interval starts after the prior
   terminal's `recordedAtMs` contributes exactly zero.
8. **Unchanged-stable-terminal recomputation**: group telemetry records by `(taskId,
   hashes.{charter,taskContract,proposal,reviewPolicy})`, using the **imported** `CACHEABLE_TERMINALS`
   (from `proposal-convergence.ts`, already exported, already a sibling import in this file — never
   a second hand-copied literal) to classify a record's `terminal.{phase,reason}` as cacheable. When
   ≥2 records in the same group share a cacheable terminal and the second-or-later one has
   `decision.kind !== "reuse-terminal"`, count it as an avoidable recomputation and sum its
   `contentAgentMs` (only when non-null; otherwise contributes to the `notMeasured`/wall-time-proxy
   accounting, never a fabricated exact number).
9. **`estimatedAvoidedAgentMinutes`** computed only when a same-`class`/`highRisk` comparable
   non-`reuse-terminal` sample population exists to derive a labeled, reproducible median from;
   otherwise the literal string `"unknown"`.
10. **Sample-count gate**: total eligible samples (telemetry ∪ receipt, post-exclusion) `<
    minSamples` (default 3) → top-level `{"code": "insufficient-samples", sampleCount, sampleIds,
    ...}`, no P50/P85 computed. Per-population sample counts are always reported separately (never
    blended into one undifferentiated total), so a caller can see e.g. "4 receipt-side wall-time
    samples, 1 telemetry-side decision sample" rather than a misleading combined "5."
11. **Exclusions are unified and always reasoned**: malformed JSON (`reason: "malformed-json"`,
    path + parse error), `validateTelemetryRecord` failures (`reason` = validator's own code,
    including a `reuse-terminal`-invariant violation as `"reuse-terminal-invalid"`), interval-fields-
    missing, and caller-supplied `--exclusions <file.json>` entries (array of `{id, reason}`,
    matched against `recordId`/`attemptId`/receipt path — covers e.g. DIR-126-A's own
    `--force-release` fixture recoveries) — combined into one `exclusions[]` array, each entry
    always carrying an `id` and a `reason`, never a silent drop.
12. `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` §4 is hand-edited to
    replace the flat "15-25 minutes" / "22m 21s" text with the reproduced P50/P85, sample count,
    sample-ID list, and an explicit exclusions note, **copy-pasted from a real command run's `--out`
    JSON** — the doc stays readable prose (not templated/auto-written), but every number in it must
    be traceable to that real output, never hand-typed from recollection.

No new write path into `milestones/prepare-telemetry/` or `.quay/prepare-leases/` — `--capacity-
report` is read-only over both trees, matching the charter's "additive, read-only aggregation"
framing.

### Concrete control/data flow

```
CLI: node milestone-preparation-check.ts --capacity-report
       [--telemetry-glob 'milestones/prepare-telemetry/**/*.json']
       [--workspace .] [--exclusions exclusions.json] [--min-samples 3] [--out report.json]
   │
   ├─ _walkJsonFiles(telemetryRoot)            [shared recursion primitive w/ queryTelemetryReport;
   │                                             each caller parses/handles errors independently]
   │     → per file: {path, record|null, parseError|null}
   │        parseError            → exclusions[] "malformed-json"
   │        validateTelemetryRecord(record) fails → exclusions[] (validator's own code)
   │        ok                    → telemetry sample population
   ├─ walk milestones/M*/preparation.json; for each w/ .convergence:
   │        computeConvergenceMetrics(...)      [REUSED via computeMetricsForReceipt — no 2nd impl]
   │        no .convergence block               → excluded from wall-time stats, "no-convergence-block"
   ├─ join telemetry + receipt populations by (taskId, milestoneId), BEST-EFFORT (unpaired records
   │     on either side still contribute to their own population's stats — never required-paired)
   ├─ apply --exclusions file entries (id/reason) on top
   ├─ import { CACHEABLE_TERMINALS } from proposal-convergence.ts   [not a hand-copied literal]
   ├─ per-record classification: decision.kind ∈ {cold,resume} = content-generation (NOT
   │     decision.createsContentGeneration, confirmed inverted); measuredZero/notMeasured/
   │     wallTimeProxyMinutes buckets for content-agent work
   ├─ percentile()/interval-intersection (admission.acquiredAt..recordedAtMs)/cacheable-pair
   │     recomputation-grouping over the joined+unjoined populations (pure, unit-testable)
   ├─ absorbed-task/prepare-hour: receipts w/ (preparation.json ∧ absorb-entry.md) / summed
   │     computeConvergenceMetrics wall-time hours over those same receipts
   └─ < min-samples (per-population AND combined reported)? → {code:"insufficient-samples", ...}
        else → { code:"ok", sampleCount, exclusions[], p50/p85, ratios, waste-classes }
        console.log(JSON.stringify(report)); --out writes the same JSON to disk; exit 0 (even
        insufficient-samples), exit 2 only on a hard usage/environment error (bad --exclusions
        JSON, unreadable --workspace, --telemetry-glob not matching the fixed <root>/**/*.json shape)
   │
   ▼ (human/agent regenerates by hand, citing the --out JSON's real sample IDs)
docs/proposals/quay-milestone-workflow-throughput-capacity-model.md §4 rewritten
```

**Mechanism-claim wiring coverage (DIR-117) — every new call/dispatch/ownership relationship
claimed above, flagged for AC-level proof:**
- CLAIM: `--capacity-report` is a real, reachable CLI branch on `milestone-preparation-check.ts`
  (both canonical and `plugin/` mirror) → covered by AC item 1 (grep/import-graph check, not
  `--selftest`-only, plus a live subprocess invocation test).
- CLAIM: `_walkJsonFiles` is a single shared recursion primitive used by both `queryTelemetryReport`
  and `computeCapacityReport` → needs a fixture/call-count assertion showing one traversal
  implementation, not two independently-written copies.
- CLAIM: `computeCapacityReport` calls `validateTelemetryRecord` (reused, not reimplemented) → needs
  a test asserting a schema-invalid telemetry record lands in `exclusions` with the validator's own
  code.
- CLAIM: `computeCapacityReport` calls `computeConvergenceMetrics`/reuses `computeMetricsForReceipt`
  for wall time (not a second `prepareWallTimeMs` derivation) → needs a test asserting a receipt's
  reported `prepareWallTimeMs` matches `computeMetricsForReceipt`'s own value for the same receipt.
- CLAIM: `computeCapacityReport` imports `CACHEABLE_TERMINALS` (not a duplicated literal) → needs a
  fixture changing an entry in `CACHEABLE_TERMINALS` and observing `computeCapacityReport` pick up
  the same value.
- CLAIM: telemetry and receipt populations are joined best-effort, not required-paired → needs a
  test asserting a receipt-only sample (no matching telemetry) still contributes wall-time stats,
  and a telemetry-only sample (no matching receipt) still contributes decision stats.
- CLAIM: `queryTelemetryReport`'s existing behavior/return shape is untouched → needs a regression
  test re-running an existing `--telemetry-report` fixture unchanged (its silent-skip-on-malformed-
  JSON behavior specifically preserved).
- CLAIM: `sync-vendor.sh --check`/`cmp` keeps the `plugin/scripts/` mirror byte-identical → covered
  by AC's mirror-parity item; no new sync mechanism invented.

### Key design decisions

- **Two independent sample populations, best-effort joined — never pairing-required.** The single
  most important delta from the task body's original phrasing ("scanning every telemetry record ...
  plus its paired receipt"), grounded in the observed fact that 0/8 committed receipts currently
  have a `telemetryFile`. Requiring pairing would make the report report `insufficient-samples`
  against real, already-landed history for no principled reason — this reconciles the two drafts'
  differing designs for `absorbed-task/prepare-hour` in favor of the receipt-side-only denominator
  (via `computeConvergenceMetrics`), which does not depend on the pairing that does not yet exist.
- **`decision.kind` (not `decision.createsContentGeneration`) is the content-generation
  discriminator**, because direct code reading shows the latter is inverted relative to its apparent
  name (`kind === "resume"`, `proposal-convergence.ts:664`). Routing around a landed field's
  surprising semantics, rather than trusting its name or fixing it (out of scope — touches
  `proposal-convergence.ts`), is the safer choice.
- **Directory traversal, the cacheable-pair allowlist, record validation, and receipt-wall-time
  derivation are all imported/reused, not duplicated**: `_walkJsonFiles` shared with
  `queryTelemetryReport` (recursion only — each caller owns its own parse/error handling, so
  `queryTelemetryReport`'s external behavior is provably unchanged); `validateTelemetryRecord` and
  `computeConvergenceMetrics`/`computeMetricsForReceipt` reused as-is; `CACHEABLE_TERMINALS` imported
  from `proposal-convergence.ts`. Two independently-written copies of any of these would drift
  silently the next time DIR-126-C/D's logic changes — exactly the "content living in two places"
  defect this repo's CLAUDE.md calls out as something to fix at the source.
- **`null` vs `0` for `contentAgentDispatchCount`/`contentAgentMs` is preserved, never coerced** —
  `null` (pre-lease site or `cold`/`resume` under the current schema — dispatch was never even
  measurable) and `0` (`reuse-terminal`'s proven-zero invariant) mean different things; collapsing
  them would misreport "mechanical work stayed at zero" for records where it was simply never
  captured. This is the single biggest correction this proposal makes to the existing task-body
  Proposal's phrasing ("Mechanical-runner versus content-generation/review agent dispatch
  counts/minutes") — read literally, that phrasing implies a directly-measured minutes value exists
  for every decision kind; the landed schema does not support that for `cold`/`resume`. The relevant
  AC item ("Mechanical-vs-content agent dispatch counts/minutes") is satisfiable exactly as worded
  only if read to permit an honest `notMeasured` bucket plus a clearly-labeled
  `wallTimeProxyMinutes` — this proposal makes that reading explicit rather than discovering it as a
  surprise during Build.
- **A malformed-record handler stricter than, but structurally sharing traversal with,
  `queryTelemetryReport`** — `queryTelemetryReport`'s own external contract (silent-skip on
  malformed JSON) stays byte-for-byte unchanged, verified by an explicit regression test; only the
  NEW `computeCapacityReport` path traces what it excludes and why.
- **Concurrency and unchanged-input recomputation stay two distinct waste classes** — overlap is
  interval intersection on `[acquiredAt, recordedAtMs]` (both required non-null; missing either
  excludes that record from overlap analysis specifically, not silently zero-duration); recomputation
  is identical `hashes.*` + cacheable `terminal.{phase,reason}` pairs recurring. Two independent
  passes over the same record set, never one combined heuristic that could conflate them.
- **No new glob dependency; `--telemetry-glob` supports exactly the fixed `<root>/**/*.json` shape**
  the task's own AC names, parsed by string-splitting on `/**/`, not a general glob engine or
  `fs.globSync` (Node ≥22.13-only, below this repo's declared Node-20 packaging floor — even though
  `experiments/` scripts aren't in that job's scope today, staying off it costs nothing). Test
  fixtures use `mkdtempSync()`-based isolated tmp-dir roots the same way `experiments/
  quay-perpetual-stream/test/milestone-preparation-check.test.mjs`'s existing fixtures already do —
  no new test infrastructure pattern.
- **No telemetry schema change** — `admission.acquiredAt`/`recordedAtMs` already support interval
  math; DIR-126-D's frozen `schemaVersion: 2` is not reopened, per this task's own Non-goals.
- **Savings are never fabricated** — suppressed dispatch counts are exact (from
  `contentAgentDispatchCount===0` records themselves, guaranteed by the write-side invariant);
  `estimatedAvoidedAgentMinutes` is `"unknown"` unless a real, labeled, reproducible comparable
  sample exists.
- **The throughput doc regeneration is a manual, human/agent-authored rewrite of prose that cites the
  command's real `--out` JSON**, not an automated markdown-templating step — keeping the doc
  readable prose while the machine-readable output stays the traceable source of truth.

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| Fewer than `--min-samples` (default 3) eligible samples (telemetry ∪ receipt, post-exclusion) | `{"code":"insufficient-samples", sampleCount, sampleIds}` per-population and combined — no P50/P85 |
| Telemetry record fails JSON.parse | excluded, `reason: "malformed-json"`, path + parse error recorded |
| Telemetry record fails `validateTelemetryRecord` (incl. a `reuse-terminal` invariant violation) | excluded, `reason` = the validator's own code (e.g. `"reuse-terminal-invalid"`) |
| Record/receipt id listed in `--exclusions` | excluded, `reason` = the caller-supplied reason string (e.g. DIR-126-A `--force-release` fixture recoveries) |
| Record missing `admission.acquiredAt` or `recordedAtMs` | excluded from overlap analysis only (`reason: "interval-fields-missing"`); still counted in decision/agent-work stats |
| `contentAgentDispatchCount`/`contentAgentMs` both `null` (cold/resume under current schema, or a pre-lease site) | reported as `null`/`"not-measured"`, never coerced to `0` or to the wall-time-proxy value |
| Two generations' `[acquiredAt, recordedAtMs]` intervals for the same `(workspace, taskId)` overlap | reported as real non-zero concurrent-duplicate minutes, never suppressed |
| A sequential retry's interval starts after the prior terminal | zero concurrent-duplicate minutes; still checked for unchanged-terminal-recomputation |
| Identical `hashes.*` + cacheable pair recurs without a `reuse-terminal` hit | counted as `unchangedTerminalRecomputations`; wasted work reported via the `notMeasured`/wall-time-proxy rule (never a fabricated exact number when `contentAgentMs` is `null`) |
| No comparable real sample for an avoided-minute counterfactual | `estimatedAvoidedAgentMinutes: "unknown"` |
| A receipt has no `convergence` block (pre-DIR-125, e.g. M197/M201/M202) | excluded from wall-time stats and the `absorbed-task/prepare-hour` denominator specifically, not treated as zero-duration |
| `--telemetry-glob` does not match the fixed `<root>/**/*.json` shape, or bad `--exclusions` JSON, or unreadable `--workspace` | hard usage error, exit 2, matching this file's existing `parseArgs`/`--build`/`--ledger` error convention |

### Compatibility

Purely additive: a new CLI mode + a new exported function on the existing, already-587-line script
(confirmed via `wc -l`, both mirrors identical), plus a hand-authored doc rewrite. `checkPreparation()`
(the function the `Prepared` gate actually calls) is untouched — confirmed by direct read that no
proposed change alters its control flow. `queryTelemetryReport()`'s external behavior (CLI flag,
input, output shape, and specifically its silent-skip-on-malformed-JSON handling) is unchanged; only
its internal directory recursion is factored into a shared `_walkJsonFiles` helper, verified by an
explicit regression test re-running an existing `--telemetry-report` fixture unchanged. Both
`experiments/quay-perpetual-stream/scripts/` and `plugin/scripts/` copies stay byte-identical via
the existing `sync-vendor.sh` mechanism (confirmed identical via `diff`, re-run live for this pass).
No existing check changes shape or becomes stricter — matches the charter's "Why not highRisk"
claim, independently re-verified here by reading `checkPreparation()` end to end.

### Risks

- **The ≥3-real-sample DoD bar is structurally gated on this child's own dispatch plus other real
  work landing** (charter's own explicit risk, re-confirmed live: zero telemetry records exist
  today, and 0/8 committed receipts pair with one). Code and unit tests (synthetic fixtures) can be
  written and reviewed now; the real `--capacity-report` regression proof and throughput-doc
  regeneration cannot run meaningfully until ≥3 real, differently-shaped terminal records exist.
  This child's own Prepare/Build/Land generations, once real telemetry is produced by this
  milestone's own dispatch, become a plausible first real sample — the AC/DoD items requiring real
  sample provenance should not be attempted before that.
- **Zero committed receipts currently pair with a telemetry record.** If DIR-126-E's own real
  dispatch is the only new sample before the regression proof runs, telemetry-side decision/content-
  agent statistics may still be thin (1 sample) even as receipt-side wall-time statistics (4+
  existing convergence-bearing receipts) are not. The report surfaces this asymmetry explicitly via
  per-population sample counts, never blending it into one undifferentiated total.
- **Content-agent-minutes honesty vs. AC readability tension**: reporting `notMeasured` for
  `cold`/`resume` content-agent-minutes (rather than a fabricated number) is the correct,
  non-fabricating choice, but it means the regenerated throughput doc's headline Prepare-duration
  number is wall time, not agent-minutes — a real, disclosed limitation of the current telemetry
  schema. Extending the schema to populate real `contentAgentMs` for cold/resume is explicitly out
  of this child's scope (see Non-goals).
- **`decision.createsContentGeneration`'s inverted semantics could be intentional and
  differently-scoped than assumed here** — this proposal treats `decision.kind` as the safer,
  unambiguous discriminator regardless, so a wrong assumption about *why* the field is inverted does
  not change the report's correctness, only removes one alternate (unused) data source.
- **Too few real samples produce a misleadingly precise-looking P50/P85** — mitigated by the
  explicit `insufficient-samples` default rather than silently reporting a distribution from 2-3
  points as statistically meaningful.
- **Interval-based overlap math is only as good as `admission.acquiredAt`/`recordedAtMs` fidelity** —
  both are wall-clock `Date.now()`-derived; clock skew across concurrent dispatches in different
  processes could in principle produce a spurious small overlap or gap. No distributed-clock
  mechanism exists in this repo to correct this; the report states numbers as observed, per its own
  "reported as-is, never suppressed" default.
- **Malformed-record tracing changes `computeCapacityReport`'s exclusions output shape relative to
  `queryTelemetryReport`'s silent-skip behavior** — a deliberate, flagged divergence (see Key design
  decisions), not an unintended mismatch between the two functions.

### Non-goals

Not implementing DIR-126-A through DIR-126-D's own mechanisms — this child only aggregates and
reports on their real output. Not a general-purpose analytics/dashboard system (persistent metrics
store, web view) — scoped specifically to the Prepare-stage capacity questions this task's AC names.
Not reopening DIR-126-D's frozen telemetry schema (schemaVersion 2) or modifying
`queryTelemetryReport`'s existing external behavior. Not extending `proposal-convergence.ts`'s
telemetry writer to populate real per-generation `contentAgentDispatchCount`/`contentAgentMs` for
`cold`/`resume` — that would touch a file outside this child's declared `## Touches` and the
charter's additive-read-only framing; a legitimate future follow-up (`gap-*` task), not this child's
scope. Not fixing `decision.createsContentGeneration`'s apparent semantic inversion in
`proposal-convergence.ts` — same reasoning. LOC/duration remain descriptive output only, never a
productivity target (restated from the parent's own Non-goals, binding here since this is the child
that produces the report).

### AC coverage (mapped to `tasks/DIR-126-E.md`'s existing Acceptance Criteria)

1. **Real, reachable CLI mode** — covered: `--capacity-report` added to the same `parseArgs`/direct-
   invocation dispatch block as the existing `--build`/`--metrics`/`--telemetry-report` modes,
   verified by grep/import-graph plus a live subprocess invocation test, both mirrors — not
   `--selftest`-only reachability.
2. **Reproducible aggregation over checked-in artifacts** — covered by `computeCapacityReport`'s
   field list above; every emitted field traces to a named record/receipt field, none synthesized;
   the pure function is unit-tested directly plus one `git diff`-visible real CLI run.
3. **Sample provenance real and traceable** — covered: the joined populations retain source
   `recordId`/`attemptId`/receipt path; `--out` JSON carries the raw sample-ID list, and the doc
   rewrite cites it directly.
4. **Duplicate-generation minutes mean real overlap** — covered by the interval-intersection design
   decision, unit tested against an overlapping pair, a sequential-retry pair, and a
   single-generation case (all three named in Requested action item 3).
5. **C efficiency measured separately** — covered, with the honest caveat above: `reuse-terminal`'s
   zero-content-agent claim is exact (schema-guaranteed `0`/`0`, trusted via `validateTelemetryRecord`
   rather than re-derived); a recomputed cacheable terminal's "wasted content-agent work" is reported
   via the `notMeasured`/wall-time-proxy rule when `contentAgentMs` is `null`, not a fabricated exact
   number — this proposal recommends the AC wording be read (or amended during review/adjudication)
   to accept that honest reading rather than assuming an exact minutes value the schema cannot
   currently produce.
6. **Feedback-efficiency inputs exported, Prepare-scoped** — partially covered by fields already in
   scope (cold/resume/reuse-terminal minute *distributions* where measurable, `absorbed-task/
   prepare-hour`); token counts, if present in the schema at all, and finding-novelty/recurrence
   (likely sourced from DIR-125 finding-ledger fields, `milestones/*/proposal-ledger.json`) are
   **not confirmed present/fully re-verified in this pass** — flagged as a genuine open item for
   Plan/Build to resolve, not asserted here as already-solved. It does not claim end-to-end verified
   value or an Execute escape rate from Prepare-only evidence.
7. **Machine-readable report preserves raw IDs/strata/exclusions/unknowns** — covered by the `--out`
   JSON schema itself (not just printed/logged output), consumed later without scraping prose.
8. **Insufficient-sample honesty** — covered by the `< minSamples` default-table row, unit tested
   with exactly 2 samples; no existing precedent for this pattern reused elsewhere in the scripts
   directory (grepped — none), so this is fresh, self-contained logic.
9. **Mirror byte-identity** — covered by the existing `sync-vendor.sh --check`/`cmp` mechanism,
   unchanged, re-run as part of this child's own Verify.

### Alternatives considered and rejected

- **Require telemetry/receipt pairing as a hard precondition for any statistic.** Rejected —
  falsified by direct inspection: 0/8 committed receipts currently have a paired telemetry record,
  so a pairing requirement would report `insufficient-samples` against the entire real historical
  baseline this task is supposed to characterize, not just the narrow "post-D telemetry" window.
- **Extend `queryTelemetryReport` in place to also aggregate**, instead of adding a new function.
  Rejected: it is `milestoneId`-scoped by contract and its callers depend on that exact single-
  milestone return shape and its current silent-skip malformed-record behavior; changing it would
  violate this task's own Compatibility bar ("no existing check changes shape or becomes stricter").
- **Fabricate/estimate content-agent-minutes for `cold`/`resume` from wall time via a fixed ratio**
  (e.g. "assume 80% of wall time is content-agent time"). Rejected: exactly the kind of invented-
  precision number the task's own "savings are not fabricated" principle forbids; an honest
  `notMeasured` bucket plus a clearly-labeled `wallTimeProxyMinutes` (never named `contentAgentMs`)
  is more defensible and matches the existing `estimatedAvoidedAgentMinutes: "unknown"` precedent.
- **Trust `decision.createsContentGeneration` as written.** Rejected after direct code reading
  showed it inverted relative to its apparent name; using it would silently misclassify `cold` (the
  majority real-world case) as "no content generation," corrupting the headline `prepared/attempt`
  and content-generation-count metrics.
- **Add a general glob-matching dependency (`minimatch`/`fast-glob`) or use `fs.globSync`.**
  Rejected: the one real use case is a fixed `<root>/**/*.json` shape; a new dependency or a
  Node ≥22.13-only stdlib API (below this repo's declared Node-20 packaging floor) buys nothing over
  a simple string split plus the already-existing recursive walk.
- **Reimplement `queryTelemetryReport`'s traversal from scratch inside the new aggregation
  function** (simpler to write, no refactor). Rejected: two independently-maintained directory
  walks over the same tree is exactly the "content living in two places" drift pattern this repo's
  CLAUDE.md calls out as a defect to fix at the source, not repeat.
- **Compute `absorbed-task/prepare-hour` from live `task_get`/`task_list` MCP queries** instead of
  checked-in `absorb-entry.md` presence. Rejected: violates the task's own "reads only checked-in
  artifacts... never Claude Code session JSONL" bar extended consistently — a live provider query is
  a non-reproducible, non-checked-in data source that a later reader re-running the same command
  against the same commit could get a different answer from; `absorb-entry.md` presence is
  git-pinned and reproducible.
- **Parse Claude Code session JSONL (`~/.claude/projects/**.jsonl`) directly** for finer-grained
  timing. Rejected outright: violates the explicit "no session JSONL parsing" bar this task's own
  Key design decisions restate from DIR-126-D's precedent, and session logs are not checked-in,
  reproducible artifacts.
- **A telemetry schema change adding explicit wall-clock start/end fields.** Rejected as
  unnecessary — `admission.acquiredAt` and `recordedAtMs` already support the required interval math
  without reopening DIR-126-D's frozen `schemaVersion: 2`, which this task's Non-goals bars.
- **Live, scheduler-integrated overlap detection** (enforcing/blocking at dispatch time rather than
  reporting after the fact). Rejected: that is DIR-126-A's already-landed concurrency-control job;
  this child is read-only reporting over historical artifacts, not a second enforcement point.
- **Hand-edit the throughput doc's numbers from session-transcript recollection**, skipping a real
  command run. Rejected: defeats the entire purpose of this child, which exists specifically because
  DIR-126's own Finding showed the current doc has no real supporting measurement.

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
- [ ] **C efficiency is measured separately:** an identical hash/policy cacheable terminal that is
  recomputed increments `unchangedTerminalRecomputations` and observed wasted content-agent work;
  a correct `reuse-terminal` increments the hit count and records zero content agents. Estimated
  avoided minutes are either reproducibly labeled/model-derived or `unknown`.
- [ ] **Feedback-efficiency inputs are exported, Prepare-scoped:** the report includes
  cold/resume/reuse-terminal agent-minute and token distributions, finding novelty/recurrence,
  recurrence waste, and the raw numerator/denominator fields needed to compute Prepare escape rate
  later. It does not claim end-to-end verified value or an Execute escape rate from Prepare-only
  evidence.
- [ ] The machine-readable report preserves raw sample IDs, stage/terminal strata, exclusions, and
  unknowns so a later Prepare-to-post-Land evaluation can consume it without scraping the
  regenerated prose document.
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
  wired and verified as described above.

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
