---
id: gap-nothing-checks-whether-a-done-task-left-its-acs-behind
title: "A task can close done with half its ACs unchecked and no successor, and no check notices — the gate on the gates is missing"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

2026-08-03 17:0xZ：`gap-session-liveness-heartbeat-freezes-for-the-whole-task` 以
**`status: done`、16 条 AC 只勾 8 条**收尾，**剩余 8 条无任何后继任务承载**。
外层是**碰巧去看**才发现的。

**实测：没有任何机械执行者会发现它。**

```
node --experimental-strip-types plugin/scripts/task-status-drift-check.ts
  → 报的是两个陈年 reverse-drift suspect（DIR-073、gap-reclaim-…）
  → 对 8/16 的 done 零反应
```

`task-status-drift-check` 判的是**「代码有没有落地」**（符号解析 + Touches 存在性），
而这次**代码确实落了**——所以它正确地保持沉默。
**「收尾时 AC 是否被承载」这件事，本仓目前没有任何检查。**

**管理者的定性**：这是今天第 10 次「存在 ≠ 生效」，**而且它关于闸本身，比前九次都靠上游**——
今天勾掉的 AC 有相当一部分是管理者**手工逐条核**的，正因为没有机械执行者。

## 判据（管理者给的三条，逐条落进 AC）

**一、判据不是「AC 全勾才能 done」。** 那会逼出**勾选造假**——
今天已有实例：**AC 正文写着「已达成」而 checkbox 未勾**（管理者自陈）。
**判据是**：

> **`status: done` 时若存在未勾 AC，则必须存在承载它们的后继任务，
> 且后继任务要指名承载了哪几条；未承载即拦。**

**二、负控制必须双向**：
- 造一个半数 AC 未勾**且无后继**的任务 ⇒ **必须报**
- 造一个半数未勾**但有后继承载**的任务 ⇒ **必须放行**

**只证明「能拦」不够——那与「拦一切」同形。**

**三、承载关系必须是可机读的**，不能只靠散文里提一句
（否则这条检查会变成又一个「写下来但没有执行者」的规则，
而本任务存在的理由正是那一族）。

## Contract

```
measure unowned_acs = `node --no-warnings --experimental-strip-types plugin/scripts/task-ac-carryover-check.ts --root . --json` 输出的未被承载的未勾 AC 计数字段
measure blocked_tasks = 同一命令输出中被拦下的任务数字段（`--json` 的 blocked 数组长度）
band unowned_acs = 0
invariant 不要求 AC 全勾；要求未勾者有指名的承载者；承载关系可机读
invoke `node --no-warnings --experimental-strip-types plugin/scripts/task-ac-carryover-check.ts --root . --json`
control 半数未勾且无后继 ⇒ 报出；半数未勾但后继指名承载 ⇒ 放行
resume 先定承载关系的机读表示，再写检查器，最后接执行者
```

## Chosen mechanism

1. **定义承载关系的机读表示**：在后继任务里用一个固定形状声明它承载了哪些 AC
   （例如 `## Carries` 段：`from: <task-id>` + `acs: AC9, AC10, AC13, AC14`），
   **由检查器解析，不靠散文**。
2. **`plugin/scripts/task-ac-carryover-check.ts`**：对每个 `status: done` 的任务，
   若有未勾 AC，则要求存在一个 `## Carries` 指向它、且覆盖那些 AC 编号；
   **覆盖不全也要报，并指出差哪几条**。
3. **接执行者**：与 `task-contract-check` 同址（`scripts/test.sh` 的 `run_static_checks`），
   理由相同——CI 的唯一测试步骤就是 `bash scripts/test.sh`，接在那里等于 CI 免费继承。
   **不接执行者的方案一律不接受**——本任务的全部证据就是「没有执行者」的后果。
4. **棘轮**：既有的 `done` 任务里必然有一批未勾 AC 且无承载（历史遗留），
   **用与契约棘轮相同的形状基线化**（只能变短），**不要一次性阻断**。

**不做**：不要求 AC 全勾（会逼出勾选造假）；不自动创建后继任务
（承载什么是判断，不是机械动作）；不改 `task-status-drift-check`
（它判的是代码落地，是另一件事，合并会让两个判据互相掩盖）。

## Acceptance Criteria

- [ ] AC1: `## Carries` 的机读形状定义并写进 `docs/`，含 `from:` 与 `acs:` 两个字段
- [ ] AC2: `task-ac-carryover-check.ts` 落地，`--json` 输出 `unowned`/`blocked` 两个字段
- [ ] AC3: **负控制（拦）**——造一个半数 AC 未勾且无后继的任务 ⇒ **报出并指名差哪几条 AC**（实跑输出贴任务体）
- [ ] AC4: **负控制（放行）**——同一个任务加上指名承载的后继 ⇒ **不报**（实跑输出贴任务体）。
      **AC3 与 AC4 缺一不可**：只证明能拦与「拦一切」同形
- [ ] AC5: **覆盖不全也要报**——后继只承载 8 条中的 5 条 ⇒ 报出缺失的 3 条编号
- [ ] AC6: 检查器**有执行者**（写明挂在哪、被真实触发过一次并贴输出）；「建议挂在 X」不算
- [ ] AC7: 存量基线化为只能变短的名单，基线数字与生成命令一并记录
- [ ] AC8: **本次实例回填**——`gap-session-liveness-heartbeat-freezes-for-the-whole-task` 与其后继
      `gap-session-liveness-stage-2-screen-signal-and-payload` 加上 `## Carries`，检查器对这一对**放行**
- [ ] AC9: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC3 与 AC4 两个方向的实跑输出都贴进任务体——
      **一个只会拦的检查器与一个拦一切的检查器不可区分**
- [ ] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明）
- [ ] 任务体记录：触发它的是**外层自己的一条指令**（「关掉它、阶段二重新注册」只有前半是动作），
      **不是内层漏做**

## Touches

- plugin/scripts/task-ac-carryover-check.ts
- plugin/test/task-ac-carryover-check.test.mjs
- docs/analysis/task-ac-carryover-contract.md
- scripts/test.sh

## Dispatch review

reviewer: outer
at: 2026-08-03T17:12:00Z
changed: 外层把这条作为**无主发现**交给管理者而非自建第 7 个任务，管理者裁定**排，优先级仅次于冷启动**。
**三条判据逐条落进 AC**：①不要求 AC 全勾（会逼出勾选造假，今天已有 AC 正文写「已达成」而 checkbox 未勾的实例），
改为「未勾者必须有**指名承载**的后继」；②**负控制双向**（AC3 拦 / AC4 放行）——
**只证明能拦与「拦一切」同形**；③承载关系**必须机读**，否则这条检查会变成又一个
「写下来但没有执行者」的规则，而那正是它要修的东西。
**一处归属更正**：管理者把「关掉它、阶段二重新注册」这条含糊指令记成了自己的，
**那条是外层发给内层的**（17:02Z），外层已在自己的 tick 记录里认领。
**两边都记成自己的错，会让两份日志同时不准**——按今天反复强调的「记录要能被后来者对上」，这里必须归位。
**派发时机**：在飞 1（冷启动），本任务排其后。
