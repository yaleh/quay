---
id: exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES
title: "DIR-022 Layer 2 (phase 1): register impl-row and line-budget as named
  quay engine gates — thin wrappers over the existing it0 scripts, ≥80%
  coverage, demonstrated against a real (non-fixture) exp5 task with real
  GateEvents"
status: done
labels:
  - milestone-candidate
  - surface:cli
  - milestone:M39-migrate-impl-row-line-budget-gates
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES
    experiments/quay-perpetual-stream/charters/M39-migrate-impl-row-line-budget-gates.md
    /tmp/m39-absorb-entry.md
  lineBudgetArgs:
    - experiments/quay-perpetual-stream/charters/M39-migrate-impl-row-line-budget-gates.md
---
## Provenance
SELECTed at m38→m39 DRAIN/SELECT boundary, 2026-07-19, directly from `DIR-022`
(`experiments/quay-perpetual-stream/directives/pending/DIR-022-layer2-migrate-remaining-exp5-gates-to-the-quay-engine.md`,
`tasks/DIR-022.md`) — Layer 2 of the DIR-021..024 ordered quay-engine-adoption program, now unblocked
since Layer 1 (DIR-021/M38) landed a real, non-fixture `quay gate` PASS. Chosen over 6 open
M37-produced backlog candidates per the standing DIR-over-backlog SELECT precedent, and explicitly
scoped to phase 1 (impl-row + line-budget only, deferring the 4 judgment-heavy gates) mirroring
DIR-017's own established phased-program precedent. See the charter for full reasoning.

## Source
`experiments/quay-perpetual-stream/charters/M39-migrate-impl-row-line-budget-gates.md`.

