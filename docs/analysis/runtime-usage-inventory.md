# Runtime-Usage Inventory — what the two-layer mode actually runs

Generated at: `2026-08-03T04:06:42.196Z` · repo root `/tmp/quay-wt-inventory`

## Scope

- **Enumerated:** 205 distinct scripts by realpath (220 raw filesystem entries incl. symlinks) across `plugin/scripts` · `experiments/**/scripts` · `.claude/workflows` · `scripts`.
- **Main window:** `2026-08-02T11:00:00Z` → `2026-08-03T02:54:00Z` (15.9h), 3625 Bash/Workflow commands read from `/home/yale/.claude/projects/-home-yale-work-quay`, scoped to inner-layer sessions `3bbd3095-de01-467c-8c6e-abb00f342e53`, `82ecfb6a-94ba-462d-ac8d-dfa0984e6dbf`, `47eb704e-a8a7-4e2f-9ad6-e419f4dc51eb`.
- **Long contrast window:** `2026-07-31T02:54:00.000Z` → `2026-08-03T02:54:00Z` (72h), 11624 commands. A script unaccounted in the main window but executed in the long window is **low-frequency, not dead** — listed in the diff set.
- **Class semantics:** `live` executed>0 · `library` imported>0 · `ci-only` in `.github/workflows` · `dormant-by-decision` in the exp6 §0 seal list · `never-runs-test` a `*.test.*` outside `scripts/test.sh`'s canonical glob · `unaccounted` none of the above.

> **unaccounted ≠ deletable.** `unaccounted` means "no evidence explains why this script is here" — it is the *candidate pool* for a later decision, not a deletion list. Calling it "safe to delete" would delete exp5's deliberately sealed metering machinery (chart2/git-lens/portfolio/VT).

## Summary

| class | count |
|---|---|
| live | 36 |
| library | 72 |
| ci-only | 1 |
| dormant-by-decision | 7 |
| never-runs-test | 8 |
| unaccounted | 81 |
| **total** | 205 |

**unaccounted (81):**

- `.claude/workflows/diagnose-verify-failure.js`
- `.claude/workflows/drain-directives.js`
- `.claude/workflows/execute-milestone.js`
- `.claude/workflows/prepare-milestone.js`
- `.claude/workflows/run-routines.js`
- `.claude/workflows/select-preflight.js`
- `experiments/quay-perpetual-stream/fixtures/loadbearing/scripts/fixture-counter-gate.mjs`
- `experiments/quay-perpetual-stream/fixtures/loadbearing/scripts/fixture-importer.mjs`
- `experiments/quay-perpetual-stream/fixtures/loadbearing/scripts/fixture-registered.mjs`
- `experiments/quay-perpetual-stream/fixtures/loadbearing/scripts/fixture-standalone.mjs`
- `experiments/quay-perpetual-stream/scripts/anti-drift-touches-check.sh`
- `experiments/quay-perpetual-stream/scripts/anti-drift-touches-selfcheck.sh`
- `experiments/quay-perpetual-stream/scripts/audit-independence-check.sh`
- `experiments/quay-perpetual-stream/scripts/audit-independence-selfcheck.sh`
- `experiments/quay-perpetual-stream/scripts/build-evidence-gate.ts`
- `experiments/quay-perpetual-stream/scripts/chart-headroom.ts`
- `experiments/quay-perpetual-stream/scripts/composite-manifest-synthesis.ts`
- `experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler-selfcheck.sh`
- `experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.sh`
- `experiments/quay-perpetual-stream/scripts/config-wiring-selfcheck.sh`
- `experiments/quay-perpetual-stream/scripts/deliverable-governor-fixture.json`
- `experiments/quay-perpetual-stream/scripts/derive-touches-heuristic-selfcheck.sh`
- `experiments/quay-perpetual-stream/scripts/explore-exploit-cadence.ts`
- `experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.sh`
- `experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.ts`
- `experiments/quay-perpetual-stream/scripts/it0-backlog-regen.ts`
- `experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh`
- `experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh`
- `experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check-selfcheck.sh`
- `experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check.sh`
- `experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh`
- `experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.sh`
- `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh`
- `experiments/quay-perpetual-stream/scripts/it0-impl-row-check.sh`
- `experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.sh`
- `experiments/quay-perpetual-stream/scripts/it0-task-bulk-write.ts`
- `experiments/quay-perpetual-stream/scripts/loadbearing-test-gate-selfcheck.sh`
- `experiments/quay-perpetual-stream/scripts/regenerate-backlog-view.ts`
- `experiments/quay-perpetual-stream/scripts/rolling-slope-selfcheck.sh`
- `experiments/quay-perpetual-stream/scripts/routine-file-gate-selfcheck.sh`
- `experiments/quay-perpetual-stream/scripts/routine-scheduler-selfcheck.sh`
- `experiments/quay-perpetual-stream/scripts/run-identity.ts`
- `experiments/quay-perpetual-stream/scripts/serial-fanin-absorb-selfcheck.sh`
- `experiments/quay-perpetual-stream/scripts/serial-fanin-absorb.sh`
- `experiments/quay-perpetual-stream/scripts/task-schema-check.sh`
- `experiments/quay-perpetual-stream/scripts/task-schema-check.ts`
- `experiments/quay-perpetual-stream/scripts/termination-delta-v-check.ts`
- `experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.sh`
- `experiments/quay-perpetual-stream/scripts/touches-orthogonality-selfcheck.sh`
- `experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh`
- `experiments/quay-perpetual-stream/scripts/tsconfig.json`
- `experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh`
- `experiments/quay-perpetual-stream/scripts/workflow-metadata-conformance.mjs`
- `experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh`
- `plugin/scripts/anti-gaming-guard.sh`
- `plugin/scripts/anti-gaming-guard.ts`
- `plugin/scripts/audit-independence-check.sh`
- `plugin/scripts/audit-independence-check.ts`
- `plugin/scripts/build-evidence-collector.ts`
- `plugin/scripts/build-evidence-gate.ts`
- `plugin/scripts/candidate-synthesis.ts`
- `plugin/scripts/codex-stage1-live-proof-check.ts`
- `plugin/scripts/codex-stage1-selfcheck.sh`
- `plugin/scripts/composite-land.ts`
- `plugin/scripts/config-wiring-check.ts`
- `plugin/scripts/drivable-workspace-check.sh`
- `plugin/scripts/gate-script-lib.sh`
- `plugin/scripts/it0-enforcement-with-design-check.sh`
- `plugin/scripts/it0-enforcement-with-design-check.ts`
- `plugin/scripts/it0-impl-row-check.sh`
- `plugin/scripts/loadbearing-test-gate.sh`
- `plugin/scripts/loadbearing-test-gate.ts`
- `plugin/scripts/preparation-feedback.ts`
- `plugin/scripts/run-identity.ts`
- `plugin/scripts/task-schema-check.sh`
- `plugin/scripts/tree-hygiene-check.sh`
- `plugin/scripts/vmeta-lag-check.sh`
- `plugin/scripts/vmeta-lag-check.ts`
- `plugin/scripts/workflow-invariant-ownership.mjs`
- `plugin/scripts/worktree-branch-hygiene-check.sh`
- `scripts/agents-claude-drift-check.ts`

