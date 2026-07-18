---
id: exp5-M-ADVERSARIAL-EVAL
title: Adversarial/negative-path + security evaluation (fault injection, token
  handling, open-redirect, injection review)
status: done
labels:
  - milestone-candidate
  - surface:cross-cutting
  - milestone:M26-adversarial-eval
parent: null
children: []
extra: {}
---
## Forward-looking candidate provenance
Forward-looking milestone-candidate task, created by M24-task-backlog-projection-impl (design doc §6 forward-looking-creation scope, distinct from the historical backfill). Source: backlog.md row "M-ADVERSARIAL-EVAL" (open, not yet backed by a task before this write).

## Source
DIR-001 item 4

## Value type / cadence
explore, method infra, no VT points

## Notes (verbatim from backlog.md)
Backlogged.

## Status mirror
done (ABSORBed @M26, 2026-07-18 — two-iteration convergent adversarial/security audit, 9 findings
across both iterations, 3 independently-convergent duplicates + 2 unique (ADV-004 path-traversal
arbitrary-file-write, fixed; M26-F4 store.js all-or-nothing list() crash, verified-safe-degrade not
fixed at store.js level, deliberate scope decision). All 4 ABSORB HARD-BLOCK gates PASS, including
the DoD meta-enforcer's second-ever real test (generalized cleanly, no script defect). Published to
master as e2c5de1. See dashboard.md ABSORB m26 entry and
experiments/quay-perpetual-stream/milestones/M26-adversarial-eval/audit-report.md for full detail.)

---
_2026-07-18T19:18:52.059Z_: Not selected @M24: DIR-015/DIR-016's standing hard floor already committed this SELECT pass to M-TASK-BACKLOG-PROJECTION-IMPL (self-hosting fix, blocks all future SELECT read-path work) — a governance/infra candidate whose own enabling half was itself unselectable until this milestone lands.

---
_2026-07-18_: Not selected @M25: DIR-017 Step 1 (M-DOD-META-ENFORCER) outranks — it is the newly-unblocked (by M24) load-bearing prerequisite for DIR-017's remaining steps and closes a standing self-exemption/Goodhart hole in the governance loop itself; higher priority than this cross-cutting eval work this pass.
