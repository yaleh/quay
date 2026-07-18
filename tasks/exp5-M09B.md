---
id: exp5-M09B
title: Fix quay-github's task_get/task_list parent-resolution asymmetry (PR-ABI-002)
status: done
labels:
  - milestone-candidate
  - milestone:M09-gh-write
  - backfill
  - surface:provider-abi
parent: null
children: []
extra: {}
---
## Backfill provenance
Backfilled milestone record — one-time migration pass, M13-task-backlog-projection design (DIR-009 item 6), executed by M24-task-backlog-projection-impl. Source: backlog.md row "M-GH-PARENT" (bundled into M-GH-WRITE / M09-gh-write's own milestone, not a standalone charter — this backfilled task records that bundled sub-scope distinctly, per its own backlog.md row).

## Source
gap-list PR-ABI-002 (minor)

## Value type / cadence
exploit

## Outcome (verbatim from backlog.md DONE column, m9 2026-07-18, bundled into M-GH-WRITE)
get() now reuses list()'s fetchAllIssues()+buildParentIndex(), PR-ABI-002 CLOSED, symmetry re-verified pre-fix and post-fix by iteration-1.

## Status mirror
done (backfilled from backlog.md DONE row, m9 boundary, bundled sub-scope)