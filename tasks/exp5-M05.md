---
id: exp5-M05
title: Directives-as-quay-tasks restrained projection (files canonical,
  anti-drift check)
status: done
labels:
  - milestone-candidate
  - milestone:M05-dir-projection
  - backfill
  - surface:method-infra
parent: null
children: []
extra: {}
---
## Backfill provenance
Backfilled milestone record — one-time migration pass, M13-task-backlog-projection design (DIR-009 item 6), executed by M24-task-backlog-projection-impl. Source: backlog.md row "M-DIR-PROJECTION".

## Source
DIR-002 (applied — archived)

## Value type / cadence
explore

## Outcome (verbatim from backlog.md DONE column, m5 2026-07-18)
`/quay-directive` now also task_writes a label:directive projection; anti-drift check at scripts/it0-dir-projection-check.{sh,mjs} demonstrated catching both failure modes; OUTER-LOOP.md inbox-drain now also reads task_list --label directive; live dogfood DIR-003 archived as applied. iteration-1 caught and fixed a real --labels/--label CLI-flag typo. Merged to master.

## Status mirror
done (backfilled from backlog.md DONE row, m5 boundary)