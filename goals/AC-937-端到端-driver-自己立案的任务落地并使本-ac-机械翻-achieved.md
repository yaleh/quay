---
id: AC-937
title: 端到端：driver 自己立案的任务落地并使本 AC 机械翻 achieved
status: active
kind: criterion
goal: GOAL-914
criterion: node -e "const fs=require('fs');const rootRe=/^tasks$/;const
  names=fs.readdirSync('.').filter(n=>rootRe.test(n));if(names.length!==1){console.error('tasks
  dir missing');process.exit(1)};const
  p='.quay/goal-filing.jsonl';if(!fs.existsSync(p)){console.error('no
  goal-filing ledger');process.exit(1)};const
  rows=fs.readFileSync(p,'utf8').split('\n').filter(Boolean).map(s=>{try{return
  JSON.parse(s)}catch{return null}}).filter(Boolean);const
  filed=rows.filter(r=>r.state==='filed'&&r.ac==='AC-937');if(filed.length<1){console.error('no
  driver-filed task for AC-937');process.exit(1)};const
  fileRe=/^tasks\/[^/]+\.md$/;const
  taskFiles=fs.readdirSync('tasks').map(f=>'tasks/'+f).filter(p=>fileRe.test(p));const
  landed=taskFiles.some(p=>{const t=fs.readFileSync(p,'utf8');return
  /^goal_ac:\s*AC-937\s*$/m.test(t)&&/^status:\s*done\s*$/m.test(t)});if(!landed){console.error('driver-filed
  task for AC-937 not
  done');process.exit(1)};console.log(JSON.stringify({filed:filed.length,landed:true}));"
expect: "exit 0；.quay/goal-filing.jsonl 中有 AC-937 的 filed 行；tasks/ 中存在 goal_ac:
  AC-937 且 status: done 的任务；该任务不是预置（由 driver 的 gap-filing 产生）。"
origin: 人 2026-11-06 授权；本条故意不预置任务，作为 driver 自己立案路径的直接量。
activatedAt: 2026-11-06T07:24:51.179Z
statusLog:
  - at: 2026-11-06T07:24:51.179Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-11-06T07:24:51.179Z
---
本 AC 故意不分配实现任务：driver 必须在没有预置任务时自己立案，任务落地后由 driver 机械翻 achieved。