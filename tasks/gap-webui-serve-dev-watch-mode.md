---
id: gap-webui-serve-dev-watch-mode
title: 记录 node --watch 开发用法（不新增 --dev/--watch 入口——node --watch 机制已可用，零产品表层）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

人提议：web server 增加开发模式自动加载最新实现。背景：本轮撞到第 5 次「陈旧进程跑旧代码」（web server 12:11:47Z 启动，live-page 修复 14:21:53Z 落地，/health stale:true，/live 显示 5-13h 假在飞；手动重启后恢复）。`gap-webui-server-stale-code-no-restart-detection`（done）只做了检测（/health stale 字段），Plan 里「或加 supervisor 自动按需重启」分支未落地——这正是本次缺口。

**可行性已验（manager 现场）**：`node --watch --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port <p>` 直接启动现有 serve 入口（零改代码），/health 返回 stale:false。Node 内置 --watch 对 import 的模块变更自动重启整个进程（Node ≥18 文档化标准能力）。

**范围澄清（人 2026-08-24）**：node --watch 机制本身已可用，**不新增 --dev/--watch CLI 入口**——直接用 `node --watch <既有入口>` 启动即可，省一个不必要的新增产品表层。

## Plan

**默认只做文档记录**：README.md/CLAUDE.md 写清 `node --watch --experimental-strip-types packages/quay/bin/quay.ts serve --host <ip> --port <p>` 的开发用法。⛔ 不新增 CLI 标志/产品表层。**仅在文档路径验证不出闭环（AC1 端到端）时才退回加 `--dev`/`--watch` 入口**。

## Acceptance Criteria

- [ ] AC1（能取假，端到端自动重启生效）：改一个 serve-handlers.ts 的字符串 → 等自动重启 → curl 验证新内容出现（⛔ 只测启动不测「改动→重启→新代码生效」闭环 ⇒ 假）。

## Definition of Done

文档记录 node --watch 开发用法落地 develop；AC1 全勾；改源码自动重启、新代码 curl 生效（AC1 复现）。若文档路径验证不出闭环，退回加 CLI 入口后同 AC1 验收。

## Touches

- README.md（记录 node --watch 开发用法——首选，零产品表层）
- CLAUDE.md（同 README 记录——首选，零产品表层）
- packages/quay/bin/quay.ts（--dev/--watch 入口——仅文档路径验证不出闭环时退回）
- packages/quay/test/serve-*.test.mjs（AC1 端到端测试）
- tasks/gap-webui-serve-dev-watch-mode.md（自身）