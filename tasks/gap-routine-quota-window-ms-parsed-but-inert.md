---
id: gap-routine-quota-window-ms-parsed-but-inert
title: routine_quota.window_ms is parsed from drivers.yml but no consumer reads
  it; both filing paths use a hard-coded window constant
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
---
## Proposal
`plugin/scripts/driver-config.ts` `loadRoutineQuotaConfig` parses `routine_quota.window_ms`, around line 197: `const windowMs = pick("window_ms", d.windowMs);`. The only exported consumers are `routineK` (around line 232) and `routineGlobalCeiling` (around line 240). Nothing reads `.windowMs`: a grep for `\.windowMs` outside driver-config and tests finds only unrelated windows (`meta-driver.ts` action-record config, `worker-driver.ts` retry exemption). Both filing paths count the window with the constant `FILING_WINDOW_MS`: `probe-routine.ts` (imported around line 56) and `meta-driver.ts` (`countRecentFilings` around line 1775).

So editing `window_ms` silently does nothing. That is a declared knob that is inert (hard rule 3b / rule 9). There is zero impact today, because the configured value (86400000) equals the constant.

## Plan
Export a `routineWindowMs(root)` from driver-config, shaped like `routineK` / `routineGlobalCeiling`. Use it at every `countRecentFilings` call site in `probe-routine.ts` and `meta-driver.ts`. Keep the default equal to today's constant, so there is no behaviour change at the default.

## Acceptance Criteria
- [ ] `node --test plugin/test/driver-config.test.mjs plugin/test/probe-routine.test.mjs plugin/test/meta-driver.test.mjs` exits 0. New cases:
  - (a) In a fixture with `window_ms: 3600000` and a filing record 2 hours old, `selectFilings` does NOT count that record toward the per-routine or global quota. With the default config, it does.
  - (b) Same for the meta-driver `driveItems` global count.
- [ ] Static check: `grep -n 'FILING_WINDOW_MS' plugin/scripts/probe-routine.ts plugin/scripts/meta-driver.ts` shows no use as a `countRecentFilings` window argument. Paste the output.
- [ ] Mutation control: make `routineWindowMs` return the old constant regardless of config and show case (a) goes red. Paste the output, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-routine-quota-window-ms-parsed-but-inert` green.

## Touches
- tasks/gap-routine-quota-window-ms-parsed-but-inert.md
- plugin/scripts/driver-config.ts
- plugin/scripts/probe-routine.ts
- plugin/scripts/meta-driver.ts
- plugin/test/driver-config.test.mjs
- plugin/test/probe-routine.test.mjs
- plugin/test/meta-driver.test.mjs
