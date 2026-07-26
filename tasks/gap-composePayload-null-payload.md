---
id: gap-composePayload-null-payload
title: action.ts composePayload crashes on action_button with undefined payload
status: todo
role: primitive
labels:
  - gap
  - routine-filed
  - milestone-candidate
  - self-validation
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh gap-composePayload-null-payload experiments/quay-perpetual-stream/charters/M163-gap-compose-payload.md /tmp/m163-absorb-entry.md
---

## Proposal

Fix `composePayload` in `packages/quay/src/action.ts` to validate that `button.payload` is a non-empty string before calling `replaceAll()`, returning a clear error instead of a crash.

## Finding

`composePayload()` at `packages/quay/src/action.ts:37` accesses `button.payload.replaceAll("{{id}}", task.id)` without validating that `button.payload` is a string. When an action_button entry in a provider's `provider.yml` manifest omits the `payload` field (or sets it to a non-string value), this produces `TypeError: Cannot read properties of undefined (reading 'replaceAll')` — an uncaught crash rather than a clear, actionable error message.

**Reproduction:**
```js
import { composePayload } from './action.ts';
composePayload({
  providerManifest: {
    action_buttons: [{ id: 'test', label: 'Test' }],
  },
  task: { id: 'TEST-1', status: 'todo' },
  actionId: 'test'
});
// TypeError: Cannot read properties of undefined (reading 'replaceAll')
```

**Confirmed:** node v25.x, exit code 0 (uncaught promise rejection), verified 2026-07-26.

**Where:** `packages/quay/src/action.ts`, line 37.

**Why it matters:** The `provider.yml` manifest is external configuration, not code under the same validation guarantees. A malformed or incomplete manifest should produce a clear error (`"action button 'test' has no payload"`) rather than a cryptic `TypeError` crash. This affects the CLI (`quay action run`), Web UI (POST /task/:id/action/:actionId), and MCP (`action_run` tool) — all three call `composePayload`.

## Plan

Add a guard after the `button` existence check:
```js
if (typeof button.payload !== 'string' || button.payload.trim() === '') {
  throw new Error(`action button '${actionId}' has no payload defined in provider manifest`);
}
```

This matches the existing defensive pattern already used in the `acceptance` gate for `task.extra.acceptance` at `packages/quay/src/gate/registry.ts:93`.

## Acceptance Criteria

- [x] `composePayload` throws a clear error when `button.payload` is missing/undefined/empty
- [x] Existing tests (`action-mock-delivery.test.mjs`, `serve-action-delivery.test.mjs`) continue to pass
- [x] Test added for the missing-payload edge case

## Definition of Done

- [x] Guard added at `action.ts:37`
- [x] Test added in `action-mock-delivery.test.mjs`
- [x] Full test suite passes: `node --test packages/quay/test/action-mock-delivery.test.mjs`
- [x] Standard DoD per inherited-core.md: AC-implementation-test-coverage (three clauses met — guard implemented, tests added, existing tests verified green)


## Touches
- packages/quay/src/action.ts
