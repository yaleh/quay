---
id: gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human
title: worker-driver 把瞬时账号限流计入快速死亡上限并终态停摆任务 —— 区分证据它已经抓到了却不用
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

worker-driver 的快速死亡退避（`plugin/scripts/worker-driver.ts:2131-2229`，`isQuickDeath` `:2168` / `recordQuickDeathBackoff` `:2210`，由已 done 的 `gap-worker-driver-selector-api-error-no-backoff` 引入）把**一切** <60s（`QUICK_DEATH_BACKOFF_DEFAULT.quickDeathMs=60_000`，`:2156`）的非零退出计入**同一个桶**（`QUICK_DEATH_FINAL_STATES = {failed, spawn-failed, killed}`，`:2165`）：连续 ≥ `backoffMaxRetries` 次即 `newlyNeedsHuman`（`:2226-2228`），任务落入终态、不再重派。

但其中一类成因与其它快速死亡在**性质上不同**：账号级限流是**瞬时的、外部的、自愈的**，且**错误文本自带失效时刻**。

**实测（2026-09-13，第三方项目 quay-fleet，第一手载体 `/home/yale/work/quay-fleet/.quay/worker-outcome.jsonl`）**：连续三条记录的 `selector_reason` 逐字相同：

```
selector worker returned no valid pick (exit 1, got "You've hit your session limit · resets 11:30am (UTC)"); fallback to first shuffled candidate
```

对应 `wall_clock_ms` = 4643 / 7685 / 5106（三次都 <60s ⇒ 三次都计入上限），时刻 11:13:05.897Z / 11:13:59.621Z / 11:17:37.686Z ⇒ 任务 `fleet-agent-sessions-screen-endpoint` 于 11:17:37.742Z 被机械翻 `needs-human`，`## Needs-Human` 段记的成因类是 `human-adjudication`。

**关键点：driver 已经握着能区分的证据。** 它把限流原文完整抓进了 `selector_reason` 字段并落了盘——它不是"看不出来"，是"看出来了但不分类"。而且那条文本自带 `resets 11:30am (UTC)`，即退避应该等到的时刻是**已知的**，不需要猜。

**成因类标错的代价是具体的**：`human-adjudication` 意味着"需要人裁决"，而真实情况是"等 17 分钟就好了"。终态不会自愈，任务永久停摆直到有人发现。实测该任务停了 30 分钟才由旁路会话发现。

**⛔ 不要把第一条失败一起归因**：同一任务 11:12:53 那条 `wall_clock_ms=182939`（3 分钟）是一次真正跑起来后 exit 1 的失败，不是快速死亡，现有代码已正确排除它（`:2205` 注释「非快速死亡 ⇒ 复位连续计数」，实现在 `:2219-2223`）。本缺陷只针对后三条。

**为什么 quay 自己从没碰到（负控制，同时也是它一直没被发现的原因）**：quay 自己的 `.quay/worker-outcome.jsonl` 共 **1841** 条记录，含 "session limit" 的 **0** 条——因为 quay 的 worker 经 `ANTHROPIC_DEFAULT_*_MODEL=deepseek-v4-pro-anthropic` 走别的后端，不消耗 Anthropic 账号额度。⇒ **这个缺陷只在 worker 使用 Anthropic 账号的第三方项目上暴露**，本仓库的套件与生产数据都不会自然产生该样本。

**发生率（硬规则 12，已查历史非等下一轮）**：quay-fleet 12 条 worker 记录中 3 条（25%），集中在 5 分钟内；quay 1841 条中 0 条。绝对次数低，但①后果是终态、②成因保证复现（额度按日重置）、③第三方项目是 quay 的目标场景。

**与前置任务的分工**：`gap-worker-driver-selector-api-error-no-backoff`（done）治「出错时为什么无退避疯狂重试」——它是对的，本条不推翻它；本条治「**所有快速死亡共用一个桶**」，即退避机制缺一个成因维度。

## Plan

