---
id: exp5-M-ROUTINE-F-156-3
title: "ADR-001 gate fails: gate-script-base.ts is load-bearing but missing
  sibling test file"
status: todo
role: primitive
labels:
  - defect
  - routine-finding
  - milestone-candidate
extra:
  schema: v1
  acceptance: "bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-ROUTINE-F-156-3 experiments/quay-perpetual-stream/charters/M158-routine-f-156-3-gate-test.md /tmp/m158-absorb-entry.md"
---
## Finding

ADR-001 enforcement `bash experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh --scripts experiments/quay-perpetual-stream/scripts --tests experiments/quay-perpetual-stream/test` exits 1 with `[FAIL] gate-script-base.ts — load-bearing (imported) but NO sibling gate-script-base.test.mjs`. `experiments/quay-perpetual-stream/scripts/gate-script-base.ts` was created in M151/M152 as a shared TS utility library and is imported by `it0-enforcement-with-design-check.ts`, `it0-split-or-commit-check.ts`, and `diagnose-verify-failure.ts`, making it load-bearing per ADR-001 Decision clause 2. No sibling test file exists at `experiments/quay-perpetual-stream/test/gate-script-base.test.mjs`. Test at `packages/quay/test/adr-gate.test.mjs` line 190 confirms: "E3 A2: the REAL ADR-001 gate PASSes" → FAIL with "acceptance failed (exit 1)".

## Proposal

**ADR-001 enforcement output:**
```
[FAIL] gate-script-base.ts — load-bearing (imported) but NO sibling gate-script-base.test.mjs
...
35 total, 8 pass, 26 N/A, 1 fail
FAIL: 1 load-bearing script(s) lack a sibling *.test.mjs (ADR-001 Decision clause 2)
```

Exit code 1.

**Test failure in `adr-gate.test.mjs`:**
```
E3 A2: the REAL ADR-001 gate PASSes against the real repo's own scripts/
→ FAIL: expected pass against the real repo; got reason=acceptance failed (exit 1)
```

**Root cause:** `gate-script-base.ts` was created in `experiments/quay-perpetual-stream/scripts/` as part of the gate script refactoring (M151/M152: DIR-090, DIR-091). It exports shared utilities (`safeJsonParse`, `readConfig`, `resolveGateArgs`) that are imported by at least `it0-enforcement-with-design-check.ts`, `it0-split-or-commit-check.ts`, and `diagnose-verify-failure.ts`. Per ADR-001, being imported makes it load-bearing, which mandates a sibling test file. No such test file was created.

## Impact

The ADR-001 gate permanently fails, which means:
- `quay gate <task> --gate adr-001` always fails on the real repo
- The `adr` gate set in `.quay/config.yml` produces a failing check
- The failing gate shadows any NEW violations (new load-bearing scripts without tests would not be detected because the gate already fails on the stale finding)

## Acceptance Criteria

- [ ] Create `experiments/quay-perpetual-stream/test/gate-script-base.test.mjs` with >=80% line coverage for `gate-script-base.ts`'s exported functions
- [ ] The test follows ADR-001 fixture-first discipline (red fail-case per assertion before green)
- [ ] Running ADR-001 enforcement exits 0 against the real repo

## Definition of Done

Per inherited-core.md standard DoD clauses (0-12). This milestone's applicable clauses: 0 (AC+DoD checklist present), 1 (adversarial acceptance audit), 3 (line budget), 5 (no-self-exemption), 7 (test floor — unit tests), 8 (canonical-lifecycle-record), 10 (tree-hygiene), 11 (worktree-branch-hygiene), 12 (audit-independence). Clauses 2 (V_meta consolidation), 4 (impl-row), 6 (escrow Δv), 9 (needs-human legitimacy) are N/A.


- [ ] `bash experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh --scripts experiments/quay-perpetual-stream/scripts --tests experiments/quay-perpetual-stream/test` exits 0
- [ ] `quay gate <task> --gate adr-001` exits 0 on the real repo
- [ ] `node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/gate-script-base.test.mjs` reports >=80% line coverage


## Plan

N/A — no docs/plans/*.md reference (instrument-correction; create a test file for existing exports).

1. Examine exports in experiments/quay-perpetual-stream/scripts/gate-script-base.ts
2. Create experiments/quay-perpetual-stream/test/gate-script-base.test.mjs with unit tests covering all exported functions
3. Verify ADR-001 gate passes: loadbearing-test-gate.sh exits 0
4. Verify adr-gate.test.mjs "E3 A2" assertion passes

## Acceptance Criteria

- [ ] gate-script-base.test.mjs exists with tests for all exported functions
- [ ] loadbearing-test-gate.sh exits 0 (no FAIL)
- [ ] adr-gate.test.mjs "E3 A2: the REAL ADR-001 gate PASSes" assertion passes

## Definition of Done

Per inherited-core.md standard DoD clauses (0-12). Applicable: 0, 1, 3, 5, 7, 8, 10, 11, 12. Clauses 2/4/6/9 N/A.

- [ ] gate-script-base.test.mjs created with unit tests
- [ ] ADR-001 gate passes (loadbearing-test-gate.sh exit 0)
- [ ] adr-gate.test.mjs E3 A2 assertion passes
- [ ] All existing tests stay green

## Touches

- experiments/quay-perpetual-stream/test/gate-script-base.test.mjs (new)