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
- [x] AC2: **派发前置检查**——`select-static-checks-for-touches.ts` 新增 `checkTouchesRegistration()`（+ `--check-registration` CLI 模式）对含新 `plugin/scripts/*` 标注（`(new)` tag / git-untracked / 全角 `（新：…）`）的任务检查注册文件在场；缺 ⇒ `touches-missing-registration`，scoped 静态选择退出非零（fail-closed，test.sh `run_scoped_static_checks_sel` 视非零为 fatal ⇒ 该任务无法通过自身 scoped 门，agent 拿到明确原因而非越界/停手）
  - 实证（构造新脚本任务缺注册文件）：`select-static-checks-for-touches.ts --task bad-new --check-registration` ⇒ exit 1，`registrationCheck.reason = "touches-missing-registration"`，`missing = ["plugin/scripts/capability-catalog.sh", "docs/proposals/quay-product-outline.md"]`；`--commands` 同 exit 1 + stderr 指明缺文件
  - 全角实证（真实越界实例的标注形态）：`plugin/scripts/fan-in-runid-check.ts（新：runId 存在性检查器）` ⇒ exit 1，`newScript = "plugin/scripts/fan-in-runid-check.ts"`
  - 范围注（诚实标注）：任务 Touches 只授权 `select-static-checks-for-touches.ts`；真正的 slot-refill 派发资格 defer（step-4 `touches-missing-registration`）需改 `plugin/scripts/slot-refill.ts`（不在本任务 Touches），未动——按指令把此作为越界边界报告，scoped fail-closed 是本任务内能机械达成的最大强制
- [x] AC3: **注册文件清单**——`NEW_SCRIPT_REGISTRATION_REQUIRED = ["plugin/scripts/capability-catalog.sh", "docs/proposals/quay-product-outline.md"]`；新脚本 + 两文件都在 Touches ⇒ `{ ok: true }`（补 Touches 即可派发）
  - 实证：`--task ok-reg --check-registration`（Touches 含两注册文件）⇒ exit 0，`registrationCheck.ok = true`，且 `--commands` 仍正常输出 scoped 命令
- [x] AC4: **负控制**——存量非新脚本任务零影响（无 `(new)`/全角新标注 ⇒ ok，无论注册文件是否在 Touches）；`(new)` 在 plugin/scripts 之外 ⇒ ok；只含一个注册文件 ⇒ 只报缺的那一个
  - 实证：`--task existing --check-registration`（tracked 既有脚本）⇒ exit 0；纯函数 `checkTouchesRegistration` 对 `["tasks/foo.md", "plugin/scripts/claim-task.sh"]` / 非 bundle 新文件 ⇒ `{ ok: true }`；`["new-check.ts", capability-catalog.sh]` ⇒ `missing = [quay-product-outline.md]`
- [x] AC5: **既有不回归**——`--for-task gap-new-script-touches-missing-inventory-catalog-registration` scoped 门绿
  - 实证：`bash scripts/test.sh --for-task gap-new-script-touches-missing-inventory-catalog-registration` ⇒ `ℹ tests 56, pass 56, fail 0, cancelled 0, EXIT=0`（含 select-static-checks-for-touches 16 + verify-delivery-surface 25 + capability-catalog 15 + scoped 静态检查 9 项全绿）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：新脚本任务缺注册文件 ⇒ 不派发（机械输出贴出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## 实证输出（inner 2026-08-12，scoped 实跑）

```
# 缺注册文件的新脚本任务 ⇒ touches-missing-registration（exit 1）
$ node --experimental-strip-types plugin/scripts/select-static-checks-for-touches.ts --root <wt> --task bad-new --check-registration
{ "registrationCheck": { "ok": false, "reason": "touches-missing-registration",
    "newScript": "plugin/scripts/bar-check.ts",
    "missing": ["plugin/scripts/capability-catalog.sh", "docs/proposals/quay-product-outline.md"] } }
# exit 1

# 全角真实标注形态（越界实例 2 的写法）
$ ... --task fw-reg --check-registration        # plugin/scripts/fan-in-runid-check.ts（新：runId 存在性检查器）
{ "registrationCheck": { "ok": false, "reason": "touches-missing-registration",
    "newScript": "plugin/scripts/fan-in-runid-check.ts", "missing": [ ...两注册文件... ] } }
# exit 1

# 补 Touches 注册文件 ⇒ ok（exit 0）
$ ... --task ok-reg --check-registration        # Touches 含 capability-catalog.sh + quay-product-outline.md
{ "registrationCheck": { "ok": true } }
# exit 0

# scoped 门绿（AC5）
$ bash scripts/test.sh --for-task gap-new-script-touches-missing-inventory-catalog-registration
ℹ tests 56   ℹ pass 56   ℹ fail 0   ℹ cancelled 0   # EXIT=0
```

## Touches

- plugin/scripts/select-static-checks-for-touches.ts（派发前置注册文件检查）
- plugin/scripts/verify-delivery-surface.ts（复用 `--inventory` 判定，若需）
- plugin/scripts/capability-catalog.sh（若需注册文件一致性判定）
- plugin/test/（新脚本任务注册前置用例）
- tasks/gap-new-script-touches-missing-inventory-catalog-registration.md（自身：勾 AC + 贴证据）
