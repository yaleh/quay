# Charter M42-cryst-e3-adr-gate — E3: wire accepted ADRs as `adr-<id>` engine
# gates (ADR-001 → B7 first), DIR-030 item 2/4

**Milestone id:** M42-cryst-e3-adr-gate · **surface:** cli (adds real code to
`packages/quay-native/src/adr-store.js` and `packages/quay/src/gate/registry.js`, both product files
— Clause 7 test-floor APPLIES) · **type:** governance-integrity (primary — makes ADR decisions
ENFORCED, not merely stored) + capability-growth (secondary — a genuinely new, reusable quay engine
capability: contract-backed ADR gates)
**Source:** `DIR-030` (`tasks/DIR-030.md`, restart-steering directive, item 2 of 4 in its
observe-and-enforce ordering) → `exp5-M-CRYST-E3` (`tasks/exp5-M-CRYST-E3.md`).
**Charter authored:** m41→m42 boundary, 2026-07-20. Base commit: `master` HEAD `4b5d4ed`.

## SELECT reasoning
DRAIN (this pass): no new `pending` directives — `DIR-022`/`DIR-026` remain `pending` (unchanged,
tracked as DIR-030 item 3), all others `applied`/`resolved`/`deferred`/`archived`. **DIR-030** stays
`applied` (window AC not yet satisfied — only 1/4 landed: G1 at m41). Milestone-candidate backlog:
`exp5-M-CRYST-{D1,D2,D4,E2,E3,INV,B4,B5,B6,C1,F1}`, `exp5-M-DIR022-REMAINING-GATES`, 3
`M37-discover-post-qeng` gap items, 3 STALE backfill rows.

**Chosen: `exp5-M-CRYST-E3`** — DIR-030's ordering places E3 (item 2 of 4) directly after G1 (item 1,
landed m41). No new directive or finding from this pass's DRAIN overrides that ordering: E3 is not
blocked (its dependency, B7, landed pre-restart per ADR-001's own Consequences section — confirmed by
reading `adr/ADR-001-*.md` directly this pass), `adr-store.js` already reserves the `applies-to`/
`enforcement` frontmatter fields for exactly this (E1, non-breaking to extend), and the QENG gate
registry's `impl-row`/`line-budget` wrap-a-script pattern (M39) is a direct structural precedent for
the new `adr-<id>` gate — this is additive, well-scoped work, not a driver rewrite. D2/D3/F1 remain
excluded from autonomous SELECT (`label:human-steered` fence, unaffected by DIR-030).

**Value-typed SELECT ledger entry:** value type = **governance-integrity** (primary — the decision
mechanism (`accepted` ADRs) starts actually constraining real changes, not merely recording them) +
**capability-growth** (secondary — a new, reusable quay engine capability: any future ADR can adopt
the same `applies-to`/`enforcement` → named gate path). No VT chart-1 cell (method-infra-adjacent
governance capability, not a chart-0/1 surface); Δv̂ judged on the governance-integrity/
capability-growth axis directly, consistent with the ledger's non-VT-can-outrank-VT rule and the
DoD-program lineage's own no-VT-cell precedent (M25/M32/M36/M38/M39/M40/M41).
**Governance/infra hard floor check:** E3's scope explicitly INCLUDES its own enforcement half (the
gate registration + a real GateEvent on ADR-001/B7, not merely the `applies-to`/`enforcement` schema
fields) — passes the hard floor (DIR-002/DIR-006 lesson: never ship the schema without the
enforcement).

**Not-selected notes** written directly onto each considered candidate's own task body this pass
(SELECT step, per OUTER-LOOP.md step 1's per-task inspectability requirement): `exp5-M-CRYST-D1`,
`exp5-M-DIR022-REMAINING-GATES`, `exp5-M-CRYST-INV` — each now carries a `## Not selected (M42)`
section citing DIR-030's ordering. `DIR-030`'s own `## Resolution` was updated with a dated
`## Resolution update (M42 SELECT, ...)` entry (never overwriting the m41 entry).

**Class routing (5a) — MANDATORY, dev-class applies:** E3's deliverable is real product code
(`packages/quay-native/src/adr-store.js` view-model surfacing + `packages/quay/src/gate/registry.js`
new `adr-<id>` gate-factory) — unlike M39's registry-only precedent (treated as design-class before
5a became explicitly mandatory), this milestone runs the `quay-task-to-plan` pipeline FIRST per
OUTER-LOOP.md step 5a's now-mandatory development-class routing: N=2 independent proposal subagents →
adjudication → write-back to the task's `## Proposal` → milestone-level plan (`docs/plans/*.md`) →
grounded plan-check (≤3 rounds) → THEN implementation gated by the TDD ≥80% hard gate per stage. The
downstream adversarial-audit gate (Clause 1) is unchanged; there is NO additional whole-milestone
iteration-1 re-derivation (independence is spent upstream at the proposal step + downstream at the
audit gate, per the two-class policy).

