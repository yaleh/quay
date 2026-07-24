---
id: exp5-DEFECT-DELIVERY-MANIFEST-INCOMPLETE-RELEASE
title: Tighten delivery-manifest-check to verify real release assets (not just
  release.yml build-step existence) — the manifest and release.yml ARE currently
  aligned (all 7 entries covered by 4 published assets via bundling), but the
  check is doc-vs-doc, not doc-vs-reality
status: todo
labels:
  - milestone-candidate
  - defect
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Investigation (2026-07-24, SELECT pass M135): the original claim that release.yml publishes 4/7
manifest entries is **overstated**. Live inspection reveals:
- release.yml DOES build quay-native SEA (`bash packages/quay-native/scripts/build-sea.sh` on
  the `sea-release` job — confirmed via `grep`)
- The manifest correctly documents bundling: quay-native SEA is assembled together with quay SEA
  in one archive per platform; the plugin is inside the npm-pack tarball
- 4 published assets cover all 7 entries via bundling; `delivery-manifest-check` PASSES because
  both manifest and release.yml ARE aligned

The REAL gap is narrower: `delivery-manifest-check.ts` validates doc-vs-doc (manifest ↔
release.yml build-step existence), not doc-vs-reality (manifest ↔ actual published GitHub Release
assets). The single-source guarantee M129 intended has no runtime verification leg.

## Plan

1. Add `--ci` mode to `delivery-manifest-check.ts`: when `GITHUB_TOKEN` is available (CI
   environment on a tagged release), fetch actual GitHub Release assets via REST API and verify
   every manifest entry has a corresponding published artifact (accounting for bundling:
   quay-native inside quay SEA archive, plugin inside npm tarball). Non-CI mode unchanged.
2. RED fixture: a deliberately missing entry in manifest → `--ci` mode exits non-zero (mocked
   API response). GREEN: on real release, `--ci` exits zero.
3. Extend sibling test (`delivery-manifest-check.test.ts`) with `--ci` mode test cases, ≥80%
   coverage.
4. Keep manifest structure and release.yml unchanged — they are already aligned.

## Acceptance Criteria
- [ ] `delivery-manifest-check.ts` `--ci` mode: when `GITHUB_TOKEN` is set on a tagged run,
      fetches actual GitHub Release assets and verifies manifest entries are covered by published
      assets (accounting for documented bundling). When `GITHUB_TOKEN` is unset, behavior
      unchanged (manifest ↔ release.yml).
- [ ] RED: with a manifest entry that has no matching published asset, `--ci` mode exits non-zero
      (mocked API response in test) — pasted.
- [ ] GREEN: on a real tagged release CI run, `--ci` mode exits zero — pasted from CI log, or
      cross-checked via `gh release view` on the most recent release.
- [ ] `delivery-manifest-check.test.ts` extended for `--ci` mode; ≥80% coverage;
      `loadbearing-test-gate.sh` PASS.
- [ ] `node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')`
      stays green.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [ ] All AC items above verified true with pasted evidence (not asserted).
- [ ] it0 DoD meta-enforcer passes all clauses at ABSORB.

## Not selected (M135 SELECT)

SELECT deliberation (2026-07-24, M134→M135 boundary):

**Candidate pool:** 8 milestone-candidates with status=todo. After filtering:
- 3 STALE (exp5-M-CLI-UX, exp5-M-DIRTASK, exp5-M-DOCS) — scope exhausted
- 2 human-steered (DIR-057, exp5-M-OUTERLOOP-ROUTINE-WIRING) — excluded
- 2 compound epics with all children done (exp5-M-CRYST, exp5-M-PRODUCTIZED-DELIVERY)
- 1 selectable: exp5-DEFECT-DELIVERY-MANIFEST-INCOMPLETE-RELEASE

**Explore/exploit cadence:** streak=2, threshold=4 — NOT due (exploit mode).

**Deliverable governor (DIR-066):** deliverable=yes (shipped CI check code, consumed by the
release pipeline). Streak=1 (M134=no, M133=exempt, M132=yes). Single-candidate shortlist.

**SPLIT-OR-COMMIT:** fully completable within one milestone (~200 lines of TypeScript +
test extension). No split needed.

**Value-typed ledger:** instrument-correction — tightens an existing check's honesty without
changing S2 cov (already 1.00). Δv̂=0. The check currently passes because manifest and
release.yml agree — but neither is verified against reality. This adds the reality leg.

**SELECTED** — sole autonomous candidate. Scope narrowed from the original defect's overstated
"missing artifacts" claim to the real gap: doc-vs-doc check needs a doc-vs-reality mode.
