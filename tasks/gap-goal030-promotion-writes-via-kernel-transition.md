---
id: gap-goal030-promotion-writes-via-kernel-transition
title: GOAL-030 ②：ready-pool-check 的 todo→ready / ready→todo 两条写入改走 kernel
  转移决策并写事件（不碰 fan-in / needs-human）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal030-kernel-task-transition-and-status-event
goal_ac: AC-336
---
**type:** execution

## Proposal

GOAL-030 的第二块：把晋升路径上的两条任务状态写入改走 kernel 转移决策，并为每次实际落盘的转移写事件。**范围严格限于 `plugin/scripts/ready-pool-check.ts` 的这两处写入。**

两处写入（develop 现状）：
- `applyPromotions` → todo→ready（promote 边），每轮由 promotion-driver 以 `--apply` 调用；
- `applyRevaluations` → `retreatReadyToTodo`，ready→todo（retreat 边），只在 `ready-pool-check --revaluate-apply` 时执行（生产上目前没有任何驱动传这个参数）。

做法：
1. 两处都改为：先调用 kernel 的 `decideTransition(from, to)`；`allow` ⇒ 用 kernel 的 `patchStatusField` 改 frontmatter、写回文件，写成功后调用 `appendTaskStatusEvent(root, {taskId, from, to, kind, actor})`；`refuse` / `not-evaluated` ⇒ ⛔ 不写，把 `{id, from, to, verdict, reason}` 记入输出 JSON 的 `transition_refusals` 数组（⛔ 不静默跳过）。actor 分别为 `ready-pool-check --apply` 与 `ready-pool-check --revaluate-apply`。
2. 原有的提交与传播逻辑（`commitTaskStatus` / `commitTaskFile` / `propagateDocBranchToDevelop`）与输出字段 `applied_promotions` / `applied_revaluations` 的形状不变。
3. 本文件不再直接调用 `patchStatusField`（改为经 kernel 决策路径使用），并以行首 import 引入 `packages/quay/src/kernel/task-transition.ts`。
4. 新测试 `plugin/test/ready-pool-check-transition-writes.test.mjs`：用真 `.quay/config.yml` 建临时 workspace（裸 tasks 目录不是合法 workspace），种入可晋升的 todo 任务与一个四件套不全的 ready 任务，分别以 `--apply` 与 `--revaluate-apply` 运行本仓库的 `ready-pool-check.ts`，断言：状态翻转发生、事件条数与翻转数相等、事件的 kind 分别为 promote / retreat、事件只写在临时 workspace 的 `.quay/` 下。

⛔ 不改 `worker-fan-in.ts`、`driver-filters.ts`、`worker-driver.ts`；⛔ 不让 promotion-driver 新增 `--revaluate-apply` 调用。

## AC

- [ ] 本文件无直接写入且已接线：`grep -vE '^[[:space:]]*(//|\*|/\*)' plugin/scripts/ready-pool-check.ts | grep -cE 'patchStatusField\('` 输出 0，且 `grep -cE '^import [^;]*from "[^"]*kernel/task-transition\.ts"' plugin/scripts/ready-pool-check.ts` ≥ 1
- [ ] 范围护栏：`worker-fan-in.ts` 与 `driver-filters.ts` 的非注释 `patchStatusField(` 调用数仍为 4 与 2
- [ ] 新测试全绿：`scripts/test.sh plugin/test/ready-pool-check-transition-writes.test.mjs` exit 0
- [ ] 本任务 worktree 根运行 GOAL-030 的 AC-336 判据（`quay goal show AC-336` 的 criterion，用 bash 执行）exit 0，完整输出进 Evidence
- [ ] 本任务的 scoped 门绿：`scripts/test.sh --for-task gap-goal030-promotion-writes-via-kernel-transition` exit 0（⛔ 不接受 `--allow-thin` 的空选择绿）
- [ ] 负对照：cp 备份 `ready-pool-check.ts` 后临时删掉 `applyPromotions` 里的事件写入调用，重跑新测试必须 exit 非 0；还原后 exit 0；两次 exit 码进 Evidence

## DoD

本任务经 goal/GOAL-030 分支落地，⛔ 不落 develop。落地后在 goal 分支 tip 上 AC-336 判据 exit 0。Evidence 贴出命令输出、负对照两次 exit 码、本任务派发记录的 mergeTarget。允许的两条转移其落盘结果与改动前一致（同一输入下 `applied_promotions` / `applied_revaluations` 不变），多出的只有事件行。

## Touches

- tasks/gap-goal030-promotion-writes-via-kernel-transition.md
- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check-transition-writes.test.mjs
- plugin/test/ready-pool-check-s11.test.mjs

## 停放说明

本任务以 needs-human 状态立案，用于停放：在 GOAL-030 激活且 `goal/GOAL-030` 分支存在之前，⛔ 不得被派发。由立案会话在核验分支存在后改回 todo；依赖顺序由 frontmatter 的 depends_on 表达。
