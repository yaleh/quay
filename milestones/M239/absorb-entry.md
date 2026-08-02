## M239 ABSORB entry

**Milestone id:** M239
**Task:** gap-prepare-milestone-no-size-aware-routing-A (Size estimation + fast-lane routing: estimateTaskSize + PrepareRoutingDecision in prepare-milestone)
**Charter:** experiments/quay-perpetual-stream/charters/M239-gap-prepare-milestone-no-size-aware-routing-A.md
**Value type:** capabilityGrowth
**Deliverable:** no (needs-human — build-evidence gate failed)

## Backlog row

| gap-prepare-milestone-no-size-aware-routing-A | Size estimation + fast-lane routing: estimateTaskSize + PrepareRoutingDecision in prepare-milestone. Adds size-aware routing to the prepare-milestone pipeline so small/proven tasks skip the full ProposalAuthors->Adjudicate->ProposalReview->PlanAuthor->PlanCheck chain. | TBD | - | milestone-candidate, human-steered, needs-human |

## ABSORB gate run (M239)

### Gate: V_meta consolidation-lag — PASS

V_meta consolidation-lag check PASS (exit 0). Run from worktree milestones/M239/worktrees/iteration-0 with --counter 205 against experiments/quay-perpetual-stream/v-meta-ledger.md. Two rows checked: one consolidated (lag gate does not apply), one proposed (not past phi threshold). No confirmed-unconsolidated rows past K without a dated carry-forward. No alarm, no hard block.

### Gate: dashboard.md line budget — PASS

dashboard.md at 1172 lines (cap 1200). Dashboard is within the 1200-line budget. 28 lines of headroom remain before the cap.

### Gate: tree-hygiene — PASS

tree-hygiene-check.sh exited 0: "tree-hygiene: clean — no un-gitignored scratch left in the main tree." No hard block.

### Gate: worktree-branch-hygiene — PASS

worktree-branch-hygiene-check.sh: clean — no orphaned milestone evidence in un-merged iteration branches (exit 0). prunable merged iteration branches=0; registered iteration worktrees=4.

### Gate: split-or-commit — PASS

split-or-commit gate PASSED for gap-prepare-milestone-no-size-aware-routing-A in the M239 build worktree. No SPLIT-OR-COMMIT violation detected: parent-done-iff-children, SELECT-split, child-link-symmetry, and needs-human reason are all in order per DIR-026.

### Gate: build-evidence — FAIL

build-evidence gate FAILED: build-admission-unavailable — buildAdmissionRef is null and dependency is required by execution policy (not in advisory mode).

- Manifest at milestones/M239/build-evidence-manifest.json (worktree: milestones/M239/worktrees/iteration-0) has null buildAdmissionRef.
- No BuildAdmissionDecision file exists in the milestone directory.
- preparation.json shows forceCommitted: true.
- The gate hard-blocks pre-Audit — this is deterministic, not a tool error.

**Root cause:** The milestone was force-committed through preparation (forceCommitted: true, reason: "3 wiring-coverage blockers are mechanism implementation details. 4 minor findings dispositioned."). The force-commit path did not produce a BuildAdmissionDecision, so the build-evidence gate's required buildAdmissionRef is null. The task cannot proceed to Audit without a BuildAdmissionDecision being backfilled.

**Disposition:** needs-human. A human must either (a) backfill a BuildAdmissionDecision for this milestone, or (b) adjust the build-evidence gate policy to allow force-committed milestones to proceed without one.

## Gate summary

| Gate | Result | Detail |
|------|--------|--------|
| V_meta consolidation-lag | PASS | No unconsolidated rows past K |
| dashboard.md line budget | PASS | 1172/1200 lines (28 headroom) |
| tree-hygiene | PASS | No un-gitignored scratch |
| worktree-branch-hygiene | PASS | No orphaned iteration branches |
| split-or-commit | PASS | No DIR-026 violations |
| **build-evidence** | **FAIL** | buildAdmissionRef is null (force-committed milestone) |
