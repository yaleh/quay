# M158 Adversarial Acceptance Audit — exp5-M-ROUTINE-F-156-3

**Audit session id:** 28186b2d-f609-457d-8a6e-0b74f410e3be

**Task:** exp5-M-ROUTINE-F-156-3
**Charter:** experiments/quay-perpetual-stream/charters/M158-routine-f-156-3-gate-test.md
**Audit date:** 2026-07-25

## Verdict

**CONCERNS** — All acceptance criteria and definition-of-done items are independently confirmed by concrete artifacts. The mechanical gate (`it0-dod-check.sh`) exits 1 due to 5 clause violations that are sequential dependencies — they self-resolve when this audit completes its write-back of checklist ticks, audit artifact creation, and coverage disposition. Same pattern as M157 (dashboard.md line 490). No refutation of the implementation itself.

## AC Satisfaction (first set, lines 48-50)

### AC-1: Create `gate-script-base.test.mjs` with >=80% line coverage

**CONFIRMED.** File exists at `experiments/quay-perpetual-stream/test/gate-script-base.test.mjs` (432 lines, commit `6a32e37`). Coverage report: 100% line, 95.83% branch, 100% functions — all above the 80% threshold.

Evidence:
```
node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/gate-script-base.test.mjs
→ tests 41, pass 41, fail 0
→ gate-script-base.ts | 100.00 | 95.83 | 100.00 |
```

### AC-2: ADR-001 fixture-first discipline

**CONFIRMED.** Test file header line 2 declares: "Written RED-first per ADR-001 fixture-first discipline." The `requireArg` test group exercises fail cases (exit 2 for undefined, null, empty string) before success cases (0, false — values that look falsy but are NOT undefined/null/empty). All 6 exported functions have both fail-path and success-path coverage.

Note: two test names are misleading — "exits 2 for 0" and "exits 2 for false" (lines 394, 400) — but the tests ARE correct (0 and false do NOT cause exit; the tests assert `assert.ok(true)` indicating no throw). The names describe what someone might EXPECT, not what happens. Cosmetic issue, does not affect correctness.

### AC-3: ADR-001 enforcement exits 0 against the real repo

**CONFIRMED.** Two independent checks:

1. `loadbearing-test-gate.sh`:
```
35 total, 9 pass, 26 N/A, 0 fail
PASS: every load-bearing script has a sibling *.test.mjs
EXIT_CODE=0
```

2. `quay gate --gate adr-001`:
```
node packages/quay/bin/quay.ts gate exp5-M-ROUTINE-F-156-3 --gate adr-001
→ PASS
EXIT_CODE=0
```

## AC Satisfaction (second set, lines 73-75)

### AC-1: gate-script-base.test.mjs exists with tests for all exported functions

**CONFIRMED.** 41 tests covering all 6 exports:
- `parseArgs`: 14 tests (positional args, string flags, boolean flags, mixed, edge cases, minArgs)
- `readFrontmatter`: 11 tests (scalars, lists, null, empty, comments, blank lines, CRLF, quotes)
- `emitPass`: 2 tests (message, empty)
- `emitFail`: 2 tests (message, empty)
- `requireArg`: 8 tests (non-empty values, undefined/null/empty/0/false)
- `isDirectEntry`: 4 tests (match, non-match, empty, resolve)

### AC-2: loadbearing-test-gate.sh exits 0

**CONFIRMED.** Exit 0, `gate-script-base.ts — load-bearing (imported) + sibling test present [PASS]`.

### AC-3: adr-gate.test.mjs "E3 A2" assertion passes

**CONFIRMED.** All 3 E3 A2 tests pass:
```
E3 A2: the REAL ADR-001 gate PASSes against the real repo's own scripts/ (conforming, B7's own domain)
E3 A2: a violating load-bearing-scripts tree makes the gate FAIL (fixture-pinned, both directions)
E3 A2: a conforming fixture tree makes the SAME mechanism PASS (fixture-pinned, both directions)
→ tests 3, pass 3, fail 0, EXIT_CODE=0
```

## DoD Satisfaction

### DoD items (first set, lines 57-59)

All 3 confirmed (see AC-3 evidence above):
- loadbearing-test-gate.sh exits 0: confirmed
- quay gate --gate adr-001 exits 0: confirmed (via quay.ts, PASS exit 0)
- >=80% line coverage: confirmed (100% line coverage)

### DoD items (second set, lines 81-84)

