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

Replace the flat "**15–25 minutes**" Prepare-stage planning assumption in
`docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` §4 (confirmed live at lines
109–124, folded into "≈ 85–95 minutes per task", sourced from exactly one real DIR-117 observation,
"22m 21s", with no distribution, sample count, or provenance anywhere in the document) with a real,
reproducible, purely additive `--capacity-report` aggregation mode over the two artifact populations
DIR-126-D and its predecessors already produce and check in: `milestones/prepare-telemetry/**/*.json`
telemetry records and `milestones/M*/preparation.json` receipts. The mode reads ONLY checked-in
artifacts — never Claude Code session JSONL. This is the fifth and final child of DIR-126's 5-way
split; it depends on DIR-126-A/B/C/D being landed (`a0aba1f`/M200, `528897c`/M201, `8c9d114`/M202,
`6a24bf3`/M203) and, for the AC/DoD real-regression proof, on enough real post-D telemetry existing
to aggregate.

### Problem framing (independently re-verified against the live tree, 2026-07-30)

Every figure below was re-derived by direct source read / field extraction during this Proposal's
authoring, not copied from the prior task body — and the live numbers have already moved, which is
itself the strongest argument for a snapshot-agnostic design:

- `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` §4 states a flat "**15–25
  minutes**" folded into "≈ 85–95 minutes per task", from a single DIR-117 observation at "22m 21s" —
  no distribution, sample count, or provenance anywhere in the document. DIR-126's parent Finding
  measured M195's real Prepare at ~80 minutes (57 of them PlanCheck alone) — **3–5× the documented
  number** — and no checked-in command can reproduce or track it. Confirmed by direct read.
- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` is **587 lines**,
  byte-identical to `plugin/scripts/milestone-preparation-check.ts` (`diff -q` clean, re-run live).
  `grep -n "capacity-report\|P50\|P85\|percentile"` returns zero matches in either copy — **no
  aggregation mode exists today.**
- **The live telemetry population is a moving target, and this Proposal proves it.** Direct
  extraction of every field this design reads, run just now, shows `milestones/prepare-telemetry/`
  holds **10 real `schemaVersion: 2` records across 4 distinct task IDs** — `DIR-126-E` (4: 3×
  `ProposalReview/split-recommended`, 1× `PreflightContent/preflight-rejected`),
  `gap-dir126d-deferred-phase-timing-recurrence-tracking` (2: 1×
  `ProposalReview/wiring-coverage-check-failed`, 1× `ProposalReview/split-recommended`),
  `gap-prepare-milestone-split-decision-no-finality` (2× `ProposalReview/split-recommended`), and
  `gap-wiring-coverage-check-whose-own-and-bold-marker-splitting` (2×
  `ProposalReview/split-recommended`). This is **10 records, up from the 8 an earlier snapshot of
  this task recorded** — exactly the drift this design must tolerate, not pin. Across ALL 10:
  `decision.kind === "cold"`, `decision.createsContentGeneration === false`, and
  `contentAgentDispatchCount`/`contentAgentMs` are `null`; both `admission.acquiredAt` and
  `recordedAtMs` are non-null on every record, so a telemetry-side wall-time proxy `recordedAtMs −
  admission.acquiredAt` is computable for the entire current corpus. Three distinct terminal shapes
  already exist (`split-recommended` ×8, `preflight-rejected` ×1, `wiring-coverage-check-failed` ×1)
  — materially at the DoD's "≥3 different terminal shapes" bar — but the exact sample set used for
  the real regression proof MUST be captured at Execute time, never frozen here.
- **Zero `resume`/`reuse-terminal` records exist anywhere yet** (all 10 are `cold`). The DoD's "real
  `reuse-terminal` proof" clause and the C-efficiency AC item therefore have no live sample to cite
  today; the design handles this with an explicit honest-empty path (see Defaults) and flags it as a
  residual open item (Risks), never by fabricating a sample.
- Direct read of all 8 committed `milestones/M*/preparation.json` receipts (M192, M195, M197, M198,
  M200, M201, M202, M203) confirms: non-null `.convergence` on M192/M195/M198/M200, `null` on
  M197/M201/M202/M203; and **`telemetryFile === undefined` on all 8 — a 0/8 telemetry↔receipt pairing
  rate today.** A design that required pairing as a statistic precondition would report
  `insufficient-samples` against the entire M192–M203 baseline this child exists to characterize.
- **A confirmed correctness trap:** of the 4 convergence-bearing receipts, **M192 and M195 both have
  `startedAtMs === endedAtMs`** (`1785238767187` and `1785256169477` — degenerate placeholders),
  while M198 (`1785301300000→1785314458203`) and M200 (`1785329024996→1785330281481`) have real,
  distinct intervals. **M195 is the exact receipt DIR-126's parent Finding measured at ~80 real
  minutes**; naive subtraction would report `0ms` for the slowest documented real generation on
  record, directly undermining the reason this child exists.
- `milestones/*/absorb-entry.md` is a real, pre-existing, checked-in ABSORB-outcome convention
  present for **all 8** committed receipts (not only the 4 convergence-bearing ones) — a
  reproducible "this task actually landed" signal requiring no live provider/task-store query.

Source-level facts, each confirmed by direct read of the current tree (line numbers live as of
authoring):

- `queryTelemetryReport({workspace, milestoneId})` (`milestone-preparation-check.ts:159`) recurses
  `milestones/prepare-telemetry/` via an inline `walk()` closure (`:162`) and silently drops
  malformed JSON with a bare `catch {}` (`:172`); it computes no percentiles, ratios, or waste
  classes and is contractually `milestoneId`-scoped.
- `computeMetricsForReceipt({receiptFile})` (`:118`) already derives `prepareWallTimeMs` by
  delegating to the imported, exported `computeConvergenceMetrics` (`proposal-convergence.ts:188`;
  imported at `milestone-preparation-check.ts:26`) — a second, telemetry-independent,
  already-working wall-time source for the 4 convergence-bearing receipts.
- `decision.createsContentGeneration` is written `kind === "resume"` (`proposal-convergence.ts:664`)
  — `false` for `cold`, and all 10 live records are `cold`. The field is backwards from its name; an
  aggregator must derive "content-generation attempt" from `decision.kind ∈ {cold, resume}` directly.
- `contentAgentDispatchCount: null, contentAgentMs: null` are written for `cold`/`resume` (`:665`,
  confirmed on all 10 live records); only `reuse-terminal` (`:577`) and pre-lease `not-evaluated`
  (`:751`) write explicit `0`/`0`, and `validateTelemetryRecord` (`:430`, exported) fail-closed
  rejects a `reuse-terminal` record violating `contentAgentDispatchCount === 0 && contentAgentMs ===
  0` with `code: "reuse-terminal-invalid"` (`:462–464`). Collapsing `null` into `0` would misreport
  "zero mechanical work" for work simply never captured.
- `CACHEABLE_TERMINALS` is `export const` (`:247`), exactly
  `[{terminalPhase:"PreflightContent",reason:"preflight-rejected"},
  {terminalPhase:"ProposalReview",reason:"split-recommended"}]` — precisely the two cacheable shapes
  in the corpus (the `wiring-coverage-check-failed` terminal is correctly NOT cacheable);
  `_isCacheablePair` (`:252`) consumes it. `TELEMETRY_DECISION_KINDS =
  ["cold","resume","reuse-terminal","not-evaluated"]` (`:424`).
- The CLI dispatch is a sequence of independent top-level `if` blocks (`--build`@495, `--metrics`@552,
  `--telemetry-report`@563), NOT an `else if` chain; usage errors `process.exit(2)`, results exit
  0/1. `checkPreparation` (`:294`) is the one function the `Prepared` gate calls.

In short: nothing anywhere aggregates capacity statistics across telemetry+receipt artifacts today;
the throughput doc's flat number has zero supporting distribution; and the two real data sources have
complementary, only-partially-overlapping coverage (0/8 pairing) — so a correct design must join them
best-effort, never require pairing, must not assume a single task's telemetry is the whole
population, and must guard the degenerate-interval trap.

### Chosen mechanism

Add one new, purely additive
`--capacity-report [--telemetry-glob '<root>/**/*.json'] [--workspace <dir>] [--exclusions <file.json>] [--min-samples N] [--out <file>]`
CLI mode to `milestone-preparation-check.ts` (+ byte-identical `plugin/scripts/` mirror), as a NEW
independent top-level `if` block following the file's existing dispatch shape, backed by one new pure
exported function `computeCapacityReport({ workspace, telemetryGlob, exclusions, minSamples })`.
Design in load-bearing order:

1. **Two independent sample populations, joined best-effort — pairing never required** (directly
   forced by the confirmed 0/8 pairing rate).
   - *Telemetry population*: files under `milestones/prepare-telemetry/**/*.json`
     (`--telemetry-glob` overridable), traversed by a new shared `_walkJsonFiles(root)` helper
     factored OUT of `queryTelemetryReport`'s existing inline `walk()`, so both call sites share one
     traversal primitive. Each caller keeps its own per-file contract: `queryTelemetryReport`'s
     parse-and-silently-skip behavior stays byte-for-byte unchanged (regression-tested);
     `computeCapacityReport` instead captures `{path, record|null, parseError|null}` per file,
     turning a parse failure into a traced `exclusions[]` entry (`reason: "malformed-json"`). Every
     parsed record runs through the reused `validateTelemetryRecord`; a failure becomes an
     `exclusions[]` entry carrying the validator's own `{code, message}`, never a silent include.
   - *Receipt population*: every `milestones/M*/preparation.json` under `--workspace` (default `.`)
     with a non-null `.convergence`, fed through the reused `computeConvergenceMetrics` via
     `computeMetricsForReceipt` — not a second, independent derivation. No `.convergence`
     (M197/M201/M202/M203) → excluded `"no-convergence-block"`, never treated as zero-duration.
     `.convergence.startedAtMs === .convergence.endedAtMs` (M192, M195) → excluded
     `"convergence-interval-degenerate"`. This guard fires only on exact equality of both finite
     fields, never on a short-but-distinct interval, so a genuinely fast Prepare run is never wrongly
     discarded.
   - The two populations join best-effort on `(taskId, milestoneId)`; an unpaired record on either
     side still contributes fully to its own population's stats.
