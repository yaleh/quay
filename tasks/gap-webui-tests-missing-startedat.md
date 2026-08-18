---
id: gap-webui-tests-missing-startedat
title: "/tests 页历史行缺 startedAt 列——verification-round.jsonl 记录本身带 startedAt 字段，只是没渲染成列"
status: todo
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`/tests` 页历史行缺 `startedAt` 列。`verification-round.jsonl` 每条记录本身就带 `startedAt` 字段（manager 核过），只是没渲染成列——小改动。

## Acceptance Criteria

- [ ] AC1: `/tests` 历史行渲染 `startedAt` 列（从 verification-round.jsonl 记录字段读取）。

## Definition of Done

- [ ] `/tests` 页历史行可见 startedAt 值（真实渲染，与记录字段一致）。
