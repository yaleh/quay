# M165 iteration-0 -- DIR-102: Allow lifecycle_retreat from needs-human to todo

**Date:** 2026-07-26
**Charter:** experiments/quay-perpetual-stream/charters/M165-dir102-lifecycle-retreat.md
**Class:** development (capability-growth)

## Summary

Implemented the `needs-human -> todo` retreat transition in the lifecycle engine.
The change is a one-line edit to the `TRANSITIONS` adjacency map plus documentation updates.

## Changes

### 1. `packages/quay/src/gate/lifecycle.ts`

- Changed `TRANSITIONS["needs-human"].back` from `null` to `"todo"`.
- Updated JSDoc comment above `TRANSITIONS` to reflect the new edge.

### 2. `packages/quay/bin/quay.ts`

- Updated `retreat` help text to include `needs-human->todo`.

### 3. `packages/quay/src/mcp-handlers.ts`

- Updated `lifecycle_retreat` tool description to include `needs-human->todo` as a legal backward step.

### 4. `packages/quay/test/lifecycle.test.mjs`

- Updated existing test `A1: TRANSITIONS` to expect `needs-human.back === "todo"`.
- Updated `A1: assertTransition` to verify `needs-human -> back` does NOT throw.
- Updated `A1: legalForward / legalBack` to assert `legalBack("needs-human") === "todo"`.
- Added Phase A4 tests (7 new tests):
  - `A4 [AC1-AC2]`: `runRetreat` needs-human->todo writes todo + logs retreat event with reason.
  - `A4 [AC3]`: retreat without reason -> exit 1, no write, no event.
  - `A4 [AC4]`: promote on needs-human -> illegal transition.
  - `A4 [AC5]`: complete on needs-human -> precondition reject.
  - `A4 [AC6]`: done->ready regression.
  - `A4 [AC6]`: ready->todo regression.
- Added Phase C CLI tests (6 new tests):
  - `C [DIR-102 AC1]`: CLI retreat needs-human with reason -> exit 0, status=todo, GateEvent recorded.
  - `C [DIR-102 AC3]`: CLI retreat needs-human without reason -> nonzero, status unchanged.
  - `C [DIR-102 AC4]`: CLI promote needs-human -> nonzero.
  - `C [DIR-102 AC5]`: CLI complete needs-human -> nonzero.
  - `C [DIR-102 AC6]`: CLI retreat done->ready regression.

## Test results

- **38/38 tests pass** (was 30 tests before this change; 8 new + 3 updated).
- **lifecycle.ts coverage**: 100% statements, 97.44% branches.

## AC verification

| AC | Status | Test |
|----|--------|------|
| AC1: retreat needs-human->todo exits 0 | PASS | Phase A4 AC1-AC2, Phase C DIR-102 AC1 |
| AC2: GateEvent recorded with reason | PASS | Phase A4 AC1-AC2, Phase C DIR-102 AC1 |
| AC3: retreat without reason exits nonzero | PASS | Phase A4 AC3, Phase C DIR-102 AC3 |
| AC4: promote from needs-human illegal | PASS | Phase A4 AC4, Phase C DIR-102 AC4 |
| AC5: complete from needs-human illegal | PASS | Phase A4 AC5, Phase C DIR-102 AC5 |
| AC6: existing retreat paths still work | PASS | Phase A4 AC6 (two tests), Phase C DIR-102 AC6 |
| AC7: tests pass + new coverage | PASS | 38/38 pass, 100% statement coverage |

## DoD verification

| DoD | Status | Evidence |
|-----|--------|----------|
| DoD1: lifecycle.ts updated | DONE | `TRANSITIONS["needs-human"].back = "todo"` |
| DoD2: GateEvent recorded on retreat | DONE | Phase A4 AC1-AC2 tests verify payload with reason |
| DoD3: CLI help text documents new transition | DONE | `bin/quay.ts` retreat help line updated |
| DoD4: Test coverage >=80% | DONE | 100% statements, 97.44% branches |
| DoD5: DIR-001 scenario documented | DONE | Phase C DIR-102 AC1 test covers the real needs-human->todo path |
