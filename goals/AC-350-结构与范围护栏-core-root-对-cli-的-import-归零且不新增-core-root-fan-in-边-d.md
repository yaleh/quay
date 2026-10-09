---
id: AC-350
title: 结构与范围护栏：core-root 对 cli/ 的 import 归零且不新增 core-root→fan-in
  边；driver-control.ts/driver-vocab.ts 单一定义、五个消费者改口；enum-surface/import-graph
  不回退；gate/fan-in/kernel 未动
status: active
kind: criterion
goal: GOAL-033
criterion: |-
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  src=packages/quay/src
  [ -f "$src/driver-control.ts" ] || { echo "NOT-EVALUATED: $src/driver-control.ts not landed on this tree yet" >&2; exit 3; }
  [ -f "$src/driver-vocab.ts" ] || { echo "CAUSE=driver-vocab-not-in-core — $src/driver-vocab.ts not found while driver-control.ts exists" >&2; exit 1; }
  [ ! -e "$src/cli/driver-vocab.ts" ] || { echo "CAUSE=old-vocab-still-present — $src/cli/driver-vocab.ts must be gone, not kept as a second copy or shim" >&2; exit 1; }
  node -e '(()=>{const fs=require("fs"),path=require("path");const src=process.argv[1];
  const live=(t)=>t.split("\n").filter(l=>{const s=l.trim();return !(s.startsWith("//")||s.startsWith("*")||s.startsWith("/*"))}).join("\n");
  const hits=(t,re)=>{const m=live(t).match(re);return m?m.length:0};
  const reCli=/(?:\bfrom|\bimport\s*\()\s*[\x22\x27]\.\/cli\//g;
  const reFan=/(?:\bfrom|\bimport\s*\()\s*[\x22\x27]\.\/fan-in\//g;
  const reCtl=/(?:\bfrom|\bimport\s*\()\s*[\x22\x27]\.\.\/config\.ts[\x22\x27]/g;
  const ts=(d)=>fs.readdirSync(d).filter(f=>f.endsWith(".ts")).map(f=>path.join(d,f));
  const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):e.name.endsWith(".ts")?[path.join(d,e.name)]:[]);
  const rd=(f)=>fs.readFileSync(f,"utf8");
  let cli=0,fan=0,ctl=0;const cliList=[];
  for(const f of ts(src)){const t=rd(f);const c=hits(t,reCli);if(c){cli+=c;cliList.push(f)}fan+=hits(t,reFan)}
  for(const f of ts(path.join(src,"cli")))ctl+=hits(rd(f),reCtl);
  const neg=hits("import { runDriver } from \x22./cli/driver.ts\x22;\n",reCli);
  if(ctl<1){console.error("CAUSE=predicate-blind — control import ../config.ts matched 0 times in cli/*.ts, the scanner cannot be trusted");process.exit(1)}
  if(neg!==1){console.error("CAUSE=predicate-blind — an injected ./cli/ import line was not detected");process.exit(1)}
  if(cli!==0){console.error("CAUSE=core-root-still-imports-cli — "+cli+" edge(s) in "+cliList.join(","));process.exit(1)}
  if(fan!==0){console.error("CAUSE=new-root-to-fan-in-edge — "+fan+" core-root import(s) of ./fan-in/ (the instrument decoration must stay in cli)");process.exit(1)}
  const all=walk(src);const def=(re)=>all.filter(f=>re.test(rd(f)));
  const one=(re,want,label)=>{const d=def(re);if(d.length!==1||d[0]!==path.join(src,want)){console.error("CAUSE=not-single-definition — "+label+" defined in ["+d.join(",")+"], expected only "+want);process.exit(1)}};
  one(/^export function runDriver\(/m,"driver-control.ts","runDriver");
  one(/^export function runDriverAsync\(/m,"driver-control.ts","runDriverAsync");
  one(/^function resolveDriverInvocation\(/m,"driver-control.ts","resolveDriverInvocation");
  one(/^export const KINDS\s*=/m,"driver-vocab.ts","KINDS");
  one(/^export const ALL_SERVICE_NAMES\s*=/m,"driver-vocab.ts","ALL_SERVICE_NAMES");
  if(/^\s*import\b/m.test(rd(path.join(src,"driver-vocab.ts")))){console.error("CAUSE=vocab-leaf-gained-imports — driver-vocab.ts must stay zero-import (quay --help load cost)");process.exit(1)}
  const need=[["serve-sessions.ts",/from\s*[\x22\x27]\.\/driver-control\.ts[\x22\x27]/],["cli/server.ts",/from\s*[\x22\x27]\.\.\/driver-control\.ts[\x22\x27]/],["cli/driver.ts",/from\s*[\x22\x27]\.\.\/driver-control\.ts[\x22\x27]/],["cli/help.ts",/from\s*[\x22\x27]\.\.\/driver-vocab\.ts[\x22\x27]/],["serve.ts",/from\s*[\x22\x27]\.\/driver-vocab\.ts[\x22\x27]/]];
  for(const [f,re] of need){if(!re.test(live(rd(path.join(src,f))))){console.error("CAUSE=consumer-not-converged — "+f+" does not import the core module");process.exit(1)}}
  if(!/\bprobeInstruments\(/.test(live(rd(path.join(src,"cli/driver.ts"))))){console.error("CAUSE=decoration-left-cli — cli/driver.ts no longer calls probeInstruments");process.exit(1)}
  })()' "$src" || { echo "CAUSE=structural-scan-red — the scan above printed the specific CAUSE" >&2; exit 1; }
  esp=$(node --experimental-strip-types plugin/scripts/enum-surface-parity-check.ts --root "$root" --json 2>/dev/null)
  node -e '(()=>{let d;try{d=JSON.parse(process.argv[1])}catch{console.error("CAUSE=enum-surface-check-unreadable — no JSON from enum-surface-parity-check");process.exit(1)}if(d.ok!==true||d.status!=="pass"||(d.notEvaluated||[]).length!==0){console.error("CAUSE=enum-surface-not-pass — status="+d.status+" notEvaluated="+JSON.stringify(d.notEvaluated)+" violations="+JSON.stringify(d.violations));process.exit(1)}})()' "$esp" || { echo "CAUSE=enum-surface-check-red — see the CAUSE line above" >&2; exit 1; }
  igc=$(node --experimental-strip-types plugin/scripts/import-graph-check.ts --json 2>/dev/null)
  node -e '(()=>{let d;try{d=JSON.parse(process.argv[1])}catch{console.error("CAUSE=import-graph-check-unreadable — no JSON");process.exit(1)}if(!d.verdict||d.verdict.ok!==true){console.error("CAUSE=import-graph-ratchet-regressed — verdict="+JSON.stringify(d.verdict));process.exit(1)}})()' "$igc" || { echo "CAUSE=import-graph-check-red — see the CAUSE line above" >&2; exit 1; }
  oos=$(git diff --name-only develop...HEAD -- packages/quay/src/gate packages/quay/src/fan-in packages/quay/src/kernel)
  [ -z "$oos" ] || { echo "CAUSE=out-of-scope-edit — this goal must not touch gate/ fan-in/ kernel/: $(echo $oos | tr '\n' ' ')" >&2; exit 1; }
  echo "PASS: core-root imports nothing from cli/ (and gained no fan-in edge); driver-control.ts / driver-vocab.ts are the single definitions; all five consumers converged; enum-surface + import-graph checks pass; gate/fan-in/kernel untouched"
expect: exit 0 = core-root 零 cli/ import、零新增 fan-in import、单一定义、五个消费者改口、两个检查器
  pass、gate/fan-in/kernel 未动；exit 1 = CAUSE= 指明哪一项；exit 3 = driver-control.ts
  尚未落地
origin: 人 2026-10-09 裁定：调查并推进 core-root<->core-cli 最小依赖环切片
activatedAt: 2026-10-09T05:46:01.326Z
statusLog:
  - at: 2026-10-09T05:46:01.326Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-09T05:46:01.326Z
---
