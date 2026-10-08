---
id: AC-337
title: 分支自举：按文件路径启动的分支 promotion-driver（默认子进程解析）在沙盒中触发 todo→ready，分支
  ready-pool-check --revaluate-apply 触发 ready→todo；每条事件的写入模块与入口 realpath
  都在被求值的树内；主检出驱动负对照写 0 条事件；生产数据不变
status: active
kind: criterion
goal: GOAL-030
criterion: |
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"; rroot=$(readlink -f "$root"); rmain=$(dirname "$(readlink -f "$(git rev-parse --git-common-dir)")")
  probe=scripts/branch-selfhost-probe.mjs
  [ -f "$probe" ] || { echo "NOT-EVALUATED: $probe not landed in this tree" >&2; exit 3; }
  err=$(mktemp /tmp/goal030-probe.XXXXXX); trap 'rm -f "$err"' EXIT
  out=$(timeout 55 env -u QUAY_PLUGIN_ROOT node --no-warnings "$rroot/$probe" --json 2>"$err"); rc=$?
  [ "$rc" -eq 3 ] && { echo "NOT-EVALUATED: probe could not evaluate: $(tail -2 "$err" | tr '\n' ' ')" >&2; exit 3; }
  [ -n "$out" ] || { echo "NOT-EVALUATED: probe exit $rc printed no JSON: $(tail -2 "$err" | tr '\n' ' ')" >&2; exit 3; }
  printf '%s' "$out" | node -e '(()=>{const fs=require("fs");const [rroot,rmain]=process.argv.slice(1);let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let J;try{J=JSON.parse(s)}catch(e){console.error("NOT-EVALUATED: probe output is not JSON");process.exit(3)}
  const rp=(p)=>{try{return fs.realpathSync(p)}catch{return p}};const inTree=(p)=>typeof p==="string"&&rp(p).startsWith(rroot+"/");
  if(rp(J.root||"")!==rroot){console.error("CAUSE=probe-root-mismatch — probe reports root "+J.root+", criterion runs in "+rroot);process.exit(1)}
  const evs=Array.isArray(J.events)?J.events:[];const bad=evs.filter(e=>!inTree(e.writerModule)||!inTree(e.entry));
  if(bad.length){console.error("CAUSE=loaded-main-checkout-code — "+bad.length+" event(s) written by code outside "+rroot+": "+JSON.stringify(bad[0]).slice(0,300));process.exit(1)}
  const prom=evs.filter(e=>e.from==="todo"&&e.to==="ready"&&e.kind==="promote"),retr=evs.filter(e=>e.from==="ready"&&e.to==="todo"&&e.kind==="retreat");
  const pf=J.promotion&&J.promotion.flips,rf=J.revaluation&&J.revaluation.flips;
  if(!(pf>=2)||prom.length!==pf){console.error("CAUSE=promotion-not-triggered — branch promotion-driver round: flips="+pf+" promote events="+prom.length+" (expect >=2 and equal)");process.exit(1)}
  if(!(rf>=1)||retr.length!==rf){console.error("CAUSE=revaluation-not-triggered — branch ready-pool-check --revaluate-apply: flips="+rf+" retreat events="+retr.length+" (expect >=1 and equal)");process.exit(1)}
  if(J.promotion.childResolution!=="default"){console.error("CAUSE=child-pinned — the promotion round must use the driver default child resolution, got "+J.promotion.childResolution);process.exit(1)}
  const nc=J.negativeControl||{};if(rroot!==rmain&&nc.mainHasModule!==true){if(nc.evaluated!==true||nc.events!==0){console.error("CAUSE=negative-control-failed — the main checkout driver on an identical sandbox must write 0 events: "+JSON.stringify(nc));process.exit(1)}}
  if(!J.production||J.production.unchanged!==true){console.error("CAUSE=production-touched — "+JSON.stringify(J.production||{}).slice(0,300));process.exit(1)}
  if(!J.env||J.env.QUAY_PLUGIN_ROOT!==null){console.error("CAUSE=env-override-present — QUAY_PLUGIN_ROOT must be unset for the run: "+JSON.stringify(J.env||{}));process.exit(1)}
  console.log("PASS: branch code proven ("+evs.length+" events, all writerModule/entry under "+rroot+"); promote "+prom.length+", retreat "+retr.length+"; negative control "+(rroot===rmain||nc.mainHasModule?"n/a (main already carries the module)":"0 events")+"; production unchanged")})})()' "$rroot" "$rmain"
expect: exit 0 = 两类转移都被触发、全部事件由本树代码写出、负对照为 0、生产不变；exit 1 =
  任一不满足，loaded-main-checkout-code 即自举落到主检出（分支不健康）；exit 3 = 探针未落地或无法评估。
origin: 人 2026-10-08「现在开始执行…正式创建一个真实的重构 goal，并启用 goal branch」：goal
  分支机制首个真实试点，范围严格限于晋升路径的 todo→ready / ready→todo 两条写入；先验证“在分支上运行 Quay 并验证
  Quay”的自举路径，健康度达标后才进入更大重构。
activatedAt: 2026-10-08T02:29:23.911Z
statusLog:
  - at: 2026-10-08T02:29:23.911Z
    from: draft
    to: active
    actor: cli
    reason: 人 2026-10-08 授权立项并进入 GOAL-030（goal 分支首个真实试点）；承接任务已立并停放（needs-human），激活本
      AC 不会触发乱序自动立案
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-08T02:29:23.910Z
phase: pre-merge
---
