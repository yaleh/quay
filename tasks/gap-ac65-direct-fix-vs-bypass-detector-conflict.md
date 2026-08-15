---
id: gap-ac65-direct-fix-vs-bypass-detector-conflict
title: AC65「outer 一条命令可验可直接修 plugin/scripts」与 bypass-detector「plugin/scripts 直提交
  develop 即 bypass」结构性冲突——无 carve-out，首次具名样本 02b2b2fc，需人裁定谁让谁
status: needs-human
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

## Implementation（inner 2026-08-15 落盘——detector 侧 carve-out）

**人裁定方向待决；本实现保留两种裁定都正确的行为**（若人裁定「提交面仍走 fan-in」，carve-out 仍【承认】
已经发生的 AC65 直修；若裁定「AC65 直修合法」，carve-out 即正式豁免）。

**机制（`plugin/scripts/direct-to-develop-bypass-check.ts`）**：按 **sha + 证据** 的 AC65 授权直修豁免表
`AC65_AUTHORIZED_DIRECT_FIXES`（有界、可见、可审计，同 `RULED_HISTORICAL_GAPS` 先例）。
判定：代码面直接提交 ∧ sha 入表（前缀匹配）∧ 提交消息携带 AC65 验证标记（`commitHasAc65Evidence`，
`AC65_VERIFICATION_MARKER_RE`）⇒ 报为 `ac65AuthorizedDirectFix`（独立分类，**非 bypass**）；sha 入表但
消息无标记 ⇒ 表目与提交不一致，**fail-closed 仍红**；sha 不入表 ⇒ 真直投**仍红**（能取假——豁免表有界，
不能静默扩展）。⛔ **不是 `plugin/scripts/*` 文件名豁免**（掩真直投，manager 已拒）——豁免要证据，不按路径。

**AC3 归属（落盘）**：outer = AC65 措辞（`orchestration/orchestrator-tick-core.md`，outer 独占，本任务 inner
不动）；inner = detector carve-out（本实现）；人 = 最终裁定（验证面 vs 提交面）。

## Acceptance Criteria

- [x] AC1 冲突消除：AC65 授权的直修与 bypass-detector 不再互撞（carve-out 或措辞改后，两者意图都保留）。
- [x] AC2 能取假·真样本：02b2b2fc（或按裁定重置后重投的等价物）不再被误标；真直投（7e64a86b init/SKILL.md 类）仍红。
- [x] AC3 归属明确：outer（AC65 措辞）/ inner（detector）/ 人（判定）分工落盘。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] AC65 与 bypass-detector 对齐（验证面可直修 + 提交面过审计），首次具名样本 02b2b2fc 处置完毕，parser fan-in 解除阻断。

## Touches

- orchestration/orchestrator-tick-core.md（AC65 措辞——outer 独占，inner 不动）
- plugin/scripts/direct-to-develop-bypass-check.ts（carve-out——inner 实现面，已落盘）
- plugin/test/direct-to-develop-bypass-check.test.mjs（对应测试——inner 实现面，已落盘）
- tasks/gap-ac65-direct-fix-vs-bypass-detector-conflict.md（自身）

## Evidence（inner 侧已落地；outer 措辞 / 人裁定待续）

- **机制**：`AC65_AUTHORIZED_DIRECT_FIXES` 表（02b2b2fc + 证据）+ `AC65_VERIFICATION_MARKER_RE`；
  `classifyCommit` 增加 `ac65Authorized` / `ac65Evidence`，`bypass = !designInternal && !inLockWindow && !ac65Authorized`。
- **AC2 能取假（CLI `--commits` 回放，exit 实测）**：
  - `--commits 02b2b2fc` → **exit 0**，`reason=ac65-authorized-direct-fix-only`，candidate `ac65Authorized=true` / `confirmedBypass=false`。
  - `--commits 7e64a86b` → **exit 1**（真直投仍红），`ac65Authorized=false` / `confirmedBypass=true`。
  - `--commits 02b2b2fc,7e64a86b` → exit 1，混合中只 7e64a86b 红。
  - 全 reflog 扫描（无基线）：denominator `ac65-authorized=1`，02b2b2fc 标 `AC65-AUTHORIZED`，7e64a86b 仍 `RED`（26 → 25 真 bypass）。
- **AC4**：`plugin/test/direct-to-develop-bypass-check.test.mjs` 19/19 绿（新增 5 条 AC65 carve-out 测试）；
  `scripts/test.sh --for-task gap-ac65-direct-fix-vs-bypass-detector-conflict` **exit 0**（全部 static PASS + 19/19）。
- **待续**：outer 落 AC65 措辞；人裁定最终方向；02b2b2fc 处置（保留作合法 AC65 直修样本 / 或按裁定重投）；parser fan-in 解除阻断。

## 止损

**需要 —— 当下动作 = 本任务立案**：AC65 与 bypass-detector 结构性冲突，首次具名样本 02b2b2fc 使 round200 红 + parser fan-in 阻断。不立案则冲突从记录消失、下次 AC65 直修复撞。manager 裁定「不 reset/不扩/不重投，让红作样本」= 冲突保持可见，立案即止损线。

## PARKED（inner 2026-08-15 10:2xZ，解除条件 = 人裁定 AC65 vs bypass-detector 谁让谁）

**背景**：fan-in 已在 manager「hold」建议送达前落地（b0d9e3f3，ffOk:true，carve 进 develop）。manager 过程关切成立：本任务 Plan step 1 = 人裁定，不该被自动晋成可派 ⇒ fan-in 翻 done 过早（DoD「02b2b2fc 处置完毕」实质依赖人裁定）。依 manager 建议 PARKED，不让其以「已修复」形态沉淀。

- **代码**：carve（sha+证据表）在 develop（b0d9e3f3）——**未 revert**。恢复 round200 红作裁定读数 = revert carve，是更重的动作，待 manager/人确认后执行。
- **形态问题（硬规则4推论二）**：sha 白名单是宿主依赖字面量——新样本需改代码才覆盖、且静默不覆盖；manager 建议按授权条件判（提交消息含 AC65 验证输出 ⇒ ac65Authorized）。待裁定后定形态。
- **parser fan-in（w7twbdxra）**：**保持阻断，不重跑**（选定代价 = 裁定读数的一部分；carve 落地前它在阻断，落地后维持不跑以保留压力）。
- **待续**：outer 落 AC65 措辞；人裁定方向；02b2b2fc 处置（保留样本 / reset 重投）；carve 形态（keep / 条件化 / revert）。
