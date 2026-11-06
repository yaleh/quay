---
id: AC-936
title: goal request 队列：提交、消费、幂等
status: draft
kind: criterion
goal: GOAL-914
criterion: node -e "const fs=require('fs');const
  p='.quay/goal-requests.jsonl';if(!fs.existsSync(p)){console.error('no
  goal-requests ledger');process.exit(1)};const
  rows=fs.readFileSync(p,'utf8').split('\n').filter(Boolean).map(s=>{try{return
  JSON.parse(s)}catch{return null}}).filter(Boolean);const
  done=rows.filter(r=>r.state==='accepted'||r.state==='refused'||r.state==='not-evaluated');if(done.length<1){console.error(JSON.stringify({rows:rows.length,consumed:0}));process.exit(1)};const
  ids=done.map(r=>r.requestId);if(new
  Set(ids).size!==ids.length){console.error('duplicate terminal outcomes for the
  same requestId');process.exit(1)};if(!done.every(r=>typeof
  r.consumedAt==='string'&&r.consumedAt.length>0)){console.error('missing
  consumedAt');process.exit(1)};console.log(JSON.stringify({rows:rows.length,consumed:done.length,last:done[done.length-1].requestId}));"
expect: exit 0；.quay/goal-requests.jsonl 中至少一条 submitted 请求被消费为
  accepted/refused/not-evaluated，记录带 requestId 与 consumedAt；同一 requestId
  重放不产生第二条终态。
origin: 人 2026-11-06 授权；证据：消费者侧 goal-reconcile 通道 10 条 submitted 无消费者且 goalId 写成
  AC id（仅作证据）；本 AC 在 quay 侧建自己的请求队列。
---
本 AC 由 gap-goal-request-queue 实现。