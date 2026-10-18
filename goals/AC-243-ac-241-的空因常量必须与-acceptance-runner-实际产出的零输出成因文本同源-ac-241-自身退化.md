---
id: AC-243
title: AC-241 的空因常量必须与 acceptance-runner 实际产出的零输出成因文本同源——AC-241 自身退化为恒绿时必须报红
status: achieved
kind: criterion
goal: GOAL-009
criterion: "node --no-warnings --experimental-strip-types -e 'const
  fs=require(\"fs\"),os=require(\"os\"),path=require(\"path\"),cp=require(\"chi\
  ld_process\");const d=fs.mkdtempSync(path.join(os.tmpdir(),\"ac243-\"));const
  die=m=>{try{fs.rmSync(d,{recursive:true,force:true})}catch(e){}console.error(\
  m);process.exit(1)};const
  g=p=>path.join(d,\"goals\",p);fs.mkdirSync(path.join(d,\"goals\"));fs.writeFi\
  leSync(g(\"GOAL-999.md\"),\"---\\nid: GOAL-999\\ntitle: fixture\\nstatus:
  active\\nkind: goal\\norigin: probe\\nbody:
  |\\n  probe\\n---\\n\");fs.writeFileSync(g(\"AC-903.md\"),\"---\\nid:
  AC-903\\ntitle: fixture\\nstatus: active\\nkind: criterion\\ngoal:
  GOAL-999\\ncriterion: \\\"exit 1\\\"\\nexpect: fixture\\norigin:
  probe\\n---\\n\");const
  r=cp.spawnSync(process.execPath,[path.join(process.cwd(),\"packages/quay/bin/\
  quay.js\"),\"goal\",\"gate\",\"AC-903\",\"--root\",d,\"--json\"],{encoding:\"\
  utf8\"});let
  j;try{j=JSON.parse(r.stdout)}catch(e){die(\"CAUSE=gate-json-unparseable
  exit=\"+r.status+\"
  stdout=\"+JSON.stringify(String(r.stdout).slice(0,200)))}const
  reason=String(j.reason||\"\");const m=reason.match(/^acceptance failed \\(exit
  [^)]*\\) — (.*)$/);if(!m){die(\"CAUSE=reason-shape-changed
  reason=\"+JSON.stringify(reason))}const real=m[1].trim();const
  files=fs.readdirSync(\"goals\").filter(f=>/^AC-241-.*\\.md$/.test(f));if(file\
  s.length!==1){die(\"CAUSE=AC-241-record-not-uniquely-locatable
  files=\"+JSON.stringify(files))}const
  src=fs.readFileSync(path.join(\"goals\",files[0]),\"utf8\");const
  t=src.match(/T\\s*=\\s*\"([^\"]+)\"/);if(!t){die(\"CAUSE=AC-241-bare-reason-c\
  onstant-gone — its detector shape changed; re-scope
  AC-243\")}if(real!==t[1]){die(\"CAUSE=constant-diverged — AC-241
  T=\"+JSON.stringify(t[1])+\"
  runner=\"+JSON.stringify(real))}try{fs.rmSync(d,{recursive:true,force:true})}\
  catch(e){}process.exit(0)'"
expect: exit 0 = AC-241 声明的空因常量与 runner 对零输出失败实际产出的成因文本逐字相同（AC-241 此刻仍能对不可归因的
  fail 报红）；exit 1 = 二者已漂移、或该常量已被移除（AC-241 退化为恒绿，GOAL-009 台账的失败归因检测器失效，须修
  AC-241）；exit 3 = runner 读数取不到（未评估，与合格不同形，⛔ 不得当作通过）
origin: readings.criteria 中 AC-241 的 criterion 正文自带逐字告警：「⚠️ 与 runner
  的模板措辞耦合：acceptance-runner 改这句文案，须同步改本判据，否则退化为恒绿」，其判定实现为字面量 T="criterion wrote
  no output to stderr/stdout"；同一 readings 显示本轮 AC-241 verdict=fail、reason 逐字点名
  AC-161 与 AC-239 两条不可归因 fail —— 即它是当前唯一在 ledger
  上把「不可归因的失败」变成红的东西；它一旦静默恒绿，GOAL-009 的失败归因面（AC-237 runner 侧 + AC-241 台账侧）就只剩
  AC-237 的 fixture 自证。
activatedAt: 2026-09-11T09:37:17.717Z
statusLog:
  - at: 2026-09-11T09:37:17.717Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-09-11T09:38:19.382Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-11T09:37:17.716Z
---
