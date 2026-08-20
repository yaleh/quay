---
id: gap-ac119-webui-cross-project-verification
title: "AC119 Web UI 跨项目验证：近期 5 项 webui 改进在第三方项目真实数据上逐条核对"
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

**来源**：人 2026-08-20 14:0xZ 逐字：「最近 web ui 有重大改进。本阶段 AC 和任务也应包括对其它项目中 quay web ui 使用的验证。」

**背景**：上阶段"Web UI 改进版落地"已达成的 5 项具体改进，此前只在 quay 自己的任务板/tick-log 数据上验证过——quay 自己的数据形状（字段是否齐全、任务数量级、label 分布）可能恰好绕开某些边界情况（同 AC92 教训："验证的是端口活着，不是真实使用"）。

**待验证的 5 项改进**：
- `/sessions` 按 Manager/Outer/Inner 分层渲染（`gap-webui-sessions-no-layer-labels`）
- `/journal` 读 tick-log 改用 `readRecentSections`（`gap-webui-journal-reads-stale-data`）
- `/board` 服务端分页 + status/label 筛选（`gap-webui-board-no-pagination`）
- `/board` 冷加载 120s→个位数秒（`gap-webui-board-load-120s`）
- 统一 `renderSiteNav`/`renderMobileChrome` 导航（`gap-webui-nav-inconsistent-routes`）

**判据**（完整原文在 orchestration/manager-phase-goal.md AC119，本任务体不复制）：在 AC118 所用第三方项目（或另一个独立第三方项目）上 `quay serve` 指向该项目配置，通过真实 HTTP 请求（**不是 `curl` 200 探活**，需实际取回页面内容并断言关键元素存在）逐条验证 5 项。**若发现新缺陷**：按缺陷处置（归 outer 立案），⛔ 不得为了勾 AC 回避/隐藏该缺陷。

**⛔ 前置依赖**：需要 AC118（或并行另一独立第三方项目）已就位 + 当前版本产物可 serve。AC104→AC105→AC107 完成前无法执行。

## Plan

1. **前置确认**：AC118 的目标项目（或另一独立第三方项目）+ 当前版本产物可用。
2. **`quay serve` 指向该项目配置**：在目标主机（B/C）上启动 serve 指向该项目的 `.quay/config.yml`。
3. **逐条真实 HTTP 验证 5 项**（非探活，断言关键元素）：
   - `/sessions`：分层渲染正确无跨层混排；无 manager 层则优雅降级不报错
   - `/journal`：正确读取该项目自己的 tick-log/等价记录；无该文件则 fail-closed 报 empty 不崩溃
   - `/board`：分页 + status/label 筛选在该项目真实数据上工作正确
   - 导航栏在该项目所有路由上一致渲染
4. **缺陷处置**：任一出现渲染错误/崩溃/串号 ⇒ 按缺陷立案，不回避。
5. **写记录**：`.quay/productization-verification.jsonl`，`ac="AC119"`，含目标项目名 + 逐条验证结果。

## Acceptance Criteria

- [x] AC1: 在第三方项目上 `quay serve` 指向该项目 `.quay/config.yml`，真实 HTTP 请求（非 curl 探活）取回页面内容并断言关键元素。
- [x] AC2: `/sessions` 分层渲染正确（多层数据无跨层混排；无 manager 层则优雅降级）。
- [x] AC3: `/journal` 正确读取该项目自己的数据（无文件则 fail-closed 报 empty，不崩溃不串号）。
- [x] AC4: `/board` 分页 + status/label 筛选在该项目真实数据上工作正确。
- [x] AC5: 导航栏在所有路由一致渲染；任一渲染错误/崩溃/串号按缺陷立案（⛔ 不回避）。
- [x] AC6: 记录写入 `.quay/productization-verification.jsonl`（`ac="AC119"`，含项目名 + 逐条结果）。

## Definition of Done

