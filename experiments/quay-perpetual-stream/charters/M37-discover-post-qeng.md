# Charter M37-discover-post-qeng — discovery pass: new QENG gate/lifecycle
# engine surface + STALE-row re-triage

**Milestone id:** M37-discover-post-qeng · **surface:** cross-cutting (discovery, produces new
`milestone-candidate` tasks; touches no product code itself) · **type:** explore, discovery
**Source:** m36 ABSORB's own explicit m37 DRAIN/SELECT note (`dashboard.md`, "ABSORB m36" entry) —
`directives/pending/` is empty (DIR-017 archived this DRAIN step) and `backlog.md` has zero open
(non-DONE, non-STALE) candidates. Per that note, m37 SELECT must not silently default; it must
explicitly choose between (a) re-examining the 3 STALE rows, or (b) running a fresh discovery
milestone. **This charter chooses (b), while folding (a) in as an explicit sub-task**, for the
reason given below.
**Charter authored:** m36→m37 boundary, 2026-07-19. Base commit: `exp5-outer-driver` HEAD `e4c29f5`
(post-DIR-017-archival, post-QENG-sync, confirmed via `git rev-parse exp5-outer-driver`).

## SELECT reasoning
Two candidate paths named in the m36 ABSORB note:
- (a) Re-examine the 3 STALE rows (`exp5-M-CLI-UX`, `exp5-M-DIRTASK`, `exp5-M-DOCS`) — all three are
  backfilled artifacts from the M13/M24 one-time migration pass (pre-M25, i.e. predating the entire
  DoD-program lineage and 12+ milestones of stream maturity). Their `## Source` fields point at
  exp4-era gap-lists and an already-resolved DIR-006 question.
- (b) Run a fresh discovery-typed milestone (mirrors M04/M26/M27/M28's own discovery-channel
  precedent) whose purpose is to generate new forward-looking candidates from the CURRENT state of
  the stream and codebase, not stale exp4-era gap-lists.

**Chosen: (b), with (a) folded in as in-scope item 3.** Reasoning: since the m35→m36 boundary was
last examined, a large ASYNC human-authored initiative (QENG-0..5, "epicd-engine-port", 17 commits,
33 files, ~4314 insertions) landed directly on `master` and was synced into `exp5-outer-driver` at
this m37 DRAIN step. It ships a real, non-trivial new product surface — `packages/quay/src/gate/*.js`
(`engine.js`, `lifecycle.js`, `acceptance-runner.js`, `registry.js`, `driver.js`, `gate-event-store.js`,
`gate-log.js`) — including a new `quay gate <task>` / `quay complete` CLI invocation path that wraps
DoD-check-style gating with a machine-logged `GateEvent`, and an "AC-as-runnable-meter" mechanism
(`quay gate` runs `task.extra.acceptance`). This surface has never been touched by any exp5 milestone
— it is exactly the kind of "new, real, unexamined product surface" that M04/M26/M27/M28's discovery
channel exists to survey before further exp5 method-infra work (including possibly exp5's own
`it0-*` scripts) assumes anything about it. Re-triaging 3 old STALE rows without first looking at this
new surface risks anchoring m38+ SELECT on stale exp4-era gaps while a fresh, large, already-shipped
product initiative sits unexamined. Both paths are therefore folded into one milestone: discovery
sweep over the new QENG surface (primary), STALE-row re-triage (secondary, cheap, in scope).

## Acceptance Criteria
- [ ] The new `packages/quay/src/gate/*.js` surface (QENG-0..5) is functionally surveyed: what each
  module does, what `quay gate <task>` / `quay complete` actually do end-to-end (read the code AND
  exercise it directly — do not just read commit messages), and what test coverage exists (QENG
  commit messages claim "TDD, cov 100%" for several — independently verify this claim against the
  actual test files/coverage output, do not take it on faith).
- [ ] At least 2, and no more than 6, new `milestone-candidate` tasks are authored (unchecked AC/DoD
  checklists per DIR-020/M34 convention) capturing genuine, concrete gaps or opportunities found in
  the QENG surface survey — e.g. missing negative-path tests, an inconsistency between `quay gate`'s
  behavior and `it0-dod-check.sh`'s, a UX gap in the CLI surface, a real defect. Do NOT manufacture
  busywork candidates merely to hit a count — if the survey finds fewer than 2 genuine gaps, say so
  explicitly and author fewer (the floor is a target, not a mandate to invent make-work).
