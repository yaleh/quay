---
id: gap-ac81-registry-receipt-and-four-criteria
title: 三层各有注册表收据 + 每轮四判据核实（AC81，人 14:2xZ 裁定）——当前 outer/inner 无此机制
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（三层各有注册表收据 + 每轮四判据核实——人 2026-08-14 14:2xZ 裁定「把三层统一应用 CronCreate 加入本阶段目标和 AC，包括配套工作」）**。

**现状（manager 14:2xZ meta-cc 实测）**：
```
manager  ✅ 注册表收据 + 每轮四判据核实（连续 17 轮全真）
outer    ❌ 无此机制   ← 本任务 outer 侧
inner    ❌ 无此机制   ← 本任务 inner 侧
```

**四判据（manager 形态，判据全部能取假）**：
```
① CronList 恰一条
② id == 注册表（registry 里的 cron id）
③ --verify（锚点校验）
④ 锚点校验（sha256）
```

**⊢ 能取假实证（manager 09:1xZ）**：多传 `--home` 覆盖默认值 ⇒ 读成 registry-missing ⇒ 差点误报「88 轮断了」——判据可被输入形态污染，必须每轮核实。

**判据1**：outer + inner 各有注册表收据（cron id + prompt sha256 进 registry）。
**判据2**：每轮四判据核实（CronList 恰一条 ∧ id==注册表 ∧ --verify ∧ 锚点校验）。
**判据3**：⛔ 不因「窗口/暂停」跳过核实——每轮必跑。
**判据4**：与 AC79（inner CronCreate 锚）/ AC80（prompt 正本）配套。
**判据5（7 天硬上限剩余寿命——manager 14:2xZ 报）**：CronCreate 文档写明「**Recurring tasks auto-expire after 7 days**——fires one final time, then deleted. This bounds session lifetime.」⇒ **三层锚都会 7 天后静默消失**，注册表收据能查出「CronList 空」但无提前预警。**⊢ 核实步骤须报锚的剩余寿命**（`CronCreate 时刻 + 7 天 − now`），**< 24h 即报**。能取假：现在剩余 ≈7 天判据为 false，到第 6 天翻 true。

**不覆盖**：不改唤醒机制本体；不在窗口内改。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 manager 的注册表收据形态（registry + CronList 四判据）。
2. 判据1：outer + inner 各有注册表收据。
3. 判据2：每轮四判据核实。
4. 判据3：不因窗口/暂停跳过。
5. 判据4：与 AC79/AC80 配套。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：outer + inner 各有注册表收据。
- [ ] AC2 判据2：每轮四判据核实。
- [ ] AC3 判据3：不因窗口/暂停跳过。
- [ ] AC4 判据4：与 AC79/AC80 配套。
- [ ] AC5 判据5：核实步骤报锚剩余寿命（CronCreate 时刻+7 天−now），<24h 即报。
- [ ] AC6 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 三层各有注册表收据 + 每轮四判据核实（CronList 恰一条 ∧ id==注册表 ∧ --verify ∧ 锚点校验）+ 7 天剩余寿命判据（<24h 报）。

## Touches

- plugin/scripts/outer-cron-registry.ts 或 .py (new，outer 侧注册表收据)
- plugin/loop/fast-mode-loop-tick.md（inner 侧注册表收据位置）
- tasks/gap-ac81-registry-receipt-and-four-criteria.md（自身）

## Evidence

（落地后回填）
