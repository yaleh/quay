---
id: gap-inventory-drift-after-dir043-fanins
title: delivery-inventory 快照漂移——DIR-043 等 fan-in 加脚本/探针没重生成 outline
  §6（inventory_drift=2：scripts 180/179、probes 5/4），round-169 红、solo 也红，同
  ffe7dd21 族
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**round-169（06d49e31，2026-08-09 12:28-12:40）全量套件红，唯一失败 = `plugin/test/verify-delivery-surface.test.mjs` 的 `AC1/AC2 — the real bundle inventory matches the outline §6 snapshot`——`inventory_drift=2`：`scripts: disk=180 snapshot=179` + `probes: disk=5 snapshot=4`。根因：inner 的 DIR-043 等 fan-in 加了新脚本/探针，没重生成 delivery-inventory 快照（`docs/proposals/quay-product-outline.md` §6）。与 ffe7dd21 同族「加脚本没重生成清单」。**

### 实证（outer 2026-08-09 12:40 红窗分诊）

- **失败子测试**：`✖ AC1/AC2 — the real bundle inventory matches the outline §6 snapshot (--inventory exits 0)` + `AssertionError: inventory_drift=2, actual:1, expected:0`。
- **solo 也红**：`node --test plugin/test/verify-delivery-surface.test.mjs` → 13 tests, pass 12, fail 1——真实回归。
- **drift 明细**：`[DRIFT] scripts: disk=180 snapshot=179`；`[DRIFT] probes: disk=5 snapshot=4`。
- **根因**：inner fan-in 加了 `plugin/scripts/external-dogfooding-check.ts`、`plugin/probes/external-dogfooding.md`（DIR-043，59b3d2ef）等新文件，没跑 `--write-inventory` 重生成 outline 快照。
- **同类先例**：ffe7dd21（inner 加 accounting-emit.ts 后重生成 scripts 178→179）——同族「加脚本必须重生成 inventory」。d3df1e5d（halt-check.sh）同。
- **无修复先跑**：任何加脚本/探针的 fan-in 提交后，`verify-delivery-surface.ts --inventory` 必须 exit 0。

**为什么重要**：这是「改了源没同步清单」的 inventory 漂移回归（第 3 次）。batch-merge freshness gate 读 `state=red ⇒ 不 merge`——39 提交全卡住。修复极快（重生成快照），但必须修才绿。

**修的方向（实现归内层）**：
- 候选 A（正道）：跑 `node --no-warnings --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --write-inventory` 重生成 outline §6 快照（scripts 180、probes 5）；`--inventory` 恢复 exit 0。
- 候选 B：若快照机制本身有缺陷（新文件没进快照算法），修 verify-delivery-surface.ts——但先验证只是「没重生成」。

**验证锚**：修后，(a) `verify-delivery-surface.ts --inventory` exit 0（inventory_drift=0）；(b) verify-delivery-surface solo 13/13 绿；(c) 全量套件绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-169 实证（inventory_drift=2：scripts 180/179、probes 5/4 + DIR-043 加了 external-dogfooding-check.ts/probe + solo 也红）（本任务 Proposal 已含；内层补：`--inventory` 直接跑复现）
- [x] AC2: **快照重生成**——`--write-inventory` 重生成 outline §6（scripts 180、probes 5 等，与 disk 一致）
- [x] AC3: **--inventory 恢复 exit 0**——`inventory_drift=0`
- [x] AC4: **solo 绿**——verify-delivery-surface.test.mjs 13/13 绿
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 verify-delivery-surface / outline 契约检查）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：`--inventory` exit 0；solo 13/13（贴任务体）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（内层实现 2026-08-09）

**AC1 复现**：`node --no-warnings --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --inventory` → `inventory_drift=2`：`[DRIFT] scripts: disk=180 snapshot=179`、`[DRIFT] probes: disk=5 snapshot=4`——正是 DIR-043（59b3d2ef）fan-in 的 `plugin/scripts/external-dogfooding-check.ts` + `plugin/probes/external-dogfooding.md`。

**AC2 修**（候选 A）：`node --no-warnings --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --write-inventory --root "$(pwd)"` → `PASS: outline §6 DELIVERY-INVENTORY snapshot regenerated to match disk`。改动仅 `docs/proposals/quay-product-outline.md`（1 行）：scripts 179→180、probes 4→5。

**AC3 验证**：`--inventory` 重跑 → `inventory_drift=0`，全轴 `[OK]`（scripts 180/180、probes 5/5、gate-scripts 14/14、skills 13/13、loop 3/3、workflows 2/2、agents 1/1、vendor 2/2），exit 0。

**AC4 solo**：`bash scripts/test.sh plugin/test/verify-delivery-surface.test.mjs` → **13/13 pass / 0 fail / exit 0**。

**AC5 scoped 门**：`bash scripts/test.sh --for-task gap-inventory-drift-after-dir043-fanins --allow-thin` → **exit 0，13 pass / 0 fail / 0 cancelled，violations 0**（task-contract-check no violations）。

**DoD 全量绿**：留给外层 verification-round 验证。

## Touches

- docs/proposals/quay-product-outline.md（§6 快照重生成——`--write-inventory`）
- plugin/scripts/verify-delivery-surface.ts（`--write-inventory` 核实；不须改除非机制缺陷）
- tasks/gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak.md（交叉标注——同轮红窗链）
- tasks/gap-tmux-leak-scan-pattern-unnchored-self-match-phantom-red.md（交叉标注——同轮红窗链）
- tasks/gap-runner-grouping-ac7-nested-spawn-load-flake.md（交叉标注——同轮红窗链）
- tasks/gap-inventory-drift-after-dir043-fanins.md（自身：勾 AC + 贴证据）

## Contract

measure   inventory_drift_after_fix = `node --no-warnings --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --inventory` 的 stdout 数字
band      inventory_drift_after_fix = 0（inventory_drift=0 且 exit 0）
invariant inventory_snapshot_matches_disk = 1（scripts/probes 等与 disk 一致）
invariant verify_delivery_solo_green = 1（13/13 绿）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --inventory` + `node --no-warnings --experimental-strip-types --test plugin/test/verify-delivery-surface.test.mjs`（贴回）
control   --inventory exit 0；solo 13/13；全量绿
resume    重生成快照 + --inventory 验证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-169 红窗分诊：inventory_drift=2——DIR-043 等 fan-in 加脚本/探针没重生成 outline 快照，同 ffe7dd21 族。实现归内层）
