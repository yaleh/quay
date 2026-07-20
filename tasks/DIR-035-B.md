---
id: DIR-035-B
title: "DIR-035 split B: data-driven gate set — move it0-*/vmeta-lag/audit-independence/dogfood-evidence built-ins out of the product's default registry (delivery-standalone-smoke blockers 1/5)"
status: todo
labels:
  - directive
  - milestone-candidate
parent: DIR-035
children: []
extra:
  dirStatus: pending
  schema: "v1"
---
## Proposal
Second child slice of [[DIR-035]] (ADR-013) — NOT executed this milestone (M48 scope was
[[DIR-035-A]] only, per DIR-026 SPLIT-OR-COMMIT). Tracks ADR-013's Decision item 2 / DIR-035
Requested action item 2: the product ships the gate ENGINE + generic factories only; a gate's check
command must be DATA (an ADR/doc `enforcement:` field or a `.quay/gates.yml`), never a hardcoded
`experiments/**` path baked into `packages/quay/src/gate/registry.js`.

## Finding
`packages/quay/src/gate/registry.js` currently hardcodes 5 absolute paths under
`experiments/quay-perpetual-stream/scripts/*.sh` (`IMPL_ROW_SCRIPT`, `LINE_BUDGET_SCRIPT`,
`VMETA_LAG_SCRIPT`, `AUDIT_INDEPENDENCE_SCRIPT`, `DOGFOOD_EVIDENCE_SCRIPT`) plus
`ADR_GATE_IDS = ["ADR-001"]`. `delivery-standalone-smoke.sh` blocker (1) counts the literal
`experiments/quay-perpetual-stream` path-string occurrences these constants introduce into the
delivered artifact; blocker (5) confirms none of the 5 referenced `.sh` scripts are actually
shipped (they live under `experiments/`, outside `packages/quay`'s `files` whitelist) — so a
delivered `quay gate --list` advertises 5 gate names whose backing scripts don't exist standalone.
Both blockers are the SAME root fault (hardcoded experiment-specific gate wiring in the default
registry) and should be fixed together.

## Requested action
1. Remove the 5 hardcoded `experiments/quay-perpetual-stream/scripts/*.sh` path constants and the
   `ADR_GATE_IDS = ["ADR-001"]` hardcoded array from `packages/quay/src/gate/registry.js`'s
   shipped default registry.
2. Source these 5 gate definitions (script path + args-key + label) from WORKSPACE DATA instead —
   follow the existing `adr-<id>` gate's pattern (E3: derived from the ADR store's `enforcement:`
   field at gate-run time, not baked into the module) — e.g. a `.quay/gates.yml` (or equivalent)
   read by the registry at gate-run time, so a non-exp5 workspace's `gate --list` shows only engine
   built-ins (`dod`, `acceptance`) plus THAT workspace's own data-driven gates, and exp5's
   instance-specific gates are sourced from exp5's OWN workspace config, not the product's shipped
   default.
3. Re-point exp5's own `.quay/config.yml` (or equivalent) to declare these 5 gates as its own
   workspace data, preserving their exact current behavior for exp5's own OUTER-LOOP ABSORB gate
   usage (no functional regression to the currently-passing DIR-034/M47 mechanization).

## Acceptance Criteria
- [ ] `bash packages/quay/test/delivery-standalone-smoke.sh` blockers 1 and 5 both go GREEN (0 RED total, combined with DIR-035-A's already-green 2/3/4).
- [ ] `grep -rnE 'experiments/quay-perpetual-stream' packages/quay/src packages/quay/bin` returns nothing.
- [ ] A fresh non-exp5 workspace's `quay gate --list` shows only engine built-ins + that workspace's own data-driven gates (demonstrated with a real fresh `.quay/config.yml`, not asserted).
- [ ] exp5's own ABSORB gate usage (`quay gate <milestone-task>` per OUTER-LOOP.md step 6) is behavior-preserved — a real milestone's DoD meta-enforcer run still passes exactly as before, evidenced by re-running it0-dod-check.mjs's own selfcheck fixtures green.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING. Done ONLY when:
- [ ] The data-driven sourcing mechanism is demonstrated on a REAL foreign (non-exp5) workspace, not just asserted in prose.
- [ ] Full existing test suite (excluding live-GitHub suites) shows no regressions.
- [ ] `it0-dod-check.mjs`'s own fixture selfcheck (`dod-fixture-selfcheck.sh`) still passes unchanged.

## Not selected (M48)
Considered as this milestone's slice alongside DIR-035-A; NOT selected — DIR-026 SPLIT-OR-COMMIT
requires each milestone complete ONE whole child, and A (the architecture-violation half, "do
first" per DIR-035's own Requested action ordering) was smaller, more self-contained, and correctly
sequenced before B (which depends on A's move having already landed cleanly, since B's data-driven
registry refactor touches the same file A's import-path fix touches). Deferred to a future
milestone's SELECT.
