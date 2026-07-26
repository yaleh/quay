# M166 iteration-0 -- inner iteration build report

**Task:** exp5-CRYST-SENTINEL-REMOVAL-IDEMPOTENT
**Charter:** experiments/quay-perpetual-stream/charters/M166-cryst-sentinel.md
**Date:** 2026-07-26
**Build executor:** Claude Code (subagent)

## What was done

### Pre-flight

Set `extra.acceptance` on the task via `quay task edit --acceptance`:
```
bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-CRYST-SENTINEL-REMOVAL-IDEMPOTENT experiments/quay-perpetual-stream/charters/M166-cryst-sentinel.md /tmp/m166-absorb-entry.md
```

### Audit of existing code

Searched the entire experiment directory (`experiments/quay-perpetual-stream/`) for bare `rm` commands targeting sentinel files:
- **OUTER-LOOP.md**: No literal `rm` commands found. The file is a formal specification.
- **scripts/**: All existing `rm` calls already use `rm -f` or `rm -rf` (`routine-scheduler-selfcheck.sh`, `routine-file-gate-selfcheck.sh`, `it0-dashboard-line-budget-check-selfcheck.sh`). No bare `rm` targeting sentinel files.
- **Workflows** (`.claude/workflows/`): No `rm` shell commands found.

**Finding**: The bare `rm` pattern for `.halt` removal was in agent behavior (detected via history-mining from session `a653b2e9`), not in any committed script. The loop agent was using `rm` without `-f` to clear the `.halt` sentinel based on implicit behavior, producing spurious exit-code-1 errors when `.halt` was not present.

### Implementation

Added invariant I_16 to OUTER-LOOP.md INVARIANTS section:

```
I_16: sentinel-removal-idempotent (rm -f, not bare rm for any optional sentinel file; M166 crystallization)
```

This crystallizes the `rm -f` pattern as a standing loop invariant. All agents reading OUTER-LOOP.md will now see this as a mechanical rule, preventing the spurious `rm: cannot remove ... No such file or directory` error from recurring.

### Verification

- `dod-fixture-selfcheck.sh`: PASS (17/17 fixtures)
- No existing tests or scripts were modified
- The change is a single invariant addition to OUTER-LOOP.md

## How each Done-when clause is satisfied

**Done-when 1: rm -f used for sentinel removal (idempotent when absent)**

I_16 codifies `rm -f` as a loop-driven invariant for any sentinel file operation. The existing scripts already use `rm -f`. The gap was in agent behavior (implicit `rm` on `.halt`), which is now governed by this explicit invariant.

## How each AC is satisfied

- **AC1 (all occurrences replaced)**: No literal `rm` commands existed in OUTER-LOOP.md or committed scripts that targeted sentinel files. The invariant I_16 now mandates `rm -f` going forward.
- **AC2 (standing note)**: I_16 in OUTER-LOOP.md is the standing note — "rm -f, not bare rm for any optional sentinel file."
- **AC3 (zero spurious errors)**: Post-merge outcome; the invariant ensures agents use `rm -f` for sentinel removal.

## DoD self-assessment

Per inherited-core.md clauses:
- Clause 0 (checklist-form): satisfied (AC in checklist form, unchecked at build time)
- Clause 1 (adversarial audit): pending audit phase
- Clause 8 (task canonical-lifecycle-record): build executor records here; audit records in separate audit artifact
