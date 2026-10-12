---
id: gap-open-discovery-consumes-task-status-events-optional-context
title: open semantic discovery reads task_log since its cursor as OPTIONAL
  context (never gates/triggers a round)
status: done
labels:
  - gap
  - task-trace
  - open-discovery
parent: null
children: []
extra: {}
depends_on:
  - gap-quay-task-log-trace-read-surface
  - gap-open-semantic-discovery-routine-track
---
## Proposal
Under SEMANTIC FIRST, MECHANIZE LATER, the open semantic discovery routine (`gap-open-semantic-discovery-routine-track`) explores source on its own judgment every 60m. Reliable "what changed since my last round" context helps it choose where to look: tasks that just landed, tasks reset after a failed landing, tasks escalated to needs-human. That context comes from real transition events read through `quay task log`, not from commit-title guesses.

The context is OPTIONAL. Events never gate or trigger a round:
- no events ⇒ the round still runs;
- many events ⇒ still one bounded round.
Mechanics only fetch and persist a cursor. What to do with the context is the model's call.

## Plan
1. At round start, read `quay task log --since <stored cursor> --limit <n>` (n from config, default 50).
   - Pass a compact summary (task id, from→to, at, evidence.commit, `inferred` flag) into the investigator prompt as "recent changes you MAY consider". The model may also read the commits' diffs with its own tools.
   - Store the new cursor in the routine's carrier only after the round's append, so a crashed round re-reads (at-least-once). Dedupe by `eventId`.
2. On `rebase:true` or `complete:false`, pass that fact to the model as-is ("this list may be incomplete: <reasons>"). No mechanical fallback to commit titles.
3. The round record lists the cursor before/after, the event count offered, and whether the model's stated focus cited any of them (its own statement, not a mechanical attribution).
4. No extra model call; it adds prompt tokens only. Its cost is visible in the round's per-call token and gateway cost.

## Acceptance Criteria
- [x] Tests exit 0, covering:
  - (a) 0 events ⇒ the round runs normally;
  - (b) more events than `n` ⇒ capped, and the remainder is picked up next round;
  - (c) a crash before the append ⇒ the next round re-offers the same events, deduped by `eventId`;
  - (d) `rebase:true` / `complete:false` reaches the prompt verbatim;
  - (e) no code path skips or schedules a round based on events (static control).
- [x] Negative control: make the round skip when there are 0 events in a scratch copy ⇒ (a) red. Paste the output.
- [ ] Production reading: the first resident round after landing. Paste its cursor before/after, the event summary it was offered, its stated focus and the files it read. If the focus did not use the events, say so; that is a valid outcome. （待外部）

## Definition of Done
- All AC ticked with output pasted (production AC may stay （待外部）).
- `scripts/test.sh --for-task gap-open-discovery-consumes-task-status-events-optional-context` green.

## Evidence

改动 3 个文件，全部在 `## Touches` 内。`node --test plugin/test/open-semantic-discovery-routine.test.mjs`：**tests 91 / pass 91 / fail 0**（原有 80 条 + 本轮新增 11 条）。

### AC1 — (a)-(e) 全绿（粘贴）

```
✔ AC (a) — 0 events ⇒ the round runs normally, with the feed reported as read-and-empty
    AC (a): 0 events ⇒ state=verified, 9 spawn(s), offered=0
✔ AC (b) — more events than the limit ⇒ capped, and the remainder is picked up next round
    AC (b): limit=3 over 7 events ⇒ rounds offered 3+2+2, union = all 7, 0 lost
✔ AC (c) — a crash before the append ⇒ the next round re-offers the SAME events (at-least-once)
    AC (c): crashed round offered 3; next round re-offered the SAME 3; round 3 deduped the boundary by eventId
✔ AC (d) — `complete:false` reaches the prompt VERBATIM (the surface's own reason text)
    AC (d): 1 coverage reason(s) reached the prompt verbatim
✔ AC (d) — `rebase:true` reaches the prompt VERBATIM (a cursor the carrier cannot honour)
    AC (d): rebase reason reached the prompt verbatim (214 chars)
✔ AC (e) — no code path skips or schedules a round on the events (static control + its live mutation)
✔ AC (e) — the events change NEITHER whether the round runs NOR its model-call envelope
✔ config — `task_log_context_limit` is OPTIONAL (absent ⇒ 50) and bounded by the read surface's page maximum
✔ priorTaskLogContext / asTaskLogCursor — an UNREADABLE stored cursor is its own state, never 'no cursor' (硬规则 3b)
✔ taskLogDedupKey / citeOfferedEvents / taskLogContextDirective — pure, and 'nothing to cite' is null, not false
ℹ tests 91   ℹ pass 91   ℹ fail 0
```

每条断言**能取假**的形态（不是「验过了」同形）：