2. **Percentiles** via one small shared pure `percentile(sortedNumbers, p)` helper over receipt-side
   `prepareWallTimeMs`, telemetry-side wall time (`recordedAtMs − admission.acquiredAt`), and
   agent-minutes where measurable; broken down by `class` / `highRisk` / terminal `{phase,reason}` /
   `decision.kind` (`not-evaluated` its own bucket, never folded into `cold`).
3. **Content-generation discriminator is `decision.kind ∈ {cold, resume}`**, never
   `decision.createsContentGeneration` (confirmed inverted at `:664`; all 10 live records would be
   misclassified as "no content generation" if the field were trusted). `eligible` = `decision.kind ∈
   {cold, resume, reuse-terminal}`; `attempt` = every well-formed record read, including
   `not-evaluated`.
4. **Content-agent work in three explicit, never-blended buckets**: `measuredZero`
   (`reuse-terminal`/`not-evaluated`, write-time-guaranteed `0`/`0`); `notMeasured`
   (`cold`/`resume` where both fields are `null` under the landed schema — emitted
   `null`/`"not-measured"`, never coerced to `0`; currently covers all 10 live records); and an
   explicitly-labeled `wallTimeProxyMinutes` (`recordedAtMs − admission.acquiredAt`) as an optional
   supplementary number, never presented under the `contentAgentMs` name.
5. **`prepared/attempt` ratio**, with the eligible-content-generation denominator shown alongside;
   **terminal/decision yield by reason** (prepared, split/preflight-recommended, terminal-reused,
   transient failure). The live population already exercises `split-recommended` (×8),
   `preflight-rejected` (×1), and `wiring-coverage-check-failed` (×1), so this bucket is
   non-synthetic even before `--min-samples` is separately met.
6. **`absorbed-task/prepare-hour`**: numerator = distinct `taskId`s whose milestone directory has
   BOTH `preparation.json` and `absorb-entry.md` (confirmed present for all 8 committed receipts);
   denominator = summed `prepareWallTimeMs` from `computeConvergenceMetrics` across the subset of
   those same receipts that also carry a non-null `.convergence` block (currently M192/M195/M198/M200
   — with M192/M195 degenerate-excluded, leaving M198/M200 as the real contributors). Receipt-derived
   only; requires no telemetry pairing.
7. **Concurrent duplicate-generation minutes**: for telemetry records sharing `(workspace, taskId)`,
   build `[admission.acquiredAt, recordedAtMs]` intervals (both required non-null — a record missing
   either is excluded from overlap analysis ONLY, `"interval-fields-missing"`, but still counted
   elsewhere). Sum only pairwise intersection; a sequential retry starting after the prior terminal
   contributes exactly zero.
