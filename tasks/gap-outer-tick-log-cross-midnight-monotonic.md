---
id: gap-outer-tick-log-cross-midnight-monotonic
title: "outer-tick-log-check 单调判据无跨日宽限——23:5x→00:0x 标签判 non-monotonic 假红（future-label 有宽限，单调没有）"
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：outer 2026-08-17 00:04Z（跨日边界实证）。

**问题**：`plugin/scripts/outer-tick-log-check.sh` 的**单调判据**（`:313` `PREV_HEADER > TICK_TIME ⇒ non-monotonic`）**没有跨日宽限**，而 **future-label 判据（`:304`）有**（`mtime 00-01h 且标签 22-23h ⇒ 前一天，跳过`）。跨午夜时（23:5x → 00:0x），HH:MM 字符串比较 23:57 > 00:04 ⇒ 假红 `non-monotonic:23:57>00:04`。

**实证（2026-08-17 00:04Z）**：最后一个 Aug-16 条目标签 `23:57Z`，新的一天第一个条目 `00:04Z` ⇒ 单调判据判 non-monotonic（FAIL exit 1）。**该日期边界之前（08-15→08-16）曾用 `4ca03fc4` 修过 future-label 的跨日，但单调判据漏了对称修法**（硬规则 5b 形态：修了被报的那一处，没 grep 同一原则的其它适用点——future 和 monotonic 是相邻两条判据）。

**工作区**（跨日时诚实但 checker 看不了）：date-prefix 标签（`2026-08-17 00:04Z`）⇒ TICK_TIME 正则（`^\- \`[0-9]{2}:[0-9]{2}Z?\``）不匹配 ⇒ TICK_TIME 空 ⇒ 判据跳过 ⇒ NOT-EVALUATED（exit 0 不挡门，但该条目不被判）。**这是 workaround 非修法**——会藏起跨日条目的判定。

## Acceptance Criteria

- [ ] AC1: 单调判据加跨日宽限（对称 future-label 的 `:304` 逻辑）：PREV_HEADER 为 22-23h 且 TICK_TIME 为 00-01h ⇒ 是跨日（新一天），⛔ 不判 non-monotonic。取假：同一天内 PREV_HEADER > TICK_TIME（如 23:57→23:58 反向）仍必须判 non-monotonic。
- [ ] AC2: 跨日边界（23:5x → 00:0x）不再假红——构造该场景的 fixture，checker 应 PASS 而非 FAIL/non-monotonic。
- [ ] AC3: 修复后跨日条目可用裸 HH:MM 标签（⛔ 不需 date-prefix workaround），日期仍可从 mtime 或上下文推出。

## Definition of Done

- [ ] 单调判据有跨日宽限（对称 future-label），跨午夜不假红；date-prefix workaround 不再需要。

## Touches

- plugin/scripts/outer-tick-log-check.sh（单调判据跨日宽限）
- plugin/test/outer-tick-log-check.test.mjs（跨日 fixture）
- tasks/gap-outer-tick-log-cross-midnight-monotonic.md（自身）
