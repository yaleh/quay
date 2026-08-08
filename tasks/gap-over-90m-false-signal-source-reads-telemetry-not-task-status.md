---
id: gap-over-90m-false-signal-source-reads-telemetry-not-task-status
title: detectTaskOver90m reads telemetry bracket start (never task status) — 3rd
  false OVER90 tonight (phantom in-flight from crash, worktree 0-commit dead,
  process gone); add task-status gate (ready/done never triggers) + reconcile
  criterion fix (worktree existence ≠ mid-flight)
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**假 OVER90 第三次复发（2026-08-05 11:00Z，管理者报告 + 外层核实）**：inner 又因
`task-over-90m` 停下等裁定，但任务是 **phantom in-flight**——`gap-loop-has-no-os-level-anchor`
和 `gap-web-board` 的执行 agent 死于第四次全灭（09:2xZ kill-server），worktree 近两小时零变化
（0 提交、os-anchor mtime 09:11/web-board 09:12）、无相关进程。它们的 in-progress bracket
永远不会闭合（闭合它的进程已死）。与 cold-start-key4（92min eaten）同型。

**根因（已提到 ROOT-CAUSE 级）**：`inner-blocked-signal.ts` 的 `detectTaskOver90m`（610 行）
读遥测 `rep.inProgress` 的 `startedAtMs`（615 行 `nowMs - p.startedAtMs > 90min`），**从不核对
任务自身 status**。崩溃遗留 bracket 让任务永远显示 in-progress → 假 OVER90 → inner 停等裁定
→ 外层不消费 → 全线停派发。今晚三次：48min + 27min + 本次。命中已立案的
`gap-a-crash-leaves-phantom-in-flight-tasks...`（--reconcile 机制存在，但 reconcile 因 worktree
存在而保留 phantom——判据缺陷）。

**为什么遥测与任务 status 矛盾**：`--task-start`/`--task-end` 括号由执行者打点，崩溃时
`--task-end` 永不发生，bracket 永久悬置。**括号在飞 ≠ subagent 在飞 ≠ 任务在跑**（fast-mode
内已拆三种含义）。而 `detectTaskOver90m` 把 bracket 在飞直接当任务在跑。

**最小止血（不需要等括号机制重构，能立刻消掉整类假信号）**：
生成 task-over-90m 信号前，**先读任务文件的实际 status 字段**——status 是 `ready` / `done`
的任务（或无活跃 subagent、worktree 已清）不该被判为 in-progress 超时。只有 status 真实
`in-progress`（或等价语义）且 bracket 超 90 分钟才触发。

### 选定机制

1. `detectTaskOver90m` 增加**任务 status 比对**：遥测 inProgress 的超时候选，先读
   `tasks/<id>.md` 的 `status` 字段——`ready`/`done`/`needs-human` 则跳过（不触发）；
   只有 status 是 `in-progress`（或任务文件缺失时按 bracket 继续）才触发
2. 保留 bracket 作为「何时开始的」来源，但**status 作为「是否真在跑」的闸**——两者都真才触发
3. 测试覆盖：构造「status=ready + 超 90min bracket」⇒ 不触发（负控制，当前会误触发）；
   「status=in-progress + 超 90min bracket」⇒ 触发（正控制）

## Acceptance Criteria

- [x] AC1: `detectTaskOver90m` 对 status=ready 的超时 bracket 不触发（负控制，复现今晚形态）
- [x] AC2: status=in-progress（或任务文件缺失）的超时 bracket 仍触发（正控制，真超时不漏）
- [x] AC3: 测试覆盖两种形态 + 今晚复发案例（os-anchor 的 ready+超时 bracket）
- [x] AC4: 与 `gap-a-crash-leaves-phantom-in-flight-tasks-and-the-one-signal-that-fires-is-documented-backwards` 交叉标注（reconcile 判据缺陷——worktree 存在不等于 mid-flight，应有 mtime/进程佐证）

## Definition of Done

