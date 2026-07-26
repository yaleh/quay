---
id: exp5-CRYST-SENTINEL-REMOVAL-IDEMPOTENT
title: "crystallization: rm -f for sentinel-file removal — idempotent sentinel
  ops as a standing rule"
status: done
labels:
  - milestone-candidate
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-CRYST-SENTINEL-REMOVAL-IDEMPOTENT
    experiments/quay-perpetual-stream/charters/M166-cryst-sentinel.md
    /tmp/m166-absorb-entry.md
---
## Proposal

The OUTER-LOOP.md and supporting scripts use `rm <sentinel-file>` to remove halt/state sentinels.
When the sentinel does not exist (the normal/cleared state), `rm` exits 1 with an error message.
This is a one-time fix that recurred as a spurious error in the session history, and the pattern
generalizes to every sentinel-file operation in the loop.

**Evidence:** `query_session_signals` (type=errors), session `a653b2e9-8c25-4560-8c85-bd3e757e56f3`,
2026-07-21T15:52:39Z:
```
Exit code 1
rm: cannot remove 'experiments/quay-perpetual-stream/.halt': No such file or directory
```
The loop was attempting to clear the `.halt` sentinel as a routine start-of-iteration step.
Since `.halt` was not present (the loop had not been halted), the `rm` produced a spurious
exit-code 1 error that appears in the error corpus and masks real errors.

**Generalization:** Any sentinel file in the loop (`experiments/quay-perpetual-stream/.halt`,
and any future sentinel files added by expanding the OUTER-LOOP) should follow the same
idempotent removal pattern: `rm -f <file>` (exits 0 when absent) rather than `rm <file>`
(exits 1 when absent). This is a one-line fix that should be applied as a standing rule
across all sentinel operations, not just the specific `.halt` file.

**Why this is a crystallization (not just a local fix):**
- The spurious errors pollute the error corpus (meta-cc `analyze_errors` cannot distinguish real
  failures from sentinel noise)
- If the `.halt` removal is part of a `&&`-chained command, the exit-1 will abort the chain silently
- Future sentinel files (if added) will inherit the same pattern — the rule needs to be stated once

## Plan

N/A — targeted edit to `OUTER-LOOP.md` and any scripts that use `rm` on optional sentinel files,
replacing with `rm -f`. Add a standing note in `inherited-core.md` under "sentinel file conventions"
that all sentinel removals MUST use `rm -f`.

## Acceptance Criteria

- [x] All occurrences of `rm experiments/quay-perpetual-stream/.halt` (or equivalent) in `OUTER-LOOP.md` and scripts replaced with `rm -f` *(audit: CONFIRMED — no bare `rm` for sentinels found in committed code; scripts already use `rm -f`/`rm -rf`; invariant I₁₆ at OUTER-LOOP.md:135 mandates `rm -f`; commit d2d3621)*
- [x] A standing note in `inherited-core.md` (or `OUTER-LOOP.md`) states the sentinel-removal rule: "use `rm -f`, never bare `rm`, for any optional sentinel file" *(audit: CONFIRMED — OUTER-LOOP.md line 135: `I₁₆: sentinel-removal-idempotent (rm -f, ¬bare rm for any optional sentinel file; M166 crystallization)`)*
- [ ] Zero spurious `rm: cannot remove ... No such file or directory` errors appear in subsequent sessions' error signals *(audit: REFUTED — forward-looking behavioral guarantee; unverifiable at audit time; same pattern as M148/DIR-096 AC-2, M151/DIR-089 AC-3, M152/DIR-091 AC-3)*

## Definition of Done

References the standard inherited-core DoD clauses.

- [x] `OUTER-LOOP.md` and all affected scripts updated *(audit: CONFIRMED — I₁₆ invariant added to OUTER-LOOP.md:135-136; no script changes needed (all already use `rm -f`/`rm -rf`); commit d2d3621)*
- [x] Rule documented in inherited-core or OUTER-LOOP.md *(audit: CONFIRMED — OUTER-LOOP.md lines 135-136)*
- [x] Adversarial audit disposition recorded *(audit: CONFIRMED — this audit artifact at milestones/M166/audits/iteration-0-acceptance-audit.md)*


## Scope narrowed (2026-07-26)

Per review of stale-todo backlog: the `rm` without `-f` pattern is a one-line fix.
Some scripts already use `rm -f` (routine-scheduler-selfcheck.sh, routine-file-gate-selfcheck.sh).
Scope: audit all scripts/ for bare `rm` calls against sentinel/optional files, change to `rm -f`.
Estimate: ~5 lines changed across 2-3 scripts.

## Plan

N/A — docs change. Replace rm with rm -f for sentinel removal.

## Touches
- experiments/quay-perpetual-stream/OUTER-LOOP.md

## Execution record

- **Milestone:** M166
- **Iteration count:** 0 (direct commit, crystallization)
- **Realized Δv:** 0 (crystallization — no chart-2 surface cell moves)
- **Merge commit:** d2d3621
- **Outcome:** Done — rm -f sentinel-removal invariant I₁₆ added to OUTER-LOOP.md; no code changes needed (all scripts already used rm -f/rm -rf); adversarial audit returned CONCERNS (AC3 forward-looking unverifiable; 4 sequential pre-write-back template gaps self-resolved); milestone counter advanced 165→166.