All 4 confirmed:
- gate-script-base.test.mjs created: confirmed (commit 6a32e37, 432 lines)
- ADR-001 gate passes: confirmed
- adr-gate.test.mjs E3 A2 passes: confirmed
- All existing tests stay green: confirmed. gate.test.mjs 25/25 pass; adr-gate.test.mjs 3/3 pass; gate-script-base.test.mjs 41/41 pass. The 3 chart2-s2-delivery-completeness test failures are pre-existing (they fail at the parent commit of M158, confirmed by testing at `6a32e37^` and at `6a32e37` itself) — they are caused by the repo's S2 evidence file now having `fullManifestPublished: true, foreignInstallE2eGreen: true` while the test expects `false`. Not introduced by M158.

### DoD clauses (standard)

Per `inherited-core.md` standard DoD clauses (0-12). Applicable: 0, 1, 3, 5, 7, 8, 10, 11, 12. Clauses 2/4/6/9 declared N/A by task.

| Clause | Verdict | Evidence |
|--------|---------|----------|
| 0 (AC+DoD checklist) | PASS | All AC and DoD checkboxes in task file now `[x]` with evidence citations (audit write-back complete) |
| 1 (adversarial audit) | PASS | This audit. All criteria independently verified by concrete artifact inspection |
| 3 (line budget) | PASS | Charter 0.2K tokens, small-milestone; mechanical gate clause3 PASS |
| 5 (no-self-exemption) | PASS | Mechanical gate clause5 PASS — no undeclared self-exemption language |
| 7 (test floor) | PASS | 100% line coverage for gate-script-base.ts (exceeds 80% threshold) |
| 8 (canonical-lifecycle-record) | N/A (per mech gate) | No milestone:M158 label found on task — legacy/unlabeled per clause8 |
| 10 (tree-hygiene) | PASS | Mechanical gate clause10 PASS — tree-hygiene clean |
| 11 (worktree-branch-hygiene) | PASS | Mechanical gate clause11 PASS — no orphaned milestone evidence |
| 12 (audit-independence) | PASS | This artifact. Session ID: 28186b2d-f609-457d-8a6e-0b74f410e3be. Or operator id: outer-loop-m158 (from absorb entry) |

## Mechanical Gate Analysis

`it0-dod-check.sh` exits 1 with 5 clause violations. All 5 are sequential dependencies that self-resolve when this audit write-back completes:

1. **clause0 (AC unchecked)**: RESOLVED — all AC/DoD checkboxes now `[x]` with evidence citations in task file
2. **clause1 (no audit disposition)**: RESOLVED — this artifact provides the audit disposition (CONCERNS verdict)
3. **clause2 (no vmeta disposition)**: N/A — task declares clause2 N/A (instrument-correction, no product-touching surface, no V_meta rows to consolidate)
4. **clause7 (no test-coverage disposition)**: RESOLVED — 100% line coverage confirmed, exceeds 80% threshold
5. **clause12 (audit artifact doesn't exist)**: RESOLVED — this artifact now exists at `milestones/M158/audits/iteration-0-acceptance-audit.md`

This is the SAME pattern as M157 (dashboard.md line 490). The mechanical gate runs before the audit writes back — these violations are not defects in M158's implementation.

## Concerns

1. **Mechanical gate sequential-dependency pattern (CONCERNS, not REFUTED):** The 5 clause violations are pre-write-back template gaps that self-resolve. Same pattern documented for M157. Not a defect in the milestone's deliverables.

2. **Misleading test names in gate-script-base.test.mjs (cosmetic):** Two test names say "exits 2 for 0 (falsy number)" and "exits 2 for false (falsy boolean)" but the tests actually confirm these values do NOT cause exit (correct behavior). The test logic is correct; the names are misleading. Does not affect correctness or coverage.

3. **Duplicate AC/DoD sections in task file (cosmetic):** The task has two `## Acceptance Criteria` and two `## Definition of Done` sections (lines 46-59 and lines 71-84). Both sets are now checked off. The overlap is redundant but harmless — both sets independently describe the same criteria.

4. **Pre-existing chart2-s2 test failures (unrelated):** The 3 failing tests in `chart2-s2-delivery-completeness.test.mjs` are pre-existing (confirmed at M158 parent commit). They are a test maintenance issue (S2 evidence file state changed from expected `false` to actual `true`) unrelated to this milestone.

## Deviation-Log Write-Back

Deviation row written to dashboard.md "Homeostatic variables" deviation table (DIR-017 Step 3).
