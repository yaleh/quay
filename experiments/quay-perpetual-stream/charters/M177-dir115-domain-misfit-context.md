# M177 — Interpolate ${args.charterFile} into the domain-misfit Verify-check prompt (DIR-115)

**Task:** DIR-115 · **Counter:** 177 · **Chart:** 2
**Class:** development · **Value type:** instrumentCorrection
**Deliverable:** no · **Charter tokens:** ~0.7 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (instrument-correction, VT-neutral). domain-misfit is the only one of 5 Verify-phase it0
checks in `execute-milestone.js` dispatched with zero milestone context — 33 real historical
samples (meta-cc, 2026-07-25..26) show mean 92s/median 90s (vs 5-30s for the other 4 checks that
DO receive `${args.charterFile}`), because the agent burns most of its runtime rediscovering which
milestone it's checking before it can apply the actual decision procedure.

## Scope
Per DIR-115's Requested action:
1. `.claude/workflows/execute-milestone.js`'s domain-misfit dispatch prompt (currently ~line 78,
   inside `_dispatchList`) gains `${$a.taskId}`/`${$a.charterFile}` interpolation, matching the
   pattern already used by the other 4 checks in the same list (e.g. gate-hash's
   `--by-reference ${$a.charterFile}`).
2. No change to the decision logic, schema, or the DIR-079 per-check cache path
   (`_cached('domain-misfit')`/`verifyCacheUpdates`) — prompt-context-only.
3. Mirror the identical edit into `plugin/workflows/execute-milestone.js` (byte-identical mirror
   discipline, same as M175/M176).
4. Demonstrate via a real (non-fixture) execute-milestone dispatch: domain-misfit's own
   `agent-*.jsonl` trace locates the correct charter/task in its first few tool calls (no
   dashboard.md/milestones-directory/quay-task-list reconnaissance), with a measured wall-time
   below the 90s pre-change median, and the SAME `ok`/`step3conclusion` verdict as the pre-change
   procedure would produce for the same charter (golden-replay, not a claimed-identical assertion).

**Out of scope:** any change to the domain-misfit decision procedure itself, to the other 4
Verify-phase checks, or to the DIR-079 caching mechanism.

## Touches
- .claude/workflows/execute-milestone.js
- plugin/workflows/execute-milestone.js

## Done-when
1. `execute-milestone.js`'s domain-misfit dispatch prompt string contains `${$a.charterFile}`
   (`grep -A2 "domain-misfit audit-channel"` confirms the interpolation).
2. Both `.claude/workflows/` and `plugin/workflows/` copies stay byte-identical (`diff` confirms).
3. A real execute-milestone dispatch (this very milestone's own Verify phase is the first
   opportunity — self-referential in the same bootstrap-paradox shape as M175/M176) shows
   domain-misfit's tool-call trace going straight to the correct charter, with a real measured
   duration, and the same `ok` verdict DIR-115's Finding's own worked examples (M167/DIR-107,
   M173/DIR-109) would produce if replayed.
4. No regression to `node --check` on both files.

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
