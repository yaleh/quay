---
id: gap-fan-in-continue-doc-only-advance-reuse-suite
title: develop 在 suite 期间被 doc/inert 前进时，CONTINUE 重跑复用上一 green 判定（按测试影响面键控 suite）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

现有 doc-only 快路径（`worker-driver.ts:2349` `doc-only delta → skip suite`）只覆盖「任务自身 delta 是 doc」；「develop 在 suite 期间被 doc/inert 前进 → ff not-fast-forward → CONTINUE 重跑全量 suite」无复用机制（重跑时任务 delta 仍是 code ⇒ needSuite=true，即使 develop 只进了 doc 变更）。suite 是 (develop HEAD × delta) 的纯函数；若 develop 前进只触及 doc/inert 面（测试影响面未变），上一 green 判定可复用，CONTINUE 只跑 {merge → delta → {typecheck ∥ doc}}，不重跑 suite。

## Plan

1. 扩展 delta 分类器到 develop 前进面（机械读「develop 前进触及的文件是否属 doc/inert 面」，不靠人工）。
2. CONTINUE/重跑路径：develop 前进只触及 doc/inert 面 ⇒ 复用上一 green suite 判定，不重跑 suite。
3. code 前进 ⇒ 照常重跑 suite（不削弱合并验证）。
4. 验证：doc/inert-only 前进触发 CONTINUE 该轮无 suite step；code 前进照常重跑；复用判定与重跑一致（N 次对照）。

## Acceptance Criteria

- [ ] AC1 doc/inert-only 前进触发的 CONTINUE 不重跑全量 suite（生产 step-trace 该轮无 suite step）
- [ ] AC2 code 前进触发 CONTINUE 时照常重跑 suite（不削弱合并验证）
- [ ] AC3 doc-only 前进后复用判定与重跑一致（对照 N 次，无翻转）
- [ ] AC4 测试影响面判定可机械读（delta 分类器扩展到 develop 前进面，不靠人工）

## Definition of Done

复用机制落地 develop：CONTINUE 在 develop 仅 doc/inert 前进时复用上一 green suite 判定、不重跑全量 suite，code 前进仍照常重跑（不削弱合并验证）；AC1-4 全部勾选。

## Touches

- plugin/scripts/worker-driver.ts（CONTINUE/重跑路径 + delta 分类器扩展）
- tasks/gap-fan-in-continue-doc-only-advance-reuse-suite.md（自身）

## Needs-Human

**执行 2026-09-01T04:40:29.349Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
