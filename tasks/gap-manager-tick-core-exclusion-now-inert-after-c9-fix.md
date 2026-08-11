---
id: gap-manager-tick-core-exclusion-now-inert-after-c9-fix
title: "manager-tick-core.md 排除条目在 80d609fd 修掉 C9 旧路径后变 inert——necessity-check 红（actual: [manager-tick-core.md]）；该条目无 retainedNote，修法=移除（引用已修到新路径，不再需要排除）"
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`loop-shipping-exclusion-data.mjs` 里 `orchestration/manager-tick-core.md` 的排除条目在 manager `80d609fd`（C9 引用旧路径→新正本）落地后变成 inert——necessity-check 红（`actual: ['orchestration/manager-tick-core.md']`）。该条目没有 `retainedNote`（不像 tick-log / manager-pending / batch2-queue-state 那些运行期账本条目有振荡理由），它的唯一非-inert 理由是 C9 引用旧路径；现在引用已修，条目失去存在理由。**

### 实证（outer 2026-08-10 22:2x，r260 merge 后核）

- **merge 后必要性检查 FAIL**：`node --test plugin/test/loop-shipping-necessity-check.test.mjs` → `actual: ['orchestration/manager-tick-core.md']`，`expected: []`。
- **条目无 retainedNote**：`manager-tick-core.md` 条目 reason 是「cites deployed-path provenance (orchestration/orchestrator-loop-tick.md:302)」——它靠 C9 的旧路径引用维持非-inert。同表的 tick-log / manager-pending / batch2-queue-state / manager-tick-log 条目都带 `retainedNote`（运行期账本振荡理由），本条目没有。
- **80d609fd 已把 C9 修到新正本**：integration 上 `manager-tick-core.md:74` 现引用 `plugin/loop/orchestrator-loop-tick.md:492`（新路径），旧路径命中 0。develop 还停在 `7b2a86c9`（旧 C9），但下轮验 integration 时必然命中本红。
- **r259 红因澄清（对 manager 21:3x）**：`27cae7d9`（排除表加 manager-tick-core）是 r259 树（296c1275）的祖先 ⇒ manager-tick-core 当时已在排除表，AC1b 不扫它。r259 真红因是 tick-core-static-check 机制文件（Fix agent 已正确补排除，r260 绿证此判断）。80d609fd 是真清理，但它的副作用就是让本条目变 inert。

### 选定机制方向（实现归 inner，判定归 outer）

**移除 `orchestration/manager-tick-core.md` 的排除条目**——引用已修到新路径，该文件不再引用任何旧路径，不需要排除。若认为仍应保留（比如未来还会引用部署旧路径），则必须补 `retainedNote` 说明振荡理由（与 tick-log 等条目同形态）。

**验证锚**：修后 (a) necessity-check 绿（actual 不含 manager-tick-core.md）；(b) 其余排除条目不误伤；(c) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 merge 后 necessity-check 红（actual: [manager-tick-core.md]）+ 条目无 retainedNote + 80d609fd 已修 C9（本任务 Proposal 已含）
- [x] AC2: **排除条目处置**——移除 manager-tick-core.md 条目（或补 retainedNote 说明保留理由），necessity-check 绿
- [x] AC3: **既有不回归**——`--for-task` scoped 门绿；其余排除条目不误伤
- [x] AC4: **全量静态检查绿**——`scripts/test.sh` 静态检查阶段无 necessity-check FAIL

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：necessity-check 绿（贴 actual 前后对比）；确认 integration 上 manager-tick-core.md 无旧路径命中
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/loop-shipping-exclusion-data.mjs（移除 manager-tick-core.md 排除条目，或补 retainedNote）
- plugin/test/loop-shipping-necessity-check.test.mjs（如处置方向需回归用例）
- tasks/gap-manager-tick-core-exclusion-now-inert-after-c9-fix.md（自身：勾 AC + 贴证据）

## Contract

measure   inert_exclusions = `node --test plugin/test/loop-shipping-necessity-check.test.mjs 2>&1 | grep -oE "actual: \[[^]]*\]"` 的 stdout
band      inert_exclusions = actual 不含 manager-tick-core.md（necessity-check 绿）
invariant manager_tick_core_not_inert = 1（该文件不再被 necessity-check 列为 inert）
invariant other_exclusions_untouched = 1（其余排除条目不误伤）
invoke    `node --test plugin/test/loop-shipping-necessity-check.test.mjs`（贴 actual 前后对比）
control   条目移除或带 retainedNote；necessity-check 绿；其余不误伤
resume    条目处置 / scoped 门 / 全量验证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: r260 green + batch-merge 后核出——manager 80d609fd 修掉 C9 旧路径引用，使 27cae7d9 加的 manager-tick-core 排除条目变 inert（无 retainedNote，necessity-check 红）。同时澄清 r259 红因：manager-tick-core 当时已在排除表（27cae7d9 是 r259 树祖先），真红因是 tick-core 机制文件（已修）。修法=移除条目或补 retainedNote。实现归 inner，判定归 outer

## Execution evidence (inner, 2026-08-11)

**实现**：`plugin/scripts/loop-shipping-exclusion-data.mjs` 中 `orchestration/manager-tick-core.md` 排除条目已移除（0 处残留），necessity-check 绿。

**必要性检查（修后实跑）**：
```
node --test plugin/test/loop-shipping-necessity-check.test.mjs
inert_exclusions: 0
scanned file-level exclusion entries: 31
inert-but-retained entries: 5
  inert docs/analysis/batch2-queue-state.md (hits=0) retainedNote=YES
  inert orchestration/tick-log.md (hits=0) retainedNote=YES
  inert orchestration/manager-pending.md (hits=0) retainedNote=YES
  inert orchestration/manager-tick-log.md (hits=0) retainedNote=YES
  inert packages/quay/plugin (hits=0) retainedNote=YES
✔ AC1/AC2 — no inert FILE-level exclusion entry without a written retention reason (inert_exclusions = 0)
✔ AC3 — negative control: injecting a live old-path reference flips an inert target to non-inert
✔ AC4 — the detector REPORTS an inert entry (fails closed), it does not silently pass
ℹ tests 3 · pass 3 · fail 0 · cancelled 0
```

**actual 前后对比**：红时 `actual: ['orchestration/manager-tick-core.md']` → 修后 `inert_exclusions: 0`，actual 不含 manager-tick-core.md（necessity-check 绿）。manager-tick-core.md 的 C9 引用已在新正本 `plugin/loop/orchestrator-loop-tick.md:492`（`orchestration/manager-tick-core.md:74`），旧路径命中 0。

**`--for-task` scoped 门（EXIT=0）**：
```
bash scripts/test.sh --for-task gap-manager-tick-core-exclusion-now-inert-after-c9-fix --allow-thin
# scoped static checks（change-relevant tier）全部 PASS：
#   test-isolation-check PASS / test-impl-census clean 326 / task-contract-check no violations
#   superseded-capability PASS / tick-core-static-check PASS (manager-tick-core.md=39/39)
#   delivery-inventory-drift-gate PASS
# 必要性检查（scoped 内）：inert_exclusions: 0 · tests 3 · pass 3 · fail 0 · cancelled 0
# EXIT=0
```

**其余排除条目不误伤（AC3）**：necessity-check 修后扫描 file-level 条目 31 条，inert-but-retained 5 条（全部带 retainedNote，运行期账本/快照振荡类），无新增 violation。`plugin/test/loop-shipping.test.mjs`（AC1b 全量扫描）pass 12 · fail 0，确认无其它排除目标被误伤。
