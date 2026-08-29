---
id: gap-loop-driver-check-ac7-halt-retired-stale-assert
title: loop-driver-check AC7 断言已退役的 .halt print（head -c 80）→ develop 全库红挡所有 full-suite fan-in
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`gap-retire-halt-file-driver-based`（done）把外层「每 tick 报 `.halt` 状态」退役（`.halt` 停泊观察现归 manager 层 `manager-tick-readings.ts`；`plugin/loop/orchestrator-loop-tick.md` 已删 `head -c 80` 的 `.halt` print 行），但**没同步更新 `plugin/test/loop-driver-check.test.mjs` AC7**（:181 `tick.split('\n').find(l => l.includes('.halt') && l.includes('head -c 80'))` + `assert.ok(haltLine, 'the .halt print line must exist')`）。该测试断言那行仍存在 → develop 全库确定性红（fail 1）。

**实证**：`git show develop:plugin/loop/orchestrator-loop-tick.md | grep -c 'head -c 80'` = 0（已删）；`git show develop:plugin/test/loop-driver-check.test.mjs | grep -c 'head -c 80'` = 1（仍断言）。复现 `node --experimental-strip-types --test --test-name-pattern=AC7 plugin/test/loop-driver-check.test.mjs` → fail 1。

**根因**：跨依赖漏检（硬规则 5b）——`gap-retire-halt-file-driver-based` 的 Touches 未含 `loop-driver-check.test.mjs`（其 AC6 自称「.halt 断言同步」却漏了这份测试），scoped suite 没扫到这份交叉依赖。断言侧是 `gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes`（done）加的。

**影响**：阻塞**所有** full-suite fan-in（非单任务）。多任务已因此 exited-not-landed 多次（如 gap-suite-lane-budget-structural-guarantee 5× suite red）。

## Plan

退休是**有意且完整**的（非漏删），故修法 = **更新 AC7 匹配退役现实**（⛔ 不恢复 `head -c 80` 行）：AC7 改为断言「`.halt` print 已退役 / tick doc 不再含 `head -c 80` print」或等价地移除该过时断言（按退役说明「本层不再每 tick 报 `.halt` 状态」）。具体断言形态实现方定，但方向是「断言退役」不是「断言存在」。

## Acceptance Criteria

- [x] AC1（能取假）：develop 全库 suite 绿，AC7 不再因 `head -c 80` 缺失而红；（⛔ 仍红 ⇒ 假）。
- [x] AC2（能取假，方向对）：更新后 AC7 断言的是「退役」而非「存在」——`grep 'head -c 80' loop-driver-check.test.mjs` 不再有 `assert.ok(...must exist)` 形断言（⛔ 仍断言存在 ⇒ 假）。

## Definition of Done

AC7 匹配 `.halt` 退役现实；AC1-AC2 全勾；develop 全库 suite 绿；被此 rot 挡的任务（gap-suite-lane-budget 等）不再因它 exited-not-landed。

## Touches

- plugin/test/loop-driver-check.test.mjs（AC7 改断言退役）
- tasks/gap-loop-driver-check-ac7-halt-retired-stale-assert.md（自身）
