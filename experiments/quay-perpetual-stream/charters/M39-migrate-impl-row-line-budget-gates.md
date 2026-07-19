# Charter M39-migrate-impl-row-line-budget-gates — DIR-022 Layer 2, phase 1:
# register impl-row + line-budget as named engine gates

**Milestone id:** M39-migrate-impl-row-line-budget-gates · **surface:** cli (adds real code to
`packages/quay/src/gate/registry.js`, a product file — Clause 7 test-floor APPLIES) · **type:**
governance-integrity, capability-growth
**Source:** `DIR-022` (`experiments/quay-perpetual-stream/directives/pending/DIR-022-layer2-migrate-remaining-exp5-gates-to-the-quay-engine.md`,
`tasks/DIR-022.md`) — Layer 2 of the DIR-021..024 ordered quay-engine-adoption program, now unblocked
since Layer 1 (DIR-021/M38) landed a real, non-fixture `quay gate` PASS.
**Charter authored:** m38→m39 boundary, 2026-07-19. Base commit: `exp5-outer-driver` HEAD `209faca`
(post-M38-ABSORB-publish-sync).

## SELECT reasoning
`directives/pending/` now holds `DIR-021` (delivered, stays pending per its own escrow discipline
until a human archives it — see M38 dashboard note), `DIR-022`, `DIR-023`, `DIR-024` (Layers 2-4,
each depending on the prior). `backlog.md` also retains 6 open M37-produced candidates
(`exp5-M-GATE-CLI-ARG-ORDER`, `exp5-M-GATE-CLI-ERROR-UX`, `exp5-M-GATE-HELP-SYNOPSIS-GAP`,
`exp5-M-GATE-README-DOCS`, `exp5-M-GATE-MCP-PARITY-GAP`) plus 3 STALE rows.

**Chosen: DIR-022, scoped to phase 1 (impl-row + line-budget only).** Reasoning, explicit not
defaulted:
1. Per the same DIR-over-backlog precedent applied at m38, `DIR-022` (Layer 2, now unblocked) takes
   priority over the 6 open backlog candidates.
2. `DIR-022`'s own scope (6 gates: adversarial-audit, V_meta-lag, impl-row, escrow-Δv, test-floor,
   line-budget) is too large for one small milestone under the established line-budget norm, and its
   own Definition of Done text explicitly tolerates partial delivery ("Stays `pending` until [ALL
   applicable gates land]" — the same phased-program shape DIR-017 itself used across 3 milestones,
   M25/M32/M36). This charter deliberately scopes to a first phase: **`impl-row`** and
   **`line-budget`** — the two MECHANICAL, already-scripted gates with no judgment/documentation-
   discipline component (unlike adversarial-audit and V_meta-lag, which are prose-verdict checks
   already embedded in the `dod`/`acceptance` composite's Clause 1/2 dispositions, and unlike
   escrow-Δv/test-floor, which are conditional triggers rather than standalone invocations).
3. Both `it0-impl-row-check.sh` and `it0-ceiling-line-budget-check.sh` already exist, are already
   the standing mechanical check for their respective clauses, and take a small, fixed argument
   shape — low-risk to wrap as thin registry gates (per DIR-022's own instruction: "Reuse the it0
   scripts as-is — do NOT rewrite gate logic").
4. Deferring the remaining 4 gates (audit/V_meta-lag/escrow/test-floor) to a later DIR-022 phase
   mirrors DIR-017's own precedent and avoids an oversized, judgment-risk-laden single milestone.

## Acceptance Criteria
- [ ] `packages/quay/src/gate/registry.js` gains two new named gates: `impl-row` and `line-budget`,
  each a thin async `(task, client) => { ok, reason }` wrapper that shells out to the existing
  `it0-impl-row-check.sh` / `it0-ceiling-line-budget-check.sh` scripts respectively (no gate LOGIC
  duplicated — the scripts remain the source of truth, per DIR-022's own instruction). The gate reads
  its script arguments from `task.extra` (e.g. `task.extra.implRowArgs` / `task.extra.lineBudgetArgs`,
  or an equivalent convention chosen at implementation time and documented in the report) — pick a
  convention consistent with the existing `acceptance` gate's `task.extra.acceptance` pattern, not a
  new ad hoc mechanism.
- [ ] `quay gate --list` (or equivalent CLI surface — check what exists; `listGates()` is already
  exported from registry.js, confirm/add a CLI-reachable `--list` flag if one doesn't exist yet)
  includes `impl-row` and `line-budget` alongside the existing `dod`/`acceptance`.
- [ ] `quay gate <task> --gate impl-row` and `quay gate <task> --gate line-budget` each exit 0/1
  correctly against a REAL exp5 milestone task or task pair (may reuse this milestone's own task
  and/or a prior real milestone's task/charter as the fixture-free real-world input — NOT a synthetic
  `QENG-5-DEMO-*`-style fixture), and each appends a GateEvent queryable via `quay gate-log <task>
  --json`.
- [ ] New gate code in `packages/quay/src/gate/registry.js` (and any new helper file it requires) has
  ≥80% line/branch coverage: `node --test --experimental-test-coverage packages/quay/test/*.mjs`
  (paste real output in the report, not restated from memory).
- [ ] `OUTER-LOOP.md` step 6's DoD meta-enforcer gate paragraph (already promoted to a `quay gate`-
  primary procedure at M38) is updated so the impl-row and line-budget checks, wherever they already
  fire in the ABSORB flow (impl-row at the design-only-milestone gate; line-budget as a drift-check
  inside the DoD-composite), are noted as ALSO invokable via `quay gate <task> --gate impl-row` /
  `--gate line-budget` for a real milestone that opts in — this charter does NOT require migrating
  EVERY milestone's ABSORB flow to use the named gates exclusively yet (that is a later-phase
  decision), only that the capability is real, tested, and demonstrated against a real task.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware], 1 per-milestone acceptance audit [unconditional], 2 V_meta consolidation-lag, 3