1. 在 `worker-outcome` 已有字段的基础上，给快速死亡增加一个**可枚举的成因取值**（硬规则 3：枚举，不布尔；硬规则 3b：不得与"正常失败"共用取值），至少区分 `transient-external`（限流/配额）与现有的其它快速死亡。判定依据只用 driver **自己已经捕获的 `selector_reason` / worker 输出文本**，不新增探测。
2. 判为 `transient-external` 的快速死亡：**不计入** `backoffMaxRetries` 连续计数（即不走 `:2226` 的 `newlyNeedsHuman` 分支），改为退避重试。
3. 退避时刻优先取错误文本自带的重置时刻（`resets <time> (UTC)`）；解析不出时回落到现有指数退避（`baseBackoffMs`/`maxBackoffMs`，`backoffDelayMs` `:2177`）。⛔ 解析不出不得静默当成"立刻重试"，也不得静默当成 needs-human——它是第三个取值。
4. 已因本成因误落 needs-human 的任务：不做自动回捞（终态由人/上层裁决），但成因类必须记成 `transient-external` 而不是 `human-adjudication`，让读者能一眼区分。

## Acceptance Criteria

- [ ] AC1（能取假，双输入对照）：给定一条 `selector_reason` 含 `You've hit your session limit · resets 11:30am (UTC)` 的快速死亡记录，分类函数返回 `transient-external`；把该文本换成 `worker exited with code 1`，同一函数返回**不同**取值。（两个输入必须给出不同输出，否则判据空转）
- [ ] AC2（能取假，双向对照）：连续 N 次 `transient-external` 快速死亡（N > `backoffMaxRetries`）后，任务 status 仍**不是** needs-human；把同样次数换成非 transient 的快速死亡，则**是** needs-human。
- [ ] AC3（能取假）：退避时刻取自错误文本里的重置时刻——给一条带 `resets 11:30am (UTC)` 的记录，`backoffUntil` 等于该时刻；给一条不含重置时刻的，回落到指数退避且 `backoffUntil` 非空。
- [ ] AC4（能取假，硬规则 3b）：成因文本解析不出时的取值与 `transient-external`、与普通快速死亡三者**互不相同**（读不懂不得与任一合格态同形；三个取值逐一断言不相等）。
- [ ] AC5（读生产载体，硬规则 4 推论三）：实现落地之后的时间窗内，`.quay/worker-outcome.jsonl` 中任一含 "session limit" 的记录，其新增成因字段取值为 `transient-external`。若该窗口内自然样本为 0，必须在本任务体写明"未取到自然样本"，⛔ 不得用 fixture 顶替而不标注。

## Definition of Done

- 五条 AC 全部满足。
- AC1–AC4 可在本仓库套件内验证；**AC5 必须读生产载体**，且只计实现落地之后的记录（落地 commit 时刻之后的行）。
- ⛔ 不得把"解析不出重置时刻"与"不是限流"合并成同一取值。
- ⛔ 不得改动第一条慢速失败的既有处理（`worker-driver.ts:2205`/`:2219-2223` 的"非快速死亡复位连续计数"是对的，本任务不碰）。
- ⛔ 不得引入对 worker 输出做**语义**判断的新探测面——只允许对 driver 已捕获的错误文本做精确匹配。
- 任务体须保留本条的两个第一手读数：quay-fleet 三条记录的逐字 `selector_reason` 与 `wall_clock_ms`（4643 / 7685 / 5106），以及 quay 自己 1841 条 / 0 条的负控制。

## Touches

- plugin/scripts/worker-driver.ts（快速死亡成因分类 + `recordQuickDeathBackoff` 的 transient 分支 + 重置时刻解析）
- plugin/test/worker-driver.test.mjs（AC1/AC3/AC4 纯函数对照；该文件是 `isQuickDeath`/`backoffDelayMs`/`recordQuickDeathBackoff`/`QUICK_DEATH_BACKOFF_DEFAULT` 的导入方，见其 import 块 `:87-96`）
- plugin/test/worker-driver-resident.test.mjs（AC2 常驻循环侧双向对照：N 次 transient 不翻 needs-human / N 次非 transient 翻）
- tasks/gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human.md（自身）

**Touches 前置核实（实现方落笔前做，一条命令）**：`grep -rn "recordQuickDeathBackoff\|isQuickDeath" plugin/test/` —— `worker-driver.test.mjs` 与 `worker-driver-resident.test.mjs` 共用同一 import 块（两者都从 `worker-driver.ts` 导入这组符号），**本条未逐条确认断言实际落在哪一份**；若实际只落在其中一份，按命中结果收窄 Touches（⛔ 不要照抄本清单而让另一份成为未声明改动 ⇒ anti-drift 红）。共享 harness `plugin/test/helpers/worker-driver-harness.mjs` 若被改动须一并声明。