- [ ] Each of the 3 STALE rows (`exp5-M-CLI-UX`, `exp5-M-DIRTASK`, `exp5-M-DOCS`) is explicitly
  re-examined against current state and re-dispositioned: either confirmed still STALE (with a
  current-state reason, not just re-asserting the backfill-era reason) or un-staled back to an open
  candidate (if the underlying gap is confirmed to still be real and worth doing).
- [ ] A specific, reasoned recommendation is given on whether/how exp5's own `it0-dod-check.sh` /
  `it0-*` mechanical gates should relate to the new `quay gate` engine route — e.g. remain
  independent-and-parallel (current state, per `OUTER-LOOP.md`'s additive QENG-5 sub-note), be
  unified, or something else — with the tradeoffs stated, not just a bare opinion.
- [ ] Findings are written up in the report with direct evidence citations (file:line, command
  output), not summarized secondhand from commit messages.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware], 1 per-milestone acceptance audit [unconditional], 2 V_meta-lag, 3 line-budget, 4
impl-row — N/A, this milestone produces new candidate tasks, not a `-IMPL` follow-up of its own work,
5 no-self-exemption, 6 escrow-Δv — N/A, this is discovery/design output (new tasks), not itself a
design-only implementation of a specific feature; re-confirm at ABSORB whether this framing holds, 7
test-floor — N/A, `surface:cross-cutting`/discovery, this milestone reads and evaluates code but does
not modify `packages/quay*` product files itself; re-confirm via `git diff --stat` at ABSORB). No
task-specific exemption from any clause.

## Value hypothesis
- Value type(s): **explore / discovery** (primary) — surveys a new, real, already-shipped product
  surface and produces new forward-looking `milestone-candidate` tasks; mirrors M04/M26/M27/M28's own
  discovery-channel precedent and Δv treatment.
- **Δv̂:** ≈0 (discovery/method-infra, no VT chart cell — mirrors M04/M26/M27/M28's own established
  no-VT-cell precedent for discovery-channel milestones). Any Δv from the NEW candidate tasks this
  milestone produces accrues later, when those candidates are themselves SELECTed and delivered — not
  here.
- Metric `Y`: the task's 4 Acceptance Criteria, verbatim (see task file to be authored).

## Current-state notes (re-verified directly against source at charter-authoring time)
- `git log --oneline -20 -- packages/quay/src/gate` at charter time shows 5 QENG commits: QENG-1
  (gate engine + GateEvent log), QENG-2 (AC-as-runnable-meter, `quay gate` runs
  `task.extra.acceptance`), QENG-3 (complete/adjudicate/promote/retreat lifecycle), QENG-4 (`quay run`
  driver — autonomous loop as code), QENG-5 (final convergence commit, "all epic ACs met, all children
  done").
- `packages/quay/src/gate/` contains 7 files: `acceptance-runner.js`, `registry.js`, `engine.js`,
  `lifecycle.js`, `gate-log.js`, `driver.js`, `gate-event-store.js`.
- `OUTER-LOOP.md` step 6's DoD meta-enforcer gate paragraph already gained a purely-additive "Engine
  route (QENG-5 / epicd-engine-port)" sub-note (confirmed non-conflicting at m37 DRAIN sync) —
  describing `quay gate <task>` as an alternative invocation path to the bare `it0-dod-check.sh` prose
  call. This milestone's 4th AC item builds directly on that existing sub-note.
- `backlog.md` (regenerated post-DIR-017-archival): 27 rows, all DONE/STALE, zero open candidates —
  confirms no competing open work this DRAIN/SELECT boundary.

## In scope
1. Read and functionally exercise the QENG gate engine surface end-to-end (not just read the code):
   run `quay gate <task>` and/or `quay complete` against a real or synthetic task, observe the
   `GateEvent` log output, confirm the AC-as-runnable-meter mechanism actually executes
   `task.extra.acceptance`.
2. Independently verify (not take on faith) the "TDD, cov 100%" claims in the QENG commit messages —
   locate and run the actual test suite for `packages/quay/src/gate/`, check real coverage output.
3. Re-triage the 3 STALE backlog rows against current state (see AC item 3).
4. Author 2-6 new `milestone-candidate` tasks (unchecked AC/DoD checklists) for genuine gaps/
   opportunities found, following the DIR-020/M34 checklist-authoring convention.
5. Give a reasoned recommendation on exp5's own `it0-*` checks' relationship to the new `quay gate`
   engine route (AC item 4).

## Explicitly OUT of scope
- Implementing any fix for gaps found — this is a discovery/survey milestone; fixes become their own
  future `milestone-candidate` tasks, SELECTed later like any other backlog row.
- Modifying `packages/quay/src/gate/*.js` or any other product file directly.
- Migrating exp5's own `it0-*` scripts to route through `quay gate` — the AC only asks for a
  reasoned recommendation, not an implementation of it.
- Exhaustive re-audit of the entire QENG initiative's own commit history/process — the survey is
  scoped to the SHIPPED surface's current functional state, not a retrospective of how QENG-0..5 was
  built.

## Done-when (binary clauses)
Mirrors the task's 4 Acceptance Criteria exactly (task file to be authored as
`tasks/exp5-M-DISCOVER-POST-QENG.md`) plus:
1. QENG gate engine surface functionally exercised with direct command-output evidence in the report.
2. Test-coverage claims independently checked, not restated from commit messages.
3. All 3 STALE rows re-dispositioned with a current-state reason each.
4. 2-6 new genuine `milestone-candidate` tasks authored, each with real AC/DoD checklists.
5. A reasoned `it0-*`-vs-`quay gate` recommendation given with tradeoffs stated.
6. `git diff --stat` confirms no `packages/quay*` product files modified by this milestone itself
   (survey/discovery only).

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131 for the full literal text; both dispatched iteration prompts must include it verbatim):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)
gate-hash-by-reference mode: `it0-gate-hash-check.sh --by-reference` against this charter file, run
immediately before dispatch and re-confirmed unchanged. The manda healthz gate and port-4173
reachability gate are N/A this milestone (no Web UI surface touched) — state N/A explicitly in each
iteration's report, do not silently omit.

