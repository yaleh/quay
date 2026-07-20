---
id: DIR-036-A
title: "DIR-036 child A (Level 2 — deployment): quay-the-product drives a REAL
  archguard task via the Provider ABI — first time the target leaves quay's own
  repo (.quay/config.yml enabling a quay provider over archguard's real backend;
  ABI only, no ../../../ path)"
status: todo
labels:
  - directive
  - human-steered
parent: DIR-036
children: []
extra:
  dirStatus: pending
  schema: v1
  blockedBy: none — DIR-035-D done (M52), dependency gate green
---
## Proposal
Level 2 of ADR-013's Validation Ladder — the FIRST time quay-the-product drives a real task board OFF its own repo. Deploy the now-standalone quay (delivery-standalone-smoke 0 RED; DIR-035 A–D done, [[DIR-035-D]] landed M52) against **archguard** (primary target so this deployment and [[DIR-036-B]]'s application land on the SAME foreign repo, matching ADR-013's own named example; meta-cc is a fast second deployment afterward). A `.quay/config.yml` in an archguard checkout enables a quay provider — quay-github mapping archguard's GitHub issues, or quay-native over archguard's own task store, whichever archguard actually uses. Core reaches it ONLY through the Provider ABI, never a `../../../` file path. This is the external, unbounded, honest value signal that re-lights `L_T` (2026-07-20 evaluation; [[DIR-036]]; ADR-010 link). Child of [[DIR-036]].

## Plan
N/A — directive resolved via a deployment milestone; no staged plan.

## Finding
[[DIR-035-D]] landed at M52 (audit PASS): product stands alone (smoke 0 RED, verified live 2026-07-20), `delivery-standalone-smoke` wired as a named gate (fires PASS via the engine), kit single-sourced. [[DIR-036]]'s dependency gate is fully green. Nothing structural blocks pointing quay at a foreign backend.

## Requested action
1. Determine archguard's real task backend (GitHub issues → quay-github; a local store → quay-native).
2. Commit a `.quay/config.yml` in an archguard checkout enabling that quay provider via the ABI.
3. Run `quay task list` + at least one non-list op (get/gate/write) against archguard's REAL tasks through the ABI; capture output in the milestone record.

## Acceptance Criteria
- [ ] In an archguard checkout, a committed `.quay/config.yml` enables a quay provider and `quay task list` returns archguard's REAL tasks/issues with exit 0 and non-empty output (pasted in the milestone record) — NOT quay's own `tasks/` store.
- [ ] At least one non-list operation (a `task_get` on a real archguard task, or a `gate`/`task_write` round-trip) succeeds through the ABI, evidenced by captured output.
- [ ] `grep -rE '\.\./\.\./\.\./quay-' <deployed-product>/src <deployed-product>/bin` returns nothing — the deployment reaches archguard through the ABI only, no cross-package file path (re-affirms ADR-013 item 1).

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts. A config file existing / smoke green are necessary-not-sufficient. Done ONLY when:
- [ ] A REAL archguard task was operated through the quay Provider ABI — durable evidence: archguard's committed `.quay/config.yml` + a captured `quay …` run against archguard's real backend showing archguard's OWN task ids/titles, not quay's.
- [ ] Verified off quay's own repo (the invocation ran in an archguard checkout / against archguard's backend), not a fixture or a quay-repo demo.
- [ ] Per DIR-026: lands done or `needs-human`; no prose-only deferral.

## Human verification when exp5 marks this done
1. Open archguard's `.quay/config.yml` — does it enable a quay provider over the ABI (no `../../../` path)?
2. Does the pasted `quay task list` really show archguard's OWN issues/tasks (ids/titles that exist in archguard), not quay's?
3. Did a non-list op (get/gate/write) round-trip through the ABI with captured output?
4. If only a config file exists but no real archguard task was operated through the mechanism → NOT landed, send back.