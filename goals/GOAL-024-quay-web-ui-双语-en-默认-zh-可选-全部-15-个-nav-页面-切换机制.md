---
id: GOAL-024
title: quay web UI 双语（EN 默认 / ZH 可选），全部 15 个 nav 页面 + 切换机制
status: draft
kind: goal
origin: 人 2026-09-17 在对话中裁定：新增 quay web UI 双语（EN 默认 / ZH 可选）目标；达成范围 = 全部 15 个
  SITE_NAV_ROUTES 页面 + 切换机制本身（用户在 AskUserQuestion 中选择「全部 15 个页面」而非「机制 + 3
  个代表页」或「拆两个 GOAL」）。
---
## 背景

quay web UI（`packages/quay/src/serve*.ts`，15 个 nav 路由，纯 Node `http` + 模板字符串手写 HTML，
无前端框架、无构建步骤）目前每个页面都写死 `<html lang="en">`，但页面正文已经混杂 843 处未成体系的
中文字符串（`serve-render.ts` 的 `SITE_NAV_GROUPS` 分组标签本身就已经是中文），且完全没有语言切换、
cookie、`lang=` 参数等机制——`lang="en"` 的字面值今天已经是不准确的。2026-09-17 与用户讨论后决定新增
双语（EN 默认 / ZH 可选）能力，选择在页面上可见可选（不是纯粹靠 Accept-Language 猜测）。

## 范围与非目标

范围：
①切换机制本身——`?lang=` 查询参数解析、cookie 持久化跨请求生效、默认无参数时为 `en`；
②全部 15 个 nav 路由页面（`SITE_NAV_ROUTES`：dashboard/tasks/live/board/system/manager/
needs-human/journal/git-history/tests/sessions/adr/goal/doc/architecture）各自的 UI 外壳文案
（导航当前项标签 + 该页面自己的 `<title>`，作为最低限度的"这页真的参与了切换"信号；实现时应同步覆盖
标题/按钮/空态/错误提示等其余外壳文案，AC 判据先卡这两个最容易被跳过的点）在 zh 下相对当前英文基线
发生真实变化——不是只改了共享导航栏一处就让 15 条判据全部连带通过。

非目标：
不翻译数据内容本身（任务体、commit message、日志原文、goal criterion 脚本的诊断输出等）——那是内容，
不是界面；不覆盖 `serve-send.ts` 消息投递结果页（非 nav 常驻页，不在 `SITE_NAV_ROUTES` 里）。

## 退出条件

16 条 AC 全部 achieved：AC-288（切换机制——默认 `en`、`?lang=zh` 生效并种下持久化 cookie、cookie
单独也能在不带 query 参数的后续请求里继续生效）+ AC-289~AC-303（15 个 nav 路由，每条页面自己的导航
当前项标签与 `<title>` 在 `Cookie: lang=zh` 下相对当前基线都发生真实变化，且响应头 `<html lang="zh">`
正确）。
