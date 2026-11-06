---
id: AC-942
title: GOAL-914 的立案任务链不得停在一条「unpark 检查已通过却仍是 PARKED」的任务后面
status: achieved
kind: criterion
goal: GOAL-914
criterion: "node -e \"const{execSync}=require('child_process');const
  fs=require('fs');const r=JSON.parse(execSync('node --experimental-strip-types
  plugin/scripts/needs-human-parking-recheck.ts --root .
  --json',{encoding:'utf8'}));const
  ids=((r.parked&&r.parked.entries)||[]).map(e=>e.id);const
  bad=ids.filter(id=>{const f='tasks/'+id+'.md';if(!fs.existsSync(f))return
  false;return
  /^goal_ac:\\s*AC-/m.test(fs.readFileSync(f,'utf8'))});if(bad.length>0){consol\
  e.error('goal-linked tasks are unpark-passed yet still parked:
  '+bad.join(','));process.exit(1)}console.log(JSON.stringify({unparkPassed:ids\
  .length,goalLinkedStuck:0}))\""
expect: 没有任何带 goal_ac 的任务处于「自身的 unpark 检查已通过、却仍挂着 PARKED
  标记」的状态；一旦出现即红，把「读数是绿的但没人在下游消费」这一形态变成可失败的量。
origin: '本轮 readings 的 parking.parked.entries[1] =
  {id:"gap-goal-driver-filing-ledger", state:"unpark-passed", exitCode:0,
  output:"landed"}，note 逐字写着「unpark check PASSES today … but the task is still
  PARKED」；该任务 frontmatter 是 goal_ac: AC-934、status: ready，且它是
  tasks/gap-goal-driver-filing-throttle（→ gap-goal-next-projection →
  gap-goal-driver-blocked-taxonomy → gap-goal-request-queue）与
  gap-goal-filing-chain-audit 的共同 depends_on 根。同一 readings 的 timeSeries 显示
  AC-935/936/937/939 的 verdict 已连续 32/32/34/21 轮不变且 crossed=true（阈值 8）。现有 8 条 AC
  只量「结果态」，没有一条量「goal 自己立的任务链是否可动」，因此这个停滞在 goal 层是不可见的。'
activatedAt: 2026-11-06T16:52:36.657Z
statusLog:
  - at: 2026-11-06T16:52:36.657Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-11-06T16:58:59.815Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-11-06T16:52:36.657Z
---