**never-runs-test (8)** — written but never in the canonical suite:

- `experiments/quay-perpetual-stream/scripts/anti-gaming-guard.test.ts`
- `experiments/quay-perpetual-stream/scripts/chart-saturation-check.test.ts`
- `experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.test.ts`
- `experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.test.ts`
- `experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.test.mjs`
- `experiments/quay-perpetual-stream/scripts/milestones-since-transition.test.ts`
- `scripts/delivery-manifest-check.test.ts`
- `scripts/version-consistency-check.test.ts`

**dormant-by-decision (7)** — classified dormant in the main window (exp6 §0 seal list, explicit, source-cited):

- `experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts`
- `experiments/quay-perpetual-stream/scripts/git-lens-l-g-structural-drift.ts`
- `experiments/quay-perpetual-stream/scripts/git-lens-l-s-behavior-variance.ts`
- `experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh`
- `experiments/quay-perpetual-stream/scripts/governance-product-ratio-selfcheck.sh`
- `experiments/quay-perpetual-stream/scripts/outward-vt-selfcheck.sh`
- `plugin/scripts/portfolio-choice.ts`

**Sealed by exp6 §0 (full 13-entry list, shown with their ACTUAL class):**

- `experiments/quay-perpetual-stream/scripts/chart2-s1-distribution-reliability.ts` → **`library`** — sealed, but `library` takes priority (imported by its own governance test)
- `experiments/quay-perpetual-stream/scripts/chart2-s2-delivery-completeness.ts` → **`library`** — sealed, but `library` takes priority (imported by its own governance test)
- `experiments/quay-perpetual-stream/scripts/chart2-s3-external-validation.ts` → **`library`** — sealed, but `library` takes priority (imported by its own governance test)
- `experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts` → **`dormant-by-decision`**
- `experiments/quay-perpetual-stream/scripts/git-lens-l-g-structural-drift.ts` → **`dormant-by-decision`**
- `experiments/quay-perpetual-stream/scripts/git-lens-l-s-behavior-variance.ts` → **`dormant-by-decision`**
- `experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh` → **`dormant-by-decision`**
- `experiments/quay-perpetual-stream/scripts/governance-product-ratio-check.ts` → **`library`** — sealed, but `library` takes priority (imported by its own governance test)
- `experiments/quay-perpetual-stream/scripts/governance-product-ratio-selfcheck.sh` → **`dormant-by-decision`**
- `experiments/quay-perpetual-stream/scripts/outward-vt-check.ts` → **`library`** — sealed, but `library` takes priority (imported by its own governance test)
- `experiments/quay-perpetual-stream/scripts/outward-vt-selfcheck.sh` → **`dormant-by-decision`**
- `experiments/quay-perpetual-stream/scripts/portfolio-choice.ts` → **`library`** — sealed, but `library` takes priority (imported by its own governance test)
- `plugin/scripts/portfolio-choice.ts` → **`dormant-by-decision`**

