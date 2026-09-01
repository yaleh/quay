---
id: gap-fan-in-doc-check-cache
title: doc-check 产物按 (docs 状态) 键控缓存——docs 未变时 0 秒
status: done
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

- [x] AC1 docs 未变时 doc-check 墙钟 ~0（step-trace reason=cache-hit）
- [x] AC2 docs 变化时失效重跑，判定与无缓存一致（对照 N 次）
- [x] AC3 缓存键只含 docs 面（非 doc 文件变化不触发重跑，反之亦然）

## Definition of Done

缓存模块落地 develop 并被 worker-driver.ts doc-check 步骤调用；AC1-3 全勾；生产载体验证 docs 未变时出现 cache-hit 且无假命中。

## Touches

- plugin/scripts/worker-driver.ts（doc-check 步骤缓存逻辑）
- plugin/scripts/doc-check-cache.ts（缓存实现模块）
- plugin/scripts/capability-catalog.sh（doc-check-cache 六表登记）
- plugin/test/doc-check-cache.test.mjs（缓存模块单测）
- tasks/gap-fan-in-doc-check-cache.md（自身）
