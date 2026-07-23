# Charter M120-node-floor-distribution-fix — Node-floor distribution regression fix (DIR-060, release-blocking)

**Milestone id:** M120
**Task:** `tasks/exp5-M-NODE-FLOOR-DISTRIBUTION-FIX.md`
**Surface:** development-class / capability-growth (release-blocking distribution fix)
**Charter authored:** 2026-07-23
**Base commit:** master HEAD at dispatch (`f969373`, DRAIN commit for DIR-060/061)
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

DIR-060 (a real human directive, 2026-07-23): the M116 `bin/*.js`→`bin/*.ts` migration broke
distribution — `.ts` shebang entrypoints require Node ≥23's native type-stripping, but this project
declares and CI/release pin a Node ≥20 floor. A real `v0.3.5` release attempt failed on exactly this.
Release-blocking, DIR-004-urgent.

## Class routing (DIR-014)

**Development-class with genuine design decisions** (bundle format, build invocation mechanism,
scope breadth) — NOT a mechanical port with an established repeated pattern like M116/M117's file
renames. Routed through the `quay-task-to-plan` pipeline per DIR-014's mandatory routing:
- **Proposal step:** 2 independent blind proposals (minimal-surface-area, pattern-consistency) →
  adjudication (DIVERGED on 3 axes: CJS-vs-ESM, ephemeral-hooks-vs-explicit-script, scope breadth) →
  written back to the task's `## Proposal`.
- **Architect-review (round 1):** REJECTED — found a confirmed, reproduced blocker (the adjudicated
  design's `exports` map change would break ~29 of 64 test files via `ERR_MODULE_NOT_FOUND`).
- **Proposal revised** to drop the `exports` change; `registry.ts`'s bundle-depth-dependent
  `REPO_ROOT` bug disclosed (not fixed, verified non-blocking).
- **Architect-review (round 2):** APPROVED — verified the revision fixes the blocker, no new issues.
- **Plan authored** (Stage 7.1a): 5 phases, ≈845 lines, empirically grounded (the plan-author
  actually built the esbuild bundle and found 2 more real bugs: a `yaml`-package dynamic-require
  crash needing an esbuild `banner`, and a `.gitignore` issue that would silently drop the plugin's
  vendored `dist/`).
- **Grounded convergent check:** 3 rounds (the cap), F_i = 4 → 1 → 0 (CONVERGED). Round 1 found 4
  real issues (a file-count error, a mischaracterized failure mode, a missed AC1-breaking stale
  reference, an inconsistent coverage-disclaimer). Round 2 found 1 more (round 1's own fix for the
  coverage-disclaimer conflicted with this skill's own TDD hard-gate classifier). Round 3: genuinely
  converged after real independent re-verification (rebuilt the bundle, re-derived path arithmetic,
  re-ran the AC1 grep).

Final plan record: `docs/plans/m120-node-floor-distribution-fix-plan.md` (kept out of the task tree
per the skill's own convention — process documentation, not quay child tasks).

## Scope (per the finalized, converged plan)

1. **Phase 1:** `scripts/build-dist.mjs`/`build-dist.sh` — ESM esbuild bundle of `bin/quay.ts` to
   `dist/quay.js`, with the load-bearing `createRequire` banner fix.
2. **Phase 2:** Wire `packages/quay/package.json`'s `bin` field (NOT `exports`) + `package.sh`,
   golden-diff verify `npm pack`→install→run + full existing suite green.
3. **Phase 3:** Plugin vendor sync (`sync-vendor.sh`, `.mcp.json`, `.gitignore` fix), standalone
   zero-`node_modules` verification.
4. **Phase 4:** CI/release Node-version bump (test step only, to `'24'`; `engines` stays `>=20.0.0`)
   + a new floor-verification job mirroring `sea-verify-node-free`.
5. **Phase 5:** Local full-suite verification, then a REAL release-workflow trigger — **Stage 5.2 is
   explicitly reserved for the orchestrator to execute directly** (pushing to `origin` + triggering
   the workflow), per prior explicit human confirmation in this session — not automated by any
   implementation agent.

**Explicitly out of scope:** `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH` (separate SEA crash); DIR-061's
full productized-delivery scope (depends on this landing first); extending the new build to
quay-native/quay-github/quay-backlog (none has an exercised distribution path today).

## Acceptance Criteria (from task)

- [ ] `grep -rIl 'bin/quay\(-native\|-github\|-backlog\)\?\.ts' .github/workflows/ plugin/.mcp.json` returns no MATCH.
- [ ] A CI job builds the npm-pack tarball and runs `quay --help` under Node 20, exiting 0 — pasted job log.
- [ ] The Release workflow (or a `workflow_dispatch` dry-run) completes with the `release` job GREEN — pasted run URL/status.
- [ ] Full non-flaky suite stays green before/after, including `packages/quay-native/test/*.test.mjs`.

## Definition of Done

Per DIR-026 Reading A: NOT done when the workflow YAML merely references `.js` — done ONLY when a
REAL release-workflow run has executed the new floor-check and the `release` job's npm-pack path
GREEN, run URL + job log pasted into the Resolution.

## GATE-HASH-REF

GATE-HASH-REF: 22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1

(Same pre-existing, tracked-not-blocking drift as M116-M119 — `exp5-DEFECT-GATE-HASH-CHECK-STALE-PINNED-SOURCE`.)
