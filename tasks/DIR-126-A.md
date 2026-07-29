---
id: DIR-126-A
title: Single-flight admission for prepare-milestone.js (prepare-admission-check.ts,
  new Admission phase) — first child of DIR-126's split
status: todo
labels:
  - milestone-candidate
  - human-steered
  - priority:urgent
parent: DIR-126
children: []
extra:
  schema: v1
  dirStatus: applied
  rank: 0
  urgency: urgent
---

**type:** execution

## Proposal

Add a real admission/ownership check to `prepare-milestone.js` so at most one live generation for
a given `(workspace, taskId)` proceeds past a new `Admission` phase — closing the concrete overlap
DIR-126's own Finding measured (two M196 generations for the same task overlapped, adding ~54
duplicate workflow-minutes). First child of DIR-126's 5-way split (`split-subsystem-blocking-
cluster`/mechanism-count-5 finding, M199/DIR-126's real ProposalReview run). Depends on nothing
else in this split; DIR-126-B (deterministic preflight) shares this child's own new module and
phase-insertion point but has an independently testable proof surface; DIR-126-C (generation-aware
resume) treats a resume dispatch as itself an admission event and depends on this child landing
first.

### Problem framing (re-verified live against the current tree, 2026-07-29)

`.claude/workflows/prepare-milestone.js` (511 lines, byte-identical to its `plugin/workflows/`
mirror — confirmed via `cmp`) has no `fs`/`import` statements at all — a deliberate workflow-DSL
convention (the script itself explains, near lines 128-138, why `Date.now()` crashes the sandbox
and why real time must come from an agent's `date +%s%3N` shell call, not a Node API the script
calls directly). It begins directly at `phase('ProposalAuthors')` (or, under
`resumeFromAdjudicatedProposal`, skips straight to `ProposalReview`) with zero check that another
live generation for the same `(workspace, taskId)` already owns the work. Two concurrent dispatches
for the same task today both freely proceed through `ProposalAuthors`/`Adjudicate`, racing
`task_write`s against each other — exactly the overlap DIR-126's Finding measured for M196.

### Chosen mechanism

New pure module `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`, mirrored
byte-identically to `plugin/scripts/prepare-admission-check.ts` (the same canonical-first +
`sync-vendor.sh --check`/`cmp` discipline `composite-manifest-synthesis.ts` and every other
`composite-*`/`proposal-convergence.ts`/`milestone-preparation-check.ts` module already uses), same
"pure functions + thin CLI" shape as `proposal-convergence.ts`/`milestone-preparation-check.ts`
(unit-testable decision logic, file I/O isolated in the CLI wrapper) — exports
`acquireLease`/`renewLease`/`releaseLease`/`checkStaleOwner` plus a CLI wrapping them
(`--acquire`/`--renew`/`--release`/`--force-release <reason>`).

**Lease acquisition** is `fs.writeFileSync(path, json, {flag: 'wx'})` — Node's atomic
exclusive-create, the same primitive `gate-event-store.ts`'s append-only design and
`frontmatter-store-base.ts`'s `withFileLock()` already rely on in this repo (direct in-repo
precedent, not a novel primitive; deliberately re-implemented rather than imported from
`packages/quay/src/frontmatter-store-base.ts` to avoid a new `experiments/` -> `packages/`
dependency edge that would show up as an unwanted methodology-layer-to-product-layer coupling in
`archguard_get_dependencies`/`archguard_detect_cycles`). The lease shape reuses DIR-124's own
vocabulary (`runId, taskId, baseCommit, acquiredAt, leaseUntil, heartbeatAt, fencingToken`) rather
than inventing an incompatible one (`docs/proposals/quay-milestone-workflow-stage-pipelining-and-
leases.md`, status: proposal, not implemented — this child implements only the explicitly-
sanctioned atomic-directory prototype tier it names, scoped to the Prepare stage's single
`(workspace, taskId)` key, not DIR-124's full four-mechanism durable contract). The lease lives at
a gitignored path (`.quay/prepare-leases/<taskId>.json`, requiring one new `.gitignore` line —
`**/.quay/prepare-leases/`) — pure runtime mutex state, meaningful only to the one working tree
with a generation in flight, consistent with this repo's single-shared-working-tree model and its
existing `.quay/gate-events.jsonl` gitignore precedent.

**Phase wiring.** `prepare-milestone.js` (both mirrors) gains a new first phase, `Admission`,
dispatched via a labeled `agent()` call running `prepare-admission-check.ts --acquire` before
`phase('ProposalAuthors')` — runs unconditionally, even under `resumeFromAdjudicatedProposal`,
since that path still must not race a second owner. A `prepare-already-running` verdict returns
`{outcome: 'needs-human', reason: 'prepare-already-running', phase: 'Admission', owner:
{generationId, acquiredAtMs, leaseUntil}}` before any author agent is spent.

**Staleness window (corrected 2026-07-29, ProposalReview finding f76ae150):** an earlier draft set
this to "90 minutes ordinary / 150 minutes highRisk — 2x the 45/75-minute ProposalReview soft
budget," which directly contradicted the Finding's own cited data and undercounted
`MAX_PLANCHECK_ROUNDS = 3` (`.claude/workflows/prepare-milestone.js:390`, unconditional, NOT gated
on `highRisk`): M195's single PlanCheck round alone measured ~57 real minutes, so three rounds can
plausibly cost ~170+ minutes ON TOP OF the ProposalReview budget, not inside it. The corrected
default is **300 minutes ordinary / 360 minutes highRisk**, derived as: ProposalReview soft budget
(45/75m) + a PlanAuthor allowance (~20m) + up to 3 PlanCheck rounds (~70m each, safety-margined
above the 57m observed = ~210m) + a Receipt buffer (~10m) — a real derived sum, not a multiplier of
the ProposalReview budget alone, conservative enough that a legitimately slow real generation is
never falsely declared stale (the exact false-contention risk this mechanism exists to prevent).

If a lease is found expired (`now > leaseUntil`) on acquire, it is reclaimed deterministically and
the new lease records `recoveredFrom` copying the stale lease's contents verbatim (never silently
discarded) before overwriting. Every terminal `return` in `prepare-milestone.js` (prepared,
needs-human, revision-needed, contention) must invoke `--release`; a crash between acquire and any
return is exactly the case staleness recovery must handle. Renewal piggybacks on every existing
phase boundary (`Admission` -> `Adjudicate`, each `ProposalReview` delta round, `PlanAuthor`, each
`PlanCheck` round, `Receipt`) via a lightweight `--renew` call extending `leaseUntil` from the
caller-reported `nowMs` — reusing the existing "agent runs `date +%s%3N`, workflow trusts the
reported number" pattern already required for `ProposalReview`'s own clock.

A human `--force-release <reason>` escape hatch exists for a legitimately stuck lease before the
staleness window elapses; the reason is recorded as evidence (in the lease's own
`recoveredFrom`/audit trail, and later in DIR-126-D's telemetry record once that child lands),
never silent.

### Key design decisions

- **Admission and preflight (DIR-126-B) are one module/CLI but two independently landable AC-level
  proof surfaces** — a lease bug must not block landing a preflight fixture and vice versa; this is
  why they are separate ordered children sharing one production file rather than merged into one.
- **`wx` atomic-create, not `flock(2)`** — no portable Node-core primitive without a native addon or
  child-process syscall dependency, and the repo already has a working, precedented `wx`-based
  pattern (`frontmatter-store-base.ts`, `gate-event-store.ts`) to mirror with no new infrastructure.
- **Local filesystem lease, not a distributed lock** — DIR-027's own steering discipline already
  assumes one active checkout of `master` at a time; a local-filesystem lease matches that existing
  assumption, and a database/external-lock-service/Provider-ABI lock task would add dependency
  surface the native store doesn't need.
- **Staleness/lease timeouts are set conservative-first** (well above the worst observed real
  Prepare time — see the corrected 300m/360m derivation above) and only tightened once DIR-126-E's
  real distribution exists, avoiding the single-flight mechanism itself becoming a new source of
  false-positive lockouts before real P85 data exists to calibrate against.
- **Renewal-at-every-phase-boundary is its own explicit requirement**, not folded silently into
  "lease recovery is fail-closed" — the task's own AC text names stale-owner reclaim and
  crash/restart by name but not renewal-at-phase-boundaries, so this Proposal states it explicitly
  and gives it its own fixture (see AC below).
- **Heartbeat/renewal, not PID-liveness, for stale-owner detection** — the "owner" is a remote agent
  dispatch inside the Workflow harness sandbox, not a local process the admission CLI can signal or
  poll; heartbeat/renewal plus a generous `leaseUntil` timeout is the only evidence actually
  available at this layer, consistent with the existing constraint that workflow scripts cannot
  read the wall clock directly and must trust agent-reported timestamps.

### Defaults and failure behavior

| Condition | Default outcome |
|---|---|
| Lease already held, not expired | `needs-human`, `prepare-already-running`, before `ProposalAuthors`, naming the owning generation |
| Lease expired (`now > leaseUntil`), no renewal | reclaimed deterministically; new lease records `recoveredFrom` (prior owner's evidence), never silent |
| Any generation's terminal phase crashes before releasing the lease | lease still recoverable via stale-`leaseUntil` reclaim on the next dispatch; no permanent lockout |
| A legitimately stuck lease before the staleness window elapses | human `--force-release <reason>` escape hatch; reason recorded as evidence, never silent |
| Different `taskId` | independently runnable — admission is keyed on `(workspace, taskId)`, never a global lock |

### Compatibility

No existing `prepare-milestone.js` phase's behavior changes for a generation that successfully
acquires admission — `Admission` is purely additive, runs once at the very start, and every
existing phase (`ProposalAuthors` through `Receipt`) is otherwise byte-for-byte unchanged except
for the new `--renew` calls at existing phase boundaries. Both workflow mirrors and the new script
mirror stay byte-identical via the existing vendor-sync mechanism.

### Risks

- **Stale-lease/staleness-window miscalibration** — too short falsely steals a live lease from a
  legitimately slow highRisk run (false contention); too long delays legitimate recovery after a
  real crash (reintroducing the M196 duplicate-generation defect this task exists to close).
  Mitigated by the corrected 300m/360m default plus the `--force-release` escape hatch, and by
  DIR-126-E eventually recalibrating from real data.
- **A `.gitignore` edit is a real touch not in the task's originally-declared `## Touches` list** —
  flagged here; this child's own Plan phase must add it explicitly, consistent with the existing
  convention that a Plan whose checked touch set exceeds the declaration updates the declaration.