8. **Unchanged-stable-terminal recomputation**: group telemetry records by `(taskId,
   hashes.{charter,taskContract,proposal,reviewPolicy})`, classify `terminal.{phase,reason}` as
   cacheable via the imported `CACHEABLE_TERMINALS`. When ≥2 records in the same group share a
   cacheable terminal and the later one has `decision.kind !== "reuse-terminal"`, count it as
   avoidable recomputation, summing `contentAgentMs` when non-null (else route to
   `notMeasured`/proxy accounting, never a fabricated exact number). Grouping key is `hashes.*`
   EXACT equality — never terminal-shape alone: the corpus has many `split-recommended` records
   (DIR-126-E's own 3, the two `gap-wiring-coverage-check-…` records, and more), but whether they
   actually group depends on their `hashes.*` matching exactly, which must be checked per record at
   Execute time. Loosening the key would misclassify every legitimate content revision between
   rounds as wasted work.
9. **`estimatedAvoidedAgentMinutes`** computed only when a comparable, same-`class`/`highRisk`,
   non-`reuse-terminal` sample population exists; otherwise the literal string `"unknown"`.
10. **Sample-count gate**: total eligible samples (telemetry ∪ receipt, post-exclusion) below
    `--min-samples` (default 3) → `{"code":"insufficient-samples", sampleCount, sampleIds, ...}`, no
    P50/P85. Per-population counts always reported separately, never blended into one combined total
    that could hide a thin population behind a fatter one.
11. **Exclusions unified and always reasoned**: malformed JSON, `validateTelemetryRecord` failures,
    `interval-fields-missing`, `no-convergence-block`, `convergence-interval-degenerate`, and
    caller-supplied `--exclusions <file.json>` entries (`{id, reason}`) — combined into one
    `exclusions[]` array. Nothing dropped silently.
12. `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` §4 is hand-edited to
    replace the flat range with the reproduced P50/P85, sample count, sample-ID list, and an explicit
    exclusions note, copy-pasted from a real command run's `--out` JSON. The doc stays readable
    prose, not templated; every number traces to a real, checked-in command output, never to session
    recollection.

No new write path into `milestones/prepare-telemetry/` or `.quay/prepare-leases/` — the whole mode is
read-only over both trees, matching the charter's "additive, read-only aggregation" / "why not
highRisk" framing.

### Concrete control/data flow

```
CLI: node milestone-preparation-check.ts --capacity-report
       [--telemetry-glob 'milestones/prepare-telemetry/**/*.json']
       [--workspace .] [--exclusions exclusions.json] [--min-samples 3] [--out report.json]
   │  (new independent top-level if block, same dispatch shape as --build/--metrics/--telemetry-report)
   ├─ _walkJsonFiles(telemetryRoot)   [shared recursion; queryTelemetryReport's external
   │                                    contract unchanged — verified by before/after regression diff]
   │     → per file: {path, record|null, parseError|null}
   │        parseError                     → exclusions[] "malformed-json"
   │        validateTelemetryRecord() fail → exclusions[] (validator's own {code,message})
   │        ok                             → telemetry sample population
   ├─ walk milestones/M*/preparation.json; for each with non-null .convergence:
   │        computeMetricsForReceipt → computeConvergenceMetrics(...)  [REUSED]
   │        no .convergence block                → excluded "no-convergence-block"
   │        startedAtMs === endedAtMs (finite)    → excluded "convergence-interval-degenerate"
   ├─ join telemetry + receipt populations by (taskId, milestoneId), BEST-EFFORT
   ├─ apply --exclusions file entries (id/reason)
   ├─ import { CACHEABLE_TERMINALS } from proposal-convergence.ts  [not a hand-copied literal]
   ├─ classify: decision.kind ∈ {cold,resume} = content-generation attempt (NOT
   │     decision.createsContentGeneration, confirmed inverted); route agent-work into
   │     measuredZero / notMeasured / wallTimeProxyMinutes
   ├─ percentile() over in-scope numeric fields; interval-intersection over
   │     [admission.acquiredAt, recordedAtMs] for overlap; hashes.*+cacheable-terminal
   │     grouping for recomputation waste (all pure, unit-testable functions)
   ├─ absorbed-task/prepare-hour = count(receipts w/ preparation.json ∧ absorb-entry.md) /
   │     (sum of computeConvergenceMetrics wall-time hours over the convergence-bearing subset)
   └─ eligible sample count (per-population AND combined) < --min-samples?
        → {code:"insufficient-samples", sampleCount, sampleIds, ...}
        else → {code:"ok", sampleCount, exclusions[], p50/p85 by stratum, ratios, waste-classes}
        console.log(JSON.stringify(report)); --out writes the same JSON; exit 0 in both cases
        (insufficient-samples is a normal, successful report, not a usage failure); exit 2 only on
        a hard usage/environment error (bad --telemetry-glob shape, unparsable --exclusions JSON,
        unreadable --workspace) — matching this file's existing parseArgs/exit-2 convention
   │
   ▼ (human/agent regenerates by hand, citing the --out JSON's real sample IDs)
docs/proposals/quay-milestone-workflow-throughput-capacity-model.md §4 rewritten
```

**Mechanism-claim wiring coverage (DIR-117) — every new call/dispatch/ownership/enforcement
relationship claimed above, flagged explicitly for AC-level proof, not left as prose assertion:**

- CLAIM: `--capacity-report` is a real, reachable CLI branch on `milestone-preparation-check.ts`
  (canonical file AND `plugin/scripts/` mirror), dispatched the same way as the existing
  `--build`/`--metrics`/`--telemetry-report` branches → needs grep/import-graph evidence PLUS a live
  subprocess invocation test, not `--selftest`-only reachability. (This is the single most important
  AC item; if unmet it fails the whole child.)
- CLAIM: `_walkJsonFiles` is one shared recursion primitive used by BOTH `queryTelemetryReport` and
  `computeCapacityReport` → needs source-inspection/call-count evidence of a single traversal
  implementation, not two independently written directory walks.
- CLAIM: `computeCapacityReport` calls the existing `validateTelemetryRecord` (reused, not
  reimplemented) → needs a test asserting a schema-invalid fixture record lands in `exclusions[]`
  carrying the validator's own `{code, message}` (e.g. `"reuse-terminal-invalid"`).
- CLAIM: `computeCapacityReport` derives receipt wall time via
  `computeConvergenceMetrics`/`computeMetricsForReceipt` (not a second, independent derivation) →
  needs a test asserting the reported `prepareWallTimeMs` for a fixture receipt matches
  `computeMetricsForReceipt`'s own output for that identical receipt.
- CLAIM: `computeCapacityReport` imports `CACHEABLE_TERMINALS` from `proposal-convergence.ts` (not a
  duplicated literal) → needs a fixture that mutates an entry in the real `CACHEABLE_TERMINALS` and
  observes the recomputation classification pick up the change.
- CLAIM: telemetry and receipt populations are joined best-effort, never required-paired → needs a
  test asserting a receipt-only sample still contributes wall-time stats, and a telemetry-only
  sample still contributes decision/agent-work stats.
- CLAIM: `queryTelemetryReport`'s existing external behavior (including silent-skip-on-malformed-
  JSON) is unchanged by the `_walkJsonFiles` extraction → needs a regression test re-running an
  existing `--telemetry-report` fixture and diffing output byte-for-byte before/after.
