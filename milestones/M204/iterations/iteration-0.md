# M204 / DIR-126-E — iteration-0 (Build)

**Task:** DIR-126-E — recalibrate the prepare-milestone capacity model from real
telemetry (`--capacity-report` aggregation); fifth and final child of DIR-126's split.
**Charter:** experiments/quay-perpetual-stream/charters/M204-dir126e-capacity-report.md
**Outcome:** done (all Done-when items implemented and verified; one residual
open item disclosed per the task's own Risks/Defaults — see below).

## What was done

### Requested-action item 1 — the `--capacity-report` mode (both mirrors)

`experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` (+
byte-identical `plugin/scripts/` mirror via the existing `sync-vendor.sh`
`SYNC_SCRIPTS` mechanism, `--check` CLEAN):

- **`--capacity-report [--telemetry-glob '<root>/**/*.json'] [--workspace <dir>]
  [--exclusions <file.json>] [--min-samples N] [--out <file>]`** — a new
  independent top-level `if` dispatch block, same shape as
  `--build`/`--metrics`/`--telemetry-report`. Exit 0 for both `ok` and
  `insufficient-samples` (a normal successful report); exit 2 only on hard
  usage errors (bad glob shape, unparsable/malformed `--exclusions`, unreadable
  `--workspace`) — all four exit-2 paths regression-tested.
- **`computeCapacityReport({ workspace, telemetryRoot, exclusions, minSamples })`**
  — new pure exported aggregation over BOTH checked-in artifact populations,
  joined best-effort on embedded `(taskId, milestoneId)`, never pairing-required
  (the live pairing rate is 1/29).
- **`_walkJsonFiles(root)`** — ONE shared recursion primitive factored OUT of
  `queryTelemetryReport`'s inline `walk()`; both readers share it (C2).
  `queryTelemetryReport`'s external contract (CLI flag, `{ok, code}` shape,
  silent-skip-on-malformed-JSON, record order) is byte-for-byte unchanged —
  re-verified by the pre-existing test suite (56 pre-existing tests stay green)
  plus a new nested-layout/silent-skip regression fixture (C7).
- **`percentile(sorted, p)`** — nearest-rank, deterministic, named in every
  distribution block (`method: "nearest-rank"`).
- **`isCacheableTerminalShape(terminal)`** — the `phase → terminalPhase` bridge
  over the IMPORTED `CACHEABLE_TERMINALS` (never a hand-copied literal; the
  record's self-reported `terminal.cacheable` is never trusted — disagreement
  emits a diagnostic, derived governs).
- Reuse everywhere a source of truth exists: `validateTelemetryRecord` (its own
  `{code, message}` land in `exclusions[]`, e.g. `reuse-terminal-invalid`),
  `computeMetricsForReceipt` → `computeConvergenceMetrics` for receipt wall
  time (never re-derived), `admission.key` for overlap grouping (never
  synthesized), `hashes.*` 4-tuple for recomputation grouping (never
  terminal-shape alone).
- Design traps guarded per the task's Problem framing: `decision.kind`
  (not the inverted `createsContentGeneration`) is the content-generation
  discriminator; `contentAgentMs: null` preserved as `notMeasured` (never
  coerced to 0); external exact-equality guard excludes `startedAtMs ===
  endedAtMs` receipts as `convergence-interval-degenerate` (the M195 ~80-minute
  trap), firing only on exact equality — a +1ms interval stays included;
  two wall-time distributions never pooled; output byte-reproducible (no
  `generatedAtMs`, all arrays/key-maps sorted — `cmp`-verified identical
  across consecutive runs).
- `checkPreparation()` (the one function the `Prepared` gate calls) is
  untouched; `proposal-convergence.ts` imported from only, never modified
  (not in `## Touches`). No new write path into either artifact tree.

### Requested-action item 2 — throughput doc regenerated from real output

`docs/proposals/quay-milestone-workflow-throughput-capacity-model.md` §4: the
flat "15–25 minutes" assumption is retired and replaced, from a real
`--capacity-report` run against the live tree, with BOTH labeled unpooled
distributions (telemetry proxy n=26: P50 29.1m / P85 58.8m; receipt
prepareWallTimeMs n=3: P50 20.9m / P85=max 219.3m), the full 26-record-ID +
3-receipt-path sample provenance, the 8 reasoned receipt exclusions, yield /
waste-class / absorption figures, and honest schema limits. The pipelining
arithmetic is recomputed from the real P50/P85.

