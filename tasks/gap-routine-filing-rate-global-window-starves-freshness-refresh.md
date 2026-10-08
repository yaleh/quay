---
id: gap-routine-filing-rate-global-window-starves-freshness-refresh
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
title: 立案限流闸：跨 routine 的 24h 全局窗口被单一 routine 批量吃光，板排空时该机制仍拒绝回填
---
**type:** gap

## Finding

**跨 routine 的全局立案预算被单一 routine 的批量吃光，且窗口只数「立案次数」不数「板上是否还压着工作」——板排空与窗口饱和可以同时成立，于是机制无法回填空板。**

### 根因（逐行读源码，⛔ 非推断）

- `plugin/scripts/routine-file-gate.ts:900` `countRecentFilings(carrierPath, nowMs, windowMs = FILING_WINDOW_MS)`：遍历 `.quay/routine-findings.jsonl` 的**全部** `filing-round` 记录，按 `ts` 落在窗口内者累加 `r.filed.length`。⚠️ 它**不按 `routine` 过滤** ⇒ 该预算是**跨 routine 共享的全局量**。`FILING_WINDOW_MS = 24h`（同文件 `:513`）。
- `plugin/scripts/routine-file-gate.ts:262`：`if (recentCount >= K) return { accept: false, reason: `rate: ${recentCount} routine-filed tasks this window ≥ cap ${K}` }`，`K = 3`。
- ⇒ 语义是「**过去 24h 全仓经例程通道立案的总条数 ≥ 3 即拒**」，与「那些任务是否还开着／板是否已排空」**无关**。计数的是**动作**（立案），不是**压力**（在板量）。

### 观测（逐字，可复跑）

**① 长期饥饿（连续 11 轮全零）** —— 载体 `.quay/routine-findings.jsonl`，`kind:"filing-round"`，`routine:"freshness-refresh"`：

| ts (UTC) | candidates | filed | rejectGates |
|---|---|---|---|
| 2026-10-07T23:05:14.731Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T01:05:39.773Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T03:06:32.347Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T05:07:16.471Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T07:07:42.270Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T09:57:10.984Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T11:57:40.649Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T13:57:45.957Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T15:58:13.720Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T19:03:02.716Z | 7 | 0 | `{"action":7}` |
| 2026-10-08T21:03:37.157Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T23:03:37.876Z | 7 | 0 | `{"quality-dedup-rate":7}` |

（末行是重查时新落的轮次，独立复现同一拒绝。）reason 逐字：`rate: 3 routine-filed tasks this window ≥ cap 3 (subject recurrence: 8 round(s))`。这 7 条候选**不是测量**：它们带具体 `suggestedAction`（在 host B+C 重跑 coldstart-face / session-delivery / upgrade-face），且 `remedy_availability.status = "executable"`（`host-b-ssh` 探针 rc=0，本机确实跑得动）。

**② 吃光预算的一方** —— `routine:"semantic-dedup-scan"` 每轮 `filed=3`（近 14 轮里 12 轮恰好 3，另 2 轮 1）。最近一次 `2026-10-08T07:00:52.793Z` 立案 3 条（`gap-routine-semantic-dedup-scan-driver-sleep-requeststop-triple` / `-safe-task-id-segment` / `-is-ancestor-pair`）⇒ 自该时刻起 24h 内全局预算 = 3/3 饱和，**到期时刻 `2026-10-09T07:00:52.794Z`**。

**③ 病理共存（本条的关键）** —— 同一时刻：窗口 3/3 饱和，而**板完全排空**。Provider ABI `task_list` `status=todo` → `total: 0`；`status=ready` → `total: 0`（上面那 3 条已于当天被晋升并 done）。⇒ 「已 done 仍计入窗口」使**排空的板无法被同一机制回填**。这是**同时成立的两个事实**，不是矛盾。

### 与既有任务的关系（去重，⛔ 不是重复）

- `gap-routine-semantic-dedup-scan-recurring-cluster-starvation`（**done**）：修的是**同一 routine 内部**「发现之后谁先花预算」（`recurrenceOrder` 复现降序）。其自述边界逐字：「本任务修的是**发现之后谁先花预算**」。它**不动**跨 routine 的预算共享，也不动窗口的板盲性 ⇒ **轴不同**。
- `gap-ac214-eighth-crossing-done-key-permanently-suppresses-escalation`：是 **dedup 键**由 done 任务供给导致的升级不可达（另一道闸 `dedup`），本条是 `rate` 闸 ⇒ 仅 traceability。
- 覆盖探针（本条立案前实测）：`grep -rlF` 于 `tasks/*.md`，键 `countRecentFilings` / `recentCount` / `FILING_WINDOW` / `跨 routine` / `cross-routine` / `全局预算` / `global budget` **全部 0 文件**；对照键 `quality-dedup-rate` → 6 文件、`selectFilings` → 4、`gateFinding` → 4 ⇒ 谓词有效，**未被覆盖**成立。

