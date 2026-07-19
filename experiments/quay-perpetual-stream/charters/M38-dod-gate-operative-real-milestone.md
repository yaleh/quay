# Charter M38-dod-gate-operative-real-milestone — DIR-021 Layer 1: make the
# DoD gate OPERATIVE on a REAL milestone via `quay gate`

**Milestone id:** M38-dod-gate-operative-real-milestone · **surface:** method-infra (this milestone's
own ABSORB is the first real, non-fixture exercise of the change; touches `OUTER-LOOP.md` prose +
one real milestone task's `extra.acceptance`, not `packages/quay*` product code) · **type:**
governance-integrity, explore (self-referential: this charter, at ITS OWN ABSORB, becomes the first
real milestone gated through `quay gate`)
**Source:** `DIR-021` (`experiments/quay-perpetual-stream/directives/pending/DIR-021-layer1-dod-gate-operative-on-real-milestones-via-quay-gate.md`,
`tasks/DIR-021.md`) — human-authored, landed on `master` async during M37, synced into
`exp5-outer-driver` at m37→m38 DRAIN (fast-forward, commit `54ae799`+).
**Charter authored:** m37→m38 boundary, 2026-07-19. Base commit: `exp5-outer-driver` HEAD `6c354ed`
(post-M37-ABSORB-publish-sync, post-`exp5-M-QENG-DOD-DEMO-ONLY`-supersession-note, confirmed via
`git rev-parse exp5-outer-driver`).

## SELECT reasoning
`directives/pending/` contains 4 new directives (`DIR-021`..`DIR-024`) forming an explicit ordered
4-layer program for migrating exp5 onto the quay engine (Layer 1: operative DoD gate on real
milestones → Layer 2: migrate remaining exp5 gates → Layer 3: lifecycle/`quay run` adoption → Layer 4:
`quay gate-log` as queryable audit trail). `backlog.md` also carries 6 open candidates from M37's own
discovery survey (`exp5-M-GATE-CLI-ARG-ORDER`, `exp5-M-GATE-CLI-ERROR-UX`,
`exp5-M-GATE-HELP-SYNOPSIS-GAP`, `exp5-M-GATE-README-DOCS`, `exp5-M-GATE-MCP-PARITY-GAP`), plus 3
STALE rows (confirmed still STALE at M37, not re-selected).

**Chosen: DIR-021.** Reasoning, explicit not defaulted (mirrors the DIR-017/019/020-over-backlog
precedent):
1. DIR-021 is a **human-authored, directly-actionable directive**, freshly available in
   `directives/pending/` for the first time since m36 (DIR-017 cleared at m36→m37 DRAIN). Per
   `OUTER-LOOP.md` step 1's own SELECT ordering, pending human directives take priority over
   self-generated backlog candidates when present and actionable — this has been the standing
   practice at every DRAIN/SELECT boundary where a pending DIR existed (M25/M30/M32/M34/M36).
2. DIR-021 is **Layer 1 of an explicit ordered program** (`DIR-021`→`022`→`023`→`024`, each
   depending on the prior per their own titles: Layer 2 "migrate remaining gates" presupposes Layer
   1's `quay gate` invocation path is real; Layer 3 "lifecycle adoption" presupposes Layer 2; Layer 4
   "gate-log as audit trail" presupposes there are real GateEvents to query). Selecting Layer 1 first
   is the only order that does not strand later layers.
3. DIR-021 closes a **self-disclosed shelfware risk**: QENG-0's own "Progress" note already named
   "broaden the wiring so a resumed exp5 loop drives ALL its gates/milestones via
   `quay gate/complete/run`" as remaining forward work, and M37's own discovery survey independently
   confirmed (AC item 4 of `exp5-M-DISCOVER-POST-QENG`) that 0 real milestone tasks carry
   `extra.acceptance` — only the 2 `QENG-5-DEMO-*` fixtures do. `exp5-M-QENG-DOD-DEMO-ONLY` (the M37
   candidate task naming the identical gap) has been marked `superseded` by DIR-021 (see its own
   "Superseded" section, 2026-07-19) rather than run in parallel — DIR-021 is the more complete,
   ordered, canonical version of the same finding.
4. The 6 M37-produced candidates remain open in `backlog.md` for a future SELECT; two of them
   (`exp5-M-GATE-CLI-ARG-ORDER`, `exp5-M-GATE-CLI-ERROR-UX`) touch overlapping CLI-parsing code paths
   in `bin/quay.js` and are better sequenced AFTER this milestone's own real exercise of `quay gate`
   (this milestone will itself run `quay gate <real-task>` repeatedly at ABSORB — if the flag-order
   bug or a raw-stack-trace UX issue is hit live during that exercise, it strengthens rather than
   duplicates those candidates' evidence; if not hit, they remain independently valid future work).

## Acceptance Criteria
- [ ] `quay task view <a-real-exp5-M-milestone> --json` shows a non-empty `extra.acceptance` for a REAL
  milestone task (not `QENG-5-DEMO-*`) — set via `quay task edit <id> --acceptance '<cmd>'`, no new
  quay code required (per DIR-021's own "Requested action" item 1). The seeded command is
  `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh <task-id> <charter-file>
  <absorb-entry-file>` (repo-root-relative; the acceptance runner's cwd = workspaceRoot = repo root).
- [ ] `quay gate <that-real-milestone-task>` exits 0 or 1 matching that milestone's actual DoD verdict
  (i.e. it is invoked for real, at this milestone's OWN ABSORB, not a synthetic/dry-run), AND
  `quay gate-log <that-real-milestone-task> --json` returns a GateEvent for it.
- [ ] `grep -nE "quay (gate|complete)" experiments/quay-perpetual-stream/OUTER-LOOP.md` shows the
  step-6 DoD sub-step's OPERATIVE "run/confirm" instruction naming `quay gate`/`quay complete
  <milestone-task>` as the primary invocation (not only the bare `it0-dod-check.sh` line, and not
  only the existing additive "Engine route" side-note — the side-note framing must be promoted to the
  primary instruction).
- [ ] The **REAL LANDING bar** from DIR-021's own Definition of Done is met: THIS milestone
  (M38-dod-gate-operative-real-milestone) is itself the real, non-fixture milestone gated through
  `quay gate` at its own ABSORB — verifiable by (a) a GateEvent keyed to
  `exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE`'s task id in `quay gate-log`, and (b) THIS milestone's own
  dashboard ABSORB entry pasting the `quay gate` command output as the DoD-gate evidence (replacing
  the bare `it0-dod-check.sh` paste used at every prior milestone m01-m37).
- [ ] The chicken/egg ABSORB-ordering problem (the `<absorb-entry-file>` argument does not exist yet
  at the moment `extra.acceptance` is seeded at SELECT time, since the ABSORB narrative is drafted
  live) is explicitly addressed: confirm the resolution DIR-021 implies — the acceptance command
  references a FILE PATH (e.g. `/tmp/m38-absorb-entry.md`, the same extraction pattern already used
  for every prior `it0-dod-check.sh` invocation since M25) that is written immediately before
  `quay gate` is invoked, not baked in as literal text at SELECT time. Document this ordering
  explicitly in the report — do not leave it implicit.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware], 1 per-milestone acceptance audit [unconditional], 2 V_meta consolidation-lag, 3
line-budget, 4 impl-row — N/A, this milestone's own output is the wiring change and its real-landing
proof, not a design doc awaiting a future `-IMPL`, 5 no-self-exemption, 6 escrow-Δv — N/A, not
design-only, 7 test-floor — N/A, this milestone touches `OUTER-LOOP.md` prose and task metadata
[`extra.acceptance`], not `packages/quay*` product code; re-confirm via `git diff --stat` at ABSORB).
No task-specific exemption from any clause.

**Self-referential note:** this milestone's own DoD gate (Clause "DoD meta-enforcer gate" at ABSORB)
is the FIRST one required to actually route through `quay gate <this-milestone-task>` rather than the
bare `it0-dod-check.sh` shell call every prior milestone used — because meeting this milestone's own
AC requires it. If `quay gate` cannot successfully be invoked as the actual HARD-BLOCK mechanism for
THIS milestone's own `milestone_counter++`, the AC has not been met regardless of what prose claims
otherwise; ABSORB must not fall back to the bare `it0-dod-check.sh` call as a substitute and then
claim the AC anyway.

## Value hypothesis
- Value type(s): **governance-integrity** (primary — closes a self-disclosed shelfware risk, makes the
  DoD gate mechanism real rather than demo-only) + **explore** (secondary — the chicken/egg
  ABSORB-ordering resolution is a genuine design question, not pure mechanical wiring).
- **Δv̂:** small-to-moderate, no VT chart cell (mirrors the DoD-program lineage's own no-VT-cell
  precedent — M25/M32/M36 all method-infra, no VT points). Real value: prevents "the engine is wired"
  from being cited as true when only 2 static fixtures have ever exercised it: after this milestone, at
  least 1 real milestone (itself) will have a real GateEvent trail.
- Metric `Y`: the task's 5 Acceptance Criteria, verbatim (see task file to be authored).

## Current-state notes (re-verified directly against source at charter-authoring time)
- `grep -l "acceptance:" tasks/*.md` at charter time: only `QENG-5-DEMO-PASS.md`, `QENG-5-DEMO-FAIL.md`
  (plus unrelated `QENG-4.md`) carry `extra.acceptance` — confirmed 0/15+ real `exp5-M-*` tasks have it
  (M37's own finding, independently re-confirmed here).
- `quay task edit --acceptance <cmd>` already exists and works (QENG-2, `bin/quay.js` line 233/570-693)
  — no new quay code is needed for AC item 1.
- `OUTER-LOOP.md` step 6 (lines 307-340) already has the additive "Engine route" sub-note (lines
  323-332) describing `quay gate <milestone-task>` as an alternative path — but the PRIMARY
  instruction at line 316 is still `scripts/it0-dod-check.sh <milestone-id> <charter-file>
  <absorb-entry-text-or-file>` as a bare shell call. This charter's AC item 3 requires promoting the
  engine route to primary, not merely leaving it as a side-note.
- `quay gate <id>` defaults to the `acceptance` gate (`bin/quay.js` line 804-809,
  `flags.gate ?? "acceptance"`), which runs `task.extra.acceptance` via the acceptance-runner —
  confirmed this is the correct default for a DoD-check-shaped command (no `--gate dod` flag required
  unless a task registers a named `dod` gate specifically).
- `it0-dod-check.sh`'s established real convention (discovered/confirmed at M37 ABSORB) takes the
  **task id** as its first argument, not the milestone id — this charter's seeded `extra.acceptance`
  command must use `exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE` (the task id to be authored), not
  `M38-dod-gate-operative-real-milestone` (the milestone id).

## In scope
1. Author this milestone's own task (`exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE`) and seed its
   `extra.acceptance` via `quay task edit` per AC item 1 — this is itself "a real milestone", making
   this milestone self-referentially the first real proof case (see DIR-021's own Definition of Done:
   "a REAL exp5 milestone... has actually been gated through `quay gate`/`quay complete` at its own
   ABSORB").
2. At THIS milestone's own ABSORB, invoke `quay gate exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE` as the
   actual DoD meta-enforcer gate (replacing the bare `it0-dod-check.sh` shell call used at every prior
   milestone), and cite the `quay gate` output + `quay gate-log --json` GateEvent directly in this
   milestone's dashboard ABSORB entry.
3. Update `OUTER-LOOP.md` step 6's DoD meta-enforcer gate paragraph so the `quay gate`/`quay complete
   <milestone-task>` invocation is the PRIMARY documented instruction (the existing "Engine route"
   sub-note's content is preserved/merged in, not deleted).
4. Explicitly resolve and document the chicken/egg ABSORB-ordering question (AC item 5) — the seeded
   `extra.acceptance` command must reference a FILE PATH for the ABSORB-entry argument, written
   immediately before `quay gate` is invoked at ABSORB time, mirroring the existing
   `/tmp/m<NN>-absorb-entry.md` extraction pattern already used for every `it0-dod-check.sh` call since
   M25.

## Explicitly OUT of scope
- Layers 2-4 (`DIR-022`/`023`/`024`) — migrating the OTHER exp5 gates (adversarial-audit, V_meta-lag,
  impl-row, escrow-Δv, test-floor, line-budget) to run through the engine; adopting `quay run` as the
  driver; making `quay gate-log` the queryable audit-trail source for dashboard ABSORB entries beyond
  this one milestone's own citation. These are separate, later-SELECTed milestones per DIR-021's own
  scope boundary and the ordered-program structure.
- Seeding `extra.acceptance` on any OTHER real milestone task retroactively (M01-M37) — DIR-021's bar
  is "at least one REAL milestone", satisfied by this milestone itself; broader retroactive backfill is
  out of scope unless a future milestone chooses to do it.
- Modifying `packages/quay/src/gate/*.js` engine code itself — this milestone is a wiring/adoption
  change, not an engine-code change (no known engine defect motivates one here).

## Done-when (binary clauses)
Mirrors the task's 5 Acceptance Criteria exactly (task file to be authored as
`tasks/exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE.md`) plus:
1. `extra.acceptance` seeded on this milestone's own real task, command references a file path not
   inline text.
2. `quay gate <this-milestone-task>` actually invoked at this milestone's own ABSORB, GateEvent logged.
3. `OUTER-LOOP.md` step 6 updated: `quay gate`/`quay complete` is the primary instruction.
4. Dashboard ABSORB entry pastes `quay gate` output + `quay gate-log --json` GateEvent as evidence.
5. Chicken/egg ordering resolution documented explicitly in the report.
6. `git diff --stat` confirms no `packages/quay*` product files modified by this milestone itself.

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131 for the full literal text; both dispatched iteration prompts must include it verbatim):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)
gate-hash-by-reference mode: `it0-gate-hash-check.sh --by-reference` against this charter file, run
immediately before dispatch and re-confirmed unchanged. The manda healthz gate and port-4173
reachability gate are N/A this milestone (no Web UI surface touched) — state N/A explicitly in each
iteration's report, do not silently omit.

## it0 checks (run at charter-authoring time, before dispatch)
- `it0-ceiling-line-budget-check.sh` against this charter: 4 in-scope items — small milestone; run
  before dispatch.
- `it0-impl-row-check.sh`: N/A — this milestone's own output is the real-landing proof itself, not a
  design doc awaiting a future `-IMPL` follow-up; re-confirm at ABSORB.

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
Dispatch a fresh-context, out-of-band adversarial-audit subagent at ABSORB, refute-first stance
against this task's 5 AC clauses + DoD. Given this milestone is self-referential (its own ABSORB is
the proof case), the audit should specifically probe: (a) did `quay gate` actually get invoked for
THIS milestone's own ABSORB, with a real GateEvent in `quay gate-log`, or did the loop fall back to a
bare `it0-dod-check.sh` call and merely claim the AC was met? (b) does the seeded `extra.acceptance`
command reference a file path (resolving the chicken/egg problem) rather than literal text baked in
before the ABSORB entry existed? (c) is the `OUTER-LOOP.md` step 6 edit a genuine promotion of
`quay gate` to primary instruction, or just a re-wording that leaves the bare shell call as the actual
operative path? Per DIR-020/M34's standing write-back mechanism, the audit ticks `- [x]` on each
AC/DoD checklist item it confirms, with an inline evidence citation per item — including, critically,
independently re-running `quay gate-log exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --json` itself and
confirming a real GateEvent exists, not merely reading the ABSORB entry's claim.

## Note for ABSORB
1. **Ordering caution (self-referential loop):** the DoD meta-enforcer gate step must invoke
   `quay gate exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE` (the TASK id, established convention) — write
   the ABSORB-entry-excerpt file first (same `awk` extraction pattern used since M25), THEN run
   `quay task edit exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --acceptance '<cmd referencing that file
   path>'` if not already seeded with the correct final path, THEN `quay gate
   exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE`, THEN cite its output + the `quay gate-log --json`
   GateEvent in the dashboard entry. Do NOT run `quay gate` before the absorb-entry file exists — it
   will read stale/missing content.
2. Remember the Clause 2 exact-phrase requirement (discovered at M37): the dashboard text must contain
   the literal substring "V_meta consolidation-lag" (or "V_meta consolidation lag"), not just
   "V_meta-lag", within ~200 chars of a disposition keyword.
3. Confirm no `packages/quay*` product files were touched by this milestone's own diff — re-verify via
   `git diff --stat`, do not assume from this charter.
4. Checkpoint cadence: **not due at this milestone's ABSORB.** `milestone_counter` becomes **38** at
   this ABSORB (m37 set it to 37) — the next checkpoint is due at `milestone_counter=40`.
5. If the two iterations converge on substance but diverge on exact wording/mechanics of the
   `OUTER-LOOP.md` edit or the `extra.acceptance` command shape, reconcile on the merits (mirrors
   M32/M36/M37's precedent) — read both diffs directly, not self-reports alone.

## Dispatcher notes
Dispatch two independent `baime:iteration-executor` agents off this charter's base commit
(`experiments/quay-perpetual-stream/milestones/M38-dod-gate-operative-real-milestone/worktrees/iteration-{0,1}`,
branches `exp5-m38-iteration-{0,1}`). Iteration-1 must NOT read iteration-0's materials
(independent-verification discipline). Both iterations should independently attempt AC items 1-5
end-to-end (not merely design the change) — this milestone's entire value proposition is that it is
REAL, not designed; a report that only proposes the wiring without actually invoking `quay gate` on
its own real task and observing a real GateEvent has not met the AC.
