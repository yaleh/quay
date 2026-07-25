# Adversarial Acceptance Audit — DIR-071 (M137: drain-scheduler + /drain-directives workflow)

**Audit type:** adversarial acceptance audit (Clause 1, per inherited-core.md DoD)
**Task:** DIR-071 (status: `todo`)
**Charter:** experiments/quay-perpetual-stream/charters/M137-drain-scheduler.md
**Date:** 2026-07-24
**Verdict: REFUTED**

## Summary

The milestone has **zero implementation**. The task is in `todo` status — no artifacts exist, all 7
Acceptance Criteria items remain unchecked, all 7 Definition of Done items remain unmet, and the
mechanical gate (`it0-dod-check.sh`) returns FAIL (exit 1) with 7 clause violations. Every
verifiable AC and DoD item is REFUTED by construction.

## AC Satisfaction (refute-first)

| # | AC | Status | Evidence |
|---|----|--------|----------|
| 1 | `drain-scheduler.ts` CLI exits 0 + prints JSON when pending directives exist | **REFUTED** | File `experiments/quay-perpetual-stream/scripts/drain-scheduler.ts` does not exist: `ls: cannot access '.../drain-scheduler.ts': No such file or directory` |
| 2 | `drain-scheduler.ts` CLI exits 3 when no pending directives exist | **REFUTED** | Same as AC #1 — the script does not exist; no exit-code behavior can be verified |
| 3 | `/drain-directives` workflow runs Schedule->Dispose->Verify phases deterministically | **REFUTED** | File `.claude/workflows/drain-directives.js` does not exist. The `.claude/workflows/` directory contains only `execute-milestone.js` and `run-routines.js` |
| 4 | DIR-068 and DIR-069 successfully drained by `/drain-directives`: `dirStatus` -> `applied`, `label:milestone-candidate` added | **REFUTED** | The `/drain-directives` workflow does not exist and was never invoked. DIR-068 and DIR-069 were manually drained at the M135->M136 boundary by a human (not by the mechanical drain-scheduler), as evidenced by their body text: DIR-068 `dirStatus: applied` + "2026-07-24 (M135->M136 boundary drain): dirStatus -> applied. Converted to milestone-candidate. SELECTed for M136."; DIR-069 `dirStatus: applied` + "2026-07-24 (M135->M136 boundary drain): dirStatus -> applied. Directive converted to milestone-candidate." The AC specifically requires draining by `/drain-directives` — a mechanical workflow that was never built or run |
| 5 | After DRAIN, `task_list --label milestone-candidate --status todo` includes the drained directives | **REFUTED** | No mechanical DRAIN was performed. While DIR-069 does carry `label:milestone-candidate` (from the manual drain), this is not the result of the `/drain-directives` workflow the AC requires |
| 6 | OUTER-LOOP.md step 0 is <=3 lines (invoke workflow + reference) | **REFUTED** | OUTER-LOOP.md step 0 (lines 78-104) is still the original 27-line prose version beginning "DRAIN human inbox — read the pending directives via `task_list --label directive`...". No rewrite to the `/drain-directives` invocation pointer has occurred |
| 7 | Step 1 precondition enforced: DRAIN must complete before SELECT | **REFUTED** | OUTER-LOOP.md step 1 (SELECT, line 110) has no DRAIN-must-complete precondition. Grep for `/drain-directives` or "drain.*must.*complete" in OUTER-LOOP.md returns zero hits |

## DoD Satisfaction

| # | DoD Item | Status | Evidence |
|---|----------|--------|----------|
| 1 | `drain-scheduler.ts` authored (pure functions exported + CLI main, mirror routine-scheduler.ts shape) | **REFUTED** | File does not exist |
| 2 | `drain-scheduler.ts` unit-tested (pending directive parsing, classification, edge cases) | **REFUTED** | No source file -> no tests |
| 3 | `.claude/workflows/drain-directives.js` authored (Schedule->Dispose->Verify phases) | **REFUTED** | File does not exist |
| 4 | OUTER-LOOP.md step 0 rewritten | **REFUTED** | Not rewritten — still the original prose |
| 5 | Step 1 SELECT precondition wired | **REFUTED** | Not wired in OUTER-LOOP.md |
| 6 | Manual smoke: run `/drain-directives` -> DIR-068/069/070 get `label:milestone-candidate` + `dirStatus: applied` | **REFUTED** | Nothing to smoke — the workflow does not exist |
| 7 | Existing loop contracts still pass (contract 3: all script pointers resolve) | **REFUTED** | Cannot verify without artifacts deployed |

## Mechanical Gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-071 \
    experiments/quay-perpetual-stream/charters/M137-drain-scheduler.md \
    /tmp/m137-absorb-entry.md
EXIT_CODE: 1
```

7 clause violations:
- **clause0-ac-dod-present:** 7 unchecked AC items, DoD does not reference the standard five clauses / inherited-core
- **clause1-adversarial-audit:** NO disposition statement in ABSORB-entry
- **clause2-vmeta-lag:** NO disposition statement in ABSORB-entry
- **clause7-test-floor:** FAIL — product-touching surface [none/fail-closed]
- **clause8-task-canonical-lifecycle-record:** no `## Proposal` section, no `## Plan` section

## Additional Observations

1. **Task status is `todo`** — the milestone was never promoted past charter. The audit was dispatched
   against an unimplemented milestone. The outer loop should not dispatch acceptance audits for
   `todo`-status tasks.

2. **DIR-068 and DIR-069 were manually resolved** at the M135->M136 boundary — a human performed the
   drain that the mechanical `/drain-directives` workflow should have performed. DIR-068 was SELECTed
   for M136 and carries `milestone:M-136`. DIR-069 is a `milestone-candidate` waiting in backlog.
   Neither was drained by the mechanical scheduler — the exact failure mode this directive was filed
   to prevent (human bypass of a mechanical step) has already recurred.

3. **The task body uses `## Finding` and `## Requested action` sections** instead of the
   `## Proposal` / `## Plan` sections required by the task canonical-lifecycle-record gate
   (Clause 8 / DIR-014 item 6). This is a structural non-conformance even before any implementation
   evaluation.
