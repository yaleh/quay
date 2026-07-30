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

### Problem framing (verified live against the current tree, 2026-07-30)

- `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` §4 (lines ~108-124) states a
  flat "**15-25 minutes**" Prepare planning range, sourced from exactly one real observation (DIR-117,
  22m 21s), folded into "≈85-95 minutes per task." No distribution, sample count, or provenance
  anywhere in the document. Confirmed by direct read; not carried over from any other source.
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` is 587 lines, confirmed
  **byte-identical** to `plugin/scripts/milestone-preparation-check.ts` (`diff` empty, re-run live).
  `grep -n "capacity-report\|P50\|P85"` returns zero matches — no aggregation mode exists today. The
  file already exports `queryTelemetryReport({workspace, milestoneId})` (line 159, CLI-wired at
  `--telemetry-report <milestoneId>`), which recurses `milestones/prepare-telemetry/**/*.json` via an
  inline `walk()` (line 162), filters to one `milestoneId`, and returns matching records raw. It
  **silently drops malformed JSON with a bare `catch {}`** and computes no percentiles, ratios, or
  waste classes — a materially weaker bar than what real aggregation requires.
- `milestones/prepare-telemetry/DIR-126-E/` currently holds **two** real `schemaVersion: 2` records
  (`2a107fcb5cc9.json`, `2b801a8792aa.json`), both `taskId: "DIR-126-E"`, `milestoneId: "M204"`,
  `decision.kind: "cold"`, `contentAgentDispatchCount: null`, `contentAgentMs: null`, and both
  terminating `needs-human` / `split-recommended` at `ProposalReview`. Both are this very task's own
  prior generations writing their own telemetry — direct, in-session confirmation that DIR-126-D's
  telemetry writer fires reliably in live dispatch. Two samples is still short of this task's own
  ≥3-sample DoD bar, and both share the identical terminal — the eventual real sample set needs
  terminal-shape diversity, not just count. **Notably, two independent prior generations of this
  exact task both recommended `split` at ProposalReview** — a live signal this proposal must not
  paper over (see Risks).
- Direct inspection of all 8 currently-committed `milestones/M*/preparation.json` receipts (M192,
  M195, M197, M198, M200, M201, M202, M203), re-run live via a small Node script reading each
  receipt's `.convergence` and `.telemetryFile` fields, confirms: a non-null `convergence` block is
  present for M192, M195, M198, M200 and absent (`null`) for M197, M201, M202, M203; **`telemetryFile`
  is `undefined` on all 8** — zero of the historical receipts pair with a telemetry record. A design
  that requires telemetry↔receipt pairing as a precondition for any statistic would report
  `insufficient-samples` against the *entire* real M192-M203 baseline, not merely the "post-D" window
  — this rules out "pairing required" as a viable design.
- `computeConvergenceMetrics` (`proposal-convergence.ts:188`, exported) is already reused by
  `computeMetricsForReceipt` (`milestone-preparation-check.ts:118`) to derive
  `prepareWallTimeMs`/`proposalReviewRounds`/`blockingFindingYield`/`proposalChurnRatio` from a
  receipt's own `convergence.{startedAtMs,endedAtMs}` — a second, telemetry-independent, already-
  working source of Prepare wall time for the 4 convergence-bearing receipts, confirmed live.
- **A concrete correctness trap in that receipt-side data, found by direct inspection**: of the 4
  convergence-bearing receipts, M192 and M195 both have `startedAtMs === endedAtMs`
  (`1785238767187`/`1785238767187` and `1785256169477`/`1785256169477` respectively) — a degenerate
  placeholder where the interval field was never actually populated with distinct times, not a
  genuine near-instant Prepare run. M198 and M200 have real, distinct intervals
  (`1785301300000→1785314458203`, `1785329024996→1785330281481`). This matters acutely because
  **M195 is the exact receipt DIR-126's own parent Finding measured at ~80 real minutes (57 of them
  PlanCheck)** — naively trusting `endedAtMs - startedAtMs` for M195 would report `0ms` for the
  slowest documented real generation on record, directly contradicting the reason this child exists.
- `decision.createsContentGeneration` is written as `kind === "resume"` (`proposal-convergence.ts:664`,
  and directly visible in both live DIR-126-E records: `kind: "cold"` pairs with
  `createsContentGeneration: false`) — **true only for `resume`, false for `cold`**, backwards from
  what the field's name suggests to a naive reader. Both `cold` and `resume` dispatch real content
  agents; an aggregator must derive "content-generation attempt" from `decision.kind ∈ {cold,
  resume}` directly, never from this field.
- `contentAgentDispatchCount`/`contentAgentMs` are `null` (not `0`) for `cold`/`resume` records under
  the currently-landed schema (confirmed in both live DIR-126-E records, and by reading
  `_writeCommittedTelemetry`'s call site at `proposal-convergence.ts:665`); only `reuse-terminal`
  (`~line 577`, guaranteed `0`/`0`) and pre-lease `not-evaluated` sites (`~line 751`, also `0`/`0`)
  get an explicit `0`. `validateTelemetryRecord` (`proposal-convergence.ts:430`) enforces this at
  write time: a `reuse-terminal` record failing `contentAgentDispatchCount===0 &&
  contentAgentMs===0` is rejected with `{ok:false, code:"reuse-terminal-invalid"}`
  (`proposal-convergence.ts:462-464`). Collapsing `null` into `0` would misreport "zero mechanical
  work" for records where the value was simply never captured.
- `CACHEABLE_TERMINALS` is `export const` at `proposal-convergence.ts:247` — confirmed live as
  `[{terminalPhase:"PreflightContent",reason:"preflight-rejected"}, {terminalPhase:"ProposalReview",
  reason:"split-recommended"}]` — the exact allowlist `decideResumeGeneration` uses to decide
  `reuse-terminal` eligibility. `milestone-preparation-check.ts` already imports three named exports
  from the same module (`proposal-convergence.ts`) at line 26, so importing this fourth is a
  same-shape addition, not a new cross-module coupling.
- `milestones/*/absorb-entry.md` is a real, pre-existing, checked-in convention recording a
  milestone's ABSORB outcome — usable as the "this task actually landed" signal without a live
  provider/task-store query.

In short: no code anywhere aggregates capacity statistics across telemetry+receipt artifacts today;
the throughput doc's flat number has zero supporting distribution; and the two real data sources
(telemetry, receipts) have complementary, only-partially-overlapping coverage — a correct design must
join them best-effort, never require pairing, or it silently discards the entire real historical
baseline this child exists to characterize.

### Chosen mechanism

Add one new, purely additive `--capacity-report [--telemetry-glob '<root>/**/*.json']
[--workspace <dir>] [--exclusions <file.json>] [--min-samples N] [--out <file>]` CLI mode to
`milestone-preparation-check.ts` (+ byte-identical `plugin/scripts/` mirror), following the file's
existing sequential top-level-`if` dispatch shape (the `--build`/`--metrics`/`--telemetry-report`
branches are independent `if` blocks, not an `else if` chain — a new branch matches that convention,
not a new invocation pattern), backed by one new pure exported function `computeCapacityReport({
workspace, telemetryGlob, exclusions, minSamples })`.

Design, in order of load-bearing importance:

1. **Two independent sample populations, joined best-effort — pairing is never required.**
   - *Telemetry population*: files under `milestones/prepare-telemetry/**/*.json`
     (`--telemetry-glob` overridable), walked by a new shared low-level `_walkJsonFiles(root)`
     helper — pure directory recursion, factored out of `queryTelemetryReport`'s existing inline
     `walk()` so both call sites share one traversal primitive instead of two independently
     maintained copies. Each caller keeps owning its own per-file handling:
     `queryTelemetryReport`'s parse-and-silently-skip contract is untouched (regression-tested by
     re-running an existing `--telemetry-report` fixture before/after and diffing output);
     `computeCapacityReport` instead captures `{path, record|null, parseError|null}` per file and
     turns a parse failure into a traced `exclusions[]` entry (`reason: "malformed-json"`). Every
     parsed record is run through the existing, reused `validateTelemetryRecord`; a validation
     failure (including a `reuse-terminal` invariant violation) becomes an `exclusions[]` entry
     carrying the validator's own `{code, message}` — never silently included.
   - *Receipt population*: every `milestones/M*/preparation.json` under `--workspace` (default `.`)
     with a non-null `.convergence` block, fed through the existing, reused `computeConvergenceMetrics`
     (via `computeMetricsForReceipt` — not a second derivation) for `prepareWallTimeMs` and the
     related churn/round fields. A receipt with no `.convergence` (M197/M201/M202/M203, confirmed
     live) is excluded from wall-time stats and tagged `"no-convergence-block"`, not treated as an
     error. A receipt WITH `.convergence` where `startedAtMs === endedAtMs` (confirmed live for M192
     and M195) is likewise excluded from wall-time stats, tagged `"convergence-interval-degenerate"`
     — this guard fires only on exact equality of both finite fields, never on a merely-short-but-
     distinct interval, so a real fast Prepare run is never wrongly discarded.
   - The two populations join best-effort on `(taskId, milestoneId)` where both sides have a match;
     an unpaired record on either side still contributes fully to its own population's stats. This
     directly follows from the confirmed fact that 0/8 committed receipts pair with any telemetry
     record today — a hard-pairing design would be vacuous against all existing real history.
2. **Percentiles** via one small shared pure `percentile(sortedNumbers, p)` helper, applied to
   receipt-side wall time, telemetry-side wall time (`recordedAtMs - admission.acquiredAt`, both
   fields confirmed present on the live records), and — where measurable — agent-minutes; broken
   down by `class` / `highRisk` / terminal `{phase,reason}` / `decision.kind` (`not-evaluated` its
   own bucket, never folded into `cold`).
3. **Content-generation discriminator is `decision.kind ∈ {cold, resume}`**, never
   `decision.createsContentGeneration` (confirmed inverted above, and both live DIR-126-E records
   would be misclassified as "no content generation" if the field were trusted as named).
   `eligible` = `decision.kind ∈ {cold, resume, reuse-terminal}`; `attempt` = every well-formed
   record read, including `not-evaluated`.
4. **Content-agent work reported in three explicit, never-blended buckets**: `measuredZero`
   (`reuse-terminal`/`not-evaluated`, write-time-guaranteed `0`/`0`, trusted not re-derived);
   `notMeasured` (`cold`/`resume` where both fields are `null` under the currently-landed schema —
   emitted as `null`/`"not-measured"`, never coerced to `0`); and an explicitly-labeled
   `wallTimeProxyMinutes` (`recordedAtMs − admission.acquiredAt`) as an optional supplementary
   number, never presented under the `contentAgentMs` name.
5. **`prepared/attempt` ratio**, with the acquired/eligible-content-generation denominator shown
   alongside so contention/reuse attempts don't obscure the interpretation; **terminal/decision
   yield by reason** (prepared, split/preflight-recommended, terminal-reused, transient failure).
6. **`absorbed-task/prepare-hour`**: numerator = distinct `taskId`s whose milestone directory has
   both `preparation.json` and `absorb-entry.md`; denominator = summed `prepareWallTimeMs` from
   `computeConvergenceMetrics` across those same receipts. This avoids the vacuous-pairing trap
   directly: it is receipt-derived only, never requiring a paired telemetry record. Any of those
   receipts lacking `.convergence` is excluded from the denominator, not treated as zero-duration.
7. **Concurrent duplicate-generation minutes**: for telemetry records sharing `(workspace, taskId)`,
   build `[admission.acquiredAt, recordedAtMs]` intervals (both required non-null; a record missing
   either is excluded from overlap analysis specifically — `"interval-fields-missing"` — but still
   counted in decision/agent-work stats). Sum only pairwise intersection; a sequential retry that
   starts after the prior terminal contributes exactly zero.
8. **Unchanged-stable-terminal recomputation**: group telemetry records by `(taskId,
   hashes.{charter,taskContract,proposal,reviewPolicy})`, classify `terminal.{phase,reason}` as
   cacheable via the imported `CACHEABLE_TERMINALS`. When ≥2 records in the same group share a
   cacheable terminal and the later one has `decision.kind !== "reuse-terminal"`, count it as an
   avoidable recomputation and sum its `contentAgentMs` when non-null (else route to the
   `notMeasured`/proxy accounting — never a fabricated exact number). The two live DIR-126-E
   records are a real, in-hand instance of this exact terminal shape (same `taskId`, same cacheable
   `ProposalReview`/`split-recommended` terminal, second record's `decision.kind` is `"cold"` not
   `"reuse-terminal"`) but are confirmed live to have differing `hashes.proposal` and
   `hashes.taskContract` (charter and reviewPolicy hashes match; task/proposal content changed
   between rounds) — so they do **not** actually group under exact-hash equality. This is the exact
   trap the grouping key must resist: the aggregator must not loosen `hashes.*` matching to "same
   terminal regardless of hash," or every genuine content revision would be misreported as wasted
   recomputation.
9. **`estimatedAvoidedAgentMinutes`** computed only when a comparable, same-`class`/`highRisk`,
   non-`reuse-terminal` sample population exists to derive a labeled, reproducible median from;
   otherwise the literal string `"unknown"`.
10. **Sample-count gate**: total eligible samples (telemetry ∪ receipt, post-exclusion) below
    `--min-samples` (default 3) → `{"code":"insufficient-samples", sampleCount, sampleIds, ...}`, no
    P50/P85 emitted. Per-population counts are always reported separately, never blended into one
    combined total that could hide a thin population behind a fatter one.
11. **Exclusions unified and always reasoned**: malformed JSON, `validateTelemetryRecord` failures
    (validator's own code), `interval-fields-missing`, `no-convergence-block`,
    `convergence-interval-degenerate`, and caller-supplied `--exclusions <file.json>` entries
    (`{id, reason}` matched against `recordId`/`attemptId`/receipt path — covers documented fixture
    recoveries such as DIR-126-A's `--force-release` cases) — combined into one `exclusions[]`
    array, each entry carrying an `id` and a `reason`. Nothing is ever dropped silently.
12. `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` §4 is hand-edited to
    replace the flat "15–25 minutes"/"22m 21s" text with the reproduced P50/P85, sample count,
    sample-ID list, and an explicit exclusions note — copy-pasted from a real command run's `--out`
    JSON. The doc stays readable prose (not templated/auto-generated); every number in it traces to
    a real, checked-in command output, never to session recollection.

No new write path into `milestones/prepare-telemetry/` or `.quay/prepare-leases/` — the whole mode is
read-only over both trees, matching the charter's "additive, read-only aggregation" framing and the
"Why not highRisk" section.

### Concrete control/data flow

```
CLI: node milestone-preparation-check.ts --capacity-report
       [--telemetry-glob 'milestones/prepare-telemetry/**/*.json']
       [--workspace .] [--exclusions exclusions.json] [--min-samples 3] [--out report.json]
   │
   ├─ _walkJsonFiles(telemetryRoot)         [shared recursion; factored out of queryTelemetryReport's
   │                                          inline walk() — each caller still parses/handles errors
   │                                          independently, so queryTelemetryReport's own behavior
   │                                          is unchanged]
   │     → per file: {path, record|null, parseError|null}
   │        parseError                        → exclusions[] "malformed-json"
   │        validateTelemetryRecord() fails    → exclusions[] (validator's own {code,message})
   │        ok                                 → telemetry sample population
   ├─ walk milestones/M*/preparation.json; for each with non-null .convergence:
   │        computeMetricsForReceipt → computeConvergenceMetrics(...)   [REUSED, no 2nd derivation]
   │        no .convergence block               → excluded, "no-convergence-block"
   │        startedAtMs === endedAtMs (both finite) → excluded, "convergence-interval-degenerate"
   ├─ join telemetry + receipt populations by (taskId, milestoneId), BEST-EFFORT — an unpaired
   │     record on either side still contributes to its own population's stats
   ├─ apply --exclusions file entries (id/reason) on top of the above
   ├─ import { CACHEABLE_TERMINALS } from proposal-convergence.ts    [not a hand-copied literal]
   ├─ classify: decision.kind ∈ {cold,resume} = content-generation attempt (NOT
   │     decision.createsContentGeneration, confirmed inverted); route agent-work numbers into
   │     measuredZero / notMeasured / wallTimeProxyMinutes buckets
   ├─ percentile() over each in-scope numeric field; interval-intersection over
   │     [admission.acquiredAt, recordedAtMs] pairs for overlap; hashes.*+cacheable-terminal
   │     grouping for recomputation waste (all pure, unit-testable functions)
   ├─ absorbed-task/prepare-hour: count(receipts with preparation.json ∧ absorb-entry.md) /
   │     (sum of computeConvergenceMetrics wall-time hours over those same receipts)
   └─ eligible sample count (per-population AND combined) < --min-samples?
        → {code:"insufficient-samples", sampleCount, sampleIds, ...}
        else → {code:"ok", sampleCount, exclusions[], p50/p85 by stratum, ratios, waste-classes}
        console.log(JSON.stringify(report)); --out writes the same JSON; exit 0 in both cases
        (insufficient-samples is a normal, successful report, not a usage failure); exit 2 only
        on a hard usage/environment error (bad --telemetry-glob shape, unparsable --exclusions
        JSON, unreadable --workspace)
   │
   ▼ (human/agent regenerates by hand, citing the --out JSON's real sample IDs)
docs/proposals/quay-milestone-workflow-throughput-capacity-model.md §4 rewritten
```

**Mechanism-claim wiring coverage (DIR-117) — every new call/dispatch/ownership/enforcement
relationship claimed above, flagged explicitly for AC-level proof, not left as prose assertion:**

- CLAIM: `--capacity-report` is a real, reachable CLI branch on `milestone-preparation-check.ts`
  (both the canonical file and the `plugin/scripts/` mirror), dispatched the same way as the
  existing `--build`/`--metrics`/`--telemetry-report` branches → needs grep/import-graph evidence
  PLUS a live subprocess invocation test (not `--selftest`-only reachability).
- CLAIM: `_walkJsonFiles` is one shared recursion primitive used by both `queryTelemetryReport` and
  `computeCapacityReport` → needs a fixture/call-count or source-inspection assertion showing a
  single traversal implementation, not two independently written directory walks.
- CLAIM: `computeCapacityReport` calls the existing `validateTelemetryRecord` (reused, not
  reimplemented) → needs a test asserting a schema-invalid telemetry fixture record lands in
  `exclusions[]` carrying the validator's own `{code, message}`.
- CLAIM: `computeCapacityReport` derives wall time via `computeConvergenceMetrics`/
  `computeMetricsForReceipt` (not a second, independent derivation) → needs a test asserting the
  reported `prepareWallTimeMs` for a fixture receipt matches `computeMetricsForReceipt`'s own output
  for that identical receipt.
- CLAIM: `computeCapacityReport` imports `CACHEABLE_TERMINALS` from `proposal-convergence.ts` (not a
  duplicated literal) → needs a fixture that mutates an entry in the real `CACHEABLE_TERMINALS` and
  observes `computeCapacityReport`'s recomputation classification pick up the same change.
- CLAIM: telemetry and receipt populations are joined best-effort, never required-paired → needs a
  test asserting a receipt-only sample (no matching telemetry) still contributes wall-time stats,
  AND a telemetry-only sample (no matching receipt) still contributes decision/agent-work stats.
- CLAIM: `queryTelemetryReport`'s existing external behavior (including silent-skip-on-malformed-
  JSON) is unchanged by the `_walkJsonFiles` extraction → needs a regression test re-running an
  existing `--telemetry-report` fixture and diffing output byte-for-byte before/after.
- CLAIM: `sync-vendor.sh --check`/`cmp` keeps the `plugin/scripts/` mirror byte-identical after this
  change → covered by the existing mirror-parity AC item; no new sync mechanism is invented.
- CLAIM: `absorbed-task/prepare-hour`'s numerator is a checked-in file-presence signal, not a live
  task-store/MCP query → needs a fixture asserting the count changes when an `absorb-entry.md` file
  is added/removed on disk, with zero MCP/provider calls made during the computation.
- CLAIM: the `convergence-interval-degenerate` guard fires only on exact `startedAtMs===endedAtMs`
  equality, never on a short-but-distinct interval → needs a fixture pairing (both fields equal →
  excluded) against (fields one ms apart → included) to prove the boundary, since this is the exact
  trap that would otherwise silently zero out M195's real ~80-minute Prepare in aggregate stats.

### Key design decisions

- **Two independent sample populations, best-effort joined — never pairing-required.** The single
  most consequential decision, directly forced by the confirmed 0/8 telemetry↔receipt pairing rate.
  Resolves in favor of a receipt-only wall-time denominator for `absorbed-task/prepare-hour` (via
  `computeConvergenceMetrics`), which needs no pairing that does not yet exist.
- **`decision.kind`, not `decision.createsContentGeneration`, is the content-generation
  discriminator** — direct code reading plus both live DIR-126-E records confirm the latter is
  inverted relative to its apparent name. Routing around a landed field's surprising semantics
  (rather than "fixing" it, which is out of this child's `## Touches` — it lives in
  `proposal-convergence.ts`) is the lower-risk choice for a read-only reporting child.
- **Traversal, the cacheable-pair allowlist, record validation, and receipt-wall-time derivation are
  all imported/reused, never duplicated**: `_walkJsonFiles` shared with `queryTelemetryReport`
  (recursion only, so `queryTelemetryReport`'s external contract stays provably unchanged);
  `validateTelemetryRecord` and `computeConvergenceMetrics`/`computeMetricsForReceipt` reused as-is;
  `CACHEABLE_TERMINALS` imported by name. Two independently maintained copies of any of these would
  silently drift the next time DIR-126-C/D's own logic changes on this file — the "content living
  in two places" defect class this repo's CLAUDE.md names explicitly.
- **`null` vs `0` for content-agent fields is preserved, never coerced** — confirmed by direct read
  of the write path and by both live records (`null`/`null` for `cold`). Coercing to `0` would
  misreport "mechanical work only" for records where content-agent work was simply never captured
  under the current schema. The task body's own AC wording ("mechanical-runner versus content-
  generation agent dispatch counts/minutes") is read here to permit an honest `notMeasured` bucket
  plus a distinctly-named `wallTimeProxyMinutes`, rather than requiring a directly-measured minutes
  value the landed schema cannot currently supply for `cold`/`resume`.
- **`convergence-interval-degenerate` is a distinct exclusion reason from `no-convergence-block`**,
  scoped narrowly to exact-equality — this is the specific guard that keeps M195 (the receipt behind
  this whole child's founding Finding) from silently reporting `0ms` once real aggregation exists.
- **The unchanged-terminal recomputation grouping key is `hashes.*` equality, never terminal-shape
  equality alone** — confirmed live that the two DIR-126-E telemetry records share a cacheable
  terminal but differ on `hashes.proposal`/`hashes.taskContract`, so they must NOT be counted as a
  recomputation pair. Loosening the key to "same terminal regardless of hash" would misclassify
  every legitimate content revision as wasted work.
- **Concurrency overlap and unchanged-input recomputation are two separate waste-class passes**, not
  one combined heuristic — overlap is interval intersection on `[acquiredAt, recordedAtMs]`
  (missing either field excludes that record from overlap analysis only, never zero-duration by
  default); recomputation is identical `hashes.*` plus a repeated cacheable terminal. Conflating them
  would misattribute one waste class's cost to the other.
- **No new glob dependency** — `--telemetry-glob` supports exactly the fixed `<root>/**/*.json`
  shape via a string split on `/**/`, not a general glob engine or `fs.globSync` (Node ≥22.13-only,
  below this repo's declared Node-20 packaging floor).
- **No telemetry schema change** — `admission.acquiredAt`/`recordedAtMs` already support interval
  math on both live records; DIR-126-D's frozen `schemaVersion: 2` stays untouched.
- **Savings are never fabricated** — `reuse-terminal`'s zero-agent-work claim is exact and schema-
  guaranteed; `estimatedAvoidedAgentMinutes` is `"unknown"` unless a real, labeled, reproducible
  comparable sample population exists.
- **The throughput-doc rewrite stays a manual, human/agent-authored prose edit** citing the real
  `--out` JSON, not an automated markdown-templating step — keeps §4 readable while the JSON output
  remains the traceable source of truth.

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| Fewer than `--min-samples` (default 3) eligible samples (telemetry ∪ receipt, post-exclusion) | `{"code":"insufficient-samples", sampleCount, sampleIds}`, per-population and combined — no P50/P85 |
| Telemetry record fails `JSON.parse` | excluded, `reason: "malformed-json"`, path + parse error recorded |
| Telemetry record fails `validateTelemetryRecord` (incl. a `reuse-terminal` invariant violation) | excluded, `reason` = the validator's own code (e.g. `"reuse-terminal-invalid"`) |
| Record/receipt id listed in `--exclusions` | excluded, `reason` = the caller-supplied reason string |
| Record missing `admission.acquiredAt` or `recordedAtMs` | excluded from overlap analysis only (`"interval-fields-missing"`); still counted in decision/agent-work stats |
| `contentAgentDispatchCount`/`contentAgentMs` both `null` (cold/resume, current schema) | reported `null`/`"not-measured"`, never coerced to `0` or to the proxy value |
| Two generations' intervals for the same `(workspace, taskId)` overlap | reported as real, non-zero concurrent-duplicate minutes, never suppressed |
| A sequential retry's interval starts after the prior terminal | zero concurrent-duplicate minutes; still checked for unchanged-terminal recomputation |
| Identical `hashes.*` + cacheable pair recurs without a `reuse-terminal` hit | counted as `unchangedTerminalRecomputations`; wasted work via measured value or `notMeasured`/proxy, never fabricated |
| No comparable real sample for an avoided-minute counterfactual | `estimatedAvoidedAgentMinutes: "unknown"` |
| A receipt has no `.convergence` block (M197/M201/M202/M203) | excluded from wall-time stats and the `absorbed-task/prepare-hour` denominator, not treated as zero-duration |
| A receipt's `.convergence.startedAtMs === .convergence.endedAtMs` (M192, M195) | excluded from wall-time stats, `reason: "convergence-interval-degenerate"` — never a fabricated `0ms` sample |
| `--telemetry-glob` doesn't match `<root>/**/*.json`, malformed `--exclusions` JSON, or unreadable `--workspace` | hard usage error, exit 2, matching this file's existing `parseArgs` error convention |
| Zero eligible samples at all (both populations empty) | same `insufficient-samples` path as the < min-samples case; exit 0, not an error |

### Compatibility

Purely additive: one new CLI mode plus one new exported function on the existing, already-587-line
script (mirrors confirmed byte-identical live via `diff`). `checkPreparation()` — the function the
`Prepared` gate actually calls — is untouched; nothing in this proposal alters its control flow.
`queryTelemetryReport()`'s external behavior (CLI flag, input, output shape, silent-skip-on-
malformed-JSON) is unchanged; only its internal recursion is factored into the shared
`_walkJsonFiles` helper, verified by an explicit before/after regression test. Both
`experiments/quay-perpetual-stream/scripts/` and `plugin/scripts/` copies stay byte-identical via the
existing `sync-vendor.sh` mechanism (confirmed identical live, no new sync path). No existing check
changes shape or becomes stricter, matching the charter's "why not highRisk" framing.

### Risks

- **The ≥3-real-sample DoD bar is structurally gated on this child's own further dispatch plus other
  real work landing.** Two real telemetry records now exist for `DIR-126-E` (confirmed live), both
  short of 3 and both sharing the identical `ProposalReview`/`split-recommended` terminal — the DoD
  additionally wants "different terminal shapes," which two identical-terminal records do not
  satisfy on their own. Code and unit tests (synthetic fixtures) can be written and reviewed now; the
  real `--capacity-report` regression proof and doc regeneration should wait until the sample bar
  (count AND shape diversity) is realistically reachable, per the charter's own explicit steering.
- **Two consecutive real prior generations of this exact task both terminated `split-recommended` at
  ProposalReview.** Examined honestly, this proposal's ~12-item mechanism and its AC items are
  sub-facets of ONE pure aggregation function (`computeCapacityReport`) over two joined artifact
  populations, not independently shippable increments — dropping any one item (e.g. percentiles
  without exclusions, or overlap detection without the recomputation check it structurally needs for
  correct interpretation) would produce a report that is silently wrong or misleading in exactly the
  way this child exists to prevent. The one genuinely separable seam (the `--capacity-report` code
  vs. the doc-regeneration edit) is already reflected as two distinct Requested-action items, not
  merged. A task named `gap-prepare-milestone-split-decision-no-finality` is already filed
  (`status: todo`, unrelated to this child's own scope) and a charter file
  (`experiments/quay-perpetual-stream/charters/M206-gap-split-decision-finality.md`) already exists
  documenting that a mechanical split-decision signal from a cold LLM reviewer (a scalar
  `mechanismCount` self-report observed oscillating non-monotonically, 8/8/4/6, across otherwise-
  similar review rounds) is itself noisy and non-monotonic — that filed gap is offered as
  corroborating evidence that repeated `split-recommended` verdicts on a structurally-single-function
  design are a known systemic-noise pattern, not by itself a standing objection this Proposal must
  further rebut beyond the structural single-function argument above. (No milestone directory for
  M206 exists yet, so this is cited as a filed, charter-drafted gap — not as a landed fix.) If a
  third generation of this task also recommends split, that should be weighed as a stronger signal
  than this Proposal currently treats it, not re-litigated identically a third time.
- **Telemetry-side decision/content-agent statistics may stay thin (2-3 samples) even once receipt-
  side wall-time statistics (4 existing convergence-bearing receipts) are not.** The report surfaces
  this asymmetry via separate per-population sample counts, never blended into one combined total.
- **Content-agent-minutes honesty vs. AC readability tension**: reporting `notMeasured` for
  `cold`/`resume` (rather than fabricating a number) means the regenerated doc's headline duration is
  wall time, not agent-minutes — a real, disclosed schema limitation. Extending the schema to
  populate real `contentAgentMs` for `cold`/`resume` is out of this child's scope.
- **Too few real samples produce a misleadingly precise-looking P50/P85** — mitigated by the explicit
  `insufficient-samples` default rather than reporting a distribution from 1-3 points as meaningful.
- **Interval-based overlap math depends on `admission.acquiredAt`/`recordedAtMs` fidelity** — both
  are wall-clock `Date.now()`-derived; clock skew across concurrent processes could in principle
  produce a spurious small overlap or gap. No distributed-clock correction exists in this repo; the
  report states numbers as observed, not corrected.
- **Malformed-record tracing changes `computeCapacityReport`'s exclusions output shape relative to
  `queryTelemetryReport`'s silent-skip behavior** — a deliberate, explicitly flagged divergence
  between the two functions, not an accidental mismatch.

### Non-goals

Not implementing DIR-126-A through DIR-126-D's own mechanisms — this child only aggregates and
reports on their real, already-landed output. Not a general-purpose analytics/dashboard system
(persistent metrics store, web view) — scoped to the Prepare-stage capacity questions this task's AC
names. Not reopening DIR-126-D's frozen telemetry schema (`schemaVersion: 2`) or changing
`queryTelemetryReport`'s existing external behavior. Not extending `proposal-convergence.ts`'s
telemetry writer to populate real per-generation `contentAgentDispatchCount`/`contentAgentMs` for
`cold`/`resume` — outside this child's `## Touches` and the charter's additive-read-only framing; a
legitimate future `gap-*` follow-up. Not fixing `decision.createsContentGeneration`'s apparent
semantic inversion in `proposal-convergence.ts` — same reasoning. LOC/duration remain descriptive
output only, never a productivity target.

### AC coverage (mapped to `tasks/DIR-126-E.md`'s Acceptance Criteria)

1. **Real, reachable CLI mode** — covered: `--capacity-report` added to the same dispatch pattern as
   `--build`/`--metrics`/`--telemetry-report`, verified by grep/import-graph plus a live subprocess
   invocation test, both mirrors — not `--selftest`-only reachability.
2. **Reproducible aggregation over checked-in artifacts** — covered by `computeCapacityReport`'s
   field list; every emitted field traces to a named record/receipt field, none synthesized; unit
   tested plus one real `git diff`-visible CLI run.
3. **Sample provenance real and traceable** — covered: both populations retain source
   `recordId`/`attemptId`/receipt path; `--out` JSON carries the raw sample-ID list; the doc rewrite
   cites it directly.
4. **Duplicate-generation minutes mean real overlap** — covered by interval intersection, unit
   tested against an overlapping pair, a sequential-retry pair, and a single-generation case.
5. **Content-agent efficiency measured separately (honest reading)** — covered:
   `reuse-terminal`'s zero-content-agent claim is exact and schema-guaranteed; a recomputed cacheable
   terminal's wasted work is reported as the exact value when `contentAgentMs` is non-null, else via
   the `notMeasured`/proxy rule, never fabricated.
6. **Feedback-efficiency inputs exported, Prepare-scoped** — partially covered: cold/resume/reuse-
   terminal minute distributions where measurable, `absorbed-task/prepare-hour`; token counts and
   finding-novelty/recurrence are **not confirmed present in the current telemetry schema** as of
   this proposal's own live check and are flagged as a genuine open item for Plan/Build, not asserted
   solved here. Does not claim end-to-end verified value or an Execute escape rate from Prepare-only
   evidence.
7. **Machine-readable report preserves raw IDs/strata/exclusions/unknowns** — covered by the `--out`
   JSON schema, consumable later without scraping prose.
8. **Insufficient-sample honesty** — covered by the `< minSamples` default-table row, unit tested
   with exactly 2 samples (the real current DIR-126-E count).
9. **Mirror byte-identity** — covered by the existing `sync-vendor.sh --check`/`cmp` mechanism,
   unchanged, re-run as part of this child's own Verify.
10. **`convergence-interval-degenerate` never silently reports `0ms`** — covered by a fixture built
    directly from the confirmed live M192/M195 shape (`startedAtMs===endedAtMs`) plus a
    genuinely-short-but-distinct-interval fixture proving the guard fires only on exact equality.
11. **`absorbed-task/prepare-hour` numerator is file-presence, never a live query** — covered by a
    fixture asserting the count changes when `absorb-entry.md` is added/removed on disk with zero
    MCP/provider calls made.

### Alternatives considered and rejected

- **Require telemetry/receipt pairing as a hard precondition for any statistic.** Rejected —
  falsified by direct inspection: 0/8 committed receipts currently pair with a telemetry record, so
  requiring pairing would report `insufficient-samples` against the entire real historical baseline
  this task exists to characterize.
- **Extend `queryTelemetryReport` in place to also aggregate**, instead of adding a new function.
  Rejected: it is contractually `milestoneId`-scoped, its callers depend on that exact single-
  milestone return shape and its current silent-skip malformed-record behavior; changing it would
  violate this child's own Compatibility bar.
- **Fabricate/estimate content-agent-minutes for `cold`/`resume` from wall time via a fixed ratio**
  (e.g. "assume X% of wall time is content-agent time"). Rejected: exactly the invented-precision
  this design's "savings are never fabricated" principle forbids; an honest `notMeasured` bucket plus
  a distinctly-labeled `wallTimeProxyMinutes` is more defensible and matches the existing
  `estimatedAvoidedAgentMinutes: "unknown"` precedent already in this design.
- **Trust `decision.createsContentGeneration` as written.** Rejected after direct code reading
  (confirmed live against both current DIR-126-E records) showed it inverted relative to its
  apparent name; trusting it would silently misclassify `cold` — the majority real-world decision
  kind — as "no content generation."
- **Add a general glob-matching dependency (`minimatch`/`fast-glob`) or use `fs.globSync`.** Rejected:
  the one real use case is a fixed `<root>/**/*.json` shape; a new dependency, or a Node ≥22.13-only
  stdlib API below this repo's Node-20 packaging floor, buys nothing over a simple string split plus
  the already-existing recursive walk.
- **Reimplement `queryTelemetryReport`'s traversal from scratch inside the new function.** Rejected:
  two independently maintained directory walks over the same tree is the exact "content living in
  two places" drift pattern this repo's CLAUDE.md calls out to fix at the source.
- **Compute `absorbed-task/prepare-hour` from live `task_get`/`task_list` MCP queries** instead of
  checked-in `absorb-entry.md` presence. Rejected: a live provider query is a non-reproducible data
  source; `absorb-entry.md` presence is git-pinned and reproducible, matching the "checked-in
  artifacts only" bar applied consistently elsewhere in this design.
- **Parse Claude Code session JSONL directly** for finer-grained timing. Rejected outright: violates
  the explicit no-session-JSONL-parsing bar this repo's process already establishes for this class of
  work, and session logs are not checked-in, reproducible artifacts.
- **A telemetry schema change adding explicit wall-clock start/end fields.** Rejected as unnecessary
  — `admission.acquiredAt`/`recordedAtMs` (confirmed present on both live records) already support
  the required interval math without reopening DIR-126-D's frozen `schemaVersion: 2`.
- **Live, scheduler-integrated overlap detection** (enforcing/blocking at dispatch time). Rejected:
  that is DIR-126-A's already-landed concurrency-control job; this child is read-only reporting over
  historical artifacts, not a second enforcement point.
- **Hand-edit the throughput doc's numbers from session-transcript recollection**, skipping a real
  command run. Rejected: defeats the entire purpose of this child, which exists specifically because
  DIR-126's own Finding showed the current doc has no real supporting measurement.
- **Split this child further** (e.g. percentiles-only vs. waste-classes-only as separate milestones),
  mirroring the two real `split-recommended` prior verdicts on this exact task. Considered seriously
  given the repeated live signal, but rejected on the same structural grounds DIR-126-D used for its
  own "Mechanism A" ruling: the ~12 mechanism items are interdependent facets of one aggregation
  function over two joined populations (e.g. duplicate-overlap detection is only correctly
  interpretable alongside the unchanged-terminal-recomputation check), not independently shippable
  increments — the one genuinely separable seam (the `--capacity-report` code vs. the doc-
  regeneration edit) is already reflected as two distinct Requested-action items, not merged.

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
  confirmed real by the same direct-source-read standard. Round-3 additionally flagged:
  `proposal-convergence.ts:430`, `proposal-convergence.ts:462-464` (distinct, as combined literal
  forms, from the separately-listed `proposal-convergence.ts`/`:462-464` tokens already covered
  above), `~line 577`, `~line 751`, `decision.kind !== "reuse-terminal"`, `notMeasured`,
  `computeCapacityReport`, `exclusions[]`, `{code, message}` — all confirmed real by the same
  direct-source-read standard as every round above.

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
