---
id: gap-docs-t3-webui-doc-and-screenshots
title: T3 Web UI 用户文档 + 截图：15 路由+4 详情全覆盖（人裁定截图+页面验证，开发树取图）
status: ready
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
4. 截图存 `docs/images/webui-*.png`，文档引用。

## Acceptance Criteria

- [ ] AC1: Web UI 文档页覆盖全部 15 条精确路由 + 4 条详情路由（`serve-handlers.ts:2584-2698` 的精确路由集合 vs 文档 = 差 0）。
- [ ] AC2: 每张截图对应路由有真实 HTTP 断言（页面 200 + 关键元素存在，AC119 手法——非 curl 探活）。
- [ ] AC3: 截图真实产出非空白页（像素核验，复用 AC100 判据；仓库已有流程）。
- [ ] AC4: 截图取**开发树** serve（非打包产物——CSS 缺陷未 land 前打包无样式）；文档注明 serve 命令含 `--host`。
- [ ] AC5: 全量 suite 绿。

## Definition of Done

- [ ] 15+4 路由全部有截图 + 真实 HTTP 页面验证（非只存图）；Web UI 文档页完整；取图来源开发树已定死（真实输出）。

## Touches

- docs/webui-guide.md（新增——Web UI 用户文档页）
- docs/images/webui-*.png（截图，具体文件按路由定）
- 截图生成脚本（复用 AC100 流程）
- tasks/gap-docs-t3-webui-doc-and-screenshots.md（自身）