## it0 checks (run at charter-authoring time, before dispatch)
- `it0-ceiling-line-budget-check.sh` against this charter: 5 in-scope items — discovery-typed, at or
  near the small-milestone threshold; re-confirm before dispatch.
- `it0-impl-row-check.sh`: N/A — this milestone's own output IS new backlog rows, not a `-IMPL`
  follow-up of a design-only artifact; re-confirm at ABSORB that this framing was not used to dodge a
  genuine escrow obligation.

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
Dispatch a fresh-context, out-of-band adversarial-audit subagent at ABSORB, refute-first stance
against this task's 4 AC clauses + DoD. Given this is a discovery milestone, the audit should
specifically probe: (a) did the iteration actually RUN `quay gate`/`quay complete` and the QENG test
suite (direct command output in the report), or just describe the code from reading it? (b) are the
2-6 new candidate tasks genuine (a fresh read of the gate engine code, independently checked against
each new task's claimed gap) or padding/busywork? (c) is the STALE-row re-triage reasoning
current-state-grounded, not just re-asserting the old backfill-era text? Per DIR-020/M34/M35's
standing write-back mechanism, the audit ticks `- [x]` on each AC/DoD checklist item it confirms, with
an inline evidence citation per item.

## Note for ABSORB
1. Confirm no `packages/quay*` product files were touched by this milestone's own diff (discovery
   only) — re-verify via `git diff --stat`, do not assume from this charter.
2. If the two iterations propose different sets of new candidate tasks, reconcile on the merits — do
   not simply union both sets uncritically; each proposed candidate must independently justify itself
   against the actual QENG code, same discipline as M32/M36's numeric reconciliations.
3. Confirm `backlog.md` gains the new candidate rows via `it0-backlog-regen.mjs --write` after the new
   task files are authored and committed.
4. Checkpoint cadence: **not due at this milestone's ABSORB.** `milestone_counter` becomes **37** at
   this ABSORB (m36 set it to 36) — the next checkpoint is due at `milestone_counter=40`.

## Dispatcher notes
Dispatch two independent `baime:iteration-executor` agents off this charter's base commit
(`experiments/quay-perpetual-stream/milestones/M37-discover-post-qeng/worktrees/iteration-{0,1}`,
branches `exp5-m37-iteration-{0,1}`). Iteration-1 must NOT read iteration-0's materials
(independent-verification discipline). Discovery milestones are open-ended by nature — the two
iterations may surface different candidate tasks or different STALE-row dispositions; do not assume
convergence. If they diverge meaningfully, reconcile on the merits (mirrors M32/M36's precedent).
