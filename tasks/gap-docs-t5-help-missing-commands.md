---
id: gap-docs-t5-help-missing-commands
title: T5 quay --help 漏 adr/config validate/manager 三命令（代码缺陷，用户无法发现）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：manager 2026-08-21 01:0xZ 产品化交付文档审计（人明令检查 + 立案）。缺口 T5：`quay --help` 漏三个命令——**这是代码缺陷不是文档**。

**缺口**：`packages/quay/src/cli/help.ts:18-37` 的 Usage 块列 19 行，**漏 `adr`、`config validate`、`manager`**。`adr` 尤其严重：`quay.ts:177` 有真实 dispatch、`:159` 承认 8 个子命令，但**全仓库任何 usage 行都不提它** ⇒ 用户无法发现该命令存在。

**判据可机械取假**：help 输出与 `quay.ts` dispatch 表的命令集合差 = 0。

**为什么 inner 执行**：help.ts 属产品代码（`packages/quay/src/`）→ inner 域（D 段边界 outer 不改产品代码）。

## Plan

1. 核实 `quay.ts` dispatch 表的完整命令集合 vs `help.ts:18-37` Usage 块（diff 出缺失）。
2. 补 `adr`、`config validate`、`manager` 三命令到 Usage 块（对齐 dispatch 表）。
3. 验证：help 输出与 dispatch 表命令集合差 = 0。

## Acceptance Criteria

- [ ] AC1: `quay --help` 输出含 `adr`、`config validate`、`manager`（Usage 块补齐）。
- [ ] AC2: help 输出与 `quay.ts` dispatch 表命令集合差 = 0（可机械取假：diff 命令集合）。
- [ ] AC3: 全量 suite 绿（含 help 相关测试）。

## Definition of Done

- [ ] help Usage 块含全部 dispatch 命令（含 adr/config validate/manager）；命令集合差 = 0（真实输出）。

## Touches

- packages/quay/src/cli/help.ts（补三命令）
- packages/quay/bin/quay.ts（若 dispatch 表需核对）
- packages/quay/test/（help 相关测试）
- tasks/gap-docs-t5-help-missing-commands.md（自身）
