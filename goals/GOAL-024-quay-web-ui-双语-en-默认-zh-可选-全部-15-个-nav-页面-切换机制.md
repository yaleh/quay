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
needs-human/journal/git-history/tests/sessions/adr/goal/doc/architecture）各自的 UI 外壳文案在 zh 下
相对当前英文基线发生真实变化。判据先卡两个最容易被跳过的点——**导航当前项标签**与**该页面自己的
`<title>`**；只改了共享导航栏一处，不足以让 15 条判据连带通过（title 是每页独有的）。

非目标：
不翻译数据内容本身（任务体、commit message、日志原文、goal criterion 脚本的诊断输出等）——那是内容，
不是界面；不覆盖 `serve-send.ts` 消息投递结果页（非 nav 常驻页，不在 `SITE_NAV_ROUTES` 里）。

## 判据形态（2026-09-17 人裁定：选项 A「探已在运行的实例」）

16 条 AC 的 criterion 全部走 **AC-179 既定探针形态**：从【已在运行】的 `quay.ts serve` 进程
（`pgrep -f 'quay.ts serve'`，且 `/proc/<pid>/cwd` == `git rev-parse --show-toplevel`）派生地址，
再 `curl` 做 en / zh 差分断言。

**为什么不是每条自启一个 web 服务器**（初版设计，已废弃）：实测自启一次 27–60s；而
`goal-driver.ts:2979-2985` 的 pass 1 对每个 active GOAL 下的**每条** AC **每轮无条件**执行判据
（无预算、无轮转），`meta-driver.ts:1017-1035` 的 `collectReadings` 还对**同一群体**再执行一遍
⇒ 16 条会让每轮增加 7–16 分钟且成本付两遍，把观测到的 8–20 分钟轮间隔进一步推长。
改探针后实测 **0.345s/条**（约 100–170 倍差距），每轮总计约 5.5s。

**⛔ 运行前提（运维须知，不是可选项）**：判据读的是**运行中的服务**，因此
①必须有一个 cwd = 仓库根的 `quay.ts serve` 实例在跑；没有实例时判据 fail-closed 并在 stderr 给出
可区分的 `CAUSE=no-running-serve-instance`；
②**实现落地后必须重启该实例**，否则判据读到的仍是旧代码渲染的页面（这与 AC-179 的前提相同）。

## 退出条件

16 条 AC 全部 achieved：AC-288（切换机制——默认 `en`、`?lang=zh` 生效并种下持久化 cookie、cookie
单独也能在不带 query 参数的后续请求里继续生效）+ AC-289~AC-303（15 个 nav 路由，每条要求：默认语言下
存在该页 nav 标签字面量、`Cookie: lang=zh` 下响应为 `<html lang="zh">`、该英文 nav 标签消失、
且**该页自己的 `<title>` 相对默认语言发生变化**）。
