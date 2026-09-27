---
id: gap-routine-semantic-dedup-scan-worktree-liveness-predicate-private
title: "semantic-dedup-scan: the dead-worktree predicate and its direct-quantity
  reader are byte-identical under two names because the source is
  module-private; the stated blocker only for"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
the dead-worktree predicate and its direct-quantity reader are byte-identical under two names because the source is module-private; the stated blocker only forbids editing the sibling, not extracting to a new leaf, and a divergence here silently flips dead to alive.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790503843524` · ts `2026-09-27T10:10:43.524Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`isDeadInFlightWorktree`、`isDeadMergeWorktree`、`lastCommitMsOfWorktree`
- 涉及文件：
- `plugin/scripts/concurrent-batch-scheduler.ts:350`
- `plugin/scripts/ready-pool-check.ts:542`
- `plugin/scripts/concurrent-batch-scheduler.ts:362`
- `plugin/scripts/ready-pool-check.ts:525`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract the predicate to a shared module and delete the copy

## Disposition
**处置 = 修掉（⛔ 不是「已注意到」）。**

复核确认：`isDeadInFlightWorktree`（`plugin/scripts/concurrent-batch-scheduler.ts`）与 `isDeadMergeWorktree`（`plugin/scripts/ready-pool-check.ts`）函数体逐字节相同，`lastCommitMsOfWorktree` 两处亦然。副本存在的唯一理由是源模块私有，而立案那次派发的 `## Touches` 不覆盖兄弟文件（硬规则 5b：修了一个实例，没修同族兄弟）。两条路径共用同一判据却各持一份实现 ⇒ 任一侧漂移都让「死」静默翻成「活」。

修法（commit `39b5f5b3e`）：把判据与其直接量读取器，从**已经持有共享阈值 `INFLIGHT_WORKTREE_STALE_MS`、且 ready-pool-check 已从其中 import 展开器**的那个模块 `plugin/scripts/concurrent-batch-scheduler.ts` **导出**，删掉 `plugin/scripts/ready-pool-check.ts` 里的副本、改为 import。`staleMs` 保持参数 ⇒ 将来若真要分道，是调用点选择，不是第二份函数体。⛔ 不新建 `plugin/scripts/*.ts`（capability-catalog 按 basename 派生，新文件需跨 ~10 张表声明）；⛔ 不新增 import 边（ready-pool-check → concurrent-batch-scheduler 的边早已存在且是本文件写明的 single-source 惯例）。

可核读数（定义点计数；扫描面 = 该探针 INVENTORY 的两个面 `plugin/scripts` + `packages/*/src`）：

- 命令：`grep -rn "^\(export \)\?function \(isDeadInFlightWorktree\|isDeadMergeWorktree\|lastCommitMsOfWorktree\)(" plugin/scripts packages/*/src`
- 修前：4 处 —— `concurrent-batch-scheduler.ts:350,362` + `ready-pool-check.ts:525,542`
- 修后：2 处 —— `concurrent-batch-scheduler.ts:359,375`（两个符号各只剩**一处**定义，全在一处）

零计数半边按硬规则 2 有对照：同一谓词在修前树上读 4（谓词非恒零），修后读 2；非零半边打印了命中行本身（即读数是「命中的是不是我要的」，不是关键词计数）。

行为不变：两条路径的既有判据测试在共享判据下全绿（证据见 AC/DoD）。漂移的常设探测器＝例程本身（`semantic-dedup-scan`，`.quay/config.yml` `interval:1440m` 重扫，源清单里已无同名双体）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `worktree-liveness-predicate-private`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790503843524`）所描述的问题被复核并处置 **Evidence: 复核＝定位到两对逐字节相同的函数体（`isDeadInFlightWorktree`/`isDeadMergeWorktree`；`lastCommitMsOfWorktree`）；处置＝提取到单一来源并删除副本 —— commit `39b5f5b3e`（`plugin/scripts/concurrent-batch-scheduler.ts` 导出两符号 + `plugin/scripts/ready-pool-check.ts` 删副本改 import）**
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 **Evidence: 修掉。读数可复跑：定义点计数 4→2 且两个符号各只剩一处定义（命令 + 前后读数 + 对照见 ## Disposition）；行为不变的实跑证据见 DoD 第一条**

## DoD
- [x] 上面的判据实跑通过 **Evidence: 读数命令实跑（4→2，命中行已打印）；行为不变由既有判据测试实跑确认 —— `node --test plugin/test/ready-pool-check-s20.test.mjs plugin/test/ready-pool-check-s21.test.mjs` 16/16 绿（含 `resolveMergeWorktreeSurfaces` 死/活两态与 `computeMergeWorktreeSurfaces` 两条 wiring）、`node --test plugin/test/concurrent-batch-scheduler.test.mjs` 10/10 绿（含 `computeInFlightWorktreeTouches` 死/活两态）；`bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-worktree-liveness-predicate-private --allow-thin` exit 0（55/55，fail 0 cancelled 0）；全量 suite 由 driver fan-in 验证（本 worker 不跑）**
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 **Evidence: 例程只写 `.quay/routine-findings.jsonl` + 机械立案（runId `semantic-dedup-scan-1790503843524`，filing-round 记录）；提取与删副本由派发链的 worker 在任务 worktree 内执行（commit `39b5f5b3e`），例程自身未执行任何修复动作**

## Touches
- `plugin/scripts/concurrent-batch-scheduler.ts`
- `plugin/scripts/ready-pool-check.ts`
- `tasks/gap-routine-semantic-dedup-scan-worktree-liveness-predicate-private.md`