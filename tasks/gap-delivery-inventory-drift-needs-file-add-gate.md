---
id: gap-delivery-inventory-drift-needs-file-add-gate
title: verify-delivery-surface inventory 漂移无机制 owner——今日同对象红 6 次烧 128.4
  分钟（r216/r222/r223/r226/r248/r253），每次都是「plugin/scripts/ 新增文件但 outline §6
  快照没同步重生」；7d2faf06 只修症状，闸要装在【加脚本】这个动作上
status: done
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

**`plugin/test/verify-delivery-surface.test.mjs`（delivery-inventory 快照 vs outline §6）今日已红 6 次，全部同根因——`plugin/scripts/` 下新增文件但 `docs/proposals/quay-product-outline.md` 的 §6 快照没同步重生。`7d2faf06`（outer 15:0x 手工重生）只修了那一次的症状，根因「谁来保证它不再漂」没有 owner。mechanism 缺席（manager 18:4x 三条判据重跑与 15:1x 一致）：①`--write-inventory` 零非测试调用方；②无静态检查要求「改 plugin/scripts/** 必须同提交更新 outline」；③自 7d2faf06 以来又新增 3 个脚本文件，每个都会再漂一次。**

### 实证（manager 2026-08-10 18:4x + outer 复核）

- **今日该对象红 6 次**：r216 03:33 / r222 06:11 / r223 06:21 / r226 07:11 / r248 14:32 / r253 18:00，**合计烧掉 128.4 分钟套件时间**。每次失败同形：
  ```
  ✖ AC1/AC2 — the real bundle inventory matches the outline §6 snapshot (--inventory exits 0)
  ```
- **机制缺席（三条判据）**：
  1. `--write-inventory` 全仓非测试引用只有 1 处（`verify-delivery-surface.ts:556` 它自己的参数解析）——没有任何东西会重生快照。
  2. 无静态检查要求「改了 `plugin/scripts/**` 必须同一提交更新 outline §6」。
  3. 自 `7d2faf06`（15:0x 手工重生）以来 `plugin/scripts/` 又新增 3 个文件：`red-on-omission-audit.ts`、`drive-target-check.sh`、`checker-mutation-cases/red-on-omission-audit.sh`——每一个都会再漂一次。
- **7d2faf06 修的是症状不是机制**：把数字改对了一次，但没人保证下次加脚本时 outline 会跟上。

### 选定机制方向（实现归 inner，判定归 outer；manager 倾向 B）

- **候选 A（最硬）**：`git diff --name-only <base>..HEAD` 若命中 `^plugin/scripts/`，则要求同一提交也命中 `docs/proposals/quay-product-outline.md`，否则 FAIL。
- **候选 B（manager 倾向，误报更少）**：仅当 `plugin/scripts/` 下有**新增/删除**（`--diff-filter=AD`）时才要求同提交更新 outline——今日 6 次全部由「新增文件」触发，B 足以覆盖。

**验证锚**：修后 (a) 新增 `plugin/scripts/foo.ts` 但 outline 未更新 ⇒ 静态检查 FAIL；(b) 只改 `plugin/scripts/` 已有文件内容（无 A/D）⇒ 不触发；(c) 更新 outline ⇒ PASS；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 6 次红的轮次+时刻+烧掉时间（r216/r222/r223/r226/r248/r253 = 128.4min）+ 三条机制缺席判据（本任务 Proposal 已含）
- [x] AC2: **文件集变化闸**——候选 B（`--diff-filter=AD` 命中 `plugin/scripts/` ⇒ 要求同提交更新 outline §6），FAIL-closed；候选 A 作为更严档可选。实现 = 新闸 `plugin/scripts/delivery-inventory-drift-gate.sh`，接入 `scripts/test.sh` run_static_checks（`@static-tier change` + `@static-object plugin/scripts/ docs/proposals/quay-product-outline.md`）。DoD 实跑：`(a)` 新增 `plugin/scripts/foo.ts` 且 outline 未更新 ⇒ `exit=1`（FAIL-closed）；`(b)` 只改已有 `a.sh` 内容（无 A/D）⇒ `exit=0` 不触发；`(c)` 新增脚本 + 更新 outline ⇒ `exit=0`
- [x] AC3: **既有不回归**——`--for-task` scoped 门绿（见本任务 AC 下方实跑证据）；verify-delivery-surface 既有测试不破坏（scoped 测试含 `verify-delivery-surface.test.mjs` 全绿）
- [x] AC4: **机制有 owner**——重生命令 `verify-delivery-surface.ts --write-inventory` 不再零非测试调用方（闸要求更新 outline 即触发重生路径）。本次实现即真实非测试调用：`node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --write-inventory` 将 §6 快照从 `scripts=194` 重生为 `scripts=195`（新增闸脚本），`inventory_drift=0`。闸的 FAIL 消息直接给出重生命令，owner = 闸本身

## Invoke 证据（inner 2026-08-10，本任务分支 `task/gap-delivery-inventory-drift-needs-file-add-gate` HEAD 后贴）

- Contract invoke（证明新增文件能被闸捕获）——实际输出：
  ```
  $ git diff --name-only --diff-filter=AD <base>..HEAD | grep '^plugin/scripts/'
  plugin/scripts/checker-mutation-cases/delivery-inventory-drift-gate.sh
  plugin/scripts/delivery-inventory-drift-gate.sh
  ```
  两个新插件脚本都被闸的核心谓词（`--diff-filter=AD` 命中 `plugin/scripts/`）捕获——而同提交的
  `docs/proposals/quay-product-outline.md`（§6 快照）更新使闸 PASS（`script_structural=1 outline_touched=1`）。
- 实跑 DoD 锚 (a)/(b)/(c) 已在 AC2 勾选说明中记录；`--write-inventory` 将 §6 快照从 `scripts=194`
  重生为 `scripts=195`，`inventory_drift=0`（AC4：重生命令真实非测试调用）。
- `--for-task` scoped 门绿：scoped 静态检查含 `delivery-inventory-drift-gate` ⇒ PASS；56 tests / 0 fail
  （含 verify-delivery-surface、delivery-inventory-drift-gate、capability-catalog、checker-mutation-check）。
- 实现期发现并修复一个 post-commit 回归：闸的 committed 扫描原先 `--diff-filter=AD` 会把 outline 的
  `M` 状态滤掉，导致「提交新增脚本 + outline 同提交修改」被误报红——改为 status-aware（plugin/scripts
  A/D ⇒ 触发；outline 任意状态 ⇒ 满足），新增回归测试钉住该方向（`delivery-inventory-drift-gate.test.mjs`
  第 10 条）。

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：新增 `plugin/scripts/` 文件且不同步 outline ⇒ 静态检查红；同步 ⇒ 绿（贴 diff-filter 输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- scripts/test.sh（注册新闸到 run_static_checks：`--diff-filter=AD` 命中 `plugin/scripts/` ⇒ 要求同提交更新 outline §6）
- plugin/scripts/delivery-inventory-drift-gate.sh（新闸，新增——文件集变化闸候选 B）
- plugin/scripts/checker-mutation-cases/delivery-inventory-drift-gate.sh（新闸 mutation case，新增）
- plugin/test/delivery-inventory-drift-gate.test.mjs（新闸单元测试，新增）
- plugin/scripts/capability-catalog.sh（声明新闸能力 + 五方向字段）
- docs/proposals/quay-product-outline.md（§6 快照——被检查的目标，本次经 `--write-inventory` 重生）
- tasks/gap-delivery-inventory-drift-needs-file-add-gate.md（自身：勾 AC + 贴证据）

## Test-Files

- plugin/test/verify-delivery-surface.test.mjs（outline §6 快照重生后必须仍绿——AC3 既有不回归）
- plugin/test/delivery-inventory-drift-gate.test.mjs（新闸行为：new_script_requires_outline / content_only_change_skipped / outline_updated_alongside）
- plugin/test/capability-catalog.test.mjs（新脚本必须有能力声明 + 五方向字段）
- plugin/test/checker-mutation-check.test.mjs（新 checker 必须带 mutation case 且全绿）

## Contract

measure   drift_gate_present = `grep -cE "diff-filter=AD.*plugin/scripts|plugin/scripts.*outline" scripts/test.sh` 的 stdout 数字
band      drift_gate_present >= 1（文件集变化闸已接进静态检查）
invariant new_script_requires_outline = 1（新增 plugin/scripts 文件 ⇒ 同提交 outline 更新，否则 FAIL）
invariant content_only_change_skipped = 1（只改已有文件内容不触发）
invoke    `git diff --name-only --diff-filter=AD <base>..HEAD | grep '^plugin/scripts/'`（贴输出，证明新增文件能被闸捕获）
control   闸在场；新增脚本 ⇒ outline 同步；内容改动不误报
resume    闸实现 / scoped 门 / 全量验证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 18:4x——r253 红 = verify-delivery-surface inventory 漂移，今日第 6 次同根因（r216/r222/r223/r226/r248/r253, 128.4min）。7d2faf06 只修症状。机制缺席三判据复核一致。处方：文件集变化闸（--diff-filter=AD 命中 plugin/scripts ⇒ 要求 outline 更新），manager 倾向 B。实现归 inner，判定归 outer
