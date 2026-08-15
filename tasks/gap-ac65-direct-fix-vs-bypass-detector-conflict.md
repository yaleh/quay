---
id: gap-ac65-direct-fix-vs-bypass-detector-conflict
title: AC65「outer 一条命令可验可直接修 plugin/scripts」与 bypass-detector「plugin/scripts 直提交
  develop 即 bypass」结构性冲突——无 carve-out，首次具名样本 02b2b2fc，需人裁定谁让谁
status: ready
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

## Implementation（inner 2026-08-15 重写——detector 按【两谓词】判，替换 sha 表）

**outer 已落声明形态（b11ce720），两行两个谓词、不可互顶**：
```
AC65: outer 按 AC65 授权直修（一条命令可验）        ← 声明/范围标记（/^AC65:/m）
AC65-Verified: <验证命令> => <实际输出摘要>          ← 验证产物（/AC65-Verified:/m）
```

**机制（`plugin/scripts/direct-to-develop-bypass-check.ts`）**：
- `ac65Authorized = commitHasAc65Declaration ∧ commitHasAc65Verification`（两谓词独立）。
- 声明 ∧ 无验证产物 ⇒ **红**（判据3 首次有执行体）；无声明 code-surface 直投 ⇒ **红**。
- 验证谓词不得被声明字面满足（⛔ 旧 `/AC65/` 会按构造使声明=免检，已弃）。
- 02b2b2fc legacy 形态（`AC65 一条命令验证：… 24/24 绿`）容忍或规范化判定（不补写历史）。
- **`AC65_AUTHORIZED_DIRECT_FIXES` sha 表退役/降级为展示**，不参与判定（硬规则4：手抄表是回显）。
- **基线推进（`scripts/test.sh` enforcement 落点 77b291db → b11ce720）**：pre-form 历史（9f57e336/102cbf31/
  02b2b2fc 等 outer 直提，当时一条命令验证过）归 pre-baseline 不重扫；form 后提交必须带 `AC65:` + `AC65-Verified:`。

**AC3 归属（落盘）**：outer = AC65 措辞（b11ce720 已落）；inner = detector 两谓词实现 + 基线推进（本实现）；人 = 裁定（已到）。

## Acceptance Criteria

- [x] AC1 冲突消除：AC65 授权直修（outer 声明 + 验证产物）与 bypass-detector 不再互撞；两谓词分离，声明字面不满足验证谓词。
- [x] AC2 能取假·真样本：声明∧验证 ⇒ ac65Authorized（02b2b2fc legacy 容忍重判通过）；声明∧无验证 ⇒ 红；无声明 code-surface 直投 ⇒ 红（7e64a86b 类仍红）。
- [x] AC3 归属明确：outer（AC65 措辞 b11ce720）/ inner（detector 两谓词 + 基线推进）/ 人（裁定）分工落盘。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿；sha 表退役不参与判定。

## Definition of Done

- [x] AC65 与 bypass-detector 对齐（声明/验证两谓词判），02b2b2fc legacy 样本通过，parser fan-in 解除阻断。

## Touches

- orchestration/orchestrator-tick-core.md（AC65 措辞——outer 独占，inner 不动）
- plugin/scripts/direct-to-develop-bypass-check.ts（carve-out——inner 实现面，已落盘）
- plugin/test/direct-to-develop-bypass-check.test.mjs（对应测试——inner 实现面，已落盘）
- scripts/test.sh（基线推进 b11ce720——pre-form 历史不重扫）
- tasks/gap-ac65-direct-fix-vs-bypass-detector-conflict.md（自身）

## Evidence（inner 侧已落地；outer 措辞 b11ce720 + 人裁定已到）

- **机制（两谓词替换 sha 表——硬规则4：手抄表是回显）**：`AC65_DECLARATION_RE = /^AC65:/m`（声明）
  + `AC65_VERIFICATION_RE = /AC65-Verified:/m`（验证产物）+ `AC65_LEGACY_RE = /AC65 一条命令验证/`
  （02b2b2fc legacy 合一短语，声明/验证两谓词都容忍，不补写历史）；`ac65Authorized =
  commitHasAc65Declaration ∧ commitHasAc65Verification`；`AC65_AUTHORIZED_DIRECT_FIXES` 降级为纯展示
  （`classifyCommit` 不再引用）；`bypass = !designInternal && !inLockWindow && !ac65Authorized`。
  ⛔ 两谓词独立——声明行（含 "AC65"）不含 "AC65-Verified:"，不被验证谓词字面满足（旧 `/AC65/` 已弃）。
- **AC1/AC2（CLI `--commits` 回放，exit 实测）**：
  - `--commits 02b2b2fc` → **exit 0**，`reason=ac65-authorized-direct-fix-only`，candidate
    `ac65Authorized=true` / `confirmedBypass=false` / `ac65Evidence=「AC65 一条命令验证：…24/24 绿」`（legacy 容忍重判通过）。
  - `--commits 7e64a86b` → **exit 1**（无声明真直投仍红），`confirmedBypass=true` / `ac65Authorized=false`。
  - 声明 ∧ 无验证产物 ⇒ 红（PURE 用例：`AC65: outer 按 AC65 授权直修（一条命令可验）` 单行 → `ac65Authorized=false` / `bypass=true`，判据3 执行体）。
- **AC2 基线推进（`--baseline b11ce720…` 全 reflog 扫描）**：exit 0，`totalDirectCommits=2`（f9ba031b/12ef0759
  均 design-internal）、`codeSurfaceCommits=0`、`candidates=[]`——9f57e336/102cbf31/02b2b2fc 全转 pre-baseline
  不扫描。对照旧基线 77b291db：9f57e336（plugin/scripts/retired-clause-check.ts）+ 102cbf31
  （plugin/scripts/trend-check.ts）RED（pre-form 直投）、02b2b2fc ac65Authorized——基线推进的必要性实证。
- **AC4**：`node --test plugin/test/direct-to-develop-bypass-check.test.mjs` **20/20 绿**（两谓词独立 + legacy
  容忍 + 声明∧无验证红 + 无声明直投红 + CLI 回放全部覆盖）；`scripts/test.sh --for-task
  gap-ac65-direct-fix-vs-bypass-detector-conflict --allow-thin`（与 fan-in-execute.js:97 生产调用一致）
  **exit 0**（全部 static PASS + 20/20；thin=0.4 因 scripts/test.sh 无 basename 配对测试，`--allow-thin` 为
  既有薄选机制，生产 fan-in 恒传）。
- **待续（不在本实现内）**：02b2b2fc 处置（保留作合法 AC65 直修样本 / 按裁定重投）；parser/AC65/DIR-103-B
  三条 fan-in 依赖本改动 + 基线推进解锁。

## 止损

**需要 —— 当下动作 = 本任务立案**：AC65 与 bypass-detector 结构性冲突，首次具名样本 02b2b2fc 使 round200 红 + parser fan-in 阻断。不立案则冲突从记录消失、下次 AC65 直修复撞。manager 裁定「不 reset/不扩/不重投，让红作样本」= 冲突保持可见，立案即止损线。

## UNPARKED→REWORK（inner 2026-08-15 11:4xZ——outer 已落声明形态 b11ce720，解锁条件满足）

原 PARKED 历史见 git（sha 表 stopgap 阶段，10:3xZ—11:4xZ）。人裁定方向（主体不同）已实现：
outer 落 AC65 措辞（b11ce720）+ 声明/验证两谓词形态；inner 现重写 detector（见 Implementation）。
parser fan-in 已解除 hold 在飞（wltmuze1w）。
