## M222 ABSORB entry

**Milestone id:** M222
**Task:** DIR-112 (Parallelize packages/quay/test/cli.test.mjs's 10 independent scenario blocks — async execFile + Promise.all)
**Charter:** experiments/quay-perpetual-stream/charters/M222-dir112.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-112 | Parallelize cli.test.mjs — convert run() helper from execFileSync to async execFile (Promise wrapper), wrap 25 test blocks into async functions, dispatch 7 isolated-workspace blocks via Promise.all for concurrency (>=40% wall-clock reduction) | TBD | - | milestone-candidate, autonomous, surface:cli |

## ABSORB gate run (M222)

**Verdict: needs-human** — 4 of 6 gates passed; 2 FAILED (1 HARD BLOCK, 1 structural block).

### Gate results

| # | Gate | Result | Detail |
|---|------|--------|--------|
| 1 | vmeta-lag-check | **PASS** | V_meta consolidation-lag check PASSED for milestone_counter=205, K=2. consolidated (lag=N/A, lag gate does not apply); proposed (not past threshold, no lag gate). No confirmed-unconsolidated row past K without a dated carry-forward. |
| 2 | dashboard-line-budget | **PASS** | dashboard.md has 1171 lines (cap 1200), 29 lines under budget. |
| 3 | tree-hygiene | **PASS** | clean — no un-gitignored scratch files detected in the M222 worktree. Non-blocking WARN about gitignored prepare-milestone.js test-fixture orphans (14 docs/plans/M9*.md + 1 milestones/M942607 directory) — already gitignored, cannot pollute the tracked tree. |
| 4 | worktree-branch-hygiene | **PASS** | clean — no orphaned milestone evidence in any un-merged iteration branch. 0 prunable merged branches, 4 stale registered iteration worktrees (informational only). |
| 5 | split-or-commit | **FAIL** | **3 DoD clause violations** found by it0-dod-check.sh: (1) clause0-ac-dod-present (HARD BLOCK): 1 unchecked AC checkbox — "Isolated wall-clock (`time node --test packages/quay/test/cli.test.mjs`, run alone) drops by" is unchecked. (2) clause0-ac-dod-present (HARD BLOCK): '## Definition of Done' section does not reference the standard DoD (must reference the standard five clauses / inherited-core, per the reference-plus-extras rule). (3) clause7-test-floor (FAIL): Product-touching surface [cli] has NEITHER a >=80% test-coverage disposition NOR a matching test-floor WAIVER line in the absorb-entry text. All other clauses (1-2, 3, 4, 5, 6, 8, 10, 11, 12) PASS or N/A. |
| 6 | build-evidence | **FAIL** | **buildAdmissionRef is null** for a required dependency (not advisory). The manifest at `milestones/M222/build-evidence-manifest.json` is structurally incomplete — a `buildAdmissionRef` is null for a dependency required by execution policy, producing a hard pre-Audit block. The gate script ran successfully but issued a FAIL verdict: the manifest does NOT satisfy the evidence-class contracts. |

### Failure analysis

**Failure #1 — split-or-commit (HARD BLOCK):** The task DIR-112 has 1 unchecked AC checkbox and a missing DoD reference to the standard inherited-core clauses. Additionally, the product-touching surface [cli] has no >=80% test-coverage disposition and no test-floor WAIVER line. These are DoD clause violations that must be resolved before the task can pass the split-or-commit gate.

**Failure #2 — build-evidence (structural block):** The build-evidence manifest at `milestones/M222/build-evidence-manifest.json` exists but is structurally incomplete — a `buildAdmissionRef` is null for a dependency that is marked as required (not advisory). This is a hard pre-Audit block: the manifest must satisfy evidence-class contracts before the Audit phase can proceed.

**Required actions:**
1. **split-or-commit:** Check the remaining AC checkbox in tasks/DIR-112.md, add a DoD reference to the standard inherited-core clauses, and either add a >=80% test-coverage disposition for the [cli] surface or add a test-floor WAIVER line in this absorb entry.
2. **build-evidence:** Correct the manifest at `milestones/M222/build-evidence-manifest.json` to include a valid `buildAdmissionRef` for the required dependency.

## Adversarial audit disposition (M222)

(skipped — ABSORB gates did not pass; HARD BLOCK at build-evidence gate prevents Audit dispatch)