line-budget, 4 impl-row — N/A [this milestone's own output IS the impl-row/line-budget gate
implementation + its real-landing proof, not a design doc awaiting a future `-IMPL`], 5
no-self-exemption, 6 escrow-Δv — N/A [not design-only], 7 test-floor — **APPLIES**
[`surface:cli`, real product code added to `packages/quay/src/gate/registry.js`; the AC's own ≥80%
coverage requirement satisfies this clause's bar, but re-confirm the ACTUAL coverage number at
ABSORB, do not assume the AC was met]). No task-specific exemption from any clause.

## Value hypothesis
- Value type(s): **governance-integrity** (primary — extends the real, non-demo engine-gate pattern
  M38 proved to 2 more of exp5's own gates) + **capability-growth** (secondary — genuinely new,
  reusable quay engine capability, not exp5-specific plumbing only).
- **Δv̂:** small-to-moderate, no VT chart cell (mirrors the DoD-program lineage's own no-VT-cell
  precedent — M25/M32/M36/M38 all method-infra/governance, no VT points), UNLESS the two new registry
  gates are judged to constitute a genuine `packages/quay` capability-growth delta warranting a VT
  cell — re-confirm at ABSORB, do not assume N/A by default (this charter's own instinct is no-VT-
  cell, consistent with the DoD-program lineage, but the dispatched iterations should state their own
  reasoning rather than silently inherit this charter's assumption).
- Metric `Y`: the task's 5 Acceptance Criteria, verbatim (see task file to be authored).

## Current-state notes (re-verified directly against source at charter-authoring time)
- `packages/quay/src/gate/registry.js` currently exports exactly 2 gates: `dod` (thin adapter over
  `client.taskCheck`) and `acceptance` (QENG-2, reads `task.extra.acceptance`, runs it via
  `runAcceptance`). No `--list` CLI flag confirmed to exist yet — `listGates()` is exported but its
  CLI wiring needs verification at dispatch time.
- `it0-impl-row-check.sh` takes `<milestone-id> <backlog-file>` (confirmed via `head -10`).
- `it0-ceiling-line-budget-check.sh` takes `<charter-file>` (confirmed via `head -10`).
- M38 (this charter's immediate predecessor) proved the `acceptance` gate pattern end-to-end for a
  real, non-fixture milestone — this charter extends the SAME real-landing discipline to 2 more named
  gates, not the generic `acceptance` catch-all.
- `backlog.md` (regenerated post-M38-ABSORB): 34 milestone-candidate rows, 6 open, 3 STALE — no
  competing DIR-over-backlog tension at this SELECT boundary since DIR-022 is chosen explicitly.

## In scope
1. Design and implement the `impl-row` and `line-budget` registry gates (thin wrappers over the
   existing it0 scripts), choosing and documenting an `extra.*` argument-passing convention.
2. Add/confirm CLI `--list` wiring so `gateRegistry`'s keys are enumerable from the command line.
3. Write tests achieving ≥80% coverage on the new registry code.
4. Demonstrate both new gates against a REAL exp5 milestone task (this milestone's own task is an
   acceptable real target, mirroring M38's own self-referential proof pattern; or an already-
   ABSORBed real milestone's task/charter pair, whichever the iteration finds cleaner), with real
   GateEvents in `quay gate-log`.
5. Update `OUTER-LOOP.md`'s relevant DoD-gate prose to note the new invocation capability (not a full
   migration of every milestone's flow to the named gates yet — see AC item 5's explicit scope limit).

## Explicitly OUT of scope
- The remaining 4 DIR-022 gates (adversarial-audit, V_meta-lag, escrow-Δv, test-floor) — deferred to
  a later DIR-022 phase; DIR-022 itself stays `pending` after this milestone, per its own Definition
  of Done (ALL applicable gates required for DIR-022's own completion).
- Migrating EVERY future milestone's ABSORB flow to invoke `impl-row`/`line-budget` exclusively via
  `quay gate --gate <name>` — this charter proves the capability is real and tested; wholesale
  ABSORB-flow migration (if desired) is a separate future decision, not mandated here.
- DIR-023 (lifecycle/`quay run` adoption) and DIR-024 (`gate-log` as audit-trail source) — later
  layers, explicitly out of scope.
- Modifying `it0-impl-row-check.sh` / `it0-ceiling-line-budget-check.sh`'s own internal logic — the
  registry gates are thin wrappers, per DIR-022's own "do NOT rewrite gate logic" instruction.

## Done-when (binary clauses)
Mirrors the task's 5 Acceptance Criteria exactly (task file to be authored as
`tasks/exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES.md`) plus:
1. Two new named gates exist in `packages/quay/src/gate/registry.js`, each a thin wrapper (no
   duplicated logic).
2. ≥80% coverage on new gate code, real command output pasted in the report.
3. Both gates invoked for real against a real (non-fixture) task, real GateEvents in `quay gate-log`.
4. `OUTER-LOOP.md` updated to note the new capability.
5. `git diff --stat` at ABSORB confirms which `packages/quay*` files were touched (Clause 7 applies —
   do not claim N/A).

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131 for the full literal text; both dispatched iteration prompts must include it verbatim):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)
gate-hash-by-reference mode: `it0-gate-hash-check.sh --by-reference` against this charter file, run
immediately before dispatch and re-confirmed unchanged. The manda healthz gate and port-4173
reachability gate are N/A this milestone (no Web UI surface touched) — state N/A explicitly in each
iteration's report, do not silently omit.

