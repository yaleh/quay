---
id: gap-cron-registry-shared-file-design-revisit
title: AC81 注册表双层共享文件设计复审——人裁定「inner cron 写该文件不合适」；outer-cron-registry.json
  名不符实（双层共享，非 outer 专属）；双写碰撞治标 vs 拆分/改名
status: ready
labels:
  - gap
  - mechanism
  - needs-human
parent: null
children: []
extra:
  schema: plan
  depends_on:
    - gap-direct-to-develop-exclude-cron-registry-receipt
---
**type:** execution

## Proposal

**人裁定（2026-08-17 08:0xZ，manager 转述）**：「inner cron 写该文件是不合适的。」

**背景（manager 只读核实）**：`plugin/scripts/outer-cron-registry.json` 的 schema 本来就是**双层共享设计**——`note` 写「AC81 注册表收据（outer + inner 双层 CronCreate 锚）」，`layers: {inner, outer}`；outer 与 inner 各自的 tick 核心文档都指向它。⇒ **这不是意外碰撞，是 AC81 当初就定的设计**，只是文件名从来没从 `outer-cron-registry.json` 改过（名不符实）。

**这次暴露的更深问题**：`gap-direct-to-develop-exclude-cron-registry-receipt` 治的是「两层同时冷启动 → 各自 cron 重建直写同一收据 → bypass-check 误红」这个**症状**（发生率 3：f9577da1/167b7052/f882ad76）。但**「两层要不要写同一个文件」这个底层问题没有动**——以后任何类似的双层近同时写操作（不限于 cron 重建），排除集只能一个个补，治标不治本。

**候选方向（不判断，待 outer/inner + manager 裁定）**：
1. **拆成两个文件**（`inner-cron-registry.json` + `outer-cron-registry.json`，或目录）——各层写自己的，消除双写碰撞；但 AC81 四判据、anchor-check、observer-registry 等消费者全部要改，范围大。
2. **保留共享但换机制**（如按层分路径、或改为不被 bypass-check 误判的记账面形态）——不动双写本身。
3. **保持现状 + 排除集**（本轮已落地）——接受双写碰撞是结构性的、每次靠排除集兜底。

**⛔ 范围**：本任务**不做实现**，只做设计复审与裁定记录。方向确定后另立实现任务。

**能取假（⊢ 对照）**：复审结论必须落在任务体（选哪个方向 + 理由 + 影响面枚举），而不是停在「讨论过」。

## Plan

1. outer/inner 各读本任务 + `gap-direct-to-develop-exclude-cron-registry-receipt`（症状修复已 land）。
2. 枚举消费者：`outer-cron-registry.ts` / `outer-anchor-check.ts` / 双层 tick 文档 / 测试 pin 集。
3. 评估三方向的实现面与迁移成本。
4. 结论落盘（方向 + 理由 + 影响面），标 needs-human 等 manager 确认。

## Acceptance Criteria

- [ ] AC1: 三个方向（拆分/换机制/保持+排除集）的权衡与影响面逐条写出。
- [ ] AC2: 裁定方向落盘（含理由），不悬空。

## Definition of Done

- [ ] 设计复审完成，方向裁定落盘；若选拆分/换机制 ⇒ 另立实现任务（含消费者迁移清单）。

## Touches

- plugin/scripts/outer-cron-registry.json（设计对象，只读评估）
- plugin/scripts/outer-cron-registry.ts（消费者评估）
- plugin/scripts/outer-anchor-check.ts（消费者评估）
- orchestration/*-tick-core.md（双层文档指向评估）
- tasks/gap-cron-registry-shared-file-design-revisit.md（自身）
