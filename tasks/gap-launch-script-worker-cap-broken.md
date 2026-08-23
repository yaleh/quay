---
id: gap-launch-script-worker-cap-broken
title: promotion-driver-launch.sh --cap worker 路径 broken + worker 并发缺省设 5（对齐
  inner）+ 派发前 Touches 互斥检查
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：outer 按 manager 建议现场开 worker 并发（`quay driver restart --kind worker --cap 2`）撞到本 bug，worker-driver 停摆 2-3 分钟。

**bug（实测）**：`promotion-driver-launch.sh:354` `extra_args+=( "${KIND_CAP_FLAG[$KIND]}" "$CAP" )` 把 `--cap 2` 映射成驱动的 `--concurrency 2`，但 `:358` 把这行 extra_args 传给**supervisor 自重启**（`__supervise` 模式），而 `__supervise` 的 arg 解析只认 `--cap`（:154）不认 `--concurrency` ⇒ `unknown argument: --concurrency` ⇒ 旧 supervisor 被杀、新 supervisor 起不来 = driver 停摆。`:278`（supervisor 循环内把 `--concurrency` 传给**驱动**）是对的，错的是 `:354` 把驱动的旗标用在了【supervisor 自重启】上——自重启应传 `--cap`。

**并发缺省（对齐 inner=5，双重人裁定）**：worker 常驻并发现实际=1（`resolveConcurrency(undefined,0)` 兜底 `Math.max(1,0)`），不是设计意图、是没人配。目标值 **5**（非 2）——inner cap=5 是双重人裁定的既有先例（orchestrator-tick-core A6 人 2026-08-09、fast-mode-tick-core A10 人 2026-08-11「与 manager A2/outer A6 对齐」），不用重新论证。

**⛔ 机制缺口（manager 读码实测，cap=5 的前提）**：worker-driver 派发链**全链路零 Touches 感知**——`grep -i 'touches\|orthogonality' worker-driver.ts` 零命中。`readyPoolCheck()` 只减 status≠ready/fixture/parked/not-yet-flipped，`dispatchable_disjoint` 是独立指标**没用来筛 ready 数组**；`runSelectorWorker()` 给 LLM 的 prompt 只有任务 id 列表、无 Touches ⇒ selector 结构上不可能避开冲突；`parseSelectorOutput()` 兜底纯 shuffle 零 Touches 感知。**并发=1 时从没触发过「两任务同时跑」的场景，所以没炸；cap=5 后若池里同时有 2 条 Touches 重叠（今天的 Git History 群组 4 条全撞 `serve-handlers.ts` 就是活样本），会毫无阻拦并发派发 ⇒ 各改同一文件 ⇒ fan-in 才炸（且两边都 exit 0 看起来做完了，比 fake-completion 更难查）。⛔ 不指望 LLM selector 避开（它拿不到 Touches）。

**env 法已一次生效（⛔ 修正误报）**：`QUAY_MAX_TASK_SUBAGENTS=2` 已设进当前 driver（1819958）的 environ，并发现在=2。本条 AC2 是把「一次生效」变「持久缺省」——否则下次不带 env 重启又回 1。

## Plan

1. 修 `:354`：supervisor 自重启用 `--cap`（launch script 自己的旗标），⛔ 不用 `KIND_CAP_FLAG`（驱动的旗标）。
2. worker 并发缺省设 **5**：worker 分支 export `QUAY_MAX_TASK_SUBAGENTS=5`（或在无显式 --cap 时默认 CAP=5），⛔ 不写字面量到别处（定义点已在 worker-driver.ts:132）。
3. **派发前 Touches 互斥过滤（cap=5 的前提，必须与 AC2 同落）**：`spawnSelected` 前对 `running` 每个在飞任务 + 候选任务跑 `checkTouchesPair`（`ready-pool-check.ts` 已有同函数，不重实现），冲突候选直接从 `candidates` 滤掉，selector 只在滤后集合里选。

## Acceptance Criteria

- [x] AC1：`quay driver restart --kind worker --cap N` 成功（⛔ 不再 `unknown argument: --concurrency`），且驱动 argv/env 有 `--concurrency N` 或 `QUAY_MAX_TASK_SUBAGENTS=N`。
- [x] AC2：worker 无显式 --cap 时并发缺省=5（`resolveConcurrency` 读到 5，⛔ 仍兜底 1 ⇒ 假）。
- [x] AC3：派发前 Touches 互斥过滤生效——池中 2 条 Touches 重叠的任务时，worker 只派不相交的（⛔ 并发派发 Touches 重叠 ⇒ 假）；⛔ AC2 落地前必须同时落地 AC3（cap=5 无 Touches 检查会撞 serve-handlers.ts 群组）。

## Definition of Done

- [x] --cap 路径修复 + worker 并发缺省 5 + 派发前 Touches 互斥过滤 + restart 实测成功；AC1-3 全勾；land 到 develop。

## Retires

- 无

## Touches

- plugin/scripts/promotion-driver-launch.sh（:354 修 + worker 并发缺省 5）
- plugin/scripts/worker-driver.ts（spawnSelected 前 Touches 互斥过滤）
- plugin/test/promotion-driver-launch.test.mjs（test）
- plugin/test/worker-driver.test.mjs（test）
- tasks/gap-launch-script-worker-cap-broken.md（自身）
