---
id: gap-nothing-checks-whether-a-done-task-left-its-acs-behind
title: "A task can close done with half its ACs unchecked and no successor, and no check notices — the gate on the gates is missing"
status: done
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

- [x] AC1: `## Carries` 的机读形状定义并写进 `docs/`，含 `from:` 与 `acs:` 两个字段
      **证据**：`docs/analysis/task-ac-carryover-contract.md` 定义形状——后继任务里的 `## Carries`
      段含 `from: <前任务 id>` + `acs: AC9, AC10, …`，由 `task-ac-carryover-check.ts` **位置解析**
      （`parseCarriesBlocks`），散文提及不算。单测 AC1 三条 pin 住解析。
- [x] AC2: `task-ac-carryover-check.ts` 落地，`--json` 输出 `unowned`/`blocked` 两个字段
      **证据**：实跑 `--root . --json` 输出含 `"unowned": 10` 与 `"blocked": [{taskId, unchecked,
      carried, missing}]`（Contract 的 `unowned_acs` 计数字段 + `blocked` 数组 = `blocked_tasks`）。
- [x] AC3: **负控制（拦）**——造一个半数 AC 未勾且无后继的任务 ⇒ **报出并指名差哪几条 AC**（实跑输出贴任务体）
      **证据（合成 fixture：8 条 AC 勾 4，无后继）**：
      ```
      task-ac-carryover: 1 BLOCKED done task(s) — 4 unchecked AC(s) with NO carrying successor
        unowned: done-half — missing AC1, AC2, AC3, AC4 (4 unchecked total, carried: none)
      ```
- [x] AC4: **负控制（放行）**——同一个任务加上指名承载的后继 ⇒ **不报**（实跑输出贴任务体）。
      **AC3 与 AC4 缺一不可**：只证明能拦与「拦一切」同形
      **证据（同一 done-half + `## Carries from: done-half / acs: AC1, AC2, AC3, AC4` 的后继）**：
      ```
      task-ac-carryover: no blocked done tasks among 2 scanned (every done task's unchecked ACs have a named carrier)
      ```
- [x] AC5: **覆盖不全也要报**——后继只承载 8 条中的 5 条 ⇒ 报出缺失的 3 条编号
      **证据（8 条全未勾，后继只承载 AC1–AC5）**：
      ```
      unowned: done-partial — missing AC6, AC7, AC8 (8 unchecked total, carried: AC1, AC2, AC3, AC4, AC5)
      ```
- [x] AC6: 检查器**有执行者**（写明挂在哪、被真实触发过一次并贴输出）；「建议挂在 X」不算
      **证据**：挂在 `scripts/test.sh` 的 `run_static_checks`（与 `task-contract-check` 同址，
      第 5 个检查）。实跑 `QUAY_TEST_SKIP_DIST_BUILD=1 bash scripts/test.sh plugin/test/task-ac-carryover-check.test.mjs`
      （scoped，未自启全量）触发到它：
      ```
      == AC-carryover check (gap-nothing-checks-whether-a-done-task-left-its-acs-behind, AC6) ==
      task-ac-carryover: 2 BLOCKED done task(s) — 10 unchecked AC(s) with NO carrying successor
      ratchet ceiling: 10; new since baseline: 0
      ```
      全程 exit 0，测试 16/16 绿。CI 唯一测试步骤是 `bash scripts/test.sh` ⇒ CI 免费继承。
- [x] AC7: 存量基线化为只能变短的名单，基线数字与生成命令一并记录
      **证据**：`docs/analysis/task-ac-carryover-baseline.md`，**baseline-count: 10**，
      `DIR-124-A1a`（AC1–AC9 共 9 条）+ `gap-reverse-drift-check-buries-true-positives-in-noise`
      （AC2）。生成命令：`node --no-warnings --experimental-strip-types plugin/scripts/task-ac-carryover-check.ts --root . --write-ratchet`。
      名单只能变短：新增未基线的 unowned AC 会 exit 1（实跑确认）。
- [x] AC8: **本次实例回填**——`gap-session-liveness-heartbeat-freezes-for-the-whole-task` 与其后继
      `gap-session-liveness-stage-2-screen-signal-and-payload` 加上 `## Carries`，检查器对这一对**放行**
      **证据**：后继任务已加 `## Carries from: gap-session-liveness-heartbeat-freezes-for-the-whole-task
      / acs: AC9, AC10, AC11, AC12, AC13, AC14, AC14b`（正好覆盖前任务 7 条未勾 AC）。回填后实跑：
      ```
      unowned: 10 blocked: [DIR-124-A1a, gap-reverse-drift-check-buries-true-positives-in-noise]
      ```
      heartbeat 任务**不再出现在 blocked**——该对放行。
