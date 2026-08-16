---
id: gap-suite-fix-red-baseline-2026-08-16
title: "suite-fix：develop 基线 23 文件 / 7 族测试恒红（08-15 起）——挡 drift-mode fan-in + AC88 验证机制，必须真修复"
status: todo
labels:
  - gap
  - mechanism
  - suite-fix
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-16 优先级判断（转发 inner needs-human）+ 人 2026-08-16 新阶段裁定。

**关键事实（manager 判断，方向明确）**：develop 基线 **23 文件 / 7 族测试恒红（08-15 起）**，挡住
drift-mode follow-up 的 fan-in。失败族含 `quay-init*` / `install-config-driven-e2e*` /
`cold-start-skill` / `real-target-verify` / `capability-catalog` / `select-preflight-cli`——
**正是 AC85-89 新阶段验证的对象本身**。AC88 的验证机制要跑通这批测试族才能产出可核记录；
**不修，AC88 从立案那天起就注定验证不了**。

**已确认证据**：最近一次真实全量轮（verification-round 08-15 12:55，lane 16）state=red、19 failures
（任务文件缺口 + 静态检查 + 测试族）。per-task-suite-records 亦见 08-16 00:44 red（5 文件）。

**判定（manager，outer 采纳）**：**必须修**——不能等基线自己好、不能靠 override 替代真修复
（今日 (a) 补 catalog 不豁免的先例同构）。inner 可对自己的任务用 override 解锁（delta 已证非因果，
有负控制），**但本任务 23 文件 7 族的真修复必须单独立案**（规模太大，不折进 AC85-89 任何现有 AC）。

**⛔ 本任务独立于 AC85-89**——它是它们的**前置依赖**（AC88 验证机制 + drift-mode 都需要基线绿）。

## Plan

1. 跑全量套件确认当前真实失败集（23 文件/7 族的具体清单——以真跑为准，非 08-15 的历史快照）。
2. 逐族归因：quay-init* / install-config-driven-e2e* / cold-start-skill / real-target-verify /
   capability-catalog / select-preflight-cli 各自的根因（可能是同一批 08-15 变更，也可能是家族性）。
3. 修复（改代码/测试/夹具），逐族转绿。
4. 全量套件绿（`state=green` 且时间新于 08-16 切换）为达成证据；修红期间不用 override 顶替真修复。

## Acceptance Criteria

- [ ] AC1: 以**真跑**确认真实失败集（23 文件/7 族），不是引用 08-15 历史快照当现状。
- [ ] AC2: 失败族逐族归因 + 修复（quay-init* / install-config-driven-e2e* / cold-start-skill /
      real-target-verify / capability-catalog / select-preflight-cli 全部转绿）。
- [ ] AC3: 全量套件 `state=green`（verification-round 或 per-task-suite-records 记录，时间新于
      2026-08-16 切换），**未用 override 顶替**。
- [ ] AC4: 修复的证据逐族可核（每个修复族一个记录点）。

## Definition of Done

- [ ] develop 基线全量套件绿（新于本次切换），drift-mode fan-in 不被红挡住，AC88 验证机制可产出可核记录。

## Touches

- packages/quay/test/* + plugin/test/*（测试族）
- 对应实现（packages/quay/src/* 等，按归因）
- .github/workflows/ 或 scripts/test.sh（如属流程/基线问题）
- tasks/gap-suite-fix-red-baseline-2026-08-16.md（自身）