- CLAIM: `sync-vendor.sh --check`/`cmp` keeps the `plugin/scripts/` mirror byte-identical after this
  change → covered by the existing mirror-parity AC item; no new sync mechanism invented.
- CLAIM: `absorbed-task/prepare-hour`'s numerator is a checked-in file-presence signal, not a live
  task-store/MCP query → needs a fixture asserting the count changes when an `absorb-entry.md` file
  is added/removed on disk, with zero MCP/provider calls made.
- CLAIM: the `convergence-interval-degenerate` guard fires only on exact `startedAtMs === endedAtMs`
  equality, never on a short-but-distinct interval → needs a paired fixture (equal → excluded; one ms
  apart → included) — the exact trap that would otherwise silently zero out M195's real ~80-minute
  Prepare.
- CLAIM: `computeCapacityReport` aggregates across ALL task IDs under the glob root by default, not
  a single hardcoded `taskId` → needs a fixture with ≥2 distinct `taskId`s under the telemetry root
  confirming both appear in the per-task/per-stratum breakdown — a live concern now that the real
  tree holds 4 distinct task IDs (10 records), not the 1 a single-task reading would assume.

### Key design decisions

- **Two independent sample populations, best-effort joined — never pairing-required.** Directly
  forced by the confirmed 0/8 telemetry↔receipt pairing rate; this also resolves
  `absorbed-task/prepare-hour` in favor of a receipt-only wall-time denominator that needs no
  telemetry pairing.
