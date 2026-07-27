---
id: DIR-119-B
title: Execute arbitrary-width composite milestones through phase DAGs,
  read-only audit shards, deterministic reconcile, and atomic Land
status: done
labels:
  - milestone-candidate
  - human-steered
parent: DIR-119
children: []
extra:
  dirStatus: applied
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    DIR-119-B
    experiments/quay-perpetual-stream/charters/M189-dir119b-composite-execution.md
    /tmp/m189-absorb-entry.md
---

**type:** execution

## Proposal

Extend the checked milestone contract and `execute-milestone` workflow from scalar `taskId` to an
arbitrary non-empty task array selected by DIR-119-A. Normalize legacy single-task calls, validate
membership/AC/phase/audit/hash/capacity contracts, execute work by phase rather than by task, audit
the final integrated candidate through read-only shards, reconcile task/absorb state only after all
verdicts pass, and Land all task outcomes atomically.

Task count must not map one-for-one to agents. Shared phases have one owner; independent phases may
fan out within the global resource budget; one audit shard may cover several homogeneous tasks while
returning per-task/per-AC verdicts. Land increments the milestone counter once and records completed
task count separately. Partial Land is out of scope.

## Plan

Depends on DIR-119-A. Execute Phase 2 / Stages 2.1–2.6 of
`docs/plans/adaptive-composite-milestone-select-and-execution.md`. This child edits the active
execution/audit/Land control plane and is human-steered under halt.

## Acceptance Criteria

- [x] `execute-milestone` accepts both legacy `{taskId,...}` and selected
  `MilestoneCandidate.taskIds`; both normalize to one non-empty internal task array. Evidence:
  `experiments/quay-perpetual-stream/scripts/composite-args.ts`'s `normalizeExecuteArgs` (both
  shapes → one `taskIds[]`) plus `.claude/workflows/execute-milestone.js`'s inline
  `_normalizeExecuteArgsInline` computing `_taskIds`/`_primaryTaskId` before dispatch — confirmed
  by re-running `node --test experiments/quay-perpetual-stream/test/composite-args.test.mjs
  experiments/quay-perpetual-stream/test/composite-preflight.test.mjs` (all green) and reading the
  live diff in commit `49995b1`.
- [x] No schema, prompt, loop, fixture, or configuration imposes a maximum composite task count.
  Evidence: `grep` for `maxTask|MAX_TASK|taskLimit` across all `composite-*.ts` + the workflow
  files returns nothing; `composite-args.ts`/`composite-contracts.ts` selftests exercise widths up
  to 50 and 10 respectively, all accepted.
- [x] A mechanical composite contract checks membership, hashes, AC→phase→audit coverage, union
  touches, semantic resources, acyclic phase dependencies, temporal-proof exclusion, capacity, and
  atomic Land. Evidence: `composite-contracts.ts`'s `checkCompositeContract` (8-point check) +
  `composite-args.ts`'s stale-hash check, combined and wired live as the workflow's 6th Verify-phase
  mechanical check via `composite-preflight.ts` (`.claude/workflows/execute-milestone.js` lines
  ~128-132, `_cachedComposite`/`allVerifyResults.length < 6`).
- [x] Valid 1-, 3-, 5-, and 10-task fixtures pass; duplicate IDs, stale hashes, uncovered ACs,
  cycles, forbidden temporal edges, and over-capacity fixtures fail closed. Evidence: re-ran `node
  --test experiments/quay-perpetual-stream/test/composite-*.test.mjs` fresh this audit pass — 70/70
  pass, 0 fail, including `makeValidCompositeFixture(1|3|5|10)` and the negative fixtures for each
  named failure mode.
