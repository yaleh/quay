---
id: gap-goal-achieved-failing-folds-not-evaluated-into-red
title: quay goal check --achieved-failing 把 not-evaluated
  折成红：verdictFromAcceptance 只 import 不调用，exit 3/timeout 落 achievedButFailing，会在
  goal standings 立 phantom gap
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**atom H10**：判据读最新 run 派生字段、派生未算完 ⇒ underivable（NOT-EVALUATED 与红同形），不是假绿。

**carrier**：`code`（只承载了三态映射，消费侧丢弃）。

**carrierRef 目标**：`packages/quay/src/core/goal-store-checks.ts:211-213`。

**负臂读数（现在）**：`packages/quay/src/core/goal-store-checks.ts:15` 只 `import { runAcceptance, verdictFromAcceptance }` 而从不调用；`:212` 是 `if (!res.ok) achievedButFailing.push(String(ac.id))`。而 `verdictFromAcceptance`（`packages/quay/src/core/acceptance-runner.ts:121-140`）已经能区分 `pass / fail / not-evaluated(cause ∈ timeout|spawn|not-runnable|declared)`。⇒ exit 3（declared）、timeout、spawn 全被计成「已达成的判据红了」。

**危害**：`plugin/scripts/goal-driver.ts:427-434` 解析该 JSON，`:2294` 用 `achievedButFailing` 建 `standingFailing` 集合——也就是说这个折叠会在 goal standings 里**立 phantom gap**，是生产可见的错误事实，不只是读起来难看。

**同构先例（支持独立桶，不是新发明）**：同一函数已有第三桶 `capabilityRefused`，注释明写「"we would not run it" 是不同于 "we ran it and it is red" 的事实」。

**D 收缩预期**：H10 fresh→stale，|D| 14→13（⛔ 不作验收）。

## Plan

1. 改 `checkAchievedFailing`（`goal-store-checks.ts:150-220`）：每个 AC 的 `runAcceptance` 结果改用 `verdictFromAcceptance(res)` 三态分派——`fail` ⇒ `achievedButFailing`；`not-evaluated` ⇒ 新桶 `achievedNotEvaluated.push({ id, cause, reason })`；`pass` ⇒ 都不进。
2. 返回类型加 `achievedNotEvaluated: Array<{ id: string; cause: string; reason: string }>`，**与 `capabilityRefused` 同构**（含 `evaluated/scopeSize/inScope` 不变）。
3. 退出码（`packages/quay/src/core/goal-store.ts:2095`，现状 `return r.achievedButFailing.length === 0 && r.evaluated ? 0 : 1;`）**显式三态**：`achievedButFailing` 非空 ⇒ 1；**仅** `achievedNotEvaluated` 非空 ⇒ **不得为 0**（实现前先枚举已占用退出码——已知 0/1/3 被用——选一个未占用的并写进 `quay goal check --help`）；两者皆空且 `evaluated` ⇒ 0；`!evaluated` ⇒ 保持非 0。
4. gap 消费者排除：`plugin/scripts/goal-driver.ts:427-434` 的解析与 `:2294` 的 `standingFailing` 必须显式不受 `achievedNotEvaluated` 影响；若需要可见性，单独带出该桶，⛔ 不得并入 failing。

## Acceptance Criteria

- [ ] AC1: `verdictFromAcceptance` 被**真正调用**且三态生效——行为测试：criterion exit 3 ⇒ `achievedNotEvaluated(cause="declared")`；exit 1 ⇒ `achievedButFailing`；timeout ⇒ `achievedNotEvaluated(cause="timeout")`。负臂读数：改前 `grep -n verdictFromAcceptance packages/quay/src/core/goal-store-checks.ts` 只有 import 行命中（给出逐字输出）。
- [ ] AC2: `quay goal check --achieved-failing` 退出码**显式三态**并写进 `--help`——仅 `achievedNotEvaluated` 非空时退出码**不得为 0**；给出三条实测读数（红 / 仅未评估 / 全绿）。
- [ ] AC3: gap 消费者排除——列出 `goal-driver.ts` 的解析点与 `standingFailing` 点；负臂：构造仅 not-evaluated 的输入，确认**不立 gap**（给出命令与读数）。

## Definition of Done

- 三条 AC 勾选，每条附可复跑命令与逐字读数（⛔ 不是「文件存在」或「测试绿了」）。
- `scripts/test.sh --for-task gap-goal-achieved-failing-folds-not-evaluated-into-red` 绿；全量 suite 不回归。
- JSON 输出**三桶同时出现**；`--help` 写明退出码含义。
- ⛔ 完成证据中不得出现「|D| 下降」或类似计数下降。

## Touches

- packages/quay/src/core/goal-store-checks.ts
- packages/quay/src/core/goal-store.ts
- packages/quay/test/goal-store.test.mjs
- plugin/scripts/goal-driver.ts
- tasks/gap-goal-achieved-failing-folds-not-evaluated-into-red.md