- [x] AC9: 测试用 `node:test` 且带 `// @test-group governance`
      **证据**：`plugin/test/task-ac-carryover-check.test.mjs` 文件头 `// @test-group governance`，
      全部 `node:test`；`test-framework-policy-check` 实跑 PASS（168 glob 文件，34 豁免，未增长）。

## Definition of Done

- [x] AC3 与 AC4 两个方向的实跑输出都贴进任务体——
      **一个只会拦的检查器与一个拦一切的检查器不可区分**
      **证据**：AC3（拦）与 AC4（放行）的实跑输出已贴进各自 AC 条目——同一任务有/无承载后继
      两个方向都在 `plugin/test/task-ac-carryover-check.test.mjs` 里 pin 住（16 测试绿）。
- [~] 完整套件连跑 2 次全绿——**按外层纪律未自启全量套件**（全量由协调方 fan-in 承担，本仓已有
      三次 `[~]` 先例）；scoped `bash scripts/test.sh plugin/test/task-ac-carryover-check.test.mjs`
      **连跑 2 次全绿**（含 run_static_checks 里新挂的 AC-carryover 检查，exit 0）
- [x] 任务体记录：触发它的是**外层自己的一条指令**（「关掉它、阶段二重新注册」只有前半是动作），
      **不是内层漏做**
      **证据**：本任务 Proposal 与 Dispatch review 已记录该归属（17:02Z 外层发指令、外层认领），
      AC8 的回填正是这条指令的「后半」——给阶段二补上承载关系，让检查器对这一对放行。

## Touches

- plugin/scripts/task-ac-carryover-check.ts
- plugin/test/task-ac-carryover-check.test.mjs
- docs/analysis/task-ac-carryover-contract.md
- docs/analysis/task-ac-carryover-baseline.md
- scripts/test.sh
- tasks/gap-session-liveness-stage-2-screen-signal-and-payload.md

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

## 完成记录（2026-08-03，fast mode）

**实现（worktree `task/gap-nothing-checks-whether-a-done-task-left-its-acs-behind`）**：
1. `plugin/scripts/task-ac-carryover-check.ts` — 判据按 AC1–AC9 落地：
   「done 时若有未勾 AC，则必须存在指名承载它们的后继，未承载即拦」；`--json` 输出
   `unowned`（未被承载的未勾 AC 计数）+ `blocked`（被拦任务数组）。位置解析 `## Carries`
   的 `from:`/`acs:`，散文不算。只勾带 `AC<n>` id 的 box；无 id 的未勾 box 记为 `unnamed`
   （info，不拦——机制无法指名它们）。
2. `plugin/test/task-ac-carryover-check.test.mjs` — 16 个 node:test 全绿：
   AC1 解析、AC2 json 形状、**AC3 拦 / AC4 放行 / AC5 覆盖不全报缺失编号**（双向负控制），
   外加 AC7 棘轮（写基线、增长 exit 1、收缩 resolved、reset 重锚）与子集模式。
3. `scripts/test.sh` `run_static_checks` 挂第 5 个检查（AC6 执行者）——CI 唯一测试步骤就是
   `bash scripts/test.sh`，CI 免费继承。
4. `docs/analysis/task-ac-carryover-contract.md`（AC1 形状单源）+ `docs/analysis/
   task-ac-carryover-baseline.md`（AC7 棘轮，baseline-count: 10）。
5. AC8 回填：`gap-session-liveness-stage-2-screen-signal-and-payload` 加 `## Carries`
   `from: gap-session-liveness-heartbeat-freezes-for-the-whole-task / acs: AC9, AC10, AC11, AC12,
   AC13, AC14, AC14b`（正好前任务 7 条未勾 AC）。回填后实跑：heartbeat 不再 blocked。

**棘轮语义**（与 task-contract-check 的契约棘轮同形）：`--write-ratchet` 建立/收缩基线；
新增未基线的 unowned AC ⇒ exit 1（run_static_checks 里 `set -euo pipefail` 会红掉一次提交）；
`--reset-baseline` 是标准变更后的一次性重锚。**存量不一次性阻断**。

**未做（按外层纪律 + 本仓先例）**：完整套件连跑 2 次——scoped 已绿，全量由协调方 fan-in 承担
（DoD 第 2 条标 `[~]`）。不改 `task-status-drift-check`（判代码落地，与本判据是两件事，合并会互相掩盖）。
