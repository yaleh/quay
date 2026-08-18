---
id: gap-webui-tests-missing-startedat
title: "/tests 页历史行缺 startedAt 列——verification-round.jsonl 记录本身带 startedAt 字段，只是没渲染成列"
status: superseded
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

> **superseded by [[gap-full-suite-state-stale-no-writer]]（2026-08-18）**：本任务的「缺 startedAt 列」实为「/tests 页读陈旧 full-suite-state.json」的表层症状；根因任务落地（fan-in mirror-write full-suite-state）后本任务自动解决，不再单独修 startedAt 列。

## Finding

`/tests` 页历史行缺 `startedAt` 列。`verification-round.jsonl` 每条记录本身就带 `startedAt` 字段（manager 核过），只是没渲染成列——小改动。

## Acceptance Criteria

- [ ] AC1: `/tests` 历史行渲染 `startedAt` 列（从 verification-round.jsonl 记录字段读取）。

## Definition of Done

- [ ] `/tests` 页历史行可见 startedAt 值（真实渲染，与记录字段一致）。