- **New dispatch-pattern class risk** — mitigated by following the established `wiring-coverage-
  check.ts` dispatch shape exactly (pure function + CLI wrapper + `agent()`-dispatched invocation,
  verdict merged by the script, not trusted from LLM prose); no new class is introduced.

### Non-goals

Not a distributed or multi-host lock. Not touching `execute-milestone.js`'s separate,
CLAUDE.md-documented manual worktree/concurrency discipline — out of scope, scoped to
`prepare-milestone` specifically. Not building DIR-124's full four-mechanism durable
lease/scheduler contract (SQLite-backed, cross-workspace) — only the explicitly-sanctioned
atomic-directory prototype tier. Not implementing DIR-126-B's preflight checks, DIR-126-C's resume
logic, DIR-126-D's telemetry, or DIR-126-E's capacity report — those are the later children's own
scope, even though B shares this child's new module.

## Plan

N/A — directive-class child resolved via a human-steered milestone (matching the DIR-119-D1
sibling pattern's own convention for the first child in an ordered split).

## Finding

Real, code-level evidence gathered 2026-07-29 in the M199 `prepare-milestone` dispatch that
reconciled DIR-126's own Proposal and recommended this split:

1. `grep -n "fs\.\|^import"` on `.claude/workflows/prepare-milestone.js` confirms zero filesystem
   or import statements — no admission/ownership check exists anywhere in the script today.
2. `grep -n "phase("` confirms the script begins directly at `phase('ProposalAuthors')` (or skips
   to `ProposalReview` under resume) with no preceding gate.
3. DIR-126's own Finding measured two overlapping M196 generations for the same task adding ~54
   duplicate workflow-minutes — the concrete real-world cost this child closes.
4. `gate-event-store.ts` and `frontmatter-store-base.ts` (`withFileLock()`) confirm a real, existing
   `wx`-atomic-create precedent already used in this codebase for exactly this class of problem.

## Requested action

1. Add `prepare-admission-check.ts` (+ `plugin/scripts/` mirror) implementing
   `acquireLease`/`renewLease`/`releaseLease`/`checkStaleOwner` per the Chosen mechanism above, with
   a CLI wrapping them (`--acquire`/`--renew`/`--release`/`--force-release <reason>`).
2. Add the new `Admission` phase to `prepare-milestone.js` (both mirrors), dispatched before
   `phase('ProposalAuthors')`, unconditionally (including under `resumeFromAdjudicatedProposal`).
3. Add `--renew` calls at every existing phase boundary (`Adjudicate`, each `ProposalReview` delta
   round, `PlanAuthor`, each `PlanCheck` round, `Receipt`).
4. Add a real test file (`experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`
   + `plugin/test/` mirror) covering: RED/GREEN concurrent-dispatch (second attempt returns
   `prepare-already-running` before its own first agent dispatch), stale-lease reclaim, crash/
   restart recovery, renewal-at-every-boundary, and the corrected 300m/360m staleness windows.
5. Add the `.quay/prepare-leases/` gitignore line.
6. Real regression proof: two real concurrent `prepare-milestone.js` dispatches for the same fixture
   task, captured journal evidence showing exactly one reaches `ProposalAuthors` and the other
   returns `prepare-already-running` with zero author agents dispatched.

## Acceptance Criteria

- [ ] **Most important — real production wiring, not agent-prompt guidance:** a grep/import-graph
  check shows `prepare-admission-check.ts`'s `--acquire` mode has a REAL production callsite from
  `prepare-milestone.js`'s (both mirrors) new `Admission` phase, dispatched before
  `phase('ProposalAuthors')` — not zero importers, not `--selftest`-only reachability. This item
  alone, if unmet, fails the whole child regardless of how many other items pass.
- [ ] **Single-flight RED/GREEN:** two real concurrent `prepare-milestone.js` dispatches for the
  same fixture task prove, via real journal evidence, that exactly one reaches its first
  `ProposalAuthors` agent dispatch and the other returns `prepare-already-running` before any
  author agent is spent — not just the returned code, the dispatch-count ordering. Different task
  IDs remain independently runnable (a real concurrent dispatch for a different taskId is
  unaffected).
- [ ] **Lease recovery is fail-closed:** an active (non-expired) owner cannot be stolen by a second
  attempt; a fixture with a genuinely dead/stale owner (fake clock advanced past the staleness
  window) recovers deterministically with `recoveredFrom` evidence recorded; a crash/restart
  fixture (lease acquired, never released, clock advanced) leaves no permanent lockout.
- [ ] **Renewal-at-every-phase-boundary is proven, not merely asserted:** a synthetic long-running
  generation with mocked phase timestamps proves the lease survives via renewal across every
  existing phase boundary; a genuinely-stalled generation with no renewal call for one whole phase
  is reclaimed by a second dispatch.
- [ ] **Staleness window is the corrected, derived value:** `300` minutes ordinary / `360` minutes
  highRisk, verified via source read against the derivation in Chosen mechanism above (ProposalReview
  budget + PlanAuthor allowance + 3 safety-margined PlanCheck rounds + Receipt buffer) — not the
  original, contradicted 90/150 figures.
- [ ] Every terminal `return` in `prepare-milestone.js` (`prepared`, `needs-human`,
  `revision-needed`, and the new `prepare-already-running` contention outcome) is confirmed, via
  source read, to invoke `--release`.
- [ ] Canonical and `plugin/` mirrors of `prepare-admission-check.ts`, `prepare-milestone.js`, and
  their test files are byte-identical — `cmp`/`sync-vendor.sh --check`, not merely asserted.
- [ ] `.quay/prepare-leases/` is gitignored — verified via `git check-ignore`.

- [ ] **Grounding evidence for the Problem-framing/Chosen-mechanism claims above (added for
  wiring-coverage completeness):** confirmed via direct source read —
  `.claude/workflows/prepare-milestone.js` (byte-identical to `plugin/workflows/` mirror per `cmp`)
  today has no `fs`/`import` statements, begins at `phase('ProposalAuthors')` (or, under
  `resumeFromAdjudicatedProposal`, skips to `ProposalReview`) with no `(workspace, taskId)`
  ownership check, and two concurrent dispatches race `ProposalAuthors`/`Adjudicate`/`task_write`
  today. This child's real, production-wired fix: `prepare-milestone.js` gains a new `Admission`
  phase dispatching `agent()` running `prepare-admission-check.ts --acquire` before
  `phase('ProposalAuthors')`; every terminal `return` (prepared/needs-human/revision-needed/
  contention) invokes `--release`; renewal (`--renew`) fires at every phase boundary
  (`Admission`/`Adjudicate`/`ProposalReview`/`PlanAuthor`/`PlanCheck`/`Receipt`), extending
  `leaseUntil` from the caller-reported `nowMs` (via `date +%s%3N`, never `Date.now()`, matching
  the existing sandbox constraint) — confirmed real and non-`--selftest`-only via the production-
  callsite AC item above.

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply. Per DIR-026
Reading A, source code, prompt text, or a same-generation self-test are necessary but insufficient.

- [ ] Landed on `master` under human-steered discipline (this touches
  `.claude/workflows/prepare-milestone.js`, the control-plane script every future milestone's
  Prepare stage runs through).
- [ ] A real, non-fixture two-concurrent-dispatch proof is exercised end to end with journal output,
  not asserted.
- [ ] RED/GREEN evidence exists for both the stale-lease-reclaim case and the crash/restart case.
- [ ] A fresh independent audit confirms the real production callsite from `prepare-milestone.js`'s
  `Admission` phase, not merely unit-test reachability.

## Human verification when exp5 marks this DIR done

1. Can two operators still accidentally spend agent time preparing the same task generation?
2. Does a genuinely stale lease recover deterministically, with evidence, and never permanently
   lock out a task?
3. Is the staleness window actually the corrected, derived value — not the original contradicted
   90/150-minute figures?

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts`
- `plugin/scripts/prepare-admission-check.ts`
- `experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs`
- `plugin/test/prepare-admission-check.test.mjs`
- `.gitignore`
