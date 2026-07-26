# M147 iteration-0 Acceptance Audit -- DIR-095

**Audit session id:** ee05dd8f-1d70-4c6c-bd46-2fcb1299743e

**Date:** 2026-07-25
**Milestone:** M147
**Task:** DIR-095
**Charter:** experiments/quay-perpetual-stream/charters/M147-dir095-version-consistency.md
**Audit type:** adversarial acceptance audit (refute-first, fresh context)

## Verdict: NO REFUTATION FOUND

All AC items, DoD items, and mechanical gate checks independently confirmed. The prior REFUTED finding (2026-07-25 11:21 audit) was caused by a malformed absorb entry (`## Audit-independence check` section in prose format without structured `Artifact:`/`Orchestrator id:`/`Dispatch record:` fields). The absorb entry has since been corrected and the mechanical gate now exits 0 (all 12 clauses PASS). The prior deviation row at dashboard.md line 471 has been updated to `verified-eliminated`.

DIR-095's sole code change is a 1-line version bump in `plugin/.claude-plugin/plugin.json` (`0.4.0` -> `0.3.13`). The deliverable is mechanically verified and consistent.

## AC Satisfaction

### AC1: `node --test scripts/version-consistency-check.test.ts` exits 0

**VERDICT: CONFIRMED**

Independent evidence (fresh run, 2026-07-25):
- `node --experimental-strip-types --test scripts/version-consistency-check.test.ts` -> **tests 9, pass 9, fail 0, exit 0**
- All 9 test cases pass: readVersions returns 8 entries for the real tree; readVersions returns errors for missing files; check returns all-equal on the real tree post-unification (GREEN); check returns all-equal for a unified fixture (GREEN); check detects single-entry drift (RED after one drift); check handles marketplace.json with `{ plugins: [...] }` wrapper; CLI --json exits 0 with JSON output even on drift; CLI exits 0 on the real tree (post-unification GREEN); CLI exits 0 on a unified fixture

### AC2: Session-start healthcheck no longer warns about version inconsistency

**VERDICT: CONFIRMED**

Independent evidence (fresh run, 2026-07-25):
- `node --experimental-strip-types scripts/version-consistency-check.ts` exits **0**, stdout: `VERSION-CONSISTENCY: OK`
- All 8 files listed at version `0.3.13`
- `node --experimental-strip-types scripts/version-consistency-check.ts --json` outputs: `{"ok":true,"mode":"all-equal","uniqueVersions":["0.3.13"]}`
- The prior drift in `plugin/.claude-plugin/plugin.json` (`0.4.0` -> `0.3.13`) is resolved

## DoD Satisfaction

### DoD1: All 8 version-bearing files synced to consistent version

**VERDICT: CONFIRMED**

8/8 files confirmed at v0.3.13 by `scripts/version-consistency-check.ts --json` (mode: all-equal):

| # | Path | Version |
|---|---|---|
| 1 | packages/quay/package.json | 0.3.13 |
| 2 | packages/quay-native/package.json | 0.3.13 |
| 3 | packages/quay-github/package.json | 0.3.13 |
| 4 | packages/quay-backlog/package.json | 0.3.13 |
| 5 | plugin/.claude-plugin/plugin.json | 0.3.13 |
| 6 | plugin/.claude-plugin/marketplace.json (quay entry) | 0.3.13 |
| 7 | .claude-plugin/marketplace.json (quay entry) | 0.3.13 |
| 8 | plugin/vendor/quay/package.json | 0.3.13 |

### DoD2: Version consistency test passes

**VERDICT: CONFIRMED**

Same evidence as AC1: 9/9 tests pass, exit 0.

### DoD3: No regression in package tests

**VERDICT: CONFIRMED**

Independent evidence (fresh run, 2026-07-25):
- `node --test packages/quay/test/gate.test.mjs` + `lifecycle.test.mjs`: **52 pass, 0 fail** (25 gate + 27 lifecycle)
- All individual test assertions pass with no failures, cancellations, or skipped tests

## Mechanical Gate

**Command:** `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-095 experiments/quay-perpetual-stream/charters/M147-dir095-version-consistency.md /tmp/m147-absorb-entry.md`

**Result: EXIT 0 -- ALL 12 CLAUSES PASS**

```
PASS: clause0-ac-dod-present: task AC has 2 checkable clause(s); DoD references the standard
PASS: clause1-adversarial-audit: disposition statement present (documented no-op)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS -- scope within the small-milestone norm
PASS: clause4-impl-row: PASS -- DIR-095 is not design-only
PASS: clause5-no-self-exemption: no undeclared self-exemption language found
PASS: clause6-escrow-delta-v: N/A -- milestone is not design-only
PASS: clause7-test-floor: N/A -- surface label [packaging] is non-product-touching
PASS: clause8-task-canonical-lifecycle-record: task carries a real '## Proposal' (210 chars) and a well-formed '## Plan'
PASS: clause10-tree-hygiene: PASS -- clean
PASS: clause11-worktree-branch-hygiene: PASS -- clean
PASS: clause12-audit-independence: PASS -- audit session id distinct from orchestrator id
N/A: clause9-split-or-commit: no `needs-human` outcome declared

PASS: DoD check passed -- all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
```

This is a different outcome from the prior audit pass (2026-07-25 11:21), which reported exit 2 due to a malformed absorb entry. The absorb entry `/tmp/m147-absorb-entry.md` now includes structured `Artifact: milestones/M147/audits/iteration-0-acceptance-audit.md`, `Orchestrator id: build-executor-m147`, `Dispatch record: N/A` fields under `## Audit-independence check`, satisfying clause 12's structural requirements.

## Deviation log update

The prior deviation row at dashboard.md line 471 (level: REFUTED, caught-by: machine, M147, DIR-095) has been updated to `verified-eliminated`. The absorb-entry defect that caused the prior REFUTED finding (prose-only `## Audit-independence check` section) was corrected between audit passes. The current mechanical gate exits 0, confirming resolution.

No new deviation rows written — no REFUTATIONS or CONCERNS found in this fresh audit pass.

---

**Audit concluded at:** 2026-07-25
