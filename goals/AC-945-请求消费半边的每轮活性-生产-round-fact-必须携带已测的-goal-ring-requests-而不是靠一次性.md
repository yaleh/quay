---
id: AC-945
title: 请求消费半边的每轮活性：生产 round fact 必须携带已测的 goal-ring.requests，而不是靠一次性静态台账
status: achieved
kind: criterion
goal: GOAL-914
criterion: "node -e \"const fs=require('fs');const
  L=fs.readFileSync('.quay/goal-round.jsonl','utf8').split('\\n').filter(Boolea\
  n);if(!L.length){console.error('no goal-round records');process.exit(1)}const
  usable=(j)=>{if(!j||typeof j!=='object')return false;const
  ring=(j.facts||[]).find(f=>f&&f.name==='goal-ring');const
  v=ring&&ring.value;const hasData=!!(v&&typeof
  v==='object'&&(Array.isArray(v.criteria)||(v.requests&&typeof
  v.requests==='object')));return !j.stopped_mid_round||hasData};let
  pick=null;for(let i=L.length-1;i>=0;i--){let
  j;try{j=JSON.parse(L[i])}catch(e){continue}if(usable(j)){pick=j;break}}if(!pi\
  ck){console.error('no completed goal-round to read');process.exit(1)}const
  ring=(pick.facts||[]).find(f=>f&&f.name==='goal-ring');const
  r=ring&&ring.value&&ring.value.requests;if(!r||typeof
  r!=='object'){console.error('no request-consumer reading in the last completed
  round (round
  '+pick.round+')');process.exit(1)}if(r.evaluated!==true){console.error('consu\
  mer not measured:
  '+JSON.stringify({evaluated:r.evaluated,cause:r.cause}));process.exit(1)}if(A\
  rray.isArray(r.errors)&&r.errors.length>0){console.error('consumer errors:
  '+JSON.stringify(r.errors));process.exit(1)}console.log(JSON.stringify({evalu\
  ated:r.evaluated,openBefore:r.openBefore,appended:r.appended}))\""
expect: 最新一轮生产 goal-round 的 goal-ring.requests 为 evaluated:true 且 errors 为空 ⇒
  消费通道本轮真的跑过并被测到；维度缺席、未测或写失败即红（三态，⛔ 不是布尔）
origin: criteria.AC-936 的判据只读静态文件 .quay/goal-requests.jsonl：一旦出现一条带 consumedAt
  的终态行就永久为绿，之后消费通道停摆/报错也无人发现（结构上此后取不了假）。timeSeries key goal:AC-936:verdict
  count=69 crossed=true 说明消费半边在生产上至今一次未被行使。生产 round fact 已每轮写
  goal-ring.requests（本轮实测 {evaluated:true,openBefore:0,appended:0}），但没有任何 AC
  读它——生产者有、消费者无。
activatedAt: 2026-11-06T23:48:56.985Z
statusLog:
  - at: 2026-11-06T23:48:56.985Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-11-06T23:51:34.598Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-11-06T23:48:56.985Z
---