**ci-only (1):**

- `plugin/scripts/publish-dist-branch.sh`

## Main → long window diff (51) — low-frequency, not dead

Scripts with `executed == 0` in the main window but `executed > 0` in the 72h window. These are cadence-driven (milestone / CI-triggered), not dead.

| script | main class | main executed | long executed |
|---|---|---|---|
| `.claude/workflows/drain-directives.js` | unaccounted | 0 | 2 |
| `.claude/workflows/execute-milestone.js` | unaccounted | 0 | 47 |
| `.claude/workflows/prepare-milestone.js` | unaccounted | 0 | 280 |
| `.claude/workflows/run-routines.js` | unaccounted | 0 | 2 |
| `.claude/workflows/select-preflight.js` | unaccounted | 0 | 1 |
| `experiments/quay-perpetual-stream/scripts/anti-drift-touches-selfcheck.sh` | unaccounted | 0 | 3 |
| `experiments/quay-perpetual-stream/scripts/build-evidence-gate.ts` | unaccounted | 0 | 4 |
| `experiments/quay-perpetual-stream/scripts/build-evidence-manifest.ts` | library | 0 | 4 |
| `experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler-selfcheck.sh` | unaccounted | 0 | 7 |
| `experiments/quay-perpetual-stream/scripts/config-wiring-selfcheck.sh` | unaccounted | 0 | 10 |
| `experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.ts` | library | 0 | 2 |
| `experiments/quay-perpetual-stream/scripts/drain-dispose-corruption-check.ts` | library | 0 | 4 |
| `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts` | library | 0 | 1 |
| `experiments/quay-perpetual-stream/scripts/it0-backlog-regen.ts` | unaccounted | 0 | 2 |
| `experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check.sh` | unaccounted | 0 | 2 |
| `experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh` | unaccounted | 0 | 2 |
| `experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts` | library | 0 | 7 |
| `experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.ts` | library | 0 | 2 |
| `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` | library | 0 | 28 |
| `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` | library | 0 | 70 |
| `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` | library | 0 | 130 |
| `experiments/quay-perpetual-stream/scripts/routine-file-gate-selfcheck.sh` | unaccounted | 0 | 2 |
| `experiments/quay-perpetual-stream/scripts/routine-scheduler-selfcheck.sh` | unaccounted | 0 | 2 |
| `experiments/quay-perpetual-stream/scripts/run-identity.ts` | unaccounted | 0 | 11 |
| `experiments/quay-perpetual-stream/scripts/serial-fanin-absorb-selfcheck.sh` | unaccounted | 0 | 2 |
| `experiments/quay-perpetual-stream/scripts/sweep-fixture-orphans.mjs` | library | 0 | 9 |
| `experiments/quay-perpetual-stream/scripts/task-schema-check.sh` | unaccounted | 0 | 3 |
| `experiments/quay-perpetual-stream/scripts/task-schema-check.ts` | unaccounted | 0 | 7 |
| `experiments/quay-perpetual-stream/scripts/touches-orthogonality-selfcheck.sh` | unaccounted | 0 | 2 |
| `experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` | unaccounted | 0 | 11 |
| `experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh` | unaccounted | 0 | 4 |
| `experiments/quay-perpetual-stream/scripts/vmeta-lag-check.ts` | library | 0 | 1 |
| `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` | library | 0 | 33 |
| `experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs` | library | 0 | 4 |
| `experiments/quay-perpetual-stream/scripts/workflow-metadata-conformance.mjs` | unaccounted | 0 | 20 |
| `experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh` | unaccounted | 0 | 6 |
| `plugin/scripts/anti-drift-touches-check.ts` | library | 0 | 2 |
| `plugin/scripts/build-evidence-collector.ts` | unaccounted | 0 | 1 |
| `plugin/scripts/build-evidence-gate.ts` | unaccounted | 0 | 1 |
| `plugin/scripts/build-evidence-manifest.ts` | library | 0 | 1 |
| `plugin/scripts/codex-stage1-live-proof-check.ts` | unaccounted | 0 | 1 |
| `plugin/scripts/codex-stage1-selfcheck.sh` | unaccounted | 0 | 5 |
| `plugin/scripts/concurrent-batch-scheduler.ts` | library | 0 | 2 |
| `plugin/scripts/config-wiring-check.ts` | unaccounted | 0 | 1 |
| `plugin/scripts/prepare-admission-check.ts` | library | 0 | 3 |
| `plugin/scripts/proposal-convergence.ts` | library | 0 | 3 |
| `plugin/scripts/routine-file-gate.ts` | library | 0 | 1 |
| `plugin/scripts/run-identity.ts` | unaccounted | 0 | 4 |
| `plugin/scripts/touches-orthogonality-check.ts` | library | 0 | 3 |
| `plugin/scripts/tree-hygiene-check.sh` | unaccounted | 0 | 4 |
| `scripts/agents-claude-drift-check.ts` | unaccounted | 0 | 8 |

