---
id: AC-354
title: before/after 边数读数 + 可证伪负对照：root→gate/config 边数
  1→0，gate/factories→gate/config 行数 5→0（4 环是否因此收缩按实测记录，不预先断言）
status: active
kind: criterion
goal: GOAL-034
criterion: |
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  src=packages/quay/src
  [ -f "$src/kernel/gate-run-options.ts" ] || { echo "NOT-EVALUATED: $src/kernel/gate-run-options.ts not landed on this tree yet" >&2; exit 3; }
  [ ! -e "$src/gate/config/utils.ts" ] || { echo "CAUSE=shell-move-shim -- gate/config/utils.ts must be deleted, not left as a re-export shim" >&2; exit 1; }
  grep -q 'kernel/gate-run-options.ts' "$src/gate/config/loader.ts" || { echo "CAUSE=consumer-not-converged -- gate/config/loader.ts does not import kernel/gate-run-options.ts" >&2; exit 1; }
  grep -q 'kernel/gate-run-options.ts' "$src/gate/config/index.ts" || { echo "CAUSE=consumer-not-converged -- gate/config/index.ts barrel does not re-export from kernel/gate-run-options.ts" >&2; exit 1; }
  node -e '(()=>{const fs=require("fs"),path=require("path");const src=process.argv[1];
  const rd=(f)=>fs.readFileSync(f,"utf8");
  const live=(t)=>t.split("\n").filter(l=>{const s=l.trim();return !(s.startsWith("//")||s.startsWith("*")||s.startsWith("/*"))}).join("\n");
  const countRootToGateConfig=(text)=>(live(text).match(/from\s*[\x22\x27]\.\/gate\/config\//g)||[]).length;
  const countFactoriesToConfig=(text)=>(live(text).match(/from\s*[\x22\x27]\.\.\/config\//g)||[]).length;
  const BEFORE_ROOT_TO_GATE_CONFIG=1;
  const BEFORE_FACTORIES_TO_CONFIG_UTILS=2;
  const BEFORE_FACTORIES_TO_CONFIG_GOAL=1;
  const BEFORE_FACTORIES_TO_CONFIG_LOADER=2;
  const FORK_POINT="162f8c380ed1dd9267167cc791ef8727fd13269d";
  const afterRoot=countRootToGateConfig(rd(path.join(src,"goal-store.ts")));
  if(afterRoot!==0){console.error("CAUSE=root-to-gate-config-not-cleared -- goal-store.ts still has "+afterRoot+" import(s) matching ./gate/config/ (before="+BEFORE_ROOT_TO_GATE_CONFIG+", fork point "+FORK_POINT+")");process.exit(1)}
  if(fs.existsSync(path.join(src,"gate/factories/loader.ts"))){console.error("CAUSE=dead-shim-still-present -- gate/factories/loader.ts had "+BEFORE_FACTORIES_TO_CONFIG_LOADER+" ../config/ import(s) at fork point "+FORK_POINT+", must be deleted entirely");process.exit(1)}
  const afterUtils=countFactoriesToConfig(rd(path.join(src,"gate/factories/utils.ts")));
  if(afterUtils!==0){console.error("CAUSE=factories-to-config-not-cleared -- gate/factories/utils.ts still has "+afterUtils+" import(s) matching ../config/ (before="+BEFORE_FACTORIES_TO_CONFIG_UTILS+")");process.exit(1)}
  const afterGoalFactory=countFactoriesToConfig(rd(path.join(src,"gate/factories/goal.ts")));
  if(afterGoalFactory!==0){console.error("CAUSE=factories-to-config-not-cleared -- gate/factories/goal.ts still has "+afterGoalFactory+" import(s) matching ../config/ (before="+BEFORE_FACTORIES_TO_CONFIG_GOAL+")");process.exit(1)}
  const scratchBefore=rd(path.join(src,"goal-store.ts")).replace(
    /import\s*\{\s*resolveAcceptanceTimeoutMs[^\n]*\n/,
    (m)=>m+"import { resolveAcceptanceTimeoutMs as __negctl } from \"./gate/config/utils.ts\";\n"
  );
  const negCount=countRootToGateConfig(scratchBefore);
  if(negCount<1){console.error("CAUSE=negative-control-not-falsifiable -- re-inserting the old import into a scratch copy of goal-store.ts did not raise the count, the checker above cannot be trusted to detect a real regression");process.exit(1)}
  console.log(JSON.stringify({fork_point:FORK_POINT,before:{root_to_gate_config:BEFORE_ROOT_TO_GATE_CONFIG,factories_to_config_lines:BEFORE_FACTORIES_TO_CONFIG_UTILS+BEFORE_FACTORIES_TO_CONFIG_GOAL+BEFORE_FACTORIES_TO_CONFIG_LOADER},after:{root_to_gate_config:afterRoot,factories_to_config_lines:afterUtils+afterGoalFactory},negative_control_count_on_scratch_regression:negCount}));
  })()' "$src" || { echo "CAUSE=before-after-scan-red -- the scan above printed the specific CAUSE" >&2; exit 1; }
  echo "PASS: root->gate/config edge count 1 -> 0; gate/factories->gate/config line count 5 -> 0 (file deletion + 2 real redirects); negative control on a scratch regression correctly re-detects the old edge"
expect: exit 0 = 边数读数归零且负对照能检测到回归；exit 1 = CAUSE= 指明哪一项；exit 3 =
  kernel/gate-run-options.ts 尚未落地
origin: 继 GOAL-030~033 后第五个 goal branch 试点
activatedAt: 2026-10-10T06:03:57.804Z
statusLog:
  - at: 2026-10-10T06:03:57.804Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-10T06:03:57.803Z
---
