# M146 (DIR-087) -- Adversarial Acceptance Audit (iteration-0)

**Audit date:** 2026-07-25
**Task:** DIR-087 -- Extract gate factory config (fanOut 29 to <=24)
**Commit:** 13bc477
**Verdict:** REFUTED

## Audit method

Independent, FRESH-CONTEXT adversarial audit per `inherited-core.md`. The charge is
refute-first: attempt to falsify each AC criterion with concrete evidence, NOT re-verify
sympathetically.

## AC Satisfaction

### AC #1: `archguard_get_package_metrics` for factories shows fanOut reduced by >=5 (from 29 to <=24)

**REFUTED.** Independent `archguard_get_package_metrics` (fresh `archguard_analyze` with
`noCache: true`, then `get_package_metrics` for `packages/quay/src/gate/factories`) returns:

```
fanIn: 3, fanOut: 29, cycleCount: 0
```

fanOut is **29** -- identical to the claimed baseline. It has NOT been reduced to <=24.

Additionally, `archguard_get_package_stats` (depth=2) does not list
`packages/quay/src/gate/config` as a separate package -- so the claimed "config fanOut: 8,
fanIn: 2" from the commit message (13bc477) cannot be independently confirmed via the
specified tool. There is no `packages/quay/src/gate/config` entity in `find_entity` nor does
it appear in the `get_package_stats` package listing (which includes 15 packages from
`packages/quay/src/gate/factories` to `plugin/gate-scripts` but not `gate/config`).

The commit message asserts "factories fanOut: 29 -> 19 (reduction of 10, exceeding >=5 target)"
but this reduction is NOT observable via the verification tool specified in the AC. The
archguard analysis run with the same settings as the AC specifies shows fanOut: 29 unchanged.

Possible explanations (neither rescues the AC):
1. The implementer ran archguard with a different depth/scope that counted dependencies
   differently and produced 19, but the AC's own verification command
   (`archguard_get_package_metrics for factories`) returns 29 when run independently.
2. The extraction was purely cosmetic (types/functions moved to a sibling directory with
   thin re-export stubs left behind) -- the fanOut from the factories/ package perspective
   is unchanged because re-export files still import the same external modules, just
   transitively through config/ instead of directly.

Evidence artifacts:
- `packages/quay/src/gate/factories/utils.ts` -- thin re-export: `export type { GateConfig, RunnerOptions } from "../config/types.ts"` + `export { shQuote, resolveRunnerOptions } from "../config/utils.ts"`
- `packages/quay/src/gate/factories/loader.ts` -- thin re-export: `export type { It0Entry, ... } from "../config/types.ts"` + `export { discoverWorkspaceRoot, readGatesConfig, loadWorkspaceGates } from "../config/loader.ts"`
- `archguard_get_package_metrics` (packageName: "packages/quay/src/gate/factories", noCache: true): `fanOut: 29`

### AC #2: All existing tests in `packages/quay/test/gate.test.mjs` pass unchanged

**CONFIRMED.** Independent run `node --test packages/quay/test/gate.test.mjs`:
- 25/25 tests pass
- 0 failures, 0 skipped
- Duration: 8558ms

### AC #3: `quay gate <task-id>` CLI produces identical output before/after

**CONFIRMED.** `node --experimental-strip-types packages/quay/bin/quay.ts gate DIR-087`
produces `PASS`. The extraction is a pure internal refactoring with thin re-export stubs
-- CLI behavior is identical. Confirmed by all 25 gate tests passing unchanged.

### AC #4: No new cycles introduced (`archguard_detect_cycles` remains empty)

**CONFIRMED.** `archguard_detect_cycles` (scope: global, outputScope: package) returns `[]`
(empty array). No cycles present.

## DoD Satisfaction

| DoD item | Verdict | Evidence |
|---|---|---|
| Gate factory config extracted to `packages/quay/src/gate/config/` | CONFIRMED | Directory exists with 4 files: `types.ts` (69 lines), `loader.ts` (163 lines), `index.ts` (24 lines), `utils.ts` (38 lines) |
| Imports updated in all consumers | CONFIRMED | `factories/utils.ts` re-exports from config; `factories/loader.ts` re-exports from config; `registry.ts` imports from `./config/index.ts` (commit 13bc477) |
| All existing tests pass | CONFIRMED | 25/25 gate tests pass |
| fanOut reduced as verified by archguard | **REFUTED** | fanOut remains 29 per independent archguard analysis |

## Mechanical Gate

`it0-dod-check.sh DIR-087 charter M146-dir087-extract-gate-config.md /tmp/m146-absorb-entry.md`

**EXIT CODE: 0 (PASS)** -- all 12 clauses satisfied or N/A.

## Absorb entry disclosures (human-caught)

The absorb entry (`/tmp/m146-absorb-entry.md`) pre-discloses:
- "adversarial-audit: N/A -- instrument-correction internal refactoring; no product-surface change" 
- "test-floor: N/A -- surface:method-infra"

Neither disclosure anticipates the AC #1 fanOut refutation. The adversarial audit
was stated as N/A but actually found a verifiable AC violation.

## Deviation

One finding qualifies for the dashboard deviation table:
- **Level:** REFUTED
- **Caught-by:** machine (this independent audit -- the absorb entry "adversarial-audit: N/A" disclosed no concerns about AC #1)
- **Caught-at:** M146
- **Description:** DIR-087 AC #1 (fanOut reduced by >=5): archguard_get_package_metrics for packages/quay/src/gate/factories shows fanOut: 29 (unchanged from baseline), not <=24. The implementer's commit message claims "29 -> 19" but independent archguard analysis does not confirm the reduction. The extract was cosmetic -- thin re-export stubs in factories/ preserve the same dependency profile as the original inlined types/functions. Additionally, packages/quay/src/gate/config does not appear as a separate package in archguard's package listing. AC #2, #3, #4 all confirmed; DoD 1-3 confirmed; mechanical gate exit 0.
- **Status:** open
- **Age:** 0

## Summary

| Criterion | Verdict |
|---|---|
| AC #1 (fanOut <=24) | **REFUTED** |
| AC #2 (tests pass) | CONFIRMED |
| AC #3 (CLI identical) | CONFIRMED |
| AC #4 (no cycles) | CONFIRMED |
| DoD 1 (config/ extracted) | CONFIRMED |
| DoD 2 (imports updated) | CONFIRMED |
| DoD 3 (tests pass) | CONFIRMED |
| DoD 4 (fanOut reduced) | **REFUTED** |
| Mechanical gate | PASS (exit 0) |

**Overall verdict: REFUTED** -- AC #1 and DoD #4 both fail independent verification.
The extraction code is clean and functionally correct (tests pass, CLI works, no cycles),
but the core value claim (fanOut reduction) is not corroborated by the specified
verification tool.
