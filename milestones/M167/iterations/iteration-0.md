# M167 iteration-0 -- build report

**Task:** DIR-107 · **Charter:** M167-dir107-concurrent-fan-in-safety
**Date:** 2026-07-26 · **Class:** development (capability-growth)
**Iteration:** 0 · **Outcome:** done

## Evidence

### Done-when clause 1: IS_CONCURRENT Land phase no longer merges to master

`plugin/workflows/execute-milestone.js` lines 253-278: concurrent Land agent prompt rewritten:
- "do NOT merge to master" replaces "MERGE the iteration worktree into master"
- Step 1: "COMMIT the build in its OWN worktree branch"
- Step 2: "CAPTURE the worktree branch name" saved as `buildBranch`
- Return schema: `buildBranch` replaces `mergeCommit`
- Branch NOT pruned — pruning deferred to fan-in

```diff
-1. MERGE the iteration worktree into master
+1. COMMIT the build in its OWN worktree branch. Do NOT merge to master
+2. CAPTURE the worktree branch name: run `git branch --show-current`
```

### Done-when clause 2: Serial path UNCHANGED

`execute-milestone.js` lines 292-330: serial Land path is byte-identical to pre-fix state.
Merge-to-master, counter++, dashboard update all preserved exactly.

### Done-when clause 3: Anti-drift pre-merge

`OUTER-LOOP.md` lines 112-115: anti-drift is now step e, explicitly labeled "PRE-MERGE GATE":
- "Runs BEFORE any merge step g — master stays clean on HARD FAIL"
- Merge step (now g) follows after both pre-merge gates

### Done-when clause 4: Fan-in sole merge owner

`OUTER-LOOP.md` lines 118-119: step g:
- "MERGE each survivor one at a time in plan order consuming buildBranch (SOLE merge owner)"
- "Prune each branch after its merge"
- Invariant added: "step g is SOLE merge owner — workflows produce committed branches; fan-in owns all merges"

### Done-when clause 5: Audit-independence per survivor

`OUTER-LOOP.md` lines 107-111: new step d, "PRE-MERGE GATE":
- Verify each survivor's audit session ID != build session ID (DIR-032/034 anti-forgery)
- Failing survivor -> needs-human, excluded from fan-in
- Independent survivors still land (partial-batch)
- audit-indep gate explicitly removed from Workflow per DIR-097, runs at fan-in ABSORB

### Done-when clause 6: Empty-batch dispatch documented

`OUTER-LOOP.md` lines 92-97: new `dispatch` function:
```
dispatch(batch) =
  |batch| = 0 -> log("no batchable candidates; N deferred -> next pool") -> routines()
  |batch| = 1 -> execute(serial)
  |batch| >= 2 -> concurrent_execute
```

### Done-when clause 7: it0 selfchecks

- Gate-hash check: PASS (GATE-HASH-REF 5023da82 matches pinned source)
- DoD check: deferred to ABSORB phase (absorb entry is a template; AC/DoD ticks happen at audit)

### Done-when clause 8: No serial-path regression

Serial path (`execute_milestone.js` mode absent/"serial") is untouched — confirmed by diff showing zero changes to lines 292+.

## Files changed

| File | Change |
|---|---|
| `plugin/workflows/execute-milestone.js` | Concurrent Land: merge removed, buildBranch returned, schema updated (Fix 1) |
| `experiments/quay-perpetual-stream/OUTER-LOOP.md` | dispatch function (Fix 4), concurrent_execute reordered (Fixes 2+3) |
