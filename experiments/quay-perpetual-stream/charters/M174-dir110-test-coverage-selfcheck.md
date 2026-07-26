# M174 — Mechanical taxonomy self-check gate (no test file invisible to the canonical runner)

**Task:** DIR-110 · **Counter:** 174 · **Chart:** 2
**Class:** development · **Value type:** governanceIntegrity
**Deliverable:** no · **Charter tokens:** ~0.8 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (governance-integrity — ensures the test-discovery control mechanism itself works). The
DIR-108 wiring audit (M172) found `plugin/test/plugin-packaging.test.mjs` sitting on `master` with
2 failing tests, invisible to CI because its glob never matched `plugin/test/`. Nothing mechanical
caught this — only a human remembering to keep the CI glob current. This closes that failure class
generally.

## Scope
Depends on DIR-109 (`scripts/test.sh` must exist as the canonical runner this check compares
against) — this milestone assumes M173 has landed on master first (touches-shared-state on
`.github/workflows/ci.yml` already forces serialization; do not dispatch concurrently with M173).

1. Write `scripts/test-coverage-check.ts`: globs every `**/test/*.test.mjs` file repo-wide, compares
   against exactly what `scripts/test.sh` invokes, exits non-zero naming any orphaned file(s).
2. Ship a selfcheck fixture (ADR-018 pattern) proving both RED (planted orphan → fail, path named)
   and GREEN (removed → pass) states.
3. Wire as an early, cheap step in `.github/workflows/ci.yml`, before the full test job.

## Touches
- scripts/test-coverage-check.ts (new)
- scripts/test-coverage-check-selfcheck.sh (new, or equivalent fixture script)
- .github/workflows/ci.yml
- adr/ADR-019-test-taxonomy-is-structural-in-file-skip-one-canonical-runne.md

## Done-when
1. `node --experimental-strip-types scripts/test-coverage-check.ts` runs standalone
2. Selfcheck fixture demonstrates BOTH states: planted orphan → fail with path named; removed → pass
3. `.github/workflows/ci.yml` runs this check as an early step before the full test job
4. Right now, with zero known orphans, the check passes cleanly against the real repo tree
5. A real CI run shows the step executing and passing
6. `adr/ADR-019-...md`'s `enforcement` field updated to include this script's invocation

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