### Requested-action item 3 — real test fixtures

24 new tests appended to
`experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs`
(80/80 pass), one per AC clause: correct nearest-rank P50/P85 over ≥3
real-shaped samples across ≥2 taskIds; insufficient-samples (combined AND
per-population gate, plus the `--min-samples 1` boundary); traced
malformed-JSON exclusion; `reuse-terminal-invalid` via the reused validator
(C3); receipt wall time equal to `computeMetricsForReceipt`'s own output (C4);
CACHEABLE_TERMINALS-mutation + self-report-mismatch diagnostics (C5);
best-effort join with receipt-only and telemetry-only contributors (C6);
nested-layout/silent-skip regression (C7); `absorb-entry.md` add/remove moves
the numerator with zero provider calls (C8); the degenerate/+1ms guard pair
(C9); ≥2-distinct-taskId per-task breakdown (C10); exact 1-minute overlap vs
zero sequential vs no-singleton-group (C11); byte-identical `--out` runs with
no `generatedAtMs` (C12); live subprocess invocations on BOTH mirrors plus the
real workspace root (C1, the gate item); exit-2 usage errors; positive
recomputation (+ correct reuse-terminal as a hit, not waste) and the negative
same-shape/different-hashes fixture; partial `interval-fields-missing`;
caller-supplied exclusions; `estimatedAvoidedAgentMinutes: "unknown"` honesty;
empty-tree `insufficient-samples` with exit-0 semantics.

### Requested-action item 4 — real regression proof

Live `--capacity-report --workspace .` run (exit 0, `code: ok`): 29 eligible
samples — 26 telemetry records across 4 distinct task IDs spanning **6 distinct
terminal shapes** (`ProposalReview/split-recommended` ×16,
`PreflightPlan/preflight-rejected` ×5, `Receipt/prepared` ×2,
`PreflightContent/preflight-rejected` ×1,
`ProposalReview/wiring-coverage-check-failed` ×1,
`PlanCheck/plancheck-rounds-exceeded` ×1) — clearing the DoD's ≥3-different-
terminal-shapes bar in aggregate (the charter's cross-task reading), plus 3
convergence-bearing non-degenerate receipts (M198, M200, M206). The doc's
figures trace to exactly these checked-in record IDs (re-verified after the
doc edit: identical numbers, identical ID list). Concurrent duplicate minutes
= 0 across all four `admission.key` groups; unchanged-terminal recomputations
= 0; absorbed-task/prepare-hour = 9 / 4.004h ≈ 2.25.

## Residual open item (disclosed per the task's own Risks/Defaults)

**No real `reuse-terminal` sample exists in the live corpus (0/26).** The
zero-content-agent claim for reuse is exact and schema-guaranteed (and
fixture-proven), but the DoD clause wanting a REAL `reuse-terminal` proof has
no live sample to cite; per the task's own Defaults table this is flagged
honestly in the regenerated doc (§4 "Honest limits") rather than fabricated.
`estimatedAvoidedAgentMinutes` is the literal `"unknown"` for the same reason.
Closes when a real `reuse-terminal` generation lands naturally, never by
synthesis here.

## Verification summary

- `scripts/test.sh experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs` → 80/80 pass.
- `sync-vendor.sh --check` → CLEAN; canonical and `plugin/` mirrors `diff -q` byte-identical.
- Live `--capacity-report --workspace .` twice → `cmp` byte-identical, exit 0, `code: ok`.
- Full-suite note: the only failures in `scripts/test.sh` are the two
  pre-existing `WIRING-CLAIM R9` tests in
  `plugin/test/prepare-milestone-convergence.test.mjs` (asserting an empty
  `git diff` against base `480cb58` for `prepare-admission-check.ts`, which
  landed commits `c82efac`/`68eb5eb` modified) — confirmed failing on pristine
  HEAD with this iteration's changes stashed; unrelated to DIR-126-E's touch
  set.

## Files touched (matches `## Touches`)

- `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts`
- `plugin/scripts/milestone-preparation-check.ts` (sync-vendor mirror)
- `experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs`
- `docs/proposals/quay-milestone-workflow-throughput-capacity-model.md`
- (`tasks/DIR-126-E.md` — `extra.acceptance` set via `task_write` pre-flight)