- [x] Build consumes a phase DAG; shared phases have one owner and task count does not determine
  agent count. Evidence: `composite-build.ts`'s `planPhaseExecution` (tested: shared-phase → 1
  owner even in parallel mode; serialize mode → agentCount===1 regardless of width 1/3/5/10;
  parallel mode capped independent of task count) is the checked target contract the Build-phase
  prompt (`.claude/workflows/execute-milestone.js`'s conditional `2a. COMPOSITE BUILD` block)
  instructs the agent to follow. NOTE: the workflow DSL has no `import` capability (confirmed:
  only `phase`/`agent`/`parallel`/`log`/`args` globals), so this stage is wired as agent-prompt
  guidance referencing a checked module, not a literal function call — consistent with DoD item 5's
  explicit "operational wiring remains assigned to DIR-119-C" carve-out and the plan doc's own
  Phase 2 (checked contract) vs Phase 3 (real end-to-end wiring, DIR-119-C) split.
- [x] Audit shards inspect the final integrated candidate, return per-task/per-AC plus bundle
  verdicts, and make no task, absorb, dashboard, counter, or lifecycle writes. Evidence:
  `composite-audit.ts`'s `runReadOnlyAuditShard` — real negative controls prove a hostile shard
  function attempting to flip task status, write an absorb disposition, push a dashboard entry, or
  bump the counter is blocked (`ok:false`) and the real state object is byte-identical
  before/after (`structuredClone` + recursive `Object.freeze` isolation). Same operational-wiring
  caveat as above: the live Audit phase is still one shared agent (unchanged DIR-020
  checklist-write-back behavior), not a literal per-shard dispatcher — that dispatcher is
  DIR-119-C's job per this task's own DoD item 5.
- [x] A deterministic reconciler validates receipts before updating task checkboxes/provenance and
  absorb dispositions in the candidate branch. Evidence: `composite-reconcile.ts`'s `reconcile()` —
  tested to gate on generation identity, bundle verdict, per-task verdicts, per-task gates, and a
  once-only milestone gate, returning mutations only when every check passes (atomic — one REFUTED
  member blocks the whole bundle). Same operational-wiring caveat: no literal "Reconcile" phase
  exists yet in `execute-milestone.js`; `reconcile()` is a checked, tested contract module, not yet
  invoked by the live Gate/Land phases — deferred to DIR-119-C per DoD item 5.
- [x] Every task-scoped gate runs for every member; milestone-scoped gates run once; any failure
  prevents all Land mutations. Evidence: this ONE is live-wired, not just contract-level —
  `.claude/workflows/execute-milestone.js`'s Gate phase now does
  `_taskIds.map((tid) => () => agent(...split-or-commit...))`, confirmed byte-for-behavior
  identical (same single call, same `'split-or-commit'` label) for legacy singleton calls; the
  milestone-scoped gates (`vmeta-lag`, `tree`, `worktree`) remain single dispatches; `gatesFailed`
  still blocks Land exactly as before.
- [x] Atomic Land marks every task consistently, captures all evidence, writes one dashboard entry,
  and increments `milestone_counter` exactly once regardless of task count. Evidence:
  `composite-land.ts`'s `buildLandTransaction` (tested at widths 1/3/5/10: `counterDelta`===1,
  `dashboardEntryCount`===1, `taskCompletionCount`===width; golden-replay-matched against
  `legacySingletonLandShape()`); the live Land phase's `_compositeLandNote` (empty string for
  legacy calls) instructs the agent to the same effect. Same operational-wiring caveat as Build/
  Audit/Reconcile above.
- [x] Negative controls prove no partial task lifecycle mutation reaches master after Audit,
  Reconcile, Gate, anti-drift, or Land failure. Evidence:
  `composite-reconcile.test.mjs`/`composite-land.test.mjs` — a REFUTED bundle verdict, a missing
  per-task verdict, a failed task gate, a missing/failed milestone gate, and stale generation
  identity each independently produce `{ok:false, mutations:[]}` / zero counter-delta / zero
  dashboard entries / zero task marks; re-run this audit pass, all green.
- [x] Legacy singleton golden replay remains behavior-compatible. Evidence:
  `composite-args.test.mjs`'s `legacy-normalizes`, `composite-preflight.test.mjs`'s
  `legacy-vacuous-pass`, `composite-land.test.mjs`'s golden-replay test, plus the live workflow's
  `_primaryTaskId` being identical to the pre-existing `$a.taskId` for every single-task call
  (confirmed by reading the diff) and the Gate-phase `split-or-commit` label staying unchanged for
  legacy calls.
- [x] Workflow/plugin/package mirrors and all focused/full suites pass with required coverage.
  Evidence: `diff` confirms `.claude/workflows/execute-milestone.js` ↔ `plugin/workflows/
  execute-milestone.js` and all 7 `experiments/.../scripts/composite-*.ts` ↔ `plugin/scripts/
  composite-*.ts` are byte-identical; `bash plugin/scripts/sync-vendor.sh --check` reports CLEAN;
  `plugin/test/plugin-packaging.test.mjs` (34/34, including the 12→19 script-count bump) and
  `plugin/test/execute-milestone-disposition-conformance.test.mjs` (16/16, the M180 wiring
  regression guard) both re-run green against the new file; full canonical `scripts/test.sh`
  re-run end-to-end this audit pass: 537 tests, 527 pass, 7 fail, 3 skipped — all 7 failures
  independently triaged (see audit artifact §3) as either a pre-existing, DIR-119-B-unrelated
  failure (reproduced identically on the pre-DIR-119-B commit `49995b1~1`) or contention-induced
  60s-timeout flakes (`delivery-standalone-smoke-gate.test.mjs`/`ts-typecheck-gate.test.mjs`, both
  re-run clean in isolation, 12/12 pass) — zero failures touch anything this milestone changed.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [x] Source implementation and arbitrary-width contracts are committed on master under halt.
  Evidence: commit `49995b1` ("M189/DIR-119-B: arbitrary-width composite milestone execution") is
  on `master` (`git log --oneline` shows it as HEAD~1 of the current branch, no open PR/worktree);
  `.halt` sentinel present at repo root during this audit pass.
- [x] Valid 1/3/5/10-task and invalid dependency/capacity/atomicity fixtures pass as specified.
  Evidence: `node --test experiments/quay-perpetual-stream/test/composite-*.test.mjs` — 70/70 pass,
  re-run fresh this audit pass.
