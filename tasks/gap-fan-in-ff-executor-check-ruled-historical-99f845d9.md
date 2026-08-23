---
id: gap-fan-in-ff-executor-check-ruled-historical-99f845d9
title: fan-in-ff-executor-check 加 ruled 豁免表承载 99f845d9 的应急主线程 fan-in（manager 裁定 ruled one-off）
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

**现象（实测）**：outer 为解红#4 应急走 fan-in 落地 `gap-direct-to-develop-ruled-historical-99f845d9`，fan-in-ff-merge.sh **未传 `--agent-id`**（outer 是主会话非 subagent，AC67/AC78 判据2(c) 本就是拦截这种形态）⇒ `fan-in-ff-executor-check.ts` 报：
```
check: agent-id-lock-events  ok:false  reason: main-thread-executor-record（5 条 violation 全指向 ruled-historical-99f845d9）
check: agent-id-retry-record ok:false  同上
```
**性质**：这是 manager 授权「你自己直接走 fan-in 落地」应急动作的必然副作用——是授权把 outer 推进了这个 checker 本该拦的场景，⛔ 非 outer 操作有错。同 99f845d9 一类的 ruled one-off。

**修法（⛔ 不能直提 develop，第五次踩红链）**：`fan-in-ff-executor-check.ts` 现无豁免表。加一个 **ruled 豁免表**（同 `direct-to-develop-bypass-check.ts` 的 `RULED_HISTORICAL_COMMITS` 形态），把 `task=gap-direct-to-develop-ruled-historical-99f845d9` 的 lock-events / retry-record 登记为 ruled one-off。

**定案理由（⛔ 原话入表）**：manager 授权的应急 fan-in——outer 主会话直接落地红#4 的止损动作，非常规主线程绕过 subagent；该形态本轮后不应再发生（正确路径是让 worker-driver 正常派发 subagent fan-in）。

**⛔ 本任务的落地路径**：必须由**普通 worker 走正常 subagent fan-in**（`--agent-id` 正常传，走 worker-driver 正常派发）——⛔ 不是 outer 主线程直接改。这样落地本身不触发它要修的那条 `main-thread-executor` 形态，验证「红链」真的断了。

## Plan

1. 读 `fan-in-ff-executor-check.ts` 的 `checkRecords`（判据2）与 `agent-id` 判定（:73）。
2. 加 ruled 豁免表（`RULED_HISTORICAL_TASKS`，{taskId, reason}，先例 `RULED_HISTORICAL_COMMITS`），`checkRecords` 命中该表 → 分类 ruledHistorical（非 main-thread-executor）。
3. 判据能取假：ruled-historical-99f845d9 → 豁免；真 main-thread-executor（无豁免）仍红。
4. 既有测试全绿 + 走正常 subagent fan-in land（⛔ 非直提）。

## Acceptance Criteria

- [ ] AC1：`gap-direct-to-develop-ruled-historical-99f845d9` 的 lock-events/retry-record 分类为 ruledHistorical（非 main-thread-executor，输出可区分）。
- [ ] AC2（能取假）：真 main-thread-executor 记录（无豁免，agentId 缺失或=主会话 id）仍红。
- [ ] AC3：既有测试全绿 + 经正常 subagent fan-in land（⛔ 非 outer 主线程直提）。

## Definition of Done

- [ ] fan-in-ff-executor-check 加 ruled 豁免表承载 99f845d9 应急 fan-in，ruledHistorical 分类可区分，真主线程执行者仍红，测试绿，正常 subagent fan-in land。

## Retires

- 无

## Touches

- plugin/scripts/fan-in-ff-executor-check.ts（加 ruled 豁免表 + checkRecords 命中分类）
- plugin/test/fan-in-ff-executor-check.test.mjs（test）
- tasks/gap-fan-in-ff-executor-check-ruled-historical-99f845d9.md（自身）
