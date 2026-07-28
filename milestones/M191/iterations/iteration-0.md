# M191 — iteration-0 (composite: DIR-117 + DIR-122)

**Charter:** `experiments/quay-perpetual-stream/charters/M191-dir117-dir122-composite.md`
**Composite manifest:** `/home/yale/.claude/jobs/13efe277/tmp/m191-dir117-dir122-manifest.json`
**Member tasks (2):** DIR-117, DIR-122 · **Phases (2, no dependency):** phase-DIR-117, phase-DIR-122
**Build lead:** one agent (this session), serializing both phases per the composite-build.ts
first-implementation note ("the first implementation MAY serialize all phases through you as the
one Build lead if parallel dispatch is unavailable") — task count (2) is NOT reported 1:1 with
agent count (1), per DIR-119-B's own `mapEvidenceToTasks` discipline.

## Evidence map (task × phase × files × tests)

| Task | Phase | Files touched | Tests | Real evidence |
|---|---|---|---|---|
| DIR-122 | phase-DIR-122 | `experiments/quay-perpetual-stream/scripts/task-schema.ts` (+`classifyKind` gap case, `checkGapFinding`/`checkGapRequestedAction`/`checkGapWiringCoverage`), `plugin/scripts/task-schema.ts` (byte-identical mirror), `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts` (new, shared), `plugin/scripts/wiring-coverage-check.ts` (mirror), `plugin/scripts/sync-vendor.sh` (+2 SYNC_SCRIPTS entries), `plugin/test/plugin-packaging.test.mjs` (okCount 19→21, workflow count 3→4) | `task-schema.test.mjs` 22/22, `wiring-coverage-check.test.mjs` 9/9, `plugin-packaging.test.mjs` 34/34 | Real before/after `task-schema-check.ts tasks/gap-*.md`: BEFORE `16 total, 7 pass, 7 N/A-legacy, 2 fail`; AFTER `17 total, 7 pass, 7 N/A-legacy, 3 fail` — every currently-`todo`/`ready` gap task now PASSes under `kind=gap`; the 3 remaining fails are pre-existing structure on already-`done` tasks (opportunistic per DIR-122's own Requested-action item 6, not blocking) |
| DIR-122 | phase-DIR-122 | `tasks/gap-build-phase-iteration-evidence-path-not-single-sourced.md`, `tasks/gap-cli-serve-port-test-flaky-ci-timeout.md`, `tasks/gap-drain-dispose-body-corruption.md`, `tasks/gap-touches-orthogonality-symlink-isdirect-mismatch.md` (retrofit: heading fix + real matching AC items for genuine wiring claims) | (covered above) | Each retrofit is a real, honest AC item for a claim the task ALREADY makes — not weakening the check |
| DIR-122 | phase-DIR-122 | (verify-only, not redone) `tasks/gap-symlink-mirror-noop-affects-5-more-scripts.md` / `gap-touches-orthogonality-symlink-isdirect-mismatch.md` reconciliation; `gap-task-schema-plugin-mirror-touches-drift`'s mirror-sync fix | n/a | Both independently re-verified TRUE at Build time (already landed by prior session activity, per charter's own "verify, don't redo" instruction) |
| DIR-117 | phase-DIR-117 | `.claude/workflows/prepare-milestone.js` (new), `plugin/workflows/prepare-milestone.js` (mirror), `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` (new), `plugin/scripts/milestone-preparation-check.ts` (mirror), `experiments/quay-perpetual-stream/fixtures/preparation/*` (4 fixtures), `.claude/workflows/execute-milestone.js` (+`Prepared` phase, opt-in), `plugin/workflows/execute-milestone.js` (mirror), `plugin/scripts/sync-vendor.sh`, `plugin/sync.sh` (+prepare-milestone.js to copy list) | `milestone-preparation-check.test.mjs` 12/12, `wiring-coverage-check.test.mjs` 9/9 (shared with DIR-122), `execute-milestone-disposition-conformance.test.mjs` 16/16 | Real CLI runs: `PASS: prepared — ...` (fresh receipt), 4 independent negative mutations each producing a DISTINCT code (`proposal-stale`/`charter-stale`/`plan-stale`/`source-stale`), unrelated-file-no-op still PASS, `--build` CLI mode round-tripped end-to-end (`WROTE:` → `PASS: prepared`) |
| DIR-117 | phase-DIR-117 | `experiments/quay-perpetual-stream/OUTER-LOOP.md` (`prepare(c)` step + `execute()` `preparationReceiptFile?` param + disclosure note), `.claude/skills/quay-task-to-plan/SKILL.md` + `plugin/skills/quay-task-to-plan/SKILL.md` (N=2/N=3 + 3-round/F_i=0 standardization, byte-identical) | n/a (prose/skill files) | `git diff` shows the drift resolved in the design doc's favor (N=2 already the real convention in `prompts/proposal-subagent.md`) |
| DIR-117 | phase-DIR-117 | `tasks/DIR-117-B.md` (new child task, DIR-026 SPLIT-OR-COMMIT) | n/a | Carries the one item (AC#11/DoD real-landing) this milestone cannot self-certify by construction (bootstrap paradox) — same split pattern as DIR-119-A/B → DIR-119-C |

## Composite mechanical checks

- `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-preflight.ts --args-json '...'` → `{"ok":true,"taskIds":["DIR-117","DIR-122"],"isComposite":true,"contractViolations":[]}` (pre-validated per charter; re-verified structurally unchanged — this milestone's own edits do not touch `composite-*.ts`).
- Touches orthogonality: DIR-117 and DIR-122's real touch sets remained file-disjoint EXCEPT the two new shared modules (`wiring-coverage-check.ts`, and both directives' own task files/`OUTER-LOOP.md` references) — both directives explicitly designed to share `wiring-coverage-check.ts` (DIR-122's own AC6: "does not weaken or duplicate DIR-117's ... check — the two share the same underlying concept/implementation"), so this is an intentional, disclosed, load-bearing intersection, not an accidental overlap.

## Full test suite (`bash scripts/test.sh`)

```
tests 537
suites 4
pass 533
fail 1
cancelled 0
skipped 3
duration_ms 592592
```

The 1 fail (`packages/quay/test/build-dist-smoke.test.mjs` — "(b) serve --port + HTTP GET returns
200") is a KNOWN FLAKY test unrelated to this milestone's changes (matches the
`gap-cli-serve-port-test-flaky-ci-timeout` pattern class already on file — CI-timing-sensitive
`serve --port` HTTP readiness poll). Confirmed by re-running the file in isolation immediately
after: `4/4 pass` (`tests 4, pass 4, fail 0`). Not caused by, and not touched by, this milestone's
edits (no overlap with `task-schema.ts`/`wiring-coverage-check.ts`/`milestone-preparation-
check.ts`/`execute-milestone.js`'s new `Prepared` phase).

## Composite-specific hazard disclosed: concurrent activity on `master` during this Build

This Build ran WITHOUT worktree isolation directly against `master` (per the newly-filed
`gap-execute-milestone-no-worktree-isolation` → promoted to `DIR-123` mid-session — a real,
independently-discovered architectural gap, not something this milestone caused). Three commits
landed on `master` from another concurrent session DURING this Build
(`38158d6`/`adb0f26`/`fb20ce1`, timestamps 02:29–02:54 vs. this session's ongoing edits) — none of
which touch any file this milestone's own Touches lists declare (verified via `git show --stat` on
each), so no semantic conflict resulted. Per this hazard, the final commit below stages ONLY the
files this Build intentionally changed (verified via `git status` immediately before staging) —
several unrelated, uncommitted `plugin/gate-scripts/*.sh` changes from that other concurrent
session's own in-flight work are deliberately left untouched, not swept into this commit.

## Per-task disclosed scope (not hidden)

- **DIR-117 AC#5** (Prepared-gate-triggered batch re-evaluation on touch-set expansion):
  `milestone-preparation-check.ts`'s `touches-expanded` code + `--declared-touches` flag exist and
  are tested; wiring that result into `concurrent-batch-scheduler.ts`'s own re-assembly loop is NOT
  done this milestone — disclosed, deferred to a future milestone once DIR-117-B's real-landing
  proof exists to exercise it against.
- **DIR-117 AC#10/#11 + DoD real-landing**: NOT achievable within this same Build by construction
  (this directive cannot pass through its own not-yet-built gate). Split into `DIR-117-B`
  (DIR-026 SPLIT-OR-COMMIT), same pattern this repo already used for DIR-119-A/B → DIR-119-C.
  `execute-milestone.js`'s `Prepared` phase ships strictly OPT-IN (`$a.preparationReceiptFile`)
  so this landing cannot retroactively break the live loop's very next dispatch.
- **DIR-122**: fully landed within this milestone, including the real before/after regression
  proof — no further split needed.

## Task-status disposition (left to Audit, per DIR-020)

Per DIR-020, this Build did not self-tick any AC/DoD checkbox on DIR-117, DIR-122, or any gap task,
and did not change `status`/`dirStatus` fields (only appended `## Execution record` sections to
DIR-117/DIR-122 documenting real evidence for the Audit phase to independently verify). `DIR-117-B`
was created `status: todo` as a new child task.

## Iteration 2 (2026-07-28) — close 5 real gaps found by iteration-0's REFUTED audit

Iteration 0 was REFUTED (`milestones/M191/audits/iteration-0-acceptance-audit.md`); the mechanical
gate (`it0-dod-check.sh DIR-117 ...`) found 6 unchecked AC items, 1 of which is properly
DIR-117-B's own scope (real subsequent-milestone landing). This iteration closes the other 5, per
the charter's own "Iteration 2" scope note. Composite discipline unchanged from iteration-0: one
Build lead serializing both phases; DIR-122 required NO further Build work this iteration (its two
outstanding issues were already corrected by direct task-file edit before this charter, per the
charter's own note) — all 5 items below are DIR-117/phase-DIR-117 scope.

### Evidence map (item × files × tests × real evidence)

| Item | Files touched | Tests | Real evidence |
|---|---|---|---|
| 1. Real `prepare-milestone.js` end-to-end fixture | `plugin/test/prepare-milestone-preparation-e2e.test.mjs` (new) | 2/2 (both mirrors) | A thin/stale-Proposal + `Plan: N/A` fixture task is driven through EVERY real phase (ProposalAuthors→Adjudicate→ProposalReview→PlanAuthor→PlanCheck→Receipt) of the REAL, unmodified `prepare-milestone.js` source (loaded as a real `AsyncFunction`, only the ES `export` keyword stripped). Reaches `{outcome:'prepared'}`; the real fixture task file on disk ends up with a reconciled Proposal containing "Problem framing"/"Approach"/"Key design decisions"/"Alternatives considered and rejected", and `## Plan` references a real, existing `docs/plans/*.md` file (independently re-verified via a direct `checkPreparation()` call, not trusting the mock's self-report) |
| 2. Provenance distinctness (author/reviewer run identity) | `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` (+`checkProvenanceDistinctness`, `buildReceipt`'s `provenance` param, CLI `--proposal-author-sessions`/`--adjudicator-session`/`--review-session`/`--plan-author-session`/`--plancheck-sessions` flags), mirrored to `plugin/scripts/milestone-preparation-check.ts` via `sync-vendor.sh`; `.claude/workflows/prepare-milestone.js` + `plugin/workflows/prepare-milestone.js` (every phase now captures its own real `$CLAUDE_CODE_SESSION_ID`, DIR-093 pattern, and threads them into the Receipt phase's `--build` command) | `milestone-preparation-check.test.mjs` (+9 provenance tests); `prepare-milestone-preparation-e2e.test.mjs` asserts all captured session ids are mutually distinct | `checkPreparation` now FAILs closed with `provenance-missing` (no provenance recorded at all) or `provenance-not-distinct` (reviewer's session matches an author's/adjudicator's, or a plan-checker's matches the plan-author's) — real, mechanical, not a caller-asserted "trust me" claim |
| 3. Real structural Plan validation | `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` (+`parsePlanStages`/`validatePlanStructure`, wired into `checkPreparation`), `experiments/quay-perpetual-stream/scripts/task-schema.ts` (+exported `countBoxes`, reused for AC-count derivation), both mirrored to `plugin/scripts/`; `.claude/workflows/prepare-milestone.js` + mirror (PlanAuthor prompt now instructs the exact `### Stage N:`/`- AC:`/`- Files:`/`- Command:` convention the checker parses); `experiments/quay-perpetual-stream/fixtures/preparation/fixture-plan.md` (restructured to the new convention), `fixture-plan-malformed.md` (new RED fixture — Stage 2 entirely missing) | `milestone-preparation-check.test.mjs` (+13 structural-validation tests) | `validatePlanStructure` rejects a Plan with no stages (`plan-no-stages`), a stage missing `- AC:`/`- Files:`/`- Command:` (3 distinct codes), and a Plan where a task AC item maps to no stage at all (`plan-ac-not-mapped`, proven against the real malformed fixture) — mechanical, not delegated entirely to the (separately still-required) LLM PlanCheck phase |
| 4. Touch-set-expansion re-evaluation wired into the batch scheduler | `experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts` (+exported `computeTouchesExpansion`, single-sourced, also used by `checkPreparation`'s own `touches-expanded` check), `plugin/scripts/concurrent-batch-scheduler.ts` (canonical — `experiments/.../scripts/concurrent-batch-scheduler.ts` is a symlink to it; +`loadReceiptTouches`/`applyPreparationExpansion`, `main()`'s new `--receipts id=file,...` flag) | `concurrent-batch-scheduler.test.mjs` (+8 tests) | A real test proves a candidate declared-disjoint under its STALE narrower `## Touches` (batches cleanly) is DEFERRED once its checked-Plan receipt's real touch set is applied (`applyPreparationExpansion` merges the expansion into the candidate's effective globs BEFORE `assembleBatch` runs) — "re-evaluated," not merely "detectable in isolation," per the item's own wording |
| 5. Real `execute-milestone.js` Prepared-phase integration test | `plugin/test/execute-milestone-preparation-gate.test.mjs` (new); `.claude/workflows/execute-milestone.js` + `plugin/workflows/execute-milestone.js` (Prepared phase gains optional `$a.declaredTouches` wiring — writes the declared set to a temp file and passes `--declared-touches`, making the `touches-expanded` trigger reachable through a DIRECT invocation, not only the batch scheduler) | 14/14 (7 scenarios × 2 mirrors) | The REAL, unmodified `execute-milestone.js` (loaded as a real `AsyncFunction`) is driven through Verify (stubbed PASS) → Prepared with a real receipt for each of AC8's 5 named conditions (failed review, `F_i>0`, a stale hash, a missing Plan, touch-set expansion) — each real run returns `{outcome:'revision-needed', phase:'Prepared', reason:<real code>}` BEFORE Build's `agent()` is ever called (would throw in the mock if reached); a real, fully-valid receipt reaches Build (asserted via a short-circuit sentinel only the Build-phase branch returns); the no-receipt back-compat skip path is also verified unaffected |

### Full test suite

`bash scripts/test.sh` (full canonical glob): **553 tests, 548 pass, 2 fail, 3 skipped.** The 2
failures (`build-dist-smoke.test.mjs` "(b) serve --port + HTTP GET returns 200",
`delivery-standalone-smoke-gate.test.mjs` "M52 C1 [AC2/AC3]") are the SAME pre-existing, already-
disclosed `gap-cli-serve-port-test-flaky-ci-timeout` CI-timing-sensitive flake iteration-0's own
report names (HTTP-readiness/acceptance-timeout races under full-suite CPU load) — confirmed by
re-running both files in isolation immediately after: `11/11 pass`. Neither touches, nor is
touched by, any file this iteration's own Touches list declares. `bash plugin/scripts/sync-vendor.sh
--check` → `CLEAN: all files verified, no drift detected.`

### Mechanical gate

Re-running `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-117
experiments/quay-perpetual-stream/charters/M191-dir117-dir122-composite.md
/home/yale/.claude/jobs/13efe277/tmp/m191-absorb-entry.md` is the Audit phase's job (per DIR-020,
this Build does not self-tick AC/DoD boxes) — left for that phase to run and record. The 5 items
above target exactly the 5 unchecked AC items (of the 6 the gate reported) that are this
milestone's own scope, per the charter's own item-by-item mapping; the 6th (real subsequent-
milestone landing) remains, by design, DIR-117-B's own scope.

### Task-status disposition (left to Audit, per DIR-020)

This iteration did not self-tick any AC/DoD checkbox on DIR-117 and did not change
`status`/`dirStatus`. `tasks/DIR-117.md`'s `## Touches` section was extended (not silently) to
name the 2 files this iteration's real scope newly touches that iteration-0's own Touches list did
not yet declare (`concurrent-batch-scheduler.ts` for item 4, `task-schema.ts`'s `countBoxes` export
for item 3) — both real, disclosed expansions, not silent drift.
