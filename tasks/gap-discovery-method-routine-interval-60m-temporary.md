---
id: gap-discovery-method-routine-interval-60m-temporary
title: "discovery-method routine: temporary 60m cadence (user-requested,
  expiring), timed from the last REAL driver invocation, with a 24h model-call
  cap"
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-discovery-holdout-cross-experiment-leak-and-contaminated-promotion
---
## Proposal
The user explicitly asked (2026-10-12) to temporarily run ONLY the `discovery-method` routine every 60 minutes instead of 360, to support development validation. Every other routine's cadence stays as is, and no global scheduling change is made.

Facts, read on production at 2026-10-12T12:50Z:
- `plugin/scripts/discovery-method-routine.ts` hard-codes `MIN_INTERVAL_MINUTES = 360` (around line 102) and refuses any configured interval below it (around line 166: "below the 360m floor … refused rather than silently rounded"). So `interval:60m` in config would fail closed today.
- `.quay/config.yml` `loop.discovery_method` = `{enabled: true, interval: interval:360m, max_experiences: 8, max_model_calls: 6, max_wall_ms: 900000}`.
- The config is read once at quality-gate driver start (`plugin/scripts/quality-gate-driver.ts` around line 1315, `discoveryMethodRoutineFromConfig`). A config change only takes effect after the driver reloads.
- `.quay/routine-last-run.json` `discovery-method = 1791796240114` (09:10:40Z) was written by a worker acceptance run before the fix in done task `gap-discovery-method-routine-manual-run-advances-production-last-run` landed. It is not a real driver invocation.
- No `scan-round` with `invoked_by:"resident-driver"` exists yet in `.quay/discovery-method-findings.jsonl`. Its 4 lines are all worker or manual runs; the latest manual one is at 12:49:23Z.

## Plan
1. **Per-routine floor.** Lower the `discovery-method` floor to 60m. The default stays 360m when `interval` is absent. Other routines' floors and intervals are untouched.
2. **Temporary override, fail-safe.**
   - New optional config key `interval_until: <ISO-8601>`. While now < `interval_until`, the configured interval applies; after it, the routine reverts to the 360m default and records the revert in its Fact.
   - An interval below 360m WITHOUT `interval_until` ⇒ config error (`failed`, zero spawns). So a 60m cadence can never become permanent silently.
3. **Production timing from the last real driver invocation.**
   - A resident round computes "due" from the latest `scan-round` line with `invoked_by:"resident-driver"` in `.quay/discovery-method-findings.jsonl`. When there is none, it uses `.quay/routine-last-run.json` only if that entry is stamped as written by the resident driver. Stamp new resident writes, e.g. a sibling key `discovery-method@invoked_by`.
   - An unstamped legacy entry, like today's 09:10:40Z one, is treated as "no real driver invocation". The routine records that it was ignored and why.
   - Do NOT edit or delete the existing legacy value. Manual rounds still never write last-run.
4. **Safety limits for the faster cadence.**
   - New key `max_model_calls_per_24h` (required when the interval is < 360m), enforced across rounds from the `scan-round` lines in the trailing 24h. Hitting it ⇒ `not-evaluated:budget-24h`, zero spawns.
   - The existing per-round `max_experiences` / `max_model_calls` / `max_wall_ms` and the `enabled` kill switch are unchanged.
5. **Deployment.**
   - Set `.quay/config.yml` `loop.discovery_method` to `interval: interval:60m`, `interval_until` = landing time + 7 days, `max_model_calls_per_24h: 24`. Keep the other keys.
   - Reload the quality-gate driver so the config is read. Use the documented driver lifecycle (manager standing authority, CLAUDE.md); verify no in-flight worker would be affected; never `pkill -f`. Record the reload and the driver's startup line naming the assembled interval.

## Acceptance Criteria
- [ ] `node --test plugin/test/discovery-method-routine.test.mjs` exits 0, with new cases:
  - (a) `interval:60m` + a future `interval_until` ⇒ accepted, due after 60m;
  - (b) `interval:60m` without `interval_until` ⇒ config error, zero spawns;
  - (c) after `interval_until` passes ⇒ 360m applies and the Fact says so;
  - (d) a legacy unstamped last-run entry is ignored for due-computation, and a resident-stamped one is honoured;
  - (e) a manual round between two resident rounds does not shift the resident due time;
  - (f) `max_model_calls_per_24h` reached ⇒ `not-evaluated:budget-24h`, zero spawns;
  - (g) `arch-discovery` and other routine intervals are unaffected (fixture with both routines).
- [ ] `node --test plugin/test/quality-gate-driver.test.mjs plugin/test/arch-discovery-routine.test.mjs` exits 0.
- [ ] Deployment, real: paste the `.quay/config.yml` `loop.discovery_method` section, the reload command and its output, and the driver stderr line reporting the assembled discovery-method interval. Also paste `jq -c . .quay/routine-last-run.json` before and after the reload, with every key unchanged.
- [ ] Production reading: at least two `scan-round` lines with `invoked_by:"resident-driver"` after landing, about 60m apart, with their matching quality-round facts. If not yet observed, write 未读到 with the computed next due time. （待外部）

## Definition of Done
- AC1–AC3 ticked with output pasted; AC4 read from production or recorded as not yet read.
- `scripts/test.sh --for-task gap-discovery-method-routine-interval-60m-temporary` green.

## Touches
- tasks/gap-discovery-method-routine-interval-60m-temporary.md
- plugin/scripts/discovery-method-routine.ts
- plugin/test/discovery-method-routine.test.mjs
- .quay/config.yml
