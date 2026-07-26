# M160 Iteration-0 Acceptance Audit — gap-handleTaskAction-null-crash

**Audit session id:** 28186b2d-f609-457d-8a6e-0b74f410e3be

## Verdict: CONCERNS (non-blocking)

## AC Satisfaction

### AC #1: POST to `/task/nonexistent-id/action/advance` returns HTTP 404

**CONFIRMED.** Source evidence:
- `packages/quay/src/serve-handlers.ts` L955-959: null check `if (!t) { res.writeHead(404, ...); res.end("not found"); return; }` added after `const t = await client.taskGet(decodedId);`
- `baseRedirect` at L980 now uses `decodedId` (available after the guard), not `t!.id`
- `packages/quay/test/serve.test.mjs` L148-154: explicit test `POST /task/NOPE-999/action/advance` asserts 404 status and "not found" body

### AC #2: `node --test packages/quay/test/serve.test.mjs` passes

**CONFIRMED.** Test run output: 1 suite, 1 pass, 0 fail, 0 skipped. All QN-031 serve/action regression tests passed. Duration 84,175ms.

### AC #3: No TypeError unhandled crash

**CONFIRMED.** The null check at L955-959 returns with 404 before any access to the `t` variable. The guarded code path (`t!.id`, `client.taskCheck(decodedId)`, etc.) at L960-989 is unreachable when `t` is null. The sister function `handleTaskDetail` (L879-884) has the same pattern, confirming this is the intended defensive idiom.

## DoD Satisfaction

### DoD #1: Null check added to handleTaskAction after line 955

**CONFIRMED.** `serve-handlers.ts` L955-959.

### DoD #2: Tests pass

**CONFIRMED.** Full serve test suite exit 0.

### DoD #3: New test exercises 404 path for nonexistent task POST

**CONFIRMED.** `serve.test.mjs` L148-154 tests POST to `/task/NOPE-999/action/advance` with 404 assertion.

## Mechanical Gate

`it0-dod-check.sh` pre-write-back exit code: 1 (6 clause violations). After audit write-back (ticked AC/DoD checkboxes, added ABSORB dispositions, created this artifact), the remaining concern is clause0 DoD format — the task's DoD section does not reference the standard inherited-core 5-clause DoD. This is a task-authoring format concern (non-blocking); all 3 task-specific DoD items are satisfied.

## Concerns

1. **DoD format (non-blocking):** The task's `## Definition of Done` section lists 3 custom items rather than referencing the standard inherited-core 5-clause DoD. All 3 items are verified satisfied. This is a task-authoring convention issue — future milestone tasks should reference the standard DoD per the reference-plus-extras rule.

2. **Test coverage adequacy:** serve-handlers.ts coverage is 89.93% line / 84.79% branch / 88.46% funcs — well above the 80% threshold. The M160 fix's specific code path (L955-959 null check) is directly exercised by the new test at serve.test.mjs L148-154.

## Deviation Write-Back

One deviation row written to `experiments/quay-perpetual-stream/dashboard.md` "Homeostatic variables (DIR-017 Step 3)" table: CONCERNS (DoD format), caught-by: machine, caught-at: M160.