### 方案候选（⛔ 未择定；择定需人裁定，或由本任务给出对照后择一）

- **(A) 预算按 routine 分账**：`countRecentFilings` 加 `routine` 维度，K 各自计。代价：总量上限变成 K×R，需另加全局天花板。
- **(B) 窗口从「数立案」改为「数在板的 routine 立案」**：只计**非终态**的 routine 立案。最贴近观测到的病理（板空却窗口满）。代价：闸需读任务状态，不再只读载体（成本与失败模式都变）。
- **(C) 保底份额**：保留全局 cap，但为「窗口内立案数为 0 的 routine」预留至少 1 个名额。
- **(D) 板下限旁路**：在板量低于某下限时不受窗口约束。
- **(E) 不改**：接受 freshness 主体只在窗口缝里刷新。若择定此项，须写出理由**以及该理由如何被检验**。

## AC

- [x] 根因读数已固化且可复跑：本任务体逐字给出 `countRecentFilings` 的调用点与 `FILING_WINDOW_MS` / `K` 的取值来源（`plugin/scripts/routine-file-gate.ts:900` / `:513` / `:262`），并给出**至少 10 条**连续 `freshness-refresh` `filing-round` 记录的 ts / candidates / filed / rejectGates（`grep '"kind":"filing-round"' .quay/routine-findings.jsonl` 可复现）
- [x] 饱和方与到期时刻已固化：给出吃光预算的 routine 名、其最近一次 `filed=3` 的 ts，及其 24h 到期时刻；`grep` 该 `filing-round` 记录可复现
- [x] **窗口板盲性**有单态判据（⛔ 不是叙述）：在一次性 fixture 载体上（`/tmp` 下自造 `.quay/routine-findings.jsonl`，含一个窗口内 `filed:3` 的 `filing-round`）跑 `gateFinding`，断言 `accept === false` 且 `reason` 以 `rate:` 开头；同一 fixture 只把那条记录的 `ts` 移到窗口外 ⇒ 断言 `accept === true`。两次取值与 `recentCount` 读数一并进 `## Evidence`
- [x] 判据能取假（负对照，一次性可复跑）：在本任务改动的文件上，把消费点（`selectFilings` 的复现序消费 / `countRecentFilings` 的 routine 维度）暂时改成「读而不消费」，重跑上一条那棵树上的用例 ⇒ 该用例必须转红；随后改回原样。执行命令、改前改后两次用例结果逐字进 `## Evidence`，且 `plugin/test/routine-file-gate.test.mjs` 的纯函数用例在两次取值下均全绿
- [x] 无生产伪造：未为取绿手写任何 `filing-round` / `task-status-events` 行，未修改任何生产任务状态换读数；本任务的观测一律来自既有载体

## DoD

真实落地 = 上面第三条的**单态判据**在真实代码上跑出两个不同取值（窗口内⇒拒 / 出窗⇒收），并据此落地方案中的一条（或由人裁定择 (E) 并由人关闭）。判据必须是「**同一输入、只变窗口位置、结论翻转**」，⛔ 不是「跑了一遍没报错」。

⛔ 不以「已注意到」结案；⛔ 不以增加一条文档/注释结案。若择定 (E)，须写出理由与**该理由如何被检验**。

## Evidence

全部读数来自**既有载体**（`.quay/routine-findings.jsonl`）与 `/tmp` 一次性 fixture；⛔ 未手写任何 `filing-round` / `task-status-events` 行，⛔ 未改任何生产任务状态（AC5）。

### 1. 根因读数（AC1 / AC2）——可复跑

`grep '"kind":"filing-round"' .quay/routine-findings.jsonl` 后按 `routine` 过滤计数，`freshness-refresh` 连续 12 轮（与任务体的表逐字一致）：

