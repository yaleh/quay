# Charter M44-dir032-audit-independence — DIR-032: generic-vehicle OUTER-LOOP
# audit dispatch + machine-checkable audit-independence HARD gate

**Milestone id:** M44-dir032-audit-independence · **surface:** cli (adds a new product/method-infra
file `scripts/audit-independence-check.mjs` + a `packages/quay/src/gate/registry.js` gate wire-up +
an `experiments/quay-perpetual-stream/OUTER-LOOP.md` prose edit) · **type:** governance-integrity
(primary — restores the ABSORB adversarial audit's independence guarantee) + risk/option (closes a
repeat-degradation pattern before a 4th occurrence, DEV-06/07/08)
**Source:** `DIR-032` (`tasks/DIR-032.md`, human-authored directive) →
`exp5-M-DIR032-AUDIT-INDEPENDENCE` (`tasks/exp5-M-DIR032-AUDIT-INDEPENDENCE.md`).
**Charter authored:** m43→m44 boundary, 2026-07-20. Base commit: `master` HEAD `e3c55a9`.
**Human-steered:** YES (see task's own "Human-steered classification" section) — scope requires
editing `OUTER-LOOP.md` itself, the exact driver-self-rewrite hazard class the D2/D3/F1 fence names;
executed under that fence's own D3 behavior-preserving + golden-replay exception, under explicit
human direction for this one dispatched pass. Not a precedent for unattended autonomous SELECT.

## SELECT reasoning
DRAIN (this pass): `task_list --label directive` — `DIR-032` is the fresh pending item (authored
off-loop at m43 boundary per DIR-027, empirically re-confirmed a 3rd time at m43 ABSORB). `DIR-030`'s
window closed at m43 ABSORB (3/4: G1, E3, DIR022-REMAINING-GATES) — `D1` (`exp5-M-CRYST-D1`) becomes
eligible for the first time this pass.

**Chosen: `exp5-M-DIR032-AUDIT-INDEPENDENCE`**, over D1. Value-typed ledger reasoning (full text also
on `dashboard.md`'s "M44 SELECT" entry and `tasks/exp5-M-CRYST-D1.md`'s own `## Not selected (M44)`):
- **Value type:** governance-integrity (the ABSORB adversarial audit — the loop's single strongest
  verification gate / ADR-005's verification-asymmetry guarantee — has silently degraded to
  self-audit for THREE consecutive milestones, M41→M42→M43) + risk/option (close the pattern before
  a 4th). D1 is capability-growth, real and foundational, but not itself decaying while it waits.
- **Governance/infra hard floor (mandatory, applied at SELECT):** DIR-032's two requested-action
  halves — (a) the `OUTER-LOOP.md` §6 generic-vehicle doc edit, (b) the mechanical
  `audit-independence-check.mjs` HARD gate — are scoped TOGETHER into this one milestone-candidate
  task, precisely so it does not repeat the DIR-002/DIR-006 "declared but not enforced" failure the
  hard floor exists to catch. A scope covering only the doc half or only the gate half would have
  been rejected/resized here.
- **Ranking discipline:** a zero/negative-VT governance-integrity/risk-option candidate can and
  should outrank a positive-VT capability-growth candidate when the non-VT risk is higher
  (`inherited-core.md`). No VT chart cell expected (same no-VT-cell precedent as the DoD-program
  lineage — M25 onward).
- **D1 disposition:** fully eligible, NOT re-gated by any directive, recorded as the first candidate
  for m45's SELECT (`## Not selected (M44)` on `tasks/exp5-M-CRYST-D1.md`).

**Human-steered correction (caught within this same SELECT pass, before dispatch):** this candidate's
scope requires editing `OUTER-LOOP.md` itself — the exact class D2/D3/F1's `human-steered` fence
excludes from *autonomous* SELECT. Labeled `human-steered` at authoring time rather than left
unfenced; executed under the fence's own named exception (D3's behavior-preserving + golden-replay
discipline) and under explicit human direction for this one pass. This is NOT a precedent for future
unattended autonomous SELECT to pick up driver-doc edits on its own.