- [x] AC1-AC4 全勾（detectTaskOver90m 对 status=ready 超时 bracket 不触发负控制；status=in-progress 仍触发正控制；测试覆盖两形态 + os-anchor 复发案例；与 phantom-in-flight 任务交叉标注）
- [x] 复现 os-anchor ready+超时 bracket 形态不再报 false over-90m；真超时仍报
- [x] scoped 门 `scripts/test.sh --for-task gap-over-90m-false-signal-source-reads-telemetry-not-task-status` 绿

## Definition of Done

- [ ] AC1-AC4 全勾（detectTaskOver90m 对 status=ready 超时 bracket 不触发负控制；status=in-progress 仍触发正控制；测试覆盖两形态 + os-anchor 复发案例；与 phantom-in-flight 任务交叉标注）
- [ ] 复现 os-anchor ready+超时 bracket 形态不再报 false over-90m；真超时仍报
- [ ] scoped 门 `scripts/test.sh --for-task gap-over-90m-false-signal-source-reads-telemetry-not-task-status` 绿

## Touches
- tasks/gap-over-90m-false-signal-source-reads-telemetry-not-task-status.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/scripts/inner-blocked-signal.ts
- plugin/test/inner-blocked-signal.test.mjs
- tasks/gap-a-crash-leaves-phantom-in-flight-tasks-and-the-one-signal-that-fires-is-documented-backwards.md（AC4 交叉标注）
- tasks/gap-cold-start-ac8c-key4-teaches-superseded-send-keys-hash.md（AC3 交叉标注，同型案例）

## Contract

measure   false_over90 = `node --test plugin/test/inner-blocked-signal.test.mjs 2>&1 | grep -c '✖'` stdout 数字段
band      false_over90 = 0（负控制不误触发后无失败）
invoke    `node --test plugin/test/inner-blocked-signal.test.mjs`
control   构造 status=ready + 超 90min bracket ⇒ 不触发（AC1）；status=in-progress ⇒ 触发（AC2）
resume    判据源改动与测试分两步提交，任一步完成即写盘

## Evidence

**实现（判据源）**：`plugin/scripts/inner-blocked-signal.ts` 新增 `readTaskStatus(root, taskId)`
（读 `tasks/<id>.md` 的 YAML frontmatter `status` 字段）与 `taskStatusAllowsOver90m(root, taskId)`
闸：任务文件 status 为 `in-progress` 或文件缺失才允许 over-90m 触发；status 为
`ready`/`done`/`needs-human` 等非 in-progress 值一律跳过。`detectTaskOver90m` 在 reconcile 过滤后
叠加该闸（`nowMs - p.startedAtMs > TASK_OVER_90M_MS && taskStatusAllowsOver90m(root, p.taskId)`），
evidence 文本更新为 `(reconcile-aware + task-status gate)`。

**测试（`plugin/test/inner-blocked-signal.test.mjs`，node:test + `// @test-group governance`）**：
- AC1 负控制：`status=ready` + 91min 陈旧 bracket ⇒ `--detect-stop` 不写 block（`gap-os-anchor` 今晚形态）
- AC2 正控制：`status=in-progress` + 91min bracket ⇒ 写 block，`reason: task-over-90m`
- AC2 正控制（文件缺失）：无 `tasks/<id>.md` + 91min bracket ⇒ 仍写 block（bracket 唯一信号，fail-closed 朝触发）
- AC3 复发案例并排：`status=ready` 陈旧 bracket 与 `status=in-progress` 真超时同场 ⇒ 只对 in-progress 触发
  （block `taskId` 为 `gap-real-over`，非 os-anchor）

**实跑**：`node --test plugin/test/inner-blocked-signal.test.mjs` → tests 35 / pass 35 / fail 0 /
cancelled 0（新增 4 条全绿，原 31 条无回归）。

**交叉标注**：`tasks/gap-a-crash-leaves-phantom-in-flight-tasks-and-the-one-signal-that-fires-is-documented-backwards.md`
（AC4——reconcile 判据缺陷：worktree 存在 ≠ mid-flight，应有 mtime/进程佐证；报告侧判据修正留作后续）；
`tasks/gap-cold-start-ac8c-key4-teaches-superseded-send-keys-hash.md`（AC3——92min-eaten 同型案例）。

## Dispatch review

reviewer: none
at: 2026-08-05T18:2xZ
changed: contract-ratchet compliance，外层 18:2xZ 补齐（未审）
