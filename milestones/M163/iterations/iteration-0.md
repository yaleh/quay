# M163 Iteration 0 — Fix composePayload crash on undefined payload

**Date:** 2026-07-26
**Task:** gap-composePayload-null-payload
**Charter:** experiments/quay-perpetual-stream/charters/M163-gap-compose-payload.md
**Outcome:** done

## Summary

Added a null/empty guard in `composePayload()` before calling `replaceAll()` on `button.payload`. Previously, an `action_button` manifest entry missing the `payload` field would cause a `TypeError: Cannot read properties of undefined (reading 'replaceAll')` — an uncaught crash. Now it throws a clear, actionable error message.

## Changes

### `packages/quay/src/action.ts` (line 37)

Added guard after the button existence check and before `replaceAll()`:

```js
if (typeof button.payload !== 'string' || button.payload.trim() === '') {
  throw new Error(`action button '${actionId}' has no payload defined in provider manifest`);
}
```

This catches four error cases:
- `payload` field omitted entirely (undefined)
- `payload` set to `null`
- `payload` set to empty string `""`
- `payload` set to whitespace-only string

### `packages/quay/test/action-mock-delivery.test.mjs`

Added 5 test cases (section 6) covering:
1. Missing `payload` field (undefined) — expects clear error
2. `payload: null` — expects clear error
3. `payload: ""` — expects clear error
4. `payload: "   "` — expects clear error
5. Valid payload with `{{id}}` substitution — regression guard

All 28 assertions pass.

## Test results

```
node --test packages/quay/test/action-mock-delivery.test.mjs — PASS (1/1, 0 fail)
node --test packages/quay/test/serve-action-delivery.test.mjs — PASS (1/1, 0 fail)
```

## Done-when verification

1. **composePayload returns clear error (not crash) when payload is undefined.** — CONFIRMED. Error message: `action button 'no-payload' has no payload defined in provider manifest`. Catches undefined, null, empty string, and whitespace-only string.
2. **Existing tests pass.** — CONFIRMED. Both `action-mock-delivery.test.mjs` and `serve-action-delivery.test.mjs` pass with 0 failures.
