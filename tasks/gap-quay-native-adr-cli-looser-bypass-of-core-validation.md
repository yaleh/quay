---
id: gap-quay-native-adr-cli-looser-bypass-of-core-validation
title: quay-native 自带的 ADR CLI 绕开 Core 的校验（无 --title 必填、无
  accept/deprecate/reject/supersede 动词），是未声明的更松入口
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
## Finding

`packages/quay-native/bin/quay-native.ts:117-156` 实现 `adr list/get/write/new/edit` 的方式是直接在进程内调用 `createAdrStore(resolveAdrDir())`，完全绕开 MCP 与 Core 的校验层。相比之下，`packages/quay/src/cli/adr.ts:11-84`（Core 的 `quay adr` CLI，经由 MCP `adr_write` 工具）在 `new` 上要求非空 `--title`，并新增了只有 Core 才校验的语义动词（`accept/deprecate/reject/supersede`）。native CLI 的 `new`/`edit` 命令既没有 title-required 护栏,也没有这些动词——这是通向同一个底层 ADR store 的第二个、更松、且未被声明为「绕开通道」的入口。

Proposed action：短期/低成本——在 `quay-native adr --help` 的输出里加一行说明，声明这是内部/绕开通道，正常使用建议走 `quay adr`。长期/较低紧迫性（直接使用该绕开通道的实况似乎较低）——让 native 的 CLI 校验与 Core 对齐（title-required 护栏、语义动词），使两个表层行为一致,而不是其中一个是静默的后门。

## Acceptance Criteria

- [ ] `quay-native adr --help` 输出新增说明文字，声明该 CLI 是内部/绕开 Core 校验的通道,正常使用建议走 `quay adr`
- [ ] （长期项，若本任务范围内一并完成）`quay-native adr new`/`edit` 增加 title-required 护栏，行为与 `packages/quay/src/cli/adr.ts` 对齐
- [ ] （长期项，若本任务范围内一并完成）`quay-native adr` 增加 `accept/deprecate/reject/supersede` 语义动词，或明确说明为何不需要
- [ ] 既有 `quay-native` ADR CLI 测试全绿，无回归

## Definition of Done

至少完成短期项（help 文字声明绕开通道）；若长期项一并完成，两个 CLI 表层行为一致；测试全绿。

## Touches

- packages/quay-native/bin/quay-native.ts
- packages/quay/src/cli/adr.ts
- packages/quay-native/test/cli-adr.test.mjs
- tasks/gap-quay-native-adr-cli-looser-bypass-of-core-validation.md