Of those, **unaccounted → live** (31): `.claude/workflows/drain-directives.js` (×2), `.claude/workflows/execute-milestone.js` (×47), `.claude/workflows/prepare-milestone.js` (×280), `.claude/workflows/run-routines.js` (×2), `.claude/workflows/select-preflight.js` (×1), `experiments/quay-perpetual-stream/scripts/anti-drift-touches-selfcheck.sh` (×3), `experiments/quay-perpetual-stream/scripts/build-evidence-gate.ts` (×4), `experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler-selfcheck.sh` (×7), `experiments/quay-perpetual-stream/scripts/config-wiring-selfcheck.sh` (×10), `experiments/quay-perpetual-stream/scripts/it0-backlog-regen.ts` (×2), `experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check.sh` (×2), `experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh` (×2), `experiments/quay-perpetual-stream/scripts/routine-file-gate-selfcheck.sh` (×2), `experiments/quay-perpetual-stream/scripts/routine-scheduler-selfcheck.sh` (×2), `experiments/quay-perpetual-stream/scripts/run-identity.ts` (×11), `experiments/quay-perpetual-stream/scripts/serial-fanin-absorb-selfcheck.sh` (×2), `experiments/quay-perpetual-stream/scripts/task-schema-check.sh` (×3), `experiments/quay-perpetual-stream/scripts/task-schema-check.ts` (×7), `experiments/quay-perpetual-stream/scripts/touches-orthogonality-selfcheck.sh` (×2), `experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` (×11), `experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh` (×4), `experiments/quay-perpetual-stream/scripts/workflow-metadata-conformance.mjs` (×20), `experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh` (×6), `plugin/scripts/build-evidence-collector.ts` (×1), `plugin/scripts/build-evidence-gate.ts` (×1), `plugin/scripts/codex-stage1-live-proof-check.ts` (×1), `plugin/scripts/codex-stage1-selfcheck.sh` (×5), `plugin/scripts/config-wiring-check.ts` (×1), `plugin/scripts/run-identity.ts` (×4), `plugin/scripts/tree-hygiene-check.sh` (×4), `scripts/agents-claude-drift-check.ts` (×8)

## Full table (205)

