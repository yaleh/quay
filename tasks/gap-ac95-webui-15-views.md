---
id: gap-ac95-webui-15-views
title: "AC95: 实现设计中的所有页面——15 个视图全部真上线（人 16:2xZ 明令，⛔ 不再是首批三屏）"
status: ready
labels:
  - gap
  - mechanism
  - priority:p1
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

- [x] AC1: 15 个视图各有一条真实返回 200 的路由（curl 逐路由 `-w '%{http_code}'`）——6 个新页面不得占位交付。
- [x] AC2: 数字取自产生它的机件（observation.ts readLive / client.taskList / git log / resource-gate.sh /
      process-budget.sh / loop-driver-check.sh / session-liveness.sh）——⛔ 不得解析 manager-tick-log /
      manager-phase-goal 叙事文档（`grep -rn 'manager-tick-log\|manager-phase-goal' packages/quay/src/` 命中>0 即假）。
- [x] AC3: 空态诚实——数据源空/不可用渲染「未接入/无数据」，⛔ 不得留白/显示 0（复用 observation.ts 三态）。
- [x] AC4: packages/quay/test/ 13 个既有 web 测试全绿。

## Definition of Done

- [x] 15 视图全部满足 AC1-AC4；分批交付允许但 AC95 只在 15 个全满足时达成。

## Evidence

- **实现**：`serve-handlers.ts` 新增 6 条真实路由（`/dashboard` `/system` `/manager` `/tests` `/sessions` `/architecture`）＋ `renderSiteNav`（设计 navGroupDefs 的 15 视图全站导航）。`observation.ts` 新增 6 个数据源读取（`readSystem` / `readManager` / `readTests` / `readSessions` / `readArchitecture`），全部遵循既有退化契约（absent→未接入/无数据，unreadable→读失败，never 500）。
- **AC1**：6 个新路由各返回 200 且非占位页。`packages/quay/test/serve-ac95-views.test.mjs` 集成测试逐路由断言 200 + 标题 + `<main>`；`renderSiteNav` 单测断言 15 视图齐全。
- **AC2**：数字取自产生它的机件——`resource-gate.sh`/`process-budget.sh`（system）、`loop-driver-check.sh`/`session-liveness.sh --once`/`observer-registry.conf`/`ready-pool-check.ts --json`/`QUAY_VERSION`/`git rev-list`（manager）、`.quay/verification-round.jsonl`＋`full-suite-state.json`（tests）、`session-liveness.sh`＋transcript 尾部（sessions）、`git log` per-package＋`git worktree list`（architecture）、`readLive`/`client.taskList`/`readGitHistory`（dashboard）。AC2 机械 grep（两个叙事文档名 over `packages/quay/src/`）命中 0。
- **AC3**：空态诚实——bare-workspace 集成测试断言 `/tests` 与 `/architecture` 渲染「未接入/无数据」（非留白/0）；三态（ok/empty/error）取值独立。
- **AC4**：`bash scripts/test.sh --for-task gap-ac95-webui-15-views --allow-thin` 全绿 —— 85 测试 0 失败（含 13 个既有 web 测试 + 新增 serve-ac95-views.test.mjs 12 条）；`tsc --noEmit` 0 错误。
- **AC102（人 2026-08-17 明令的视觉规范补充，正本 `manager-phase-goal.md` AC102）**：
  - **AC102①**：15 视图逐一 curl，响应体均含 Modernist token 特征串 `--color-bg` —— 15 个视图的 `<head>` 全部改发 `modernistStyles()`（与 3 个详情页【同一份】token 样式表），不再是各自颜色。
  - **AC102②**：`serve-handlers.ts` 渲染代码 `grep -cE '#[0-9a-fA-F]{6}'` = **0**（整文件零硬编码 hex）——共享基础样式 `pageStyles()`（原 34+ 处）迁移到 `var(--color-*)`，git 图表 SVG 改用 token 类（`.git-svg-commit` 等），6 个新页面内联色全部 token 化；hex 值只存在于 `webui-modernist.css` 资产（AC100(a) byte-identity 已钉）。
  - **AC102③**：抽样 3 个新页面桌面 1440×900 截图存 Evidence：`packages/quay/test/fixtures/ac102-dashboard-1440x900.png` / `ac102-system-1440x900.png` / `ac102-manager-1440x900.png`（google-chrome headless，valid PNG 1440×900）。
  - **机械测试**：新增 `packages/quay/test/serve-ac102-modernist-views.test.mjs`（3 条：15 视图 --color-bg / 整文件零 hex / git SVG token 类）；`serve-handlers.test.mjs` 与 `serve.test.mjs` 相应断言更新。
- **健壮性**：机制脚本子进程走 bounded 进程组 kill 的异步 runner（`runScriptBounded`）——`session-liveness.sh` 会 fork `sleep` 子进程且 SIGTERM 被延迟；用 execFileSync 会阻塞 serve 事件循环（实测 /dashboard 使整台服务器 40s 无响应）。已用 `--once` 显式单轮。version 取构建期内联的 `QUAY_VERSION`，不读运行时 package.json（避免破坏 self-contained-dist 断言，build-dist.test.mjs (e)）。

## Touches

- packages/quay/src/serve-handlers.ts（新路由 dashboard/system/manager/tests/sessions/architecture + AC102 token 化：15 视图同源 modernistStyles、零硬编码 hex）
- packages/quay/src/observation.ts（若空态三态扩展）
- packages/quay/test/（web 测试）
- packages/quay/test/serve-ac95-views.test.mjs（新增：6 视图路由/解析/空态测试）
- packages/quay/test/serve-ac102-modernist-views.test.mjs（新增：15 视图 --color-bg + 零 hex + git SVG token 类）
- packages/quay/test/serve.test.mjs（搜索横幅断言随 token 化更新）
- packages/quay/test/serve-handlers.test.mjs（git 图表 token 类断言更新）
- packages/quay/test/fixtures/（AC102③ 截图证据：ac102-{dashboard,system,manager}-1440x900.png）
- docs/design/quay-webui-improved-2026-08-16/（设计正本，只读参考）
- tasks/gap-ac95-webui-15-views.md（自身）
