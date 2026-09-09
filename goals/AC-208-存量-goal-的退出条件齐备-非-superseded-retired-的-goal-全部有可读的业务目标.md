---
id: AC-208
title: 存量 GOAL 的退出条件齐备——非 superseded/retired 的 GOAL 全部有可读的业务目标
status: achieved
kind: criterion
goal: GOAL-010
criterion: test "$(node --no-warnings --experimental-strip-types
  packages/quay/src/goal-store.ts list | python3 -c 'import json,sys;
  d=json.load(sys.stdin); print(sum(1 for r in d if
  str(r.get("id","")).startswith("GOAL-") and str(r.get("status")) not in
  ("superseded","retired") and len((r.get("body") or "").strip())<40))')" -eq 0
expect: 非 superseded/retired 的 GOAL 中 body<40 非空白字符的条数 == 0——每条仍在流通的 GOAL
  的业务目标（背景 / 范围与非目标 / 退出条件）在记录里可读，充分性闸（AC-212）因此有输入。
origin: >-
  9 条 GOAL 中 5 条 body 为空（GOAL-004/005/006/007/008），其中 GOAL-005/007/008 已
  achieved 且非 superseded ⇒ 业务目标从未被写下就判达成，「是否达成业务目标」结构上无从判断。body
  必填（MIN_GOAL_BODY_CHARS=40）于 2026-09-08 由
  gap-goal-record-completeness-undefined 落地，但 goal-store.ts:638 的 `if
  (!existingFile)` 把契约限定为 create-only（为放行 driver 的 status-only flip）⇒ 存量五条从未回填。本
  AC 是 AC-212 充分性闸的输入前置：没有退出条件文本，覆盖与否无从判起。



  【激活】2026-09-09 人单次授权激活。裁定：①晋升应当是语义的；放弃(retire)不交给 goal-driver，它若期望退役某条 AC 应置
  needs-human 并说明理由交人判断 ②needs-human 阻塞 GOAL 达成 ③六条 AC 分开不合并。
---
