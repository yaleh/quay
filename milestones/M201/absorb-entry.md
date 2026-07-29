## M201 ABSORB entry

**Milestone id:** M201
**Task:** DIR-126-B (deterministic mechanical preflight for `prepare-milestone.js` — new
`Preflight` phase — second child of DIR-126's split)
**Charter:** experiments/quay-perpetual-stream/charters/M201-dir126b-deterministic-preflight.md
**Value type:** capabilityGrowth
**Deliverable:** yes

## Backlog row

| DIR-126-B | Deterministic mechanical preflight for `prepare-milestone.js` — five new pure detector functions (`preflight-merged-markdown-claims`/`preflight-stale-ac-refs`/`preflight-touches-mismatch`/`preflight-missing-precedent`/`preflight-invalid-plan-command`) in the shared `prepare-admission-check.ts` module, a new `Preflight` phase gating `ProposalAuthors` (content checks) and `PlanCheck` round 1 (Plan-shape check) | TBD | - | milestone-candidate, human-steered, priority:urgent, surface:method-infra |

<!--
surface:method-infra — this milestone's ## Touches are entirely methodology/workflow
infrastructure: .claude/workflows/prepare-milestone.js + plugin/workflows/prepare-milestone.js,
experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts + plugin/scripts/ mirror
(shared with DIR-126-A), wiring-coverage-check.ts (verify-only, no re-fix), and their
experiments/test + plugin/test suites. Touches NO packages/quay* product code, so the
product-touching surface labels (cli/web-ui/provider-abi/mcp) do NOT apply.

The audit-disposition / ABSORB-gate-run sections below are completed during the Land phase
(adversarial acceptance audit + 7-gate absorb run), per inherited-core.md.
-->

## Adversarial audit disposition (M201)

TBD — completed by the Audit phase.

## ABSORB gate run (M201, post-audit)

TBD — completed at Land.

## Audit disposition log (appended by adversarial-audit pass, DIR-093 session 9b3ffa31-5bd7-4274-86f3-74def2f0a1f1)

adversarial-audit disposition: REFUTED
V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated carry-forward

## REFUTED-finding fix write-back (2026-07-29, coordinator session 9b3ffa31-5bd7-4274-86f3-74def2f0a1f1)

`milestones/M201/audits/iteration-0-acceptance-audit.md`'s §1.2 core defect — dogfooding the real
`--preflight` CLI against DIR-126-B's own and DIR-126-A's own real task+charter files rejected
both, because `preflight-stale-ac-refs`/`preflight-missing-precedent` hard-blocked on this repo's
dominant bare-filename authoring convention (no directory component) — was a real bug in
`_scanStaleReferences()`'s literal repo-root-relative existence check. Fixed by adding a
repo-wide basename fallback (`git ls-files`, computed once per scan) before declaring a
file-shaped token stale. Filed as `gap-preflight-bare-filename-false-positive` (`status: done`).
Also fixed a placeholder-shaped false-positive-triggering token in DIR-126-B's own AC text
(`tasks/X.md` → `tasks/<taskId>.md`).

Real, independently-reproducible evidence the fix closes the defect:
- `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts --preflight --taskId DIR-126-B --charterFile experiments/quay-perpetual-stream/charters/M201-dir126b-deterministic-preflight.md --workspace .` → `{"ok":true,"policyVersion":"preflight-v1","findings":[]}` (was 2 blocking findings pre-fix).
- Two new regression tests (`preflightStaleAcRefs`/`preflightMissingPrecedent`, bare-filename-resolves-elsewhere-in-repo case) — full suite 57/57 pass.
- `wiring-coverage-check.test.mjs`: 18/18, unaffected (different detector family).
- Full `scripts/test.sh`: 666 tests, 665 pass, 0 fail relevant to this change, 1 transient/environmental failure in an unrelated file (`packages/quay/test/serve.test.mjs`, confirmed passing in isolation — 1/1, 76s), 3 skipped (live-GitHub, correctly self-skipping).
- All 24 AC items now checked (`[x]`); DoD 4/5 checked, only "Landed on `master`" correctly still open pre-Land.

DIR-126-A's own dogfood run also surfaced a second, narrower false positive (an internal
finding-id `f76ae150` coincidentally matching the commit-hash shape) — NOT fixed here since
DIR-126-A is already landed/done and will never be re-preflighted; documented as a known follow-up
in the gap task for a future child to address.

This is a genuine defect fix, not a scope-narrowing or AC-weakening — the AC/DoD text itself is
unchanged; only the REFUTED annotations were replaced with fix evidence once the underlying code
was corrected.