- [x] Read-only audit, deterministic reconcile, atomic Land, and singleton golden replay are green.
  Evidence: same 70/70 run above includes `composite-audit.test.mjs` (negative-control isolation
  proofs), `composite-reconcile.test.mjs` (atomicity), `composite-land.test.mjs` (atomic Land +
  golden replay) — all green.
- [x] No two-task-only, one-auditor-per-task, or best-effort partial-Land mechanism remains.
  Evidence: no prior composite mechanism existed to remove (legacy was strictly single-task-only,
  not two-task); the new mechanism is exercised at widths 1/3/5/10/50 with no cap found anywhere
  (`grep` for `maxTask`/length limits returns nothing) and `composite-land.ts` proves exactly one
  counter increment / one dashboard entry / atomic all-or-nothing mutation regardless of width.
- [x] A fresh independent audit finds no refutation; operational wiring remains assigned to
  DIR-119-C rather than self-certified here. Evidence: this audit (session id below) — verdict
  CONCERNS (non-blocking; see audit artifact), not REFUTED. This audit independently confirmed
  Stages 2.3-2.6 (Build/Audit/Reconcile/Land) are delivered as checked, tested contract modules
  referenced by agent-prompt guidance rather than literally invoked by the live workflow — exactly
  the "operational wiring remains DIR-119-C's job" scope this DoD item itself states, not a
  self-certification of that wiring.

## Touches

- `.claude/workflows/execute-milestone.js`
- `plugin/workflows/execute-milestone.js`
- `plugin/scripts/*composite*`
- `plugin/scripts/*reconcile*`
- `experiments/quay-perpetual-stream/scripts/*composite*`
- `experiments/quay-perpetual-stream/scripts/*reconcile*`
- `plugin/test/*composite*`
- `plugin/test/*reconcile*`
- `experiments/quay-perpetual-stream/test/*composite*`
- `experiments/quay-perpetual-stream/OUTER-LOOP.md`
- `plugin/test/plugin-packaging.test.mjs`

## Execution record

- **Milestone:** M189
- **Iteration count:** 1 (direct commit on `master` under `.halt`, human-steered per this task's
  own `label:human-steered`; no separate worktree/branch to merge)
- **Realized Δv:** 0 (VT-neutral — capability-growth on the EXECUTION-side method-infra surface,
  not a chart-2-scored `packages/quay*` product surface cell; same pattern as the
  M164/M167/M179/M188 precedent: the charter's own Value hypothesis states "Δv̂ > 0
  (capability-growth, deliverable)" but no chart-2 cell moves, so realized VT is 0 despite a
  genuine capability landing — the real value is the arbitrary-width EXECUTION machinery becoming
  operative for DIR-119-C to wire in on a cold generation)
- **Merge commit:** `49995b1` ("M189/DIR-119-B: arbitrary-width composite milestone execution
  (Phase 2 of O4)") — already on `master` at ABSORB time, built directly on `master` under `.halt`
  discipline; this milestone's own build/audit explicitly does NOT certify real operational
  multi-task wiring — that proof is deferred to DIR-119-C on a cold, later generation per this
  task's own bootstrap-paradox note.
- **Audit verdict:** CONCERNS (fresh independent adversarial acceptance audit, session
  `13efe277-45ff-4563-bcfe-fd2c3db3e2a5`, 2026-07-27 — all 12 AC + 5 DoD items independently
  confirmed true against live code/test/diff evidence, mechanical gate `it0-dod-check.sh` exits 0;
  CONCERNS (not REFUTED) solely because this milestone's own Build-phase evidence file
  `iteration-0.md` was filed at the legacy `experiments/quay-perpetual-stream/milestones/M189/`
  path instead of the top-level `milestones/M189/` path `gate_resolve_milestone_root(189)`
  resolves to — the same recurring defect class M185's own audit already logged. **Resolved at
  this ABSORB (2026-07-27):** `git mv` moved the file to `milestones/M189/iterations/iteration-0.md`
  [same M185/`612b996` precedent]; see `milestones/M189/audits/iteration-0-acceptance-audit.md` for
  full findings.
- **Outcome:** `execute-milestone` now accepts an arbitrary non-empty task array (in addition to
  the legacy scalar `taskId`) normalized by one canonical function that never rejects on width; a
  mechanical 8-point composite contract checks membership/AC-phase-audit-coverage/acyclic phase
  DAG/union touches+resources/forbidden-temporal-edge exclusion/capacity/atomic Land at widths
  1/3/5/10 plus fail-closed negative fixtures; a phase-DAG Build planner, read-only audit shards
  (real negative-control-proven no-mutation isolation), a deterministic Reconcile, and an atomic
  Land (one counter increment, one dashboard entry, N-task completion count recorded separately,
  golden-replay-verified against the legacy singleton shape) are delivered as checked, tested
  contract modules; wired live into the workflow as a 6th Verify-phase mechanical check and a
  per-member Gate-phase loop. Stages 2.3-2.6's Build/Audit/Reconcile/Land dispatch remains
  agent-prompt guidance referencing the checked modules, not yet a literal per-phase/per-shard
  dispatcher — that operational wiring remains DIR-119-C's explicit scope, per this task's own DoD
  item 5 and bootstrap-paradox note.