## Acceptance Criteria
Mirrors the task's own 4 Acceptance Criteria (`tasks/exp5-M-CRYST-E3.md`) exactly:
- [ ] An `accepted` ADR carrying `applies-to` + `enforcement` registers as a named `adr-<id>` quay
  gate; running it appends a real GateEvent (`gate: "adr-<id>"`, verdict pass|fail) queryable via
  `quay gate-log`.
- [ ] A change that VIOLATES an in-scope ADR makes its gate FAIL; a conforming change PASSES;
  fixtures pin both.
- [ ] ADR-001 is wired to the B7 check (`loadbearing-test-gate.mjs`/`.sh`) as its enforcement, and
  honoring/violating it is a GateEvent on a REAL object (a real load-bearing script under
  `experiments/quay-perpetual-stream/scripts/`) — not a prose claim.
- [ ] A consult surface lists the `accepted` ADRs whose `applies-to` matches a given path/scope (so
  the loop can apply them at SELECT/plan/review).

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware — task already checklist-form], 1 per-milestone acceptance audit [unconditional],
2 V_meta consolidation-lag, 3 line-budget, 4 impl-row — N/A [this milestone's own output IS the
mechanism: a real ADR enforced by a real gate, not a design doc awaiting a future `-IMPL`], 5
no-self-exemption, 6 escrow-Δv — N/A [not design-only; ships real, tested product code], 7
test-floor — **APPLIES** [`surface:cli`, real product code added to `adr-store.js`/`registry.js`;
strict TDD ≥80% coverage per the quay-task-to-plan pipeline's own hard gate — re-confirm the ACTUAL
coverage number at ABSORB, do not assume met], 8 task canonical-lifecycle-record [task already
carries `## Proposal`/`## Plan` scaffolding, to be filled by the pipeline], 9 split-or-commit [this
candidate was NOT split — fully completable within one milestone per the sizing check below]). No
task-specific exemption from any clause.

## Value hypothesis
- Value type(s): **governance-integrity** (primary) + **capability-growth** (secondary), per the
  value-typed SELECT ledger above.
