# M168 Iteration 0 — Build Report

**Task:** DIR-062-B · **Charter:** experiments/quay-perpetual-stream/charters/M168-dir062-b-human-steered-definition.md
**Class:** development · **Value type:** governance-integrity
**Date:** 2026-07-26

## Done-when verification

### 1. inherited-core.md three clause markers

The `humanSteered :: Task -> Bool` section in inherited-core.md (lines 294-321) contains all three clause markers:

- **driverFileEdit** (driver-self-rewrite): line 301 — `driverFileEdit(t) = ... basename(f) in {"OUTER-LOOP.md", "inherited-core.md"} ... isUnder(f, ".claude/skills/")`
- **missionRedirection** (mission-redirection): line 305 — `missionRedirection(t) = t.extra.missionRedirection = true`
- **unauthorizedWorkspace** (cross-workspace): line 309-310 — `unauthorizedWorkspace(t) = ... ¬isCovered(w, drivableWorkspacesYml)  -- drivable-workspace-check.ts (fail-closed)`

Clause 3 references `drivable-workspace-check.ts` which loads `drivable-workspaces.yml` as its single source. The exec block (lines 315-321) names `scripts/human-steered-classify.ts` as the SINGLE executable source.

```
$ grep -c 'driverFileEdit\|driver-self-rewrite' inherited-core.md
4
$ grep -c 'missionRedirection\|mission-redirection' inherited-core.md
5
$ grep -c 'unauthorizedWorkspace\|cross-workspace' inherited-core.md
5
$ grep -c 'drivable-workspaces.yml\|drivableWorkspacesYml' inherited-core.md
1
```

### 2. OUTER-LOOP.md SELECT invokes human-steered-classify

OUTER-LOOP.md SELECT step (lines 38-42) now explicitly invokes `scripts/human-steered-classify.ts` with the gap-fix prose:

```
  ⊨ human-steered EXCLUDE — scripts/human-steered-classify.ts (DIR-062-A); label:human-steered ≡ manual override
     -- classify: --touched from task ## Touches; absent → no --touched flags
     -- classify: --mission-redirection — human-set marker, NEVER inferred
     -- classify: --workspace → drivable-workspace-check.ts against drivable-workspaces.yml
     -- safety: driver-file-editing tasks WITHOUT ## Touches MUST carry label:human-steered
```

Invariant I_12 (line 160) also references `scripts/human-steered-classify.ts`.

```
$ grep -n 'human-steered-classify' OUTER-LOOP.md
38: ...scripts/human-steered-classify.ts (DIR-062-A)...
160: I_12: human-steered EXCLUDE (scripts/human-steered-classify.ts; ...)
```

### 3. Golden-replay: classifier verdicts match hand-labels

DIR-062-B's charter Touches (inherited-core.md + OUTER-LOOP.md):

```
$ node scripts/human-steered-classify.ts --touched experiments/quay-perpetual-stream/inherited-core.md --touched experiments/quay-perpetual-stream/OUTER-LOOP.md
{
  "humanSteered": true,
  "clauses": {
    "driverFileEdit": true,
    "missionRedirection": false,
    "unauthorizedWorkspace": false
  },
  "unauthorizedWorkspaces": []
}
```

Mission-redirection flag alone:

```
$ node scripts/human-steered-classify.ts --mission-redirection
{
  "humanSteered": true,
  "clauses": { "driverFileEdit": false, "missionRedirection": true, ... }
}
```

Non-driver task (packages/quay/src/gate/registry.ts):

```
$ node scripts/human-steered-classify.ts --touched packages/quay/src/gate/registry.ts
{
  "humanSteered": false,
  ...
}
```

All verdicts match expected classifications. No reclassification drift.

### 4. Selfchecks + fixtures green

```
$ bash scripts/dod-fixture-selfcheck.sh
PASS: all 17 DoD fixtures behaved as asserted.

$ node --test test/human-steered-classify.test.mjs
tests 23 / pass 23 / fail 0

$ node scripts/human-steered-classify.ts --selftest
SELFTEST: all fixture cases PASS.
```

### 5. split-or-commit check

```
$ node scripts/it0-split-or-commit-check.ts .
PASS: 428 task(s) checked — no split-or-commit violations
```

## Summary

All 5 Done-when clauses satisfied. One edit to OUTER-LOOP.md (gap-fix prose at the human-steered EXCLUDE line, lines 38-42). No changes needed to inherited-core.md (three clause markers + exec block already present). Golden-replay confirms no reclassification drift. All selfchecks and fixtures remain green.