- **`decision.kind`, not `decision.createsContentGeneration`, is the content-generation
  discriminator** — confirmed inverted by direct code read (`:664`) and independently re-confirmed
  against all 10 live records (all `cold`, all `false`). Routing around a landed field's surprising
  semantics (rather than "fixing" it, which is outside this child's `## Touches`) is the lower-risk
  choice for a read-only reporting child.
- **Traversal, the cacheable-pair allowlist, record validation, and receipt-wall-time derivation are
  all imported/reused, never duplicated** — the exact "content living in two places" drift class this
  repo's CLAUDE.md names; two independently maintained copies would silently drift the next time
  DIR-126-C/D's logic changes.
- **`null` vs `0` for content-agent fields is preserved, never coerced** — confirmed by direct read
  of the write path (`:665`) and all 10 live records (`null`/`null` for `cold`). Coercing to `0`
  would misreport "mechanical work only" where the value was simply never captured.
- **`convergence-interval-degenerate` is a distinct exclusion reason from `no-convergence-block`**,
  scoped narrowly to exact equality — the specific guard keeping M195 (the receipt behind this
  child's founding Finding) from silently reporting `0ms` once real aggregation exists.
- **The unchanged-terminal recomputation grouping key is `hashes.*` equality, never terminal-shape
  equality alone** — loosening the key to "same terminal regardless of hash" would misclassify every
  legitimate content revision (e.g. between two `split-recommended` rounds where proposal text
  actually changed) as wasted work; this must be checked per-record, not assumed from the terminal.
- **Concurrency overlap and unchanged-input recomputation are two separate waste-class passes**, not
  one combined heuristic, to avoid misattributing one waste class's cost to the other.
- **No new glob dependency** — `--telemetry-glob` supports exactly the fixed `<root>/**/*.json`
  shape via a string split plus the already-existing recursive walk, not a general glob engine or
  `fs.globSync` (Node ≥22.13-only, below this repo's Node-20 packaging floor).
- **No telemetry schema change** — `admission.acquiredAt`/`recordedAtMs` already support interval
  math on every live record (confirmed on all 10); DIR-126-D's frozen `schemaVersion: 2` stays
  untouched.
- **Savings are never fabricated** — `reuse-terminal`'s zero-agent-work claim is exact and
  schema-guaranteed; `estimatedAvoidedAgentMinutes` is `"unknown"` unless a real, labeled,
  reproducible comparable sample population exists.
- **The throughput-doc rewrite stays a manual, human/agent-authored prose edit** citing the real
  `--out` JSON, not an automated markdown-templating step.
- **Aggregation is task-ID-agnostic by default** — the live tree now spans 4 distinct task IDs' worth
  of telemetry (10 records); a design that silently assumed a single task (tempting given this
  child's own charter framed itself as the data source) would discard the majority of real records
  the moment the command ships.

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| Fewer than `--min-samples` (default 3) eligible samples (telemetry ∪ receipt, post-exclusion) | `{"code":"insufficient-samples", sampleCount, sampleIds}`, per-population AND combined — no P50/P85 |
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
| Zero eligible samples at all (both populations empty) | same `insufficient-samples` path; exit 0, not an error |
| No `reuse-terminal` sample exists anywhere at Execute time (currently true: 0/10 live records) | `measuredZero` bucket reports empty/zero-count, not fabricated; the report stays honest and usable; the DoD clause requiring a real `reuse-terminal` proof is explicitly flagged as a residual open item (Risks), to be satisfied by a real sample landing, never synthesized here |

### Compatibility

Purely additive: one new CLI mode plus one new exported function on the existing 587-line script
(mirrors confirmed byte-identical live via `diff -q`). `checkPreparation()` — the function the
`Prepared` gate actually calls — is untouched; nothing here alters its control flow.
`queryTelemetryReport()`'s external behavior (CLI flag, input, output shape, silent-skip-on-malformed-
JSON) is unchanged; only its internal recursion is factored into the shared `_walkJsonFiles` helper,
verified by an explicit before/after regression test. Both `experiments/quay-perpetual-stream/scripts/`
and `plugin/scripts/` copies stay byte-identical via the existing `sync-vendor.sh` mechanism (no new
sync path). `proposal-convergence.ts` is only imported from, never modified — it is NOT in this
child's `## Touches`. No existing check changes shape or becomes stricter, matching the charter's
"why not highRisk" framing.

### Risks

- **The ≥3-real-sample DoD bar is close but must be re-verified at Build/Verify time, never assumed
  from this Proposal's drafting-time snapshot.** As of authoring, the tree holds 10 real records
  across 4 task IDs spanning 3 distinct terminal shapes — genuine diversity. But **zero
  `resume`/`reuse-terminal` records exist yet**, so the DoD's "real `reuse-terminal` proof" clause
  and this Proposal's C-efficiency AC item have no real sample to cite. The DoD text ("at least three
  post-change real preparation generations of different terminal shapes") does not explicitly require
  all three from the SAME task; that scoping question should be resolved explicitly at Plan/Build
  time (the charter's framing — tolerant of "this child's own dispatch... plus real dispatches of
  other pending work" accumulating a genuine cross-task pool — reads as tolerant of a cross-task
  reading). Live counts will keep moving between authoring and Build — this Proposal's own authoring
  already observed the count move from 8 to 10 — so the real regression proof must re-query the tree
  at Build/Verify time, and Execute-time work must either wait for a `reuse-terminal` sample to occur
  naturally or explicitly document its absence as a residual gap, never fabricate one.
- **Multiple prior real generations of this exact task have terminated `split-recommended` at
  ProposalReview** (3 of DIR-126-E's own 4 live records). Examined honestly, this Proposal's
  mechanism is a set of interdependent facets of ONE aggregation function over two joined artifact
  populations (overlap detection is only correctly interpretable alongside the recomputation check it
  needs for context), not independently shippable increments; the one genuinely separable seam (the
  `--capacity-report` code vs. the doc-regeneration edit) is already reflected as two distinct
  Requested-action items, not merged. A related filed gap,
  `gap-prepare-milestone-split-decision-no-finality` (itself now showing 2 `split-recommended`
  telemetry records), documents that this mechanical split-decision signal oscillates
  non-monotonically across otherwise-similar rounds — corroborating context that repeated
  `split-recommended` verdicts on a structurally-single-function design are a known noise pattern. If
  a further real generation of this task also recommends split, that should be weighed as a stronger
  signal than this Proposal treats it, not re-litigated identically again.
- **Telemetry-side decision/content-agent statistics may stay thin per-task even as the cross-task
  pool grows.** The report surfaces this via separate per-task and per-population sample counts,
  never blended into one combined total that hides a thin population behind a fatter one.
- **Content-agent-minutes honesty vs. AC readability tension**: reporting `notMeasured` for
  `cold`/`resume` (all 10 live records) means the regenerated doc's headline duration is wall time,
  not agent-minutes — a real, disclosed schema limitation. Extending the schema to populate real
  `contentAgentMs` for `cold`/`resume` is out of this child's scope.
- **Too few real samples produce a misleadingly precise-looking P50/P85** — mitigated by the explicit
  `insufficient-samples` default.
- **Interval-based overlap math depends on `admission.acquiredAt`/`recordedAtMs` fidelity** — both
  are wall-clock `Date.now()`-derived; clock skew across concurrent processes could in principle
  produce a spurious small overlap or gap. No distributed-clock correction exists in this repo; the
  report states numbers as observed, not corrected.
- **Malformed-record tracing changes `computeCapacityReport`'s exclusions output shape relative to
  `queryTelemetryReport`'s silent-skip behavior** — a deliberate, explicitly flagged divergence
  between the two functions, not an accidental mismatch.
- **Aggregating across multiple task IDs by default is an explicit design choice** (Key design
  decisions) that a single-task reading of the charter would not confront; Build should confirm the
  AC wording ("Prepare-scoped") is read as cross-task by default with per-task breakdowns available,
  not silently single-task.

### Non-goals

Not implementing DIR-126-A through DIR-126-D's own mechanisms — this child only aggregates and
reports on their real, already-landed output. Not a general-purpose analytics/dashboard system
(persistent metrics store, web view) — scoped to the Prepare-stage capacity questions this task's AC
names. Not reopening DIR-126-D's frozen telemetry schema (`schemaVersion: 2`) or changing
`queryTelemetryReport`'s existing external behavior. Not extending `proposal-convergence.ts`'s
telemetry writer to populate real per-generation `contentAgentDispatchCount`/`contentAgentMs` for
`cold`/`resume` — outside this child's `## Touches`; a legitimate future `gap-*` follow-up. Not
fixing `decision.createsContentGeneration`'s apparent semantic inversion in `proposal-convergence.ts`
— same reasoning. Not resolving whether the DoD's "≥3 generations of different terminal shapes" bar
must come from a single task or may span tasks — flagged as an open scoping question for Plan/Build,
not decided unilaterally here. LOC/duration remain descriptive output only, never a productivity
target.

### AC coverage (mapped to `tasks/DIR-126-E.md`'s Acceptance Criteria)

1. **Real, reachable CLI mode** — covered: `--capacity-report` added to the same independent-`if`
   dispatch pattern as `--build`/`--metrics`/`--telemetry-report`, verified by grep/import-graph plus
   a live subprocess invocation, both mirrors — not `--selftest`-only reachability.
2. **Reproducible aggregation over checked-in artifacts** — covered by `computeCapacityReport`'s
   field list; every emitted field traces to a named record/receipt field, none synthesized; unit
   tested plus one real `git diff`-visible CLI run against the now-larger (10-record) telemetry tree.
3. **Sample provenance real and traceable** — covered: both populations retain source
   `recordId`/`attemptId`/receipt path; `--out` JSON carries the raw sample-ID list; the doc rewrite
   cites it directly.
4. **Duplicate-generation minutes mean real overlap** — covered by interval intersection, unit
   tested against an overlapping pair, a sequential-retry pair, and a single-generation case.
5. **C-efficiency measured separately, honest reading** — covered: `reuse-terminal`'s
   zero-content-agent claim is exact and schema-guaranteed; a recomputed cacheable terminal's wasted
   work is reported as the exact measured value when non-null, else via `notMeasured`/proxy. Flagged
   as a residual open item: no real `reuse-terminal` sample exists in the corpus as of authoring
   (0/10), so the live-data proof for this item may need to wait on, or explicitly document the
   absence of, such a sample at Execute time.
6. **Feedback-efficiency inputs exported, Prepare-scoped** — partially covered: cold/resume/reuse-
   terminal minute distributions where measurable, `absorbed-task/prepare-hour`; token counts and
   finding-novelty/recurrence are NOT confirmed present in the current telemetry schema and are
   flagged as a genuine open item for Plan/Build, not asserted solved. Does not claim end-to-end
   verified value or an Execute escape rate from Prepare-only evidence.
7. **Machine-readable report preserves raw IDs/strata/exclusions/unknowns** — covered by the `--out`
   JSON schema, consumable later without scraping prose.
8. **Insufficient-sample honesty** — covered by the `< minSamples` default-table row, unit tested
   with the real current combined sample count (10, as of authoring) alongside a synthetic 2-sample
   fixture proving the boundary.
9. **Mirror byte-identity** — covered by the existing `sync-vendor.sh --check`/`cmp` mechanism,
   unchanged, re-run as part of this child's Verify.
10. **`convergence-interval-degenerate` never silently reports `0ms`** — covered by a fixture built
    directly from the confirmed live M192/M195 shape (`startedAtMs === endedAtMs`) plus a genuinely-
    short-but-distinct-interval fixture proving the guard fires only on exact equality.
11. **`absorbed-task/prepare-hour` numerator is file-presence, never a live query** — covered by a
    fixture asserting the count changes when `absorb-entry.md` is added/removed on disk with zero
    MCP/provider calls made.

### Alternatives considered and rejected

- **Require telemetry/receipt pairing as a hard precondition for any statistic.** Rejected —
  falsified by direct inspection: 0/8 committed receipts pair with a telemetry record, so requiring
  pairing would report `insufficient-samples` against the entire real historical baseline this task
  exists to characterize.
- **Extend `queryTelemetryReport` in place to also aggregate**, instead of adding a new function.
  Rejected: it is contractually `milestoneId`-scoped, its callers depend on that exact single-
  milestone return shape and its current silent-skip malformed-record behavior; changing it would
  violate this child's own Compatibility bar.
- **Fabricate/estimate content-agent-minutes for `cold`/`resume` from wall time via a fixed ratio.**
  Rejected: exactly the invented-precision this design's "savings are never fabricated" principle
  forbids; an honest `notMeasured` bucket plus a distinctly-labeled `wallTimeProxyMinutes` is more
  defensible and matches the existing `estimatedAvoidedAgentMinutes: "unknown"` precedent.
- **Trust `decision.createsContentGeneration` as written.** Rejected after direct code reading
  (`:664`, confirmed against all 10 live `cold` records) showed it inverted relative to its apparent
  name; trusting it would silently misclassify the majority real-world decision kind as "no content
  generation."
- **Add a general glob-matching dependency (`minimatch`/`fast-glob`) or use `fs.globSync`.**
  Rejected: the one real use case is a fixed `<root>/**/*.json` shape; a new dependency, or a Node
  ≥22.13-only stdlib API below this repo's Node-20 packaging floor, buys nothing over a simple string
  split plus the already-existing recursive walk.
- **Reimplement `queryTelemetryReport`'s traversal from scratch inside the new function.** Rejected:
  two independently maintained directory walks over the same tree is the exact "content living in two
  places" drift pattern this repo's CLAUDE.md calls out to fix at the source.
- **Compute `absorbed-task/prepare-hour` from live `task_get`/`task_list` MCP queries** instead of
  checked-in `absorb-entry.md` presence. Rejected: a live provider query is a non-reproducible data
  source; `absorb-entry.md` presence is git-pinned and reproducible, matching the "checked-in
  artifacts only" bar applied consistently elsewhere in this design.
- **Parse Claude Code session JSONL directly** for finer-grained timing. Rejected outright: violates
  the explicit no-session-JSONL-parsing bar this repo's process establishes for this class of work,
  and session logs are not checked-in, reproducible artifacts.
- **A telemetry schema change adding explicit wall-clock start/end fields.** Rejected as unnecessary
  — `admission.acquiredAt`/`recordedAtMs` (confirmed present on all 10 live records) already support
  the required interval math without reopening DIR-126-D's frozen `schemaVersion: 2`.
- **Live, scheduler-integrated overlap detection** (enforcing/blocking at dispatch time). Rejected:
  that is DIR-126-A's already-landed concurrency-control job; this child is read-only reporting over
  historical artifacts, not a second enforcement point.
- **Hand-edit the throughput doc's numbers from session-transcript recollection**, skipping a real
  command run. Rejected: defeats the entire purpose of this child.
- **Restrict aggregation to a single hardcoded `taskId` (e.g. only `DIR-126-E`).** Rejected on fresh
  evidence found during this Proposal's own authoring: the real tree already spans 4 distinct task
  IDs' worth of telemetry (10 records); a single-task design would discard 6 of the 10 real records
  that exist today and misrepresent the tool as narrower than the actual artifact population it
  reads.
- **Split this child further** (mirroring the repeated `split-recommended` verdicts observed live on
  this exact task's telemetry). Considered seriously given the repeated live signal, but rejected on
  structural grounds: the mechanism items are interdependent facets of one aggregation function over
  two joined populations (duplicate-overlap detection is only correctly interpretable alongside the
  unchanged-terminal-recomputation check it needs for context), not independently shippable
  increments; the one genuinely separable seam (code vs. doc-regeneration edit) is already reflected
  as two distinct Requested-action items. If a further real generation also recommends split, that
  should be weighed as a stronger signal than this Proposal treats it, not re-litigated identically.

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
  (both mirrors) — not `--selftest`-only reachability — PLUS a live subprocess invocation
  (`node milestone-preparation-check.ts --capacity-report --workspace .` against a scratch
  workspace) confirms the mode actually runs and produces well-formed JSON output. This item alone,
  if unmet, fails the whole
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
- [ ] **Aggregation spans all task IDs under the glob root by default, never one hardcoded
  `taskId`:** a fixture telemetry population containing >= 2 distinct `taskId`s under
  `--telemetry-glob` confirms both task IDs appear in `computeCapacityReport`'s per-task/
  per-stratum breakdown — the real tree already holds 4 distinct task IDs' worth of telemetry, so a
  design that silently assumed a single task would under-report the actual available sample pool.
- [ ] **Insufficient-sample honesty:** a fixture with fewer than 3 samples produces the explicit
  `insufficient-samples` result, not a misleadingly precise distribution.
- [ ] Canonical and `plugin/` mirrors of `milestone-preparation-check.ts` are byte-identical —
  `sync-vendor.sh --check` (the module is in `sync-vendor.sh`'s `SYNC_SCRIPTS` array; no test-file
  mirror parity is claimed — `plugin/test/` mirrors are not part of this repo's sync convention for
  this module, matching 23 of 25 `SYNC_SCRIPTS` entries).
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
  direct-source-read standard as every round above. Round-4 additionally flagged this sample-set
  enumeration claim's exact identifiers: `gap-wiring-coverage-check-whose-own-and-bold-marker-splitting`,
  `ProposalReview`, `split-recommended`, `gap-prepare-milestone-split-decision-no-finality`,
  `gap-dir126d-deferred-phase-timing-recurrence-tracking`, `wiring-coverage-check-failed` — all
  confirmed real by the same direct-source-read standard (the actual, on-disk telemetry record
  directory listing this Proposal's Problem framing cites). Round-5 additionally flagged the
  live-corpus-enumeration claim's exact slash-form and line-reference identifiers:
  `milestones/prepare-telemetry/`, `schemaVersion: 2`, `DIR-126-E`,
  `ProposalReview/split-recommended`, `PreflightContent/preflight-rejected`,
  `ProposalReview/wiring-coverage-check-failed`, `checkPreparation`, `:294` — all confirmed real
  by the same direct-source-read standard (the on-disk telemetry directory + the live line number
  of `checkPreparation`'s `Prepared`-phase call site in `milestone-preparation-check.ts`).

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
