---
id: gap-meta-renderhumancallbody
title: human-call 任务必须带线首 **PARKED 标记，不得进入派发池
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
renderHumanCallBody 产出的 meta-human-call 任务不带线首 `**PARKED` 标记，而 isParked 是派发池唯一的排除半边 ⇒ 只能由人裁定、worker 结构上勾不了 AC 的裁定任务被推进 ready 派发池烧掉：2026-11-07 gap-meta-call-ac-936-goal-914-103 在 needs-human 停 31 分钟后被改 todo、29 秒后被晋升 ready、派给 worker，AC 4 条一条未勾、exited-not-landed 后回到 ready；worker kind 无重试上限（driver-filters.ts:56「worker 无重试上限 ⇒ 空集」）⇒ 每轮重派，而 AC-936 的 verdict=fail 已连续 111 轮（timeSeries goal:AC-936:verdict crossed=true），两次 meta-human-call 立案（一次停在 todo 隐形、一次在 ready 空转）都没让它到达人。

本轮读数（parking.needsHuman.counts）= `{"parking-reason-stale":0,"still-blocked":0,"no-registered-judge":4,"not-evaluated":0}`，采于 2026-11-07T06:58:37Z，由 meta-driver 机械采集。
涉及机制关键词：`renderHumanCallBody`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [ ] `node --experimental-strip-types --input-type=module -e "import { renderHumanCallBody } from './plugin/scripts/meta-driver.ts'; import { isParked } from './plugin/scripts/ready-pool-check.ts'; const item={question:'q',title:'t',options:'o',origin:'r',irreversible:'a choice that is hard to undo later',touches:'plugin/scripts/meta-driver.ts',conflict:[{source:'CLAUDE.md',quote:'x'}]}; const body=renderHumanCallBody(item,null,'2026-11-07T00:00:00Z','gap-meta-call-probe'); if(!isParked({body})){console.error('renderHumanCallBody output WOULD enter the dispatch pool');process.exit(1)} console.log('excluded-from-dispatch-pool')"` ⇒ 退出 0 且打印 excluded-from-dispatch-pool —— 证明 renderHumanCallBody 产出的任务体会被派发池自己的读取器 isParked 判为已停放，裁定任务不再被 worker 空烧；判据跑的是行为（喂真函数、用真 isParked），不是源码布局。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-renderhumancallbody.md`