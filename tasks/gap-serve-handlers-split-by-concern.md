---
id: gap-serve-handlers-split-by-concern
title: serve-handlers.ts 按关切拆分（3559 行单体致 UI 任务全串行；发生率 2 过硬规则⑫）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`packages/quay/src/serve-handlers.ts` 现 **3559 行 / 193KB 单体**，六条 UI 任务（T1-T6）`## Touches` **全部命中它**（6/6）⇒ 完全串行，一次一条。**发生率 = 2**（上次 AC95/96/98/99/100 五条 + 本次六条，`manager-phase-goal.md:1952` 有读数）⇒ 已过硬规则⑫ 门槛，不是观察项。AC128「hub 单体按关切拆文件」**没覆盖到它**——当时留下的必答题（收窄 Touches 粒度 vs 接受串行）至今未答。

## Plan

按路由/域分组把 serve-handlers.ts 拆为多个关切文件（`/sessions` `/task` `/goal` `/live` `/send` 等各一个 handler 文件），`serve.ts` 保留为路由聚合入口；拆分后更新 T1-T6 的 Touches 为各自关切文件。**排期**：先让 T1-T6 串行落地（六条都小，串行可接受），拆分作为【下一 UI 阶段前置】——拆分后所有 UI 任务按关切文件并行。

## Acceptance Criteria

- [x] AC1（能取假，拆分落地）：serve-handlers.ts 不再是 3559 行单体（拆成 ≥4 个关切文件）；（⛔ 仍单体 ⇒ 假）。
- [x] AC2（能取假，行为不退化）：拆分后全量 suite 绿（路由/响应行为不变）；（⛔ suite 红 ⇒ 假）。
- [x] AC3（能取假，Touches 分散）：拆分后 T1-T6 六条任务 Touches 不再全部命中同一文件（分散到各自关切文件）；（⛔ 仍全命中 serve-handlers.ts ⇒ 假）。

## Definition of Done

serve-handlers.ts 按关切拆分落地；AC1-3 全勾；T1-T6 Touches 更新；此后 UI 任务按关切文件并行而非全串行。

## Touches

- packages/quay/src/serve-handlers.ts（拆分源）
- packages/quay/src/serve*.ts（新关切文件）
- packages/quay/test/serve-handlers.test.mjs（对应测试拆分）
- packages/quay/test/webui-modernist-sync.test.mjs（AC100(c) 断言面随拆分迁移到 serve-adr/goal/doc/render）
- packages/quay/test/serve-ac102-modernist-views.test.mjs（AC102② 断言面迁移到 serve-render.ts）
- packages/quay/test/serve-ac96-responsive-two-form.test.mjs（AC102 preserved 断言面迁移到 serve-render.ts）
- packages/quay/test/gap-dashboard-parallelize.test.mjs（AC2 结构断言迁移到 serve-dashboard.ts）
- tasks/gap-serve-handlers-split-by-concern.md（自身）
- tasks/gap-webui-session-discovery-claude-agents-json.md（T1 Touches 更新）
- tasks/gap-webui-live-passthrough-pid.md（T2 Touches 更新）
- tasks/gap-webui-session-detail-view.md（T3 Touches 更新）
- tasks/gap-webui-task-runs-block.md（T4 Touches 更新）
- tasks/gap-webui-message-delivery-entry.md（T5 Touches 更新）
- tasks/gap-webui-session-lifecycle.md（T6 Touches 更新）