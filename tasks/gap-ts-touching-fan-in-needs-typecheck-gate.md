---
id: gap-ts-touching-fan-in-needs-typecheck-gate
title: fan-in 准入只看 scoped 绿——新增/移动 .ts 文件的场景漏掉 ts-typecheck 闸
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（2026-08-12，round 52 红）**：cli-import-migration fan-in 依据「scoped 79/0 绿」通过，
但**scoped 检查没覆盖 ts-typecheck 闸**——17 verb handler 搬进 20 个新 `.ts` 文件（类型图改变，
不只是行为），`npx tsc --noEmit` 报 **73 错全在 src/cli/**（ctx 类型迁移丢失）。
3 分钟后全量套件 round 52 红在 ts-typecheck-gate。

**这不是「谁马虎」——是 scoped 覆盖面与 fan-in 准入条件不匹配**：
一次大规模文件搬迁（新增/移动 `.ts`）恰恰是 scoped 最不该被信任的场景（改变的是类型图）。
**scoped 全绿 + 全量红** 的成本 = 550s 红轮 + 阻塞 batch-merge。

## Plan

1. 在 fan-in 前置加判据：**任务的 `## Touches` 含新增/移动 `.ts` 文件 ⇒ 先跑一次 `ts-typecheck` 闸**
   （`quay gate <task> --gate ts-typecheck`，现成机件，~20s）。
2. 纳入 fan-in 准入检查（与 scoped 绿并列，不替代）。

## AC

- [ ] AC1: fan-in 前置识别「Touches 含新增/移动 .ts」的任务
- [ ] AC2: 此类任务 fan-in 前必跑 ts-typecheck 闸（现成机件 ~20s）
- [ ] AC3: 负控制——cli-import-migration 这类任务在修复前被该闸挡住（不再以 scoped 绿通过）
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 复现用例（新增 .ts 任务 → fan-in 前置跑闸）贴出（见 Evidence）
- [ ] 全量套件绿

## Touches

- plugin/scripts/（fan-in 准入检查，ts-typecheck 前置）
- tasks/gap-ts-touching-fan-in-needs-typecheck-gate.md（自身）
