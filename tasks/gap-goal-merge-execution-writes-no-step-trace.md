---
id: gap-goal-merge-execution-writes-no-step-trace
title: goal→develop 的并入执行不写 fan-in 步骤轨迹——真实大小的并入慢在哪一步、红在哪一步都读不到，只有请求→结果的整段时间戳
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-325
---
## Proposal

**机制**（2026-10-05/06，GOAL-905 第二次合并演练读到）：任务 fan-in 经 `appendFanInStepTrace`（`plugin/scripts/worker-fan-in.ts:596` 起）把每一步写成 `step-begin` / `step-end`（`step-end` 自带 `durationMs`）到 `.quay/fan-in-step-trace.jsonl`；而 goal→develop 的并入执行 `runGoalMergeFanIn`（`:2513` 起）**不写这条轨迹**。GOAL-905 的并入前后共 6 次尝试，`grep GOAL-905 .quay/fan-in-step-trace.jsonl` 零行；能读到的只有 `goal-merge-request` 与 `goal-merge-result` 两条事件的时间戳，所以只能反推「请求→结果」的整段耗时（如 2026-10-05T16:17:51Z → 16:23:36Z 约 5 分 45 秒；18:22:52Z → 18:26:02Z 约 3 分 10 秒），**读不到 merge、typecheck、scoped 门、suite、ff 各自用了多久**，红了也只有最终那个 `step` 字段。

**后果**：真实大小的并入（本例 24 个文件、60 个新提交）到底慢在哪一步，没有直接量；并入因资源红（例如根分区 ENOSPC，2026-10-06 同一批尝试里读到）时，无法从轨迹上看出是哪一步开始写盘失败。

**修法（方向，实现者可调）**：并入执行的每个步骤（读 develop、建临时 worktree、合并、anti-drift、typecheck、scoped 门、suite、ff、清理）都经同一个 `appendFanInStepTrace` 写 begin/end，`step-end` 带 `durationMs`。`task` 字段放 GOAL id，并加一个可 grep 的判别键（如 `kind: "goal-merge"`），使以 `task` 为键的聚合不会把 goal 当成任务。⚠️ 该载体的现有读者必须先核对、必要时加跳过：`plugin/scripts/instrument-decay-check.ts`、`plugin/scripts/runner-static-gate.ts`（`goal-driver.ts` 的命中是否只在注释里，也请确认，DIR-131 不允许 goal-driver 读本仓落地载体）。

## AC

- [ ] `plugin/test/worker-driver.test.mjs` 的 goal 并入端到端用例（临时仓库，注入可控的 suite 结果）新增断言：一次成功的并入在 `.quay/fan-in-step-trace.jsonl` 里为每个实际执行的步骤各写一对 `step-begin` / `step-end`，`step-end` 带数值型 `durationMs`，且这些条目带 `kind: "goal-merge"`；一次 suite 红的并入，轨迹里最后一个 `step-end` 是 suite 且 `ok: false`。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 5b 邻近扫描：`grep -rln 'fan-in-step-trace' plugin/scripts packages/quay/src` 目前命中 `plugin/scripts/instrument-decay-check.ts`、`plugin/scripts/goal-driver.ts`、`plugin/scripts/runner-static-gate.ts`、`plugin/scripts/worker-fan-in.ts`；逐个判断：它按什么键读、写入 goal 条目后会不会被计成任务（贴出会话里实际跑过的验证：喂一份含 goal 条目的轨迹，其输出与不含时一致）；需要且在 Touches 内的一并改。
- [ ] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（DIR-131；⚠️ 注释里出现该类字样也会被判红）。
- [ ] `node --test plugin/test/worker-driver.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，一次真实的 goal 并入在 `.quay/fan-in-step-trace.jsonl` 里留下各步骤的 `durationMs`，可以直接读出并入慢在哪一步；既有以任务为键的轨迹读数不变。生产读数需要一次真实的 goal 并入才能取到；落地时可能没有，完成记录里须写明该读数是否已取得。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/instrument-decay-check.ts
- plugin/scripts/runner-static-gate.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-goal-merge-execution-writes-no-step-trace.md
