---
id: gap-ac95-webui-15-views
title: "AC95: 实现设计中的所有页面——15 个视图全部真上线（人 16:2xZ 明令，⛔ 不再是首批三屏）"
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

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` AC95。

**目标态 15 视图（从设计 `.dc.html` navGroupDefs 实读）**：
```
核心  dashboard · tasks         观测  live · board · system · manager
记录  journal · git · tests · sessions   知识  adr · goal · doc · architecture  ＋ 任务详情(detail)
```
**与现状差集（实读 serve-handlers.ts 路由表，可复算）**：已实现 8 条精确路由（/ /adr /board /doc
/git-history /goal /journal /live）+ 4 前缀详情（/task/:id /adr/:id /goal/:id /doc/:id）
⇒ **设计有而未实现 6 个：dashboard · system · manager · tests · sessions · architecture**；
已实现且设计已覆盖 9 个。⛔ 原型那种"未实现。"占位页不算实现。

## Acceptance Criteria

- [ ] AC1: 15 个视图各有一条真实返回 200 的路由（curl 逐路由 `-w '%{http_code}'`）——6 个新页面不得占位交付。
- [ ] AC2: 数字取自产生它的机件（observation.ts readLive / client.taskList / git log / resource-gate.sh /
      process-budget.sh / loop-driver-check.sh / session-liveness.sh）——⛔ 不得解析 manager-tick-log /
      manager-phase-goal 叙事文档（`grep -rn 'manager-tick-log\|manager-phase-goal' packages/quay/src/` 命中>0 即假）。
- [ ] AC3: 空态诚实——数据源空/不可用渲染「未接入/无数据」，⛔ 不得留白/显示 0（复用 observation.ts 三态）。
- [ ] AC4: packages/quay/test/ 13 个既有 web 测试全绿。

## Definition of Done

- [ ] 15 视图全部满足 AC1-AC4；分批交付允许但 AC95 只在 15 个全满足时达成。

## Touches

- packages/quay/src/serve-handlers.ts（新路由 dashboard/system/manager/tests/sessions/architecture）
- packages/quay/src/observation.ts（若空态三态扩展）
- packages/quay/test/（web 测试）
- docs/design/quay-webui-improved-2026-08-16/（设计正本，只读参考）
- tasks/gap-ac95-webui-15-views.md（自身）
