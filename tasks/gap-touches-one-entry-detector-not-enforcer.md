---
id: gap-touches-one-entry-detector-not-enforcer
title: "touches-one-entry-one-path 是 detector 非 enforcer——撰写面 0 接线，发生率 4（硬规则⑫ 够格提机制）"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-16 17:2xZ（发生率实测，硬规则⑫ 给数后够格提机制）。

**闸存在但只在【最晚】一层**：`touches-one-entry-one-path-check` 判据正确、确实报红，
但接在**全量套件的静态层**——每犯一次的代价 = 一条任务已经 fork、在飞、跑到静态层才红、
修 Touches 再重跑。今天 `gap-ac97` / `gap-release-timeout` 两条被它挡住（`# tests 0`，一个测试没跑到）。

**发生率（gate 落地 97cb1dde 2026-08-14 之后，全在 08-16 一天内）**：
```
9095bf86  10:34  ac86 Touches 拆开
64074591  12:28  AC91 Touches 拆开（自称"第 3 次同形"）
505dd16d  16:47  AC99 Touches 拆多路径
6a0d389a  16:50  gap-ac99 Touches 拆 '/' 连接（自称"第 4 次同形"）
```
**接线面实查**：checker 在 plugin/scripts + scripts/test.sh + mutation case + catalog 都有；
**撰写面 `.git/hooks/pre-commit` 命中 = 0**（819 字节，只有 precommit-guard）。零计数干跑确认谓词没错。

**⇒ 形态 = detector 而非 enforcer**：判据对、报红对，但位置太晚。

## Plan

1. 把同一个 check 前移到**撰写/提交那一刻**（任务体落盘时或 pre-commit），让「写错 Touches」在产生它的那一步就红。
2. ⛔ 不指定实现方式——由实现方选：pre-commit hook 接线 / 撰写侧脚本 / 其他。判据 = 提交前挡住。

## Acceptance Criteria

- [ ] AC1: 撰写面（pre-commit 或等价落盘时机）接线 `touches-one-entry-one-path`——写一个多路径 Touches 的 commit 在提交前被拒（现为提交后才在 suite 静态层红）。
- [ ] AC2: 接线后不再出现「任务 fork→在飞→静态层才红→改 Touches 重跑」的循环（判据：新任务 Touches 错误在提交前即红）。
- [ ] AC3: 接线可 `git log` 追溯，且不破坏既有 pre-commit guard 功能。

## Definition of Done

- [ ] touches-one-entry-one-path 从「suite 静态层 detector」前移到「撰写面 enforcer」，写错 Touches 在产生处即红。

## Touches

- .git/hooks/pre-commit（或撰写侧等价落盘时机——接线点）
- plugin/scripts/touches-one-entry-one-path-check.ts（若需导出供撰写面调用）
- tasks/gap-touches-one-entry-detector-not-enforcer.md（自身）
