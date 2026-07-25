# M138 iteration-0 report — 2026-07-25

**Task:** DIR-069
**Charter:** experiments/quay-perpetual-stream/charters/M138-browser-explorer-probe.md
**Class:** methodology (discovery -- new routine probe)
**Value type:** discovery
**Deliverable:** no

## Done-when checklist

| # | Clause | Status |
|---|---|---|
| 1 | `plugin/probes/browser-explorer.md` exists with valid frontmatter and objective prompt | PASS |
| 2 | `.quay/config.yml` `loop.routines:` includes `browser-explorer` with `trigger: every(10)` | PASS |
| 3 | `routine-scheduler.ts` parses the new routine entry without error | PASS |
| 4 | FILE-ONLY invariant holds (no product/method code touched) | PASS |

## Implementation

### 1. `plugin/probes/browser-explorer.md` (new file)

Probe spec authored with:
- **Frontmatter:** `instrument: chrome-devtools`, `fallback: playwright`, `output_routing` with `defect: milestone-candidate` / `regression: milestone-candidate` / `default: milestone-candidate`
- **Objective prompt:** Fresh-context browser explorer that launches `quay serve`, exercises list/detail/filter/search/action flows at dual viewports (desktop 1280x800, mobile 375x812), takes screenshots, and files evidence-backed findings. Graceful fallback chain: chrome-devtools --> playwright --> skip with `filed: 0`.

### 2. `.quay/config.yml` routine entry

Added fourth routine entry under `loop.routines:`:
```yaml
    - name: browser-explorer
      trigger: every(10)
      probe: browser-explorer
```

### 3. Routine scheduler verification

- `parseTrigger("every(10)")` --> `{ kind: "every", n: 10 }`
- `isDue("every(10)", { iteration: 10 })` --> `true`
- `dueRoutines(routines, { iteration: 10 })` includes `browser-explorer`
- `resolveRoutineAction(browser-explorer, pluginRoot)` --> `{ kind: "probe", name: "browser-explorer" }`
- All 25 existing routine-scheduler + read-probe-spec tests pass

### 4. Manual dry-run

- Started `quay serve` on port 8888
- Navigated task list (412 tasks rendered), task detail (DIR-069 rendered with all sections), status filter (todo: 37 tasks), search
- Took screenshots at desktop (1280x800) and mobile (375x812) viewports
- Server stopped cleanly

## Files changed

- `plugin/probes/browser-explorer.md` -- new probe spec (~52 lines)
- `.quay/config.yml` -- added `browser-explorer` routine entry (4 lines)

## Test results

- `routine-scheduler.test.mjs`: 13/13 pass
- `read-probe-spec.test.mjs`: 12/12 pass

## FILE-ONLY invariant

Touches verified: only `plugin/probes/` + `.quay/config.yml`. No product code, methodology code, or driver files modified.
