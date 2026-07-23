---
id: exp5-M-PRODUCTIZED-DELIVERY-C
title: "Productized delivery child C [human-steered: real outward publish]: cut a
  REAL release publishing all 4 package tarballs + the plugin bundle, version-
  consistent, runtime-smoke-green on the Node floor — flips S2 cov with real evidence"
status: todo
labels:
  - milestone-candidate
  - human-steered
parent: exp5-M-PRODUCTIZED-DELIVERY
children: []
extra:
  schema: v1
---
## Proposal

SPLIT-OR-COMMIT child 3 of [[exp5-M-PRODUCTIZED-DELIVERY]] (DIR-061) — the one that **realizes** chart-2
**S2 Delivery-completeness** by actually shipping. Cut a REAL release that publishes every artifact on the
[[exp5-M-PRODUCTIZED-DELIVERY-B]] manifest (4 package tarballs + plugin bundle), version-consistent (gated
by [[exp5-M-PRODUCTIZED-DELIVERY-A]]), passing runtime-smoke on the declared Node floor.

**`human-steered`**: a real npm/marketplace publish is outward-facing and hard to reverse — it must be
human-authorized, not loop-autonomous. Depends on A + B landing and DIR-060 applied. This is the milestone
that registers a real S2 chart-2 Δv (via DIR-064-A's S2 calculator), and the first unambiguous product-code
delivery of this epic.

## Plan
N/A — resolved via a `human-steered` real-release milestone. Sequencing fixed by DIR-061 (after A+B, after
DIR-060).

## Acceptance Criteria
- [ ] A real release run publishes tarballs for EVERY package on the manifest AND the plugin bundle — real
  run id / published locations pasted.
- [ ] The version-consistency gate (child A) and the manifest↔release.yml gate (child B) are both GREEN in
  that real run — logs pasted.
- [ ] Runtime-smoke passes for the published artifacts on the declared Node floor — pasted.
- [ ] DIR-064-A's S2 cov calculator, re-run against the real published state, shows the increase — before/
  after pasted.

## Definition of Done
Standard inherited-core DoD clauses apply, incl. escrow-Δv. Per DIR-026 Reading A: a green dry-run is
necessary-not-sufficient — done ONLY when a REAL release actually published the full manifest set (a real
observed object, not "should publish").
- [ ] Real published artifact set == manifest set, verified post-publish (not a plan).
- [ ] Real S2 chart-2 Δv registered in a real checkpoint/dashboard entry (measured by DIR-064-A's calculator).
- [ ] Authored `human-steered` (real outward publish authorized by the human), independently adversarial-audited.
- [ ] it0 DoD meta-enforcer passes all clauses.
