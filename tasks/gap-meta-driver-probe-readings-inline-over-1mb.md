---
id: gap-meta-driver-probe-readings-inline-over-1mb
title: meta-driver probe 每轮 >1MB readings JSON 整段内联 fresh prompt——改机械预聚合/只发
  delta/落盘惰性 Read
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/scripts/meta-driver.ts:2372` `buildProbePrompt` 把 `JSON.stringify(readings)` 整段内联进 probe prompt。readings 实测可 >1MB（`gap-launchargv-prompt-in-argv-exceeds-max-arg-strlen` 已把它从 argv 挪到 stdin，done——但仍是每轮全新 fresh input）。全量扫描显示 quay-meta-driver = 470M fresh_in（22 轮 × 717 会话），是 driver 全量 fresh_input（2.76B）里最大的一块，且它本该是「读数→判读」里的算术量，不该按 1× fresh 计费。修法三选一或组合：机械预聚合（只发关键字段摘要）、只发与上一轮的 delta、或把 readings 落盘让 probe 惰性 Read 而 prompt 里只给路径+指针。

## Plan

1. 先落一个合成大 readings fixture 的基线：当前 buildProbePrompt 输出长度。
2. 实现：readings 改为落盘（如 `.quay/meta-driver-readings-<ts>.json`）+ prompt 只带路径与「按需 Read」指令；或对 readings 做机械预聚合，只把判读所需的最小字段内联。
3. 保持 `parseProbeOutput` 输出形状不变（probe 返回 proposals/autoDrive/decisions/metaRecordOpinions 的结构不因输入瘦身而丢字段）。

## Acceptance Criteria

- [ ] AC1 用合成大 readings fixture 断言 buildProbePrompt 输出字符数较基线下降 ≥ 80%（或 <50KB，取更严者，实现时贴实际读数）。
- [ ] AC2 真实一轮 meta-driver probe 跑通，parseProbeOutput 仍产出与改动前同构的 proposals/autoDrive/decisions/metaRecordOpinions（贴解析结果或 parity 测试）。
- [ ] AC3 probe prompt 不再内联完整 readings JSON（grep 证明 prompt 里只有路径/摘要，无全量 JSON）。

## Definition of Done

- AC1–AC3 带真实证据勾选；readings 的语义完整读法仍可达（落盘文件或 delta 可还原）。

## Touches
- plugin/scripts/meta-driver.ts
- plugin/probes/meta-driver.md
- plugin/test/meta-driver.test.mjs
- tasks/gap-meta-driver-probe-readings-inline-over-1mb.md