| ts (UTC) | candidates | filed | rejectGates |
|---|---|---|---|
| 2026-10-07T23:05:14.731Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T01:05:39.773Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T03:06:32.347Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T05:07:16.471Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T07:07:42.270Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T09:57:10.984Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T11:57:40.649Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T13:57:45.957Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T15:58:13.720Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T19:03:02.716Z | 7 | 0 | `{"action":7}` |
| 2026-10-08T21:03:37.157Z | 7 | 0 | `{"quality-dedup-rate":7}` |
| 2026-10-08T23:03:37.876Z | 7 | 0 | `{"quality-dedup-rate":7}` |

吃光预算方：`semantic-dedup-scan`，最近一次 `filed=3` 的 ts = `2026-10-08T07:00:52.793Z`（filed = `gap-routine-semantic-dedup-scan-driver-sleep-requeststop-triple` / `-safe-task-id-segment` / `-is-ancestor-pair`），24h 到期 = `2026-10-09T07:00:52.794Z`。

### 2. 单态判据（AC3）——窗口位置是唯一变量

一次性 fixture（`/tmp` 自造载体），调 `countRecentFilings(...)` 取 `recentCount` 再交 `gateFinding`：

```
$ WT=<worktree> node --no-warnings --experimental-strip-types /tmp/ac-rate-window-XXXXXX/verify.mjs
ARM1 in-window    : recentCount=3 accept=false reason="rate: 3 routine-filed tasks this window ≥ cap 3"
ARM2 out-of-window: recentCount=0 accept=true reason="accepted: actionable, novel, within rate"
ARM3 cross-routine: recentCount=0 accept=true reason="accepted: actionable, novel, within rate"
```

ARM1 → ARM2 是**同一份载体、只把那条 `filing-round` 的 `ts` 移出窗口** ⇒ 结论由拒转收（DoD 要求的「同一输入、只变窗口位置、结论翻转」）。ARM3 是修复的落点：另一 routine 立了 3 条，本 routine 的窗读作 0 ⇒ 板可被回填。

同一判据也固化进 `plugin/test/routine-file-gate.test.mjs`（⑮ 的三个用例：WINDOW POSITION / CROSS-ROUTINE ISOLATION / no-routine），随 `scripts/test.sh` 复跑；本文件 17/17 绿。

### 3. 负对照——判据能取假（AC4）

改前（真代码）：见上 §2 的两次取值（ARM3 recentCount=0 ⇒ 收）。

把消费点改成「读而不消费」：`plugin/scripts/routine-file-gate.ts` 中 `countRecentFilings` 的 routine 过滤行

```
    if (want !== null && String(r.routine ?? "").trim() !== want) continue;
```

改为

```
    void want; // NEGATIVE-CONTROL: the routine dimension is READ but NOT CONSUMED
```

重跑同一用例 ⇒ ARM3 **转红**：

```
ARM3 cross-routine: recentCount=3 accept=false reason="rate: 3 routine-filed tasks this window ≥ cap 3"
```

（ARM1/ARM2 逐字不变 —— 它们不依赖 routine 维度。）同一 neutered 树上跑 `plugin/test/routine-file-gate.test.mjs`：**纯函数用例（①-⑭）全绿**，仅两条新用例转红：

```
✖ ⑮ CROSS-ROUTINE ISOLATION — another routine's batch does NOT spend this routine's budget (and still spends its own)
✖ ⑮ a record whose OWN routine is absent is not counted against a NAMED routine (⛔ no leak back in)
ℹ tests 17   ℹ pass 15   ℹ fail 2
```

改回原样（`cp` 备份还原；`grep -c 'if (want !== null'` = 1），重跑 17/17 全绿。

### 4. 落地方案与残余

择定 **(A) 预算按 routine 分账**：`countRecentFilings` 加 `routine` 维度，`selectFilings` 传 `o.routine`；`null` 保留修复前的全局读数（⛔ 不静默改语义）。

- 关掉了观测到的病理：单一 routine 的批量不再吃光别的 routine 的预算；板排空时**该 routine 自己的**窗为 0 ⇒ 可回填（ARM3）。
- 残余（⛔ 未关闭，也不假装关闭）：窗口**仍**只数「立案次数」、不数「板上是否还压着工作」——即方案 (B) 的轴。当**同一** routine 自己在窗内立满 K 条而板又排空时，它仍被限流。逐字记此供后续裁定；本任务按 DoD「落地方案中的一条」只落 (A)。

## Touches

- tasks/gap-routine-filing-rate-global-window-starves-freshness-refresh.md
- plugin/scripts/routine-file-gate.ts
- plugin/scripts/probe-routine.ts
- plugin/test/routine-file-gate.test.mjs
