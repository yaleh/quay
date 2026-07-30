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

Replace the unsupported flat "**15–25 minutes**" Prepare-stage planning assumption in
`docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` §4 with a reproducible,
purely additive `--capacity-report` aggregation mode on `milestone-preparation-check.ts`
(+ byte-identical `plugin/scripts/` mirror) over the two artifact populations DIR-126-A..D already
produce and check in: `milestones/prepare-telemetry/**/*.json` telemetry records (DIR-126-D's
landed writer) and `milestones/M*/preparation.json` receipts (DIR-125's landed instrumentation).
The mode reads ONLY checked-in artifacts — never Claude Code session JSONL. This is the fifth and
final child of DIR-126's 5-way split; it depends on DIR-126-A/B/C/D being landed
(`a0aba1f`/M200, `528897c`/M201, `8c9d114`/M202, `6a24bf3`/M203) and implements nothing they did
not already produce; its AC/DoD real-regression proof additionally depends on enough real post-D
telemetry existing to aggregate.

### Problem framing (independently re-verified by direct extraction against the live tree by both authors, 2026-07-30)

Every number below was re-derived by our own source reads and field extraction during THIS
authoring round — and the live population has already moved again (8 → 10 → 14 records across the
authoring lineage), which is itself the strongest argument for a snapshot-agnostic design:

- **The documented number has no evidentiary base.**
  `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` §4 (confirmed live at
  ~lines 107–124 by direct read): one DIR-117 observation ("**22m 21s**") → "use **15–25 minutes**
  as the planning range", folded into "≈ 85–95 minutes per task". No distribution, no sample count,
  no provenance anywhere in the document. DIR-126's parent Finding measured M195's real Prepare at
  ~80 minutes — **3–5× the documented number** — and no checked-in command can reproduce or track it.
- **No aggregation exists anywhere.** `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts`
  is **587 lines**, byte-identical to `plugin/scripts/milestone-preparation-check.ts` (`diff -q`
  clean, re-run during this authoring). `grep -n "capacity-report\|P50\|P85\|percentile"` over both
  copies returns zero matches (exit 1) — **no aggregation mode exists today.** The only telemetry
  reader, `queryTelemetryReport({workspace, milestoneId})` (`:159`), is contractually
  single-milestone-scoped, recurses via an inline `walk()` closure (`:162`), silently drops
  malformed JSON with a bare `catch {}` (`:172`), and computes no statistics. Crucially for the
  join design, it filters by each record's EMBEDDED `milestoneId` field, never by directory layout
  (`:153–158` comment: layout is `taskId`-primary and a re-charter'd task carries different
  `milestoneId`s across generations under one directory). It returns a typed `{ok, code}` result.
- **The corpus is a moving target — proven twice during this authoring lineage.** Direct field
  extraction, re-run for this reconciliation, shows `milestones/prepare-telemetry/` holds **14 real
  `schemaVersion: 2` records across 4 distinct task IDs / 4 milestones** — `DIR-126-E`/M204 (5),
  `gap-dir126d-deferred-phase-timing-recurrence-tracking`/M207 (3),
  `gap-prepare-milestone-split-decision-no-finality`/M206 (3), and
  `gap-wiring-coverage-check-whose-own-and-bold-marker-splitting`/M205 (3). The task body's
  snapshot recorded 10; an earlier one recorded 8; this reconciliation says 14 — the count moved
  two steps within a single authoring lineage. Across **all 14**: `decision.kind === "cold"`,
  `decision.createsContentGeneration === false`, `contentAgentDispatchCount === null`,
  `contentAgentMs === null`, `sessionId === null`, full
  `hashes.{charter,taskContract,proposal,reviewPolicy}` 4-tuples present, and BOTH
  `admission.acquiredAt` and `recordedAtMs` non-null — so a telemetry-side wall-time proxy
  `recordedAtMs − admission.acquiredAt` is computable for the entire current corpus, spanning
  ~0.76 min (the one `preflight-rejected`) to ~65 min, with a hand-computed nearest-rank
  P50 ≈ 24 min and P85 ≈ 55 min — i.e. the doc's 15–25 band covers roughly the fastest quartile of
  real generations. (Exact percentiles are the command's deliverable, not this Proposal's
  assertion.) Terminal shapes already span three distinct forms: `ProposalReview/split-recommended`
  ×12, `PreflightContent/preflight-rejected` ×1, `ProposalReview/wiring-coverage-check-failed` ×1 —
  materially at the DoD's "≥3 different terminal shapes" bar — but the exact sample set used for
  the real regression proof MUST be captured at Execute time, never frozen here.
- **Zero `resume`/`reuse-terminal` records exist anywhere yet** (all 14 are `cold`). The DoD's
  "real `reuse-terminal` proof" clause therefore has no live sample to cite today; the design
  answers it with an explicit honest-empty path (Defaults), never a fabricated sample (Risks).
- **The receipts are only partially usable, and pairing is 0/8.** Direct read of all 8 committed
  `milestones/M*/preparation.json` receipts (M192, M195, M197, M198, M200, M201, M202, M203)
  confirms: `.convergence` non-null on M192/M195/M198/M200, `null` on M197/M201/M202/M203; and
  **`telemetryFile === undefined` on all 8 — a 0/8 telemetry↔receipt pairing rate today.** Any
  design requiring pairing as a statistic precondition would report `insufficient-samples` against
  the entire M192–M203 baseline this child exists to characterize.
- **A confirmed correctness trap:** of the 4 convergence-bearing receipts, **M192 and M195 both
  have `startedAtMs === endedAtMs`** (degenerate placeholders), while M198/M200 have real distinct
  intervals. The trap is load-bearing: `computeConvergenceMetrics` (`proposal-convergence.ts:188`)
  returns `prepareWallTimeMs: endedAtMs − startedAtMs` for any two finite values, so it yields `0`
  for M192/M195 — and **M195 is the exact receipt the parent Finding measured at ~80 real
  minutes** — naive reuse would report `0ms` for the slowest documented real generation on record,
  directly undermining the reason this child exists.
- **The "absorbed" signal is already checked in.** `milestones/*/absorb-entry.md` exists for **13**
  milestone directories (M116–M119, M192, M194, M195, M197, M198, M200–M203) — all 8
  receipt-bearing ones PLUS five historical milestones with no receipt. So a reproducible,
  git-pinned "this task landed" signal exists requiring zero live provider queries, but the
  `absorbed-task/prepare-hour` numerator must be receipts AND `absorb-entry.md`, not
  `absorb-entry.md` presence alone.
- **Schema/cacheability facts surfaced by direct read** (each line number live as of authoring;
  re-verify at Build):
  - Records store the terminal as `{outcome, reason, phase, cacheable}` — the field is
    `terminal.phase`, while `CACHEABLE_TERMINALS` (`proposal-convergence.ts:247`, `export const`)
    keys its entries on `terminalPhase` and contains exactly
    `[{terminalPhase:"PreflightContent",reason:"preflight-rejected"},
    {terminalPhase:"ProposalReview",reason:"split-recommended"}]` — precisely the two cacheable
    shapes in the corpus (`wiring-coverage-check-failed` correctly NOT cacheable). An aggregator
    that assumed name-matching would silently classify nothing as cacheable.
  - Records SELF-report `terminal.cacheable: true` — a per-record claim that can go stale if the
    allowlist changes, so it must be re-derived, never trusted. `_isCacheablePair` (`:252`) is NOT
    exported, and `proposal-convergence.ts` is NOT in this child's `## Touches`, so the
    `phase→terminalPhase` bridge must live in the aggregator.
  - `admission.key` already encodes `"<workspace>::<taskId>"` (e.g. `".::DIR-126-E"`) — the
    overlap-grouping key exists in the data and need not be synthesized. (One live DIR-126-E
    record's `admission.ownerExecutionId` equals this authoring's own session id — the aggregator
    will read records its own authoring lineage produced, the cleanest possible self-referential
    provenance test.) Records also carry `sessionId: null` — confirming no session data is
    reachable from telemetry.
  - `decision.createsContentGeneration` is written `kind === "resume"`
    (`proposal-convergence.ts:664`) — `false` for `cold`; trusting this field would invert the
    content-generation discriminator on all 14 live records. `cold`/`resume` write
    `contentAgentDispatchCount: null, contentAgentMs: null` (`:665`); only `reuse-terminal`
    (`:577`) and `not-evaluated` (`:751`) write explicit `0`/`0`, and `validateTelemetryRecord`
    (`:430`, exported) fail-closed rejects a `reuse-terminal` record violating
    `contentAgentDispatchCount === 0 && contentAgentMs === 0` with `code: "reuse-terminal-invalid"`
    (`:462–464`). `TELEMETRY_DECISION_KINDS = ["cold","resume","reuse-terminal","not-evaluated"]`
    (`:424`). The validator's required-field list (`:439`) includes `class` and `highRisk`, so
    both stratifier fields are schema-guaranteed on every well-formed record. Collapsing `null`
    into `0` would misreport "zero mechanical work" for work simply never captured.
  - The CLI dispatch is a sequence of independent top-level `if` blocks (`--build`@495,
    `--metrics`@552, `--telemetry-report`@563), NOT an `else if` chain; usage errors
    `process.exit(2)`, results exit 0/1. `checkPreparation` (`:294`) is the one function the
    `Prepared` gate calls.
  - Mirror sync is rooted in `plugin/scripts/sync-vendor.sh` only (its `SYNC_SCRIPTS` array, at
    `:147`, lists `milestone-preparation-check` at `:170`); no `sync-vendor.sh` exists under
    `experiments/…/scripts/`.
  - `experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs` already exists
    (722 lines of `node:test`), imports the `.ts` module directly (verified working under Node
    v26.5.0 via a live dynamic import — current exports: `buildReceipt, checkPreparation,
    checkProvenanceDistinctness, computeCurrentHashes, computeMetricsForReceipt,
    computeTouchesExpansion, parsePlanStages, queryTelemetryReport, sha256,
    validatePlanStructure`), already references `queryTelemetryReport` 8 times — the natural home
    for the new fixtures (it is in this child's `## Touches`) and the regression baseline for the
    traversal refactor.

In short: nothing anywhere aggregates capacity statistics today; the throughput doc's flat number
has zero supporting distribution; and the two real data sources have complementary,
only-partially-overlapping coverage (0/8 pairing) — so a correct design must join them best-effort,
never require pairing, must not assume one task's telemetry is the whole population (4 task IDs
live), must guard the degenerate-interval trap, and must re-derive cacheability from the imported
allowlist rather than trust per-record self-reports.

### Chosen mechanism

Add ONE new, purely additive
`--capacity-report [--telemetry-glob '<root>/**/*.json'] [--workspace <dir>] [--exclusions <file.json>] [--min-samples N] [--out <file>]`
CLI mode to `milestone-preparation-check.ts` (+ byte-identical `plugin/scripts/` mirror), as a new
independent top-level `if` block following the file's existing dispatch shape, backed by one new
pure exported function `computeCapacityReport({ workspace, telemetryGlob, exclusionsFile,
minSamples })` and one small shared `_walkJsonFiles(root)` helper factored OUT of
`queryTelemetryReport`'s inline `walk()` (`:162`). It reuses the existing `--workspace`
(default `.`) and `--out` flags. In load-bearing order:

1. **Two independent sample populations, joined best-effort — pairing never required** (directly
   forced by the confirmed 0/8 pairing rate).
   - *Telemetry population*: files under the glob root (default
     `milestones/prepare-telemetry/**/*.json`, relative to `--workspace`; `--telemetry-glob`
     overridable), traversed by the new shared `_walkJsonFiles(root)` helper factored OUT of
     `queryTelemetryReport`'s existing inline `walk()`, so both call sites share ONE traversal
     primitive. Each caller keeps its own per-file contract: `queryTelemetryReport`'s
     parse-and-silently-skip behavior and `{ok, code}` return shape stay byte-for-byte unchanged
     (regression-tested); `computeCapacityReport` instead captures `{path, record|null,
     parseError|null}` per file, turning a parse failure into a traced `exclusions[]` entry
     (`reason: "malformed-json"`, path + error kept). Every parsed record runs through the reused
     exported `validateTelemetryRecord`; a failure becomes an `exclusions[]` entry carrying the
     validator's own `{code, message}` (e.g. `"reuse-terminal-invalid"`), never a silent include.
   - *Receipt population*: every `milestones/M*/preparation.json` under `--workspace` fed through
     the reused `computeMetricsForReceipt` → `computeConvergenceMetrics` — not a second,
     independent derivation. No `.convergence` (M197/M201/M202/M203) → excluded
     `"no-convergence-block"`, never treated as zero-duration. `startedAtMs === endedAtMs` with
     both finite (M192, M195) → excluded `"convergence-interval-degenerate"` by a new pure
     predicate applied OUTSIDE the reused function (which itself legitimately returns `0` for that
     shape — the guard composes over it, never modifies it; fixing it inside would touch
     out-of-scope code and risk DIR-125's callers). This guard fires only on exact equality, never
     on a short-but-distinct interval, so a genuinely 1ms Prepare is never wrongly discarded.
   - The two populations join best-effort on embedded `(taskId, milestoneId)`; an unpaired record
     on either side still contributes fully to its OWN population's stats.
2. **Two wall-time distributions, labeled and never pooled.** Receipt-side `prepareWallTimeMs`
   (the full prepare loop incl. PlanCheck) and telemetry-side proxy `recordedAtMs −
   admission.acquiredAt` (lease-acquire → record-write) measure semantically different intervals;
   pooling them into one P50/P85 would fabricate a number neither source supports. Each gets its
   own distribution block `{n, minMs, p50Ms, p85Ms, maxMs, method: "nearest-rank"}` via one small
   shared pure `percentile(sortedNumbers, p)` helper pinned to nearest-rank (deterministic, no
   interpolation-convention ambiguity, and named in the output), plus agent-minutes where
   measurable; broken down by `class` / `highRisk` / terminal `{phase,reason}` / `decision.kind`
   (`not-evaluated` its own bucket, never folded into `cold`).
3. **Content-generation discriminator is `decision.kind ∈ {cold, resume}`**, never
   `decision.createsContentGeneration` (confirmed inverted at `:664`; all 14 live records would be
   misclassified as "no content generation" if the field were trusted). `content-generation-eligible`
   (a telemetry-only concept, distinct from the `--min-samples` gate's sample-eligibility below) =
   `decision.kind ∈ {cold, resume, reuse-terminal}`; `attempt` = every well-formed record read,
   including `not-evaluated`. (Disambiguation: item 11 / the Defaults table use "eligible samples"
   to mean the `--min-samples` gate's population — telemetry ∪ receipt, post-exclusion — which has
   no `decision.kind` for receipts; the two senses are deliberately named differently here.)
4. **Content-agent work in three explicit, never-blended buckets**: `measuredZero`
   (`reuse-terminal`/`not-evaluated`, write-time-guaranteed `0`/`0` at `:577`/`:751`,
   validator-enforced at `:462`); `notMeasured` (`cold`/`resume` where both fields are `null`
   under the landed schema, per `:665` — emitted `null`/`"not-measured"`, never coerced to `0`;
   currently covers all 14 live records); and an explicitly-labeled supplementary
   `wallTimeProxyMinutes` (`recordedAtMs − admission.acquiredAt`), never presented under the
   `contentAgentMs` name.
5. **Cacheability re-derived from the imported `CACHEABLE_TERMINALS` via an explicit
   `record.terminal.phase → terminalPhase` bridge** (new, living in this file since
   `_isCacheablePair` is unexported and `proposal-convergence.ts` is out of `## Touches`; imported
   constant, never a hand-copied literal). The record's own `terminal.cacheable` is never trusted;
   a derived-vs-self-reported mismatch is emitted as a diagnostic entry, never silently resolved
   either way (derived value governs classification).
6. **`prepared/attempt` ratio** (with the eligible-content-generation denominator shown alongside)
   and **terminal/decision yield by reason** (prepared, split/preflight-recommended,
   terminal-reused, transient failure). The live population already exercises three terminal
   shapes, so this bucket is non-synthetic even before `--min-samples` is separately met.
7. **`absorbed-task/prepare-hour`**: numerator = distinct milestones (their `taskId`s) whose
   directory has BOTH `preparation.json` AND `absorb-entry.md` (file-presence only, zero
   MCP/provider calls — the AND matters, since 5 more milestones have `absorb-entry.md` without any
   receipt; all 8 receipt milestones qualify today); denominator = summed
   `computeConvergenceMetrics` wall-time hours over the convergence-bearing, non-degenerate subset
   of those same receipts (today M198 + M200 after the M192/M195 degenerate exclusion).
   Receipt-derived only; requires no telemetry pairing and no live provider/MCP query.
8. **Concurrent duplicate-generation minutes**: group telemetry records by their OWN
   `admission.key` (`"<workspace>::<taskId>"` — reusing the record's existing key, never a
   synthesized tuple), build `[admission.acquiredAt, recordedAtMs]` intervals (both required
   non-null — a record missing either is excluded from overlap analysis ONLY,
   `"interval-fields-missing"`, but still counted in decision/agent-work stats). Sum only pairwise
   intersection; a sequential retry starting after the prior terminal contributes exactly zero.
9. **Unchanged-stable-terminal recomputation**: group telemetry records by `(taskId,
   hashes.{charter,taskContract,proposal,reviewPolicy})` EXACT 4-tuple equality; classify terminals
   via the imported `CACHEABLE_TERMINALS` (through the phase bridge). Order records within a group
   by `recordedAtMs` ascending (the explicit sort key — records carry it non-null on every live
   record); when ≥2 records in a group share a cacheable terminal and the later one (by
   `recordedAtMs`) has `decision.kind !== "reuse-terminal"`, count it
   as avoidable recomputation, summing `contentAgentMs` when non-null, else routing to
   `notMeasured`/proxy accounting — never a fabricated exact number. Grouping key is `hashes.*`
   equality, never terminal-shape alone: the corpus holds 12 `split-recommended` records, but
   whether any pair actually groups depends on their `hashes.*` matching exactly, checked per
   record at Execute time. Loosening the key would misclassify every legitimate content revision
   between rounds as wasted work.
10. **`estimatedAvoidedAgentMinutes`** computed only when a comparable, same-`class`/`highRisk`,
    non-`reuse-terminal` sample population exists; otherwise the literal string `"unknown"`.
11. **Sample-count gate**: eligible samples (telemetry ∪ receipt, post-exclusion) below
    `--min-samples` (default 3) → `{"code":"insufficient-samples", sampleCount, sampleIds,
    perPopulation: {...}}`, no P50/P85. Per-population counts always reported separately, never
    blended into one combined total that could hide a thin population behind a fatter one.
12. **Exclusions unified and always reasoned**: malformed JSON, `validateTelemetryRecord`
    failures, `interval-fields-missing`, `no-convergence-block`,
    `convergence-interval-degenerate`, and caller-supplied `--exclusions <file.json>` entries
    (`{id, reason}`) — combined into one `exclusions[]` array. Nothing dropped silently.
13. **Byte-reproducible output**: the `--out`/stdout JSON carries NO wall-clock generation
    timestamp (`generatedAtMs`) — the same input tree produces byte-identical output, making the
    reproducibility AC mechanically diff-able rather than prose-asserted. Every emitted sample
    retains its source `recordId`/`attemptId`/receipt path.
14. **Doc regeneration**: `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` §4
    is hand-edited prose to replace the flat range with BOTH labeled reproduced distributions
    (P50/P85 each), sample count, sample-ID list, and an exclusions note copy-pasted from a real
    command run's `--out` JSON. The doc stays readable prose, not templated; every number traces
    to a real, checked-in command output, never to session recollection.

No new write path into `milestones/prepare-telemetry/` or `.quay/prepare-leases/` — the whole mode
is read-only over both trees, matching the charter's "additive, read-only aggregation" / "why not
highRisk" framing.

### Concrete control/data flow

```
CLI: node milestone-preparation-check.ts --capacity-report
       [--telemetry-glob 'milestones/prepare-telemetry/**/*.json']
       [--workspace .] [--exclusions exclusions.json] [--min-samples 3] [--out report.json]
   │  (new independent top-level if block, same dispatch shape as --build/--metrics/--telemetry-report)
   ├─ _walkJsonFiles(root)   [shared recursion factored from queryTelemetryReport's walk() @:162;
   │                           queryTelemetryReport's external contract byte-identical — regression-diffed]
   │     → per file: {path, record|null, parseError|null}
   │        parseError                      → exclusions[] "malformed-json" (path+error kept)
   │        validateTelemetryRecord() fail  → exclusions[] (validator's own {code,message})
   │        ok                              → telemetry sample population (all taskIds, all milestones)
   ├─ walk milestones/M*/preparation.json; for each:
   │        computeMetricsForReceipt() → computeConvergenceMetrics()   [REUSED, not re-derived]
   │        convergence=null                    → excluded "no-convergence-block"
   │        startedAtMs === endedAtMs (finite)  → excluded "convergence-interval-degenerate"
   │                                              (guard OUTSIDE the reused fn, which itself returns 0)
   ├─ join telemetry + receipt populations by embedded (taskId, milestoneId), BEST-EFFORT
   │     (embedded fields are authoritative; directory names are at most a taskId hint, per the
   │      queryTelemetryReport comment @:153–158 — re-charter'd tasks change milestoneId per generation)
   ├─ apply --exclusions file entries (id/reason)
   ├─ import { CACHEABLE_TERMINALS } from proposal-convergence.ts  [not a hand-copied literal];
   │     bridge record.terminal.phase → terminalPhase; never trust record.terminal.cacheable
   │     (derived-vs-self-reported mismatch → diagnostic entry, derived value governs)
   ├─ classify content generation by decision.kind ∈ {cold,resume} (NOT
   │     decision.createsContentGeneration, confirmed inverted @:664); route agent-work into
   │     measuredZero / notMeasured / wallTimeProxyMinutes
   ├─ nearest-rank percentile() per stratum over TWO UNPOOLED wall-time distributions
   │     (receipt prepareWallTimeMs; telemetry proxy recordedAtMs − admission.acquiredAt);
   │     pairwise interval intersection grouped by the record's OWN admission.key for overlap;
   │     hashes.* 4-tuple + cacheable-terminal grouping for recomputation waste (all pure,
   │     unit-testable functions)
   ├─ absorbed-task/prepare-hour = |milestone dirs w/ preparation.json ∧ absorb-entry.md| /
   │     (sum of computeConvergenceMetrics wall-time hours over the convergence-bearing,
   │      non-degenerate subset of those receipts)
   └─ eligible sample count (per-population AND combined) < --min-samples?
        → {code:"insufficient-samples", sampleCount, sampleIds, perPopulation}
        else → {code:"ok", populations, wallTime×2 unpooled, yield, agentWork,
                absorbedTaskPerPrepareHour, waste, estimatedAvoidedAgentMinutes, exclusions[]}
        console.log(JSON.stringify(report)); --out writes the SAME bytes; NO generatedAtMs —
        byte-identical re-runs. exit 0 in both cases (insufficient-samples is a normal, successful
        report, not a usage failure); exit 2 only on a hard usage/environment error (glob shape ≠
        '<root>/**/*.json', unparsable --exclusions JSON, unreadable --workspace) — matching this
        file's existing parseArgs/exit-2 convention
   │
   ▼ (human/agent hand-edits prose, citing the --out JSON's real sample IDs)
docs/proposals/quay-milestone-workflow-throughput-capacity-model.md §4 rewritten
```

**Mechanism-claim wiring coverage (DIR-117) — every new call/dispatch/ownership/enforcement
relationship claimed above, flagged explicitly for AC-level proof, never left as prose assertion:**

- **C1 (highest priority — the gate item):** `--capacity-report` is a real, reachable CLI branch
  on `milestone-preparation-check.ts` (canonical file AND `plugin/scripts/` mirror), dispatched
  the same way as the existing `--build`/`--metrics`/`--telemetry-report` branches → needs
  grep/import-graph evidence PLUS a live subprocess invocation (`node
  milestone-preparation-check.ts --capacity-report --workspace <scratch>`) producing well-formed
  JSON, not `--selftest`-only reachability. If this item fails, the whole child fails.
- **C2:** `_walkJsonFiles` is ONE shared recursion primitive used by BOTH `queryTelemetryReport`
  and `computeCapacityReport` → needs source-inspection/call-site evidence of a single traversal
  implementation, not two independently written directory walks.
- **C3:** `computeCapacityReport` calls the existing `validateTelemetryRecord` (reused, not
  reimplemented) → needs a test asserting a schema-invalid fixture record (e.g. a `reuse-terminal`
  violating `contentAgentDispatchCount === 0 && contentAgentMs === 0`) lands in `exclusions[]`
  carrying the validator's own `{code: "reuse-terminal-invalid", message}`.
- **C4:** `computeCapacityReport` derives receipt wall time via
  `computeMetricsForReceipt`/`computeConvergenceMetrics` (not a second, independent derivation) →
  needs a test asserting the reported `prepareWallTimeMs` for a fixture receipt matches
  `computeMetricsForReceipt`'s own output for that identical receipt.
- **C5:** cacheability derives from the IMPORTED `CACHEABLE_TERMINALS` via the
  `phase→terminalPhase` bridge — not a duplicated literal and not `record.terminal.cacheable` →
  needs a fixture that mutates an entry in the real imported array and observes the recomputation
  classification pick up the change, PLUS a fixture where `record.terminal.cacheable` disagrees
  with the derived value producing a diagnostic entry, not a silent trust.
- **C6:** telemetry and receipt populations are joined best-effort, never required-paired → needs
  a test asserting a receipt-only sample still contributes wall-time stats, and a telemetry-only
  sample still contributes decision/agent-work stats.
- **C7:** `queryTelemetryReport`'s existing external behavior (including silent-skip-on-malformed-
  JSON and its `{ok, code}` return shape) is unchanged by the `_walkJsonFiles` extraction → needs
  a regression test re-running an existing `--telemetry-report` fixture and diffing output
  byte-for-byte before/after.
- **C8:** `absorbed-task/prepare-hour`'s numerator is a checked-in file-presence signal
  (`preparation.json` ∧ `absorb-entry.md`), not a live task-store/MCP query → needs a fixture
  asserting the count changes when an `absorb-entry.md` file is added/removed on disk, with zero
  MCP/provider calls made.
- **C9:** the `convergence-interval-degenerate` guard fires only on exact `startedAtMs ===
  endedAtMs` equality, never on a short-but-distinct interval → needs a paired fixture (equal →
  excluded; `endedAtMs = startedAtMs + 1` → included) — the exact trap that would otherwise
  silently zero out M195's real ~80-minute Prepare.
- **C10:** `computeCapacityReport` aggregates across ALL task IDs under the glob root by default,
  not a single hardcoded `taskId` → needs a fixture with ≥2 distinct `taskId`s under the telemetry
  root confirming both appear in the per-task/per-stratum breakdown — a live concern now that the
  real tree holds 4 distinct task IDs (14 records).
- **C11:** overlap grouping consumes the record's OWN `admission.key` → needs fixtures: two
  records sharing a key with intersecting intervals report the exact intersection minutes; a
  sequential pair and a singleton report zero.
- **C12:** `--out` is byte-reproducible → needs two consecutive runs over the same tree to diff
  byte-identical (no generation timestamp in the payload).
- **C13:** the `plugin/scripts/` mirror stays byte-identical via the EXISTING `sync-vendor.sh
  --check`/`cmp` mechanism (module confirmed in `SYNC_SCRIPTS` at `:170`) — covered by the
  existing mirror-parity AC item; no new sync mechanism invented, no `plugin/test/` mirror parity
  claimed.
- **C14:** the regenerated doc's numbers cite real sample IDs a reader can independently locate
  under `milestones/prepare-telemetry/` → needs an independent audit tracing each figure to a
  checked-in record/receipt.

### Key design decisions

- **Snapshot-agnostic by construction.** The corpus grew 8 → 10 → 14 across this authoring
  lineage; every count in this Proposal is labeled as-of, and the Execute-time regression proof
  MUST re-query, never freeze. Default aggregation is task-ID-agnostic with per-task/per-stratum
  breakdowns; a single-task reading of the charter would discard the majority of real records the
  moment the command ships.
- **Two independent sample populations, best-effort joined — never pairing-required.** Directly
  forced by the confirmed 0/8 telemetry↔receipt pairing rate; this also resolves
  `absorbed-task/prepare-hour` in favor of a receipt-only wall-time denominator that needs no
  telemetry pairing.
- **Two wall-time distributions, never pooled** — they measure different intervals (full loop
  incl. PlanCheck vs lease→record); one combined P50/P85 would be invented precision. This
  deviates deliberately from any "single headline number" desire; the doc rewrite presents both,
  labeled, with sample provenance.
- **`decision.kind`, not `decision.createsContentGeneration`, is the content-generation
  discriminator** — confirmed inverted by direct code read (`:664`) and independently re-confirmed
  against all 14 live records (all `cold`, all `false`). Routing around a landed field's
  surprising semantics (rather than "fixing" it, outside this child's `## Touches`) is the
  lower-risk choice for a read-only reporting child.
- **Reuse over reimplementation everywhere a source of truth exists** (traversal, validation,
  cacheable allowlist, receipt wall-time) — the exact "content living in two places" drift class
  this repo's CLAUDE.md names; two independently maintained copies would silently drift the next
  time DIR-126-C/D's logic changes. The ONLY new glue is the `phase→terminalPhase` bridge, forced
  by `_isCacheablePair` being unexported while `proposal-convergence.ts` is outside `## Touches`.
- **Re-derive cacheability; distrust the record's self-reported flag** — per-record
  `terminal.cacheable` can go stale under an allowlist change; the imported constant is the source
  of truth, and disagreement is surfaced as a diagnostic, not swallowed.
- **`null` vs `0` for content-agent fields is preserved, never coerced** — confirmed by direct
  read of the write path (`:665` vs `:577`/`:751`) and all 14 live records (`null`/`null` for
  `cold`). Coercing to `0` would misreport "mechanical work only" where the value was simply never
  captured.
- **The degenerate guard composes OUTSIDE `computeConvergenceMetrics`, as a distinct exclusion
  reason from `no-convergence-block`** — the reused function legitimately returns `0` for equal
  finite timestamps (arithmetically correct; DIR-125's callers depend on that contract), so the
  classification is an external, narrowly-scoped exact-equality predicate — the specific guard
  keeping M195 (the receipt behind this child's founding Finding) from silently reporting `0ms`
  once real aggregation exists.
- **The unchanged-terminal recomputation grouping key is `hashes.*` 4-tuple equality, never
  terminal-shape equality alone** — with 12 live `split-recommended` records, shape-only grouping
  would misclassify every legitimate content revision (e.g. between two `split-recommended` rounds
  where proposal text actually changed) as wasted work; whether any pair groups is checked
  per-record at Execute time, never assumed from the terminal.
- **Overlap groups by the record's own `admission.key`** — single-sourced from the data
  (`"<workspace>::<taskId>"`), not a parallel tuple the aggregator invents.
- **Concurrency overlap and unchanged-input recomputation are two separate waste-class passes**,
  not one combined heuristic, to avoid misattributing one waste class's cost to the other.
- **Join/group keys use embedded record fields, with directory names only as a taskId hint** —
  `queryTelemetryReport`'s own comment (`:153–158`) documents that layout is taskId-primary but
  `milestoneId` can change across a re-charter; the aggregator follows the same embedded-field
  authority rather than trusting path segments.
- **No new glob dependency** — `--telemetry-glob` supports exactly the fixed `<root>/**/*.json`
  shape via a string split plus the already-existing recursive walk, not a general glob engine or
  `fs.globSync` (Node ≥22.13-only, below this repo's Node-20 packaging floor).
- **No telemetry schema change** — `admission.acquiredAt`/`recordedAtMs`/`admission.key`/`hashes.*`
  already support all required interval math and grouping on every live record (confirmed on all
  14); DIR-126-D's frozen `schemaVersion: 2` stays untouched.
- **Savings are never fabricated** — `reuse-terminal`'s zero-agent-work claim is exact and
  schema-guaranteed; `estimatedAvoidedAgentMinutes` is `"unknown"` unless a real, labeled,
  reproducible comparable sample population exists.
- **Byte-reproducible report payload** (no `generatedAtMs`) so reproducibility is diff-provable
  rather than prose-asserted.
- **The throughput-doc rewrite stays a manual, human/agent-authored prose edit** citing the real
  `--out` JSON, not an automated markdown-templating step.

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| Fewer than `--min-samples` (default 3) eligible samples (telemetry ∪ receipt, post-exclusion), combined OR per-population | `{"code":"insufficient-samples", sampleCount, sampleIds, perPopulation}` — no P50/P85; exit 0 (a normal, successful report, not a usage failure) |
| Telemetry record fails `JSON.parse` | excluded, `reason: "malformed-json"`, path + parse error recorded |
| Telemetry record fails `validateTelemetryRecord` (incl. a `reuse-terminal` invariant violation) | excluded, `reason` = the validator's own code (e.g. `"reuse-terminal-invalid"`) |
| Record/receipt id listed in `--exclusions` | excluded, `reason` = the caller-supplied reason string |
| Record missing `admission.acquiredAt` or `recordedAtMs` | excluded from overlap analysis ONLY (`"interval-fields-missing"`); still counted in decision/agent-work stats and the sample count |
| `contentAgentDispatchCount`/`contentAgentMs` both `null` (cold/resume, current schema) | reported `null`/`"not-measured"`, never coerced to `0` or to the proxy value |
| Two generations' intervals for the same `admission.key` overlap | reported as real, non-zero concurrent-duplicate minutes, never suppressed |
| A sequential retry's interval starts after the prior terminal | zero concurrent-duplicate minutes; still checked for unchanged-terminal recomputation |
| Identical `hashes.*` + cacheable pair recurs without a `reuse-terminal` hit | counted as `unchangedTerminalRecomputations`; wasted work via measured value or `notMeasured`/proxy, never fabricated |
| No comparable real sample for an avoided-minute counterfactual | `estimatedAvoidedAgentMinutes: "unknown"` |
| A receipt has no `.convergence` block (M197/M201/M202/M203) | excluded from wall-time stats and the `absorbed-task/prepare-hour` denominator, `reason: "no-convergence-block"`, not treated as zero-duration |
| A receipt's `.convergence.startedAtMs === .convergence.endedAtMs` (M192, M195) | excluded from wall-time stats, `reason: "convergence-interval-degenerate"` — never a fabricated `0ms` sample |
| Derived cacheability ≠ record's self-reported `terminal.cacheable` | diagnostic entry emitted; derived value governs classification |
| `--telemetry-glob` doesn't match `<root>/**/*.json`, malformed `--exclusions` JSON, or unreadable `--workspace` | hard usage error, exit 2, matching this file's existing `parseArgs` error convention |
| Zero eligible samples at all (both populations empty) | same `insufficient-samples` path; exit 0, not an error |
| No `reuse-terminal` sample exists anywhere at Execute time (currently true: 0/14 live records) | `measuredZero` bucket reports empty/zero-count honestly, not fabricated; the report stays honest and usable; the DoD clause requiring a real `reuse-terminal` proof is explicitly flagged as a residual open item (Risks), satisfied by a real sample landing, never synthesized here |

### Compatibility

Purely additive: one new CLI mode plus one new exported function plus one shared helper on the
existing 587-line script (mirrors confirmed byte-identical live via `diff -q` during this
authoring). `checkPreparation()` (`:294`) — the function the `Prepared` gate actually calls — is
untouched; nothing here alters its control flow. `queryTelemetryReport()`'s external behavior (CLI
flag, inputs, `{ok, code}` return shape, silent-skip-on-malformed-JSON) is unchanged; only its
internal recursion is factored into the shared `_walkJsonFiles` helper, verified by an explicit
before/after regression test. Both `experiments/quay-perpetual-stream/scripts/` and
`plugin/scripts/` copies stay byte-identical via the existing `plugin/scripts/sync-vendor.sh`
`SYNC_SCRIPTS` mechanism (entry confirmed at `:170`; no new sync path). `proposal-convergence.ts`
is only imported from, never modified — it is NOT in this child's `## Touches`. No existing check
changes shape or becomes stricter, matching the charter's "why not highRisk" framing.

### Risks

- **The ≥3-real-sample DoD bar must be re-verified at Build/Verify time, never assumed from this
  Proposal's drafting-time snapshot.** As of authoring, the tree holds 14 real records across 4
  task IDs spanning 3 distinct terminal shapes — genuine diversity, met in aggregate, and up from
  10 at the last snapshot. But **zero `resume`/`reuse-terminal` records exist yet**, so the DoD's
  "real `reuse-terminal` proof" clause and the C-efficiency AC item have no real sample to cite.
  The DoD text ("at least three post-change real preparation generations of different terminal
  shapes") does not explicitly require all three from the SAME task; that scoping question should
  be resolved explicitly at Plan/Build time (the charter's framing — tolerant of "this child's own
  dispatch... plus real dispatches of other pending work" accumulating a genuine cross-task pool —
  reads as tolerant of a cross-task reading). Live counts will keep moving between authoring and
  Build — this authoring lineage itself observed 8 → 10 → 14 — so the real regression proof must
  re-query the tree at Build/Verify time, and Execute-time work must either wait for a
  `reuse-terminal` sample to occur naturally or explicitly document its absence as a residual gap,
  never fabricate one.
- **Multiple prior real generations of this exact task have terminated `split-recommended` at
  ProposalReview** (4 of DIR-126-E's own 5 live records, plus one `preflight-rejected` whose
  `admission.ownerExecutionId` is this very authoring session). Examined honestly, this Proposal's
  mechanism is a set of interdependent facets of ONE aggregation function over two joined artifact
  populations (overlap detection is only correctly interpretable alongside the recomputation check
  it needs for context), not independently shippable increments; the one genuinely separable seam
  (the `--capacity-report` code vs. the doc-regeneration edit) is already reflected as two
  distinct Requested-action items, not merged. The related filed gap
  `gap-prepare-milestone-split-decision-no-finality` (itself now showing 3 `split-recommended`
  telemetry records) documents that this mechanical split-decision signal oscillates
  non-monotonically across otherwise-similar rounds — corroborating context that repeated
  `split-recommended` verdicts on a structurally-single-function design are a known noise pattern.
  If a further real generation of this task also recommends split, that should be weighed as a
  stronger signal than this Proposal treats it, not re-litigated identically again.
- **The unpooled two-distribution decision may frustrate "one number" expectations** — the
  alternative (pooling) fabricates a statistic neither source supports; the doc presents both
  labeled distributions with sample provenance instead.
- **Telemetry-side decision/content-agent statistics may stay thin per-task even as the cross-task
  pool grows.** The report surfaces this via separate per-task and per-population sample counts,
  never blended into one combined total that hides a thin population behind a fatter one.
- **Content-agent-minutes honesty vs. AC readability tension**: reporting `notMeasured` for
  `cold`/`resume` (all 14 live records) means the regenerated doc's headline duration is wall
  time, not agent-minutes — a real, disclosed schema limitation. Extending the schema to populate
  real `contentAgentMs` for `cold`/`resume` is out of this child's scope.
- **Too few real samples produce a misleadingly precise-looking P50/P85** — mitigated by the
  explicit `insufficient-samples` default.
- **Interval-based overlap math depends on `admission.acquiredAt`/`recordedAtMs` fidelity** — both
  are wall-clock `Date.now()`-derived; clock skew across concurrent processes could in principle
  produce a spurious small overlap or gap. No distributed-clock correction exists in this repo;
  the report states numbers as observed, not corrected.
- **Malformed-record tracing makes `computeCapacityReport`'s exclusions output deliberately
  diverge from `queryTelemetryReport`'s silent-skip behavior** — an explicitly flagged divergence
  between the two functions, not an accidental mismatch.
- **Aggregating across multiple task IDs by default is an explicit design choice** (Key design
  decisions) that a single-task reading of the charter would not confront; Build should confirm
  the AC wording ("Prepare-scoped") is read as cross-task by default with per-task breakdowns
  available, not silently single-task.

### Non-goals

Not implementing DIR-126-A through DIR-126-D's own mechanisms — this child only aggregates and
reports on their real, already-landed output. Not a general-purpose analytics/dashboard system
(persistent metrics store, web view) — scoped to the Prepare-stage capacity questions this task's
AC names. Not reopening DIR-126-D's frozen telemetry schema (`schemaVersion: 2`) or changing
`queryTelemetryReport`'s existing external behavior. Not extending `proposal-convergence.ts`'s
telemetry writer to populate real per-generation `contentAgentDispatchCount`/`contentAgentMs` for
`cold`/`resume`, not fixing `decision.createsContentGeneration`'s apparent semantic inversion, and
not exporting `_isCacheablePair` — all in `proposal-convergence.ts`, all outside this child's
`## Touches`, all legitimate future `gap-*` follow-ups. Not resolving whether the DoD's "≥3
generations of different terminal shapes" bar must come from a single task or may span tasks —
flagged as an open scoping question for Plan/Build, not decided unilaterally here. Not a second
concurrency ENFORCEMENT point — overlap is reported from historical artifacts only; blocking at
dispatch time is DIR-126-A's already-landed job. Not parsing Claude Code session JSONL under any
circumstance. LOC/duration remain descriptive output only, never a productivity target.

### AC coverage (mapped to `tasks/DIR-126-E.md`'s Acceptance Criteria)

1. **Real, reachable CLI mode (the gate item)** — covered: `--capacity-report` added to the same
   independent-`if` dispatch pattern as `--build`/`--metrics`/`--telemetry-report`, verified by
   grep/import-graph plus a live subprocess invocation on both mirrors — not `--selftest`-only
   reachability (C1).
2. **Reproducible aggregation over checked-in artifacts** — covered by `computeCapacityReport`'s
   field list; every emitted field traces to a named record/receipt field, none synthesized; the
   `--out` payload is byte-reproducible (C12); unit tested plus one real `git diff`-visible CLI
   run against the now-larger (14-record) telemetry tree; the doc's flat 15–25 minute default is
   replaced from that output and no longer asserted without current samples.
3. **Sample provenance real and traceable** — covered: both populations retain source
   `recordId`/`attemptId`/receipt path; the `--out` JSON carries the raw sample-ID list; the doc
   rewrite cites it directly, so a reader can locate every cited sample under
   `milestones/prepare-telemetry/` (C14).
4. **Duplicate-generation minutes mean real overlap** — covered by pairwise interval intersection
   grouped by the record's own `admission.key` (C11), unit tested against an overlapping pair
   (exact intersection minutes), a sequential-retry pair (zero), and a single-generation case
   (zero).
5. **Degenerate intervals never silently report `0ms`** — covered by a fixture built from the
   confirmed live M192/M195 shape (`startedAtMs === endedAtMs`) plus a genuinely-short-but-distinct
   fixture (`endedAtMs = startedAtMs + 1`) proving the external exact-equality guard fires only on
   exact equality (C9).
6. **`absorbed-task/prepare-hour` numerator is file-presence, never a live query** — covered by a
   fixture asserting the count changes when `absorb-entry.md` is added/removed on disk with zero
   MCP/provider calls made (C8).
7. **C-efficiency measured separately, honest reading** — covered: `reuse-terminal`'s
   zero-content-agent claim is exact and schema-guaranteed; a recomputed cacheable terminal's
   wasted work is reported as the exact measured value when non-null, else via
   `notMeasured`/`wallTimeProxyMinutes`; avoided minutes are exact-labeled or `"unknown"`. Flagged
   as a residual open item: no real `reuse-terminal` sample exists in the corpus as of authoring
   (0/14), so the live-data proof for this item may need to wait on, or explicitly document the
   absence of, such a sample at Execute time.
8. **Feedback-efficiency inputs exported, Prepare-scoped** — partially covered:
   cold/resume/reuse-terminal minute distributions where measurable, `notMeasured`/
   `wallTimeProxyMinutes` where not, `absorbed-task/prepare-hour`, and the raw
   numerator/denominator fields needed to compute a Prepare escape rate later; token counts and
   finding-novelty/recurrence are NOT confirmed present in the current telemetry schema and are
   flagged as a genuine open item for Plan/Build, not asserted solved. Does not claim end-to-end
   verified value or an Execute escape rate from Prepare-only evidence.
9. **Machine-readable report preserves raw IDs/strata/exclusions/unknowns** — covered by the
   `--out` JSON schema, consumable later without scraping prose.
10. **`interval-fields-missing` is partial, not full** — covered by a fixture record missing
    `admission.acquiredAt`/`recordedAtMs` that is excluded from overlap analysis only, while still
    contributing to decision/agent-work stats and the sample count.
11. **Populations best-effort joined, never required-paired** — covered by paired fixtures:
    receipt-only sample still contributes wall-time stats; telemetry-only sample still contributes
    decision/agent-work stats (C6).
12. **`_walkJsonFiles` single shared primitive** — covered by source/call-site evidence plus the
    `queryTelemetryReport` before/after regression diff (C2).
13. **`validateTelemetryRecord` reused** — covered by a schema-invalid fixture landing in
    `exclusions[]` with the validator's own `{code, message}` (C3).
14. **`computeConvergenceMetrics`/`computeMetricsForReceipt` reused** — covered by a fixture
    asserting reported `prepareWallTimeMs` equals `computeMetricsForReceipt`'s own output for the
    same receipt (C4).
15. **`CACHEABLE_TERMINALS` imported via the phase bridge, not hand-copied nor self-report-trusted**
    — covered by a fixture mutating the real imported array and observing the recomputation
    classification change, plus a self-report-mismatch diagnostic fixture (C5).
16. **`queryTelemetryReport` behavior unchanged** — covered by the byte-for-byte before/after
    `--telemetry-report` regression diff (C7).
17. **Aggregation spans all task IDs by default** — covered by a ≥2-distinct-`taskId` fixture
    confirming both appear in the per-task/per-stratum breakdown (C10).
18. **Insufficient-sample honesty** — covered by the `< minSamples` default-table row, unit tested
    with a synthetic sub-threshold fixture proving the boundary alongside a real run at the current
    combined sample count (14, as of authoring — re-queried at Build time, never frozen).
19. **Mirror byte-identity** — covered by the existing `sync-vendor.sh --check`/`cmp` mechanism
    (module confirmed present in `SYNC_SCRIPTS` at `:170`), unchanged, re-run as part of Verify;
    no `plugin/test/` mirror parity claimed (C13).
20. **Grounding-evidence identifiers co-located** — every identifier used in this Proposal's
    framing and mechanism (`validateTelemetryRecord`, `CACHEABLE_TERMINALS`,
    `computeConvergenceMetrics`, `computeMetricsForReceipt`, `queryTelemetryReport`,
    `_walkJsonFiles`, `computeCapacityReport`, `admission.acquiredAt`, `recordedAtMs`,
    `admission.key`, `terminal.phase`, `decision.kind`, `contentAgentDispatchCount`,
    `contentAgentMs`, `schemaVersion: 2`, `checkPreparation`, the cited line references, and the
    live telemetry task-ID/terminal-shape enumeration) is an already-real, already-landed name
    confirmed present in the current tree by direct source read during this authoring round —
    satisfying the AC's grounding-evidence checkbox by the same direct-read standard, with
    re-verification at Build time for line numbers only.

### Alternatives considered and rejected

- **Require telemetry/receipt pairing as a hard precondition for any statistic.** Rejected —
  falsified by direct inspection: 0/8 committed receipts pair with a telemetry record, so
  requiring pairing would report `insufficient-samples` against the entire real historical
  baseline this task exists to characterize.
- **Pool both wall-time sources into one P50/P85.** Rejected as invented precision: receipt wall
  time (full loop incl. PlanCheck) and telemetry proxy (lease→record) are semantically different
  intervals; two labeled nearest-rank distributions are defensible, one blended number is not.
- **Trust `record.terminal.cacheable`.** Rejected: a per-record policy snapshot can go stale when
  `CACHEABLE_TERMINALS` changes; re-derive from the imported source of truth via the
  `phase→terminalPhase` bridge and surface disagreement as a diagnostic.
- **Export `_isCacheablePair` from `proposal-convergence.ts` instead of bridging in the
  aggregator.** Rejected: that file is outside this child's `## Touches`; a small
  `phase→terminalPhase` bridge in this file keeps the change surface exactly as scoped.
- **Fix the degenerate case inside `computeConvergenceMetrics`.** Rejected: DIR-125's callers
  depend on its current contract (`0` for equal finite timestamps is arithmetically correct); the
  classification belongs in the aggregator, externally.
- **Extend `queryTelemetryReport` in place to also aggregate**, instead of adding a new function.
  Rejected: it is contractually `milestoneId`-scoped, its callers depend on that exact
  single-milestone return shape and its silent-skip malformed-record behavior; changing it would
  violate this child's own Compatibility bar.
- **Fabricate/estimate content-agent-minutes for `cold`/`resume` from wall time via a fixed
  ratio.** Rejected: exactly the invented-precision this design's "savings are never fabricated"
  principle forbids; an honest `notMeasured` bucket plus a distinctly-labeled
  `wallTimeProxyMinutes` is more defensible and matches the existing `estimatedAvoidedAgentMinutes:
  "unknown"` precedent.
- **Trust `decision.createsContentGeneration` as written.** Rejected after direct code reading
  (`:664`, confirmed against all 14 live `cold` records) showed it inverted relative to its
  apparent name; trusting it would silently misclassify the entire live corpus as "no content
  generation."
- **Add a general glob-matching dependency (`minimatch`/`fast-glob`) or use `fs.globSync`.**
  Rejected: the one real use case is a fixed `<root>/**/*.json` shape; a new dependency, or a Node
  ≥22.13-only stdlib API below this repo's Node-20 packaging floor, buys nothing over a simple
  string split plus the already-existing recursive walk.
- **Reimplement `queryTelemetryReport`'s traversal from scratch inside the new function.**
  Rejected: two independently maintained directory walks over the same tree is the exact "content
  living in two places" drift pattern this repo's CLAUDE.md calls out to fix at the source.
- **Compute `absorbed-task/prepare-hour` from live `task_get`/`task_list` MCP queries** instead of
  checked-in `absorb-entry.md` presence. Rejected: a live provider query is a non-reproducible
  data source; `absorb-entry.md` presence is git-pinned and reproducible, matching the
  "checked-in artifacts only" bar applied consistently elsewhere in this design. (And raw
  `absorb-entry.md` presence alone is insufficient: 5 of the 13 milestones with that file have no
  receipt at all.)
- **Synthesize the overlap-grouping key as a fresh `(workspace, taskId)` tuple** instead of
  consuming the record's own `admission.key`. Rejected: the key already exists in every record as
  `"<workspace>::<taskId>"`; synthesizing a parallel tuple is a second source of truth for the
  same identity, the exact drift class this design otherwise avoids.
- **Parse Claude Code session JSONL directly** for finer-grained timing. Rejected outright:
  violates the explicit no-session-JSONL-parsing bar this repo's process establishes for this
  class of work, and session logs are not checked-in, reproducible artifacts (confirmed
  unreachable from the data itself: every live record carries `sessionId: null`).
- **A telemetry schema change adding explicit wall-clock start/end fields.** Rejected as
  unnecessary — `admission.acquiredAt`/`recordedAtMs` (confirmed present on all 14 live records)
  already support the required interval math without reopening DIR-126-D's frozen
  `schemaVersion: 2`.
- **Live, scheduler-integrated overlap detection** (enforcing/blocking at dispatch time).
  Rejected: that is DIR-126-A's already-landed concurrency-control job; this child is read-only
  reporting over historical artifacts, not a second enforcement point.
- **Hand-edit the throughput doc's numbers from session-transcript recollection**, skipping a real
  command run. Rejected: defeats the entire purpose of this child.
- **Include a `generatedAtMs` in the report.** Rejected: it would make re-runs
  non-byte-identical and turn the reproducibility AC into prose; determinism for the same input
  tree is worth more than a timestamp.
- **Restrict aggregation to a single hardcoded `taskId` (e.g. only `DIR-126-E`).** Rejected on
  fresh evidence found during this Proposal's own authoring: the real tree already spans 4
  distinct task IDs' worth of telemetry (14 records); a single-task design would discard 9 of the
  14 real records that exist today and misrepresent the tool as narrower than the actual artifact
  population it reads.
- **Split this child further** (mirroring the repeated `split-recommended` verdicts observed live
  on this exact task's telemetry — now 4 of its 5 records). Considered seriously given the
  repeated live signal, but rejected on structural grounds: the mechanism items are interdependent
  facets of one aggregation function over two joined populations (duplicate-overlap detection is
  only correctly interpretable alongside the unchanged-terminal-recomputation check it needs for
  context), not independently shippable increments; the one genuinely separable seam (code vs.
  doc-regeneration edit) is already reflected as two distinct Requested-action items. If a further
  real generation also recommends split, that should be weighed as a stronger signal than this
  Proposal treats it, not re-litigated identically.

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
  (`node milestone-preparation-check.ts --capacity-report --workspace .` against the real
  workspace root `.`) confirms the mode actually runs and produces well-formed JSON output. This item alone,
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
  disk, with no MCP/provider call made — the numerator counts distinct `taskId`s whose milestone
  directory has BOTH a `preparation.json` receipt AND an `absorb-entry.md` (the AND confirmed
  against the live tree), and the denominator is summed `computeConvergenceMetrics` wall-time over
  that same convergence-bearing receipt subset; `absorbed-task/prepare-hour` is source-of-truth from
  checked-in artifacts only, matching the "no `~/.claude/projects/**.jsonl` parsing" bar this
  child's own Key design decisions establish.
- [ ] **C efficiency is measured separately (honest-reading wording, matching `### AC coverage`
  item 5):** an identical hash/policy cacheable terminal that is recomputed increments
  `unchangedTerminalRecomputations`; its observed wasted content-agent work is reported as the exact
  measured value when `contentAgentMs` is non-null, and via the `notMeasured`/`wallTimeProxyMinutes`
  rule (never a fabricated exact number) when it is `null` — a correct `reuse-terminal` increments
  the hit count and records zero content agents, exact and schema-guaranteed. Estimated avoided
  minutes are either reproducibly labeled/model-derived or `unknown`.
- [ ] **Unchanged-terminal recomputation groups by the `hashes.*` 4-tuple, NEVER terminal-shape
  alone (negative fixture):** two records that share a cacheable terminal SHAPE (e.g. both
  `ProposalReview/split-recommended`) but carry DIFFERENT `hashes.{charter,taskContract,proposal,
  reviewPolicy}` are confirmed NOT counted as an avoidable recomputation — a fixture asserting
  `unchangedTerminalRecomputations` stays 0 for that pair. (Positive direction is covered by the
  item above; this pins the false-positive the Key-decisions section warns about: with 12 live
  `split-recommended` records, shape-only grouping would misclassify every legitimate
  between-rounds content revision as wasted work.)
- [ ] **Two wall-time distributions are reported separately, never pooled:** a fixture confirms the
  receipt-side `prepareWallTimeMs` distribution and the telemetry-side proxy
  (`recordedAtMs − admission.acquiredAt`) distribution appear as two distinctly-labeled blocks in
  the report — a fixture that would FAIL if an implementer blended both sources into one P50/P85
  (matching the Chosen-mechanism decision and the rejected "pool both wall-time sources"
  Alternative).
- [ ] **Report output is byte-reproducible across consecutive runs:** a fixture runs
  `--capacity-report ... --out a.json` and then `--out b.json` over the SAME checked-in tree and
  confirms `a.json` and `b.json` are byte-identical (`cmp`/`diff` empty) — no `generatedAtMs` or
  wall-clock timestamp leaks into the payload, so the report is mechanically diff-able, not merely
  value-stable (the specific falsification for the byte-reproducible-output decision).
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
  record into `exclusions[]` — including a `reuse-terminal` record violating
  `contentAgentDispatchCount === 0 && contentAgentMs === 0`, which is rejected with
  `{code: "reuse-terminal-invalid", message}` and routed to `exclusions[]` — never a second,
  parallel validation routine.
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
