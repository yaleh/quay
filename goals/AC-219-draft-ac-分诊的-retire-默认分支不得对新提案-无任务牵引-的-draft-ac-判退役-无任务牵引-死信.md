---
id: AC-219
title: draft AC 分诊的 retire 默认分支不得对新提案（无任务牵引）的 draft AC 判退役——「无任务牵引」≠「死信」
status: needs-human
kind: criterion
goal: GOAL-010
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/goal-triage-fresh-draft-not-retire.test.mjs
expect: 一条刚提案、goal 锚合法、criterion 非空、无 posture、无任务牵引的 draft AC，分诊为 hold 或
  activate（待人工激活/补任务），而非 retire→needs-human 建议退役
origin: readings.criteria 中 AC-217 与 AC-218 均 status=needs-human 且
  verdict=fail，且 AC-218 是 criteria 表唯一 goal=GOAL-011 的条目（GOAL-011 仍 active
  却无活跃退出条件）；goals/AC-218-*.md 与 goals/AC-217-*.md 的 statusLog 显示二者 2026-09-09
  同日被 goal-driver 以「triage 判 retire：建议退役」从 draft 翻 needs-human——当天新提案补缺口的 AC 被
  triage 默认分支（goal-driver.ts:542 无任务牵引⇒retire）立刻判退役
statusLog:
  - at: 2026-09-09T11:12:07.494Z
    from: draft
    to: needs-human
    actor: goal-driver
    reason: triage 判 retire：建议退役但 retired 归人——driver 置 needs-human 交人判断
---
