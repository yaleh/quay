# Charter M43-dir022-remaining-gates — DIR-022 remainder: register vmeta-lag
# + dogfood-evidence as named engine gates, prove multi-gate ABSORB, DIR-030
# item 3/4

**Milestone id:** M43-dir022-remaining-gates · **surface:** cli (adds real code to
`packages/quay/src/gate/registry.js`, a product file — Clause 7 test-floor APPLIES) · **type:**
governance-integrity (primary — makes `quay gate-log` the real audit trail, unblocks DIR-024) +
capability-growth (secondary — two new reusable named engine gates)
**Source:** `DIR-030` (`tasks/DIR-030.md`, restart-steering directive, item 3 of 4 in its
observe-and-enforce ordering) → `exp5-M-DIR022-REMAINING-GATES` (`tasks/exp5-M-DIR022-REMAINING-GATES.md`).
**Charter authored:** m42→m43 boundary, 2026-07-20. Base commit: `master` HEAD `b5c4f80`.

## SELECT reasoning
DRAIN (this pass): `task_list --label directive` shows no NEW `pending` directives since m42 — the
same pre-existing set is open (`DIR-022` pending — parent whose remainder THIS milestone tracks;
`DIR-026` pending — split-or-commit real-landing gap, tracked separately, not overriding; `DIR-031`
pending — tree-hygiene, tracked separately). `DIR-030` stays `applied` (window AC not yet satisfied
— 2/4 landed: G1 m41, E3 m42).

