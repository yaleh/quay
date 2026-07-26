# Adversarial Acceptance Audit -- M166 / exp5-CRYST-SENTINEL-REMOVAL-IDEMPOTENT
**Audit session id:** 28186b2d-f609-457d-8a6e-0b74f410e3be

## Verdict: CONCERNS

One AC is REFUTED (AC3 -- unverifiable forward-looking criterion). Two AC items and all three DoD items confirmed. Mechanical gate exits 1 with 4 pre-write-back sequential-dependency clause violations (same pattern as M157-M165). Implementation correct: invariant I_16 added to OUTER-LOOP.md at lines 135-136 (commit d2d3621). No implementation defects.

## AC Satisfaction

### AC1 -- All occurrences of `rm experiments/quay-perpetual-stream/.halt` replaced with `rm -f`
**CONFIRMED.** Grep audit across the full experiment directory: OUTER-LOOP.md contains no literal `rm` commands targeting sentinel files (only the invariant documentation at line 135). All scripts (`routine-scheduler-selfcheck.sh`, `routine-file-gate-selfcheck.sh`, `it0-dashboard-line-budget-check-selfcheck.sh`) already use `rm -f` or `rm -rf`. No bare `rm` targeting `.halt` or any other sentinel file exists in committed code. The spurious error originated in agent behavior (session `a653b2e9`), not committed scripts. Invariant I_16 at OUTER-LOOP.md:135 mandates `rm -f` going forward. Commit d2d3621.

### AC2 -- Standing note in inherited-core.md or OUTER-LOOP.md
**CONFIRMED.** OUTER-LOOP.md lines 135-136:
```
I_16: sentinel-removal-idempotent (rm -f, not bare rm for any optional sentinel file; M166 crystallization)
```

### AC3 -- Zero spurious errors in subsequent sessions
**REFUTED.** This is a forward-looking behavioral guarantee that cannot be verified at audit time. The AC requires observing future sessions' error signals to confirm zero spurious `rm: cannot remove ... No such file or directory` errors. While the invariant I_16 should prevent recurrence by instructing future agents to use `rm -f`, the criterion as written demands evidence this audit cannot supply. Same pattern as:
- DIR-096 AC-2 (M148, dashboard.md line 473): meta-cc query over 7 days post-fix
- DIR-089 AC-3 (M151, dashboard.md line 477): meta-cc query over 14 days post-fix
- DIR-091 AC-3 (M152, dashboard.md line 479): post-milestone gate scripts using framework

The criterion should be restructured as a deferred follow-up check or a design-intent statement rather than a gate at audit time.

## DoD Satisfaction

### DoD 1 -- OUTER-LOOP.md and all affected scripts updated
**CONFIRMED.** OUTER-LOOP.md modified: 2 lines added (I_16 invariant at lines 135-136). Commit d2d3621. No script modifications needed -- all existing `rm` calls in scripts already use `rm -f` or `rm -rf`.

### DoD 2 -- Rule documented in inherited-core or OUTER-LOOP.md
**CONFIRMED.** OUTER-LOOP.md lines 135-136.

### DoD 3 -- Adversarial audit disposition recorded
**CONFIRMED.** This artifact serves as the audit disposition.

## Mechanical Gate

`it0-dod-check.sh` exits 1 (non-zero = REFUTED by construction) with 4 clause violations:

| Clause | Status | Analysis |
|---|---|---|
| clause0 (AC/DoD present) | FAIL | 3 AC items unchecked at gate-run time (pre-write-back). Now 2/3 ticked by audit. AC3 intentionally left unchecked. |
| clause1 (adversarial audit) | FAIL | Absorb entry lacked audit disposition (pre-write-back sequential dependency). |
| clause2 (vmeta lag) | FAIL | Absorb entry lacked vmeta disposition (pre-write-back sequential dependency). |
| clause7 (test floor) | FAIL | No product-touching surface (crystallization task) -- needs WAIVER line in absorb entry. |

All failures are pre-write-back sequential dependencies (same pattern as M157-M165). clause0 partially resolved by audit write-back (2 of 3 AC ticked). clause1, clause2, clause7 require absorb-entry updates (`## Audit disposition` / `## V-meta analysis` / `## Test-floor waiver` sections).

## Deviation rows written to dashboard.md

Two deviations recorded: (i) AC3 unverifiable forward-looking criterion (CONCERNS), (ii) mechanical gate pre-write-back failures (CONCERNS). See dashboard.md "Homeostatic variables" table for M166 rows.
