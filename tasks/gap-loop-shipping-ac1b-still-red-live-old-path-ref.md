---
id: gap-loop-shipping-ac1b-still-red-live-old-path-ref
title: loop-shipping AC1b 仍红——仓库有对 5 个旧路径的活引用
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（outer 2026-08-12 隔离重跑）**：`plugin/test/loop-shipping.test.mjs` AC1b 隔离失败（14 pass / 1 fail）："after the move, no live reference to the 5 old paths remains"。非负载敏感（隔离即红）。

5 个旧路径：
```
orchestration/orchestrator-loop-tick.md
docs/analysis/fast-mode-loop-tick.md
orchestration/watch/inner-forensics.mjs
orchestration/watch/inner-state.sh
scripts/resource-gate.sh
```

**已排除**：`plugin/scripts/checker-mutation-cases/instrument-failure-check.sh` 引用 `orchestration/orchestrator-loop-tick.md`（其 surface 必须匹配 `instrument-failure-check.ts` DEFAULT_SURFACE，DEFAULT_SURFACE 含该路径——合法，已在 `loop-shipping-exclusion-data.mjs` 排除条目里）。

**活引用在别处**（outer 扫描见 tasks/*.md 引用 + 其它，需 inner 定位 AC1b 扫描的 hits 精确对象——walkCorpus 是测试本地函数，用 `assert.deepEqual(hits,[])` 的 actual 数组）。

**为什么之前绿**：round 18（e63439d6）全绿时 loop-shipping 过；之后某提交引入了新引用（或排除数据变化）。需 git 定位引入者。

**选定机制**：找到 AC1b 扫描的 hits 精确对象 → 若是误排除（合法引用）加排除条目；若是真引用，更新调用方到新路径（plugin/loop/ 或 plugin/scripts/）。

**验证锚**：(a) 定位 hits 精确对象（文件+路径+引入 commit）；(b) 修复（排除或更新调用方）；(c) loop-shipping 隔离绿；(d) `--for-task` scoped 门绿。

## Plan

1. 跑 `node --test plugin/test/loop-shipping.test.mjs`，从 AC1b 的 `assert.deepEqual(hits,[])` actual 数组拿精确对象。
2. git blame 定位引入者。
3. 修复：排除（若合法）或更新调用方（若真引用）。
4. 回归：loop-shipping 隔离绿 + `--for-task` scoped。

## AC

- [ ] AC1: AC1b 扫描 hits 精确对象已定位（文件+路径+引入 commit）
- [ ] AC2: 修复（排除合法引用 / 更新真引用到新路径）
- [ ] AC3: loop-shipping.test.mjs 隔离全绿
- [ ] AC4: `--for-task` scoped 门绿；既有测试全绿
- [ ] AC5: 无回归（其它 AC 仍绿）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] hits 对象 + 引入者 + 修复贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/test/loop-shipping.test.mjs（AC1b 扫描 hits 定位）
- plugin/scripts/loop-shipping-exclusion-data.mjs（排除合法引用，若需）
- 引用旧路径的调用方文件（更新到新路径 plugin/loop/ 或 plugin/scripts/，定位后）
- tasks/gap-loop-shipping-ac1b-still-red-live-old-path-ref.md（自身：勾 AC + 贴证据）
