---
id: gap-loop-shipping-ac1b-still-red-live-old-path-ref
title: loop-shipping AC1b 仍红——仓库有对 5 个旧路径的活引用
status: done
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

- [x] AC1: AC1b 扫描 hits 精确对象已定位（文件+路径+引入 commit）
- [x] AC2: 修复（排除合法引用 / 更新真引用到新路径）
- [x] AC3: loop-shipping.test.mjs 隔离全绿
- [x] AC4: `--for-task` scoped 门绿；既有测试全绿
- [x] AC5: 无回归（其它 AC 仍绿）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] hits 对象 + 引入者 + 修复贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence

**AC1b 扫描 hits 精确对象（4 条，`assert.deepEqual(hits, [])` actual）**：

| 文件 | 路径引用 | 引入 commit |
|---|---|---|
| `packages/quay/test/install-config-driven-e2e-runtime.test.mjs` | `orchestration/orchestrator-loop-tick.md`（`productSource()` L108 + `REQUIRED_PRODUCT_FILES` L260） | `6cba27d4` |
| `packages/quay/test/install-config-driven-e2e-runtime.test.mjs` | `docs/analysis/fast-mode-loop-tick.md`（`productSource()` L111 + `REQUIRED_PRODUCT_FILES` L261） | `6cba27d4` |
| `packages/quay/test/install-config-driven-e2e-upgrade.test.mjs` | `orchestration/orchestrator-loop-tick.md`（`productSource()` L111） | `6cba27d4` |
| `packages/quay/test/install-config-driven-e2e-upgrade.test.mjs` | `docs/analysis/fast-mode-loop-tick.md`（`productSource()` L114） | `6cba27d4` |

**引入者**：`6cba27d4`（2026-08-12 12:41:51, "tasks: split three phase floor files — serial 107→48s / lowconc 88→43.5s / main 72→38.8s (gap-split-three-phase-floor-files)"）。`git merge-base --is-ancestor e63439d6 6cba27d4` → YES：split 提交在 round-18 全绿（e63439d6）之后，故引入后红。split 将已排除的 `packages/quay/test/install-config-driven-e2e.test.mjs`（REQUIRED_PRODUCT_FILES 列 target-layout tick-doc 路径）切成 runtime + upgrade 两个新文件，旧路径引用随之复制（文件头注明 "Test BODIES are byte-identical to the pre-split file"）。

**修复**：`plugin/scripts/loop-shipping-exclusion-data.mjs` 加两条 file-level 排除项（在 pre-split `install-config-driven-e2e.test.mjs` 条目之后）：
- `packages/quay/test/install-config-driven-e2e-runtime.test.mjs`
- `packages/quay/test/install-config-driven-e2e-upgrade.test.mjs`

两者均为 **target-layout 合法引用**（与已排除的 pre-split 文件同类）：`productSource()` 把消费端落地路径（orchestration/ + docs/analysis/）映射回 plugin/loop/ 源；`REQUIRED_PRODUCT_FILES` 断言 quay-init --loop 在消费项目里落下的 tick-doc 布局。**不是**指向已移动机制的陈旧引用 ⇒ 走「加排除条目」分支而非「更新调用方」。两条新条目均非惰性（各 2 hits），necessity-check 无需 retainedNote。

**验证**：
- `node --test plugin/test/loop-shipping.test.mjs plugin/test/loop-shipping-necessity-check.test.mjs` → 18 pass / 0 fail（AC1b + necessity-check 全绿，`inert_exclusions: 0`）。
- `bash scripts/test.sh --for-task gap-loop-shipping-ac1b-still-red-live-old-path-ref --allow-thin` → exit 0，23 pass / 0 fail / 0 cancelled（含 install-config-driven e2e 全家 + loop-shipping 全家 + task-contract-check no violations；scoped 静态检查层全过）。

## Touches

- plugin/test/loop-shipping.test.mjs（AC1b 扫描 hits 定位——只读定位，未改）
- plugin/scripts/loop-shipping-exclusion-data.mjs（排除合法引用：已加 install-config-driven-e2e-runtime / install-config-driven-e2e-upgrade 两条 target-layout 排除）
- packages/quay/test/install-config-driven-e2e-runtime.test.mjs（定位的 hits 文件，target-layout 引用，未改——排除不更新）
- packages/quay/test/install-config-driven-e2e-upgrade.test.mjs（定位的 hits 文件，target-layout 引用，未改——排除不更新）
- tasks/gap-loop-shipping-ac1b-still-red-live-old-path-ref.md（自身：勾 AC + 贴证据）
