---
id: AC-183
title: sync 载体 fresh window 内每条 not-ff 事件必须带 benign——防陈旧写者污染读数
status: draft
kind: criterion
goal: GOAL-001
criterion: tail -200 .quay/doc-develop-sync.jsonl | jq -es '[.[] |
  select(.event=="doc-develop-sync-not-ff")] | (length > 0) and
  all(has("benign"))'
expect: 最近 200 条同步事件里 not-ff 至少一条且全部可解读（带 benign）⇒ 生产载体上无旧格式写者污染读数
origin: readings 中 syncHealth.notFf=133；读 .quay/doc-develop-sync.jsonl 见 133 条
  not-ff 里约 66 条是旧格式 {ts,event,phase,branch}（无 ahead/behind/benign），时间戳 ~23:00Z
  比 gap-meta-syncdeveloptodoc 落点 55805b257(12:43:59Z) 晚约 10h ⇒ 有陈旧写者仍在跑修复前代码
evidence:
  at: 2026-09-06T23:17:26.812Z
  verdict: fail
  reading: acceptance failed (exit 1)
---
