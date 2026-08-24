---
id: gap-webui-git-history-svg-unreadable
title: git-history 页 SVG 缩放把 924×15570 viewBox 压到 ~91px 不可读（preserveAspectRatio
  meet + max-height:75vh）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

git-history 页 SVG 缩放比例问题（本会话早前诊断、从未立案、刚核实仍复现）：`width="100%"` + `height:auto` + `max-height:75vh` + 默认 `preserveAspectRatio="xMidYMid meet"` 把一个 924×15570 的 viewBox 压缩到约 91px 宽，文字不可读、不可操作。curl 现网页确认 `max-height:75vh` 样式仍在。

## Plan

viewBox 宽高比接近原生渲染——按内容宽高设置合理固定宽度 + 允许横向滚动，而不是强制压缩进一个正方形容器（`meet` 会等比缩小到最小边）。

## Acceptance Criteria

- [ ] AC1（能取假，可读）：git-history 页 SVG 文字可读（⛔ 仍压到 ~91px 宽不可读 ⇒ 假）。
- [ ] AC2（能取假，可滚动）：超高 viewBox 允许横向滚动/原生宽高比（⛔ 强制 `meet` 压缩进方形容器 ⇒ 假）。

## Definition of Done

SVG 宽高比/滚动修正落地 develop；AC1-2 全勾；924×15570 viewBox 以原生宽高比渲染、文字可读可操作（AC1 复现）。

## Touches

- packages/quay/src/serve-handlers.ts（git-history SVG 渲染：preserveAspectRatio/viewBox/width/max-height）
- packages/quay/test/serve-handlers.test.mjs（或对应测试）
- tasks/gap-webui-git-history-svg-unreadable.md（自身）