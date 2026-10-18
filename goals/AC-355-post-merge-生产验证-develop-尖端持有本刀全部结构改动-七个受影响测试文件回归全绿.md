---
id: AC-355
title: post-merge 生产验证：develop 尖端持有本刀全部结构改动，七个受影响测试文件回归全绿
status: achieved
kind: criterion
goal: GOAL-034
criterion: |-
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || branch=""
  merge_base=$(git merge-base develop HEAD 2>/dev/null) || merge_base=""
  dev_tip=$(git rev-parse develop 2>/dev/null) || dev_tip=""
  [ -n "$merge_base" ] && [ "$merge_base" = "$dev_tip" ] || { echo "NOT-EVALUATED: GOAL-034 has not merged into develop yet (branch=$branch, merge-base=$merge_base, develop=$dev_tip)" >&2; exit 3; }
  src=packages/quay/src
  [ -f "$src/kernel/gate-run-options.ts" ] || { echo "CAUSE=post-merge-regression -- kernel/gate-run-options.ts missing on develop after a merge-base match, the landing did not actually carry the slice" >&2; exit 1; }
  [ ! -e "$src/gate/factories/loader.ts" ] || { echo "CAUSE=post-merge-regression -- gate/factories/loader.ts reappeared on develop" >&2; exit 1; }
  [ ! -e "$src/gate/config/utils.ts" ] || { echo "CAUSE=post-merge-regression -- gate/config/utils.ts reappeared on develop" >&2; exit 1; }
  node -e '(()=>{const fs=require("fs"),path=require("path");const src=process.argv[1];
  const rd=(f)=>fs.readFileSync(f,"utf8");
  const live=(t)=>t.split("\n").filter(l=>{const s=l.trim();return !(s.startsWith("//")||s.startsWith("*")||s.startsWith("/*"))}).join("\n");
  const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):e.name.endsWith(".ts")?[path.join(d,e.name)]:[]);
  const all=walk(src);
  const kernel=path.normalize(path.join(src,"kernel/gate-run-options.ts"));
  const importsKernel=(file)=>{const dir=path.dirname(file);for(const m of live(rd(file)).matchAll(/from\s*["\x27]([^"\x27]+)["\x27]/g)){if(path.normalize(path.join(dir,m[1]))===kernel)return true}return false};
  const roles=[["VALID_GOAL_STATUSES",/^export const VALID_GOAL_STATUSES\b/m],["handleGate",/^export (async )?function handleGate\(/m],["runAcceptance",/^export function runAcceptance\(/m],["registerGoalGate",/^export function registerGoalGate\(/m],["discoverWorkspaceRoot",/^export function discoverWorkspaceRoot\(/m],["makeGoalGate",/^export function makeGoalGate\(/m]];
  for(const role of roles){const label=role[0],re=role[1];const carriers=all.filter(f=>re.test(live(rd(f))));if(carriers.length!==1){console.error("CAUSE=post-merge-regression -- "+label+" is exported by ["+carriers.join(",")+"] on develop, expected exactly one module");process.exit(1)}if(!importsKernel(carriers[0])){console.error("CAUSE=post-merge-regression -- the module carrying "+label+" ("+carriers[0]+") no longer imports kernel/gate-run-options.ts on develop");process.exit(1)}}
  for(const b of ["gate/config/index.ts","gate/factories/utils.ts"]){if(!importsKernel(path.join(src,b))){console.error("CAUSE=post-merge-regression -- barrel "+b+" no longer imports kernel/gate-run-options.ts on develop");process.exit(1)}}
  })()' "$src" || { echo "CAUSE=post-merge-structural-scan-red -- the scan above printed the specific CAUSE" >&2; exit 1; }
  testfiles="packages/quay/test/gate-config-loader.test.mjs packages/quay/test/gate.test.mjs packages/quay/test/goal-store.test.mjs packages/quay/test/acceptance.test.mjs packages/quay/test/acceptance-env.test.mjs packages/quay/test/gate-diagnostics.test.mjs packages/quay/test/gate-ergonomics.test.mjs"
  node --no-warnings --experimental-strip-types --test $testfiles > /tmp/goal034-ac355-test-output.txt 2>&1
  testexit=$?
  [ "$testexit" -eq 0 ] || { echo "CAUSE=post-merge-test-regression -- one of [$testfiles] failed on develop after the merge, exit=$testexit, see /tmp/goal034-ac355-test-output.txt" >&2; exit 1; }
  echo "PASS: develop tip carries the slice (kernel/gate-run-options.ts, dead shim gone, six consumers converged) and the seven affected test files pass"
expect: exit 0 = develop 尖端结构检查 + 七个测试文件全绿；exit 1 = CAUSE= 指明哪一项回归；exit 3 =
  GOAL-034 尚未并入 develop
origin: 继 GOAL-030~033 后第五个 goal branch 试点
activatedAt: 2026-10-10T06:03:59.236Z
statusLog:
  - at: 2026-10-10T06:03:59.236Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-10T07:04:44.913Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-10T06:03:59.236Z
phase: post-merge
---
