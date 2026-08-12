---
id: gap-manager-layer-no-verified-install-vector
title: manager 层无已验证安装向量 — 真实第三方机器不可冷启动（交付缺口）
status: done
labels:
  - gap
  - defect
  - delivery-critical
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

> **翻 done（outer 2026-08-12, r314-green 覆盖）**：代码合入 develop 686b5540（r314 green, 3361 pass/0 fail），AC 勾选 + measure 复核通过。

## Proposal

**交付面缺陷（manager 2026-08-12 01:11 011128，人直接指派查，逐条实测）**：三层里的第三层（manager）在真实第三方机器上目前不可冷启动。

**包里有，而且是完整的一条冷启动路径**：
- `plugin/skills/manager/SKILL.md` 出厂（自述「the installable crystallization of the manager layer. It ships under `plugin/` so any quay install can bring up a manager」）
- `plugin/scripts/manager-start.sh` 出厂（`quay manager start` 独立拉起：自己的 tmux session `quay-manager`、自己的家 `$QUAY_GLOBAL_DIR/manager/`、启动时自动武装 loop 锚点）
- `plugin/scripts/manager-adopt.sh` 出厂（manager 反过来拉起某项目的 outer+inner）
- `plugin/scripts/manager-arm-loop.sh` 出厂
- `plugin/loop/manager-tick-core.md` + `manager-loop-tick.md` 出厂
- `packages/quay/package.json` `files` 含 `plugin` ⇒ npm 产物确实带上以上全部

**铺不下去（唯一真实第三方安装实测：ad-arm1/archguard，无 quay 开发树）**：
- `plugin/skills/manager/SKILL.md` 不存在、`plugin/scripts/manager-start.sh` 不存在、`plugin/loop/manager-loop-tick.md` 不存在、`orchestration/manager-loop-tick.md` 不存在
- 全机 find 搜 `manager-start.sh` 与 `skills/manager/SKILL.md` = 零结果
- `plugin/loop/` 整个目录没落地（六份 tick-core 正本都在那；outer/inner 那两份被映射进 `orchestration/` 才有的，manager 那两份没有映射目标于是消失）
- 落地的 `plugin/skills/` 里是 archguard 自己的技能，quay 出厂的 13 个一个都没落地
- 唯一落地的 `manager-arm-loop.sh` 恰恰是单独无法工作的件：cron prompt 指向 `orchestration/manager-loop-tick.md`、校验读 `plugin/loop/manager-loop-tick.md`，两个路径在该机都不存在 ⇒ VALIDATE-FAIL

**根因**：唯一被真实使用过的交付向量是 `quay-init` 铺进项目，而它按设计排除 manager（cross-project 不进项目拓扑）；设计中承接 manager 的那条向量（「any quay install can bring up a manager」）要求机器上存在一个 quay install，ad-arm1 上并不存在，也从未被走通过一次。

**交叉标注（gap-manager-tick-readings-stale-readings，#54，2026-08-12）**：两任务合并为「manager 跨项目/跨主机可观测性」。本任务管**安装向量**（manager 件能铺到裸机）；#54 管**读数**（manager 机件铺过去后，对「本机之外的项目」要看得见——ticklog 多格式解析 + liveness 跨主机，含 archguard 的 `archguard-0` 会话名与 ad-arm1 主机从配置取，走 supervisor-deliver `<host>:<target>` 形态）。

**对 AC16② 的影响（manager 说准确不夸大）**：AC16② 判据原文「quay-init --loop 能铺设出 tick 文档 + skills + scripts 并真正驱动起来」——它确实做到了（两层循环真跑了 8 小时），故 ② 维持达成。manager 的交付缺口不在 ② 字面判据内，属于一条未被任何 AC 覆盖的面。

**修法方向（outer 裁定）**：①给 manager 一条可验证的安装向量（`npm i -g` 后 `quay manager start` 能在裸机跑通），并把它做成一条判据；②在此之前，不要铺 `manager-arm-loop.sh`——铺一个指向不存在文件的武装器，比不铺更坏。

