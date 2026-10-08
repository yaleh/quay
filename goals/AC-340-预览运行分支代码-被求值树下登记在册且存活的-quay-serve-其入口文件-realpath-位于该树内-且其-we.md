---
id: AC-340
title: 预览运行分支代码：被求值树下登记在册且运行中的 quay serve，其加载的入口脚本（quay server status 从 /proc
  cmdline 读出）realpath 位于该树内，且其 web 服务存活
status: achieved
kind: criterion
goal: GOAL-030
criterion: >-
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"; rroot=$(readlink -f "$root")

  st=$(timeout 30 node --no-warnings "$root/packages/quay/bin/quay.js" server
  status --json --root "$root" 2>/dev/null)

  [ -n "$st" ] || { echo "NOT-EVALUATED: quay server status --json printed
  nothing for $root" >&2; exit 3; }

  printf '%s' "$st" | node -e '(()=>{const fs=require("fs");const
  rroot=process.argv[1];let
  s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let
  j;try{j=JSON.parse(s)}catch{console.error("NOT-EVALUATED: server status output
  is not JSON");process.exit(3)}

  if(j.status!=="running"){console.error("NOT-EVALUATED: no running quay serve
  registered under "+rroot+" (status="+j.status+"; "+(j.reason||"")+") — start
  the preview with: quay goal preview GOAL-030 start --port
  <n>");process.exit(3)}

  if(j.source!=="proc-cmdline"||typeof
  j.loaded_script!=="string"||!j.loaded_script){console.error("NOT-EVALUATED:
  loaded script not read from /proc cmdline
  (source="+j.source+")");process.exit(3)}

  let ls=j.loaded_script;try{ls=fs.realpathSync(ls)}catch{}

  if(!ls.startsWith(rroot+"/")){console.error("CAUSE=serve-runs-foreign-code —
  the serve registered under "+rroot+" (pid "+j.pid+") runs "+ls+", not this
  tree s own code");process.exit(1)}

  const web=(j.services||[]).find(x=>x&&x.name==="web");const
  lv=web&&web.liveness;

  if(!lv||lv.evaluated!==true){console.error("NOT-EVALUATED: web liveness not
  evaluated by quay server status");process.exit(3)}

  if(lv.alive!==true){console.error("CAUSE=web-not-alive —
  "+(lv.detail||""));process.exit(1)}

  console.log("PASS: serve pid "+j.pid+" under "+rroot+" runs this tree s own
  entry ("+ls+", read from /proc cmdline) and its web service is alive
  ("+lv.detail+")")})})()' "$rroot"
expect: exit 0 = 该树登记的 serve 运行的是本树自己的入口且 web 服务存活（quay server status 的 /health
  探测）；exit 1 = serve 运行的是别处的代码，或 web 服务不存活；exit 3 = 该树下没有运行中的 serve（预览未起）或
  server status 不可读。
origin: 人 2026-10-08「现在开始执行…正式创建一个真实的重构 goal，并启用 goal branch」：goal
  分支机制首个真实试点，范围严格限于晋升路径的 todo→ready / ready→todo 两条写入；先验证“在分支上运行 Quay 并验证
  Quay”的自举路径，健康度达标后才进入更大重构。
activatedAt: 2026-10-08T02:30:56.420Z
statusLog:
  - at: 2026-10-08T02:30:56.420Z
    from: draft
    to: active
    actor: cli
    reason: 人 2026-10-08 授权立项并进入 GOAL-030（goal 分支首个真实试点）；承接任务已立并停放（needs-human），激活本
      AC 不会触发乱序自动立案
  - at: 2026-10-08T03:11:33.809Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-08T02:30:56.419Z
phase: pre-merge
---
