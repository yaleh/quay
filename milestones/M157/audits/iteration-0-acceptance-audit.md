# M157 Iteration-0 Acceptance Audit -- exp5-M-ROUTINE-F-156-2 (enforcement-with-design gate heading fix)

**Audit session id:** 28186b2d-f609-457d-8a6e-0b74f410e3be

## Verdict: CONCERNS

The fix is demonstrably correct: the regex on line 52 of `it0-enforcement-with-design-check.ts` was changed from `/^## Definition of Done\b/m` to `/^## Definition of DoD\b/m`, matching the real heading at `inherited-core.md` line 381 (`## Definition of DoD :: DoD`). The real-repo check exits 0 (all 13 DoD clauses aligned bidirectionally) and all 13 unit tests pass. One concern: AC-3 literal text requires verification against both `## Definition of Done` and `## Definition of DoD :: DoD` heading formats, but no unit test fixture uses `## Definition of Done`. Additionally, the mechanical gate (`it0-dod-check.sh`) exits 1 with 4 clause violations (clauses 1, 2, 7, 12) because the absorb entry `/tmp/m157-absorb-entry.md` is a template with `(To be filled by Gate phase)` / `(To be filled by Land phase)` placeholders and no dispositions.

## AC Satisfaction

1. **[x] Running `node experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.ts .` against the real repo exits 0** -- CONFIRMED. Output: `PASS: all 13 DoD clause(s) (Clauses 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12) are documented in inherited-core.md AND have enforcement blocks in it0-dod-check.mjs (bidirectional)`. Exit code: 0.

2. **[x] The script correctly parses DoD clause headings from `inherited-core.md` section `## Definition of DoD :: DoD`** -- CONFIRMED. The regex at line 52: `const dodStart = inheritedCoreText.search(/^## Definition of DoD\b/m);` matches the real heading `## Definition of DoD :: DoD` at `inherited-core.md` line 381. All 13 clauses (0-12) are correctly extracted. Evidence: the PASS output enumerates all 13 clauses.

3. **[ ] Unit tests verify the fix against both `## Definition of Done` and `## Definition of DoD :: DoD` heading formats** -- CONCERNS. No unit test fixture uses the `## Definition of Done` heading format. All 13 test fixtures use variants of `## Definition of DoD` (plain `## Definition of DoD`, multi-line `## Definition of DoD (M25...)`, or missing `## Definition of DoD` entirely). The test suite does cover two DoD heading variants (plain and multi-line), which may be what "both" intended. But the literal text names `## Definition of Done` explicitly, and no test fixture contains that string. All 13 tests pass (exit 0).

## DoD Satisfaction

1. **[x] `node experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.ts .` exits 0 on the real repo** -- CONFIRMED. PASS output, exit 0. See AC #1 evidence.

2. **[x] All unit tests in `it0-enforcement-with-design-check.test.mjs` pass** -- CONFIRMED. 13/13 tests pass: `ℹ tests 13, ℹ pass 13, ℹ fail 0`. Exit code: 0.

3. **[x] The test "CLI: against THIS repo's own real inherited-core.md" passes** -- CONFIRMED. The real-repo CLI invocation exits 0 with PASS message for all 13 clauses. This is functionally identical to DoD #1 and AC #1.

## Mechanical Gate

`bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-ROUTINE-F-156-2 experiments/quay-perpetual-stream/charters/M157-routine-f-156-2-dod-heading.md /tmp/m157-absorb-entry.md` exits **1** with 4 clause violations:

- **clause0-ac-dod-present**: PASS -- 3/3 AC checked, DoD references the standard
- **clause1-adversarial-audit**: FAIL -- no disposition statement in absorb-entry text (template placeholder)
- **clause2-vmeta-lag**: FAIL -- no disposition statement in absorb-entry text (template placeholder)
- **clause3-line-budget**: PASS -- charter within small-milestone norm
- **clause4-impl-row**: PASS -- not design-only
- **clause5-no-self-exemption**: PASS -- no undeclared self-exemption language
- **clause6-escrow-delta-v**: N/A -- not design-only
- **clause7-test-floor**: FAIL -- no test-coverage disposition or WAIVER in absorb-entry text (instrument-correction with no product-surface changes -- should carry a WAIVER)
- **clause8-task-canonical-lifecycle-record**: N/A -- no milestone label (legacy/unlabeled task)
- **clause9-split-or-commit**: N/A -- no needs-human declared
- **clause10-tree-hygiene**: PASS -- clean
- **clause11-worktree-branch-hygiene**: PASS -- clean
- **clause12-audit-independence**: FAIL -- declared audit artifact `milestones/M157/audits/iteration-0-acceptance-audit.md` does not exist on disk (being written by this audit pass -- will self-resolve)

The four failures are absorb-entry template gaps, not task-deliverable defects. clause1 and clause12 are circular (audit must exist for the check, but the check verifies the audit exists). clause2 and clause7 require WAIVER dispositions in the absorb entry for this instrument-correction task. The absorb entry `/tmp/m157-absorb-entry.md` has `(To be filled by Gate phase)` and `(To be filled by Land phase)` placeholders in its Gate-results and Merge sections.

## Deviation-row write-back

Two deviation rows written to `dashboard.md` "Homeostatic variables (DIR-017 Step 3)" table (see below).
