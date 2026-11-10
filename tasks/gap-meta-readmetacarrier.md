---
id: gap-meta-readmetacarrier
title: 修复 meta-driver 的重复计数仪器：整文件读超过 V8 上限的载体时 readMetaCarrier 静默返回「没有历史」
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
`plugin/scripts/meta-driver.ts` 的 `readRoundCarrier`（被 `readMetaCarrier` 调用）用 `fs.readFileSync(path,'utf8')` 整读 `.quay/meta-driver-round.jsonl`；该载体现约 2.2 GB，超过 V8 最大字符串长度 0x1fffffe8，抛 ERR_STRING_TOO_LONG 后被 `catch { return [] }` 吞成空历史 ⇒ `computeDivergenceRecurrence` 对每条 (id,kind) 恒返回 repeatCount=0 / lastRecommendation=null，重复建议的自纠机制完全失效（本轮 readings 的 `divergences` 正是这一读数）。硬规则 3b：读不懂输入与「没有历史」同形。`tasks/gap-prod-data-audit-whole-file-read-crashes-on-carrier-over-v8-string-limit.md` 已把 `meta-driver.ts` 这一处明确标为「只上报、应单独立一条 gap」，本条即该 gap。

本轮读数（divergences）= `[{"id":"AC-936","status":"active","verdict":"fail","reason":"acceptance failed (exit 1) — no goal-requests ledger","kind":"active-but-failing","handler":{"kind":"none","state":"absent"},"repeatCount":0,"lastRecommendation":null}]`，采于 2026-11-10T02:43:34Z，由 meta-driver 机械采集。
涉及机制关键词：`readMetaCarrier`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [ ] `node --test --test-reporter=tap --test-name-pattern='oversize carrier' plugin/test/meta-driver.test.mjs | grep -qE '^# pass 1$'` ⇒ 在 `plugin/test/meta-driver.test.mjs` 新增一条确定性用例（稀疏 fixture：ftruncate 使 st_size > 0x1fffffe8、盘上仅数 KB），断言 `readMetaCarrier` 对该载体不再静默返回 `[]`——要么流式读出真实记录（非空），要么返回可区分的 unreadable/未评估信号；`# pass 1` 证明该用例确实被跑到并通过（⛔ 不是 0 条用例的空跑）。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-readmetacarrier.md`