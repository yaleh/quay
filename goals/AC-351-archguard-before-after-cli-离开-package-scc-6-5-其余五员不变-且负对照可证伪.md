---
id: AC-351
title: ArchGuard before/after：cli 离开 package SCC（6→5，其余五员不变）且负对照可证伪；CLI driver
  status 的仪器读数语义在被求值树上现场重算不变
status: draft
kind: criterion
goal: GOAL-033
criterion: |-
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  ev=".quay/goal-033-evidence/archguard-before-after.json"
  [ -f "$ev" ] || { echo "NOT-EVALUATED: $ev not written yet" >&2; exit 3; }
  node -e '(()=>{const fs=require("fs");let d;try{d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.error("CAUSE=evidence-unreadable — "+e.message);process.exit(1)}
  const b=d.before||{},a=d.after||{},n=d.negativeControl||{};const srt=(x)=>Array.isArray(x)?[...x].sort():null;
  const want=["","cli","fan-in","gate","gate/config","gate/factories"];
  if(JSON.stringify(srt(b.packageSccMembers))!==JSON.stringify(want)||b.cliPackageFanIn!==2){console.error("CAUSE=before-baseline-wrong — before must reproduce the known 6-member SCC with cli fan-in 2, got members="+JSON.stringify(b.packageSccMembers)+" fanIn="+b.cliPackageFanIn);process.exit(1)}
  const rest=want.filter(m=>m!=="cli");
  if(a.cliPackageFanIn!==0){console.error("CAUSE=cli-still-has-core-fan-in — after.cliPackageFanIn="+a.cliPackageFanIn);process.exit(1)}
  if(JSON.stringify(srt(a.packageSccMembers))!==JSON.stringify(rest)){console.error("CAUSE=scc-not-exactly-minus-cli — after members="+JSON.stringify(a.packageSccMembers)+" expected "+JSON.stringify(rest)+" (cli removed, nothing else changed)");process.exit(1)}
  if(!(n.cliPackageFanIn>=1)||n.packageSccContainsCli!==true){console.error("CAUSE=negative-control-missing — re-injecting one core-to-cli edge must bring cli back into the SCC, got "+JSON.stringify(n));process.exit(1)}
  if(typeof d.archguardVersion!=="string"||!d.archguardVersion){console.error("CAUSE=archguard-version-missing — before/after must name the single ArchGuard build used");process.exit(1)}
  })()' "$ev" || { echo "CAUSE=evidence-check-red — the check above printed the specific CAUSE" >&2; exit 1; }
  ws=$(mktemp -d /tmp/goal033-probe.XXXXXX); trap 'rm -rf "$ws"' EXIT
  mkdir -p "$ws/.quay"; printf 'providers:\n  native:\n    enabled: true\n    tasks_dir: "./tasks"\n' > "$ws/.quay/config.yml"
  probe() { QUAY_PLUGIN_ROOT="$root/plugin" timeout 90 node --experimental-strip-types "$root/packages/quay/bin/quay.ts" driver status --kind "$1" --json --root "$ws" 2>/dev/null | node -e '(()=>{let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const l=s.split("\n").find(x=>x.trim().startsWith("{"));if(!l){process.stdout.write("nojson");return}let j;try{j=JSON.parse(l)}catch{process.stdout.write("nojson");return}process.stdout.write(Object.prototype.hasOwnProperty.call(j,"instruments")?"with":"without")})})()'; }
  w=$(probe worker); p=$(probe promotion)
  [ "$w" = "with" ] || { echo "CAUSE=cli-worker-status-lost-instruments — quay driver status --kind worker --json read: $w (expected the instruments key, as before the move)" >&2; exit 1; }
  [ "$p" = "without" ] || { echo "CAUSE=cli-promotion-status-shape-changed — quay driver status --kind promotion --json read: $p (expected no instruments key)" >&2; exit 1; }
  echo "PASS: ArchGuard before/after shows cli leaving the package SCC (6 -> 5, the other five unchanged) with a falsifying negative control, and the CLI status surface keeps its exact instrument semantics on this tree"
expect: exit 0 = 证据显示 cli 离开 SCC（6→5 且其余五员不变）、负对照把 cli 拉回 SCC、且被求值树上 worker
  status 带 instruments 而 promotion 不带；exit 1 = CAUSE=；exit 3 = 证据文件尚未写
origin: 人 2026-10-09 裁定：调查并推进 core-root<->core-cli 最小依赖环切片；结论清晰 ⇒ 开 branch:true
  goal，严格复用 GOAL-030/031/032 方法，只做这一对
---
