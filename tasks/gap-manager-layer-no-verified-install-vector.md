---
id: gap-manager-layer-no-verified-install-vector
title: manager 层无已验证安装向量 — 真实第三方机器不可冷启动（交付缺口）
status: ready
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

**对 AC16② 的影响（manager 说准确不夸大）**：AC16② 判据原文「quay-init --loop 能铺设出 tick 文档 + skills + scripts 并真正驱动起来」——它确实做到了（两层循环真跑了 8 小时），故 ② 维持达成。manager 的交付缺口不在 ② 字面判据内，属于一条未被任何 AC 覆盖的面。

**修法方向（outer 裁定）**：①给 manager 一条可验证的安装向量（`npm i -g` 后 `quay manager start` 能在裸机跑通），并把它做成一条判据；②在此之前，不要铺 `manager-arm-loop.sh`——铺一个指向不存在文件的武装器，比不铺更坏。

**验证锚**：修后 (a) 裸机（无 quay 开发树）`npm i -g` 后 `quay manager start` 跑通；(b) manager 各件（SKILL.md/start/adopt/arm-loop/loop tick docs）在安装产物中在位；(c) `--for-task` scoped 门绿；(d) 不回归。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 ad-arm1/archguard 实测（plugin/loop 未落地、13 skills 未落地、manager-arm-loop 指向虚空）（本任务 Proposal 已含）
- [ ] AC2: **安装向量**——`npm i -g` 后 `quay manager start` 在裸机跑通（manager 层可冷启动）
- [ ] AC3: **判据化**——manager 安装向量做成一条机械判据（裸机装后能读到 manager 各件）
- [ ] AC4: **不铺虚空武装器**——`manager-arm-loop.sh` 在向量未验证前不铺（或铺时指向存在的文件）
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：裸机 `quay manager start` 跑通证据贴出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/quay-init.sh（manager 安装向量 / 映射逻辑）
- plugin/skills/manager/SKILL.md（manager 冷启动路径）
- plugin/scripts/manager-start.sh / manager-adopt.sh / manager-arm-loop.sh（裸机跑通）
- packages/quay/package.json（files 含 plugin 覆盖 manager 件）
- plugin/scripts/verify-delivery-surface.ts（DELIVERY-INVENTORY 快照——manager 件入清单）
- plugin/test/（安装向量测试）
- tasks/gap-manager-layer-no-verified-install-vector.md（自身：勾 AC + 贴证据）

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