## Acceptance Criteria
- [x] `packages/quay/src/gate/registry.js` gains two new named gates: `impl-row` and `line-budget`,
  each a thin async `(task, client) => { ok, reason }` wrapper that shells out to the existing
  `it0-impl-row-check.sh` / `it0-ceiling-line-budget-check.sh` scripts respectively (no gate LOGIC
  duplicated — the scripts remain the source of truth). The gate reads its script arguments from
  `task.extra` via a convention consistent with the existing `acceptance` gate's `task.extra.acceptance`
  pattern, not a new ad hoc mechanism.
  (Confirmed by adversarial audit, 2026-07-19: read `packages/quay/src/gate/registry.js` in full —
  `makeIt0Gate()` factory only assembles a shell-quoted command and delegates to the existing
  `runAcceptance()` from `acceptance-runner.js`; no spawn/timeout/exit-code logic duplicated, no
  it0-script logic reimplemented — verified against both scripts' own header/arg-contract comments.)
- [x] `quay gate --list` (or equivalent CLI surface) includes `impl-row` and `line-budget` alongside
  the existing `dod`/`acceptance`.
  (Confirmed by adversarial audit, 2026-07-19: `node packages/quay/bin/quay.js gate --list` →
  `dod`, `acceptance`, `impl-row`, `line-budget`.)
- [x] `quay gate <task> --gate impl-row` and `quay gate <task> --gate line-budget` each exit 0/1
  correctly against a REAL exp5 milestone task or task pair (not a synthetic `QENG-5-DEMO-*`-style
  fixture), and each appends a GateEvent queryable via `quay gate-log <task> --json`.
  (Confirmed by adversarial audit, 2026-07-19: `node packages/quay/bin/quay.js gate
  exp5-M-DOD-GATE-OPERATIVE-REAL-MILESTONE --gate impl-row --file /tmp/audit-m39-gatelog.jsonl` →
  PASS exit 0; `node packages/quay/bin/quay.js gate exp5-M-MIGRATE-IMPL-ROW-LINE-BUDGET-GATES --gate
  line-budget --file /tmp/audit-m39-gatelog.jsonl` → PASS exit 0; `quay gate-log ... --json` for both
  tasks shows real GateEvents with `gate: "impl-row"` / `gate: "line-budget"`, `verdict: "pass"`.
  Both target tasks are real exp5 tasks, not fixtures.)
- [x] New gate code in `packages/quay/src/gate/registry.js` (and any new helper file it requires) has
  ≥80% line/branch coverage: `node --test --experimental-test-coverage packages/quay/test/*.mjs`
  (real output pasted in the report, not restated from memory).
  (Confirmed by adversarial audit, 2026-07-19: independently re-ran `node --test
  --experimental-test-coverage packages/quay/test/*.mjs` — coverage table shows `registry.js
  100.00 | 100.00 | 100.00` and `acceptance-runner.js 100.00 | 100.00 | 100.00`, both well over the
  80% bar. Overall suite exit 1 due to one unrelated, pre-existing, network-dependent failure in
  `serve-github.test.mjs` — untouched by this milestone's diff, confirmed via `git show 1517b8f
  --stat`.)
- [x] `OUTER-LOOP.md` step 6's DoD meta-enforcer gate paragraph is updated so the impl-row and
  line-budget checks are noted as ALSO invokable via `quay gate <task> --gate impl-row` / `--gate
  line-budget` for a real milestone that opts in — does NOT require migrating every milestone's ABSORB
  flow to use the named gates exclusively yet.
  (Confirmed by adversarial audit, 2026-07-19: `grep -n "quay gate.*--gate impl-row\|quay gate.*--gate
  line-budget" experiments/quay-perpetual-stream/OUTER-LOOP.md` → hit at line 358; surrounding
  paragraph correctly frames it as an additional opt-in surface, not a mandatory migration.)

## Adversarial audit note (2026-07-19) — ABSORB not yet complete
All 5 ACs above are independently confirmed and genuinely met (see
`experiments/quay-perpetual-stream/milestones/M39-migrate-impl-row-line-budget-gates/audit.md` for
full evidence). However, **this milestone's own ABSORB step has not run**: `dashboard.md` has no
M39 log entry (last entry is m38, `milestone_counter → 38`), `backlog.md` has no M39 row, this
task's `status:` frontmatter is still `in-progress`, and `it0-dod-check.sh` for this task's own
composite acceptance meter has never produced a completed absorb-entry file
(`/tmp/m39-absorb-entry.md` does not exist). Per `inherited-core.md`, `milestone_counter++` is
gated on the DoD clauses being evaluated AND LOGGED, not merely satisfied — do not mark this
milestone DONE / advance `milestone_counter` to 39 until the outer loop runs the real ABSORB step
(dashboard.md log entry, backlog.md row, task status → done). See the audit report's "Blocking gap"
section for full detail.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware], 1 per-milestone acceptance audit [unconditional], 2 V_meta consolidation-lag, 3
line-budget, 4 impl-row — N/A [this milestone's own output IS the impl-row/line-budget gate
implementation + its real-landing proof, not a design doc awaiting a future `-IMPL`], 5
no-self-exemption, 6 escrow-Δv — N/A [not design-only], 7 test-floor — **APPLIES** [`surface:cli`,
real product code added to `packages/quay/src/gate/registry.js`; re-confirm the ACTUAL coverage number
at ABSORB, do not assume the AC was met]). No task-specific exemption from any clause.

## Value type / cadence
governance-integrity (primary — extends the real, non-demo engine-gate pattern M38 proved to 2 more of
exp5's own gates) + capability-growth (secondary — genuinely new, reusable quay engine capability).
Δv̂ small-to-moderate, no VT chart cell expected (mirrors the DoD-program lineage's own no-VT-cell
precedent — M25/M32/M36/M38), re-confirm at ABSORB rather than assume.

## Status mirror
SELECTed @m39 DRAIN/SELECT boundary, 2026-07-19, from DIR-022 (Layer 2, phase 1, of the DIR-021..024
ordered quay-engine-adoption program).