- (a) 载体**存在但空**（`exists:true`、0 行），不是「缺席」——两种读数必须分得开；断言 `read.ok === true` 且 `offered_count === 0`，同时断言 spawn > 0。
- (b) 7 条**真实**事件（时钟内核 `appendTaskStatusEvent` 写入，非手写 JSONL 行）；`task_log_context_limit: 3`。断言轮 1 `offered === [T-0,T-1,T-2]` 且 `truncated === true`；三轮并集 == 全部 7 条，且 **7 个 eventId 互不相同** ⇒ 无丢、无重。
- (c) 第 1 轮在 model seam 抛错 ⇒ `state:"failed"` 且**载体文件不存在**（未 append ⇒ 未存 cursor）。第 2 轮 offered 的 **eventId 逐字等于**测试**独立**调用 `readTaskLog` 得到的 id 序列 ⇒ 「同一批事件」是与**契约**比，不是与自己的记录比（不是自证）。第 3 轮 `deduped_by_event_id === 1`（at-least-once 的边界事件按 eventId 去重）。
- (d) 期望字符串由测试**独立**调 `readTaskLog` 取得（coverage.reasons / rebaseReason），再断言 `prompt.includes(...)` **逐字**命中——不是断言「prompt 里有没有『incomplete』字样」。
- (e) 静态控制（读源码）：`readTaskLog(` 全文**恰 1 次**；owner 函数体内**不含** `return fact(`/`isDue`/`halted`/`spawn`；全文无 `if (<context>) return fact(` 形态，且**同谓词正控制**（注入的 gate 文本确实命中该正则，证明零不是「正则不会命中」）；全文不出现原始载体文件名（不直读文件）。另有行为控制：0 事件与 12 事件两轮 `model_calls` 与 spawn 数**相同**。

### AC2 — 负控制：0 事件时让轮次跳过 ⇒ (a) 红（粘贴）

在 scratch 副本注入 `if (taskLogContext.offered_count === 0) return fact("not-evaluated", …, "no task-status events — nothing spawned");` 后，同一 fixture：

```
✔ NEGATIVE CONTROL (a) — make the round SKIP when there are 0 events in a scratch copy ⇒ (a) goes RED
    NEGATIVE CONTROL (a): mutant spawned 0 calls with 0 events (claim was «the round still runs»)
```

对照（同 fixture、真模块）：`state=verified`、spawn **9** 次；mutant：`state=not-evaluated`、spawn **0** 次 ⇒ (a) 的断言被证伪，控制是活的。

### scoped 门（`--allow-thin`，driver fan-in 同款）

```
$ bash scripts/test.sh --for-task gap-open-discovery-consumes-task-status-events-optional-context --allow-thin
EXIT=0
ℹ tests 91   ℹ pass 91   ℹ fail 0
```

### 实现要点（供复核，非判据）

- 读面 = Core 的 `readTaskLog`（`quay task log` 发布的同一 reader），**不直读载体文件**——paging/cursor/epoch/coverage 契约只有一份。静态 import 的 bundle 代价**先量后采纳**：唯一内联本模块的 bundle（`quality-gate-driver.js`）**+17.8 KB**（其 kernel 闭包已由 ready-pool-check.ts 内联），不是 plugin-core-import 记忆警告的 24×。
- cursor 存在**与轮次同一次 append** 的 carrier 行上（`task_log` 块）⇒ 崩溃在 append 之前的轮次不留下 cursor，下一轮重读同一窗口（at-least-once）；跨健康序列经 eventId 去重后为**恰好一次**。
- v0 记录没有 eventId ⇒ 用 carrier 位置做去重键，**绝不编造** eventId（硬规则 6）。
- 存下的 cursor **在场但读不懂**时单独报 `cursor_before_unreadable: true`，不与「没有 cursor」同形（硬规则 3b）。
- `rebase`/`complete:false` 的理由文本**逐字**进 prompt；不完整理由比事件行多缩进一级，使两类 bullet 可按位置区分。
- 上下文在**两个 paired 臂与 shadow 臂的同一位置**注入 ⇒ paired 仪器的唯一差异仍是 guidance 块。
- 新 config 键 `task_log_context_limit` 为**可选**（缺席 ⇒ 50）；上界 = 读面上限（超限在 parse 处拒绝，避免「配置打错」与「读坏了」同形），下界 1（`0` 拒绝）。

### AC3 — 生产读数（待外部）

需要**落地之后**的第一个 resident 轮（其 cursor before/after、被 offer 的事件摘要、模型自述 focus 与所读文件）。该轮在本 worktree 内不存在，故不勾。

## Touches
- tasks/gap-open-discovery-consumes-task-status-events-optional-context.md
- plugin/scripts/open-semantic-discovery-routine.ts
- plugin/test/open-semantic-discovery-routine.test.mjs