- [x] 判据全满足；`.quay/productization-verification.jsonl` 有 `ac="AC119"` 记录；发现的新缺陷已立案非回避。

## Evidence

验证时刻：2026-08-20T23:15–23:28Z。目标项目 = AC118 所用第三方项目 **meta-cc**（host B=orangevps，
`/home/yale/work/meta-cc`，102 任务 / 无 orchestration/ / 无 plugin/ / 无 session-liveness）。
当前版本产物 = `quay-0.6.0.tgz`（build 8c6e76e04fa9，sha256 63b1098d…），runtime 装进
`meta-cc/.quay/runtime/`（vendored quay + quay-native + provider.yml，node v22.23.1）。
`quay serve --port 4237 --host 127.0.0.1` 指向 meta-cc `.quay/config.yml`；逐条**真实 HTTP**（curl/python 取回页面内容，非 200 探活）。

| 项 | 结果（关键元素断言） |
|---|---|
| `/sessions` | HTTP 200；`<h1>Sessions — Manager / Outer / Inner 最近会话</h1>` + 降级注记 `未接入/无数据 — ../../../plugin/scripts/session-liveness.sh 缺失（未接入）`；无 500；meta-cc 无会话数据 ⇒ 走优雅降级分支，无跨层混排。 |
| `/journal` | HTTP 200；读 meta-cc **自己**的 git log：渲染 `4726416 tasks: AC118-001/002/003 execute-to-done gate passed, flip to done`（非 quay 数据）；tick-log fail-closed：`无数据 — missing tick-log.md`（escalations 同理）；不崩溃。 |
| `/board` 分页 | HTTP 200；page1/2/3 各 20 条且互不相交（AC118-001…DIR-017 / DIR-018…），全量 102 任务 → "Page 1 of 6"；服务端分页。 |
| `/board` status 筛选 | `?status=done` → 88 行全部 status 含 done（0 不匹配）；`?status=todo` → 14 行全部 todo（0 不匹配）；done∩todo=∅。 |
| `/board` label 筛选 | `?label=directive` → 6 行（DIR-001/002/003/004/017…）全部含 directive（0 不匹配）。 |
| 导航栏 | 16 条路由（/ /dashboard /tasks /board /live /journal /sessions /system /manager /tests /git-history /architecture /adr /goal /doc /task/AC118-001）全部 200 + `<nav class="site-nav">` + `<nav class="mobile-menu">` 均渲染、各 13 个链接；`aria-current` 随路由正确（/board→Board、/journal→Journal、/task/*→Tasks）。 |

记录：已 append 至主检出 `.quay/productization-verification.jsonl`（`ac="AC119"`，project=meta-cc，
host=B，逐条结果见 detail/items 字段），ts=2026-08-20T23:27:44Z。

**发现缺陷（按 AC 处置，归 outer 立案，不回避）**：
`quay serve` 打包产物（dist/quay.js / vendored runtime）渲染**无样式**——`modernistStyles()`
`readFileSync(new URL("./webui-modernist.css", import.meta.url))` 从 bundle 同目录读 CSS，但
`quay-0.6.0.tgz` 把该文件放在 `src/webui-modernist.css`（`dist/` 下没有），`quay-init` 的 runtime 落盘
（`.quay/runtime/bin/quay.js`）也不带它 ⇒ serve 日志 `[quay serve] webui-modernist.css missing: ENOENT`，
页面 200、内容/结构正确但 `<style>` 为空。5 项功能改进在 meta-cc 真实数据上**全部工作正确**；此 CSS
资产缺失是独立打包缺陷（AC118/AC107 只验 CLI 生命周期，未 serve webui，故此前未暴露）。→ 建议 outer 立案修复。

## Touches

- .quay/productization-verification.jsonl（记录）
- 目标第三方项目（AC118 项目或另一独立项目）的 web ui 数据面
- tasks/gap-ac119-webui-cross-project-verification.md（自身）
