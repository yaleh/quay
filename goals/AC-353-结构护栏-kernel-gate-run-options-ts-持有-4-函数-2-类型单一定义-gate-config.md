---
id: AC-353
title: 结构护栏：kernel/gate-run-options.ts 持有 4 函数+2 类型单一定义；gate/config/utils.ts 与
  gate/factories/loader.ts 均删除（无 shim）；七个真实消费点改口；非目标文件未动
status: achieved
kind: criterion
goal: GOAL-034
criterion: |-
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  src=packages/quay/src
  kf="$src/kernel/gate-run-options.ts"
  [ -f "$kf" ] || { echo "NOT-EVALUATED: $kf not landed on this tree yet" >&2; exit 3; }
  [ ! -e "$src/gate/factories/loader.ts" ] || { echo "CAUSE=dead-shim-still-present -- $src/gate/factories/loader.ts must be deleted" >&2; exit 1; }
  [ ! -e "$src/gate/config/utils.ts" ] || { echo "CAUSE=shell-move-shim -- $src/gate/config/utils.ts must be deleted, not left as a re-export shim (methodology section 2)" >&2; exit 1; }
  node -e '(()=>{const fs=require("fs"),path=require("path");const src=process.argv[1];
  const rd=(f)=>fs.readFileSync(f,"utf8");
  const live=(t)=>t.split("\n").filter(l=>{const s=l.trim();return !(s.startsWith("//")||s.startsWith("*")||s.startsWith("/*"))}).join("\n");
  const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):e.name.endsWith(".ts")?[path.join(d,e.name)]:[]);
  const all=walk(src);
  const defOnly=(re,want,label)=>{const d=all.filter(f=>re.test(live(rd(f))));if(d.length!==1||d[0]!==path.join(src,want)){console.error("CAUSE=not-single-definition -- "+label+" defined in ["+d.join(",")+"], expected only "+want);process.exit(1)}};
  defOnly(/^export function shQuote\(/m,"kernel/gate-run-options.ts","shQuote");
  defOnly(/^export const DEFAULT_ACCEPTANCE_TIMEOUT_MS\s*=/m,"kernel/gate-run-options.ts","DEFAULT_ACCEPTANCE_TIMEOUT_MS");
  defOnly(/^export function resolveAcceptanceTimeoutMs\(/m,"kernel/gate-run-options.ts","resolveAcceptanceTimeoutMs");
  defOnly(/^export function resolveRunnerOptions\(/m,"kernel/gate-run-options.ts","resolveRunnerOptions");
  const kt=rd(path.join(src,"kernel/gate-run-options.ts"));
  if(!/export (interface|type) GateConfig\b/.test(live(kt))){console.error("CAUSE=type-not-moved -- GateConfig must be declared in kernel/gate-run-options.ts");process.exit(1)}
  if(!/export (interface|type) RunnerOptions\b/.test(live(kt))){console.error("CAUSE=type-not-moved -- RunnerOptions must be declared in kernel/gate-run-options.ts");process.exit(1)}
  const typesText=live(rd(path.join(src,"gate/config/types.ts")));
  if(/export (interface|type) GateConfig\b/.test(typesText)||/export (interface|type) RunnerOptions\b/.test(typesText)){console.error("CAUSE=type-duplicated -- GateConfig/RunnerOptions must be removed from gate/config/types.ts, not duplicated");process.exit(1)}
  const kernel=path.normalize(path.join(src,"kernel/gate-run-options.ts"));
  const importsKernel=(file)=>{const dir=path.dirname(file);for(const m of live(rd(file)).matchAll(/from\s*["\x27]([^"\x27]+)["\x27]/g)){if(path.normalize(path.join(dir,m[1]))===kernel)return true}return false};
  const roles=[["VALID_GOAL_STATUSES",/^export const VALID_GOAL_STATUSES\b/m],["handleGate",/^export (async )?function handleGate\(/m],["runAcceptance",/^export function runAcceptance\(/m],["registerGoalGate",/^export function registerGoalGate\(/m],["discoverWorkspaceRoot",/^export function discoverWorkspaceRoot\(/m],["makeGoalGate",/^export function makeGoalGate\(/m]];
  for(const role of roles){const label=role[0],re=role[1];const carriers=all.filter(f=>re.test(live(rd(f))));if(carriers.length!==1){console.error("CAUSE=role-carrier-not-unique -- "+label+" is exported by ["+carriers.join(",")+"], expected exactly one module");process.exit(1)}if(!importsKernel(carriers[0])){console.error("CAUSE=consumer-not-converged -- the module carrying "+label+" ("+carriers[0]+") does not import kernel/gate-run-options.ts");process.exit(1)}}
  for(const b of ["gate/config/index.ts","gate/factories/utils.ts"]){if(!importsKernel(path.join(src,b))){console.error("CAUSE=consumer-not-converged -- barrel "+b+" does not import kernel/gate-run-options.ts");process.exit(1)}}
  const loaderText=live(rd(path.join(src,"gate/config/loader.ts")));
  const nongoal=["discoverWorkspaceRoot","loadWorkspaceGates","loadWorkspaceGateMetadata"];
  for(const name of nongoal){const fnRe=new RegExp("export (async )?function "+name+"\\(","m");const constRe=new RegExp("export const "+name+"\\b");if(!fnRe.test(loaderText)&&!constRe.test(loaderText)){console.error("CAUSE=nongoal-moved -- "+name+" must stay defined in gate/config/loader.ts");process.exit(1)}}
  if(!/from\s*["\x27]\.\.\/factories\/index\.ts["\x27]/.test(loaderText)){console.error("CAUSE=wiring-edge-removed -- gate/config/loader.ts must still import ../factories/index.ts");process.exit(1)}
  const taskCarriers=all.filter(f=>/^export interface Task\b/m.test(live(rd(f))));
  if(taskCarriers.length!==1){console.error("CAUSE=abi-touched -- Task must have exactly one carrier module, found ["+taskCarriers.join(",")+"] (the ABI task shape has one definition site)");process.exit(1)}
  const abiFile=path.join(src,"abi.ts");
  if(path.normalize(taskCarriers[0])===path.normalize(abiFile)){console.error("CAUSE=abi-touched -- abi.ts must stay a FORWARDING surface (export * from the carrier), not a definition site (gap-src-root-gate-cycle-break)");process.exit(1)}
  const abiForwards=[...live(rd(abiFile)).matchAll(/from\s*["\x27]([^"\x27]+)["\x27]/g)].some(m=>path.normalize(path.join(path.dirname(abiFile),m[1]))===path.normalize(taskCarriers[0]));
  if(!abiForwards){console.error("CAUSE=abi-touched -- abi.ts no longer forwards the Task carrier ("+taskCarriers[0]+")");process.exit(1)}
  })()' "$src" || { echo "CAUSE=structural-scan-red -- the scan above printed the specific CAUSE" >&2; exit 1; }
  oos=$(git diff --name-only develop...HEAD -- packages/quay/src/gate/engine.ts packages/quay/src/gate/lifecycle.ts packages/quay/src/gate/driver.ts packages/quay/src/gate/types.ts packages/quay/src/abi.ts packages/quay/src/fan-in 2>/dev/null)
  [ -z "$oos" ] || { echo "CAUSE=out-of-scope-edit -- this goal must not touch: $(echo $oos | tr '\n' ' ')" >&2; exit 1; }
  echo "PASS: kernel/gate-run-options.ts holds the single definitions of the 4 functions + 2 types; gate/config/utils.ts and gate/factories/loader.ts are both gone (no shell-move shim); seven real consumers converged; non-goal files (loader.ts config-loading functions, the config-to-factories wiring import) are untouched and the abi.ts surface still forwards the single Task carrier"
expect: exit 0 = 单一定义 + 两个死文件/shim 均删除 + 七个消费点改口 + 非目标未动；exit 1 = CAUSE=
  指明哪一项；exit 3 = kernel/gate-run-options.ts 尚未落地
origin: 继 GOAL-030~033 后第五个 goal branch 试点
activatedAt: 2026-10-10T06:03:56.415Z
statusLog:
  - at: 2026-10-10T06:03:56.415Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-10T06:35:59.060Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-10T06:03:56.415Z
---
