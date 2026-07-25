# M139 iteration-0 — DIR-070-C: Tier B gates parameterization

**Date:** 2026-07-25
**Task:** DIR-070-C
**Charter:** experiments/quay-perpetual-stream/charters/M139-dir070c-tierb-gates.md
**Iteration:** 0
**Class:** methodology (capability-growth)
**Verdict:** PASS — all Done-when clauses satisfied

## Summary

Parameterized 5 Tier B gate scripts with CLI flags for experiment-specific defaults,
copied all 5 gates + `.sh` wrappers to `plugin/scripts/`, updated `.quay/config.yml`
gate paths, and updated `plugin-packaging.test.mjs`. All 29 plugin-packaging tests
pass, including 5 new DIR-070-C tests.

## Done-when clauses

### 1. All 5 gates accept parameterized CLI flags with defaults maintaining backward compat.

| Gate | Flag added | Default |
|---|---|---|
| audit-independence-check.ts | `--orchestrator-env <name>` | `QUAY_ORCHESTRATOR_SESSION_ID` |
| vmeta-lag-check.ts | `--threshold <K>` | 2 |
| it0-split-or-commit-check.ts | `--tasks-dir <dir>` | `tasks/` |
| it0-enforcement-with-design-check.ts | `--root <dir>`, `--inherited-core <path>`, `--dod-check <path>` | positional arg + experiment defaults |
| it0-impl-row-check.sh | `--backlog <file>` | `backlog.md` |

All experiment-copy scripts maintain backward-compatible defaults (existing experiment
CLI invocations continue to work unchanged). Verified via selftests and usage messages.

### 2. All 5 gates + `.sh` wrappers exist in `plugin/scripts/`.

9 files total:
- `audit-independence-check.ts` + `.sh`
- `vmeta-lag-check.ts` + `.sh`
- `it0-split-or-commit-check.ts` + `.sh`
- `it0-enforcement-with-design-check.ts` + `.sh`
- `it0-impl-row-check.sh`

All `.sh` wrappers are executable and exit 2 on missing args.

### 3. `.quay/config.yml` gate paths updated to `plugin/scripts/`.

Updated paths for:
- `gates.it0`: `impl-row`, `vmeta-lag`, `audit-independence`
- `gates.testPass`: `split-or-commit`, `enforcement-with-design`

Non-Tier-B gates (`line-budget`, `dogfood-evidence`) left pointing to experiment scripts.

### 4. `plugin-packaging.test.mjs` passes with no experiment leakage.

All 29 tests pass. Plugin copies sanitized to remove `experiments/quay-perpetual-stream`
and `exp5` references. Functional code identical to experiment source modulo:
- Attribution labels stripped from header comments
- Default paths in `it0-enforcement-with-design-check.ts` generalized

### 5. External workspace smoke.

Plugin copies accept the parameterized flags — external workspaces can run each gate
by pointing at `plugin/scripts/<script>` with custom paths (e.g. `--tasks-dir ./my-tasks`,
`--backlog ./my-backlog.md`).

## Files changed

- `experiments/quay-perpetual-stream/scripts/audit-independence-check.ts` — `--orchestrator-env` flag
- `experiments/quay-perpetual-stream/scripts/audit-independence-check.sh` — usage updated
- `experiments/quay-perpetual-stream/scripts/vmeta-lag-check.ts` — `--threshold` flag
- `experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh` — usage updated
- `experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts` — `--tasks-dir` flag
- `experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.sh` — NEW wrapper
- `experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.ts` — `--root`, `--inherited-core`, `--dod-check` flags
- `experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.sh` — NEW wrapper
- `experiments/quay-perpetual-stream/scripts/it0-impl-row-check.sh` — `--backlog` named flag
- `plugin/scripts/` — 9 new files (5 gates + 4 wrappers)
- `.quay/config.yml` — gate paths updated
- `plugin/test/plugin-packaging.test.mjs` — 5 new DIR-070-C tests + shippedFiles updated

## Test results

- Plugin packaging: **29/29 pass**
- audit-independence-check: **39/39 pass**
- vmeta-lag-check: **37/37 pass**
- it0-split-or-commit-check: **32/32 pass**
- it0-enforcement-with-design-check: **19/20 pass** (1 pre-existing failure: D1 real-object test, caused by inherited-core.md heading rename from `## Definition of Done` to `## Definition of DoD :: DoD` — not introduced by this milestone)

## Notes

- The `it0-enforcement-with-design-check.test.mjs` D1 real-object test failure is pre-existing (confirmed via `git stash` before/after diff). The `inherited-core.md` section heading was renamed from `## Definition of Done` to `## Definition of DoD :: DoD` in a prior milestone. This is out of scope for M139.
- Plugin copies of `it0-enforcement-with-design-check.ts` use generic default paths (`inherited-core.md`, `scripts/it0-dod-check.ts`) instead of experiment paths.
