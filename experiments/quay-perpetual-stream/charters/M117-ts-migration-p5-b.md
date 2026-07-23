# Charter M117-ts-migration-p5-b — TS migration P5-B (quay-backlog provider, DIR-058)

**Milestone id:** M117
**Task:** `tasks/exp5-M-TS-MIGRATION-P5-B.md`
**Surface:** development-class / capability-growth (crystallization, JS-elimination observability)
**Charter authored:** 2026-07-23
**Base commit:** master HEAD at dispatch (`573abed`, M116's ABSORB commit)
**Inherited-core:** `experiments/quay-perpetual-stream/inherited-core.md`

## Context

Sibling completion of `exp5-M-TS-MIGRATION-P5` (DIR-058), whose other child (P5-A, the 4 CLI `bin/*.js`
entrypoints) closed at M116. This milestone covers `packages/quay-backlog/src/*.js` — the read-only
Backlog.md Provider's internal implementation, never in scope for ADR-012's original P0–P4 phases
(which only covered quay/quay-native/quay-github). Completing this closes DIR-058 in full (both
children done) and unblocks the post-migration archguard re-run DIR-058's AC7 requires.

## Scope

Migrate 3 files, behavior-preserving, under the same ADR-012 golden-diff discipline used by P1–P5-A
(Node native type-stripping, no build step, `tsc --noEmit` + full-suite-green before/after):

- `packages/quay-backlog/src/manifest.js` → `.ts`
- `packages/quay-backlog/src/backlog-client.js` → `.ts`
- `packages/quay-backlog/src/mcp-server.js` → `.ts`

(`packages/quay-backlog/bin/quay-backlog.js` was already migrated at P5-A/M116 — not this milestone's
scope.) These 3 files must typecheck against the Provider ABI (`packages/quay/src/abi.ts`) the same
way `quay-native`/`quay-github`'s own `src/mcp-server.ts` do.

**Out of scope:** the 2 permanently-exempted SEA shims (unaffected by this milestone; already
migrated/exempted work from P0–P5-A).

## Class routing

**Development-class** (mechanical per-file port, same established pattern as P1/P3-C/P5-A — a full
package's internal implementation, smaller surface: 3 files, one package). Per the P1/P3/P4/P5-A
precedent, no `quay-task-to-plan` pipeline required for this class of mechanical, behavior-preserving
port with an already-proven golden-diff pattern.

## Acceptance Criteria (from task)

- [ ] All 3 `src/*.js` files renamed/ported to `.ts`, typechecking against the Provider ABI (`packages/quay/src/abi.ts`) the same way quay-native/quay-github do.
- [ ] `npx tsc --noEmit` (per-package tsconfig, DIR-059) exits 0 or with only the pre-existing documented TS2589 errors (no NEW errors from these 3 files).
- [ ] `packages/quay-backlog`'s own test suite is green before/after (2 files exist: `backlog-client.test.mjs`, `mcp-server.test.mjs`).
- [ ] Full non-flaky `packages/quay` suite green before/after (golden-diff), since quay Core's MCP client talks to this provider.

## Definition of Done

- [ ] All 3 files are `.ts` on `master`, `git log --follow` shows the rename commit for each.
- [ ] `tsc --noEmit` + relevant suite(s) pasted as evidence in the Resolution.
- [ ] No behavior change (golden-diff: quay-backlog provider behaves identically before/after, pasted evidence).

## Additional Done-when (this milestone, since it completes DIR-058 in full)

- [ ] `find packages -path '*/node_modules/*' -prune -o -name '*.js' -print | grep -v '/test/'` returns
      ONLY the 2 named SEA shims (confirms full JS-elimination per DIR-058's own AC1/AC2).
- [ ] A post-migration archguard structural-analysis run records entity/relation counts covering all 4
      packages including `quay-backlog` and the 4 bin entrypoints, recorded on `dashboard.md` — the
      actual observability payoff DIR-058 exists to unlock (M113's baseline: entities=121,
      relations=156, excluding quay-backlog + bin/ entrypoints).
- [ ] DIR-058 dispositioned `applied` with this task's completion evidence cited in its own Resolution.

## GATE-HASH-REF

GATE-HASH-REF: 22c64fc383d6fc03ba375f8b9ce463abce3459d318c8787e33d8bcb321d876e1

(Note: `it0-gate-hash-check.sh --by-reference` will FAIL against this value — a pre-existing,
6-milestone-old instrument drift tracked as `exp5-DEFECT-GATE-HASH-CHECK-STALE-PINNED-SOURCE`, not
specific to this charter. Recorded as CONCERNS at ABSORB, not a HARD BLOCK, per M116's precedent.)
