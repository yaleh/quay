# M162 iteration-0 report

**Task:** exp5-M-STALE-DEVIATION-CLEANUP-162
**Charter:** experiments/quay-perpetual-stream/charters/M162-stale-deviation-cleanup.md
**Absorb entry:** /tmp/m162-absorb-entry.md
**Started:** 2026-07-25
**Iteration:** 0

## What was done

Updated the stale deviation row for DIR-070-C in `dashboard.md` from `open` to `verified-eliminated`.

### Charter Done-when

1. **Stale deviation row status updated to "verified-eliminated"** -- DONE.

### Changes

1. `experiments/quay-perpetual-stream/dashboard.md` line 455: Changed DIR-070-C deviation row status from `open` to `verified-eliminated`. Updated description to cite the fix commit `4d043d3` (2026-07-25) that restored backward-compat positional arg support in `it0-impl-row-check.sh`.

2. `experiments/quay-perpetual-stream/dashboard.md` line 437 (summary row a): Added "(now verified-eliminated)" annotation after `DIR-070-C-impl-row-backward-compat`.

3. `experiments/quay-perpetual-stream/dashboard.md` line 438 (summary row b): Updated verified-eliminated count from 5/37 to 6/37 (added `DIR-070-C-impl-row-backward-compat` to the verified-eliminated list).

### Evidence

- Fix commit `4d043d3` exists on master: `fix: restore backward-compat positional arg support in it0-impl-row-check.sh`
- The deviation was a real bug (while-loop parser overwriting MILESTONE_ID with the backlog file path), found at M139 audit, fixed post-hoc in commit 4d043d3
- The deviation row was still showing `open` despite the fix being merged -- this is a purely clerical cleanup

### Acceptance gate

Set `extra.acceptance` on the task to run the mechanical enforcer:
```
bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-STALE-DEVIATION-CLEANUP-162 experiments/quay-perpetual-stream/charters/M162-stale-deviation-cleanup.md /tmp/m162-absorb-entry.md
```

### Test results

No code changes -- documentation-only edit. No tests affected.
