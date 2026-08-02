# M246 — Absorb Entry

- **Milestone:** M246
- **Charter:** experiments/quay-perpetual-stream/charters/M246-*.md
- **Prepared:** milestones/M246/preparation.json
- **Date:** 2026-08-01T12:40:09Z
- **Mode:** human-steered

## Backlog row

| DIR-124-A5 | Baseline metrics emission: mechanical/content split, explicit unknowns | development | surface:method-infra |

## Disposition

adversarial-audit disposition: CONCERNS — absorb-entry backlog row format defect (extra M246 column, corrected during audit); all 15 independently-verifiable ACs confirmed; 23/23 tests GREEN both mirrors; 54/54 selftest PASS; mirror byte-identity confirmed; mechanical gate passes after AC write-backs; worktree force-removed during audit before DIR-123 review-C1 commit; build artifacts lost from worktree

## Gate Results (2026-08-01)

**Outcome: needs-human — 2 of 6 gates FAILED.**

| Gate | Verdict | Summary |
|---|---|---|
| V_meta consolidation-lag | PASS | No confirmed-unconsolidated rows past K without a dated carry-forward. Both rows ok: consolidated row has lag=- (consolidated, lag gate does not apply); proposed row has lag=- (not past phi threshold, no lag gate). |
| dashboard line-budget | PASS | Dashboard at 1172 lines, under the 1200-line cap. |
| tree hygiene | PASS | No un-gitignored scratch left in the main tree. Worktree git status --porcelain also empty. Non-blocking WARN: 25 gitignored test-fixture orphans from prior prepare-milestone-convergence test runs — already gitignored, cannot pollute the tracked tree. |
| worktree-branch hygiene | PASS | No orphaned milestone evidence in un-merged iteration branches. 0 prunable merged iteration branches, 4 registered iteration worktrees (ABSORB should prune these). |
| **split-or-commit** | **FAIL** | **4 CHILD-LINK-SYMMETRY violations** in worktree milestone/M246/iteration-0: (1) DIR-124-A1a declares parent DIR-124-A1 but DIR-124-A1.children omits it. (2) DIR-124-A1b declares parent DIR-124-A1 but DIR-124-A1.children omits it. (3) DIR-124-A3a declares parent DIR-124-A3 but DIR-124-A3.children omits it. (4) DIR-124-A3b declares parent DIR-124-A3 but DIR-124-A3.children omits it. All four are CHILD-LINK-SYMMETRY failures: each child's parent field points to a parent whose children array does not include the child, violating DIR-026's parent-done-iff-children rule — the parent could be marked done while these children are excluded from the completeness check. |
| **build-evidence** | **FAIL** | **buildAdmissionRef is null.** The `build-evidence-manifest.json` at the milestone M246 root (resolved via gate_resolve_milestone_root 246 within the worktree at milestones/M246/worktrees/iteration-0) has a null `buildAdmissionRef`, which is a required dependency by execution policy (not in advisory mode). This is a HARD BLOCK before Audit. |

### Required remediation

1. **split-or-commit (child-link-symmetry):** Add DIR-124-A1a and DIR-124-A1b to DIR-124-A1.children, and add DIR-124-A3a and DIR-124-A3b to DIR-124-A3.children via `task_write` on the parent tasks.
2. **build-evidence (null buildAdmissionRef):** The manifest now exists but its `buildAdmissionRef` field is null — a required dependency. Re-run the Build phase to produce a manifest with a valid build admission reference, or determine why the Build phase did not record the admission reference.
