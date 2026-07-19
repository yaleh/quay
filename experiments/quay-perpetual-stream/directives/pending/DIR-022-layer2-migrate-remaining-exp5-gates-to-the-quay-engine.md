# DIR-022

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-19
- title: Layer 2 of switching exp5 onto the quay engine — migrate the OTHER exp5 gates (adversarial-audit, V_meta-lag, impl-row, escrow-Δv, test-floor, line-budget) to run THROUGH the engine as registered quay gates / acceptance meters, each logging a GateEvent for the real milestone, so ABSORB's whole gate set is engine-run, not prose

## Finding

QENG-5 / DIR-021 wire only the DoD-meta-enforcer path. exp5's other ABSORB gates —
**adversarial-audit** (DIR-007), **V_meta consolidation-lag** (DIR-005),
**design-only-milestone impl-row** (DIR-016), **escrow-Δv** and **product-work
test-floor** (M32), and the plan-time **line-budget** gate (M18) — still run as
prose + `it0-*.sh`, NOT via the quay engine, and record verdicts only as dashboard
prose. So even with Layer 1, most of ABSORB's gating is still off-engine.

## Requested action

1. **Register each remaining gate in the engine.** In
   `packages/quay/src/gate/registry.js` add a gate per exp5 gate that shells out to
   its existing `it0-*.sh` (impl-row → `it0-impl-row-check.sh`; line-budget →
   `it0-ceiling-line-budget-check.sh`; DoD-composite already via `it0-dod-check`),
   OR express it as the milestone task's `extra.acceptance` where a single command
   suffices. The judgment gates (adversarial-audit, V_meta-lag) that are
   documentation-discipline checks stay as their it0-dod-check clauses but are
   invoked THROUGH the engine. Reuse the it0 scripts as-is — do NOT rewrite gate
   logic. New quay code (registry gates) carries ≥80% tests.
2. **ABSORB invokes each via the engine.** `OUTER-LOOP.md` step 6 runs the
   applicable gates as `quay gate <milestone-task> --gate <name>` (or a single
   `quay complete` that runs the gate set), each appending a GateEvent, and pastes
   the engine output as evidence.

## Acceptance Criteria (runnable)
- [ ] `quay gate --list` includes the migrated gate names (beyond `dod`/`acceptance`).
- [ ] For each migrated gate, `quay gate <task> --gate <name>` exits 0/1 correctly
  (real milestone or a pinned fixture) and appends a GateEvent.
- [ ] Any NEW `packages/quay/src/gate/*` code has ≥80% coverage:
  `node --test --experimental-test-coverage packages/quay/test/*.mjs` (paste output).

## Definition of Done — REAL LANDING is the bar, not artifacts

**NOT done** when registry entries exist or fixtures pass. Done **ONLY** when a
**REAL exp5 milestone's ABSORB** has run **ALL its applicable gates THROUGH the
engine**, verifiable by:
(a) `quay gate-log <that-real-milestone-task> --json` containing a GateEvent for
    EACH applicable gate (not just `dod`), AND
(b) that milestone's dashboard ABSORB entry citing the engine gate runs (the
    `quay gate --gate <name>` outputs) as the gate evidence.
Registry code + green fixtures are necessary but NOT sufficient — a real milestone
must have passed its full gate set through the engine. Stays `pending` until then.

**Anti-"thin milestone" clause (closes the `applicable` escape hatch).** "All its
applicable gates" MUST NOT be gamed by landing this DIR on a milestone that claims
only `dod` (or one gate) applies. This DIR is landed **only** on a milestone whose
ABSORB genuinely exercises **≥2 DISTINCT non-`dod` gates** engine-run (e.g. a
design-only milestone that triggers BOTH `impl-row` AND `escrow-Δv`, or a
product-code milestone that triggers `test-floor` AND `line-budget`), with a
GateEvent per gate in the log. If the chosen milestone legitimately has few
applicable gates, that is NOT sufficient evidence — pick (or wait for) a milestone
that actually drives the migrated gate set, or the migration is unproven. A
`QENG-5-DEMO-*` fixture task or any synthetic stub is explicitly disallowed as the
landing milestone (same bar as [[DIR-021]]).

**Layer ordering (no leap-frogging).** Layer 2 presupposes Layer 1's REAL landing:
the milestone that lands this DIR must ALSO have its `dod` gate engine-run per
[[DIR-021]] (its `dod` GateEvent present in the same `gate-log`). A milestone whose
`dod` path is still bare `it0-dod-check.sh` cannot be used to mark Layer 2 done.

## Human verification when exp5 marks this DIR done
1. For a real milestone ABSORBed under this DIR, `quay gate-log <its-task-id> --json`
   MUST show a GateEvent per applicable gate (audit / vmeta / impl-row / escrow /
   test-floor as they apply), each keyed to that real task id.
2. Its dashboard ABSORB entry MUST reference the engine gate runs, not only prose.
3. If only `gate --list` grew or fixtures pass, with no real milestone's full gate
   set in the gate-log, it is NOT landed — send back.

## Resolution
<!-- added when moved to archive/, or updated in place if deferred -->
