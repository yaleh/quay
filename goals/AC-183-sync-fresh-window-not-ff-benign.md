---
id: AC-183
title: sync 载体 fresh window 内每条 not-ff 事件必须带 benign——防陈旧写者污染读数
status: retired
kind: criterion
goal: GOAL-001
criterion: tail -200 .quay/doc-develop-sync.jsonl | jq -es '[.[] |
  select(.event=="doc-develop-sync-not-ff")] | (length > 0) and
  all(has("benign"))'
expect: 最近 200 条同步事件里 not-ff 至少一条且全部可解读（带 benign）⇒ 生产载体上无旧格式写者污染读数
origin: 职能移交到套件（gap-standing-invariants-not-reevaluated-move-to-suite）：sync 载体
  not-ff 事件必带 benign 已作为常驻断言 plugin/test/goal-invariants-standing.test.mjs
  每轮真跑；goal 层全绿即关闭不再复验，故 retired
---
