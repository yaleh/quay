---
id: exp5-M-LOADBEARING-TEST-GATE-TS
title: "Fix loadbearing-test-gate.sh: recognize .test.ts sibling tests (ADR-012
  TS migration gap)"
status: done
labels:
  - milestone-candidate
  - instrument-correction
  - milestone:M-134
parent: null
children: []
extra:
  schema: v1
---
## Proposal

`loadbearing-test-gate.sh` only recognizes `*.test.mjs` sibling tests. Since the ADR-012 TS migration,
11 scripts under `experiments/quay-perpetual-stream/scripts/` use `*.test.ts` and are invisible to the
gate. This was flagged in M127 (DIR-063-A) and M129 (PRODUCTIZED-DELIVERY-B) audits as a pre-existing
limitation. Fix: extend the gate to also check for `*.test.ts` siblings.

## Plan

N/A — focused instrument fix. Extend glob pattern in loadbearing-test-gate.sh. Add/update selfcheck
fixtures. Behavior-preserving for existing .test.mjs checks.

## Acceptance Criteria
- [ ] `loadbearing-test-gate.sh` recognizes `*.test.ts` files in addition to `*.test.mjs`
- [ ] Existing .test.mjs checks continue to work (selfcheck unchanged for mjs path)
- [ ] New .test.ts selfcheck fixture: a script with .test.ts sibling → PASS, without → FAIL
- [ ] Selfcheck RED+GREEN demonstrated
- [ ] Standard non-flaky suite stays green