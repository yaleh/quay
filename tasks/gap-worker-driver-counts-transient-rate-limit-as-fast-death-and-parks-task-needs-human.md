---
id: gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human
title: worker-driver 把瞬时账号限流计入快速死亡上限并终态停摆任务 —— 区分证据它已经抓到了却不用
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-worker-driver-selector-api-error-no-backoff
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

## 实现（落点，`d3d22dc16`）

- `classifyQuickDeathCause(selectorReason)` —— 三态枚举 `"transient-external" | "ordinary" | "unclassifiable"`（`QuickDeathCause`）。只对 driver 已捕获文本做**字面子串**匹配（签名常量 `TRANSIENT_EXTERNAL_SIGNATURES`，含实测的 `session limit`）；⛔ 无新探测面、⛔ 无语义判断、⛔ 不调模型。
- `parseRateLimitResetAtMs(text, nowMs)` —— 解析 `resets 11:30am (UTC)`（含 `3pm` / 24h 形）；已过（含恰在此刻）⇒ **次日同时刻**（⛔ 不返回已过去的时刻 = 静默退化成"立刻重试"）；解析不出 ⇒ `null`（缺值 = 未查）。
- `recordQuickDeathBackoff(...)` 第 9 参数接 `selectorReason`；`transient-external` ⇒ ⛔ 不进 `state.counts`（新增独立 `transientCounts`，两者分开记 ⇒ 一段限流不会把普通计数顶满上限）⇒ **永不 `newlyNeedsHuman`**，改设 `backoffUntil` = 文本自带重置时刻 ?? `nowMs + backoffDelayMs(transientCounts, cfg)`。普通连续计数**不动**（既不 +1 也不复位——与既有 `liveness === "unknown"` 分支同族，硬规则 3b 的第三取值形态）。`ordinary` / `unclassifiable` 共用既有判别式（fail-safe：读不懂不无限重派），取值如实可区分。返回值增加 `cause` / `backoffUntil`。
- `computeOutcome` —— 快速死亡记录追加 `quick_death_cause`（非快速死亡 ⇒ **缺键**，硬规则 6：缺值 ≠ 某个取值）。⛔ 按机制缺省 `quickDeathMs` 判定；`--quick-death-ms` 覆盖只影响退避决策、不回溯改写已落盘记录（记录同带 `final_state` + `wall_clock_ms`，读者可自行复算——差异已注明，⛔ 不静默）。
- `onWorkerFinished` —— needs-human 注记带上成因取值（plan item 4「让读者一眼区分」，⛔ 不再与 `human-adjudication` 模板同形；`transient-external` 结构上到不了这个分支）；`worker-backoff` 事件补 `cause` / `backoff_until` / `consecutive_transient_deaths`。
- ⛔ 不碰第一条慢速失败的既有处理（非快速死亡复位连续计数的语义逐字不变）。

## Acceptance Criteria

- [x] AC1（能取假，双输入对照）：给定一条 `selector_reason` 含 `You've hit your session limit · resets 11:30am (UTC)` 的快速死亡记录，分类函数返回 `transient-external`；把该文本换成 `worker exited with code 1`，同一函数返回**不同**取值。（两个输入必须给出不同输出，否则判据空转）—— **满足**：`classifyQuickDeathCause(RATE_LIMIT_REASON) === "transient-external"`、`(ORDINARY_REASON) === "ordinary"`，并断言两者 `notEqual`（`worker-driver-fan-in.test.mjs` 的 `AC1 (能取假, 双输入对照)`，绿）。
- [x] AC2（能取假，双向对照）：连续 N 次 `transient-external` 快速死亡（N > `backoffMaxRetries`）后，任务 status 仍**不是** needs-human；把同样次数换成非 transient 的快速死亡，则**是** needs-human。—— **满足**：常驻环双向对照（`AC2 (能取假, 双向对照)`）——臂① N=4 > `--max-retries 2` 次限流快速死亡后 `readTaskStatus === "ready"` 且任务体**无** `## Needs-Human`；臂② 同构换 `flaky-red` ⇒ `needs-human`。两臂载体字段取值亦不同（`transient-external` vs `ordinary`）。
- [x] AC3（能取假）：退避时刻取自错误文本里的重置时刻——给一条带 `resets 11:30am (UTC)` 的记录，`backoffUntil` 等于该时刻；给一条不含重置时刻的，回落到指数退避且 `backoffUntil` 非空。—— **满足**：`AC3 (能取假, 双输入)`——臂① `backoffUntil === Date.UTC(2026,0,15,11,30,0)`（且换写 `11:47am` ⇒ 读数跟着变，⛔ 非硬编码）；重置时刻已过 ⇒ 次日同时刻；臂② 无重置时刻 ⇒ `backoffUntil === nowMs + baseBackoffMs` 且非空。
- [x] AC4（能取假，硬规则 3b）：成因文本解析不出时的取值与 `transient-external`、与普通快速死亡三者**互不相同**（读不懂不得与任一合格态同形；三个取值逐一断言不相等）。—— **满足**：`AC4 (能取假, 硬规则 3b)` 逐一 `notEqual`（`transient-external` / `ordinary` / `unclassifiable` 两两不等）；`null` / `"   "` / `undefined` 三种读不懂形态同判 `unclassifiable`；判别式上仍按普通计（到上限 ⇒ needs-human，对照臂证明不无限重派）。
- [x] AC5（读生产载体，硬规则 4 推论三）：实现落地之后的时间窗内，`.quay/worker-outcome.jsonl` 中任一含 "session limit" 的记录，其新增成因字段取值为 `transient-external`。若该窗口内自然样本为 0，必须在本任务体写明"未取到自然样本"，⛔ 不得用 fixture 顶替而不标注。—— **未取到自然样本**（如实标注）：实现 commit `d3d22dc16`（2026-09-14T02:06:53Z）；截至核验时刻，生产载体 `/home/yale/work/quay/.quay/worker-outcome.jsonl` 共 **1889** 条记录、含 `"session limit"` 的 **0** 条、含 `quick_death_cause` 的 **0** 条（末条记录 ts `2026-09-14T01:54:43.690Z`，早于落地时刻）—— 与 Proposal 的负控制同因（quay 的 worker 不消耗 Anthropic 账号额度）。**载体字段确实会落进 `.quay/worker-outcome.jsonl` 的证据**（⛔ 明确标注为**临时 root 的真常驻驱动跑**、**非自然样本**）：`AC2 (能取假, 双向对照)` 臂① 用真 `spawnResident` 驱动跑，断言 4 条 outcome 记录的 `quick_death_cause === "transient-external"`；另 `AC5 (结构性, 负控制)` 断言 `completed` / `exited-not-landed` / `timed-out` / 慢速失败四态**缺键**（⛔ 证明字段不是恒有/恒缺）。

