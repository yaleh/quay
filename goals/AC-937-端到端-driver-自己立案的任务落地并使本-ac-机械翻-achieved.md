---
id: AC-937
title: 端到端：driver 自己立案的任务落地并使本 AC 机械翻 achieved
status: draft
kind: criterion
goal: GOAL-914
criterion: node -e "const fs=require('fs');const
  p='.quay/goal-filing.jsonl';if(!fs.existsSync(p)){console.error('no
  goal-filing ledger');process.exit(1)};const
  rows=fs.readFileSync(p,'utf8').split('\n').filter(Boolean).map(s=>{try{return
  JSON.parse(s)}catch{return null}}).filter(Boolean);const
  filed=rows.filter(r=>r.state==='filed'&&r.ac==='AC-937');if(filed.length<1){console.error('no
  driver-filed task for AC-937');process.exit(1)};const
  tasks=fs.readdirSync('tasks').filter(f=>f.endsWith('.md')).map(f=>fs.readFileSync('tasks/'+f,'utf8'));const
  landed=tasks.some(t=>/^goal_ac:\s*AC-937\s*$/m.test(t)&&/^status:\s*done\s*$/m.test(t));if(!landed){console.error('driver-filed
  task for AC-937 not
  done');process.exit(1)};console.log(JSON.stringify({filed:filed.length,landed:true}));"
expect: "exit 0；.quay/goal-filing.jsonl 中有 AC-937 的 filed 行；tasks/ 中存在 goal_ac:
  AC-937 且 status: done 的任务；该任务不是预置（由 driver 的 gap-filing 产生）。"
origin: 人 2026-11-06 授权；本条故意不预置任务，作为 driver 自己立案路径的直接量。
---
本 AC 故意不分配实现任务：driver 必须在没有预置任务时自己立案，任务落地后由 driver 机械翻 achieved。