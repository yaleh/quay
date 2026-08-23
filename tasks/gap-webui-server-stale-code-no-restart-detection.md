---
id: gap-webui-server-stale-code-no-restart-detection
title: web UI server 服务陈旧代码无感知（8.5h 未重启、11 UI 任务不可见，无机制提醒）
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

**来源**：人问「这些记录 web 的 tests 页能看到吗」，manager curl 生产 server（`100.78.206.100:4173`）核实发现。

**现象（实测）**：server 进程 06:38:06Z 启动（裸 nohup 常驻，ppid=1，无 supervisor），`gap-webui-tests-page-startedat-clickable` 07:02:10Z 落地（晚 24min）——但 curl 现场表头只有 7 列（源码 8 列），`startedAt` 列 + commit 超链接（`<a href="/git-history?commit=...">`）完全缺失，commit 单元格是裸 `<code>`。数据本身新（453 条全在），**但代码是落地前的陈旧版**。06:38Z 后落地的 webui/git-history/test-detail 类任务共 **11 条**，UI 改动大概率全不在 serving 进程里。

**已止损（outer 2026-08-23）**：重启 server（435604 → 2812230），curl /tests 现 startedAt 列 + commit 恢复。

**影响**：UI 任务落地到「有人重启 server」之间有个滞后窗口，且**无任何机制感知或提醒**——server 不知自己代码过期，用户/manager 肉眼看到的页面与刚落地代码脱节。与 worker-driver「stale code 未重启」同族（本次 stale driver 根因），只是 web server 侧。

## Plan

1. 机械检测：比对 server 进程启动时刻 vs 最新相关 commit 时刻（`packages/quay/src/` + serve 相关），过期 ⇒ 信号（健康端点报 stale / 提醒 / 自动重启）。
2. 或给 server 加 supervisor 自动按需重启（同 worker-driver 的 supervisor 模式）。

## Acceptance Criteria

- [ ] AC1：server 代码过期可被检测（比对启动时刻 vs 最新 commit，过期 ⇒ 有信号/自动重启；⛔ 无感知 ⇒ 假）。

## Definition of Done

- [ ] server 陈旧代码检测/自愈机制落地 + 实测过期可报；AC1 全勾；land 到 develop。

## Retires

- 无

## Touches

- packages/quay/src/serve.ts（若健康端点报 stale / 自检）
- packages/quay/bin/quay.ts（若启动面 supervisor）
- packages/quay/test/serve.test.mjs（test）
- tasks/gap-webui-server-stale-code-no-restart-detection.md（自身）