## Acceptance Criteria
Mirrors the task's own 4 Acceptance Criteria (`tasks/exp5-M-DIR032-AUDIT-INDEPENDENCE.md`) exactly:
- [ ] `grep -n 'baime:iteration-executor' experiments/quay-perpetual-stream/OUTER-LOOP.md` returns NO
  line inside the §6 acceptance-audit block; that block instead names a generic `Explore`/
  `general-purpose` subagent, states the audit is dispatched by the TOP-LEVEL loop session, and
  states inability-to-dispatch is BLOCKING (not a license to self-audit).
- [ ] `scripts/audit-independence-check.mjs` exits 1 against a RED fixture shaped like the real
  M41/M42/M43 self-audit artifacts and exits 0 against a GREEN fixture carrying a distinct
  independent id; both fixtures committed under this script's own test/fixture directory.
- [ ] The check is registered as a named engine gate (`quay gate --list` includes it) and wired into
  the ABSORB gate sequence so a self-audit HARD-BLOCKS `milestone_counter++` — demonstrated by
  running it for real against this milestone's own audit artifact.
- [ ] The dashboard's Deviation-record-schema DEV-06/07/08 rows are confirmed still present and are
  the single source (no duplicate second table created by this milestone).

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware], 1 per-milestone acceptance audit [UNCONDITIONAL — this is the milestone whose
audit-independence PROOF is contested by its own subject matter; see "Note for ABSORB" below for
how this milestone's OWN audit must be honestly disclosed], 2 V_meta consolidation-lag, 3
line-budget, 4 impl-row — N/A [output is real code/doc, not a design doc awaiting a future `-IMPL`
row], 5 no-self-exemption, 6 escrow-Δv — N/A [not design-only], 7 test-floor — **APPLIES**
[`surface:cli`, new product/method-infra script + registry wire-up; strict TDD ≥80% coverage,
re-confirm the actual number at ABSORB], 8 task canonical-lifecycle-record, 9 split-or-commit [this
candidate was NOT split — both requested-action halves fit one milestone per the sizing check
below]). No task-specific exemption from any clause.

## Value hypothesis
- Value type(s): **governance-integrity** (primary) + **risk/option** (secondary), per the
  value-typed SELECT ledger above.
- **Δv̂:** no VT chart cell expected (governance/method-infra-adjacent, mirrors the DoD-program
  lineage's own no-VT-cell precedent); value measured directly by metric `Y` below.
- Metric `Y`: the task's 4 Acceptance Criteria, verbatim (see task file) — specifically, whether
  `OUTER-LOOP.md` §6 no longer names `baime:iteration-executor`, whether
  `audit-independence-check.mjs` exists RED+GREEN fixture-pinned and is a registered named gate,
  whether it HARD-blocks a self-audit, and whether DEV-06/07/08 remain the single-source dashboard
  record.

## Current-state notes (re-verified directly against source at charter-authoring time)
- `experiments/quay-perpetual-stream/OUTER-LOOP.md` §6 (line ~268 per DIR-032's Finding) currently
  reads: "dispatch a fresh-context adversarial audit subagent (`inherited-core.md`'s "Adversarial-
  audit role" — a fresh-context `baime:iteration-executor` call, `run_in_background=true`, dispatched
  by the OUTER loop itself...)". This is the exact line to change.
- `packages/quay/src/gate/registry.js` currently exports gates via the `makeIt0Gate(scriptPath,
  argsKey, label)` factory (M39/E3/M43 precedent): `dod`, `acceptance`, `impl-row`, `line-budget`,
  `adr-001`, `vmeta-lag`, `dogfood-evidence` — direct structural precedent for a new
  `audit-independence` gate: same factory, same fail-closed unset-args branch.
- `milestones/M43-dir022-remaining-gates/audits/iteration-0-acceptance-audit.md` is the concrete
  RED-fixture shape to model the check's RED path on: a self-audit artifact with no distinct
  session/agent id recorded, explicitly disclosed as non-independent.
- `inherited-core.md`'s Deviation-record-schema table already carries DEV-06/DEV-07/DEV-08 (M41/M42/
  M43 self-audits) — this milestone's AC4 only needs to CONFIRM these, not re-add them.

