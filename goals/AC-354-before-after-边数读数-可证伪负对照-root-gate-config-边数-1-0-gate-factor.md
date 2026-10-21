---
id: AC-354
title: before/after 边数读数 + 可证伪负对照：root→gate/config 边数
  1→0，gate/factories→gate/config 行数 5→0（4 环是否因此收缩按实测记录，不预先断言）
status: achieved
kind: criterion
goal: GOAL-034
criterion: |-
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
  const afterRoot=countRootToGateConfig(rd(path.join(src,"core","goal-store.ts")));
  if(afterRoot!==0){console.error("CAUSE=root-to-gate-config-not-cleared -- goal-store.ts still has "+afterRoot+" import(s) matching ./gate/config/ (before="+BEFORE_ROOT_TO_GATE_CONFIG+", fork point "+FORK_POINT+")");process.exit(1)}
  if(fs.existsSync(path.join(src,"gate/factories/loader.ts"))){console.error("CAUSE=dead-shim-still-present -- gate/factories/loader.ts had "+BEFORE_FACTORIES_TO_CONFIG_LOADER+" ../config/ import(s) at fork point "+FORK_POINT+", must be deleted entirely");process.exit(1)}
  const afterUtils=countFactoriesToConfig(rd(path.join(src,"gate/factories/utils.ts")));
  if(afterUtils!==0){console.error("CAUSE=factories-to-config-not-cleared -- gate/factories/utils.ts still has "+afterUtils+" import(s) matching ../config/ (before="+BEFORE_FACTORIES_TO_CONFIG_UTILS+")");process.exit(1)}
  const afterGoalFactory=countFactoriesToConfig(rd(path.join(src,"gate/factories/goal.ts")));
  if(afterGoalFactory!==0){console.error("CAUSE=factories-to-config-not-cleared -- gate/factories/goal.ts still has "+afterGoalFactory+" import(s) matching ../config/ (before="+BEFORE_FACTORIES_TO_CONFIG_GOAL+")");process.exit(1)}
  const NEGCTL_LINE="import { resolveAcceptanceTimeoutMs as __negctl } from \"./gate/config/utils.ts\";\n";
  const scratchWithRegression=NEGCTL_LINE+rd(path.join(src,"core","goal-store.ts"));
  const negCount=countRootToGateConfig(scratchWithRegression);
  if(negCount!==afterRoot+1){console.error("CAUSE=negative-control-not-falsifiable -- a scratch copy of goal-store.ts with the retired import prepended did not raise the ./gate/config/ count by exactly one (after="+afterRoot+", scratch="+negCount+"); the counter cannot be trusted to detect a real regression");process.exit(1)}
  console.log(JSON.stringify({fork_point:FORK_POINT,before:{root_to_gate_config:BEFORE_ROOT_TO_GATE_CONFIG,factories_to_config_lines:BEFORE_FACTORIES_TO_CONFIG_UTILS+BEFORE_FACTORIES_TO_CONFIG_GOAL+BEFORE_FACTORIES_TO_CONFIG_LOADER},after:{root_to_gate_config:afterRoot,factories_to_config_lines:afterUtils+afterGoalFactory},negative_control_count_on_scratch_regression:negCount}));
  })()' "$src" || { echo "CAUSE=before-after-scan-red -- the scan above printed the specific CAUSE" >&2; exit 1; }
  echo "PASS: root->gate/config edge count 1 -> 0; gate/factories->gate/config line count 5 -> 0 (file deletion + 2 real redirects); negative control on a scratch regression correctly re-detects the old edge"
expect: exit 0 = 边数读数归零且负对照能检测到回归；exit 1 = CAUSE= 指明哪一项；exit 3 =
  kernel/gate-run-options.ts 尚未落地
origin: 重锚 AC-354 的负对照（gap-ac354-negctl-anchor-symbol-retired）：旧负对照把「重插那条被退休的
  import」的落点用一个正则锚在 goal-store.ts 的某一行上，而该行已被与 GOAL-034 无关的合法重构
  411bb34c7（goal-store 的 deadline 解析改为 record-aware）删除，于是 replace 匹配不到、scratch
  与原文逐字相同、计数恒为 0 ⇒ 恒红 CAUSE=negative-control-not-falsifiable（gate-events
  2026-10-12T21:09:36.859Z，旧
  criterionHash=c1f3186e6c56cfd3）。新负对照改为「不依赖原文任何一行」的前插：NEGCTL_LINE +
  rd(goal-store.ts)，断言从 >= 1 加强为 !== afterRoot + 1（漏检 0 与重复计数 > 1 双向判红）。判据其余 8
  条结构断言与 expect 语义逐字不变。原 origin：继 GOAL-030~033 后第五个 goal branch 试点
activatedAt: 2026-10-10T06:03:57.804Z
statusLog:
  - at: 2026-10-10T06:03:57.804Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-10T06:36:02.267Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-10T06:03:57.803Z
---
