---
id: exp5-M-CRYST-B1
title: B1 Canonical task schema — one shape for all task kinds (Proposal req /
  Plan opt / AC,DoD checklists; lifecycle via fields; retire status-mirror
  Resolution)
status: done
labels:
  - milestone-candidate
  - crystallization
  - milestone:first-wave
parent: exp5-M-CRYST
children: []
extra:
  schema: "v1"
---
## Proposal
(Adjudicated from 2 independent blank-slate proposals via the proposal-to-plan discipline; the coupled enforcement-with-design unit B1+B2+B3 lands together.)

**Single source = the VALIDATOR (code) IS the schema definition.** Adjudication rejected the "schema doc (`.claude/tasks-schema.json`) + separately-hardcoded validator" shape — that is a dual source that drifts (the fatal silent-drift risk). Instead: ONE artifact — a `task-schema-check` (extend `it0-dod-check.mjs` Clause 0 into, or a sibling `scripts/task-schema-check.mjs`) — IS the canonical definition; a human-readable schema is a co-located comment / generated view, never a second hand-authored source.

**The 6 canonical assertions (checklist form validated):**
1. `## Proposal` REQUIRED, non-placeholder (directive: folds Finding+Requested action / a `## Context` lead-in; authored per proposal-to-plan discipline). 2. `## Plan` optional-but-constrained: a resolving `docs/plans/*.md` ref OR `N/A — <reason>`; a `milestone-candidate` task MUST carry one, a directive MAY omit. 3. `## Acceptance Criteria` REQUIRED, GFM checklist. 4. `## Definition of Done` REQUIRED, GFM checklist referencing the standard clauses. 5. NO status-mirror `## Resolution` (no empty placeholder; no `outcome: applied|deferred` restating status) — evidence goes in `## Execution record` appended at close. 6. NO projection scaffolding (`Source:` line / `extra.dirFile`) and NO lifecycle duplication (no body `dirStatus:` line — lifecycle is frontmatter fields only).

**B3 authoring-source fixes (root cause):** `/quay-directive` skill + OUTER-LOOP SELECT emit the schema by construction — retire the empty-Resolution template + the dirStatus body-line; author `## Proposal` (proposal-to-plan) + `## Plan`; AC/DoD as checklists.

**Migration (B4): forward-only + grandfather legacy** (like DIR-020/M34); the validator N/A-reports pre-cutover tasks, never silently.

**Transition safety (no silent drift — the hard rule):** two mechanical proofs at landing: (P1) conformance sweep — `task-schema-check tasks/*.md` PASSes or explicitly N/A-reports every task (no silent skip); (P2) round-trip — create ONE directive via the rewritten skill AND one milestone task via SELECT, read back, run the check → PASS. A detectable switchover error is acceptable; a silent one is not.

## Plan
N/A — pending the PLAN stage (grounded plan authored next per the pipeline); will reference a docs/plans/*.md if the implementation warrants staging.

## Acceptance Criteria
- [ ] ONE artifact is the schema source (the validator); no separate hand-authored schema doc that can drift.
- [ ] `task-schema-check` HARD-fails each of: missing/placeholder Proposal; prose (non-checklist) AC or DoD; status-mirror/empty Resolution; body `dirStatus:` line or `Source:`/`extra.dirFile` scaffolding; and PASSes a compliant task. Fixtures pin all.
- [ ] `/quay-directive` skill + OUTER-LOOP SELECT emit the schema by construction (round-trip P2 passes with zero manual fixup).
- [ ] Conformance sweep (P1) over `tasks/*.md` reports every task PASS or explicit-N/A (no silent skip).
## Definition of Done
References the standard inherited-core DoD clauses. Real landing, not artifacts:
- [ ] B1+B2+B3 ship together (the coupled enforcement-with-design unit).
- [ ] A REAL new directive AND a REAL milestone task both round-trip schema-clean (P2), read back and checked → PASS.
- [ ] The conformance sweep (P1) is green/explicit — every task PASS or explicit-N/A-legacy, no silent skip.
- [ ] Net-subtractive: retired templates/lines > added.
- [ ] No silent drift: the check HARD-catches a synthetic non-conforming task (fixtures pin it).

---
_2026-07-19T14:06:16.348Z_: ## Proposal-check (grounded, 2026-07-19) — CONCERNS (proceed; 7 plan-stage fixes)
1. Decide extend-Clause-0 vs sibling task-schema-check (avoid a 2nd instantiation that drifts).
2. Grandfather: make the pre-cutover boundary mechanical + prove every M>=40 task has/gets Proposal+Plan; block a new M>=40 without them.
3. Enforce directive-vs-milestone shape MECHANICALLY (label-aware): directive MAY omit Plan; milestone-candidate MUST have it — validator currently has no label logic.
4. POLICY: reconcile 'HARD-fail prose AC/DoD' vs Clause 0's backward-compat (which SKIPS prose). Decide forward-only-hard-fail vs preserve-compat.
5. Implement the missing Resolution check (Clause 8 has none) — no status-mirror/empty ## Resolution.
6. Specify the scaffolding-detection regex (Source: line / extra.dirFile) — false-positive-safe (DIR-009/010 legitimately mention 'Status mirror' in prose).
7. Run the P1 conformance sweep NOW (review window), not at landing.
