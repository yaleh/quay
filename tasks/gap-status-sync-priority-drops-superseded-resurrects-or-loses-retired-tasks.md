---
id: gap-status-sync-priority-drops-superseded-resurrects-or-loses-retired-tasks
title: status sync priority list omits 'superseded' ⇒ doc↔develop semantic sync
  resurrects (develop superseded→ready) or loses (author superseded) retired
  tasks — first independently-verified open-discovery finding
status: done
labels:
  - gap
  - defect
  - open-discovery-finding
parent: null
children: []
extra: {}
---
## Proposal
**Origin: the first real hypothesis from open semantic discovery that was independently verified** (manual round 2026-10-12T18:4xZ, shadow arm guided by draft method `carrier-persistence-check`, hypothesis #4 "task-status vocabulary re-implemented as raw literals …"). The coordinator then verified it independently against the source and executed the function.

`plugin/scripts/driver-filters.ts:318` defines `STATUS_PRIORITY = ["todo","ready","needs-human","done"]`, and `resolveStatusPriority` (:330) filters out any status not in that list as "unreadable". `superseded`, a legal terminal status (`routine-file-gate.ts:378 CLOSED_TASK_STATUSES = ["done","superseded"]`), is therefore dropped. Measured by calling the exported function:

```
resolveStatusPriority("superseded","ready") => ready
resolveStatusPriority("ready","superseded") => ready
resolveStatusPriority("superseded",null)    => null
```

Consumer: `collectStatusAlignments` (:536-546) on the doc↔develop **semantic sync** path (`semanticSyncDocToDevelop`, :496), which is live in production: `.quay/doc-develop-sync.jsonl` has 94 `doc-develop-sync-semantic-resolved` and 144 `doc-develop-sync-semantic` events.
- **Case 1:** develop=`superseded`, author=`ready`/`todo`/`needs-human` ⇒ resolved = the live status ≠ develop ⇒ written back and ff-pushed to develop ⇒ **a retired task is resurrected as dispatchable.**
- **Case 2:** author=`superseded`, develop=live ⇒ resolved = develop's status ⇒ no alignment, and `merge -X theirs` keeps develop ⇒ **the retirement is silently lost.**

**Incidence so far (hard rule 12): 0 observed.** No task currently diverges author/develop on `superseded`. A history scan found no superseded→live reversal attributable to sync. So this is a latent mechanism defect, filed as a cheap fix, not a blocker.

## Plan
1. Put `superseded` into the deterministic order as a terminal status. A terminal status must never lose to a live one. Order: `todo < ready < needs-human < done`, with `superseded` terminal. `done` vs `superseded` must be decided explicitly; recommendation: keep `done` (it carries landed evidence) and record the tie in the sync event.
2. A status outside the vocabulary must not be silently dropped (hard rule 3b). Return a distinguishable `unknown:<value>` / not-evaluated so the alignment is skipped and an event is recorded, instead of letting the other side win.
3. Derive the vocabulary from the one canonical task-status list (the task schema / `TASK_STATUS`) rather than a fourth literal list; grep and paste the sibling literal lists (hard rule 5b).

## Acceptance Criteria
- [x] AC1: unit tests: `(superseded, ready|todo|needs-human)` and the reverse ⇒ `superseded`; `(superseded, done)` ⇒ the documented choice; `(bogus, ready)` ⇒ an unknown/not-evaluated value, not `ready`. Negative control: restore the 4-element list ⇒ red. Paste.
- [x] AC2: `collectStatusAlignments` on a fixture repo where develop has `superseded` and the author branch has `ready` produces NO alignment that writes `ready`. The reverse fixture writes `superseded`. Paste.
- [x] AC3: the sibling literal status lists in `plugin/scripts` are listed (grep command + first 3 hits + count) and either derived from the canonical list or justified.

## Definition of Done
- `scripts/test.sh --for-task <this task>` green.

## Touches
- tasks/gap-status-sync-priority-drops-superseded-resurrects-or-loses-retired-tasks.md
- plugin/scripts/driver-filters.ts
- plugin/test/driver-filters.test.mjs

## Evidence

**AC1 — 单测**（`plugin/test/driver-filters.test.mjs`，`node --no-warnings --experimental-strip-types --test plugin/test/driver-filters.test.mjs`）⇒ `tests 85 / pass 85 / fail 0`。新增/改写用例：
- 「AC1 — superseded（终态）永不输给任一 live 状态；done vs superseded 取 done」：`(superseded, todo|ready|needs-human)` 与反向 ⇒ `superseded`；`(superseded, done)` ⇒ `done`（文档化选择）。
- 「AC1 — 词汇表外字面量 ⇒ unknown/not-evaluated，⛔ 不伪装成另一侧胜出（硬规则 3b）」：`(bogus, ready)` ⇒ `unknown:bogus`（⛔ 非 `ready`）。
- 「AC1/AC3 — STATUS_PRIORITY 的词取自规范表 TASK_STATUSES + 完整性自检」：`[...STATUS_PRIORITY].sort()` 与 `[...TASK_STATUSES].sort()` 相等；`STATUS_PRIORITY.join(",") === "todo,ready,needs-human,superseded,done"`。

**AC1 负控制（实测，非仅断言内复刻）**：把 `driver-filters.ts` 的 `STATUS_PRIORITY` 就地改回旧 4 元素表、并把模块加载自检注释掉后重跑同一测试文件 ⇒ `pass 80 / fail 5`，红者：

```
✖ AC1 — superseded（终态）永不输给任一 live 状态；done vs superseded 取 done
✖ AC1 (负控制) — 恢复旧的四元素表 ⇒ superseded 被静默丢弃 ⇒ 红
✖ AC1/AC3 — STATUS_PRIORITY 的词取自规范表 TASK_STATUSES（⛔ 第四份字面量清单）+ 完整性自检
✖ AC2 — develop=superseded / author=ready ⇒ 无对齐写 ready（⛔ 不得复活已退役任务）
✖ AC2 — develop=ready / author=superseded ⇒ 对齐写 superseded（⛔ 不得丢失退役）
ℹ tests 85 / pass 80 / fail 5
```

（随后 `cp` 还原；工作树仅剩本任务的真实改动。未改测试文件 —— 红是由生产表回退【挣来】的。）

**AC2 — `collectStatusAlignments` 夹具**（`makeStatusDivergenceRoot` 建 develop/author 两分支对同一 `tasks/gap-x.md` 写下不同 status）：
- develop=`superseded` / author=`ready` ⇒ `scan.alignments` 不含 `tasks/gap-x.md`（**不产生写 `ready` 的对齐**）、`notEvaluated` 为空。
- develop=`ready` / author=`superseded` ⇒ `scan.alignments.get("tasks/gap-x.md") === "superseded"`（**反向夹具写 superseded**）。
- 端到端：develop=`superseded` / author=`done` ⇒ 一条 tie，`semanticSyncDocToDevelop` 后 sync 事件含 `doc-develop-sync-status-tie` 且 `resolved=done`，`git show develop:tasks/gap-x.md` ⇒ `status: done`。
- 读不懂：develop=`bogus` / author=`ready` ⇒ `alignments.size===0`、`notEvaluated.length===1`（读数 `unknown:bogus`），事件含 `doc-develop-sync-status-not-evaluated`，且 develop 未被改成 `ready`。

**AC3 — sibling 字面量状态清单审计（硬规则 5b）**。命令与命中（`plugin/scripts/*.ts`，共 10 个文件命中）：

```
$ grep -rnE '"todo".*"ready"|"done".*"superseded"|"needs-human".*"done"' plugin/scripts/*.ts
（前 3 条）
plugin/scripts/it0-split-or-commit-check.ts:372:    if (t.status !== "todo" && t.status !== "ready") continue;
plugin/scripts/goal-driver.ts:2147:  return status === "todo" || status === "ready" || status === TASK_STATUS.NEEDS_HUMAN;
plugin/scripts/routine-file-gate.ts:375:export const LIVE_TASK_STATUSES: readonly string[] = ["todo", "ready", "needs-human"];
...
$ grep -rlE '"todo".*"ready"|"done".*"superseded"|"needs-human".*"done"' plugin/scripts/*.ts | wc -l
10
```

处置：
- **本任务修的那一处（`driver-filters.ts` `STATUS_PRIORITY`）已改为派生**：词取自规范模块 `task-status.ts` 的 `TASK_STATUS`，并由模块加载自检 `assertStatusPriorityCoversVocabulary()` 保证与规范表 `TASK_STATUSES` **恰好同集**（漏词 ⇒ 当场抛出，而非被 `includes()` 静默丢弃 —— 正是本缺陷）。
- **其余兄弟点不在本任务 `## Touches` 内，且各自是【不同的判定】，不是本词汇表的第二份拷贝 ⇒ 登记为 justified（不改）**：`routine-file-gate.ts` 的 `LIVE_TASK_STATUSES`/`CLOSED_TASK_STATUSES` 是 routine 归属的 live/closed 分区；`meta-driver.ts` / `goal-driver.ts` 的 `=== "done" || === "superseded"` 是可复用性判定；`dev-stats-collect.ts:196` 的 `["done","ready","todo","needs-human","superseded"]` 是统计展示序（与本文件的优先级序不同义）；`driver-filters.ts:107 DepVerdict` 已是三值核 `judgeDepStatus`，非本表。
- **新引入的 `TERMINAL_TASK_STATUSES`（done/superseded）** 是同一「终态分区」族的成员：规范模块 `task-status.ts` 未提供分区，故就地显式列出并在此登记；词同样取自 `TASK_STATUS`，不新增字面量。
