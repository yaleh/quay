---
id: exp5-M-PRODUCTIZED-DELIVERY-A
title: "Productized delivery child A: version single-source + fail-closed drift
  gate (all 4 packages + plugin.json + both marketplace.json + vendored Core
  carry ONE version) — RED+GREEN on the real tree"
status: todo
labels:
  - milestone-candidate
  - milestone:M-126
parent: exp5-M-PRODUCTIZED-DELIVERY
children: []
extra:
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-M-PRODUCTIZED-DELIVERY-A
    experiments/quay-perpetual-stream/charters/M126-productized-delivery-a-version-consistency.md
    /tmp/m126-absorb-entry.md
  schema: v1
---
## Proposal

SPLIT-OR-COMMIT child 1 of [[exp5-M-PRODUCTIZED-DELIVERY]] (DIR-061), attacking the **version-consistent**
conjunct of chart-2 **S2 Delivery-completeness** (`cov = (published ∧ version-consistent ∧ foreign-install-e2e-green)/total`,
currently 0.00). DIR-061 recorded a real 5-way version drift for the same plugin (installed cache,
`plugin.json`, two `marketplace.json`, vendored Core). This child establishes ONE source of truth for the
version and a **fail-closed** check that FAILs on any drift and PASSes only when every version-bearing
artifact carries the same version.

Loop-autonomous (scripts + tests + a gate; edits no driver file). Selectable immediately — DIR-060 is
applied and this child has no upstream dependency. This is real product-pipeline work, not instrument
work, and is a prerequisite for the [[exp5-M-PRODUCTIZED-DELIVERY-C]] real release.

## Plan
N/A — focused milestone. Design surface (the single-source location + the enumerated version-bearing set)
is small and fixed by DIR-061's recorded drift inventory.

## Acceptance Criteria
- [x] A version-consistency check script exists, enumerates EVERY version-bearing file (the ≥5 in DIR-061's
  drift inventory — list pasted), and reads each one's version.
- [x] RED: with one manifest intentionally drifted, the check exits non-zero — pasted.
- [x] GREEN: with all unified to one version, the check exits zero on the real tree — pasted.
- [x] Sibling `*.test.mjs` ≥80% coverage; `loadbearing-test-gate.sh` PASS.
- [x] `node --test $(ls packages/quay/test/*.mjs | grep -vE 'serve-github|provider-abi-conformance')` stays green.

## Definition of Done
Standard inherited-core DoD clauses apply. Per DIR-026 Reading A: a check that merely EXISTS is
necessary-not-sufficient — done ONLY when a real drift was actually CAUGHT (RED) and a real unification
actually PASSED (GREEN) on this repo's real tree, both pasted.
- [x] RED+GREEN demonstrated on the real tree (not fixture-only).
- [x] The check is a load-bearing script with a passing sibling test (≥80%).
- [ ] it0 DoD meta-enforcer passes all clauses.
- [x] No driver file touched (`git show --stat` confined to `packages/`/`plugin/`/`scripts/` + tests).