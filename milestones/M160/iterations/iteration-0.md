# M160 iteration-0 report — gap-handleTaskAction-null-crash

**Milestone:** M160
**Task:** gap-handleTaskAction-null-crash
**Class:** development (capability-growth)
**Chart:** 2

## Changes

### 1. Null check added to handleTaskAction (`packages/quay/src/serve-handlers.ts`)

Added an early-return null guard after `client.taskGet(decodedId)` in `handleTaskAction`, matching the existing pattern in `handleTaskDetail` (line 880-883).

```typescript
if (!t) {
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
  return;
}
```

### 2. Fallback updated on baseRedirect

Changed the `baseRedirect` fallback from `t!.id` to `decodedId`. After the null guard, TypeScript narrows `t` to non-null, so `t.id` would also be safe — but using `decodedId` avoids the unnecessary property access entirely.

### 3. Non-null assertions replaced

Replaced all remaining `t!` non-null assertions with `t` throughout the function body. After the null guard, TypeScript's control-flow analysis guarantees `t` is non-null, so the `!` assertions are no longer needed and their removal eliminates any latent type-safety gaps.

### 4. New test case (`packages/quay/test/serve.test.mjs`)

Added a test case verifying that `POST /task/NOPE-999/action/advance` returns HTTP 404 with body "not found", placed alongside the existing `GET /task/NOPE-999 -> 404` test.

## Verification

- `node --test packages/quay/test/serve.test.mjs` — all tests pass (1 suite, 0 failures)
- New test: `POST /task/NOPE-999/action/advance returns 404 (got 404)` — PASS
- No regressions in existing serve tests

## Done-when checklist

1. [x] handleTaskAction returns 404 for nonexistent task (instead of crashing)
2. [x] Existing serve tests stay green
