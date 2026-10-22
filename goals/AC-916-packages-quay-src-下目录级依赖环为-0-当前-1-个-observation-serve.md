---
id: AC-916
title: packages/quay/src 下目录级依赖环为 0（当前 1 个：{., observation, serve}）
status: achieved
kind: criterion
goal: GOAL-910
criterion: "node -e 'const fs=require(\"fs\"),path=require(\"path\");const
  R=\"packages/quay/src\";const files=[];const walk=d=>{for(const e of
  fs.readdirSync(d,{withFileTypes:true})){const
  p=path.join(d,e.name);if(e.isDirectory())walk(p);else
  if(/\\.ts$/.test(e.name)&&!/\\.d\\.ts$/.test(e.name))files.push(p)}};walk(R);\
  const rel=p=>path.relative(R,path.dirname(p))||\".\";const g=new Map();let
  n=0;for(const f of files){for(const line of
  fs.readFileSync(f,\"utf8\").split(\"\\n\")){const
  m=line.match(/^\\s*(?:import|export)\\b[^\\x27\\x22]*?(?:from\\s+)?[\\x27\\x2\
  2](\\.{1,2}\\/[^\\x27\\x22]+)[\\x27\\x22]/);if(!m)continue;const
  t=path.normalize(path.join(path.dirname(f),m[1]));if(!t.startsWith(R+path.sep\
  )&&t!==R)continue;const
  a=rel(f),b=rel(t);if(a===b)continue;if(!g.has(a))g.set(a,new
  Set());g.get(a).add(b);n++}}let idx=0;const st=[],on=new Set(),ix=new
  Map(),lo=new Map(),sccs=[];const
  sc=v=>{ix.set(v,idx);lo.set(v,idx);idx++;st.push(v);on.add(v);for(const w of
  g.get(v)||[]){if(!ix.has(w)){sc(w);lo.set(v,Math.min(lo.get(v),lo.get(w)))}el\
  se
  if(on.has(w))lo.set(v,Math.min(lo.get(v),ix.get(w)))}if(lo.get(v)===ix.get(v)\
  ){const c=[];let
  w;do{w=st.pop();on.delete(w);c.push(w)}while(w!==v);if(c.length>1)sccs.push(c\
  .sort())}};for(const v of
  g.keys())if(!ix.has(v))sc(v);if(n===0){process.stderr.write(\"CAUSE=instrumen\
  t-failure: 0 cross-directory import edges parsed under \"+R+\" (predicate read
  nothing; not 0
  cycles)\\n\");process.exit(2)}if(sccs.length){process.stderr.write(\"CAUSE=di\
  rectory cycle(s) under \"+R+\": \"+JSON.stringify(sccs)+\"
  (edges=\"+n+\")\\n\");process.exit(1)}console.log(\"OK: 0 directory cycles
  under \"+R+\" (cross-directory edges=\"+n+\", dirs=\"+g.size+\")\")'"
expect: '正向：按行首 import / export…from 语句（仓库内相对路径）构造 packages/quay/src
  的目录级依赖图，强连通分量（成员数 >1）为 0。该解析方式与 archguard 的目录级 moduleGraph 一致（memory 记录 27/27
  目录对吻合；本 AC 立案当轮又对照了两次：当前树读出 [[".","observation","serve"]]，与
  archguard_detect_cycles(outputScope=package) 在 scope b4f87b21 @ d7e1c743a 给出的
  SCC 相同；在 4376933bb 上读出 0 个环，与当时 archguard 的读数相同）。反向（能取假）：立案当轮在当前树上 exit
  1，stderr 为 `CAUSE=directory cycle(s) under packages/quay/src:
  [[".","observation","serve"]]`。仪器自检：一条跨目录边都没解析出来时 exit 2，并写明
  instrument-failure，⛔ 不报「0 个环」。'
origin: 架构分析会话 2026-10-22：archguard 0.1.42 scope b4f87b21 @ d7e1c743a 发现目录环回归，由
  e7e84366a（serve* 搬入 src/serve/）与 d21a018aa（observation 拆入子目录）两次搬家提交引入；人当轮批准立案
activatedAt: 2026-10-21T23:49:07.852Z
statusLog:
  - at: 2026-10-21T23:49:07.852Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-10-22T00:39:45.328Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-21T23:49:07.851Z
---
