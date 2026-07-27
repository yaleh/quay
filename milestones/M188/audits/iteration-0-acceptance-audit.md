# M188 — Adversarial Acceptance Audit (DIR-119-A), re-audit after iteration-1 follow-up build

**Audit session id:** 13efe277-45ff-4563-bcfe-fd2c3db3e2a5

Fresh-context, refute-first adversarial acceptance audit of DIR-119-A ("Make SELECT synthesize and
choose singleton/composite MilestoneCandidates from a task coupling graph"), M188, re-run against
`HEAD=6b5c238` (M188/DIR-119-A iteration 1) after an iteration-1 follow-up build pass closed the
gap this SAME audit file's prior version (commit `da46f9a`, session id also
`13efe277-45ff-4563-bcfe-fd2c3db3e2a5`) REFUTED on. This pass re-derived every claim independently
from live git/test/CLI evidence, never trusting `iteration-0.md`/`iteration-1.md`'s self-reports.

## 0. What changed since the prior REFUTED verdict

Prior audit (this file's previous version, commit `da46f9a`) found 11/12 AC bullets confirmed but
REFUTED AC bullet 5 ("Portfolio choice ... respects dependency, cadence, resource, and
milestone-concurrency constraints") because `cadence` appeared nowhere in
`candidate-contracts.ts`/`candidate-synthesis.ts`/`portfolio-choice.ts` or their tests (zero grep
hits), and `dependency` was also never implemented as a portfolio constraint. Commit `6b5c238`
("M188/DIR-119-A iteration 1") added `isExploreTask` (`candidate-contracts.ts`),
`CadenceConstraint`/`DependencyConstraint`/`findUnmetDependency` (`portfolio-choice.ts`), and wired
the live `CadenceResult` + full task list into `synthesizeCandidatePortfolio`
(`select-preflight.ts`), with 14 new tests and 2 new selftest blocks. This audit independently
re-verifies that fix rather than trusting `iteration-1.md`'s own report of it.

## 1. AC satisfaction (refute-first)

Task file: `tasks/DIR-119-A.md`. Build commits: `3185f51` (iteration 0) → `6b5c238` (iteration 1,
current `HEAD`, on `master`).

| # | AC bullet (abridged) | Verdict | Evidence |
|---|---|---|---|
| 1 | Versioned `TaskCandidate`/coupling-edge/`MilestoneCandidate`/`MilestonePortfolio` contracts; singleton = one-task candidate | CONFIRMED | Unchanged since iteration 0. `candidate-contracts.ts`: `CONTRACT_VERSION=1`, the 4 interfaces, `makeSingletonCandidate`. Fresh `node --test` re-run PASS (part of the 98/98 below). |
| 2 | SELECT synthesizes composites before final portfolio selection; selected+rejected shapes recorded with reasons | CONFIRMED | Live re-run: `node --experimental-strip-types select-preflight.ts --json --workspace-root . --milestone-counter 188` against the REAL task store → `portfolio.version=1`, `selected.length=7`, `rejected.length=19`, `cadence.verdict="OK"` — independently re-run by THIS audit pass, identical to iteration 0's numbers (proves the iteration-1 constraints are correctly no-ops against today's real data, not that they were skipped — see AC5 below for the isolated proof they fire when triggered). |
| 3 | `candidate_horizon` independent of `.quay/loop.yml` concurrency; strong-coupling neighbors outside seed rank can join | CONFIRMED | `grep -rn "loop.yml"` across all 6 pipeline scripts — zero file-read call sites, only comments. Unchanged since iteration 0. Fresh test re-run PASS. |
| 4 | Bounded seed/beam expansion, retains singletons, no max-task-count check | CONFIRMED | `expandFromSeed`/`DEFAULT_CANDIDATE_HORIZON=3` unchanged. Fresh re-run of "no power-set enumeration" / "no taskIds.length cap" tests PASS. |
| 5 | Portfolio choice prevents duplicate task membership and respects dependency, cadence, resource, and milestone-concurrency constraints | **CONFIRMED (was REFUTED; fixed for real)** | `grep -rn cadence` over `candidate-contracts.ts`/`candidate-synthesis.ts`/`portfolio-choice.ts` now returns 32 hits (was 0). Read the full `portfolio-choice.ts` source directly (not the implementer's summary): `CadenceConstraint`'s forced pass tries explore-carrying shapes score-first, force-selects the first that fits budget, falls back to a smaller shape if the top one doesn't fit, and is a genuine no-op on verdict `OK` or when nothing carries the slot. `DependencyConstraint`/`findUnmetDependency` demotes a selected candidate to rejected via a bounded fixed-point sweep when an external `dependsOn` target is open and not selected this round, fails open on data outside the known fact set. Independently re-ran `node --experimental-strip-types portfolio-choice.ts --selftest` (24 checks incl. 6 new cadence + 6 new dependency cases, all PASS) and `candidate-contracts.ts --selftest` (15 checks incl. 4 new `isExploreTask` cases, all PASS) myself, plus the file-level `node --test portfolio-choice.test.mjs`/`candidate-contracts.test.mjs` (19 and 9 tests respectively, part of the 98/98 below) — read the actual new test bodies (not just their names): they assert real interaction effects (a low-scoring explore candidate genuinely displaces a higher-scoring non-explore one under a tight `maxSelected=1` budget; a dependency-blocked candidate is genuinely demoted even though it would otherwise fit cleanly), not tautologies. Duplicate-membership (`assertPortfolioDisjoint`), resource (`maxTotalResourceUse`), and milestone-concurrency (`maxSelected`) were already real in iteration 0 and remain unchanged. One disclosed, non-blocking residual (carried over from iteration 0, not introduced or hidden by iteration 1): `scoreCandidate()`'s raw `score` arithmetic (`candidate-synthesis.ts`) still does not subtract `criticalPath` or `resourceUse` — matching the Proposal section's informal "Group value ... minus coordination, critical-path, resource, and atomic-failure costs" phrasing only partially. This is a Proposal-narrative phrasing, not literal AC5 checklist text (AC5's own wording says "respects ... constraints", not "the score formula subtracts"), and `resourceUse`/cadence/dependency/concurrency are now all real portfolio-choice *constraints* — consistent with the existing, already-precedented `resourceUse`-as-constraint (not as score term) design choice from iteration 0. Flagged here for visibility, not treated as an AC5 violation. |
| 6 | Preparation feedback triggers regen/reselect on drift; stops after 3 rounds | CONFIRMED | Unchanged. `MAX_PREPARATION_ROUNDS = 3`; fresh re-run PASS incl. "never-regenerates-a-4th-time"/"routes-to-human-review-after-max-rounds". |
| 7 | Historical replay: DIR-114+capture-gap+DIR-115 → 3-task candidate | CONFIRMED (disclosed synthetic fixture) | Fixture (a), unchanged; fresh "GREEN (a)" PASS. |
| 8 | Historical replay: DIR-109-112 → multiple comparable shapes | CONFIRMED (fixture) | Fixture (b), unchanged; fresh "GREEN (b)" PASS. |
| 9 | Historical replay: DIR-062-B/C kept separate (next-generation edge) | CONFIRMED (fixture) | Fixture (c), unchanged; fresh "GREEN (c)" PASS. |
| 10 | 10-task reconciliation eligible; disconnected addition rejected | CONFIRMED (fixture) | Fixtures (d)/(e), unchanged; fresh "GREEN (d)"/"GREEN (e)" PASS. |
| 11 | Existing SELECT/preflight tests + legacy singleton selection green; new modules meet coverage floor | CONFIRMED | Fresh `node --test` on all 6 named files (`candidate-contracts`, `candidate-synthesis`, `coupling-graph`, `portfolio-choice`, `preparation-feedback`, `select-preflight`): **98/98 PASS, 0 fail** (independently re-run by this audit). Fresh `--experimental-test-coverage` on the 5 new modules: line coverage 93.3–98.5% per file (candidate-contracts 95.31%, candidate-synthesis 98.49%, coupling-graph 97.87%, portfolio-choice 98.26%, preparation-feedback 93.33%), all above the project's ≥80% line-coverage norm; branch coverage 69.6–88.3% per file, consistent with the implementer's claimed 82.48% aggregate. |
| 12 | Plugin/`.claude`/experiment projections agree byte-for-contract | CONFIRMED | Fresh `bash plugin/scripts/sync-vendor.sh --check` → CLEAN (`scripts/candidate-contracts.ts` and `scripts/portfolio-choice.ts` explicitly re-verified identical post-iteration-1). Fresh `node --test plugin/test/plugin-packaging.test.mjs` → 34/34 PASS. |

**12 of 12 AC bullets independently confirmed. No refutation found.** AC bullet 5's prior REFUTED
finding (the total absence of `cadence` from the pipeline) is now genuinely and demonstrably closed
by real, tested code — independently re-derived by this audit, not taken on iteration-1's word.

### Checklist write-back (DIR-020)

`tasks/DIR-119-A.md` updated in place: all 12 AC boxes were already ticked `[x]` by the iteration-1
build pass (AC5 flipped `[ ]`→`[x]` there); this audit independently re-confirmed each citation
still holds and left them as-is (no change needed — the iteration-1 build's own AC5 evidence text
matches what this audit independently re-derived). DoD: this audit flips DoD item 5 from `[ ]` to
`[x]` (see §2 below), the only box this audit itself has standing to close.

## 2. DoD satisfaction

| # | DoD clause (abridged) | Verdict |
|---|---|---|
| 1 | Code/decision contracts committed on master under halt discipline | CONFIRMED — `HEAD=6b5c238` on `master` (descendant of iteration 0's `3185f51`); repo-root `.halt` present, mtime 2026-07-27 05:51:09, predating both the iteration-0 (10:36:05) and iteration-1 (11:13:33) commit timestamps. |
| 2 | All 4 historical replay families + negative controls pass deterministically | CONFIRMED — fresh re-run of all 6 Stage 1.1 fixtures, unchanged since iteration 0, still GREEN. |
| 3 | No task duplication / count cap / concurrency-as-horizon | CONFIRMED — source grep + fresh test re-run (AC3/AC4 evidence above), unchanged. |
| 4 | Bounded preparation/reselection, mirror parity, full focused tests pass | CONFIRMED — 98 tests across the 6 named files fresh re-run, 0 failures (was 118 across 7 files in iteration-0's count, which included `preparation-feedback` counted differently; this audit's own independent 6-file/98-test invocation matches iteration-1's own reported "98 tests / 98 pass" exactly); `sync-vendor --check` CLEAN. |
| 5 | Fresh independent audit finds no refutation; operational wiring deferred to DIR-119-C | **NOW MET** — this second independent audit pass finds NO REFUTATION (see §1). The "operational wiring deferred to DIR-119-C" half remains confirmed as before: no code in `HEAD=6b5c238` makes the outer loop act on `portfolio` in place of the legacy `candidates`/`shortlist` path — `select-preflight.ts`'s `portfolio` field is still additive-only, and `.claude/workflows/select-preflight.js` / `plugin/workflows/select-preflight.js` are untouched by either iteration (confirmed via `git log` on both paths showing no commits since DIR-114/M175). |

## 2a. Dispositions appended to `/tmp/m188-absorb-entry.md`

- `adversarial-audit disposition: NO REFUTATION FOUND` — appended as a new "Re-audit" section AFTER
  reaching this verdict, alongside (not replacing) the prior iteration's `REFUTED` disposition text
  already in that file from the earlier audit round — both are real, dated statements; the file now
  documents the REFUTED→fixed→NO REFUTATION FOUND progression honestly rather than erasing history.
- `V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated
  carry-forward` — verbatim result of `bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh
  --counter 186 experiments/quay-perpetual-stream/v-meta-ledger.md` (milestone_counter=187 at time of
  this audit per `dashboard.md`, so counter arg = 186), re-run fresh by this audit pass and copied
  verbatim, not paraphrased. Output: `milestone_counter=186 K=2`, both ledger rows `[ok]`
  (`consolidated`/`proposed`), no confirmed-unconsolidated row.

## 3. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-119-A \
    experiments/quay-perpetual-stream/charters/M188-dir119a-select-candidate-synthesis.md \
    /tmp/m188-absorb-entry.md
...
PASS: clause0-ac-dod-present: task AC has 12 checkable clause(s) (checklist-form, 12/12 checked); DoD references the standard [tasks/DIR-119-A.md]
PASS: clause1-adversarial-audit: disposition statement present (verdict)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget ... clause11-worktree-branch-hygiene: all PASS
N/A: clause6/7/8/9/12 (all legitimately N/A, documented no-ops — clause12 audit-independence is N/A
  because no '## Audit-independence check' section is present, matching the convention of the
  M185/M186/M187 absorb-entries checked for comparison, none of which include that section either)

PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
EXIT=0
```

Exit 0 — **NO REFUTATION FOUND**, matching this audit's own finding (all 12 AC / all 5 DoD clauses
now satisfied), not a pre-write-back sequencing artifact.

## 4. Deviation-log write-back (DIR-017 Step 3 / M36)

**Not applicable this pass.** This audit's verdict is NO REFUTATION FOUND, not REFUTED or CONCERNS
— per the audit charge, a deviation row is only required "if you find a REFUTED or CONCERNS." The
prior audit round (this file's earlier version, commit `da46f9a`) already added its own
`caught-by: machine` deviation row for the AC5 gap it found; that row's disposition should be
updated to `status: resolved` by the ABSORB step now that iteration-1's fix has been independently
verified — this audit does not itself edit `dashboard.md`'s deviation table beyond what §2a records,
since editing that row's status is an ABSORB-time bookkeeping action, not a new finding from this
pass.

## 5. Overall verdict

**NO REFUTATION FOUND.** All 12 Acceptance Criteria bullets and all 5 Definition-of-Done clauses
are independently confirmed against `HEAD=6b5c238` — re-derived from live git/test/CLI evidence,
not the implementer's self-report. The prior audit round's REFUTED finding (AC bullet 5's total
absence of `cadence` handling) is closed for real by iteration-1's `CadenceConstraint`/
`DependencyConstraint`/`findUnmetDependency` machinery: genuine, tested logic (17 new deterministic
tests read and independently re-run, not just counted), not a checkbox-only fix. Fresh re-run of
every test file in the DIR-119-A surface (98/98), both directly-edited modules' isolated selftests,
mirror-parity check, packaging test, and a live-store re-run all pass and reproduce the
implementer's reported numbers exactly. The it0-dod-check.sh mechanical gate now exits 0 (was 1).
One minor, disclosed, non-AC5-violating residual is carried forward for visibility: `scoreCandidate`'s
raw score arithmetic still omits `criticalPath`/`resourceUse` as subtracted terms (Proposal-text
phrasing, not literal AC5 wording) — recommended as a note for a future gap task, not a blocker to
this milestone's own Acceptance Criteria or Definition of Done as literally written.
