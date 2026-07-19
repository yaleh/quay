---
id: exp5-M-CRYST-B7-LOADBEARING-TEST-GATE
title: "B7 Enforce ADR-TDD clause 2: gate that flags a load-bearing
  scripts/*.mjs lacking a sibling *.test.mjs"
status: done
labels:
  - milestone-candidate
  - crystallization
parent: exp5-M-CRYST
children: []
extra:
  schema: v1
---
## Proposal
ADR-TDD Decision clause 2 requires load-bearing method-infra (validators/gates/meters that other code depends on) to be fixture-first + ≥80% covered, but this is enforced NOWHERE — the Clause-7 test-floor only triggers on `surface:` product labels. Per ADR-DILUTION, a rule enforced only as prose is molten. Build a mechanical check: flag any "load-bearing" `experiments/**/scripts/*.mjs` that lacks a sibling `*.test.mjs` (or coverage below floor). "Load-bearing" = imported by another script, wraps/backs a `quay gate`, or gates `milestone_counter++`. Follow the single-source template (a `scripts/*.mjs` check wrappable by a future `quay gate --gate <name>`, never reimplemented).

## Plan
N/A — one check module + selfcheck fixtures (RED-then-GREEN per ADR-TDD); no staged docs/plans doc warranted.

## Acceptance Criteria
- [x] A check enumerates load-bearing scripts and FAILs when one lacks a sibling `*.test.mjs`; a covered one PASSes; fixtures pin both; the check itself is fixture-first + covered (dogfoods ADR-TDD).
- [x] `task-schema.mjs` (and the other current load-bearing gates) PASS the check — the debt paid in the ADR-TDD increment is confirmed by the gate, not just asserted.
## Definition of Done
References the standard inherited-core DoD clauses. Real landing:
- [x] The gate HARD-flags a real load-bearing script with no test; single-source (script) + wrappable by quay, no logic duplicated.
- [x] Cited by ADR-TDD as the mechanical enforcement of its Decision clause 2.

## Execution record
Strict TDD per ADR-001 (RED→GREEN), single-source template mirroring `task-schema.mjs` +
`vmeta-lag-check.mjs` (module + `-check`/`-gate.sh` wrapper + `-selfcheck.sh` external predicate over
`fixtures/loadbearing/`).

**Files (all new except the ADR note):**
- `experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.mjs` — single-source module. The
  `load-bearing` mechanical criterion is documented in the header: load-bearing iff (a) imported by
  another module, (b) registered in `packages/quay/src/gate/registry.js`, or (c) named by
  `OUTER-LOOP.md` in the same bullet block as a `milestone_counter++` token. Sibling test =
  `<name>.test.mjs` under a `test/` dir. Per-script verdict PASS/FAIL/N-A (N/A is EXPLICIT — never a
  silent skip).
- `experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh` — thin wrapper (wrappable by a
  future `quay gate --gate loadbearing-test`).
- `experiments/quay-perpetual-stream/scripts/loadbearing-test-gate-selfcheck.sh` — external acceptance
  predicate (3 scenarios: full-tree FAIL, criterion-a-only PASS, usage error).
- `experiments/quay-perpetual-stream/test/loadbearing-test-gate.test.mjs` — 22 unit tests.
- `experiments/quay-perpetual-stream/fixtures/loadbearing/` — fake load-bearing tree (imported/registered/
  counter-gate scripts, one WITH sibling test → PASS, two WITHOUT → FAIL, one non-load-bearing → N/A).

**RED→GREEN:** confirmed RED (module absent → `ERR_MODULE_NOT_FOUND`), then GREEN 22/22.
**Coverage:** 99.14% line, 100% function (`node --test --experimental-test-coverage`), well past the
≥80% floor. **Selfcheck:** exit 0 (all 3 scenarios as asserted).

**Real-repo run (AC2 — debt confirmed by the gate, not asserted):**
```
task-schema.mjs     — PASS (load-bearing: imported; has test/task-schema.test.mjs)
vmeta-lag-check.mjs — PASS (load-bearing: counter-gate; has test/vmeta-lag-check.test.mjs)
it0-dod-check.mjs   — FAIL (load-bearing: counter-gate; NO it0-dod-check.test.mjs)
(other scripts N/A) → gate exit 1
```

**OPEN FINDING (reported, NOT silently fixed per this task's step 3):** `it0-dod-check.mjs` — the DoD
meta-enforcer (Clauses 0-9), named in `OUTER-LOOP.md` as a `milestone_counter++` HARD-BLOCK gate — has
a fixture selfcheck (`dod-fixture-selfcheck.sh`) but no `test/it0-dod-check.test.mjs` unit test. It is a
genuine ADR-001 Decision-clause-2 gap the gate surfaces. Recommend a follow-up task to backfill its unit
tests (RED→GREEN, ≥80%), the same debt-payment `task-schema.mjs` received.

**ADR wiring:** `adr/ADR-001-*.md` "Future mechanization" bullet updated from "tracked as B7" to cite the
now-existing `loadbearing-test-gate.mjs` as the mechanical enforcement of Decision clause 2.