---
id: AC-934
title: 立案生命周期：spawn→filed/not-filed 的可核实终态
status: draft
kind: criterion
goal: GOAL-914
criterion: node -e "const fs=require('fs');const
  p='.quay/goal-filing.jsonl';if(!fs.existsSync(p)){console.error('no
  goal-filing ledger');process.exit(1)};const
  rows=fs.readFileSync(p,'utf8').split('\n').filter(Boolean).map(s=>{try{return
  JSON.parse(s)}catch{return null}}).filter(Boolean);const
  spawned=rows.filter(r=>r.state==='spawned');const term=new
  Set(rows.filter(r=>r.state==='filed'||r.state==='not-filed').map(r=>r.requestId));const
  open=spawned.filter(r=>!term.has(r.requestId));const
  filed=rows.filter(r=>r.state==='filed');if(spawned.length<1||filed.length<1||open.length>0){console.error(JSON.stringify({spawned:spawned.length,filed:filed.length,open:open.length}));process.exit(1)};console.log(JSON.stringify({spawned:spawned.length,filed:filed.length,open:0}));"
expect: exit 0；.quay/goal-filing.jsonl 中至少 1 条真实 spawn 对应一条 filed 终态，且不存在仍 open
  的 spawned 行；not-filed 是与 filed 不同的独立取值（任务负控）。台账由实现创建，故任何行都在落地之后。
origin: 人 2026-11-06 授权；证据：goal-driver 只记
  gap_spawns[].exitCode，明写不验证立案（plugin/scripts/goal-driver.ts:3057），无法区分 agent
  未立案 / 未写 goal_ac / 已被去重。
---
本 AC 由 gap-goal-driver-filing-ledger 与 gap-goal-driver-filing-throttle 两个任务实现。