| script | cat | exec | imp | ci | test-glob | class | long-exec | note |
|---|---|---|---|---|---|---|---|---|
| `.claude/workflows/diagnose-verify-failure.js` | workflows | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `.claude/workflows/drain-directives.js` | workflows | 0 | 0 | 0 | — | **unaccounted** | 2 |  |
| `.claude/workflows/execute-milestone.js` | workflows | 0 | 0 | 0 | — | **unaccounted** | 47 |  |
| `.claude/workflows/prepare-milestone.js` | workflows | 0 | 0 | 0 | — | **unaccounted** | 280 |  |
| `.claude/workflows/run-routines.js` | workflows | 0 | 0 | 0 | — | **unaccounted** | 2 |  |
| `.claude/workflows/select-preflight.js` | workflows | 0 | 0 | 0 | — | **unaccounted** | 1 |  |
| `experiments/quay-perpetual-stream/fixtures/loadbearing/scripts/fixture-counter-gate.mjs` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/fixtures/loadbearing/scripts/fixture-imported.mjs` | exp | 0 | 2 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/fixtures/loadbearing/scripts/fixture-importer.mjs` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/fixtures/loadbearing/scripts/fixture-registered.mjs` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/fixtures/loadbearing/scripts/fixture-standalone.mjs` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/anti-drift-touches-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/anti-drift-touches-selfcheck.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 3 |  |
| `experiments/quay-perpetual-stream/scripts/anti-gaming-guard.test.ts` | exp | 0 | 0 | 0 | — | **never-runs-test** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/anti-gaming-guard.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/audit-independence-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/audit-independence-check.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/audit-independence-selfcheck.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts` | exp | 1 | 0 | 0 | — | **live** | 19 |  |
| `experiments/quay-perpetual-stream/scripts/build-evidence-gate.ts` | exp | 0 | 0 | 0 | — | **unaccounted** | 4 |  |
| `experiments/quay-perpetual-stream/scripts/build-evidence-manifest.ts` | exp | 0 | 4 | 0 | — | **library** | 4 |  |
| `experiments/quay-perpetual-stream/scripts/candidate-contracts.ts` | exp | 0 | 15 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/candidate-synthesis-fixtures.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/candidate-synthesis.ts` | exp | 0 | 2 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/chart-headroom.ts` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/chart-saturation-check.test.ts` | exp | 0 | 0 | 0 | — | **never-runs-test** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/chart-saturation-check.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/chart2-s1-distribution-reliability.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/chart2-s2-delivery-completeness.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/chart2-s3-external-validation.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/composite-args.ts` | exp | 0 | 2 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/composite-audit.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/composite-build.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/composite-contracts.ts` | exp | 0 | 6 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/composite-land.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/composite-manifest-synthesis.ts` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/composite-preflight.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/composite-reconcile.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler-selfcheck.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 7 |  |
| `experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/config-wiring-selfcheck.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 10 |  |
| `experiments/quay-perpetual-stream/scripts/coupling-graph.ts` | exp | 0 | 5 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/deliverable-governor-fixture.json` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 | non-script file (config/fixture) |
| `experiments/quay-perpetual-stream/scripts/deliverable-governor.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/derive-touches-heuristic-selfcheck.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.test.ts` | exp | 0 | 0 | 0 | — | **never-runs-test** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.ts` | exp | 0 | 2 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.test.ts` | exp | 0 | 0 | 0 | — | **never-runs-test** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.ts` | exp | 0 | 1 | 0 | — | **library** | 2 |  |
| `experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh` | exp | 2 | 0 | 0 | — | **live** | 8 | executed via live .sh wrapper |
| `experiments/quay-perpetual-stream/scripts/drain-dispose-corruption-check.ts` | exp | 0 | 1 | 0 | — | **library** | 4 |  |
| `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts` | exp | 0 | 1 | 0 | — | **library** | 1 |  |
| `experiments/quay-perpetual-stream/scripts/explore-exploit-cadence.ts` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/gate-script-base.ts` | exp | 0 | 7 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/gate-script-lib.sh` | exp | 1 | 0 | 0 | — | **live** | 1 | executed via live .sh wrapper |
| `experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts` | exp | 0 | 0 | 0 | — | **dormant-by-decision** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/git-lens-l-g-structural-drift.ts` | exp | 0 | 0 | 0 | — | **dormant-by-decision** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/git-lens-l-s-behavior-variance.ts` | exp | 0 | 0 | 0 | — | **dormant-by-decision** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh` | exp | 0 | 0 | 0 | — | **dormant-by-decision** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/golden-replay-dir044.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/governance-product-ratio-check.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/governance-product-ratio-selfcheck.sh` | exp | 0 | 0 | 0 | — | **dormant-by-decision** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/human-steered-classify.ts` | exp | 0 | 2 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.ts` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/it0-backlog-regen.ts` | exp | 0 | 0 | 0 | — | **unaccounted** | 2 |  |
| `experiments/quay-perpetual-stream/scripts/it0-ceiling-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check-selfcheck.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/it0-dashboard-line-budget-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 2 |  |
| `experiments/quay-perpetual-stream/scripts/it0-dod-check.sh` | exp | 4 | 0 | 0 | — | **live** | 13 |  |
| `experiments/quay-perpetual-stream/scripts/it0-dod-check.ts` | exp | 2 | 2 | 0 | — | **live** | 3 | executed via live .sh wrapper |
| `experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 2 |  |
| `experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.test.mjs` | exp | 1 | 0 | 0 | — | **live** | 1 |  |
| `experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.ts` | exp | 11 | 2 | 0 | — | **live** | 11 |  |
| `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/it0-impl-row-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.test.mjs` | exp | 0 | 0 | 0 | — | **never-runs-test** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts` | exp | 0 | 2 | 0 | — | **library** | 7 |  |
| `experiments/quay-perpetual-stream/scripts/it0-task-bulk-write.ts` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/loadbearing-test-gate-selfcheck.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh` | exp | 1 | 0 | 0 | — | **live** | 1 | executed via live .sh wrapper |
| `experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.ts` | exp | 0 | 1 | 0 | — | **library** | 2 |  |
| `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` | exp | 0 | 6 | 0 | — | **library** | 28 |  |
| `experiments/quay-perpetual-stream/scripts/milestones-since-transition.test.ts` | exp | 0 | 0 | 0 | — | **never-runs-test** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/milestones-since-transition.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/outward-vt-check.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/outward-vt-selfcheck.sh` | exp | 0 | 0 | 0 | — | **dormant-by-decision** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/portfolio-choice.ts` | exp | 0 | 3 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/preparation-feedback.ts` | exp | 0 | 2 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts` | exp | 0 | 2 | 0 | — | **library** | 70 |  |
| `experiments/quay-perpetual-stream/scripts/proposal-convergence.ts` | exp | 0 | 5 | 0 | — | **library** | 130 |  |
| `experiments/quay-perpetual-stream/scripts/regenerate-backlog-view.ts` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh` | exp | 5 | 0 | 0 | — | **live** | 11 |  |
| `experiments/quay-perpetual-stream/scripts/rolling-slope-check.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/rolling-slope-selfcheck.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/routine-file-gate-selfcheck.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 2 |  |
| `experiments/quay-perpetual-stream/scripts/routine-scheduler-selfcheck.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 2 |  |
| `experiments/quay-perpetual-stream/scripts/run-identity.ts` | exp | 0 | 0 | 0 | — | **unaccounted** | 11 |  |
| `experiments/quay-perpetual-stream/scripts/safe-json-parse.sh` | exp | 1 | 0 | 0 | — | **live** | 1 | executed via live .sh wrapper |
| `experiments/quay-perpetual-stream/scripts/select-preflight.ts` | exp | 1 | 2 | 0 | — | **live** | 5 |  |
| `experiments/quay-perpetual-stream/scripts/serial-fanin-absorb-selfcheck.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 2 |  |
| `experiments/quay-perpetual-stream/scripts/serial-fanin-absorb.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/sweep-fixture-orphans.mjs` | exp | 0 | 2 | 0 | — | **library** | 9 |  |
| `experiments/quay-perpetual-stream/scripts/task-schema-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 3 |  |
| `experiments/quay-perpetual-stream/scripts/task-schema-check.ts` | exp | 0 | 0 | 0 | — | **unaccounted** | 7 |  |
| `experiments/quay-perpetual-stream/scripts/task-schema-selfcheck.sh` | exp | 1 | 0 | 0 | — | **live** | 1 | executed via live .sh wrapper |
| `experiments/quay-perpetual-stream/scripts/task-schema.ts` | exp | 0 | 11 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/termination-delta-v-check.ts` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/touches-orthogonality-selfcheck.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 2 |  |
| `experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 11 |  |
| `experiments/quay-perpetual-stream/scripts/tsconfig.json` | exp | 0 | 0 | 0 | — | **unaccounted** | 0 | non-script file (config/fixture) |
| `experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 4 |  |
| `experiments/quay-perpetual-stream/scripts/vmeta-lag-check.ts` | exp | 0 | 2 | 0 | — | **library** | 1 |  |
| `experiments/quay-perpetual-stream/scripts/vmeta-lag-selfcheck.sh` | exp | 1 | 0 | 0 | — | **live** | 1 | executed via live .sh wrapper |
| `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` | exp | 0 | 4 | 0 | — | **library** | 33 |  |
| `experiments/quay-perpetual-stream/scripts/workflow-baseline-metrics.ts` | exp | 0 | 1 | 0 | — | **library** | 0 |  |
| `experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs` | exp | 0 | 1 | 0 | — | **library** | 4 |  |
| `experiments/quay-perpetual-stream/scripts/workflow-invariant-ownership.mjs` | exp | 4 | 0 | 0 | — | **live** | 11 |  |
| `experiments/quay-perpetual-stream/scripts/workflow-metadata-conformance.mjs` | exp | 0 | 0 | 0 | — | **unaccounted** | 20 |  |
| `experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh` | exp | 0 | 0 | 0 | — | **unaccounted** | 6 |  |
| `plugin/scripts/anti-drift-touches-check.ts` | plug | 0 | 2 | 0 | — | **library** | 2 |  |
| `plugin/scripts/anti-gaming-guard.sh` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/anti-gaming-guard.ts` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/audit-independence-check.sh` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/audit-independence-check.ts` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/build-evidence-collector.ts` | plug | 0 | 0 | 0 | — | **unaccounted** | 1 |  |
| `plugin/scripts/build-evidence-gate.ts` | plug | 0 | 0 | 0 | — | **unaccounted** | 1 |  |
| `plugin/scripts/build-evidence-manifest.ts` | plug | 0 | 4 | 0 | — | **library** | 1 |  |
| `plugin/scripts/candidate-contracts.ts` | plug | 0 | 10 | 0 | — | **library** | 0 |  |
| `plugin/scripts/candidate-synthesis.ts` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/codex-stage1-live-proof-check.ts` | plug | 0 | 0 | 0 | — | **unaccounted** | 1 |  |
| `plugin/scripts/codex-stage1-selfcheck.sh` | plug | 0 | 0 | 0 | — | **unaccounted** | 5 |  |
| `plugin/scripts/composite-args.ts` | plug | 0 | 1 | 0 | — | **library** | 0 |  |
| `plugin/scripts/composite-audit.ts` | plug | 0 | 2 | 0 | — | **library** | 0 |  |
| `plugin/scripts/composite-build.ts` | plug | 0 | 2 | 0 | — | **library** | 0 |  |
| `plugin/scripts/composite-contracts.ts` | plug | 0 | 4 | 0 | — | **library** | 0 |  |
| `plugin/scripts/composite-land.ts` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/composite-manifest-synthesis.ts` | plug | 0 | 1 | 0 | — | **library** | 0 |  |
| `plugin/scripts/composite-preflight.ts` | plug | 0 | 1 | 0 | — | **library** | 0 |  |
| `plugin/scripts/composite-reconcile.ts` | plug | 0 | 7 | 0 | — | **library** | 0 |  |
| `plugin/scripts/concurrent-batch-scheduler.ts` | plug | 0 | 3 | 0 | — | **library** | 2 |  |
| `plugin/scripts/config-wiring-check.ts` | plug | 0 | 0 | 0 | — | **unaccounted** | 1 |  |
| `plugin/scripts/coupling-graph.ts` | plug | 0 | 3 | 0 | — | **library** | 0 |  |
| `plugin/scripts/drivable-workspace-check.sh` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/drivable-workspace-check.ts` | plug | 0 | 3 | 0 | — | **library** | 0 |  |
| `plugin/scripts/fast-mode-telemetry.ts` | plug | 145 | 1 | 0 | — | **live** | 246 |  |
| `plugin/scripts/gate-dispatch-coverage.ts` | plug | 2 | 1 | 0 | — | **live** | 34 |  |
| `plugin/scripts/gate-script-base.ts` | plug | 0 | 13 | 0 | — | **library** | 0 |  |
| `plugin/scripts/gate-script-lib.sh` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/inner-blocked-signal.ts` | plug | 21 | 0 | 0 | — | **live** | 21 | executed via live .sh wrapper |
| `plugin/scripts/inner-idle-log.ts` | plug | 2 | 0 | 0 | — | **live** | 2 |  |
| `plugin/scripts/it0-enforcement-with-design-check.sh` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/it0-enforcement-with-design-check.ts` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/it0-impl-row-check.sh` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/it0-split-or-commit-check.sh` | plug | 2 | 0 | 0 | — | **live** | 11 | executed via live .sh wrapper |
| `plugin/scripts/it0-split-or-commit-check.ts` | plug | 1 | 0 | 0 | — | **live** | 1 | executed via live .sh wrapper |
| `plugin/scripts/loadbearing-test-gate.sh` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/loadbearing-test-gate.ts` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/measure-suite-reporter.mjs` | plug | 8 | 0 | 0 | — | **live** | 8 |  |
| `plugin/scripts/measure-suite.mjs` | plug | 4 | 0 | 0 | — | **live** | 4 |  |
| `plugin/scripts/milestone-preparation-check.ts` | plug | 0 | 2 | 0 | — | **library** | 0 |  |
| `plugin/scripts/milestone-worktree.ts` | plug | 7 | 2 | 0 | — | **live** | 30 |  |
| `plugin/scripts/portfolio-choice.ts` | plug | 0 | 0 | 0 | — | **dormant-by-decision** | 0 |  |
| `plugin/scripts/preparation-feedback.ts` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/prepare-admission-check.ts` | plug | 0 | 3 | 0 | — | **library** | 3 |  |
| `plugin/scripts/proposal-convergence.ts` | plug | 0 | 1 | 0 | — | **library** | 3 |  |
| `plugin/scripts/publish-dist-branch.sh` | plug | 0 | 0 | 1 | — | **ci-only** | 0 |  |
| `plugin/scripts/read-probe-spec.ts` | plug | 0 | 2 | 0 | — | **library** | 0 |  |
| `plugin/scripts/routine-file-gate.ts` | plug | 0 | 1 | 0 | — | **library** | 1 |  |
| `plugin/scripts/routine-scheduler.ts` | plug | 0 | 3 | 0 | — | **library** | 0 |  |
| `plugin/scripts/run-identity.ts` | plug | 0 | 0 | 0 | — | **unaccounted** | 4 |  |
| `plugin/scripts/runtime-usage-inventory.ts` | plug | 0 | 1 | 0 | — | **library** | 0 |  |
| `plugin/scripts/select-tests-for-touches.ts` | plug | 26 | 0 | 0 | — | **live** | 54 | executed via live .sh wrapper |
| `plugin/scripts/serial-fanin-absorb.ts` | plug | 0 | 2 | 0 | — | **library** | 0 |  |
| `plugin/scripts/sync-vendor.sh` | plug | 89 | 0 | 0 | — | **live** | 110 | executed via live .sh wrapper |
| `plugin/scripts/task-contract-check.ts` | plug | 8 | 1 | 0 | — | **live** | 8 |  |
| `plugin/scripts/task-schema-check.sh` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/task-schema-check.ts` | plug | 1 | 0 | 0 | — | **live** | 8 |  |
| `plugin/scripts/task-schema.ts` | plug | 2 | 9 | 0 | — | **live** | 2 |  |
| `plugin/scripts/task-status-drift-check.ts` | plug | 12 | 0 | 0 | — | **live** | 32 |  |
| `plugin/scripts/test-framework-policy-check.sh` | plug | 2 | 0 | 0 | — | **live** | 2 | executed via live .sh wrapper |
| `plugin/scripts/test-framework-policy-check.ts` | plug | 50 | 1 | 0 | — | **live** | 50 | executed via live .sh wrapper |
| `plugin/scripts/touches-orthogonality-check.ts` | plug | 0 | 14 | 0 | — | **library** | 3 |  |
| `plugin/scripts/tree-hygiene-check.sh` | plug | 0 | 0 | 0 | — | **unaccounted** | 4 |  |
| `plugin/scripts/vmeta-lag-check.sh` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/vmeta-lag-check.ts` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/wiring-coverage-check.ts` | plug | 0 | 2 | 0 | — | **library** | 0 |  |
| `plugin/scripts/workflow-baseline-metrics.ts` | plug | 0 | 1 | 0 | — | **library** | 0 |  |
| `plugin/scripts/workflow-event-schema.mjs` | plug | 2 | 3 | 0 | — | **live** | 2 |  |
| `plugin/scripts/workflow-invariant-ownership.mjs` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `plugin/scripts/workflow-metadata-conformance.mjs` | plug | 2 | 0 | 0 | — | **live** | 4 |  |
| `plugin/scripts/workflow-replay.ts` | plug | 17 | 1 | 0 | — | **live** | 38 |  |
| `plugin/scripts/worktree-branch-hygiene-check.sh` | plug | 0 | 0 | 0 | — | **unaccounted** | 0 |  |
| `scripts/agents-claude-drift-check.ts` | scripts | 0 | 0 | 0 | — | **unaccounted** | 8 |  |
| `scripts/delivery-manifest-check.test.ts` | scripts | 0 | 0 | 0 | — | **never-runs-test** | 0 |  |
| `scripts/delivery-manifest-check.ts` | scripts | 0 | 1 | 2 | — | **library** | 0 |  |
| `scripts/test-coverage-check.ts` | scripts | 21 | 1 | 2 | — | **live** | 22 |  |
| `scripts/test.sh` | scripts | 244 | 0 | 1 | — | **live** | 529 | executed via live .sh wrapper |
| `scripts/version-consistency-check.test.ts` | scripts | 0 | 0 | 0 | — | **never-runs-test** | 0 |  |
| `scripts/version-consistency-check.ts` | scripts | 0 | 1 | 1 | — | **library** | 0 |  |