## In scope
1. `experiments/quay-perpetual-stream/OUTER-LOOP.md` §6 edit: replace the `baime:iteration-executor`
   audit-vehicle line with a generic `Explore`/`general-purpose` subagent instruction; state the audit
   MUST be dispatched by the TOP-LEVEL loop session; state that inability to dispatch a genuinely
   independent subagent is BLOCKING, not a license to self-audit. Purely this prose block — no change
   to the HARD GATES transcluded/by-reference text below.
2. `scripts/audit-independence-check.mjs` (new, TDD RED-then-GREEN): given an audit artifact path +
   a recorded session/agent id (and the orchestrator's own id, however sourced this runtime), exits 1
   when the artifact's id is absent OR equals the orchestrator's own; exits 0 when a distinct
   independent id is present. Fixtures: a RED fixture (self-audit shape, M41/M42/M43-style) + a GREEN
   fixture (distinct independent id).
3. `packages/quay/src/gate/registry.js`: register `"audit-independence": makeIt0Gate(...)` (or an
   equivalent thin factory call) so `quay gate --list` includes it and `quay gate <task> --gate
   audit-independence` runs it for real, appending a real GateEvent.
4. Confirm (not re-add) `inherited-core.md`'s DEV-06/07/08 rows remain the single dashboard-deviation
   source.
5. TDD ≥80% coverage on all new/touched code, test-first per ADR-001.
6. This milestone's OWN real ABSORB proof: run the `audit-independence` gate against this
   milestone's own audit artifact, paste both `quay gate` stdout and `quay gate-log --json`.

## Explicitly OUT of scope
- Retroactively re-running the new gate against M41/M42/M43's already-closed audit artifacts as a
  fresh enforcement action (they are already retro-flagged via DEV-06/07/08; this milestone's RED
  fixture may MODEL their shape without re-adjudicating them).
- `exp5-M-CRYST-D1` — now eligible per DIR-030, deferred to m45 (see `## Not selected (M44)`).
- Any change to the transcluded/by-reference HARD GATES text itself (unrelated to this directive).

## Done-when (binary clauses)
Mirrors the task's 4 Acceptance Criteria exactly (see task file) plus:
1. `grep -n 'baime:iteration-executor' experiments/quay-perpetual-stream/OUTER-LOOP.md` — paste real
   output showing NO match inside the §6 block.
2. `node --test` on the new check's fixtures — paste real RED-then-GREEN transcript.
3. `quay gate --list` includes `audit-independence`; `quay gate <task> --gate audit-independence`
   paste real PASS/FAIL runs against both fixture shapes.
4. `node --test --experimental-test-coverage` on `packages/quay` shows ≥80% line coverage on the new
   check module (paste real output).

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md`
lines 100-131 for the full literal text; both dispatched iteration prompts must include it
verbatim):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)
gate-hash-by-reference mode: `it0-gate-hash-check.sh --by-reference` against this charter file, run
immediately before dispatch and re-confirmed unchanged. The manda healthz gate and port-4173
reachability gate are N/A this milestone (no Web UI surface touched) — state N/A explicitly in each
iteration's report, do not silently omit.

## it0 checks (run at charter-authoring time, before dispatch)
- `it0-ceiling-check.sh`: N/A — this milestone cites no `gap-list.md` gap/directive ID as in-scope
  (source is a live task, `exp5-M-DIR032-AUDIT-INDEPENDENCE`, and a live directive, `DIR-032`, both
  read directly).
- `it0-ceiling-line-budget-check.sh` against this charter: run before dispatch (see below); small,
  direct-precedent scope (one prose-block edit + one new check module + fixtures + one registry
  registration, same shape as M39/E3/M43); resize before dispatch if flagged.
- `it0-impl-row-check.sh`: N/A — this milestone's own output is the real-landing proof itself.
- Domain-misfit audit-channel: an independent mechanism IS reachable in principle — the adversarial
  audit can independently re-run `quay gate <task> --gate audit-independence` against both fixture
  shapes and confirm the exit codes/GateEvents match the claimed AC, mirroring M38/39/42/43's own
  audits. **HOWEVER** this milestone's OWN subject matter is precisely whether an independent
  audit can be genuinely dispatched this session — see "Note for ABSORB" for the required honest
  disclosure if it cannot.

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
Dispatch a fresh-context, out-of-band adversarial-audit subagent at ABSORB, refute-first stance
against this task's 4 AC clauses + DoD, mirroring M38/39/41/42/43's own audit discipline. The audit
should specifically probe: (a) does the `OUTER-LOOP.md` edit genuinely remove
`baime:iteration-executor` from the §6 block without silently altering the transcluded HARD GATES
text, (b) does `audit-independence-check.mjs` genuinely exit 1/0 on the RED/GREEN fixtures (re-run
independently), (c) is the gate genuinely registered and does it append real GateEvents (re-run `quay
gate --list` and `quay gate <task> --gate audit-independence` independently), (d) are DEV-06/07/08
still present as the single dashboard-deviation source (no silent duplicate table), (e) is coverage
genuinely ≥80% (re-run `node --test --experimental-test-coverage` independently). Per DIR-020/M34's
standing write-back mechanism, the audit ticks `- [x]` on each AC/DoD checklist item it confirms,
with an inline evidence citation per item.

**Meta-note (unique to this milestone):** THIS milestone's charge is precisely to fix the mechanism
this same audit sub-step depends on. If, at THIS milestone's own ABSORB, the top-level loop session
still cannot dispatch a genuinely independent subagent (the same nested-session constraint diagnosed
at M41/M42/M43), that must be disclosed EXPLICITLY and honestly — same discipline as M43's own
ABSORB — never laundered as independent. The deliverable (doc edit + gate + fixtures) can still land
for real even if the FIRST genuinely-independent proof-of-use is deferred to the very next dispatch
opportunity (the top-level session, not this nested one) — state this explicitly, do not silently
skip it or claim it is already proven.

## Note for ABSORB
1. Remember the Clause 2 exact-phrase requirement: dashboard text must contain the literal substring
   "V_meta consolidation-lag" (or "V_meta consolidation lag").
2. Remember the `it0-dod-check.sh` invocation convention: task id (not milestone id) as the first
   argument — `exp5-M-DIR032-AUDIT-INDEPENDENCE`.
3. Per M39/41/42/43's own precedent, this milestone's ABSORB should invoke `quay gate
   exp5-M-DIR032-AUDIT-INDEPENDENCE` as its own DoD meta-enforcer check — AND additionally run `quay
   gate exp5-M-DIR032-AUDIT-INDEPENDENCE --gate audit-independence` as this milestone's own
   multi-gate ABSORB proof (Done-when clause 3 / AC3).
4. Confirm DIR-032's `## Resolution (M44 SELECT)` note still accurately describes the outcome once
   ABSORB completes; append a dated `## Resolution (M44 ABSORB)` update.
5. Confirm `tasks/exp5-M-CRYST-D1.md`'s `## Not selected (M44)` note stands; D1 is the recommended
   first candidate for m45's SELECT.
6. **Checkpoint cadence:** last checkpoint written was cp-40 at m40 (every-5 cadence, next DUE at
   m45) — NOT due at this ABSORB (`milestone_counter` becomes 44).
7. **STOP BEFORE the adversarial-audit sub-step if dispatched as a nested background worker without
   Agent-tool access** (per this pass's own explicit instruction) — draft the rest of the ABSORB
   entry, leave the audit verdict as an explicit PENDING placeholder, and report back to the
   top-level session rather than self-auditing or silently merging.

## Dispatcher notes
Dev-class routing (5a): FIRST invoke `/quay-task-to-plan exp5-M-DIR032-AUDIT-INDEPENDENCE` (N
independent proposal drafts → adjudication → write-back → milestone-level plan record under
`docs/plans/` if warranted → grounded plan-check ≤3 rounds), THEN dispatch the implementation against
the checked plan. If `baime:iteration-executor` subagent dispatch is unreachable in this session (as
at m41/m42/m43), fall back to isolated-worktree DIRECT EXECUTION by this orchestrator itself, still
preserving the pipeline's independent-diversity structure — state explicitly in the report which
pattern was used and why. **This milestone is executed under human-steered dispatch — worktree
created off `master` HEAD, on its own branch, per DIR-027 hygiene; not raced against the live loop.**
