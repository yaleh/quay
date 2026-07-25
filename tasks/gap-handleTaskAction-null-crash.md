---
title: "serve: handleTaskAction crashes on nonexistent task (null dereference)"
status: todo
labels:
  - defect
  - milestone-candidate
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    gap-handleTaskAction-null-crash
    experiments/quay-perpetual-stream/charters/M160-gap-null-crash.md
    /tmp/m160-absorb-entry.md
---

## Finding

In `packages/quay/src/serve-handlers.ts` line 975, `handleTaskAction` dereferences `t!.id` without first checking whether `t` is null. The function `client.taskGet(decodedId)` on line 955 can return null when the task ID does not exist. The sister function `handleTaskDetail` (line 879-884) correctly returns 404 when `t` is null, but `handleTaskAction` has no such guard and crashes with a TypeError.

**Reproduction:** A POST to `/task/DOESNOTEXIST/action/advance` would reach `handleTaskAction` (matched by the route regex `^/task/([^/]+)/action/([^/]+)$` on line 1059). The `taskGet` returns null, and line 975's `t!.id` throws `TypeError: Cannot read properties of null (reading 'id')`.

**Evidence:** Read `packages/quay/src/serve-handlers.ts` lines 954-975. The null-check exists in `handleTaskDetail` (line 880: `if (!t) { res.writeHead(404, ...) }`) but was omitted from `handleTaskAction`. The code path is reachable because the route handler on line 1060 does not validate task existence before calling `handleTaskAction`.

## Proposal

Add a null check after `const t = await client.taskGet(decodedId);` in `handleTaskAction`, matching the existing pattern in `handleTaskDetail` (line 880-883). On null: respond with 404 and return.

## Plan

1. Add `if (!t) { res.writeHead(404, {"Content-Type": "text/plain"}); res.end("not found"); return; }` after line 955 in `packages/quay/src/serve-handlers.ts`
2. Update the `baseRedirect` fallback on line 975 to use `decodedId` instead of `t!.id` (since `t` is now guaranteed non-null)
3. Add a test case for POST to nonexistent task action endpoint

## Acceptance Criteria

- [ ] POST to `/task/nonexistent-id/action/advance` returns HTTP 404
- [ ] `node --test packages/quay/test/serve.test.mjs` passes
- [ ] No TypeError unhandled crash

## Definition of Done

- [ ] Null check added to handleTaskAction after line 955
- [ ] Tests pass
- [ ] New test exercises 404 path for nonexistent task POST


## Touches
- packages/quay/src/serve-handlers.ts
