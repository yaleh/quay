---
id: exp5-M-TS-MIGRATION-P5
title: "TS migration P5 (bin entrypoints + quay-backlog provider, DIR-058): full
  JS-elimination scope extension to ADR-012, 2 SEA shims exempted"
status: done
labels:
  - milestone-candidate
  - crystallization
parent: null
children:
  - exp5-M-TS-MIGRATION-P5-A
  - exp5-M-TS-MIGRATION-P5-B
extra:
  schema: v1
  role: compound
---
## Proposal

Follow-on to the ADR-012 TS migration program (`exp5-M-TS-MIGRATION`, closed at M114): DIR-058 found
7 remaining non-test product `.js` files under `packages/**` that were never in scope for P0–P4 (the
4 CLI `bin/*.js` entrypoints across all 4 packages, and the entire `packages/quay-backlog/` provider's
3 `src/*.js` files) plus 2 permanently-exempted SEA build shims (`manifest.sea-shim.js`,
`version-sea-shim.js` — esbuild-alias-only, must never join the normal ESM/TS module graph). This
program (P5) extends the same behavior-preserving + golden-diff discipline P0–P4 used to these
remaining files, split per DIR-026 into two independently-completable children:

- **P5-A**: the 4 CLI `bin/*.js` entrypoints → `.ts`.
- **P5-B**: `packages/quay-backlog/src/*.js` (3 files) → `.ts` (its `bin/quay-backlog.js` is covered
  by P5-A).

Payoff: closes the archguard `L_G/L_D` observability gap for the entrypoints + 4th provider — M113's
post-full-TS audit (entities=121, relations=156) excluded these files entirely; a post-P5 archguard
re-run should show the full picture across all 4 packages.

Not re-parented under the now-`done` `exp5-M-TS-MIGRATION` task (would reopen a closed parent-done-iff-
children invariant for no benefit) — this is its own standalone program, referencing ADR-012/M114 as
prior art rather than nesting under it.

## Plan
N/A — split-or-commit at SELECT (DIR-026) into P5-A/P5-B; no staged design doc, direct extension of
the P1–P4 charter pattern (golden-diff, `tsc --noEmit`, full-suite-green before/after).

## Acceptance Criteria
- [x] Both children (P5-A, P5-B) are `done` (or a properly-escaped `needs-human` per DIR-026 Reading A — external-factor only).
- [x] `find packages -path '*/node_modules/*' -prune -o -name '*.js' -print | grep -v '/test/' | grep -vE 'manifest\.sea-shim\.js|version-sea-shim\.js'` returns EMPTY.
- [x] Post-migration archguard structural-analysis run records entity/relation counts covering all 4 packages including `quay-backlog` and the 4 bin entrypoints, recorded on `experiments/quay-perpetual-stream/dashboard.md`.
- [x] DIR-058 is dispositioned `applied` with this task's completion evidence cited in DIR-058's own `## Resolution`.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts (DIR-026 Reading A):
- [x] All 7 named `.js` files are actually renamed/ported to `.ts` on `master` (verifiable via `git log --follow`), not merely a fixture/draft.
- [x] Full non-flaky suite green before/after (golden-diff), modulo the pre-existing `exp5-DEFECT-M114-TESTSUITE-DRIFT` items.
- [x] The archguard L_G/L_D reading is recorded on the dashboard, keyed to the closing milestone.
- [x] The 2 SEA shims are explicitly recorded as permanently out of scope in both children's charters.

## Resolution

Parent-done-iff-children closure (DIR-026), both children now independently `done` with their own
audited evidence: `exp5-M-TS-MIGRATION-P5-A` (M116, `tsc --noEmit`/354-354 suite/golden-diff for 4
bin entrypoints) and `exp5-M-TS-MIGRATION-P5-B` (M117, `tsc --noEmit`/12-12+354-354 suites/golden-diff
for the 3 quay-backlog src files, independently re-derived by that milestone's own adversarial audit).
Full JS-elimination confirmed live at M117's ABSORB (only the 2 permanently-exempted SEA shims
remain). Post-migration archguard reading (entities=144/relations=201 vs M113's 121/156 baseline,
scope=packages) recorded on `dashboard.md` at M117's ABSORB. DIR-058 dispositioned `applied` citing
this task's completion, same ABSORB. No new work performed by this task itself — its closure is the
mechanical parent-done-iff-children consequence of both children's real, independently-audited
completions.

- resolved_by: M116 (P5-A) + M117 (P5-B)
- outcome: done (parent-done-iff-children, both children independently audited)
