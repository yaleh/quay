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
      **invoke 证据**（`bash scripts/test.sh --for-task gap-over-90m-false-signal-source-reads-telemetry-not-task-status`，
      tests 36 / pass 36 / fail 0 / cancelled 0，全文贴于下方「作用域测试输出」）：
      新增测试 `AC1 — task-status gate: status=ready + >90m bracket does NOT fire over-90m (negative
      control, reproduces tonight's phantom shape)`——写 `tasks/gap-os-anchor.md` status=ready + 91min
      悬置 bracket，`detectTaskOver90m` 返回 null、`--detect-stop` 不写 block（`no stop condition`）。
      `taskStatusAllowsOver90` 单测矩阵：ready/done/needs-human/todo ⇒ drop，in-progress ⇒ keep。
- [x] AC2: status=in-progress（或任务文件缺失）的超时 bracket 仍触发（正控制，真超时不漏）
      **invoke 证据**：新增两条正控制——`status=in-progress + 91min bracket` ⇒ 仍写 block（reason
      task-over-90m）；`task file MISSING + 91min bracket` ⇒ 仍触发（缺文件时无法核对 status，fail 向
      旧行为——真超时永不静默丢失）。
- [x] AC3: 测试覆盖两种形态 + 今晚复发案例（os-anchor 的 ready+超时 bracket）
      **invoke 证据**：上述负/正控制 + os-anchor 形态（`gap-os-anchor` status=ready + 91min bracket ⇒
      不触发）均落在 `plugin/test/inner-blocked-signal.test.mjs`（5 条新测试，`// @test-group
      governance`）；并在 `tasks/gap-cold-start-ac8c-key4-teaches-superseded-send-keys-hash.md`
      交叉标注同型案例（92min eaten：括号在飞 ≠ 任务在跑）。
- [x] AC4: 与 `gap-a-crash-leaves-phantom-in-flight-tasks-and-the-one-signal-that-fires-is-documented-backwards` 交叉标注（reconcile 判据缺陷——worktree 存在不等于 mid-flight，应有 mtime/进程佐证）
      **invoke 证据**：在该任务「二、崩溃对账」段写入交叉标注——`makeDefaultExecutorGone` 把
      「worktree 存在」当「执行者在跑」，但崩溃留下的 0 提交死 worktree 恰好满足该判据 ⇒ 幽灵保持
      kept、over-90m 仍误报；判据应加 mtime/进程佐证。本条 status 闸与 reconcile 互补。

### 作用域测试输出（AC1–AC4 实跑证据）

Contract `invoke`：`bash scripts/test.sh --for-task gap-over-90m-false-signal-source-reads-telemetry-not-task-status`
（EXIT=0）。静态作用域 tier（test-framework-policy-check PASS / test-isolation-check PASS /
test-impl-census clean / task-contract-check 无违规）＋ 36 测试全绿：

```
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
  scoped check: run_checker "test-framework-policy-check" ...
test-framework-policy-check — 233 glob file(s), 34 exemption(s)
PASS: every test file uses node:test or is a listed legacy exemption; exemption list is at/below the ratchet ceiling and did not grow; new files declare @test-group.
  scoped check: run_checker "test-isolation-check" ...
PASS: all 44 violation(s) are baselined in plugin/test-isolation-violations.txt; the list can only get SHORTER (no additions, no growth, no stale entries).
  scoped check: run_checker "test-impl-census-check" ...
test-impl-census: checked 233 test files · clean 233 · impl-deleted 0
  scoped check: run_checker "task-contract-check" ...
task-contract-check: no violations.
violations: 0 unique across 0 task(s); info findings (non-ratchet, pre-opt-in baseline): 0
strict-subset mode (scoped static-check tier) — a violation on a scanned task FAILS this run (exit 1)
== build dist/quay.js ... ==  ⚡ Done in 114ms
== build dist/quay-native.js ... ==  ⚡ Done in 102ms
== mirror vendored plugin dist (plugin/scripts/sync-vendor.sh --sync-dist) ==
✔ AC1 — the module defines the .quay/inner-blocked.json schema (BLOCKED_RECORD_SCHEMA)
✔ AC2 — VALID_BLOCKED_REASONS is exactly the inner layer's existing stop conditions
✔ AC4 — --assert-blocked writes .quay/inner-blocked.json with the full record
✔ AC4/AC7 — --clear emits a schema-valid blocked telemetry event into .workflow-events/
✔ AC7 — aggregate() reports blocked waits with cumulative and longest durations
✔ AC3 — the tick file requires assert-before-stop and clear-after-recovery
✔ AC4 — findSharedRoot resolves the SHARED (main) checkout even from inside a linked worktree
✔ AC1 — detectRulingRequiredStall is a no-op with no transcript config (never inferred)
✔ AC2/AC3 — --detect-stop --transcript writes ruling-required (real trigger: stale transcript + in-progress + clean tree)
✔ AC5 — a dirty working tree does NOT fire ruling-required even with a stale transcript + in-progress task
✔ AC4 — reverse negative control (real shape): a task in-progress 78 real minutes with a FRESH transcript must NOT be flagged
✔ AC1 — a fresh subagents/ file counts as activity even when the main transcript file is stale (busy delegating, not frozen)
✔ AC5 — --detect-stop without --transcript is byte-for-behavior unchanged (composite trigger never engages)
✔ AC6 — an auto ruling-required-stall block auto-clears once the transcript resumes (mirrors the existing auto-clear path)
✔ AC5 — --detect-stop with no stop condition produces no block file
✔ AC5 — a long in-progress task under the 90m budget does NOT produce a block
✔ AC1/AC2/AC6 — --detect-stop writes the block for a task-over-90m (real trigger path)
✔ AC1/AC6 — --detect-stop writes the block for a merge conflict (real trigger path)
✔ AC3 — --detect-stop keeps the block while the conflict persists and clears it once resolved
✔ AC3 — --detect-stop never auto-clears a manual (judgment) block; only --clear does
✔ AC4 — end-to-end: a stop condition produces the block and the outer reads the record (inner-state.sh retired)
✔ AC1 — task-status gate: status=ready + >90m bracket does NOT fire over-90m (negative control, reproduces tonight's phantom shape)
✔ AC2 — task-status gate: status=in-progress + >90m bracket STILL fires (positive control, real timeout not masked)
✔ AC2 — task-status gate: task file MISSING + >90m bracket STILL fires (fall back to bracket — genuine timeout never masked)
✔ AC1/AC3 — task-status gate: the non-running statuses ready/done/needs-human/todo all suppress over-90m; only in-progress fires
✔ AC1 — task-status gate unit matrix: taskStatusAllowsOver90 verdict per shape (missing → keep, in-progress → keep, else drop, unparseable → keep)
ℹ tests 36
ℹ suites 0
ℹ pass 36
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Contract `measure`（`node --test plugin/test/inner-blocked-signal.test.mjs 2>&1 | grep -c '✖'`）输出数字段：`0`（band false_over90 = 0 达成）。

## Touches

- tasks/gap-over-90m-false-signal-source-reads-telemetry-not-task-status.md
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
## Dispatch review

reviewer: none
at: 2026-08-05T18:2xZ
changed: contract-ratchet compliance，外层 18:2xZ 补齐（未审）
