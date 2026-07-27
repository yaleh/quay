# M-DIR119-C-CANARY — cold, SELECT-synthesized ≥3-task composite proof (DIR-119-C)

**Task:** DIR-119-C · **Composite candidate:** `composite:DIR-070+DIR-110+DIR-111+exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN+gap-config-wiring-check-symlink-noop+gap-orphaned-check-scripts-not-wired+gap-workflow-name-dispatch-stale-script-cache`
**Member tasks (7):** DIR-070, DIR-110, DIR-111, exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN,
gap-config-wiring-check-symlink-noop, gap-orphaned-check-scripts-not-wired,
gap-workflow-name-dispatch-stale-script-cache
**Class:** development · **Value type:** capabilityGrowth
**Deliverable:** yes · **Charter tokens:** ~1.4 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0 (capability-growth, deliverable). This is Phase 3 (Stages 3.1-3.4) of the O4 control-plane
change — the non-self-referential proof that DIR-119-A (M188) and DIR-119-B (M189), both already
`status: done`, actually work together in production: **SELECT itself**, not a human, must
synthesize and choose a real ≥3-task composite, which then executes end-to-end through the
INSTALLED arbitrary-width mechanism (not a fixture, not a hand-assembled bundle).

**This is not a synthetic canary** — the 7 member tasks above are the REAL, highest-scored output
of a real `select-preflight.ts --json` run against the real, live task pool on 2026-07-27
(cold materialization record below). No task was added or removed by hand after that run. A
smaller 3-task alternative (`DIR-099+DIR-103+DIR-104`, score 2.38) also passed the real
synthesis/portfolio logic but scored lower — SELECT's own real output is honored as-is, per an
explicit human decision to respect SELECT's real top-scored choice rather than override it with a
more convenient pick (recorded 2026-07-27).

