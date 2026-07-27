# M188 — Adversarial Acceptance Audit (DIR-119-A)

**Audit session id:** 13efe277-45ff-4563-bcfe-fd2c3db3e2a5

Fresh-context, refute-first adversarial acceptance audit of DIR-119-A ("Make SELECT synthesize and
choose singleton/composite MilestoneCandidates from a task coupling graph"), M188. This audit was
NOT present for the build and re-derived every claim independently from live git/test/CLI evidence,
never trusting `experiments/quay-perpetual-stream/milestones/M188/iterations/iteration-0.md`'s
self-report.

## 1. AC satisfaction (refute-first)

Task file: `tasks/DIR-119-A.md`. Build commit: `3185f51` (already on `master`).

| # | AC bullet (abridged) | Verdict | Evidence |
|---|---|---|---|
| 1 | Versioned `TaskCandidate`/coupling-edge/`MilestoneCandidate`/`MilestonePortfolio` contracts; singleton = one-task candidate | CONFIRMED | `candidate-contracts.ts`: `CONTRACT_VERSION=1`, the 4 interfaces, `makeSingletonCandidate`. Fresh `node --test candidate-contracts.test.mjs` PASS. |
| 2 | SELECT synthesizes composites before final portfolio selection; selected+rejected shapes recorded with reasons | CONFIRMED | Live run: `node --experimental-strip-types select-preflight.ts --json --workspace-root . --milestone-counter 188` against the REAL task store → `portfolio.version=1`, `selected.length=7`, `rejected.length=19`, each rejected entry carries a concrete `reason` string. Independently re-run by this audit (not the implementer's paste). |
| 3 | `candidate_horizon` independent of `.quay/loop.yml` concurrency; strong-coupling neighbors outside seed rank can join | CONFIRMED | `grep -rn "loop.yml"` across `candidate-contracts.ts`, `coupling-graph.ts`, `candidate-synthesis.ts`, `portfolio-choice.ts`, `preparation-feedback.ts`, `select-preflight.ts` — zero file-read call sites, only comments. `synthesizeCandidatePortfolio` passes `constraints: {}`. Fresh re-run of both `candidate_horizon is independent...` tests PASS. |
| 4 | Bounded seed/beam expansion, retains singletons, no max-task-count check | CONFIRMED | `expandFromSeed`/`DEFAULT_CANDIDATE_HORIZON=3` in `candidate-synthesis.ts`; fresh re-run of "no power-set enumeration" and "no taskIds.length cap: a 25-task fully-coupled pool synthesizes without truncation" PASS. |
| 5 | Portfolio choice prevents duplicate membership; respects dependency, cadence, resource, milestone-concurrency constraints | **REFUTED (partial)** | Duplicate-membership (`assertPortfolioDisjoint`, overlap rejection), resource (`maxTotalResourceUse`), and milestone-concurrency (`maxSelected`) are real and tested in `portfolio-choice.ts`. **`cadence` is absent from the entire pipeline**: `grep -rn cadence` over `candidate-contracts.ts`, `candidate-synthesis.ts` (incl. `scoreCandidate`), `portfolio-choice.ts` (incl. `choosePortfolio`/`PortfolioConstraints`), and all their test files returns **zero hits**. The Plan doc's own Stage 1.4 text this charter's Scope cites verbatim requires "Score candidates using union delivery value, fixed-context savings, critical path, **cadence**, coordination, resource use, and atomic failure cost." `select-preflight.ts` computes a `cadence` value (`getCadence`/`explore-exploit-cadence.ts`) but wires it only into the pre-existing, separate `PreflightResult.cadence` field — never passed into `buildTaskCandidateFacts`/`synthesizeCandidatePortfolio`. Additionally, `scoreCandidate()`'s actual formula is `unionValue + fixedCostSaving - coordinationCost - atomicFailureCost` — `criticalPath` and `resourceUse` are computed and stored on the record but **never subtracted from `score`**, contradicting the task's own Proposal text: "Group value is union value with fixed-cost savings minus coordination, critical-path, resource, and atomic-failure costs." |
| 6 | Preparation feedback triggers regen/reselect on drift; stops after 3 rounds | CONFIRMED | `preparation-feedback.ts`'s `MAX_PREPARATION_ROUNDS = 3`; fresh `preparation-feedback.test.mjs` re-run PASS incl. "never-regenerates-a-4th-time" and "routes-to-human-review-after-max-rounds". |
| 7 | Historical replay: DIR-114+capture-gap+DIR-115 → 3-task candidate | CONFIRMED (via disclosed synthetic fixture) | `candidate-synthesis-fixtures.ts` fixture (a); the file's own header honestly discloses these are "DELIBERATELY synthetic stand-ins for the real historical task records they name" — matches the plan doc's own Stage 1.1 (fixture) vs Stage 1.2 (live extractor) split, not a hidden gap. Fresh test re-run "GREEN (a)" PASS. |
| 8 | Historical replay: DIR-109-112 → multiple comparable shapes | CONFIRMED (fixture) | Fixture (b); fresh test re-run "GREEN (b)" PASS. |
| 9 | Historical replay: DIR-062-B/C kept separate (next-generation edge) | CONFIRMED (fixture) | Fixture (c), explicit `next-generation` edge; fresh test re-run "GREEN (c)" PASS. |
| 10 | 10-task reconciliation eligible; disconnected addition rejected | CONFIRMED (fixture) | Fixtures (d)/(e); fresh test re-run "GREEN (d)"/"GREEN (e)" PASS. |
| 11 | Existing SELECT/preflight tests + legacy singleton selection green; new modules meet coverage floor | CONFIRMED | Fresh `select-preflight.test.mjs` re-run: 60/60 PASS (incl. legacy `getCandidates`/`selftest`). `loadbearing-test-gate.sh` re-run: 42 total/15 pass/27 N/A/0 fail — every load-bearing new module has its own sibling `*.test.mjs`. Fresh `--experimental-test-coverage` run on the 5 new modules: **97.07% line / 82.48% branch / 96.33% funcs** — well above the project's ≥80% line-coverage norm. |
| 12 | Plugin/`.claude`/experiment projections agree byte-for-contract | CONFIRMED | Fresh `bash plugin/scripts/sync-vendor.sh --check` → CLEAN, all 5 new mirrors byte-identical. Fresh `node --test plugin/test/plugin-packaging.test.mjs` → 34/34 PASS. |

**11 of 12 AC bullets independently confirmed. AC bullet 5 is a genuine, code-verifiable partial
refutation** — not a process nit, not a forward-looking/unverifiable-at-audit-time criterion, but a
concrete named requirement (`cadence`) that is demonstrably absent from the shipped scoring/portfolio
code.

### Checklist write-back (DIR-020)

`tasks/DIR-119-A.md` updated in place: 11 of 12 AC boxes ticked `[x]` with evidence citations, AC
bullet 5 left `- [ ]` with the specific gap documented inline. DoD: 4 of 5 boxes ticked `[x]`; DoD
item 5 ("a fresh independent audit finds no refutation...") left `- [ ]` since this very audit finds
one — self-referentially, that box cannot be true at the moment this audit writes it.

## 2. DoD satisfaction

| # | DoD clause (abridged) | Verdict |
|---|---|---|
| 1 | Code/decision contracts committed on master under halt discipline | CONFIRMED — commit `3185f51` on `master`; repo-root `.halt` mtime 2026-07-27 05:51:09, predating the commit's 10:36:05 timestamp. |
| 2 | All 4 historical replay families + negative controls pass deterministically | CONFIRMED — fresh re-run of all 6 Stage 1.1 fixtures, RED-then-GREEN. |
| 3 | No task duplication / count cap / concurrency-as-horizon | CONFIRMED — source grep + fresh test re-run (AC3/AC4 evidence above). |
| 4 | Bounded preparation/reselection, mirror parity, full focused tests pass | CONFIRMED — 118 tests across the 7 named files, fresh re-run, 0 failures; `sync-vendor --check` CLEAN. |
| 5 | Fresh independent audit finds no refutation; operational wiring deferred to DIR-119-C | **NOT MET as literally stated** — this audit finds the AC5 cadence gap (REFUTED, not clean). The "operational wiring deferred to DIR-119-C" half IS confirmed: no code in this diff makes the outer loop act on `portfolio` in place of the legacy `candidates`/`shortlist` path — `select-preflight.ts`'s `portfolio` field is additive only. |

## 2a. Dispositions appended to `/tmp/m188-absorb-entry.md`

- `adversarial-audit disposition: REFUTED` (determined from the AC5 finding above, appended after
  reaching this verdict).
- `V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated
  carry-forward` — verbatim result of `bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh
  --counter 186 experiments/quay-perpetual-stream/v-meta-ledger.md` (milestone_counter=187 at time of
  this audit, so counter arg = 186), copied verbatim, not paraphrased.

## 3. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-119-A \
    experiments/quay-perpetual-stream/charters/M188-dir119a-select-candidate-synthesis.md \
    /tmp/m188-absorb-entry.md
...
FAIL: clause0-ac-dod-present: checklist-form AC has 1 unchecked item(s) remaining
  (REFUTED-equivalent, HARD-blocks exactly as an unmet criterion does):
  "Portfolio choice prevents duplicate task membership and respects dependency, cadence, resource,"
FAIL: DoD check failed — 1 clause violation(s) found (see above).
EXIT=1
```

All other 11 clauses PASS/N/A. Non-zero exit (1) — **REFUTED by construction**, per this audit's own
finding (AC5's `cadence` gap) rather than any pre-write-back sequencing artifact (clauses 1/2/12,
normally the recurring source of a first-pass non-zero exit in this repo's history, all PASS here).

## 4. Deviation-log write-back (DIR-017 Step 3 / M36)

Added one `caught-by: machine` row to `dashboard.md`'s "Homeostatic variables (DIR-017 Step 3)" →
"Deviation rows" table (level=REFUTED, caught-at=M188, status=open, age=0) describing the AC5 cadence
gap and its mechanical-gate consequence. No `caught-by: human` row was added — unlike M180/M186,
`iteration-0.md`'s own self-report claims all 7 Done-when items are "✅" and discloses no cadence gap
to transcribe; this finding originates with this audit pass, not a prior human/outer-loop disclosure.

## 5. Overall verdict

**REFUTED.** The delivered machinery is substantial and mostly real: versioned contracts, a real
coupling-graph builder reusing `touches-orthogonality-check.ts`, bounded seed/beam synthesis with no
power-set/no-cap (independently re-verified), a deterministic portfolio-choice set-packer with a
genuine live decision record (7 selected / 19 rejected against the real task store, not a mock), a
correctly-capped 3-round preparation-feedback loop, clean mirror parity, and coverage well above the
project floor — all independently reproduced by this audit, not taken on the implementer's word. But
AC bullet 5's `cadence` requirement is demonstrably unimplemented (zero occurrences anywhere in the
scoring/portfolio-choice code or tests) despite being named both in the task's own Acceptance
Criteria and in the Plan doc's Stage 1.4 text this charter cites as its scope, and the task's own
mechanical acceptance gate (`it0-dod-check.sh`) hard-blocks on exactly this unchecked AC item,
exiting 1. Per this audit's charge ("Non-zero exit = REFUTED by construction"), the verdict is
REFUTED, not CONCERNS, notwithstanding the substantial confirmed work elsewhere.
