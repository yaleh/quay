---
id: gap-inventory-drift-inner-exec-mode-report-missing-snapshot-regen
title: DELIVERY-INVENTORY 第 5 次漂移——fan-in 27f44be5（serial-main-thread 的
  inner-exec-mode-report.ts）加了 plugin/scripts 新文件却漏重生成 outline §6 快照（disk=182
  snapshot=181）；这是该模式的重复，证明「新脚本任务必须重生成快照」仍未机械接线
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

**`verify-delivery-surface` 的 DELIVERY-INVENTORY 快照第 5 次漂移：fan-in 27f44be5（gap-inner-serial-main-thread-not-dispatch，2026-08-09 17:25）新增 `plugin/scripts/inner-exec-mode-report.ts`（308 行）+ 测试，但合并里 0 个 outline 文件——`docs/proposals/quay-product-outline.md` 的 §6 快照仍是 `scripts=181`，磁盘实际 182 ⇒ `verify-delivery-surface.test.mjs` AC1 红，round-b69266c7 全量套件 red（early, kill-on-red）。**

### 实证（outer 2026-08-09 17:36 红窗分诊）

- suite b69266c7（17:24 起）17:36 early-red，唯一失败 = `verify-delivery-surface.test.mjs passed=false`（5656ms）。
- solo 复现：`node --test plugin/test/verify-delivery-surface.test.mjs` ⇒ `inventory_drift=1`，`[DRIFT] scripts: disk=182 snapshot=181`。
- 肇事 merge：`27f44be5`（`git show --stat` 含 `plugin/scripts/inner-exec-mode-report.ts +308`、`plugin/test/inner-exec-mode-report.test.mjs +258`，0 个 `product-outline` 文件）。
- **这是该模式第 5 次**（前 4 次各有专门「regenerate snapshot」commit）：halt-check（`d3df1e5d`，175→176）、spec-goal（`048ed93c`，176→178）、accounting-emit（`ffe7dd21`，178→179）、DIR-043（`d198adb9`，round-169 漂移）、本次（181→182 未做）。**逐次打地鼠不收敛——每次都是任务加新脚本后漏掉快照重生成。**
- 根因：**快照重生成没有机械接线**——`grep` fast-mode-loop-tick / fast-mode-tick-core / capability-catalog.sh / plugin/skills 均无 `--write-inventory` 或 `DELIVERY-INVENTORY` 引用；新脚本任务没有跨切 AC 强制「加新 plugin/scripts 文件 ⇒ 重生成 outline §6 快照」。capability-catalog 的声明闸（AC1c gate）管「catalog 声明」，但不覆盖「DELIVERY-INVENTORY 快照」——两个独立派生物，只有 catalog 有机检查。

**为什么重要**：每加一个 plugin/scripts 新文件，全量套件就红一次，红窗分诊 + 补 snapshot commit + 重启套件 ~17min 的循环成本线性累积。`verify-delivery-surface` 是 cross-cut 静态检查（全量必跑），scoped 门不含它——所以任务 scoped 绿、fan-in 后全量红，静默到外层验证轮才暴露（与 capability-catalog 同族「scoped 盲区」）。

### 选定机制方向（实现归内层，接法留执行时）

1. **本次修复**：跑 `verify-delivery-surface.ts --inventory --write-inventory` 重生成快照（181→182），贴 diff 为本次闭环。
2. **接线（根治）**：新脚本任务（Touches 含 `plugin/scripts/*(new)`）必须把「重生成 DELIVERY-INVENTORY 快照」纳入 scoped 静态层或跨切 AC——机制可选：
   - **scoped 静态层**：`select-static-checks-for-touches.ts` 对新脚本任务加 `verify-delivery-surface --inventory`（与 capability-catalog 的 scoped 加入同形，见 `gap-capability-catalog-declarations-not-enforced-at-script-creation`，已 done）；
   - **或 fan-in 闸**：integration fan-in 时跑 `--inventory` 漂移检查，漂移 ⇒ 拒绝 fan-in（fail-closed，留 inner 补快照）。
3. 不选「手动纪律」——前 5 次已证明散文纪律不收敛。

**验证锚**：修后 (a) 本次快照 181→182 重生成，`--inventory` drift=0；(b) 构造新脚本任务 ⇒ scoped 或 fan-in 阶段即报快照漂移（创建时暴露，非全量时）；(c) 既有 5 次漂移不复现。

## Acceptance Criteria

- [x] AC1: **本次闭环**——`verify-delivery-surface --inventory --write-inventory` 重生成快照，`--inventory` drift=0，`verify-delivery-surface.test.mjs` solo 绿（25/25）
  - 实证：fork 的 develop 已含后续重生（7d2faf06 等，snapshot=194 匹配 disk=194），本任务的字面 181→182 已被后续 merge 超越——`--write-inventory` 幂等（无 diff），drift=0。solo：`node --test plugin/test/verify-delivery-surface.test.mjs` ⇒ tests 25 pass 25 fail 0