**验证锚**：修后 (a) 裸机（无 quay 开发树）`npm i -g` 后 `quay manager start` 跑通；(b) manager 各件（SKILL.md/start/adopt/arm-loop/loop tick docs）在安装产物中在位；(c) `--for-task` scoped 门绿；(d) 不回归。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 ad-arm1/archguard 实测（plugin/loop 未落地、13 skills 未落地、manager-arm-loop 指向虚空）（本任务 Proposal 已含）
- [x] AC2: **安装向量**——`npm i -g` 后 `quay manager start` 在裸机跑通（manager 层可冷启动）
- [x] AC3: **判据化**——manager 安装向量做成一条机械判据（裸机装后能读到 manager 各件）
- [x] AC4: **不铺虚空武装器**——`manager-arm-loop.sh` 在向量未验证前不铺（或铺时指向存在的文件）
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：裸机 `quay manager start` 跑通证据贴出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/quay-init.sh（manager 安装向量 / 映射逻辑——本任务不动它，列为触面以跑 quay-init 既有不回归）
- plugin/skills/manager/SKILL.md（manager 冷启动路径——裸机向量文档化）
- plugin/scripts/manager-start.sh / manager-adopt.sh / manager-arm-loop.sh（裸机跑通）
- plugin/scripts/quay-launch.sh（launch settings 出厂回退——裸机冷启动的 settings 定位，dev-tree 优先包根份）
- plugin/scripts/capability-catalog.sh（manager-start/adopt 声明为 consumer-facing——`quay manager start` 是用户命令）
- plugin/skills/init/SKILL.md（reference-doc 声明 plugin/loop/manager-loop-tick.md——referenced⊆landed 不变量）
- orchestration/SPEC-complete-delivery-surface-2026-08-05.md（L1-MANIFEST 同步——manager 件入清单）
- packages/quay/package.json（files 含 plugin 覆盖 manager 件）
- plugin/scripts/verify-delivery-surface.ts（L1 交付面——manager 件入清单；DELIVERY-INVENTORY 快照不回归）
- plugin/test/（安装向量测试）
- tasks/gap-manager-layer-no-verified-install-vector.md（自身：勾 AC + 贴证据）

## Test-Files

- plugin/test/manager-install-vector.test.mjs（新：AC2/AC3/AC4 裸机安装向量机械判据）
- plugin/test/manager-productization.test.mjs（manager-start / manager-arm-loop 既有语义）
- plugin/test/manager-layer-shipping.test.mjs（manager 层随包交付）
- plugin/test/manager-layer-skill.test.mjs（manager 层安装性）
- plugin/test/verify-delivery-surface.test.mjs（L1 交付面 / DELIVERY-INVENTORY 快照）
- plugin/test/delivery-inventory-drift-gate.test.mjs（plugin/scripts 变更不触发 outline drift 误报）
- plugin/test/plugin-packaging.test.mjs（plugin 交付面 / 版本一致性）
- plugin/test/quay-init.test.mjs（quay-init 层叠不动——既有不回归）
- plugin/test/capability-catalog.test.mjs（capability-catalog.sh 声明 manager-start/adopt 为 consumer-facing）
- plugin/test/quay-init-laydown-closure.test.mjs（init/SKILL.md reference-doc 声明——referenced⊆landed 不变量）

## Contract

measure   manager_bare_metal_ok = `npm i -g <quay.tgz> && quay manager start` 在裸机（无 quay 开发树）的退出码
band      manager_bare_metal_ok = 0（裸机 manager 可冷启动）
invariant manager_artifacts_landed = 1（安装产物含 manager SKILL/start/adopt/arm-loop/loop tick docs）
invariant no_void_armor = 1（manager-arm-loop 铺向存在的文件）
invoke    `bash plugin/scripts/develop-deliver-tgz.sh --force` 后在裸机跑 `quay manager start`（贴退出码）
control   manager 安装向量可达；各件在位；不铺虚空武装器；既有不回归
resume    安装向量 / 判据化 / 不铺虚空分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-12
changed: manager 011128 逐条实测（人指派查）。manager 层无安装向量，第三方机不可冷启动。outer 裁定修法方向。实现归 inner。与 #54（manager-tick-readings）合并为「manager 跨项目/跨主机可观测性」。

