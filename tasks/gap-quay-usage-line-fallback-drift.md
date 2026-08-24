---
id: gap-quay-usage-line-fallback-drift
title: quay 顶层 usage fallback 字符串 4 个同类缺口（adr/manager arm/action run/config
  check）+ 无机械一致性守卫
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`quay` 顶层 usage fallback 字符串有 4 个同类缺口（manager 2026-08-24 审计，直接量）：`gap-quay-driver-missing-from-usage-line` 只修了 `driver` 一个，**字典表 vs usage 字符串没有机械一致性守卫**——`--help` 那份富文本有 set-equality 测试守着，这条短 fallback 字符串没有。

四个真实命令/子命令/路由在 usage 行从未出现：
- `adr` — 真实命令，quay.ts 拨号表有、help.ts 有文档
- `manager arm` — 真实子命令，usage 只显示 manager start|manager adopt
- `action run` — 真实拨号路由，usage 只显示 action list
- `config check` — 真实子命令，usage 只显示 config validate

## Plan

给这条 fallback usage 字符串补一个跟 `--help` 那份一样的 **set-equality 测试**（`cli.test.mjs`），一次性堵死这整类漂移（字典表/拨号表 vs usage 字符串），而不是逐个字符串补。

## Acceptance Criteria

- [x] AC1（能取假，四缺口闭合）：usage fallback 字符串含 adr / manager arm / action run / config check（⛔ 任一仍缺 ⇒ 假）。
- [x] AC2（能取假，机械守卫）：set-equality 测试把「拨号表/字典表命令集」与「usage 字符串命令集」比对，新增命令漏 usage 即红（⛔ 只补 4 个字符串不加守卫 ⇒ 假——会再次漂移）。

## Definition of Done

4 缺口闭合 + set-equality 守卫落地 develop；AC1-2 全勾；新增一条命令而漏 usage 行时测试红（AC2 复现，堵死整类漂移）。

## Touches

- packages/quay/bin/quay.ts（usage fallback 字符串补 4 项）
- packages/quay/test/cli.test.mjs（set-equality 测试，同 --help 那份）
- tasks/gap-quay-usage-line-fallback-drift.md（自身）