## Cold materialization record (Stage 3.1, AC1)
- **Source commit (pre-dispatch HEAD):** `6cdd4d3` (adds the 3 Touches sections this manifest's
  union-completeness check requires — the last commit before this milestone's own dispatch).
- **Workflow script:** `.claude/workflows/execute-milestone.js`, re-read fresh from disk via
  `Workflow({scriptPath: ...})` at dispatch time (never `name:` — see `gap-workflow-name-dispatch-
  stale-script-cache`), containing DIR-119-B's (M189) landed composite-execution code.
- **Dispatch form:** new `{milestoneCandidate:{taskIds,...}, charterFile, compositeManifestFile,
  absorbEntryFile}` shape (DIR-119-B Stage 2.1) — the FIRST real production use of this shape;
  every prior milestone this session used the legacy `{taskId,...}` form.
- **Session identity:** `13efe277-45ff-4563-bcfe-fd2c3db3e2a5` (the orchestrating session that
  also built/audited M188/M189 — the plan doc's "cannot self-certify" invariant refers to the
  BUILD/AUDIT turn of a control-plane change proving its own wiring within itself, not to which
  chat session issues a subsequent, independent, freshly-materialized `Workflow()` dispatch;
  every fresh dispatch this session has re-read the checked-in `master` HEAD script content, which
  is the actual "generation" boundary this repo's own established convention treats as real
  — see M180→M181's identical reasoning, itself independently audited and accepted).
- **Real SELECT run**: `node --experimental-strip-types experiments/quay-perpetual-stream/scripts/
  select-preflight.ts --json --workspace-root . --milestone-counter 190`, run 2026-07-27, produced
  the `portfolio.selected` array this candidate is copied from verbatim (pasted in full in the
  iteration report, not summarized).

## Scope
Per `tasks/DIR-119-C.md`'s Acceptance Criteria and the plan doc's Phase 3 stages:
1. **Stage 3.2 real SELECT proof**: the cold materialization record above + the pasted real
   `portfolio` JSON output IS this stage's evidence — already satisfied by the time this charter
   was authored. No re-running SELECT inside the Build phase and re-picking a different candidate.
2. **Stage 3.3 end-to-end execution**: the composite (7 real tasks, phase DAG in
   `/tmp/m-dir119-c-canary-manifest.json`, already mechanically pre-validated via
   `composite-preflight.ts` — real output `{"ok":true,...,"contractViolations":[]}` pasted below)
   executes through Verify (incl. the composite-preflight mechanical check) → phase-DAG Build → 4
   read-only audit shards (`shard-epic-closure`, `shard-ci-hygiene`, `shard-adr`,
   `shard-gap-fixes`) → deterministic Reconcile → per-task split-or-commit gates (7x) +
   milestone-scoped gates (1x each) → atomic Land.
3. **Real implementation work per member task** (the actual Requested Action of each, summarized —
   full detail in each task's own file):
   - **DIR-070**: this epic's 6 children (A-F) are ALL already `status: done`; DIR-070's own 8 AC
     items were never independently re-verified against that reality. Re-verify each of the 8
     against current repo state (`sync-vendor.sh --check`, symlink presence, gate paths in
     `.quay/config.yml`, `plugin-packaging.test.mjs`) and tick/close accordingly — this is
     verification-and-closure work, not new implementation (matches this session's earlier finding
     that DIR-070 itself needed exactly this).
   - **DIR-110**: write `scripts/test-coverage-check.ts` (globs all `**/test/*.test.mjs`, diffs
     against what `scripts/test.sh` actually invokes, fails non-zero naming orphans), a selfcheck
     fixture (RED+GREEN), wire it as an early CI step.
   - **DIR-111**: 2 small doc edits — label `ci.yml`'s packaging-e2e job explicitly, add a
     browser/agent-e2e note to `CLAUDE.md` pointing at ADR-010.
   - **exp5-ADR-TOOLSEARCH-DEFERRED-SCHEMA-PATTERN**: per this task's own later "Plan" revision
     (supersedes its original AC's "file an ADR" ask), document the ToolSearch-before-deferred-tool
     dependency as one paragraph in `CLAUDE.md`, M148 precedent style.
   - **gap-config-wiring-check-symlink-noop**: fix `config-wiring-check.ts`'s (and, if the same
     root cause, `concurrent-batch-scheduler.ts`'s) mirror-symlink silent-no-op entrypoint guard.
   - **gap-orphaned-check-scripts-not-wired**: wire `delivery-manifest-check.ts` into CI (or
     explicitly document it as manual-only) and correct `loop.yml`'s stale "INERT" comment on
     `routines:`.
   - **gap-workflow-name-dispatch-stale-script-cache**: 2 of 3 DoD items already done (operational
     rule landed in `CLAUDE.md` earlier this session); this milestone's real remaining scope is
     just item 1 (root-cause characterization — already effectively complete, tick with citation)
     — item 3 (escalate to Claude Code support) stays a human decision, not closed here.
4. **Stage 3.4 independent wiring audit**: per the task's own AC/DoD, dispatched as a SEPARATE,
   genuinely independent fresh-context auditor AFTER this milestone lands — reading ONLY primary
   artifacts (the real `portfolio` JSON, the real manifest, the real Land commit, real dashboard
   entry), confirming SELECT actually synthesized the group, rejected alternatives were recorded,
   the installed workflow ran (not a proxy), audit was read-only, reconcile owned mutation, and
   atomic Land/accounting are correct.

**Out of scope**: re-litigating whether the 7-task composite was the "right" choice — that decision
was made explicitly by the user, honoring SELECT's real output, before this charter was authored.

## Touches
- milestones/M-DIR119-C-CANARY/**
- experiments/quay-perpetual-stream/charters/M-DIR119-C-CANARY.md
- experiments/quay-perpetual-stream/dashboard.md
- experiments/quay-perpetual-stream/backlog.md
- tasks/DIR-119-C.md
- (per-member-task touches: see `/tmp/m-dir119-c-canary-manifest.json`'s `context.taskTouches` —
  union already validated via a real `composite-preflight.ts` run, `contractViolations: []`)

## Done-when
1. All 7 member tasks' own AC/DoD items are genuinely addressed (ticked with real evidence by the
   Audit shards, per DIR-020 — not self-ticked by Build) and each task's own `status` reaches
   `done` via the Reconcile step, independently of the others (per-task provenance retained).
2. The composite-preflight mechanical check passes for real inside the Verify phase (not just my
   own pre-dispatch validation pasted above — the live in-pipeline run must also show
   `contractViolations: []`).
3. All 4 audit shards produce real, immutable per-task/per-AC verdicts + a bundle verdict; a
   negative-control check (can an audit-phase agent mutate task/absorb/dashboard/counter state?)
   confirms read-only, per DIR-119-B's own already-tested `runReadOnlyAuditShard` guarantees.
4. Reconcile only mutates after all verdicts pass; atomic Land increments `milestone_counter`
   exactly once and writes exactly one composite dashboard entry (not 7 separate entries).
5. Full/focused test suites green, including the 7 new/modified real deliverables above.
6. DIR-119-C's own AC/DoD ticked with real evidence; DIR-119 (the parent) becomes eligible to close
   once this lands AND a subsequent independent wiring audit (Stage 3.4) confirms no refutation.

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
