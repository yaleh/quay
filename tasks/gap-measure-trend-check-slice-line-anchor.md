---
id: gap-measure-trend-check-slice-line-anchor
title: measure-trend-check.ts:112 lastIndexOf 裸 substring → 行首锚定（5b sibling，同 fan-in-execute.js:276 缺陷）
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

**来源**：inner 上报硬规则 5b sibling（fix-slice 任务已修 fan-in-execute.js:276，但同形切片缺陷还有第 3 处）。

**证据（能取假）**：`plugin/scripts/measure-trend-check.ts:112` `const mk = text.lastIndexOf("__FANIN_SUITE_START__");`——与 `fan-in-execute.js:276` 同形的裸 substring 切片，会命中测试输出里【行内】提及 `__FANIN_SUITE_START__` 的文本，把真实 `__PERFILE__` 行切掉 ⇒ 假 checker-misreport（硬规则 3b）。`pre-verified-round-record.ts` 已自行改行首锚定；`fan-in-execute.js` 由 gap-fan-in-fix-scope-gate-slice-line-anchor 修；本处是第 3 处 sibling。

**为什么 inner 执行**：改产品脚本 → inner 域。

## Plan

1. `measure-trend-check.ts:112` 改行首锚定（`/^__FANIN_SUITE_START__[^\n]*$/gm` 取最后行首匹配，与 parsePerFileLines / pre-verified-round-record.ts 一致）。
2. 负控制：含 inline `__FANIN_SUITE_START__` 字样的日志不再切掉其后的真实 `__PERFILE__` 行。
3. fan-in land。

## Acceptance Criteria

- [ ] AC1：`measure-trend-check.ts` 中 `lastIndexOf("__FANIN_SUITE_START__")` 裸 substring 改行首锚定。
- [ ] AC2（负控制）：inline 提及该标记的日志不切掉其后真实 `__PERFILE__` 行（不产假 checker-misreport）。

## Definition of Done

- [ ] 切片行首锚定 + 负控制通过 + scoped 绿；AC1-2 全勾；land 到 develop。

## Touches

- plugin/scripts/measure-trend-check.ts
- tasks/gap-measure-trend-check-slice-line-anchor.md（自身）