- [x] AC2: **接线（根治）**——新脚本任务（Touches 含 `plugin/scripts/*(new)`）触发 `--inventory` 漂移检查（scoped 静态层），漂移即报，不再靠全量验证轮
  - 实现：`select-static-checks-for-touches.ts` 新增 `DELIVERY_INVENTORY_CHECKER`（`verify-delivery-surface.ts --inventory`），与 `CAPABILITY_CATALOG_CHECKER` 同信号（`(new)` tag 或 git-untracked 的 `plugin/scripts/*`）加入 scoped 集
  - 实证：构造新脚本任务（Touches 含 `plugin/scripts/foo-new-check.ts (new)`）⇒ selector `--names` 输出含 `delivery-inventory`；该检查实跑：snapshot=1 + 磁盘新加 1 脚本 ⇒ `[DRIFT] scripts: disk=2 snapshot=1` `inventory_drift=1` exit=1；`--write-inventory` 后 drift=0
- [x] AC3: **既有不回归**——capability-catalog 的 scoped 机制不动（同族已 done 的 `gap-capability-catalog-...` 保持）；`--for-task` scoped 门绿
  - `--for-task gap-inventory-drift-inner-exec-mode-report-missing-snapshot-regen` ⇒ tests 36 pass 36 fail 0 EXIT=0（含 verify-delivery-surface 25 + select-static-checks 11）
  - 附带吸收：`select-static-checks-for-touches.test.mjs` 6 个既有断言因 a37df1c5（superseded-capability-check 使 capability-catalog 成为真实 tier=always registry 条目）而 stale——按 `--json` 标记区分虚拟 AC1c 闸而非裸名，断言修复为绿（该文件不在本任务 Touches，但 AC3 的「scoped 门绿」要求它绿；不动机制，只修测试预期）
- [x] AC4: **负控制**——不重扫全 artifact（只查新脚本的 delta，存量 0 影响）；快照正确时不误报
  - fixture 测试：快照正确 ⇒ `--inventory` exit 0 drift=0 不误报；存量脚本任务（无新 plugin/scripts）⇒ selector 不选 `delivery-inventory`
- [x] AC5: **历史 5 次不复现**——halt-check/spec-goal/accounting-emit/DIR-043/inner-exec-mode 五例的快照在检查下均无漂移
  - 测试断言 4 个可定位历史脚本存在（halt-check.sh / accounting-emit.ts / external-dogfooding-check.ts / inner-exec-mode-report.ts；spec-goal 为 goal-store fan-in），且真实 bundle `--inventory` drift=0

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：`--inventory` drift=0（贴任务体）；构造新脚本任务 ⇒ scoped/fan-in 即报
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/verify-delivery-surface.ts（`--inventory`/`--write-inventory` 已有，未改）
- plugin/scripts/select-static-checks-for-touches.ts（AC2 scoped 层：新增 DELIVERY_INVENTORY_CHECKER 虚拟检查器）
- plugin/test/verify-delivery-surface.test.mjs（AC2/AC4/AC5 新增 5 测试：新脚本→漂移即报 fixture、负控制、selector 接线、历史 5 例）
- plugin/test/select-static-checks-for-touches.test.mjs（AC3 吸收既有 stale 断言修复——a37df1c5 使 capability-catalog 成真实 tier=always 条目后，6 断言按 `--json` 区分虚拟闸而非裸名；不属本任务原 Touches，但 scoped 门绿要求它绿，故吸收并在此登记）
- docs/proposals/quay-product-outline.md（AC1：snapshot 已=194 匹配 disk=194，`--write-inventory` 幂等无 diff）
- tasks/gap-inventory-drift-inner-exec-mode-report-missing-snapshot-regen.md（自身：勾 AC + 贴证据）

## Contract

measure   inventory_drift_after_fix = `node --no-warnings --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --inventory 2>&1 | grep -c 'DRIFT'` 的 stdout 数字
band      inventory_drift_after_fix = 0（本次重生成后无漂移）
invariant new_script_fan_in_caught = 1（构造新脚本任务 ⇒ scoped/fan-in 阶段即报，非全量轮）
invariant existing_snapshots_clean = 1（五例历史快照均无漂移）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --inventory --write-inventory`（本次闭环重生成贴回）
control   新脚本未重生成 ⇒ 检查即报；快照正确 ⇒ 不误报
resume    本次快照重生成（AC1）+ 接线（AC2）分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 红窗分诊（round-b69266c7 early-red，verify-delivery-surface 唯一失败）——bisect 定位肇事 merge 27f44be5（inner-exec-mode-report.ts 加了 plugin/scripts 新文件但 0 outline 文件）。第 5 次同模式漂移，前 4 次各有专门补快照 commit，散文纪律不收敛 ⇒ 需机械接线。工作本身合法不回退，只补快照 + 接线。实现归内层
