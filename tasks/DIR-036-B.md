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

**dirStatus: deferred — ABSORBED by [[DIR-061]]** (updated 2026-07-23; supersedes the 2026-07-21 note below).

Two updates reconcile this task with reality:

1. **The "blocked by" claim is stale.** DIR-036-B's blockers — DIR-045 (loop-driver real-landing on
   archguard) and DIR-046 (gate-cwd) — are BOTH now `status: done` (DIR-045 dirStatus=applied, DIR-046
   dirStatus=resolved). This task is no longer blocked; the 2026-07-21 "pending DIR-045" note is
   obsolete.

2. **Absorbed by DIR-061.** The remaining substance of DIR-036-B — a REAL loop-skill-driven archguard
   milestone, DoD-audited, proving the methodology/product transfers to a foreign repo — is now owned
   by [[DIR-061]] (complete productized delivery), whose Requested-action #5 and its 4th Acceptance
   Criterion require exactly this: in a clean foreign workspace (archguard), after installing the
   published artifacts, the plugin's `loop-driver` SELECTs a task and writes a status transition back
   through the real Provider ABI, observed in a durable artifact. DIR-061 SPLITs that into completable
   children (incl. the archguard e2e proof). **Do not independently work DIR-036-B — track it under
   DIR-061's archguard-e2e child.** Its `human-steered` label remains correct (cross-workspace
   tmux remote-drive under single-driver hygiene — cannot race archguard's own live session).

_Historical (2026-07-21, M76→M77 boundary, now superseded):_ **dirStatus: deferred** — human-steered;
blocked by DIR-045 + DIR-046. The partial realization (outwardVT: "foreign tasks driven = 9, external
deployments = 1 — quay is archguard's task backend") did NOT satisfy DIR-036-B's DoD: a REAL
loop-skill-driven archguard milestone with DoD-audited by it0 had not yet run cleanly (the earlier
hand-driven instance was explicitly called out as insufficient). Pending DIR-045 real-landing completion.
