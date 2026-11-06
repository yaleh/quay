---
id: gap-routine-semantic-dedup-scan-readtasks-duplicate
title: "semantic-dedup-scan: the first two carry the same tasks/<id>.md to
  {id,body} reader (vanished-id skip) while a canonical single-task parser
  already exists in task-schema.ts; the th"
status: needs-human
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
the first two carry the same tasks/<id>.md to {id,body} reader (vanished-id skip) while a canonical single-task parser already exists in task-schema.ts; the third is a different bulk projection and is not a superset

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793943196283` · ts `2026-11-06T05:33:16.283Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readTasks`
- 涉及文件：
- `plugin/scripts/inner-wakeup-heartbeat-check.ts:556`
- `plugin/scripts/ready-pool-check.ts:4131`
- `plugin/scripts/long-term-guarantee-goal-backed-check.ts:106`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-06T05:33:16.283Z

## Resolution
（2026-11-06，派发链 worker 执行；按 Requested action **修掉**，⛔ 不是「已注意到」结案）

**这是第 4 次复发**：同一条 finding（`symbols:readtasks`，两个 id-set 读取器）在 `.quay/routine-findings.jsonl`
里已被立案 4 次 —— 2026-10-04（`near-33`）、2026-10-10（`readtasks-innerwakeup-readypool`）、2026-10-13
（`read-tasks-and-decl-block`）、2026-11-06（`readtasks-duplicate`，本任务）。前三次都以 `extract` 结案而两份
拷贝仍在原地 ⇒ 下一轮扫描必然再看见它们。所以本次处置的判据不是「改了一处」，而是**树里只剩一处**。

- 新**唯一**定义 `plugin/scripts/task-body-by-id.ts`：`readTaskBodiesById(tasksDir, ids)`，契约写在头注释里
  （保输入顺序 / 缺失 id 跳过而非报错 / `body` 是**未解析的原文**、frontmatter 保留 / 文件在但读失败则抛，
  不与「不存在」同形）。
- `plugin/scripts/inner-wakeup-heartbeat-check.ts`（`runMachineSlotRefill`）与
  `plugin/scripts/ready-pool-check.ts`（`main`）**删除各自的 `readTasks` 闭包**，改为 import 同一函数
  ⇒ 两侧喂给 slot-refill 的 in-flight / closed-but-live 视图不再可能一次编辑只落一边（AC53 结束不变式闸
  比较的正是这两个输入）。
- **第三个 `readTasks` 不合并**：`long-term-guarantee-goal-backed-check.ts:106` 是**全 store 的批量投影**
  （产出 `DeliveryCriticalTaskLike[]`：labels + goal_ac + filedAtMs），不是 id 集合读取器、也不是它的超集
  —— finding 原文如此。合并会给出一个带两套无关联契约的函数。它是**命名碰撞**（扫描按符号名 `readTasks`
  聚类才会一直把它们放进同一簇），不是重复，故**未改动该文件**。
- `plugin/test/task-body-by-id.test.mjs`：**行为半边**（顺序 / 缺失 id / 空集与缺失目录的实测零 / 原文不解析）
  ＋**结构半边**（`a vanished id is not a failure` 标记与 `export function readTaskBodiesById(` 在
  `plugin/scripts` + `packages/*/src` 两面上**各只命中 1 个文件**；两个消费者都必须 import 且不得再局部声明）。
  结构半边做**负控制**：把标记串临时追加回 `ready-pool-check.ts` ⇒ 该断言转红（exit 非 0），还原后转绿。
- `plugin/scripts/capability-catalog-declarations.json`：新脚本的 6 张声明表（QUESTION / CADENCE /
  INVALIDATION / LAST_REAFFIRMED / MATCHING / CONSUMER）—— 新 `.ts` 进 `plugin/scripts` 若未声明会被 AC1c 闸
  判为 unclassified。

实跑读数（本任务 worktree，2026-11-06）：
- `node --test plugin/test/task-body-by-id.test.mjs` ⇒ `tests 5 / pass 5 / fail 0`（结构半边 64.6ms，单趟扫描两面包）。
- 负控制：注入 `a vanished id is not a failure` 到 `ready-pool-check.ts` ⇒ `pass 3 / fail 2`（结构与 import 两条
  同时红）；`cp` 还原后 5/5 绿。
- `node --test plugin/test/inner-wakeup-heartbeat-check.test.mjs plugin/test/inner-wakeup-heartbeat-check-ac53-cli.test.mjs plugin/test/slot-refill-s07.test.mjs` ⇒ `tests 77 / pass 77 / fail 0`。
- 两个消费者 CLI 冒烟：`--help` 各 exit 0。
- `bash plugin/scripts/capability-catalog.sh --summary` ⇒ `414 scripts | 414 declared | 0 unclassified | 407 ship`。
- 残留计数（按位置，非关键词）：`grep -c 'readTasks' plugin/scripts/inner-wakeup-heartbeat-check.ts` = 0、
  `... ready-pool-check.ts` = 0；标记串在两面上的命中文件数 = 1（本模块）。

## Dark-axis record (ADR-007)
- L_D: valueSccs=0 typeSccs=0 reverseEdges=0 kernelViolations=0（`node --no-warnings --experimental-strip-types plugin/scripts/import-graph-check.ts` 实跑，2026-11-06，本 worktree；files=559 edges=1725 value=1566 type=159，新增的本模块无回边）

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `readtasks-duplicate`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793943196283`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/inner-wakeup-heartbeat-check.ts`
- `plugin/scripts/ready-pool-check.ts`
- `plugin/scripts/long-term-guarantee-goal-backed-check.ts`
- `plugin/scripts/task-body-by-id.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/task-body-by-id.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-readtasks-duplicate.md`

## Blocker

**2026-11-06T09:32:59.978Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: incomplete suite (637/637 files) — recovery exhausted at floor concurrency 16 — no declared rung produced a complete verdict (16); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：bb873060-7039-4624-8ee0-c1ace4c2fb26
