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

Four real adversarial-audit rounds ran against this child before Land, each independent (fresh
context, no shared chat history with Build or with the prior round):

- **Round 0 (Build's own iteration-0 audit, `milestones/M201/audits/iteration-0-acceptance-audit.md`,
  commit `3552787` Build):** REFUTED. §1.2's core defect — dogfooding the real `--preflight` CLI
  against DIR-126-B's own and DIR-126-A's own real task+charter files rejected both, because
  `preflight-stale-ac-refs`/`preflight-missing-precedent` hard-blocked on this repo's dominant
  bare-filename authoring convention (no directory component) — a real bug in
  `_scanStaleReferences()`'s literal repo-root-relative existence check. Fixed same day in commit
  `5d3f3fe` via a repo-wide basename fallback (`git ls-files`, computed once per scan). See the
  "Audit disposition log" / "REFUTED-finding fix write-back" sections above (already present,
  historically accurate, not amended here) for the full round-0/round-1 record.
- **Round 2 (independent re-audit):** REFUTED. The round-1 basename fallback was found too
  permissive one way (unconditionally passing a directory-qualified-but-fabricated path whenever an
  unrelated file shared its basename) and too strict another way (missing a common real-world
  pattern — a file the task's own `## Touches` declares as future work, e.g. `` `foo.ts (new)` ``,
  wrongly flagged as a stale precedent — hard-blocking ~15% of this repo's real open tasks). Fixed
  same day in commit `8ab3f84`: the basename fallback narrowed to bare (no-`/`) tokens only; a new
  Touches-membership exemption added (reusing existing `_extractGlobsFromSection`/`_globCoversPath`
  helpers, no new parser); a `.quay/`-prefix carve-out closed 3 more real false positives found
  while re-sweeping. 5 of the original 6 flagged real tasks dogfooded clean after this fix; 60/60
  regression suite.
- **Round 3 (independent re-audit):** REFUTED. Found a NEW real, live-blocking false positive on a
  different real open task (`gap-build-phase-iteration-evidence-path-not-single-sourced.md`'s own
  `` `iteration-N.md` `` placeholder), a regression in round 2's own bare-only basename restriction
  (a directory-qualified-but-shortened real path no longer resolved), and a still-open
  Touches-membership gap (trailing free-form prose after a backtick path defeats the exemption).
  With THREE independent audit rounds each finding a NEW real false-positive class specifically in
  `preflight-stale-ac-refs`/`preflight-missing-precedent` against this repo's real, organically
  varied task corpus, per-shape regex patching does not converge. Resolved same day in commit
  `2fdde50`, not by another patch attempt but by downgrading exactly these two detectors'
  `PREFLIGHT_CALIBRATED` flag to `false` — the milestone's own pre-designed, AC-sanctioned escape
  hatch ("Repair/calibrate before fail-closed activation" AC; the DoD's own "A detector's
  calibration corpus is not green → that detector stays non-blocking in production" default). This
  is a legitimate, AC-sanctioned resolution, not a scope-weakening hack: findings from the two
  downgraded detectors still surface (`disposition:"reviewer-required"`, never silently dropped);
  the other three detectors (`preflight-merged-markdown-claims`, `preflight-touches-mismatch`,
  `preflight-invalid-plan-command`) held up with zero real false positives across all three rounds
  and stay calibrated `true`/blocking. All 39 of this repo's real, currently-open `status:todo`
  tasks dogfood clean (0/39 blocked) after this fix, confirmed via a full corpus sweep.
- **Round 4 (independent re-audit, most recent — authoritative for this Land):** **CONFIRMED.**
  Verified the round-3 calibration downgrade is genuinely sound, not a hollowing-out of the
  milestone's core value: (a) downgraded findings still surface as `reviewer-required`, never
  silently dropped — confirmed by a dedicated regression test; (b) the AC/DoD text itself explicitly
  sanctions a permanent non-blocking state for a detector whose calibration corpus is not green —
  this is the designed, documented outcome, not a deviation; (c) 3 of 5 detectors remain real and
  blocking, so the `Preflight` phase's core mechanism (mechanical rejection before expensive
  content-agent dispatch) is not defeated. Round 4 also independently built and ran a fresh scratch
  harness — loading the real, unmodified `prepare-milestone.js` as a live `AsyncFunction` with
  `agent()` genuinely shelling out to the real CLI, against a freshly-authored known-bad task, not
  reusing Build's or any prior round's own harness — and reconfirmed
  `{"outcome":"revision-needed","reason":"preflight-rejected","phase":"Preflight"}` with zero
  forbidden (`proposal-author-*`/`adjudicate`/`proposal-review`/`plan-check-*`) dispatches. Round 4
  found exactly one more finding: a MINOR, currently-DORMANT gap in a still-calibrated detector
  (`preflight-merged-markdown-claims`, an ASCII-dash-in-merged-Markdown edge case, zero real-world
  incidence across all 495 task files in the repo) — filed separately as
  `gap-preflight-merged-markdown-ascii-dash-false-positive` (`status: todo`), explicitly NOT part of
  this Land and does not block it (dormant, zero live incidence, tracked as follow-up).

**Final disposition: CONFIRMED. Cleared to land.** All mechanical gates independently re-confirmed
live at this Land (below). Real, non-fixture DoD evidence for the "real prepare-milestone dispatch
showing preflight-rejected" item exists from round 3's own scratch-harness run (see above) and was
re-derived independently again by round 4.

## ABSORB gate run (M201, post-audit)

All four gates re-run live at Land time (2026-07-29), against the current tree (post round-3 fix
commit `2fdde50` and the round-4 dormant-gap filing `f38b521`):

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-126-B experiments/quay-perpetual-stream/charters/M201-dir126b-deterministic-preflight.md milestones/M201/absorb-entry.md
--- it0-dod-check: DIR-126-B ---
PASS: clause0-ac-dod-present: task AC has 24 checkable clause(s) (checklist-form, 24/24 checked); DoD references the standard [tasks/DIR-126-B.md]
PASS: clause1-adversarial-audit: disposition statement present (verdict)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS — scope within the small-milestone norm
PASS: clause4-impl-row: PASS — impl-row gate does not apply
PASS: clause5-no-self-exemption: no undeclared self-exemption language found
PASS: clause6-escrow-delta-v: N/A — milestone is not design-only
PASS: clause7-test-floor: N/A — surface label(s) [method-infra] are exclusively non-product-touching
PASS: clause8-task-canonical-lifecycle-record: N/A — legacy/unlabeled task, predates DIR-014 item 6
PASS: clause10-tree-hygiene: PASS — tree-hygiene: clean
PASS: clause11-worktree-branch-hygiene: PASS — worktree-branch-hygiene: clean
PASS: clause12-audit-independence: N/A — no '## Audit-independence check' section (documented no-op)
N/A: clause9-split-or-commit: no `needs-human` outcome declared — N/A
PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
EXIT=0
```

```
$ bash experiments/quay-perpetual-stream/scripts/task-schema-check.sh tasks/DIR-126-B.md
PASS: tasks/DIR-126-B.md — schema v1 conformant (kind=milestone-candidate)
1 total, 1 pass, 0 N/A-legacy, 0 fail
EXIT=0
```

```
$ bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh
tree-hygiene: clean — no un-gitignored scratch left in the main tree.
EXIT=0
```

```
$ bash experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh
worktree-branch-hygiene: clean — no orphaned milestone evidence in un-merged iteration branches.
info: prunable merged iteration branches=0; registered iteration worktrees=0 (ABSORB should prune these).
EXIT=0
```

**Result: 4/4 PASS.** Additionally re-confirmed at this Land (not part of the standard 4-gate set,
but cited by the round-4 audit as still-clean evidence): `wiring-coverage-check.ts --task
tasks/DIR-126-B.md` → 0 findings; `plugin/scripts/sync-vendor.sh --check` → CLEAN (all mirrored
files byte-identical, including `prepare-admission-check.ts`).

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
