---
id: gap-ac65-direct-fix-vs-bypass-detector-conflict
title: AC65「outer 一条命令可验可直接修 plugin/scripts」与 bypass-detector「plugin/scripts 直提交 develop 即 bypass」结构性冲突——无 carve-out，首次具名样本 02b2b2fc，需人裁定谁让谁
status: todo
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（outer 2026-08-15 09:4xZ 立案——结构性冲突，非发生率问题，首次具名样本 02b2b2fc）**。

**冲突面**（两条规则各自正确，无 carve-out）：
```
AC65（orchestrator-tick-core.md:105）：「改动的正确性能被一条命令验证（跑 checker + mutation case，秒级）⇒ outer 可直接修
      （含 plugin/scripts、plugin/test 下的该改动）」。产物=验证输出贴进提交/投递。
bypass-detector（plugin/scripts/direct-to-develop-bypass-check.ts）：DESIGN_INTERNAL_RE（:78）排除集含
      plugin/skills/manager/** 但【不含 plugin/scripts/*】——plugin/scripts 是 code-surface ⇒ 任何直提交 develop
      被标 confirmedBypass（26 条既有存量 + 02b2b2fc）。
```

**首次具名样本（2026-08-15）**：outer 按 AC65 授权直修 A0 ticklog 截断缺陷（`gap` manager-tick-readings 02b2b2fc，
`full:true` 完整行），AC65 验证输出已贴（full 676>200 / 24 tests 绿 / 一条命令可验）。**bypass-detector 标它
confirmedBypass=true** ⇒ round200 红 gate=direct-to-develop-bypass-check。parser fan-in（w7twbdxra）被此红阻断，
primed 待 land。

**两条规则的意图都该保留**：
- AC65：小改动（一条命令可验）不该为走全量 fan-in 而付出整轮验证代价——验证面允许快速直修。
- bypass-detector：代码面提交必须过审计链（fan-in 锁窗 / workflow），不许静默直投 develop。

**冲突本质**：AC65 授权的是【验证面】快速直修，detector 管的是【提交面】必须走审计——**两条管的是不同维度，但都落在「outer 直提交 plugin/scripts」这个动作上，无交叉豁免**。结构性：下次 AC65 直修还会撞，不是「等观察」。

**⚠️ 判定方向建议（供人裁定，outer 不定案）**：AC65 的「可直接修」应理解为【可编辑 + 一条命令验证】，但【落地仍走 fan-in 重投】——验证面 AC65 保留，提交面 detector 保留。若此方向成立：02b2b2fc 应 reset 后走 fan-in 重投；AC65 措辞改「验证可直接，提交走 fan-in」。**⛔ 扩排除集到 plugin/scripts/* 是最坏形态**（按文件名豁免 = 掩真直投，manager 已拒）。

**归属**：立案归 outer（AC65 是外层核）；实现归 inner（detector 加 AC65 授权 carve-out 或配合 AC65 措辞改——inner 选）；最终判定归人。

## Plan

1. 人裁定「AC65 与 bypass-detector 谁让谁」（验证面 vs 提交面）。
2. 按裁定改：AC65 措辞（outer 落盘）和/或 detector carve-out（inner 落盘）。
3. 02b2b2fc 按裁定处置（reset 后 fan-in 重投 / 或保留作合法 AC65 直修样本）。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 冲突消除：AC65 授权的直修与 bypass-detector 不再互撞（carve-out 或措辞改后，两者意图都保留）。
- [ ] AC2 能取假·真样本：02b2b2fc（或按裁定重置后重投的等价物）不再被误标；真直投（7e64a86b init/SKILL.md 类）仍红。
- [ ] AC3 归属明确：outer（AC65 措辞）/ inner（detector）/ 人（判定）分工落盘。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] AC65 与 bypass-detector 对齐（验证面可直修 + 提交面过审计），首次具名样本 02b2b2fc 处置完毕，parser fan-in 解除阻断。

## Touches

- orchestration/orchestrator-tick-core.md（AC65 措辞——outer 独占）
- plugin/scripts/direct-to-develop-bypass-check.ts（carve-out——inner 实现面）
- plugin/test/direct-to-develop-bypass-check.test.mjs（对应测试——inner 实现面）
- tasks/gap-ac65-direct-fix-vs-bypass-detector-conflict.md（自身）

## Evidence

（待落地后填：02b2b2fc 处置结果 + AC65/detector 对齐后 round 绿）

## 止损

**需要 —— 当下动作 = 本任务立案**：AC65 与 bypass-detector 结构性冲突，首次具名样本 02b2b2fc 使 round200 红 + parser fan-in 阻断。不立案则冲突从记录消失、下次 AC65 直修复撞。manager 裁定「不 reset/不扩/不重投，让红作样本」= 冲突保持可见，立案即止损线。
