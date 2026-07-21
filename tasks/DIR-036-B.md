---
id: DIR-036-B
title: "DIR-036 child B (Level 3 — application): the single-sourced methodology
  kit drives ONE real OUTER-LOOP milestone DEVELOPING archguard, DoD-audited by
  it0-dod-check keyed to that real foreign-repo milestone (the V_meta transfer
  test) — depends on DIR-036-A"
status: todo
labels:
  - directive
  - human-steered
parent: DIR-036
children: []
extra:
  dirStatus: deferred
---
## Proposal
Level 3 of ADR-013's Validation Ladder — the methodology KIT (single-sourced at [[DIR-035-D]]) drives ONE real OUTER-LOOP milestone DEVELOPING archguard, DoD-audited by the it0 meta-enforcer. This is the **V_meta transfer test**: the loop's methodology, moved off quay's own repo, produces a real code milestone on a foreign product. The loop's `V_meta` has never had an external gradient — every prior milestone developed quay itself; this is the first time the methodology is measured against a repo it did not grow up in. Depends on [[DIR-036-A]] (product deployed on archguard first). Child of [[DIR-036]].

## Plan
N/A — resolved via an archguard-development milestone.

## Resolution

**dirStatus: deferred** — human-steered (label present); blocked by DIR-045 (loop-driver real-landing on archguard) + DIR-046 (gate-cwd). The partial realization (outwardVT: "foreign tasks driven = 9, external deployments = 1 — quay is archguard's task backend") does NOT satisfy DIR-036-B's DoD: a REAL loop-skill-driven archguard milestone with DoD-audited by it0 has not yet run cleanly (the earlier hand-driven instance was explicitly called out as insufficient per the authorized note).

Deferred at boundary M76→M77 (2026-07-21). Pending DIR-045 real-landing completion.
