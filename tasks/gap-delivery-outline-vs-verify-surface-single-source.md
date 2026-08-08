---
id: gap-delivery-outline-vs-verify-surface-single-source
title: "TWO independent deliverable manifests with NO mechanical binding — docs/proposals/quay-product-outline.md §6 (directory counts: scripts 97/skills 11/gate-scripts 14/probes 4/loop 2/workflows 2/agents 1/vendor 2) vs plugin/scripts/verify-delivery-surface.ts (capability categories: 机件与运行时/循环文档/启动配置/会话拓扑/周期锚点/观测与校验, concrete files) — editing one never warns the other; human ruling 2026-08-06: KEEP ONLY ONE (which is source, how the other retires/derives = outer ruling); ALSO: outline counts STALE (scripts 97→actual 120, skills 11→13), probes NOT laid by quay-init (grep 0) yet human ruled probes ARE deliverables, routine-scheduler's only live callers are retired loop-driver SKILL (live tick docs 0 hits), prerequisites class missing from outline (Node floor / .quay/config.yml shape / tmux cold-start-only); ADR-024 applies (ruling↔mechanized check traceability) but the original case covered only the check side, not outline-vs-check pair"
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

**两份互不相干的交付物清单只留一份（人裁定重点）——以 verify-delivery-surface.ts 为单一事实源。**

**【人裁定（2026-08-06）】**：仓库存在两份互不相干的交付物清单——`quay-product-outline.md §6`（目录计数）
vs `verify-delivery-surface.ts`（能力分类）。**没有任何机械绑定**（改一份不提醒另一份，外层核实 grep 空）。
人裁定【只留一份】。

**【外层裁定：以 verify-delivery-surface.ts 为源】**：
- 它是**机械的、可执行的**（能验证交付完整性）；outline §6 是 prose（数字已过时）。
- ADR-024「裁定与其机械化检查可追溯绑定」——机械检查是权威，prose 派生。
- outline §6 改为**派生自 verify-delivery-surface**（引用其输出或生成），机械兜住漂移。

**【审计发现（管理者 + 外层核实）】**：
1. **轮廓数字过时**：scripts 97→实际 120（+23）、skills 11→13（+2）。合一后由机械检查兜住。
2. **v0.4.0 与轮廓不符**（gap-release-sea-bundle 已立案，补数据）：tarball 只有 quay/quay-native/tasks/config，
   轮廓 §6 声称的 plugin bundle 一件没有。
3. **probes 三重断链**（人裁定 probes 是交付物，故为缺陷非退役理由）：
   (a) quay-init --loop 不铺设 probes（grep 0）——目标项目磁盘上不会出现探针；
   (b) routine-scheduler 唯一调用方是退休的 loop-driver SKILL（活 tick 文档零命中）；
   (c) config 的 routines: 照常存在且 config-validate 报 Valid——校验语法不校验「这段配置会不会被谁读」。
4. **前置条件类缺失**（人逐条裁定）：Node 版本下限应补进轮廓（ad-arm1 系统 18.19.1，package.json >=20）；
   GitHub 认证**不算**交付物轮廓（人裁定撤回）；tmux 拓扑**标注为 cold-start 前置**（非全局）；config.yml
   完整形状应补（quay-init 只生成 loop: 四字段，ad-arm1 手工补 gates: 60 行才过 validate）。

### 选定机制

1. verify-delivery-surface 为单一事实源；outline §6 派生（引用/生成）
2. 轮廓漂移机械兜住（合并后 verify-delivery-surface 计数即权威）
3. probes 三缺陷修复（铺设 + 调用方 + config 死配置检测）
4. 前置条件补进轮廓（Node 下限 / config 形状 / tmux cold-start 标注）

## Acceptance Criteria

- [ ] AC1: 单一事实源——verify-delivery-surface 为交付物清单源，outline §6 派生（非独立维护）
- [ ] AC2: 轮廓漂移机械兜住——verify-delivery-surface 计数与磁盘一致（脚本漂移报出）
- [ ] AC3: probes 三缺陷修——铺设（quay-init）+ 调用方（活文档）+ 死配置检测（routines 无人读报出）
- [ ] AC4: 前置条件补轮廓——Node 下限 / config 完整形状 / tmux cold-start 前置标注
- [ ] AC5: 与 ADR-024 交叉标注（裁定↔机械检查绑定，本案覆盖 outline-vs-check 对）

## Definition of Done

- [ ] AC1-AC5 全勾（verify-delivery-surface 为交付物清单单一事实源，outline 派生；轮廓漂移机械兜住；probes 三缺陷修——铺设/调用方/死配置检测；前置条件补轮廓；与 ADR-024 交叉标注）
- [ ] 单一事实源实测：verify-delivery-surface 计数与磁盘一致，脚本漂移报出
- [ ] scoped 门 `scripts/test.sh --for-task gap-delivery-outline-vs-verify-surface-single-source` 绿

## Touches
- tasks/gap-delivery-outline-vs-verify-surface-single-source.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- docs/proposals/quay-product-outline.md（§6 改为派生）
- plugin/scripts/verify-delivery-surface.ts（单一源 + 漂移检测）
- plugin/scripts/quay-init.sh（probes 铺设）
- plugin/scripts/routine-scheduler.ts（调用方修复或退役标注）
- plugin/scripts/config-wiring-check.ts（死配置检测）
- tasks/gap-release-sea-bundle-excludes-plugin-tree.md（AC2 交叉标注）

## Contract

measure   single_source = `grep -c 'verify-delivery-surface' docs/proposals/quay-product-outline.md` stdout 数字段
band      single_source >= 1（outline 引用单一源）
invoke    `grep -rn 'quay-product-outline\|product-outline' plugin/scripts/verify-delivery-surface.ts`
control   改 verify-delivery-surface ⇒ outline 漂移被兜（AC2）；probes 铺设（AC3）
resume    单一源与 probes 修分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T13:4xZ
changed: 人裁定重点立案——两份交付物清单只留一份。裁定以 verify-delivery-surface 为源（机械可执行），
outline §6 派生。审计发现坐实（轮廓漂移 + probes 三断链 + 前置条件缺失）。ADR-024 适用（轮廓 vs 检查对）。

## 追加发现（2026-08-06T14:0xZ，管理者审计补充 + 外层核实）

- **④ tmux 铺设期 fail-closed 与人的裁定 (c) 冲突（实现问题）**：quay-init.sh --loop 对 tmux 会话
  fail-closed exit 2（DETECT_RC=2 多会话/无会话拒绝，ad-arm1 被挡需显式 --tmux-session）。`--loop` =
  铺设循环机制（--tmux-session 是写 config 的 loop 参数）。人裁定 tmux 仅 cold-start 必要——冲突在
  「铺设期强制检测」vs「cold-start 才真正用」。修：--tmux-session 应为可选铺设参数（缺失时 config 留空
  或标注待 cold-start 填），tmux 检测移到 cold-start。**实现问题非文档**（管理者判断正确）。
- **⑥ publish-dist-branch.sh 是活路径（非实验产物）**：被 publish-plugin-dist.yml 引用（行 27/48，
  dist-plugin 重建 = AC6 执行者）。origin/dist-plugin 落后是 v0.3.13 后未触发重建，AC6 修复会重建。
  不删，但需 AC6 触发重建验证。