## Methodology & known limitations

- **executed** is command-position matching: single/double/backtick-quoted content is stripped, then only interpreter/executor argument positions count. `ls x.ts` / `grep 'x.ts'` / `cat x.sh` never count. Known conservative miss: a script referenced inside `bash -c '...'` / `node -e '...'` inline code is not counted (the code is quote-stripped).
- **imported_by** parses `import`/`require` statements (comment-stripped) and resolves the specifier; it is not a substring scan. Known false positive: a string literal containing `import ... from "..."`.
- **in_test_glob** only matters for `*.test.*` files; the three glob patterns are the canonical `scripts/test.sh` glob (ADR-019/DIR-109).
- The transcripts read are whatever sessions exist under `--sessions-dir` within the window. For the main window these are the fast-mode inner-layer sessions; for the long window the same scan naturally includes the pre-fast-mode classic-loop sessions — which is exactly why cadence-driven scripts surface in the diff.
- The task body cited 211 scripts at 2026-08-03 02:5xZ (a rough first measurement; a raw filesystem count that excluded the 7 `*.test.*` files). This inventory's current HEAD count is 205 distinct-by-realpath / 220 raw — the delta is `plugin/scripts` +1 (`task-contract-check.ts`, added 03:04Z) plus the 7 `*.test.*` files this inventory deliberately includes (AC6 requires listing them).
- Some `unaccounted` entries are non-script files (config/fixture) that sit in a scripts dir — they are flagged in the `note` column (e.g. `tsconfig.json`, `deliverable-governor-fixture.json`, the 4 `fixtures/loadbearing/scripts/fixture-*.mjs`). They are included for full filesystem coverage but are not runnable scripts.
- `never-runs-test` is eclipsed by `live` when a `*.test.*` outside the canonical glob was nonetheless executed in the window (e.g. `it0-enforcement-with-design-check.test.mjs`, run once manually). Such a file is genuinely "not in the suite" but has execution evidence — the class follows the priority, so it shows `live`, not `never-runs-test`.
- The `executed` count is command-position matching (quotes stripped) plus a conservative wrapper-indirect signal (a transcript-live `.sh` that delegates to a same-dir `.ts`/references it via `node`/`bash`/ `gate_delegate_ts` marks that target as executed too). Known conservative misses: a script referenced inside `bash -c '...'` inline code, or invoked by bare basename after `cd`.

## Entry point (gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point)

The `plugin/scripts` instruments are discoverable through ONE entry point instead of remembered paths:

- **MCP:** the Core `instrument` tool (`packages/quay/src/mcp-server.ts`) — `action: "list"` returns the derived instrument directory (each admitted instrument declaring what question it answers); `action: "run"` + `name` + `args` invokes one. The directory is DERIVED from the filesystem by this tool's `--instruments-json` mode:
  `node --experimental-strip-types plugin/scripts/runtime-usage-inventory.ts --instruments-json`
- **Admission filter (AC4):** an instrument is admitted only when it declares its question — explicitly via `@instrument "<question>"` in its header comment, or derived from the header's own `<basename> — <description>` line. Instruments that cannot say are kept OUT, listed under `notAdmitted`.
- **The count is derived, never hardcoded** — the "81" in the task body is a snapshot; the manifest's `total` reflects the current filesystem.
