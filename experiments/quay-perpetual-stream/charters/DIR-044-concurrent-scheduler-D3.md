# Charter DIR-044-concurrent-scheduler-D3 — cross-milestone concurrent
# background-subagent execution, dispatched under the D3 behavior-preserving +
# golden-replay discipline with DIR-039 ∥ DIR-042-A as the golden baseline

**Milestone id:** assigned at human dispatch (the next free `M<NN>` at a clean loop window —
this charter is DIR-anchored, NOT loop-numbered, to avoid racing the live `milestone_counter`).
**Surface:** cli / method-infra (adds `scripts/touches-orthogonality-check.mjs` +
`scripts/concurrent-batch-scheduler.mjs` + `scripts/anti-drift-touches-check.mjs`, each
`quay gate`-wrappable per the M39 registry precedent; edits `OUTER-LOOP.md`'s DISPATCH-INNER /
ABSORB blocks to describe the two-level scheduler + serial fan-in).
**Type:** capability-growth (concurrent milestone execution — throughput) + governance-integrity
(the anti-drift HARD check that keeps concurrency from corrupting shared state).
**Source:** `DIR-044` (`tasks/DIR-044.md`, human-authored directive, human-steered removed
2026-07-20 → milestone-candidate; deferred 8 passes M61–M69 as "D3 driver-rewrite class needing a
dedicated scoped dispatch"). This charter IS that dedicated dispatch.
**Charter authored:** 2026-07-21, off-loop per DIR-027. Base commit: `master` HEAD `51906fb`.
**Human-steered:** YES — scope edits `OUTER-LOOP.md` (the loop's own dispatch/ABSORB machinery) AND
adds a concurrent scheduler that changes HOW milestones execute. This is the exact driver-self-rewrite
hazard class the `human-steered` fence excludes from autonomous SELECT (`OUTER-LOOP.md:78-83`).
Executed under that fence's named exception — **the D3 behavior-preserving + golden-replay
discipline** — under explicit human direction for this one dispatched pass. NOT a precedent for
unattended autonomous SELECT to pick up scheduler/driver edits on its own.

## SELECT reasoning
Not a cadence SELECT. `DIR-044` was human-authorized for autonomous SELECT (label flipped 2026-07-20)
but the loop correctly deferred it 8 consecutive passes (M61–M69), each note reading "Still D3
driver-rewrite class (concurrent scheduler, golden-replay mandatory); needs dedicated scoped
dispatch, not the regular cadence." The deferral was RIGHT: a concurrent scheduler that mutates
`OUTER-LOOP.md` + changes execution topology cannot be verified by the normal write→test→gate loop
(the thing being changed is the loop itself). This charter supplies exactly what the 8 defer notes
asked for: a dedicated, human-dispatched, golden-replay-scoped pass.

## The D3 discipline for THIS milestone (the operational core)

Because the subject is the driver's own execution topology, "behavior-preserving" is proven by
**replaying two REAL, already-completed, touches-disjoint milestones as a concurrent batch and
confirming the fan-in reproduces their recorded serial end-state** — not by a fresh unit test alone.

### Step 1 — Freeze the golden baseline (BEFORE any scheduler code)
The oracle is the RECORDED SERIAL OUTCOME of two real completed milestones that were touches-disjoint:

- **Golden pair: `DIR-039` (executed M62) ∥ `DIR-042-A` (executed M59).**
  - `DIR-039` — quay migration/import capability: touched `packages/quay/**` (the `migrate` command)
    + the Backlog.md provider; wrote to scratch dirs only; audit verdict NO REFUTATION FOUND.
  - `DIR-042-A` — generic runner-agnostic DoD gate SET: touched `packages/quay/src/gate/registry.js`
    + a `.quay/gates.yml` consumer shape; audit verdict NO REFUTATION FOUND.
  - **Disjointness (to be re-verified by the Step-2 check, not assumed):** DIR-039's `migrate`/
    provider paths vs DIR-042-A's gate-registry paths do not overlap in source files, and neither
    wrote shared exp5 state (`dashboard.md` / `milestone_counter` / `gate-events.jsonl`) during its
    build — both deferred those to their own ABSORB.
  - **Recorded oracle (frozen at charter time from git + dashboard):** M59 ABSORB `608f091`
    (counter 58→59, DIR-042-A dashboard entry, gate PASS); M62 ABSORB `8b69295` (counter 61→62,
    DIR-039 dashboard entry, backlog regenerated, gate PASS). The golden end-state = **counter
    advanced by 2, both dashboard entries present, both diffs applied, zero merge conflict**, which
    the concurrent path MUST reproduce.
  - Fallback pair if a Step-2 disjointness re-check flags an unexpected overlap: any other recorded
    disjoint completed pair (e.g. `DIR-046` ∥ `DIR-047`); the charter's method is pair-agnostic.

Freeze also the existing selfcheck/fixture suites as the invariant floor: `task-schema-selfcheck`
12/12, `dod-fixture-selfcheck` 17/17, `vmeta-lag-selfcheck`, live `quay gate` demo fixtures — all
must stay green across every increment (golden-diff floor).

### Step 2 — Build increment-by-increment, never mixing prose-delete with semantic-change
Each increment lands with its own mechanical acceptance (RED→GREEN fixture), single-source
(check-logic-as-ONE-script, `quay gate`-wrappable; DUAL-SOURCE GUARD fatal-if-violated):
1. `touches` charter-schema field + `scripts/touches-orthogonality-check.mjs` — computes
   disjoint/overlap for any candidate pair; FLAGS a pair editing the same file, PASSES a disjoint pair.
2. `scripts/concurrent-batch-scheduler.mjs` — greedily assembles a touches-disjoint execution-type
   batch; dispatches ONE native `Agent(run_in_background=true)` build per milestone in its own
   worktree; build writes NO shared exp5 state (all deferred to fan-in).
3. Serial fan-in ABSORB — merges the N completed builds one-at-a-time; counter monotonic +N; dashboard
   entries appended deterministically.
4. `scripts/anti-drift-touches-check.mjs` — the after-the-fact HARD check (Step 5).
Conservative-default: a candidate with absent/ambiguous `touches` is serialized. Learning-type
milestones are NEVER batched (they carry the SELECT←ABSORB learning dependency).

### Step 3 — Golden-milestone replay (the terminal behavior-preservation proof)
Feed the golden pair (Step 1) as a 2-wide batch through the scheduler (Step 2) and the serial fan-in,
then assert the merged repository + ledger end-state EQUALS the frozen serial oracle: **counter +2,
both dashboard entries present, both real diffs applied, NO merge conflict.** This is DIR-044's own
DoD "REAL ≥2-wide orthogonal batch actually RAN via native background subagents and fan-in ABSORBed
cleanly" — instantiated on a recorded pair so the expected end-state is known in advance, not judged
post-hoc. If the concurrent end-state diverges from the serial oracle in ANY of counter / dashboard /
applied-diff / conflict-freedom, the increment is NOT behavior-preserving → send back.

### Step 4 — Never un-halt the live loop to test
The golden-replay runs in a scratch/worktree replay harness against the frozen baseline, NOT by
un-halting the running loop. `.halt` stays in place (or the whole pass runs in a private worktree off
`master`); the live `milestone_counter` is never advanced by the replay. Verified entirely by
fixtures + replay-safe checks, per the D3 precedent (R1–R7 landed "NOT un-halted").

### Step 5 — NON-WAIVABLE anti-gaming guardrails, independently verified before merge
- The anti-drift HARD check (increment 4) must ACTUALLY FAIL a batch where two concurrent milestones
  touched an overlapping file under a mis-declared `touches` — a RED fixture proves the guardrail
  bites; a GREEN fixture (truly disjoint) passes. A guardrail that cannot fail is decorative and
  rejected.
- Native-only: `grep` shows NO manda dispatch in the scheduler (DIR-044's explicit constraint).
- Fresh-context adversarial audit before merge (ADR-005 verification asymmetry): an independent
  subagent that did NOT build the scheduler attempts to refute the golden-replay equality claim and
  the guardrail-bites claim. Any surviving refutation blocks land → `needs-human`. (The D3 lineage
  shows why this is non-negotiable: independent review caught 3 rounds of fail-open bugs in the
  vmeta-lag-check that the builder's own tests passed over.)

## Acceptance Criteria
Mirrors `tasks/DIR-044.md`'s own 5 Acceptance Criteria EXACTLY (single-source — the task is canonical;
do not fork them here). In brief, each must be met by the increments above:
`touches` orthogonality check flags/passes correctly · scheduler dispatches N native background builds
with no shared-state write during the parallel phase · serial fan-in merges cleanly (counter +N, both
dashboard entries) on a REAL ≥2-wide batch · anti-drift HARD check fails a mis-declared batch (RED+GREEN)
and conservative-default serializes ambiguous · learning-type never batched, native-only (no manda).

## Definition of Done
References `tasks/DIR-044.md`'s own DoD + the standard `inherited-core.md` clauses (0 AC/DoD present,
1 per-milestone acceptance audit UNCONDITIONAL, 2 V_meta-lag, 3 line-budget, 4 impl-row, 5
no-self-exemption, 6 escrow-Δv, 7 test-floor APPLIES [new method-infra scripts → strict TDD ≥80%],
8 task canonical-lifecycle-record, 9 split-or-commit). The bar is REAL LANDING: a real 2-wide
concurrent batch (the DIR-039 ∥ DIR-042-A golden replay) actually ran via native background subagents
and fan-in ABSORBed to the frozen serial end-state, with the anti-drift guardrail proven to bite.
No task-specific exemption from any clause.

## Value hypothesis
- Value type(s): **capability-growth** (concurrent milestone execution — the throughput ceiling exp5
  hits running strictly serial) + **governance-integrity** (anti-drift HARD check on shared state).
- **Δv̂:** no VT chart cell expected (method-infra/driver-topology, mirrors the DoD-program lineage's
  no-VT-cell precedent); value measured by the golden-replay equality result + the guardrail RED test.

## In scope
- The `touches` schema field + the three scripts (orthogonality / scheduler / anti-drift), each
  single-source and `quay gate`-wrappable.
- The `OUTER-LOOP.md` DISPATCH-INNER / ABSORB edits describing the two-level scheduler + serial fan-in
  (prose→behavior edit, under golden-diff: every uncoded invariant in those blocks preserved, verified
  LOSSLESS by independent review).
- The golden-replay harness that runs DIR-039 ∥ DIR-042-A against the frozen oracle.

## Explicitly OUT of scope
- The per-iterate dispatch/audit knobs of [[DIR-048]] (that is single-milestone execution topology;
  this is CROSS-milestone batching — orthogonal directives, do not fold together).
- Migrating exp5's OUTER-LOOP wholesale onto the portable loop-driver skill.
- manda (native-only, hard constraint).
- Any real un-halted concurrent run advancing the live counter (Step 4 fence).
- Learning-type milestone batching (always serial).

## Increment plan (SPLIT-OR-COMMIT, DIR-026)
Each increment is done-or-`needs-human`; the parent is done only when the golden replay lands.
1. `touches` schema + orthogonality check (RED+GREEN) — smallest, unblocks the rest.
2. scheduler + native background dispatch (no shared-state write in parallel phase).
3. serial fan-in ABSORB (counter +N, deterministic dashboard append).
4. anti-drift HARD check (guardrail-bites RED fixture) + conservative-default.
5. golden replay of DIR-039 ∥ DIR-042-A against the frozen oracle + fresh-context adversarial audit.

## it0 checks (run at charter-authoring time, before dispatch)
- `scripts/task-schema-check.sh tasks/DIR-044.md` → must PASS before dispatch (fix the task, not the
  script).
- Size/ceiling: multi-increment; ≤2000-line ceiling applies per increment, not the sum — Step-2's
  increment boundaries are the split points; resize/split at dispatch if any single increment exceeds.
- Enforcement-with-design (ADR-011): each new rule ships with its executable check in the SAME
  increment (the orthogonality rule ships with its script; the anti-drift rule ships with its RED
  fixture) — never a designed-not-wired half.

## Note for ABSORB
This milestone's own audit-independence is contestable (it builds the very dispatch/audit machinery):
the fresh-context adversarial audit (Step 5) MUST be dispatched from the TOP-LEVEL session to a
generic `Explore`/`general-purpose` subagent that did not build the scheduler, and its verdict on the
golden-replay equality + guardrail-bites claims recorded verbatim. If dispatch of an independent
auditor is impossible, that BLOCKS `milestone_counter++` (no self-audit license). DIR-027 loop-on-master
hygiene held throughout: authored off-loop at `51906fb`; land via ff-merge at a clean window.

## Dispatcher notes
- Human dispatch only. Pause the loop (`.halt`) OR run the whole pass in a private worktree off
  `master`; never race the live loop (which is at M72+ and incrementing).
- Assign the concrete `M<NN>` at dispatch from the then-current `milestone_counter`, and rename this
  charter file to `M<NN>-dir044-concurrent-scheduler.md` at that time (matching the loop's naming).
- The golden baseline commits (`608f091` M59, `8b69295` M62) are frozen references — capture their
  end-state into the replay harness at Step 1 so the oracle cannot drift as `master` advances.
