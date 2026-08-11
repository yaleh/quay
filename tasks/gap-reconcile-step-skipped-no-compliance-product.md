---
id: gap-reconcile-step-skipped-no-compliance-product
title: "inner 核 A13 写了【stale_brackets > 0 ⇒ 调 --reconcile】但没有产物区分守与不守——04:01 心跳已写 realConcurrency=8(残留占槽) 却未执行 --reconcile，直接损失 4 槽×多轮；处方=slot-status 报 stale_brackets>0 而同轮无 --reconcile 调用 ⇒ 该轮判不合规（C17 形状闭合）"
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**inner 核 A13 原文【stale_brackets > 0 ⇒ 调 --reconcile (src:636,614,1131)】写了规则，但没有产物能区分【守】与【不守】（C17 形状）。04:01 那轮心跳里已经写了 realConcurrency=8(残留占槽)——看见了，没执行下一步 --reconcile。代价：槽位账本被 27 个陈旧括号撑满报 0 空槽，inner 完全按 C6 规矩（closedButLive 仍占槽）停止多派——损失 4 槽×多轮。**

### 实证（manager 2026-08-11 04:4x 实测 + outer 复核）

- **slot-status 实测**：`brackets-in-flight 38 / reconcilable 27 / real-in-flight 11 / occupied 15 / slots-total 5 / slots-remaining 0`；closed-but-live 四条（a15-ruling5-counter / ac38-outer-doc-drift / outer-tick-core-b9 / pool-quality）。
- **真实在飞只有 3 个 subagent**（serial-install / prereq-gates / rollback-counter）——账本被 27 个陈旧括号撑满。
- **inner 完全按规矩办事**：C6 规定【括号关 ≠ 进程退，closedButLive 仍占槽】⇒ 看到 slots-remaining 0 后不再多派——**不是漏派**。
- **缺的下一步写在 A13**：`stale_brackets > 0 ⇒ 调 --reconcile (src:636,614,1131)`。04:01 心跳已写 realConcurrency=8(残留占槽)——**看见了，没执行**。
- **--reconcile 是安全的**：源码注释写明只在执行体【可观察地消失】时关闭记录、绝不按年龄关；reconcile 关闭的记录路由到 reconciled[] 不污染 tasks[]。
- **预计**：一次对账释放约 4 个槽位（可派 10-11 条）。
- **C17 形状**：核里写了规则，但没有产物能区分守与不守——与 gap-slot-free-not-an-event 同族，但后者是「空槽不是事件」、本因是账本失真使【空槽】条件本身在 inner 看来不成立。事件化仍值得做，但优先级在本条之后。

### 选定机制方向（实现归 inner，判定归 outer）

**给 A13 的 --reconcile 步骤造产物**——`slot-status` 报 `stale_brackets > 0` 而同轮无 `--reconcile` 调用 ⇒ 该轮判不合规：
1. **合规判据**：slot-status 输出加 `reconcile_compliant` 字段——stale_brackets>0 且（同轮/邻近无 --reconcile 调用记录）⇒ false。
2. **留痕**：--reconcile 调用写时间戳（`--reconcile` 已 WRITE，可复用其产物做最后调用记录）；slot-status 比对 stale>0 与最后 reconcile 时间。
3. **上游观察**：outer tick 读 slot-status 的 `reconcile_compliant`，false ⇒ 报「inner 未对账」并驱动。

**验证锚**：修后 (a) 构造 stale_brackets>0 + 无 reconcile ⇒ `reconcile_compliant=false`；(b) reconcile 后 ⇒ true；(c) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 slot-status 实测（38/27/11/15/0）+ inner 按 C6 规矩停派 + A13 写了 --reconcile 但 04:01 没执行（本任务 Proposal 已含）
- [ ] AC2: **合规判据**——slot-status 加 `reconcile_compliant`（stale>0 且无 reconcile ⇒ false）
- [ ] AC3: **上游观察**——outer tick 读 reconcile_compliant，false ⇒ 报未对账并驱动
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：stale>0 无 reconcile ⇒ reconcile_compliant=false（贴输出）；reconcile 后 true
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/fast-mode-telemetry.ts（slot-status 加 reconcile_compliant 字段 + reconcile 调用留痕）
- plugin/test/fast-mode-telemetry.test.mjs（新增合规判据用例）
- plugin/loop/fast-mode-loop-tick.md（A13 注明合规产物）
- orchestration/orchestrator-tick-core.md（outer 读 reconcile_compliant）
- tasks/gap-slot-free-not-an-event-slots-stay-empty-missed-without-trace.md（交叉标注——优先级：本因先修，事件化其后）
- tasks/gap-reconcile-step-skipped-no-compliance-product.md（自身：勾 AC + 贴证据）


> **manager 2026-08-11 04:5x 第二次更正（取代本任务根因）**：空槽真因=worktree 泄漏（合并后没删），非陈旧括号。--reconcile 该跑也跑了（括号 38→11、reconcilable 27→0），但不解决本因——occupied 15 = real 11 + closed-but-live 4，而 real 11 里 12 个已合分支 worktree 仍在（fast-mode-telemetry:834/:898 判存活=worktree 在，--reconcile 依规矩拒绝关）。本任务（reconcile_compliant 产物）保留但降级；真因任务=gap-worktree-leak-after-fan-in-occupies-slot-permanently。

## Contract
measure   reconcile_compliant = `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slot-status --cap 5 --json` 的 stdout 中 reconcile_compliant 字段
band      reconcile_compliant = true（stale>0 时有 reconcile 调用）或 stale=0
invariant reconcile_safe = 1（只在执行体可观察地消失时关闭，绝不按年龄关——源码已有）
invariant c17_closed = 1（守与不守在记录上可区分）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slot-status --cap 5 --json`（贴 reconcile_compliant + stale 数）
control   stale>0 无 reconcile ⇒ false；reconcile 后 ⇒ true；C17 闭合
resume    合规判据 / 留痕 / 上游观察 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 04:4x——空槽真根因=账本失真（27 stale ⇒ slots-free 0），非节律/触发器；inner 按 C6 规矩停派非漏派；缺的下一步在 A13「stale>0 ⇒ --reconcile」，04:01 心跳已写残留占槽却没执行。C17 形状（核里写了无产物区分守与不守）。处方：slot-status 加 reconcile_compliant。实现归 inner，判定归 outer
