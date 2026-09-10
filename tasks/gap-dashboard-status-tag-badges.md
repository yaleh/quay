---
id: gap-dashboard-status-tag-badges
title: Fan-in/Goal 卡状态文字改用既有 .tag 语义徽章组件（补 .tag-positive 令牌）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
`packages/quay/src/webui-modernist.css:215-224` 已经声明了一套 soft badge 组件
（`.tag`/`.tag-accent`/`.tag-accent-2`/`.tag-neutral`/`.tag-outline`，浅色背景+深色文字），但全仓库
`grep -rn "class=\"tag\|tag-accent|tag-neutral|tag-outline" packages/quay/src/*.ts` 零命中——这套
组件从未被任何页面消费过。与此同时 dashboard 的 goal 卡（`renderGoalCard`,
serve-dashboard.ts:773-784）和 fan-in 卡（`renderFanInCardFromRecords`, serve-dashboard.ts:808-894）
的状态词（fresh/stale/NOT-EVALUATED、landed/red、step ff/step suite）全部是裸色文字
（`color:${...};font-weight:700`），没有背景色/边界，扫视时和普通正文文字混在一起。这是 2026-09-09
Dashboard 视觉改进方案核对认定的三个高性价比项之一：组件已经存在，只是从没被接上。

现有 token 集只有 `--color-positive-700`/`--color-positive-800`（文字色，为 a11y 对比度专门校准过，
见 serve-dashboard.ts:770-772 的注释），**没有**对应的浅底色 token，所以 fresh/landed 这类"成功"语义
没法直接套用现成的 `.tag-accent`（红色语义，用于 stale/red 正合适）——需要先补一个浅绿背景 token。

## Plan
1. 在 `webui-modernist.css` 的 `:root` 里新增一个浅绿背景 token（如 `--color-positive-100`，参考
   `--color-accent-100`/`--color-accent-2-100` 的取值方式：与 `--color-positive-700` 同色系但浅色、
   在 `--color-surface` 背景上目测不刺眼），并新增 `.tag-positive { background:
   var(--color-positive-100); color: var(--color-positive-700); }` 组件类，紧邻现有 `.tag-accent`
   等定义之后。
2. `renderGoalCard`：fresh → `.tag-positive`；stale → `.tag-accent`；NOT-EVALUATED → `.tag-neutral`。
   替换现有的裸 `color:${stalenessColor(state)};font-weight:700` 内联样式为 `class="tag tag-xxx"`。
3. `renderFanInCardFromRecords`（经 `renderFanInCell`, packages/quay/src/serve-task.ts）：
   landed → `.tag-positive`；red → `.tag-accent`；其余/未知 outcome → `.tag-neutral`。
   `step ff`/`step suite` 等 step 标签同样套 `.tag-neutral`（或 `.tag-outline`，取观感更合适的一种）。
4. 不新增客户端 JS、不改变卡片的 SSR-only 设计取舍；纯 CSS class + 服务端字符串拼接。
5. 新增单测文件 `packages/quay/test/gap-dashboard-status-tag-badges.test.mjs`：断言
   `renderGoalCard`/`renderFanInCardFromRecords`（或 `renderFanInCell`）对已知状态值输出包含预期的
   `tag-positive`/`tag-accent`/`tag-neutral` class 名，覆盖至少 fresh/stale/NOT-EVALUATED 与
   landed/red 两组状态各自的映射。

## Acceptance Criteria
- [x] `webui-modernist.css` 新增 `--color-positive-100`（或等价浅绿背景 token）与 `.tag-positive`
      规则，可用 `grep -n "tag-positive" packages/quay/src/webui-modernist.css` 验证存在。
- [x] `renderGoalCard` 对 fresh/stale/NOT-EVALUATED 三态分别输出 `tag-positive`/`tag-accent`/
      `tag-neutral` class，单测按状态值逐一断言（不是仅断言"包含 tag 字样"）。
- [x] fan-in 卡对 landed/red 两种 outcome 分别输出 `tag-positive`/`tag-accent` class，单测逐一断言。
- [x] `webui-modernist-sync.test.mjs`（既有的 CSS 同步校验测试）随改动一起跑绿，不产生新的漂移红。

## Definition of Done
- [x] 代码改动落在 `webui-modernist.css`、`serve-dashboard.ts`、`serve-task.ts`（`renderFanInCell`
      涉及处）之内。
- [x] `packages/quay/test/gap-dashboard-status-tag-badges.test.mjs` 存在且按状态值断言具体 class
      名，随 scoped gate 跑绿。
- [ ] 生产 `/dashboard` 页面人工截图核实：goal 卡 fresh 标签与 fan-in 卡 landed/red 标签显示为浅底色徽章而非裸色文字（待外部）

## Touches
- docs/design/quay-webui-improved-2026-08-16/_ds/modernist-40217566-87fa-42b1-9cc0-36027903691f/styles.css
- packages/quay/src/webui-modernist.css
- packages/quay/src/serve-dashboard.ts
- packages/quay/src/serve-task.ts
- packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs
- packages/quay/test/gap-dashboard-status-tag-badges.test.mjs
- tasks/gap-dashboard-status-tag-badges.md