**Chosen: `exp5-M-DIR022-REMAINING-GATES`** — DIR-030's ordering places it as item 3 of 4, directly
after E3 (item 2, landed m42). Re-derived scope at SELECT time by reading `it0-dod-check.mjs` and
`vmeta-lag-check.mjs` directly (not assumed from the task's own title):
- **vmeta-lag** IS a real standalone script (`vmeta-lag-check.mjs [--counter N] <ledger-file>`),
  same positional-args shape `impl-row`/`line-budget` (M39) already wrap — a clean, direct-precedent
  new named gate.
- **audit** already exists as a GateEvent name (`quay adjudicate` → `lifecycle.js#runAdjudicate`,
  wraps `taskCheck`) — a DIFFERENT check than the exp5 per-milestone adversarial-audit narrative.
  Registering a SECOND gate under the same name would collide; the nearest genuinely-missing
  mechanized check is `it0-dogfood-evidence-gate.sh` (the fenced-block-proximity heuristic) — wrap
  that as `dogfood-evidence` instead.
- **escrow-Δv**/**test-floor** are NOT standalone scripts — they are Clauses 6/7 INSIDE
  `it0-dod-check.mjs`, already run (and gated) via the existing `dod` named gate. Registering them
  as SEPARATE named gates would duplicate logic already covered by `dod` — a violation of this same
  task's own single-source DoD clause. Scope is revised to explicitly document this (not silently
  drop it) rather than build duplicate gates.

Revised, sized scope: register **vmeta-lag** + **dogfood-evidence** as new named engine gates (thin
wraps, `makeIt0Gate`-style factory, M39 precedent); document why escrow-Δv/test-floor/audit do NOT
get separate gates; and use THIS milestone's OWN real ABSORB as the "≥2 distinct non-`dod` gates on
a REAL milestone" proof (it can run `vmeta-lag` + `line-budget`/`impl-row`/`adr-001`, all already
real registered gates, against its own real task/charter/ledger).

**Value-typed SELECT ledger entry:** value type = **governance-integrity** (primary — makes
`quay gate-log` the real audit trail DIR-024 needs, closes the DIR-022 remainder) +
**capability-growth** (secondary — two new reusable named gates, extending the M39/E3 registry
pattern). No VT chart cell (method-infra-adjacent, mirrors the DoD-program lineage's own no-VT-cell
precedent — M25/M32/M36/M38/M39/M40/M41/M42). **Governance/infra hard floor check:** scope explicitly
includes its own enforcement half (real GateEvents on a real milestone, not just registry entries) —
passes the hard floor.

**Not-selected notes** written directly onto the two other DIR-030 window candidates this pass:
`exp5-M-CRYST-D1` and `exp5-M-CRYST-INV` each now carry a `## Not selected (M43)` section. `DIR-030`'s
own `## Resolution` will get a dated `## Resolution update (M43 SELECT/ABSORB, ...)` entry at ABSORB.

**Class routing (5a) — MANDATORY, dev-class applies:** deliverable is real product code
(`packages/quay/src/gate/registry.js` — two new gate-factory registrations + fixtures). Per
OUTER-LOOP.md step 5a, this milestone runs the `quay-task-to-plan` pipeline FIRST: N independent
proposal subagents → adjudication → write-back to the task's `## Proposal` → milestone-level plan
(`docs/plans/*.md`, or an explicit N/A if the pipeline concludes none is warranted given the M39
direct-precedent shape) → grounded plan-check (≤3 rounds) → THEN implementation gated by the TDD
≥80% hard gate per stage. No additional whole-milestone iteration-1 re-derivation.

## Acceptance Criteria
Mirrors the task's own 3 Acceptance Criteria (`tasks/exp5-M-DIR022-REMAINING-GATES.md`) exactly:
- [ ] `quay gate --list` includes `vmeta-lag` and `dogfood-evidence`; each `--gate <name>` exits 0/1
  against a real fixture and appends a real GateEvent; wrappers are thin (no logic duplicated — grep
  confirms single-source, same `makeIt0Gate`-style factory as `impl-row`/`line-budget`).
- [ ] The task body (or a code comment in `registry.js`) explicitly documents why `escrow-Δv`/
  `test-floor` do NOT get separate named gates (Clauses 6/7 of `it0-dod-check.mjs`, already covered
  by `dod`) and why `audit` is NOT a new gate name (already exists via `quay adjudicate`, a different
  check than the exp5 per-milestone acceptance-audit narrative).
- [ ] DoD proof: THIS milestone's own real ABSORB runs ≥2 distinct non-`dod` engine gates, each with
  a GateEvent in `quay gate-log --json` for this milestone's own task.

## Definition of Done
References the standard `inherited-core.md` Definition of Done clauses (0 AC/DoD-present
[checklist-aware — task already checklist-form], 1 per-milestone acceptance audit [unconditional], 2
V_meta consolidation-lag, 3 line-budget, 4 impl-row — N/A [this milestone's own output IS the
mechanism: real gates run on a real milestone, not a design doc awaiting a future `-IMPL` row], 5
no-self-exemption, 6 escrow-Δv — N/A [not design-only; ships real, tested product code], 7
test-floor — **APPLIES** [`surface:cli`, real product code added to `registry.js`; strict TDD ≥80%
coverage per the quay-task-to-plan pipeline's own hard gate — re-confirm the ACTUAL coverage number
at ABSORB, do not assume met], 8 task canonical-lifecycle-record, 9 split-or-commit [this candidate
was NOT split — the revised, resized scope (2 gates, not 4) is fully completable within one
milestone per the sizing check below]). No task-specific exemption from any clause.

## Value hypothesis
- Value type(s): **governance-integrity** (primary) + **capability-growth** (secondary), per the
  value-typed SELECT ledger above.
- **Δv̂:** no VT chart cell expected (governance/method-infra-adjacent surface, mirrors the
  DoD-program lineage's own no-VT-cell precedent); value is instead measured directly by the metric
  `Y` below.
- Metric `Y`: the task's 3 Acceptance Criteria, verbatim (see task file) — specifically, whether
  `vmeta-lag`/`dogfood-evidence` are real registered gates producing real GateEvents against real
  fixtures, whether the escrow/test-floor/audit non-duplication rationale is documented, and whether
  this milestone's own ABSORB demonstrates ≥2 distinct non-`dod` gates in its `quay gate-log --json`.

## Current-state notes (re-verified directly against source at charter-authoring time)
- `packages/quay/src/gate/registry.js` currently exports 6 gates: `dod`, `acceptance`, `impl-row`,
  `line-budget`, `adr-001` (E3, m42). The `makeIt0Gate(scriptPath, argsKey, label)` factory (M39) is
  the DIRECT structural precedent for `vmeta-lag`: same `[--counter N] <file>` positional-args shape,
  same fail-closed unset-args branch, same `runAcceptance` shell-out — no new mechanism needed, just
  a new `makeIt0Gate(VMETA_LAG_SCRIPT, "vmetaLagArgs", "vmeta-lag")` registration + a
  `VMETA_LAG_SCRIPT` path constant.
- `experiments/quay-perpetual-stream/scripts/it0-dogfood-evidence-gate.sh <report> [window]` — real
  standalone script, same shape (positional args + int exit code), same `makeIt0Gate` wrap fits.
- `it0-dod-check.mjs` Clauses 6/7 (escrow-Δv, test-floor) are text-scanning checks over the ABSORB
  entry / task body — they run as PART of the `dod` gate's mechanism (`it0-dod-check.mjs` IS what
  `client.taskCheck`'s underlying gate wraps for the author-gate path); a separate `escrow-delta-v`/
  `test-floor` named gate would either (a) re-invoke the same script with a subset-of-clauses flag
  that doesn't exist, or (b) duplicate the text-scan logic — both violate single-source. Confirming
  this directly (not assuming) is itself part of this milestone's Acceptance Criterion 2.
- `quay adjudicate` (`lifecycle.js#runAdjudicate`) already appends `gate: "audit"` GateEvents — a
  literal name collision with the task's original "register **audit**" framing. Resolved at SELECT
  by NOT re-registering `audit` in the gate REGISTRY (a different code path — `gateRegistry` object
  vs the `runAdjudicate` lifecycle verb) and documenting the distinction rather than silently
  colliding two different checks under one name.

## In scope
1. A `VMETA_LAG_SCRIPT` path constant + `makeIt0Gate` registration: `"vmeta-lag":
   makeIt0Gate(VMETA_LAG_SCRIPT, "vmetaLagArgs", "vmeta-lag")` in `gateRegistry`.
2. A `DOGFOOD_EVIDENCE_SCRIPT` path constant + `makeIt0Gate` registration: `"dogfood-evidence":
   makeIt0Gate(DOGFOOD_EVIDENCE_SCRIPT, "dogfoodEvidenceArgs", "dogfood-evidence")`.
3. A code comment (adjacent to the new registrations, mirroring the existing E3/M39 comment blocks'
   style) documenting: (a) why `escrow-Δv`/`test-floor` are NOT separately registered (Clauses 6/7 of
   `it0-dod-check.mjs`, already covered by `dod`); (b) why `audit` is NOT a new registry entry
   (collides with the existing `quay adjudicate` GateEvent name; a different check).
4. Fixture pairs (pass + fail) for BOTH new gates, mirroring `it0-gates.test.mjs`'s existing
   Stage 1/2/3 structure (fail-closed unset-args branch; real-script pass/fail branch; real CLI path
   `quay gate <task> --gate vmeta-lag|dogfood-evidence` + `quay gate-log --json`).
5. TDD ≥80% coverage on all new/touched code in `registry.js`, test-first per ADR-001.
6. This milestone's OWN real ABSORB proof: run ≥2 distinct non-`dod` gates against
   `exp5-M-DIR022-REMAINING-GATES` itself (or its charter/ledger files) for real, pasting both `quay
   gate` stdout and `quay gate-log --json` for each.

## Explicitly OUT of scope
- Registering `escrow-Δv`/`test-floor`/`audit` as separate named gates — explicitly rejected above
  (duplication / name-collision), documented instead of built.
- Retroactively re-running the new gates against every prior milestone's task — only THIS
  milestone's own real-landing proof is required (task's own AC framing: "a REAL milestone", not
  "every milestone").
- `exp5-M-CRYST-{D1,INV}` — deferred per DIR-030's ordering, not touched.

## Done-when (binary clauses)
Mirrors the task's 3 Acceptance Criteria exactly (see task file) plus:
1. `quay gate --list` includes `vmeta-lag` and `dogfood-evidence` (paste real stdout).
2. `quay gate <task> --gate vmeta-lag` / `--gate dogfood-evidence` exit 0 against a conforming real
   fixture and 1 against a violating one; both leave real GateEvents in `quay gate-log --json`.
3. `node --test --experimental-test-coverage` on `packages/quay` shows ≥80% line coverage on
   `registry.js` (paste real output, not restated from memory).
4. This milestone's own ABSORB pastes a real `quay gate-log <this-task-id> --json` array showing
   ≥2 distinct non-`dod` gate names.

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
  (its source is a live task, `exp5-M-DIR022-REMAINING-GATES`, and a live directive, `DIR-030`, both
  read directly).
- `it0-ceiling-line-budget-check.sh` against this charter: 6 in-scope items in ONE product file
  (`registry.js`) + fixtures — small, direct-precedent (M39/E3 shape); run before dispatch (below);
  if flagged, resize before dispatch per the gate's own rule.
- `it0-impl-row-check.sh`: N/A — this milestone's own output is the real-landing proof itself (real
  gates run against a real milestone), not a design doc awaiting a future `-IMPL` row.
- Domain-misfit audit-channel: an independent mechanism IS reachable — the adversarial audit can
  independently re-run `quay gate <task> --gate vmeta-lag|dogfood-evidence` against both conforming
  and violating fixtures and confirm GateEvents/exit codes match the claimed AC, exactly as
  M38/M39/M42's audits have done.

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
Dispatch a fresh-context, out-of-band adversarial-audit subagent at ABSORB, refute-first stance
against this task's 3 AC clauses + DoD, mirroring M38/M39/M41/M42's own audit discipline. The audit
should specifically probe: (a) do `vmeta-lag`/`dogfood-evidence` genuinely invoke their scripts
(re-run independently, confirm no hardcoded pass), (b) do violating fixtures genuinely FAIL each gate
(re-run independently), (c) are the GateEvents real and queryable via `quay gate-log --json` (paste
raw output), (d) is the escrow/test-floor/audit non-duplication rationale actually documented in the
codebase (not just asserted in the report), (e) is coverage genuinely ≥80% on `registry.js` (re-run
`node --test --experimental-test-coverage` independently, diff against the claimed number), (f) does
THIS milestone's own ABSORB really show ≥2 distinct non-`dod` gate events in its own gate-log.
Per DIR-020/M34's standing write-back mechanism, the audit ticks `- [x]` on each AC/DoD checklist item
it confirms, with an inline evidence citation per item.

## Note for ABSORB
1. Remember the Clause 2 exact-phrase requirement: dashboard text must contain the literal substring
   "V_meta consolidation-lag" (or "V_meta consolidation lag").
2. Remember the `it0-dod-check.sh` invocation convention: task id (not milestone id) as the first
   argument — `exp5-M-DIR022-REMAINING-GATES`.
3. Per M38/M39/M41/M42's own precedent, this milestone's ABSORB should invoke `quay gate
   exp5-M-DIR022-REMAINING-GATES` as its own DoD meta-enforcer check — AND additionally run
   `quay gate exp5-M-DIR022-REMAINING-GATES --gate vmeta-lag` (with appropriate `extra.vmetaLagArgs`
   seeded, e.g. `["--counter","43","v-meta-ledger.md"]`) as the milestone's own multi-gate ABSORB
   proof (Done-when clause 4 / AC3).
4. Confirm DIR-030's `## Resolution update (M43 SELECT)` note (to be appended at SELECT/ABSORB) still
   accurately describes the outcome once ABSORB completes. If this milestone lands, DIR-030 window
   progress becomes 3/4 — meeting the ≥3/4 threshold, making D1 eligible for the FIRST time at the
   next SELECT (m44) per the directive's own AC. State this explicitly in the ABSORB entry — do not
   silently leave D1 gated if the threshold is actually met.
5. **Checkpoint cadence:** last checkpoint written was cp-40 at m40 (every-5-milestone cadence, next
   DUE at m45) — NOT due at this ABSORB (`milestone_counter` becomes 43).

## Dispatcher notes
Dev-class routing (5a): FIRST invoke `/quay-task-to-plan exp5-M-DIR022-REMAINING-GATES` (N
independent proposal drafts → adjudication → write-back → milestone-level plan record under
`docs/plans/` if warranted → grounded plan-check ≤3 rounds), THEN dispatch the implementation against
the checked plan. If `baime:iteration-executor` subagent dispatch is unreachable in this session (as
at m41/m42), fall back to isolated-worktree DIRECT EXECUTION by this orchestrator itself, still
preserving the pipeline's independent-diversity structure — state explicitly in the report which
pattern was used and why.
