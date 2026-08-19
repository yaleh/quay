---
id: gap-gitignore-fan-in-ff-escalations
title: ".gitignore 补 `**/.quay/fan-in-ff-escalations.jsonl`——escalation 文件 untracked 杀 fan-in clean-tree"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`fan-in-ff-escalations.jsonl`（SPEC §7 防活锁的 escalation 记录）是运行时状态文件，但 `.gitignore` 里【没有】它的条目（gate-events.jsonl :43 / fan-in-retries.jsonl :182 等 runtime-state 家族都有，唯独它漏了）。该文件 untracked 会让 `git status --porcelain` 非空，触发 `fan-in-ff-merge.sh:185` 的 clean-tree 检查 exit 2——**escalation 机制自己写的文件反过来挡住 ff 干净落地**（2026-08-19 closure-skips 的 quiet window 被它挡了两轮，第 2 次复发）。硬规则 5b 同形：gitignore 漏了一个 runtime-state 文件。

## Acceptance Criteria

- [x] AC1: `.gitignore` 补 `**/.quay/fan-in-ff-escalations.jsonl`（与 gate-events.jsonl 同族 runtime-state，never committed）。
- [x] AC2: 负控制——写一次 escalation 记录后 `git status --porcelain` 为空（该文件被忽略，不脏树）。
- [x] AC3: scoped 绿 + 相关 gitignore 检查不红。

## Definition of Done

- [x] escalation 记录写入后不脏树、不杀 clean-tree，scoped 绿（真实输出）。

## Touches

- tasks/gap-gitignore-fan-in-ff-escalations.md（自身）
- .gitignore（补 `**/.quay/fan-in-ff-escalations.jsonl`）
