# M139 — Scope it0 systematic-explore checks to current milestone

**Task:** DIR-076
**Milestone counter:** 139
**Chart:** 2
**Class:** methodology (instrument-correction — shipped check code)
**Value type:** instrument-correction
**Cadence:** exploit
**Deliverable:** no (loop's own gate machinery)
**Charter tokens:** ~1.0 K
**type:** learning

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (no surface cell moves — this is gate infrastructure). Real value is eliminating
the systemic pollution observed at M138: it0 checks scanning ALL historical milestone
reports, causing cascading Verify failures for new milestones due to format issues in
unrelated old reports.

## Scope

Three file changes:

1. `it0-dogfood-evidence-gate.sh` — add `--milestone <M-NN>` parameter; when provided,
   scan only current milestone + dependency reports instead of all `milestones/M*/`.
2. `it0-ceiling-check.sh` — add `--milestone <M-NN>` parameter; when provided, verify
   only charter-cited gap/directive IDs, not unrelated historical references.
3. `execute-milestone.js` Verify phase — pass `--milestone` to scoped checks.

Plus: register `historical-evidence-consistency` gate (global scan, periodic only) and
wire it as a routine probe.

## Touches
- experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh
- experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh
- .claude/workflows/execute-milestone.js

## Done-when (binary)

1. `it0-dogfood-evidence-gate.sh --milestone <M-NN>` scans only current + dependency reports.
2. `it0-ceiling-check.sh --milestone <M-NN>` verifies only charter-cited IDs.
3. Global scan (no --milestone) preserved as backward-compatible default.
4. `execute-milestone.js` Verify phase passes --milestone to scoped checks.
5. `historical-evidence-consistency` gate registered; routine probe spec created.

## Inner termination

Done-when-complete (5 clauses) OR external HALT (.halt sentinel).

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
