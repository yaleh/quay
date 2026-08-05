---
id: gap-complete-delivery-surface-spec-and-l1-verification
title: "the human asked what a COMPLETE quay cold-start +
  sustained-correct-drive actually requires —
  SPEC-complete-delivery-surface-2026-08-05.md measures it: SIX delivery
  categories (mechanism+runtime ✅, loop docs ⚠️ missing manager, launch config
  ✗, session topology ✗, periodic anchors ⚠️ outer only,
  observation+verification ⚠️ install-moment only); verification must be TWO
  levels (L1 delivery-completeness static — current verify-referenced-landed
  only covers category 1; L2 continuous-health dynamic — all criteria are
  point-in-time); land the six-category spec as a checked-in live document +
  extend the L1 completeness check to all six categories"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人问「真正完整地冷启动 quay 并持续正确驱动开发，要完整交付的到底是什么？应当维护一份文档并建立
校验机制，这才算产品化交付」。管理者已写 `orchestration/SPEC-complete-delivery-surface-2026-08-05.md`
——**交付面的测量结果**（非提案），五处实测缺口 + 六类交付面 + 两层次校验结构判断。

**六类完整交付面**：
| 类别 | 现状 | 归属 |
|---|---|---|
| 1. 机件与运行时 | ✅ | quay-init 派生铺设已修好 |
| 2. 循环文档 | ⚠️ 缺 manager 层 | `gap-productize-the-manager-layer` |
| 3. 启动配置 | ✗ 全缺 | `gap-crystallize-launch-config-into-checked-in-settings-file` |
| 4. 会话拓扑 | ✗ 全缺 | `gap-tmux-session-topology-no-factory-definition`（另立） |
| 5. 周期锚点 | ⚠️ outer 只有 | `gap-inner-has-no-periodic-anchor`(done) + `gap-reanchor-must-converge` + manager cron |
| 6. 观测与校验 | ⚠️ 只覆盖启动瞬间 | 本条 L1 + `gap-quality-criteria-are-point-in-time`(L2) |

**两层次校验**：
- **L1 交付完整性**（静态，装前装后都能跑）：六类每一类都有对应交付物 + 目标项目落地后逐项可解析。
  现有 `verify-referenced-landed`（gap-init-ships 产物）**只覆盖第 1 类**。
- **L2 持续健康**（动态，周期跑）：趋势型判据——现有全部点状；`gap-quality-criteria-are-point-in-time`
  只收了 2 个实例，§3 其余三类（语义一致 / 升级正确性 / 三层完整性）未进。

### 选定机制（外层裁定）

**维护一份六类交付面文档 + 建立两层次校验（人问的「这才算产品化交付」）**：

1. **六类交付面落成活文档**：`orchestration/SPEC-complete-delivery-surface-2026-08-05.md` 升级为**活的
   交付面清单**（六类 + 每类对应交付物 + 归属任务 + 校验判据），随交付物变化更新（单源）。
2. **L1 交付完整性检查**：把 `verify-referenced-landed` 从「只覆盖第 1 类」扩展到**六类全覆盖**——
   静态检查「六类每一类都有交付物 + 目标项目落地后可解析」，装前装后都能跑。
3. **L2 持续健康**：趋势型判据由 `gap-quality-criteria-are-point-in-time-no-trend-criteria` 承载
   （本文件 §3 的语义一致 / 升级正确性 / 三层完整性三类补进该任务）。
4. **不重复建任务**：manager 层（productize umbrella）/ 启动配置（launch-config）/ 周期锚点
   （anchor+converge）/ 会话拓扑（另立）/ 升级通道（另立）各自落地；本条是**规格 + L1 校验**。
5. **L_T 代理消除（管理者五透镜 2026-08-05）——六类里三类仍用廉价代理判据，须按真维度重定**：
   - **循环文档**：代理 =「出厂文档在」；真 =「inner 读了并照做」——实测 inner 复读自己上下文旧措辞，
     ⇒ 真判据 = 语义收敛（`gap-reanchor-must-converge`，inner 自述向出厂语义收敛）；
   - **周期锚点**：代理 =「CRON-CREATED 键测 cron 存在」；真 =「循环真的重锚」⇒ 真判据 = 重锚实跑
     （anchor 任务 AC6 + convergence）；
   - **观测与校验**：代理 =「AC8c 测启动瞬间」；真 =「持续健康」⇒ 真判据 = 趋势型 L2
     （`gap-quality-criteria-are-point-in-time`）。
   **L1 检查的六类判据必须落在真维度上**（同 curl-vs-subagent 修采样仪器的教训——廉价代理在错误轴给
   伪收敛）。

## Acceptance Criteria

- [ ] AC1: **六类交付面活文档**——`SPEC-complete-delivery-surface-2026-08-05.md` 升级为六类清单 +
      每类对应交付物 + 归属任务 + 校验判据（单源，随交付物变化更新）
- [ ] AC2: **L1 检查扩展到六类**——静态检查「六类每一类都有交付物 + 目标项目落地后可解析」，装前装后
      都能跑（现有 verify-referenced-landed 从第 1 类扩展到全六类）
- [ ] AC3: L2 持续健康判据承载——§3 的语义一致 / 升级正确性 / 三层完整性三类补进
      `gap-quality-criteria-are-point-in-time-no-trend-criteria`（交叉标注）
- [ ] AC4: 六类归属无空洞——每条 gap（manager 层/启动配置/会话拓扑/周期锚点/升级通道）对应一个
      已立案任务（实测清单可逐项解析到任务）
- [ ] AC5: 测试用 `node:test` 且带 `// @test-group governance`（L1 检查的六类全覆盖断言）

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC2/AC4 实测输出贴任务体
- [ ] 六类交付面有活文档 + L1 六类完整性检查可跑；每类 gap 可解析到任务
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- orchestration/SPEC-complete-delivery-surface-2026-08-05.md（升级为六类活文档）
- plugin/scripts/（verify-referenced-landed 或等价：扩展到六类）
- plugin/test/（L1 六类全覆盖断言）
- tasks/gap-productize-the-manager-layer.md / gap-crystallize-launch-config-into-checked-in-settings-file.md / gap-quality-criteria-are-point-in-time-no-trend-criteria.md（AC4 交叉标注）

## Contract

measure   surface_categories_covered = `node --experimental-strip-types <L1 check>` stdout 的 covered 数字段
band      surface_categories_covered = 6（六类全覆盖）
invariant spec_is_live = 1（交付面文档随交付物变化更新，非冻结快照）
invoke    `node --experimental-strip-types <L1 check> --surface`
control   六类中任一类无交付物 ⇒ L1 必报缺；补齐 ⇒ 6/6（逐类 fixture）
resume    六类文档与 L1 检查分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T06:1xZ
changed: 外层读 SPEC-complete-delivery-surface 全文裁定立案（人问的产品化交付规格）。四处收紧：
(1) **六类交付面活文档**——不是冻结快照，随交付物变化更新（单源）；
(2) **L1 检查扩展六类**——verify-referenced-landed 只覆盖第 1 类，扩展到全六类（装前装后都能跑）；
(3) **L2 持续健康另条承载**——§3 三类补进 trend-criteria 任务（交叉标注）；
(4) **无空洞**——每类 gap 可解析到已立案任务（AC4）。
status: todo——人问的产品化交付规格；排当前批（ROUND 3 收尾）后，高优先。