## it0 checks (run at charter-authoring time, before dispatch)
- `it0-ceiling-line-budget-check.sh` against this charter: 5 in-scope items — small-to-moderate; run
  before dispatch, watch for a FAIL given this is a real code-change milestone (not pure discovery).
- `it0-impl-row-check.sh`: N/A — this milestone's own output is the real-landing proof itself.

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
Dispatch a fresh-context, out-of-band adversarial-audit subagent at ABSORB, refute-first stance
against this task's 5 AC clauses + DoD, mirroring M38's own audit discipline exactly. Given this
milestone adds REAL product code with a coverage bar, the audit should specifically probe: (a) is the
≥80% coverage figure real (independently re-run the test suite with coverage, do not trust the
report's pasted number), (b) are the two new gates genuinely thin wrappers with no duplicated logic
(diff the wrapper against the underlying it0 script's argument contract), (c) was a REAL task used for
the demonstration (not a disguised fixture), (d) does `quay gate-log` show real GateEvents for BOTH
new gate names against that real task. Per DIR-020/M34's standing write-back mechanism, the audit
ticks `- [x]` on each AC/DoD checklist item it confirms, with an inline evidence citation per item.

## Note for ABSORB
1. Re-confirm Clause 7 test-floor is APPLIES, not N/A (this milestone touches `packages/quay/src/gate/
   registry.js`, a product file) — paste the actual coverage command output, do not assume the AC's
   claim.
2. Confirm DIR-022 itself stays `pending` after this ABSORB (phase 1 only, 4 gates remain) — do not
   mark DIR-022 done or archived.
3. Remember the Clause 2 exact-phrase requirement: dashboard text must contain the literal substring
   "V_meta consolidation-lag" (or "V_meta consolidation lag").
4. Remember the `it0-dod-check.sh` invocation convention: task id (not milestone id) as the first
   argument.
5. Per M38's own precedent, this milestone's ABSORB should itself invoke `quay gate
   <this-milestone-task>` (the `acceptance`/`dod` composite gate, now the OUTER-LOOP.md-primary path)
   as its own DoD meta-enforcer check — the new `impl-row`/`line-budget` gates are ADDITIONAL
   capabilities this milestone delivers, not a replacement for the composite DoD-check invocation
   that gates `milestone_counter++` itself.
6. Checkpoint cadence: **not due at this milestone's ABSORB.** `milestone_counter` becomes **39** at
   this ABSORB (m38 set it to 38) — the next checkpoint is due at `milestone_counter=40`, i.e. **the
   VERY NEXT milestone after this one**. Flag this explicitly so m40's ABSORB does not miss the
   checkpoint.

## Dispatcher notes
Dispatch two independent `baime:iteration-executor` agents off this charter's base commit
(`experiments/quay-perpetual-stream/milestones/M39-migrate-impl-row-line-budget-gates/worktrees/iteration-{0,1}`,
branches `exp5-m39-iteration-{0,1}`). Iteration-1 must NOT read iteration-0's materials
(independent-verification discipline). Both iterations should independently attempt AC items 1-5
end-to-end (write the code, write the tests, run them for real, demonstrate the gates against a real
task) — a report that only designs the wrappers without running the tests and observing real
GateEvents has not met the AC.
