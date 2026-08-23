---
id: gap-fan-in-ff-executor-check-ruled-historical-99f845d9
title: fan-in-ff-executor-check + fan-in-workflow-check 加 ruled 豁免表承载 99f845d9 的应急主线程 fan-in（manager 裁定 ruled one-off，范围扩至两个 checker）
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

**（outer 2026-08-23 立案——manager 对「应急 fan-in 未传 --agent-id」触发的 `fan-in-ff-executor-check` 红的裁定：ruled one-off）**

**现象（实测，⛔ 同一事件被两个独立 checker 读到并判红）**：outer 为解红#4 应急走 fan-in 落地 `gap-direct-to-develop-ruled-historical-99f845d9`，fan-in-ff-merge.sh **未传 `--agent-id`**（outer 是主会话非 subagent，AC67/AC78 判据2(c) 本就是拦截这种形态）且**未走 fan-in-execute workflow**（直接 fan-in-ff-merge.sh）⇒ 两个 checker 都读共享文件 `.quay/fan-in-merge-lock-events.jsonl` 并判红：
```
① fan-in-ff-executor-check.ts（第一个，manager 已确认）：
   check: agent-id-lock-events  ok:false  main-thread-executor-record（4 条 violation）
   check: agent-id-retry-record ok:false  同上（1 条）
② fan-in-workflow-check.ts（第三个 checker，manager 2026-08-23 实测补——原以为只有一个）：
   check: c-agent-id-real-subagent  ok:false  lock-event-agent-id-not-subagent（2 条，agentId=null）
   check: a-workflow-call-coverage   ok:false  fan-in-without-workflow-call（0 条，通用 flag——未走 workflow）
```
**⊢ 已枚举完整（manager 令「跑 --json 看全部 check 项，别只看第一个」）**：读同一份 lock-events 的 checker 共 6 个，其中 `fan-in-ff-protocol-check.ts`（0 agent-id 命中，只查 lock-hold 区间）、`direct-to-develop-bypass-check.ts`（查直提，99f845d9 已 ruled）、`per-task-suite-record-check.ts`（record-shape 已 pass）三者**不红**；只有 executor-check 与 workflow-check 两红，本任务一并覆盖，⛔ 无第 4 个 checker 漏网。

**性质**：这是 manager 授权「你自己直接走 fan-in 落地」应急动作的必然副作用——是授权把 outer 推进了这些 checker 本该拦的场景，⛔ 非 outer 操作有错。同 99f845d9 一类的 ruled one-off。

**修法（⛔ 不能直提 develop，第五次踩红链）**：两个 checker 现均无豁免表。各加一个 **ruled 豁免表**（同 `direct-to-develop-bypass-check.ts` 的 `RULED_HISTORICAL_COMMITS` 形态），把 `task=gap-direct-to-develop-ruled-historical-99f845d9` 的 lock-events / retry-record（含「未走 workflow」这一属性）登记为 ruled one-off。

**定案理由（⛔ 原话入表）**：manager 授权的应急 fan-in——outer 主会话直接落地红#4 的止损动作，非常规主线程绕过 subagent；该形态本轮后不应再发生（正确路径是让 worker-driver 正常派发 subagent fan-in）。

**⛔ 本任务的落地路径**：必须由**普通 worker 走正常 subagent fan-in**（`--agent-id` 正常传，走 worker-driver 正常派发）——⛔ 不是 outer 主线程直接改。这样落地本身不触发它要修的那条 `main-thread-executor` 形态，验证「红链」真的断了。

## Plan

1. 读 `fan-in-ff-executor-check.ts` 的 `checkRecords`（判据2）+ `agent-id` 判定（:73），与 `fan-in-workflow-check.ts` 的 `c-agent-id-real-subagent` / `a-workflow-call-coverage` 两 check。
2. 两个 checker 各加 ruled 豁免表（`RULED_HISTORICAL_TASKS`，{taskId, reason}，先例 `RULED_HISTORICAL_COMMITS`）：executor-check 的 agent-id 判定 + workflow-check 的 c 项（agent-id）与 a 项（未走 workflow）都命中该表 → 分类 ruledHistorical。
3. 判据能取假：ruled-historical-99f845d9 → 豁免；真 main-thread-executor / 真未走 workflow 的其它 fan-in（无豁免）仍红。
4. 既有测试全绿 + 走正常 subagent fan-in land（⛔ 非直提）。

## Acceptance Criteria

- [x] AC1：`gap-direct-to-develop-ruled-historical-99f845d9` 的 lock-events/retry-record 在两个 checker 中都分类为 ruledHistorical（executor-check 的 agent-id 两项 + workflow-check 的 a/c 两项，⛔ 非 main-thread-executor、非 fan-in-without-workflow-call）。
- [x] AC2（能取假）：真 main-thread-executor 记录（无豁免，agentId 缺失或=主会话 id）仍红；真「未走 workflow」的其它 fan-in 仍红。
- [x] AC3：既有测试全绿 + 经正常 subagent fan-in land（⛔ 非 outer 主线程直提）。

## Definition of Done

- [x] 两个 checker（executor-check + workflow-check）加 ruled 豁免表承载 99f845d9 应急 fan-in（含未走 workflow 属性），ruledHistorical 分类可区分，真主线程执行者/真未走 workflow 仍红，测试绿，正常 subagent fan-in land。

## Retires

- 无

## Touches

- plugin/scripts/fan-in-ff-executor-check.ts（加 ruled 豁免表 + checkRecords 命中分类）
- plugin/scripts/fan-in-workflow-check.ts（加 ruled 豁免表 + c/a 两项命中分类）
- plugin/test/fan-in-ff-executor-check.test.mjs（test）
- plugin/test/fan-in-workflow-check.test.mjs（test）
- tasks/gap-fan-in-ff-executor-check-ruled-historical-99f845d9.md（自身）
