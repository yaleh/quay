---
id: QC-T1
title: healthcheck fixture — native task store liveness probe
status: superseded
labels:
  - fixture
  - healthcheck
extra: {}
---
## Purpose

This task is a permanent fixture used as a liveness probe for the native task store at
session start. The OUTER-LOOP.md session-start healthcheck step calls `task_get QC-T1`
to verify the task store is accessible. If this task is absent, the healthcheck step
re-creates it (idempotent) — never silently swallowing the "no such task" error.

This task is never meant to be completed (status stays `todo` permanently).
