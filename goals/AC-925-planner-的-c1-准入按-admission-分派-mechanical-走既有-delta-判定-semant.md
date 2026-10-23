---
id: AC-925
title: Planner 的 C1 准入按 admission 分派：mechanical 走既有 delta 判定，semantic-judged
  走两段管线（mechanical 不直接确认）
status: active
kind: criterion
goal: GOAL-911
criterion: node --test plugin/test/admission-dispatch.test.mjs
expect: 正向：`plugin/test/admission-dispatch.test.mjs` 全绿（criterion exit 0），断言：(1)
  对一个 `admission:"mechanical"` 的 kind，C1 准入走既有 delta 判定路径，不进入两段管线、不调用判断器；(2) 对一个
  `admission:"semantic-judged"` 的 kind，C1 准入走两段管线（线索器 → 判断器），且 mechanical
  路径不直接确认；(3) 分派由 registry 的 `admission` 值决定，而不是 kind 名硬编码。反向（能取假）：把任一条目的
  `admission` 改成相反值 ⇒ 分派路径翻转、测试红；让两类都走同一路径 ⇒ 测试红；删掉测试文件 ⇒ criterion exit 1。
origin: gap-meta-call-ac-918-goal-911：AC-918/AC-921/AC-923 都不测「Planner 按
  admission 分派」这半条断言；AC-918 标 superseded 后，该半条断言由本 AC 明确承接（人 2026-10-23 裁定选项 2）。
activatedAt: 2026-10-23T07:24:37.654Z
---
