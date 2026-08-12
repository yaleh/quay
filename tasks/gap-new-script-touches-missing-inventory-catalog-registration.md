---
id: gap-new-script-touches-missing-inventory-catalog-registration
title: 新脚本任务 Touches 默认不含 DELIVERY-INVENTORY/capability-catalog 同步文件 ⇒ 三次越界（2 次事后补授权 + 1 次停手），检测机制已有但 Touches 授权缺口未堵
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

**实证（inner 2026-08-12，三次越界同根因）**：

| # | 任务 | 越界文件 | 越界原因 | 处置 |
|---|---|---|---|---|
| 1 | `gap-manager-cold-start-no-falsifiable-checklist` | `orchestration/manager-loop-tick.md` + `plugin/skills/manager/SKILL.md` | AC3 live 位置 + Contract measure 落点不在 Touches | 事后补 Touches 合规化 |
| 2 | `gap-task-telemetry-6-percent-join` | `plugin/scripts/capability-catalog.sh` + `docs/proposals/quay-product-outline.md` | 新检查器 `fan-in-runid-check.ts` 落地需 catalog 声明（unclassified==0）+ inventory 计数（209→210） | 事后补 Touches 合规化 |
| 3 | `gap-ac39-accounting-emit-layer` | `docs/proposals/quay-product-outline.md` | 新脚本 `accounting-emit-layer-map.ts` 落地需 inventory 计数（210→211） | **agent 停下未改、AC5 未勾**（遵守指令），inner 补 Touches + 重生成 |

**根因**：任务 Touches 是派发授权清单，但**新 `plugin/scripts/*` 脚本落地有「机械必需同步产物」**（`capability-catalog.sh` 声明行 + `quay-product-outline.md` §6 DELIVERY-INVENTORY 快照），这些文件默认不在任务 Touches 里。检测机制已有（`gap-inventory-drift-inner-exec-mode-report-missing-snapshot-regen` 的 `DELIVERY_INVENTORY_CHECKER` + `CAPABILITY_CATALOG_CHECKER` scoped 层漂移即报，done）——但检测只在「漂移发生后」报警，**没解决「Touches 授权缺这些文件 ⇒ agent 要么越界要么停手」的派发前缺口**。

**选定机制**：`select-static-checks-for-touches.ts`（或新检查器）在**派发资格判定**时检查：任务的 Touches 若含 `plugin/scripts/<name>.(new)` 或 `plugin/scripts/<name>.ts(新)` 标注的新脚本，则该任务 Touches **必须同时含** `plugin/scripts/capability-catalog.sh` 与 `docs/proposals/quay-product-outline.md`（或其等效注册文件），否则标 `touches-missing-registration`（不派发，需先补 Touches）——把「新脚本任务的注册产物」从事后补授权变成**派发前置条件**。

**验证锚**：(a) 新脚本任务缺注册文件 ⇒ 不派发；(b) 补注册文件 ⇒ 可派发；(c) 既有非新脚本任务零影响；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 3 次越界实证（表见上；第 3 例 agent 正确停手）
- [ ] AC2: **派发前置检查**——`select-static-checks-for-touches.ts`（或新检查器）对含新 `plugin/scripts/*` 标注的任务检查注册文件在场；缺 ⇒ `touches-missing-registration` 不派发
- [ ] AC3: **注册文件清单**——新脚本任务 Touches 需含 `plugin/scripts/capability-catalog.sh` + `docs/proposals/quay-product-outline.md`（DELIVERY-INVENTORY 快照）
- [ ] AC4: **负控制**——存量非新脚本任务零影响（不误报）；快照正确时不报
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：新脚本任务缺注册文件 ⇒ 不派发（机械输出贴出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/select-static-checks-for-touches.ts（派发前置注册文件检查）
- plugin/scripts/verify-delivery-surface.ts（复用 `--inventory` 判定，若需）
- plugin/scripts/capability-catalog.sh（若需注册文件一致性判定）
- plugin/test/（新脚本任务注册前置用例）
- tasks/gap-new-script-touches-missing-inventory-catalog-registration.md（自身：勾 AC + 贴证据）
