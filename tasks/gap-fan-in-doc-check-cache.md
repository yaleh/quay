---
id: gap-fan-in-doc-check-cache
title: doc-check 产物按 (docs 状态) 键控缓存——docs 未变时 0 秒
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

doc-check（11.6s，165 次/周=0.53h）是 (docs 相关文件集→verdict) 的纯函数；按 docs 面 blob 哈希键控缓存，docs 未变命中、墙钟~0，变化失效重跑。

## Plan

1. 定义 docs 面文件集（与 doc-check 输入一致）。
2. 按 docs 面 blob 哈希建缓存键；docs 未变命中缓存（step-trace reason=cache-hit），变化失效重跑。
3. 缓存键只含 docs 面（非 doc 文件变化不触发重跑，反之亦然）。
4. 验证：docs 未变 ~0s；docs 变化重跑判定与无缓存一致（N 次对照）。

## Acceptance Criteria

- [ ] AC1 docs 未变时 doc-check 墙钟 ~0（step-trace reason=cache-hit）
- [ ] AC2 docs 变化时失效重跑，判定与无缓存一致（对照 N 次）
- [ ] AC3 缓存键只含 docs 面（非 doc 文件变化不触发重跑，反之亦然）

## Definition of Done

缓存模块落地 develop 并被 worker-driver.ts doc-check 步骤调用；AC1-3 全勾；生产载体验证 docs 未变时出现 cache-hit 且无假命中。

## Touches

- plugin/scripts/worker-driver.ts（doc-check 步骤缓存逻辑）
- plugin/scripts/doc-check-cache.ts（缓存实现模块）
- tasks/gap-fan-in-doc-check-cache.md（自身）

## Needs-Human

**执行 2026-09-01T04:40:29.692Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