**能取假实证（变异对照，非自证）**：把 `classifyQuickDeathCause` 改成恒返回 `"ordinary"`（等价于「修复前：一切快速死亡共用一个桶」）⇒ **AC1–AC5 五条全红**（原件 md5 `cdca9b78da5bcfafa8f4c0185ad842b6`，变异后跑完再逐字节还原并复跑 5/5 绿）。

## Definition of Done

- 五条 AC 全部满足。
- AC1–AC4 可在本仓库套件内验证；**AC5 必须读生产载体**，且只计实现落地之后的记录（落地 commit 时刻之后的行）。
- ⛔ 不得把"解析不出重置时刻"与"不是限流"合并成同一取值。
- ⛔ 不得改动第一条慢速失败的既有处理（`worker-driver.ts:2205`/`:2219-2223` 的"非快速死亡复位连续计数"是对的，本任务不碰）。
- ⛔ 不得引入对 worker 输出做**语义**判断的新探测面——只允许对 driver 已捕获的错误文本做精确匹配。
- 任务体须保留本条的两个第一手读数：quay-fleet 三条记录的逐字 `selector_reason` 与 `wall_clock_ms`（4643 / 7685 / 5106），以及 quay 自己 1841 条 / 0 条的负控制。（Proposal 节逐字保留；核验时刻的复测读数见 AC5。）

## Touches

- plugin/scripts/worker-driver.ts（快速死亡成因分类 + `recordQuickDeathBackoff` 的 transient 分支 + 重置时刻解析 + `computeOutcome` 的 `quick_death_cause`）
- plugin/test/worker-driver-fan-in.test.mjs（AC1/AC2/AC3/AC4/AC5 五条断言；该文件是 `isQuickDeath`/`backoffDelayMs`/`newQuickDeathBackoffState`/`isBackedOff`/`recordQuickDeathBackoff`/`QUICK_DEATH_BACKOFF_DEFAULT` 的导入方，见其 import 块 `:91-96`，且已有 `gap-worker-driver-selector-api-error-no-backoff` 的整段快速死亡断言）
- tasks/gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human.md（自身）

**Touches 前置核实（已做，结果如下）**：`grep -rn "recordQuickDeathBackoff\|isQuickDeath\|backoffDelayMs\|newQuickDeathBackoffState\|isBackedOff\|QUICK_DEATH_BACKOFF_DEFAULT" plugin/test/` 的命中分布——
`plugin/test/worker-driver.test.mjs:87-92` 与 `plugin/test/worker-driver-resident.test.mjs:88-93` **只有 import 行**（无任何断言）；
`plugin/test/worker-driver-fan-in.test.mjs:91-96` 有 import，且 `:1049-1143` 是**全部**快速死亡断言的所在（AC1 pure / backoffDelayMs / recordQuickDeathBackoff / AC4 三值分流）。
⇒ **按命中结果收窄**：删去原清单里 `worker-driver.test.mjs` 与 `worker-driver-resident.test.mjs`（未改动、只留未使用的 import），改为声明 `worker-driver-fan-in.test.mjs`（本次实际改动）。
共享 harness `plugin/test/helpers/worker-driver-harness.mjs` **未改动** ⇒ 不声明。
