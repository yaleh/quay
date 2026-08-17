---
id: gap-outer-tick-log-cross-midnight-monotonic
title: "outer-tick-log-check 单调判据无跨日宽限——23:5x→00:0x 标签判 non-monotonic 假红（future-label 有宽限，单调没有）"
status: ready
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

- [x] AC1: 单调判据加跨日宽限（对称 future-label 的 `:304` 逻辑）：PREV_HEADER 为 22-23h 且 TICK_TIME 为 00-01h ⇒ 是跨日（新一天），⛔ 不判 non-monotonic。取假：同一天内 PREV_HEADER > TICK_TIME（如 23:57→23:58 反向）仍必须判 non-monotonic。
- [x] AC2: 跨日边界（23:5x → 00:0x）不再假红——构造该场景的 fixture，checker 应 PASS 而非 FAIL/non-monotonic。
- [x] AC3: 修复后跨日条目可用裸 HH:MM 标签（⛔ 不需 date-prefix workaround），日期仍可从 mtime 或上下文推出。

## Definition of Done

- [x] 单调判据有跨日宽限（对称 future-label），跨午夜不假红；date-prefix workaround 不再需要。

## Touches

- plugin/scripts/outer-tick-log-check.sh（单调判据跨日宽限）
- plugin/test/outer-tick-log-check.test.mjs（跨日 fixture）
- tasks/gap-outer-tick-log-cross-midnight-monotonic.md（自身）

## Evidence

**修法（`plugin/scripts/outer-tick-log-check.sh` 单调判据，`:313` 对称 future-label `:304`）**：`PREV_HEADER > TICK_TIME` 时，剥前导零取整两段小时数（`00` ⇒ `0`），仅当 `PREV_HH_INT < 22 || TICK_HH_INT >= 2` 才判 `non-monotonic`——即 PREV 22-23h 且 TICK 00-01h 视为跨日翻转（新一天）跳过。HH=00 剥零取整（`${HH#0}` 空则 `:-0` 兜底）使同一天凌晨 00:xx→00:yy 反向仍判红（避免 future-label 同款空串整数比较的坑）。

**新增 3 条测试（`plugin/test/outer-tick-log-check.test.mjs`，AC1/AC2/AC3 直接钉住）**：
- `时间标签 跨日：PREV 23:5x → TICK 00:0x ⇒ PASS`（跨日宽限，2026-08-17 00:04Z 实证形状；mtime 固定 00:30 使 future 判据不抢跑）
- `时间标签 跨日宽限取假：同一天深夜 23:58 → 23:57 反向 ⇒ 仍 RED`（TICK 23:57 不在 00-01h ⇒ 宽限不得吞掉同天反向）
- `时间标签 跨日宽限取假：同一天凌晨 00:57 → 00:04 反向 ⇒ 仍 RED`（HH=00 剥零取整后 PREV_HH_INT=0 < 22 ⇒ 仍判红）

**scoped 门**：
```
$ bash scripts/test.sh --for-task gap-outer-tick-log-cross-midnight-monotonic --allow-thin
→ EXIT=0；24 tests / 24 pass / 0 fail
  （含既有 future/非单调时间标签判据 + 3 条新跨日 fixture；scoped 静态检查全 PASS）
```

**AC3 判据（裸 HH:MM 标签可跨日，不需 date-prefix）**：跨日 fixture 用裸 `23:57Z`/`00:04Z` 标签即 PASS（status 0），TICK_TIME 正则（`^\- \`[0-9]{2}:[0-9]{2}Z?\``）正常匹配——无需 `2026-08-17 00:04Z` 前缀 workaround。日期可从 mtime（log 文件写入时刻）推出。