## Evidence

**验证方式**：无真实第三方裸机可用，按任务许可用 `npm pack` 本地产物模拟裸机安装——staged pack-shaped root
（plugin/ + bin/ + src/ + package.json，无 orchestration/ / 包根 .claude/ / packages/），等价 npm 产物布局
（package.sh 逐字节 stage 同一 plugin/）。`node_modules` 用符号链接模拟 `npm i -g` 的依赖（CLI 派发测试用）。

**两个裸机破坏点（修复前实测）**：
- (a) `quay-launch.sh manager` 在无包根 `.claude/launch.settings.json` 时报
  `ERROR: launch settings file not found`（npm 产物把 settings 放 `plugin/.claude/`）。→ 修复：回退到
  `plugin/.claude/launch.settings.json`（dev-tree 仍优先包根份）。修复后裸机 pack 内 `quay-launch.sh manager --dry-run`
  → `claude --settings <pack>/plugin/.claude/launch.settings.json … -n quay-manager`，退出 0。
- (b) `manager-arm-loop.sh` 的 POINTER_PROMPT 指向 `orchestration/manager-loop-tick.md`（裸机 pack 无此文件，
  ad-arm1 VALIDATE-FAIL）。→ 修复：指针目标自适应——`orchestration/` 存在用它（dev-tree/`--loop --manager`），
  否则用出厂模板 `plugin/loop/manager-loop-tick.md`。修复后裸机 pack 内 arm 写入的指针
  `<repo>/plugin/loop/manager-loop-tick.md` 在 pack 内存在（AC4 no_void_armor）。

**AC2/AC3/AC4 机械判据**：`plugin/test/manager-install-vector.test.mjs`（新）——5 个用例：
1. `manager_artifacts_landed`：裸机 pack 携带全部 6 件（SKILL/start/adopt/arm-loop/loop tick docs），且无 dev-tree 目录。
2. `manager_bare_metal_ok`：从 pack root 跑 `quay manager start --dry-run` 退出 0，计划 home+session+arm。
3. 裸机 pack 内 `quay-launch.sh manager --dry-run` 退出 0 且解析 `plugin/.claude/launch.settings.json`（(a) 破坏点修复）。
4. `no_void_armor`：`--validate` VALIDATE-OK + 真实 arm 写入的指针在 pack 内解析到文件（(b) 破坏点修复）。
5. 真实 `manager-start.sh`（hermetic tmux + 无害 launch 覆盖）从 pack root 退出 0，建 identity + 武装 loop，指针在 pack 内。

**修复后实跑退出码**（模拟裸机，staged pack）：
```
quay manager start --dry-run  → 0
quay-launch.sh manager --dry-run → 0（plugin/.claude settings）
manager-arm-loop.sh --validate → VALIDATE-OK（0）
manager-arm-loop.sh（真实 arm）→ 0（store 恰好 1 条，指针解析到 pack 内文件）
manager-start.sh（真实，hermetic tmux）→ 0
```

**manager 件入清单**：`verify-delivery-surface.ts` L1 MANIFEST loop-docs 类目 deliverables 增
`plugin/loop/manager-loop-tick.md` + `plugin/skills/manager/SKILL.md`，SPEC 文档 L1-MANIFEST 同步
（`spec_is_live=1`，6/6 保持）。DELIVERY-INVENTORY（目录计数）因 manager 不是顶层目录未加嵌套条目
（嵌套 `plugin/skills/manager` 会破坏目录互斥——skills 计数含子目录）；manager 文件已计入 scripts/skills/loop
计数内，`inventory_drift=0`。

**既有不回归（scoped 门）**：
```
scripts/test.sh --for-task gap-manager-layer-no-verified-install-vector --allow-thin
→ tests 131, pass 131, fail 0, cancelled 0, GATE EXIT 0
（10 个 scoped static checks 全过，含 task-contract / delivery-inventory-drift-gate / capability-catalog）
```

**commit 分步**：安装向量 / 判据化 / 不铺虚空 / 任务自身，见提交 hash。