- **Δv̂:** no VT chart cell expected (governance/method-infra-adjacent surface, mirrors the
  DoD-program lineage's own no-VT-cell precedent); value is instead measured directly by the metric
  `Y` below — re-confirm the realized reading at ABSORB rather than assume.
- Metric `Y`: the task's 4 Acceptance Criteria, verbatim (see task file) — specifically, whether
  ADR-001 is enforced by a real named `adr-001` gate producing a real GateEvent against B7, whether a
  violating vs conforming case is fixture-pinned, and whether a consult surface lists in-scope
  accepted ADRs.

## Current-state notes (re-verified directly against source at charter-authoring time)
- `packages/quay-native/src/adr-store.js` (lines ~11-13, ~26): `applies-to`/`enforcement` are
  RESERVED (round-tripped verbatim as unowned frontmatter keys) but NOT yet surfaced in the ADR
  view-model (`toViewModel`, lines ~110-121) — this milestone's in-scope work extends the view-model
  to expose them, non-breaking (E1's own design intent, confirmed by reading the file directly).
- `adr/ADR-001-tdd-scope-product-code-red-green-80-stage-load-bearing-metho.md`: `status: accepted`
  (confirmed). Its Consequences section already names the mechanical enforcement of Decision clause 2
  as `experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.mjs` (wrapper `.sh`, selfcheck
  `.sh`) — this is B7's landed deliverable, confirmed present on disk.
- `packages/quay/src/gate/registry.js` currently exports 4 gates: `dod`, `acceptance`, `impl-row`,
  `line-budget`. The `impl-row`/`line-budget` pair (M39) is the direct structural precedent for a new
  `adr-<id>` gate-factory: read `task.extra.<argsKey>`, shell out via `runAcceptance`, map exit code —
  same wrap-a-script, no-duplicated-logic discipline this milestone must follow for `adr-<id>`.
- No existing CLI/MCP surface lists `accepted` ADRs filtered by `applies-to` scope match — genuinely
  new work (the "consult surface" AC), not a rename/refactor of something existing.

## In scope
1. Extend `adr-store.js`'s ADR view-model to surface `applies-to` (scope globs) and `enforcement`
   (named check reference) — reading existing reserved frontmatter, non-breaking.
2. A new gate-factory in `packages/quay/src/gate/registry.js` (or a small new helper module it
   imports) that, given an ADR id, looks up its `enforcement` field and registers/runs it as a named
   `adr-<id>` gate via the SAME wrap-a-script (`runAcceptance`) mechanism `impl-row`/`line-budget`
   already use — no duplicated process-spawn/timeout logic.
3. Wire `adr-001` concretely to the B7 check (`loadbearing-test-gate.sh`), so `quay gate <task> --gate
   adr-001` (or an equivalent invocation the implementation settles on and documents) runs B7 for
   real and appends a real GateEvent.
4. Fixture pair proving BOTH directions: a conforming case (B7 passes) → `adr-001` gate PASS; a
   violating case (a synthetic load-bearing script missing its sibling test) → `adr-001` gate FAIL.
5. A consult surface (CLI/MCP) listing `accepted` ADRs whose `applies-to` glob matches a given
   path/scope argument.
6. TDD ≥80% coverage on all new/touched product code (`adr-store.js` extension, the new gate-factory,
   the consult surface), test-first per ADR-001 itself (the milestone dogfoods the very ADR it
   enforces).

## Explicitly OUT of scope
- Wiring EVERY `accepted` ADR as a gate this milestone — only ADR-001 is concretely wired end-to-end
  (the task's own "first wired case" framing); the mechanism must be reusable for future ADRs but
  this milestone does not retroactively wire ADR-002/003/011.
- `exp5-M-DIR022-REMAINING-GATES` (registering vmeta-lag/audit/escrow/test-floor as named gates) —
  deferred per DIR-030's ordering, not touched by this milestone (though this milestone's `adr-<id>`
  factory may be a reusable building block for it — note but do not build ahead).
- `exp5-M-CRYST-{D1,INV}` — deferred per DIR-030's ordering, not touched.

## Done-when (binary clauses)
Mirrors the task's 4 Acceptance Criteria exactly (see task file) plus:
1. `quay gate <task> --gate adr-001` exits 0 against a conforming real object and 1 against a
   synthetic violating fixture; both leave real GateEvents in `quay gate-log`.
2. `node --test --experimental-test-coverage` on the touched packages shows ≥80% line coverage on
   every new/touched product file (paste real output, not restated from memory).
3. The consult surface, invoked against a real path, returns `ADR-001` (or explicitly states why not,
   if `applies-to` was scoped elsewhere by the implementation) — run live, not asserted.

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
  (its source is a live task, `exp5-M-CRYST-E3`, and a live directive, `DIR-030`, both read directly).
- `it0-ceiling-line-budget-check.sh` against this charter: 6 in-scope items across 2 product files +
  1 new small helper + fixtures — small-to-moderate; run before dispatch (below); if flagged, resize
  before dispatch per the gate's own rule.
- `it0-impl-row-check.sh`: N/A — this milestone's own output is the real-landing proof itself (a real
  ADR enforced by a real gate), not a design doc awaiting a future `-IMPL` row.
- Domain-misfit audit-channel: an independent mechanism IS reachable — the adversarial audit can
  independently re-run `quay gate <task> --gate adr-001` against both the conforming and violating
  fixtures and confirm the GateEvents/exit codes match the claimed AC, exactly as prior gate-registry
  milestones' audits have done (M38/M39 precedent).

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
Dispatch a fresh-context, out-of-band adversarial-audit subagent at ABSORB, refute-first stance
against this task's 4 AC clauses + DoD, mirroring M38/M39/M41's own audit discipline. The audit
should specifically probe: (a) does `adr-001` gate genuinely invoke B7 (re-run independently,
confirm no hardcoded pass), (b) does the violating fixture genuinely FAIL the gate (re-run
independently against a synthetic violating case), (c) is the GateEvent real and queryable via
`quay gate-log --json` (paste raw output), (d) does the consult surface actually run against a real
path and return ADR-001 when in scope, (e) is coverage genuinely ≥80% on every new/touched file
(re-run `node --test --experimental-test-coverage` independently, diff against the claimed number).
Per DIR-020/M34's standing write-back mechanism, the audit ticks `- [x]` on each AC/DoD checklist
item it confirms, with an inline evidence citation per item.

## Note for ABSORB
1. Remember the Clause 2 exact-phrase requirement: dashboard text must contain the literal substring
   "V_meta consolidation-lag" (or "V_meta consolidation lag").
2. Remember the `it0-dod-check.sh` invocation convention: task id (not milestone id) as the first
   argument — `exp5-M-CRYST-E3`.
3. Per M38/M39/M41's own precedent, this milestone's ABSORB should invoke `quay gate exp5-M-CRYST-E3`
   as its own DoD meta-enforcer check.
4. Confirm DIR-030's `## Resolution update (M42 SELECT)` note (already appended at SELECT) still
   accurately describes the outcome once ABSORB completes (re-read, do not silently leave stale if
   the outcome diverges from what SELECT predicted). If E3 lands, DIR-030 window progress becomes
   2/4 — still short of the ≥3/4 needed before D1 is eligible.
5. **Checkpoint cadence:** last checkpoint written was cp-40 at m40 (every-5-milestone cadence, next
   DUE at m45) — NOT due at this ABSORB (`milestone_counter` becomes 42).

## Dispatcher notes
Dev-class routing (5a): FIRST invoke `/quay-task-to-plan exp5-M-CRYST-E3` (N=2 independent proposal
subagents → adjudication → write-back → milestone-level plan record under `docs/plans/` → grounded
plan-check ≤3 rounds), THEN dispatch the implementation against the checked plan. If
`baime:iteration-executor` subagent dispatch is unreachable in this session (as it was at m41),
fall back to isolated-worktree DIRECT EXECUTION by this orchestrator itself, still preserving the
pipeline's independent-diversity structure (N=2 independent proposal drafts, genuinely blank-slate,
not the same context reused) — state explicitly in the report which pattern was used and why.
