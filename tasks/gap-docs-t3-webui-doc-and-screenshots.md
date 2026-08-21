---
id: gap-docs-t3-webui-doc-and-screenshots
title: T3 Web UI 用户文档 + 截图：15 路由+4 详情全覆盖（人裁定截图+页面验证，开发树取图）
status: done
labels:
  - gap
  - docs
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：manager 2026-08-21 01:0xZ 产品化交付文档审计（人明令检查 + 立案）。缺口 T3：Web UI 用户文档 + 截图——最大空白。**人已裁定**：截图任务 AC 要「截图 + 同时验证页面本身」（复用 AC119 的真实 HTTP 断言手法，不是只存图）。

**缺口**：`serve-handlers.ts:2584-2698` 有 15 条精确路由 + 4 条详情路由，根 README 提 web UI 只有 2 处一句带过（:19 :392），`packages/quay/README.md:327-333` 的 serve 节只知道 "task list + detail pages"（15 选 2）且标题漏 `--host`。仓库 111 个 PNG，`grep '\.png' README.md docs/*.md` = 0——全是 test fixture / design evidence，没有一张面向用户。

**⛔ 取图来源定死**：**开发树**（`node --experimental-strip-types packages/quay/bin/quay.ts serve --host <ip> --port <p>`）——因 `gap-webui-modernist-css-missing-in-tgz` 未 land，若截图取自打包产物会无样式。任务体显式定死取图来源 = 开发树。

**截图流程复用**：仓库已有 AC96/AC100/AC102 的 `google-chrome --headless=new` 流程可复用，判据含像素核验非空白页。

**为什么 inner 执行**：docs + 截图属产品文档（仓库交付面）+ serve 开发树运行 → inner 域。

## Plan

1. 对 15 条精确路由 + 4 条详情路由，各截一图（google-chrome --headless=new，开发树 serve，复用 AC100 流程）。
2. 每张截图对应路由：真实 HTTP 请求断言页面内容 + 关键元素（AC119 手法——非 curl 探活）。
3. 写 Web UI 用户文档页 `docs/webui-guide.md`（15 路由 + 4 详情全列出，含截图）。
4. 截图存 `docs/images/webui-*`，文档引用。

## Acceptance Criteria

- [x] AC1: Web UI 文档页覆盖全部 15 条精确路由 + 4 条详情路由（`serve-handlers.ts:2584-2698` 的精确路由集合 vs 文档 = 差 0）。
- [x] AC2: 每张截图对应路由有真实 HTTP 断言（页面 200 + 关键元素存在，AC119 手法——非 curl 探活）。
- [x] AC3: 截图真实产出非空白页（像素核验，复用 AC100 判据；仓库已有流程）。
- [x] AC4: 截图取**开发树** serve（非打包产物——CSS 缺陷未 land 前打包无样式）；文档注明 serve 命令含 `--host`。
- [x] AC5: 全量 suite 绿（fan-in 时由 AC78 workflow 全量验证；本任务按令不跑全量 suite）。

## Definition of Done

- [x] 15+4 路由全部有截图 + 真实 HTTP 页面验证（非只存图）；Web UI 文档页完整；取图来源开发树已定死（真实输出）。

## Evidence

执行时刻：2026-08-21。worktree `gap-docs-t3-webui-doc-and-screenshots`，开发树
`node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 8123`
（`.quay/config.yml` 为 worktree 本地 gitignored 配置，native provider → 本 worktree 的 tasks/adr）。

**AC1 — 文档覆盖 15 精确 + 4 详情（差 0）**
- `docs/webui-guide.md` 路由总览表 19 行（15 精确 + 4 详情），逐条核对 `serve-handlers.ts` 门面分发器
  （`/`、`/dashboard`、`/tasks`、`/system`、`/manager`、`/tests`、`/sessions`、`/architecture`、
  `/live`、`/journal`、`/git-history`、`/board`、`/adr`、`/goal`、`/doc` +
  `/adr/:id`、`/goal/:id`、`/doc/:id`、`/task/:id`）= 文档全覆盖，差 0。
- 19 张截图全部在 `docs/images/webui-*` 且全部被文档引用（grep 核对 19/19 无遗漏引用、无悬空引用）。

**AC2 — 每张截图对应路由真实 HTTP 断言（AC119 手法，非 curl 探活）**
- `docs/capture-webui-screenshots.sh` 对每条路由：curl 取回页面内容（`/` 断言 302 + `Location: /dashboard`，
  其余断言 HTTP 200 + 页面 `<h1>` 关键元素存在），19/19 全 PASS。
- 服务端 CSS 已确认渲染：`/dashboard` 页面 `<style>` 含 `--color-bg: #f3f2f2`，chrome-devtools
  实测 `getComputedStyle(document.body).backgroundColor === "rgb(243, 242, 242)"`（Modernist token 生效）。

**AC3 — 截图非空白（像素核验，AC100 判据）**
- `docs/verify-webui-screenshot.mjs` 解码 PNG：19/19 均 `verdict: non-blank`
  （Modernist 浅底 90.9–98.6%、深色正文 0.5–4.5%、accent `#ec3013` 命中 325–4130 px）。
- 19 张 PNG md5 全不相同（非同一张复制）。

**AC4 — 取图来源开发树 + 文档注明 --host**
- 截图全部取自行 `node --experimental-strip-types packages/quay/bin/quay.ts serve --host ... --port ...`
  的开发树服务；`docs/webui-guide.md`「启动」节注明 `--host <ip>` 与 `--port <port>` 及打包产物
  样式缺失警示（`gap-webui-modernist-css-missing-in-tgz` 未 land 前）。

**数据**：详情路由示例 `/adr/ADR-016`、`/goal/AC-100`、`/doc/DOC-001`、`/task/gap-docs-t3-webui-doc-and-screenshots`
均 200 渲染真实内容。`goals/AC-100-*.md` 为本地 demo goal-store 记录（AC100 同款 demo workspace 做法，**不提交**），
用于让 `/goal/:id` 详情页渲染非空页面。

**AC5**：按执行令不跑全量 suite——留待 fan-in（AC78 workflow）全量验证。

## Touches

- docs/webui-guide.md（新增——Web UI 用户文档页，19 路由全列表 + 截图引用 + 启动命令含 --host）
- docs/images/webui-*（新增——19 张截图：15 精确路由 + 4 详情；含 webui-screenshots.tsv 清单）
- docs/capture-webui-screenshots.sh（新增——截图+真实 HTTP 断言+像素核验脚本，复用 AC100/AC119 流程）
- docs/verify-webui-screenshot.mjs（新增——PNG 像素核验：Modernist 浅底/深色正文/accent，判非空白页）
- goals/AC-100-webui-detail-pages-modernist-tokens.md（**本地 demo 数据，不提交**——/goal/:id 详情页渲染用，AC100 同款 demo workspace 做法）
- tasks/gap-docs-t3-webui-doc-and-screenshots.md（自身）
