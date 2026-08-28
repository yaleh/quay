---
id: gap-webui-round-detail-page
title: "任选历史轮次详情（面向单轮非单文件）：/tests?round=N 真正生效 + 历史运行表 #NNN 包链接"
status: done
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

人澄清（2026-08-24）：「详情页」是面向【一轮测试】（如 #510），**不是**面向单个测试文件。现状（manager 三处直接量）：①历史运行表 `#NNN` 格子纯文本（`<td>#510</td>`）从未包 `<a>`，非回归；②已建的 `/tests/file` 是「单文件跨轮」详情，与「单轮详情」**正交**；③**关键缺口**：无任何机制查看任意历史轮次自己的时间线/负载曲线——`curl '/tests?round=510'` 仍显示最新轮（#511），`handleTests()` 忽略 query 参数恒读 `readCurrentSuiteState()`。

## Plan

新增/扩展路由支持任选轮次（`/tests?round=N` 真正生效，或 `/tests/round?id=N`），复用 `renderPerFileTimelineSvg` / `renderLoadCurveSvg`（两个渲染函数与「是否最新轮」无关，喂对应轮次的 perFile/samples 即可，无需重写渲染逻辑）；历史运行表 `#NNN` 格子包成指向新路由的链接。⛔ 负载曲线部分依赖 gap-suite-load-sampler-bypassed-by-fan-in-execute（数据源），时间线部分不依赖。

## Acceptance Criteria

- [x] AC1（能取假，任选轮次）：`/tests?round=510` 显示 round 510 的时间线/负载曲线（⛔ 仍显示最新轮、参数被忽略 ⇒ 假）。
- [x] AC2（能取假，入口链接）：历史运行表 `#NNN` 格子可点击跳到该轮详情（⛔ 纯文本 `<td>#510</td>` 无链接 ⇒ 假）。

## Definition of Done

任选轮次详情落地 develop；AC1-2 全勾；点 #510 → 看 round 510 的时间线+负载曲线（AC1 复现）。

## Touches

- packages/quay/src/serve-handlers.ts（handleTests 读 query round 参数 + 读对应轮次 perFile/samples；历史表 #NNN 包链接）
- packages/quay/test/serve-handlers.test.mjs（或对应测试）
- tasks/gap-webui-round-detail-page.md（自身）