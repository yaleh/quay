---
id: AC-237
title: 失败判据必须可归因——goal gate 记录的失败 reason 必须携带判据自身写出的成因，⛔ 不得只留 exit 1
status: achieved
kind: criterion
goal: GOAL-009
criterion: "node --no-warnings --experimental-strip-types -e 'const
  fs=require(\"fs\"),os=require(\"os\"),path=require(\"path\"),cp=require(\"chi\
  ld_process\");const d=fs.mkdtempSync(path.join(os.tmpdir(),\"ac237-\"));const
  die=m=>{try{fs.rmSync(d,{recursive:true,force:true})}catch(e){}console.error(\
  m);process.exit(1)};const
  g=p=>path.join(d,\"goals\",p);fs.mkdirSync(path.join(d,\"goals\"));fs.writeFi\
  leSync(g(\"GOAL-999.md\"),\"---\\nid: GOAL-999\\ntitle: fixture\\nstatus:
  active\\nkind: goal\\norigin: probe\\nbody: |\\n  probe\\n---\\n\");const
  mk=(id,crit)=>fs.writeFileSync(g(id+\".md\"),\"---\\nid: \"+id+\"\\ntitle:
  fixture\\nstatus: active\\nkind: criterion\\ngoal: GOAL-999\\ncriterion:
  \\\"\"+crit+\"\\\"\\nexpect: fixture\\norigin:
  probe\\n---\\n\");mk(\"AC-901\",\"echo CAUSE-TOKEN >&2; exit
  1\");mk(\"AC-902\",\"exit 1\");const run=id=>{const
  r=cp.spawnSync(process.execPath,[path.join(process.cwd(),\"packages/quay/bin/\
  quay.js\"),\"goal\",\"gate\",id,\"--root\",d,\"--json\"],{encoding:\"utf8\"})\
  ;let j;try{j=JSON.parse(r.stdout)}catch(e){die(\"CAUSE=gate-json-unparseable
  exit=\"+r.status+\"
  stdout=\"+JSON.stringify(String(r.stdout).slice(0,200)))}return j};const
  a=run(\"AC-901\");if(a.verdict!==\"fail\"){die(\"CAUSE=fixture-with-stderr-no\
  t-fail
  verdict=\"+a.verdict)}if(!String(a.reason).includes(\"CAUSE-TOKEN\")){die(\"C\
  AUSE=reason-lost-criterion-stderr
  reason=\"+JSON.stringify(a.reason))}if(!String(a.event&&a.event.payload&&a.ev\
  ent.payload.reason).includes(\"CAUSE-TOKEN\")){die(\"CAUSE=recorded-event-los\
  t-criterion-stderr event=\"+JSON.stringify(a.event&&a.event.payload))}const
  b=run(\"AC-902\");if(!String(b.reason).includes(\"criterion wrote no
  output\")){die(\"CAUSE=zero-output-cause-not-distinguished
  reason=\"+JSON.stringify(b.reason))}if(String(b.reason).includes(\"CAUSE-TOKEN\
  \")){die(\"CAUSE=zero-output-echoes-token
  reason=\"+JSON.stringify(b.reason))}try{fs.rmSync(d,{recursive:true,force:tru\
  e})}catch(e){}process.exit(0)'"
expect: 一个失败判据的 reason 含它自己写到 stderr 的成因文本 ⇒ 失败可定向（是「无证据」还是「证据过期」），而不是只剩一个退出码
origin: '本轮读数：criteria[AC-214].verdict=fail 且 reason="acceptance failed (exit
  1)"，而同一读数里 AC-214 的 criterion 自身用 stderr 区分两种失败（"no evidence yet: %s" 与 "stale
  evidence: %s"，两者都 exit 1）；timeSeries["goal:AC-214:verdict"].count=720 /
  crossed=true / threshold=8 ⇒ 该 AC 已连续 720 轮同值红灯，而读数结构上无法判因（缺证据=刷新机制没跑 vs
  证据过期=需重跑跨机验证，两种截然不同的处置）。本轮我因此无法定向任何东西。'
activatedAt: 2026-09-11T03:11:40.607Z
statusLog:
  - at: 2026-09-11T03:11:40.607Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-11T03:40:24.638Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-09-11T03:11:40.607Z
---
