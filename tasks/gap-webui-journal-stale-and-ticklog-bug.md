---
id: gap-webui-journal-stale-and-ticklog-bug
title: Journal 页陈旧记录（escalations 退役 + tick-log 分段 bug）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager web 巡检投立案（代码级核实）。

**两个独立根因**：
- **escalations.md 陈旧（决策项）**：`orchestration/escalations.md` 9 天未更新（mtime Aug 14），而 tick-log.md 每 ~20 分钟在写——升级机制已被 tick-log 取代但没人退役，页面把死频道当「最近记录」第一段展示。要么退役该 section、要么加「N 天无更新」醒目提示。
- **tick-log.md 分段 bug（真代码 bug）**：`orchestration/tick-log.md` 条目格式是 `` - `HH:MMZ` `action` `` 项目符号，`grep -c '^## '` = 0；但 `readJournal()` 对 escalations.md 与 tick-log.md **共用同一个按 `## ` 边界分段函数**（`observation.ts:650-651`），tick-log 零边界命中 ⇒ 触发 `boundaries.length===0` 兜底 `lines.slice(-max*4)`（取最后 60 行），把陈旧条目（如 13:27Z ac128 suite-red，早已解决）与今天真实最新条目混在同一渲染块、无日期区分。

## Plan

1. escalations.md：退役该 section 或加「N 天无更新」提示（决策项，落笔方标注选择）。
2. tick-log.md：用专门的按 `` - `HH:MMZ` `` 行首模式分段读取函数（⛔ 不复用 `## ` 边界函数的兜底分支）。
3. tick-log 条目带日期（⛔ 仅 HH:MMZ 跨天有歧义）。

## Acceptance Criteria

- [ ] AC1：escalations.md 的 Journal 段退役或带陈旧标注（⛔ 死频道当「最近记录」第一段 ⇒ 假）。
- [ ] AC2：tick-log 用专用行首模式分段读取，⛔ 不复用 `## ` 边界兜底；取真最近条目（⛔ 混入数天前陈旧条目 ⇒ 假）。
- [ ] AC3：tick-log 条目带日期（⛔ 仅 HH:MMZ 跨天歧义）。

## Definition of Done

- [ ] escalations 退役/标注 + tick-log 专用分段 + 条目带日期；AC1-3 全勾；land 到 develop。

## Retires

- 无（修正分段逻辑；escalations section 若退役则记退役面）

## Touches

- packages/quay/src/observation.ts（readJournal 专用分段函数）
- tasks/gap-webui-journal-stale-and-ticklog-bug.md（自身）
