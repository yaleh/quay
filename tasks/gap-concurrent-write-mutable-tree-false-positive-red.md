---
id: gap-concurrent-write-mutable-tree-false-positive-red
title: 验证轮在可变工作树上跑——同轮提交到共享树 ⇒ 假阳性红（对照实验证实）
status: ready
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

**实证（2026-08-12，对照实验）**：round 53 红在 `quay-init-loop-core.test.mjs`（AC4 laid-down tick docs byte-identical），
窗口内三个写者提交改共享树（inner 类型修 6f4800dc / fan-in c19e70a1 / 外层协调 132210f4 / manager A4 改核 94a56054）。
round 54 干净窗口（19:23:39-19:30:16 零提交）**同一测试绿（67s PASS）**。

**⇒ 「并发写 tick 文档 ⇒ 假阳性红」假设被对照实验支持。**
任何一轮的红都可能是同轮提交造成的假阳性（套件跑的是会变的工作树，不是钉住的检出），
当前无任何机制表达这件事。

**推论**：round 53 作废的理由不是「verifiedCommit 缺修复」（manager 先前的解释，后自纠），
而是「并发写 FP」——整轮作废会丢掉「那棵树上 quay-init-loop-core 会红」的信息。

## Plan

1. 起跑前钉住验证目标：起跑时记录 HEAD，终态写入前比对，不一致 ⇒ 标 `reason=infra-error`/「树被移动」。
2. 或：验证轮从 git worktree 跑（钉住的检出），主检出不受影响（如 verify-worktree 模式）。
3. 判据：任何红在归因前先查「窗口内是否有提交落进树」。

## AC

- [ ] AC1: 验证轮起跑/终态比对 HEAD，树被移动 ⇒ 明确标注（非红判据）
- [ ] AC2: 红归因前查「窗口内提交」，并发写 ⇒ 标注假阳性候选
- [ ] AC3: 负控制——round-53 类（同轮提交）被检出并标注
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 复现用例（同轮提交 ⇒ 标假阳性）贴出（见 Evidence）
- [ ] 全量套件绿

## Touches

- plugin/scripts/full-suite-runner.ts（起跑/终态 HEAD 比对）
- plugin/scripts/suite-state-trigger.ts（红归因前查窗口提交）
- tasks/gap-concurrent-write-mutable-tree-false-positive-red.md（自身）
