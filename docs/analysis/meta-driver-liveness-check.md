# meta-driver liveness check (standalone, on-demand)

Implements `tasks/gap-meta-driver-minimal-production-liveness-check.md`, following from the
backtest in `tasks/gap-meta-driver-self-health-backtest.md`. Flags the real semantic-half
outage (zero successful `verified` rounds since 2026-09-12T02:21:57Z) using the N=3
consecutive-non-verified rule, which the backtest showed detects a real outage within under an
hour with **zero false alarms** across the full 53,000-round production history.

## Usage

```
node docs/analysis/meta-driver-liveness-check.mjs --root <workspace root>   # defaults to .
node docs/analysis/meta-driver-liveness-check.mjs --self-test              # run embedded fixtures
```

Exit codes: `0` healthy, `1` degraded (N≥3 consecutive non-`verified` attempts), `3`
not-evaluated (carrier missing, unreadable, or empty — never silently folded into healthy).

## Scope note — what this is NOT (read before assuming more automation exists)

This is a **standalone, on-demand CLI tool only**. It is **not wired into `quay driver status`'s
automatic output** (`packages/quay/src/cli/driver.ts` / `plugin/scripts/driver-runtime.ts`), is
**not registered as a shipped `plugin/scripts/*.ts` capability**, and triggers **no automatic
alerting or halting**. Someone (or some future scheduled task) has to actually run it. Wiring
this verdict into `quay driver status`'s existing output is a legitimate, separate follow-up —
deliberately deferred because that integration point lives in heavily regression-tested shared
production files (12+ `driver-runtime-s*.test.mjs` files) that deserve their own dedicated task
with a full suite run, not a change bundled into this one.

## Current real result (at landing time)

```
$ node docs/analysis/meta-driver-liveness-check.mjs --root .
{"ok":false,"state":"degraded","reason":"1895 consecutive non-verified attempts (threshold N=3); last verified at 2026-09-12T02:21:57.766Z", ...}
$ echo $?
1
```

The real outage is still ongoing as of this writing.
