---
id: gap-verify-delivery-surface-checks-source-layout-not-consumer-laid
title: "verify-delivery-surface checks the SOURCE layout (plugin/loop/, plugin/scripts/ = quay's own repo) not the CONSUMER's LAID layout (orchestration/ + docs/analysis/ = what quay-init lays into a consumer) — archguard ran the real mechanism: 0/6, structurally impossible to pass for ANY consumer (verify-delivery-surface.ts:17 comment admits it); this is 'parent environment hides parent defect': the check meant to validate delivery completeness CANNOT SEE the layout it validates — if used as AC16's completeness evidence it produces a green that is structurally impossible; archguard da0b2cbf 2026-08-06"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**verify-delivery-surface 查源仓库布局，看不见消费者 laid 布局——对任何消费方结构性假阴性。**

**【实测（archguard 用 quay 真机制，da0b2cbf 2026-08-06）】**：archguard 跑 `verify-delivery-surface`
报 **0/6**。根因：它查 quay 自家布局（`plugin/loop/fast-mode-loop-tick.md`、`plugin/scripts/quay-init.sh`
等 deliverables，`verify-delivery-surface.ts` 行 17 注释明确承认「which does not lay down
orchestration/SPEC-*」），而**消费者 laid 布局是 orchestration/ + docs/analysis/**（quay-init 铺到
消费者时是 docs/analysis/ + orchestration/，不铺 plugin/loop/ 源文件）。

**【性质】「亲代环境掩盖亲代缺陷」**：验证交付完整性的检查，**恰恰看不见它要验证的布局**。对任何
消费方（archguard/meta-cc/B 机）都会假阴性。

**【对 AC16 的直接影响】**：AC16 判据 2（完整性）= 从 release 资产安装后 quay-init --loop 铺出机制。
**verify-delivery-surface 本应是完整性的机械证据**——但它查源布局，拿它当 AC16 完整性证据会得到
**结构上不可能为真的绿**。这是 AC16 判据设计的直接威胁。

### 选定机制

1. **verify-delivery-surface 支持消费者 laid 布局**：可配置检查的根（source 布局 vs laid 布局），
   消费者模式查 orchestration/ + docs/analysis/（laid 的真实位置）
2. **AC16 完整性证据改用消费者 laid 校验**：从 release 资产安装后，verify-delivery-surface
   以 laid 布局模式验证（而非源布局）

## Acceptance Criteria

- [ ] AC1: verify-delivery-surface 支持消费者 laid 布局——archguard（orchestration/+docs/analysis/）
       不再 0/6（实跑 > 0）
- [ ] AC2: AC16 完整性证据用 laid 布局校验——release 装出的消费者，verify-delivery-surface laid 模式
       通过（而非源布局假阴性）
- [ ] AC3: 与 gap-release-excludes-plugin-bundle（AC16 核心）交叉标注——verify-delivery-surface 是
       AC16 完整性的机械证据链
- [ ] AC4: 源布局模式保留（quay 自家仍可验 plugin/loop/）——两种布局都支持

## Definition of Done

- [ ] AC1-AC4 全勾（verify-delivery-surface 支持消费者 laid 布局；AC16 完整性证据用 laid 校验通过；与 gap-release-excludes-plugin-bundle 交叉标注；源布局模式保留）
- [ ] archguard laid 布局实跑 > 0（不再 0/6）；两种布局都支持
- [ ] scoped 门 `scripts/test.sh --for-task gap-verify-delivery-surface-checks-source-layout-not-consumer-laid` 绿

## Touches

- plugin/scripts/verify-delivery-surface.ts（laid 布局模式）
- tasks/gap-release-excludes-plugin-bundle-agent-surface.md（AC3 交叉标注）
- .quay/manager-inbox/archguard-20260806-033256Z.md（AC1 实证来源）

## Contract

measure   consumer_surface = `node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --surface --root <consumer-dir> 2>&1 | grep -c 'ok\|PASS'` stdout 数字段
band      consumer_surface = > 0（消费者 laid 布局可验，非 0/6）
invoke    `grep -n 'orchestration\|docs/analysis\|plugin/loop\|plugin/scripts' plugin/scripts/verify-delivery-surface.ts`
control   archguard laid 布局实跑 > 0（AC1）；源布局模式保留（AC4）
resume    laid 模式与 AC16 接线分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T07:2xZ
changed: archguard 实证（0/6）+ 外层核实（行 17 注释承认查源布局）立案。verify-delivery-surface 查源
布局看不见消费者 laid 布局——对任何消费方结构性假阴性。AC16 完整性判据的直接威胁（若拿它当证据得
结构上不可能的绿）。高优先——AC16 交付面。

## 追加违规（2026-08-06T09:0xZ，管理者审计 + 外层核实）

**B·verify-delivery-surface.ts 第 5 项自相矛盾**：deliverables 列 `os-anchor-install.sh +
os-anchor-watchdog.sh`（criterion「OS 级周期锚点 systemd user timer」），但 **gap-os-anchor-watchdog-
lease-model 任务 122-140 行已裁定 watchdog 不是产品交付物**（4 次全灭全是实验室自伤、循环论证、
默认不装不进 plugin/ 推荐路径）。⇒ L1 交付面检查在算一个已裁定不属产品的东西，且 systemd 是
Linux-only 违反可移植性。修复：第 5 项移除 os-anchor 或改判据为「非产品交付」。

## 追加两半（2026-08-06T09:4xZ，archguard 消费方验证 #133）

**archguard 消费方侧独立验证，补全为三半（同一缺陷族，并入本任务）**：

1. **布局硬编码到 quay**（已立案）：verify-delivery-surface 查 plugin/loop 等源布局，非消费者 laid 布局。
2. **检查本身没交付**（archguard 确认）：0.3.13 实际铺设集**没有 verify-delivery-surface.ts**——源文件在
   plugin/scripts/（外层核实存在）但**不在 quay-init 铺设集**（quay-init.sh 无引用）——消费方跑不了这个
   检查，它之前跑的是 quay 的副本。0/6 有两半：布局 + 未交付。
3. **laidFiles 记录残缺**（archguard 新发现，亲代查不出）：quay-init.sh:610-623 的 `laidFiles` **硬编码只记录
   2 个 tick 文档**（`for rel in ["orchestration/orchestrator-loop-tick.md", "docs/analysis/fast-mode-loop-tick.md"]`），
   `laidCategories` 只加 `"loop"`——「铺设了什么」的记录只覆盖 loop 层，不含 scripts/skills/probes/vendor/agents
   等实际铺设的绝大部分。**记录与交付不一致**——与 ADR-024（裁定与其机械化检查可追溯绑定）同 territory。

**这是「子代发现亲代盲区」第三实例**（管理者先在亲代查出一半、子代补上另两半）——分工价值第二个实证。
