---
id: exp5-CRYST-SENTINEL-REMOVAL-IDEMPOTENT
title: "crystallization: rm -f for sentinel-file removal — idempotent sentinel ops as a standing rule"
status: todo
labels:
  - crystallization
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

- [ ] All occurrences of `rm experiments/quay-perpetual-stream/.halt` (or equivalent) in `OUTER-LOOP.md` and scripts replaced with `rm -f`
- [ ] A standing note in `inherited-core.md` (or `OUTER-LOOP.md`) states the sentinel-removal rule: "use `rm -f`, never bare `rm`, for any optional sentinel file"
- [ ] Zero spurious `rm: cannot remove ... No such file or directory` errors appear in subsequent sessions' error signals

## Definition of Done

References the standard inherited-core DoD clauses.

- [ ] `OUTER-LOOP.md` and all affected scripts updated
- [ ] Rule documented in inherited-core or OUTER-LOOP.md
- [ ] Adversarial audit disposition recorded
