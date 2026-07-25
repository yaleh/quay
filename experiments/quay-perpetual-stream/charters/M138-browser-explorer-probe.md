# M138 — Browser-explorer routine probe

**Task:** DIR-069
**Milestone counter:** 138
**Chart:** 2
**Class:** methodology (discovery — new routine probe)
**Value type:** discovery
**Cadence:** explore (mandatory — streak=4 since M133)
**Deliverable:** no (loop-internal probe)
**Charter tokens:** ~0.5 K
**type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis

Δv̂ = 0 (no chart-2 surface cell directly moves — this is a discovery probe).
Real value: standing browser-based Web UI exploration fills the ADR-010 gap.
The routine track currently has zero Web UI surface coverage; this probe exercises
`quay serve` with chrome-devtools/playwright at dual viewports.

## Scope

Per DIR-069 proposal:

1. Author `plugin/probes/browser-explorer.md` — probe spec (~50 lines) with
   `instrument: chrome-devtools`, `fallback: playwright`
2. Add `browser-explorer` routine entry to `.quay/config.yml` with `trigger: every(10)`
3. Verify `routine-scheduler.ts` parses the new entry

## Touches

- `plugin/probes/browser-explorer.md` (new file)
- `.quay/config.yml` (routine entry)

## Done-when (binary)

1. `plugin/probes/browser-explorer.md` exists with valid frontmatter and objective prompt.
2. `.quay/config.yml` `loop.routines:` includes `browser-explorer` with `trigger: every(10)`.
3. `routine-scheduler.ts` parses the new routine entry without error.
4. FILE-ONLY invariant holds (no product/method code touched).

## Inner termination

Done-when-complete (4 clauses) OR external HALT.

## it0 systematic-explore checks

See HARD GATES block by-reference (inherited-core.md).
