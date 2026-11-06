---
id: AC-939
title: "端到端 AC 必须绑定 goal-filing 台账自己记下的 taskId，而不是任意带 goal_ac: AC-937 的任务"
status: draft
kind: criterion
goal: GOAL-914
criterion: node -e "const fs=require('fs');const
  p='.quay/goal-filing.jsonl';if(!fs.existsSync(p)){console.error('no
  goal-filing ledger');process.exit(1)};const
  rows=fs.readFileSync(p,'utf8').split('\n').filter(Boolean).map(s=>{try{return
  JSON.parse(s)}catch{return null}}).filter(Boolean);const
  filed=rows.filter(r=>r.state==='filed'&&r.ac==='AC-937');if(filed.length<1){console.error('no
  filed row for AC-937');process.exit(1)};const ids=[...new
  Set(filed.map(r=>r.taskId).filter(v=>typeof
  v==='string'&&v))];if(ids.length<1){console.error('filed rows carry no
  taskId');process.exit(1)};const pending=ids.filter(id=>{const
  f='tasks/'+id+'.md';if(!fs.existsSync(f))return true;const
  t=fs.readFileSync(f,'utf8');return
  !(/^goal_ac:\s*AC-937\s*$/m.test(t)&&/^status:\s*done\s*$/m.test(t))});if(pending.length>0){console.error(JSON.stringify({filedTaskIds:ids,pending}));process.exit(1)};console.log(JSON.stringify({filedTaskIds:ids,allDone:true}));"
expect: "exit 0 当且仅当台账里 ac=AC-937 的每条 filed 行所记的 taskId 对应的 task 文件存在、带 goal_ac:
  AC-937 且 status: done；其它任何带该标签的任务（例如一份结论为『链路是坏的』的审计任务）不能顶替它把 AC 翻绿。"
origin: "readings 的 criteria 里 AC-937 verdict=fail、reason=『driver-filed task for
  AC-937 not done』，而它的 criterion 在判定 landed 时用的是 `taskFiles.some(...)` —— 扫描
  tasks/ 下**全部**任务文件，任一文件带 goal_ac: AC-937 且 status: done 即通过，从不核对该 done 任务是不是台账
  filed 行里的 taskId。今天这两个集合恰好重合：.quay/goal-filing.jsonl 的 filed 行记下
  taskId=gap-goal-filing-chain-audit，而 tasks/gap-goal-filing-chain-audit.md
  本身正是一份『filed 行的 taskId 与任务落地状态交叉核对』的审计任务，且它带 goal_ac: AC-937 ——
  也就是说，一份结论可以是『链路不成立』的审计任务只要被标 done，就会把本 goal 唯一的端到端 AC 翻成 achieved。AC-938 已经为
  AC-934 记录过同一类自欺（绿来自台账文件而非产出它的代码），本条是同一缺陷在相邻一条 AC 上的实例，所以它要的是【持续判据】而不是再做一次性的
  taskId 交叉核对（后者已由 gap-goal-filing-chain-audit
  承担，本提案不复做，只把它变成每轮都会失败的测量）。本条只声明替代关系；是否退役 AC-937 仍由人裁定。"
supersedes:
  - AC-937
---
