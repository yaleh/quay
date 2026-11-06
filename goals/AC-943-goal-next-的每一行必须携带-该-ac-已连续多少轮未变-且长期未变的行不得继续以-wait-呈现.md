---
id: AC-943
title: goal next 的每一行必须携带「该 AC 已连续多少轮未变」，且长期未变的行不得继续以 wait 呈现
status: draft
kind: criterion
goal: GOAL-914
criterion: "node -e \"const{execSync}=require('child_process');const
  rows=JSON.parse(execSync('node --experimental-strip-types
  packages/quay/bin/quay.ts goal next --root .
  --json',{encoding:'utf8',stdio:['ignore','pipe','ignore']}));if(!Array.isArra\
  y(rows)||rows.length<1){console.error('goal next returned no rows
  array');process.exit(1)}const noField=rows.filter(r=>typeof
  r.unchangedRounds!=='number');if(noField.length>0){console.error('rows without
  a numeric unchangedRounds:
  '+noField.map(r=>r.goal+'/'+r.ac).join(','));process.exit(1)}const
  stillWaiting=rows.filter(r=>r.unchangedRounds>=8&&r.action&&r.action.kind==='\
  wait');if(stillWaiting.length>0){console.error('persistently waiting rows not
  escalated:
  '+stillWaiting.map(r=>r.goal+'/'+r.ac+'@'+r.unchangedRounds).join(','));proce\
  ss.exit(1)}console.log(JSON.stringify({rows:rows.length,maxUnchangedRounds:Ma\
  th.max(...rows.map(r=>r.unchangedRounds))}))\""
expect: 每个 active GOAL 的投影行都带数字型 unchangedRounds；连续 ≥8 轮未变的行不再以 owner=world /
  action.kind=wait 呈现，而是升级为需要人动作的取值——于是「刚在等」与「卡住了」在投影面上可区分，而不是第 1 轮与第 53
  轮输出逐字相同。
origin: timeSeries `goal:AC-936:verdict` = unchanged / value=fail / count=53 /
  crossed=true（threshold 8），而本轮 `divergences` 为 [] ——「active AC 判据长期失败」不属于任何既有
  divergence kind，于是连续 53
  轮的持续红没有任何读面消费它。读代码确认缺的正是持久度这一维：`GoalNextRow`（packages/quay/src/core/goal-analysis.ts:268）只有
  goal/ac/gapState/rank/owner/action/evidenceRefs/blocker；`world-gated` 的映射是固定的
  owner=world / kind=wait（同文件 :285），`readGoalNextCarrier` 只读最近一轮 fact ⇒ 第 1 轮与第
  53 轮的行逐字相同。既有 AC-935 / tasks/gap-goal-next-projection.md 只覆盖 owner/action
  的形状与排序，未覆盖「持续多久」，故本条件是追加而非重复。
---
