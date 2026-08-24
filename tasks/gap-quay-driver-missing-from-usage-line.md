---
id: gap-quay-driver-missing-from-usage-line
title: quay driver 子命令不在顶层 usage 行（可运行但不可发现）
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

**来源**：manager 委托补 README 时核对发现（`quay driver` 是 AC139 的真实子命令，但顶层 usage 行漏了它）。

**现象（实测）**：`node packages/quay/bin/quay.ts`（无参数）打印的 usage 行是 `quay <init|task list|…|serve|mcp|manager start|manager adopt>`——**没有 `driver`**；但 `quay driver --help` 能正常出 driver 的用法（`start|stop|drain|status|restart --kind <promotion|worker>`）。⇒ `driver` 可运行但**不可发现**（用户跑 `quay` 无参数 / 输错子命令时看不到 driver）。

**位置**：`packages/quay/bin/quay.ts:209` 的 usage 字符串。

## Plan

1. 把 `driver` 加进 `packages/quay/bin/quay.ts:209` 的 usage 字符串（`…|manager adopt|driver> …`，位置落笔方定）。
2. 同步对应 CLI 测试断言（若有断言 usage 字符串的测试）。

## Acceptance Criteria

- [ ] AC1（能取假）：`quay` 无参数跑，usage 行含 `driver`（⛔ 仍无 driver ⇒ 假）。

## Definition of Done

- [ ] usage 行补 driver + 测试同步；AC1 全勾；land 到 develop。

## Retires

- 无

## Touches

- packages/quay/bin/quay.ts（usage 字符串补 driver）
- packages/quay/test/cli.test.mjs（test：usage 行含 driver）
- tasks/gap-quay-driver-missing-from-usage-line.md（自身）
