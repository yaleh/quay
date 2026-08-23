---
id: gap-git-history-vertical-graph-thirdparty-lib
title: Git History 页重做（纵向时间轴 + 第三方图库；站点级「零客户端 JS」原则废除）
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

**来源（人 2026-08-23 裁定，⛔ 站点级非单页）**：人逐字「引入第三方库。'零客户端 JS'原则取消。」——注意这不是 Git History 一页例外，是**站点级「零客户端 JS」不变式整体废除**，改为按需允许引入第三方前端库。裁定经由 quay-3e 转达（outer 卡在未答复的 AskUserQuestion 04:13:54Z，无法处理消息），本任务即该裁定的落实记录 + 执行。

**现状（Git History 页）**：`serve-handlers.ts` 的 `handleGitHistory`/`readGitHistory` 现为 server-rendered SVG/列表（「零客户端 JS」原则下产物）。要改为纵向时间轴：develop 竖直主干 + task 分支从 develop 分出/合入的 fork/merge 连线。

**原则废除的落点（⛔ 硬规则 5b，逐个核）**：`docs/webui-guide.md` 明确表述该原则；`serve-handlers.ts` 注释、`tasks/gap-git-history-svg-server-rendered.md` / `gap-test-detail-timeline.md` / `gap-ac96-*.md` / `gap-webui-board-*.md` 等提及。本任务 Touches 只列会【改】的文件；原则废除的记录以本任务体 + `docs/webui-guide.md` 更新为准，其它提及处按实现触及逐一核（⛔ 不因 grep 到就全改）。

## Plan

1. Git History 页改为纵向时间轴：develop 竖直主干 + task 分支 fork/merge 连线。
2. task 分支默认折叠 commits（只显总数 + 时间跨度，可展开查看）。
3. 引入一个能撑起可伸缩纵向 git-graph 可视化的第三方前端库（选型是工程判断，⛔ 不代选；⛔ 不再受「零客户端 JS」约束）。
4. `docs/webui-guide.md` 更新：记录「零客户端 JS」原则废除（改为按需允许第三方前端库），注明裁定出处与日期。

## Acceptance Criteria

- [x] AC1（纵向时间轴）：Git History 页渲染纵向时间轴——develop 竖直主干 + task 分支从 develop 分出/合入的 fork/merge 连线（⛔ 仍横向列表/散点 ⇒ 假）。
- [x] AC2（折叠 + 展开）：task 分支默认折叠 commits，只显总数 + 时间跨度，可展开查看逐条（⛔ 默认全展开 ⇒ 假）。
- [x] AC3（第三方库 + 原则废除）：引入了第三方前端库做可视化，且 `docs/webui-guide.md` 已记录「零客户端 JS」原则废除（⛔ 仍 server-rendered 零客户端 JS ⇒ 假）。

## Definition of Done

- [x] 纵向时间轴 + 折叠展开 + 第三方库引入 + 原则废除记录落地；AC1-3 全勾；land 到 develop。

## Retires

- 无（页重做 + 原则废除，非退役机件）

## Touches

- packages/quay/src/serve-handlers.ts（Git History 页改为纵向时间轴 + 第三方库渲染 + 折叠展开客户端脚本）
- packages/quay/src/observation.ts（readGitHistory 增 parentHashes/head/heads，供纵向图布局）
- packages/quay/src/serve.ts（re-export：renderGitHistorySvg → layoutGitGraph）
- packages/quay/scripts/build-dist.mjs（dist bundle 内联 d3.min.js）
- packages/quay/package.json（第三方图库依赖 d3）
- package-lock.json（d3 依赖锁定）
- packages/quay/test/serve-handlers.test.mjs（git-history 测试改写：纵向布局 + 折叠 + 第三方库）
- packages/quay/test/serve-ac102-modernist-views.test.mjs（git-history 渲染段 token 化断言更新）
- docs/webui-guide.md（记录「零客户端 JS」原则废除）
- tasks/gap-git-history-vertical-graph-thirdparty-lib.md（自身）

> **注意**：实现若需新增独立模块（纵向 graph 组件/数据装配）或改 `serve.ts` 路由/`observation.ts` 数据源，Touches 随实现增补。⛔ 与 `gap-git-history-clickable-branches-window` / `gap-git-history-collapse-commits` 两条 needs-human 无关——那两条卡在 `spawnFixWorker` 零诊断输出（0905cd4b），不并入本次。
