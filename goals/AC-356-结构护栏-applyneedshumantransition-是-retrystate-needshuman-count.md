---
id: AC-356
title: 结构护栏：applyNeedsHumanTransition 是 retryState.needsHuman/counts 的唯一
  mutator；三条路径（stop-terminal/retry-cap/quick-death）收敛，quick-death
  转移现在可观测；非目标文件与函数未动
status: active
kind: criterion
goal: GOAL-035
criterion: |
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  pf="plugin/scripts/driver-filters.ts"
  wf="plugin/scripts/worker-driver.ts"
  grep -q "applyNeedsHumanTransition" "$pf" || { echo "NOT-EVALUATED: $pf does not define applyNeedsHumanTransition yet" >&2; exit 3; }
  node -e '(()=>{const fs=require("fs");
  const rd=(f)=>fs.readFileSync(f,"utf8");
  const live=(t)=>t.split("\n").filter(l=>{const s=l.trim();return !(s.startsWith("//")||s.startsWith("*")||s.startsWith("/*"))}).join("\n");
  const pf="plugin/scripts/driver-filters.ts",wf="plugin/scripts/worker-driver.ts";
  const pfText=live(rd(pf)),wfText=live(rd(wf));
  const defCount=(pfText.match(/^export function applyNeedsHumanTransition\(/mg)||[]).length;
  if(defCount!==1){console.error("CAUSE=not-single-definition -- applyNeedsHumanTransition must be defined exactly once in driver-filters.ts, found "+defCount);process.exit(1)}
  if(!/NeedsHumanKind\s*=.*[\x22\x27]quick-death-backoff[\x22\x27]/.test(pfText)){console.error("CAUSE=kind-not-added -- NeedsHumanKind must include a distinct \"quick-death-backoff\" value (quick-death transitions were mislabelled as the default kind before this task)");process.exit(1)}
  const directAdd=(wfText.match(/retryState\.needsHuman\.add\(/g)||[]).length;
  const directSet=(wfText.match(/retryState\.counts\.set\(/g)||[]).length;
  if(directAdd!==0){console.error("CAUSE=direct-mutation-remains -- worker-driver.ts still mutates retryState.needsHuman.add(...) directly "+directAdd+" time(s) outside applyNeedsHumanTransition");process.exit(1)}
  if(directSet!==0){console.error("CAUSE=direct-mutation-remains -- worker-driver.ts still mutates retryState.counts.set(...) directly "+directSet+" time(s) outside applyNeedsHumanTransition");process.exit(1)}
  if(!/applyNeedsHumanTransition\(/.test(wfText)){console.error("CAUSE=consumer-not-converged -- worker-driver.ts never calls applyNeedsHumanTransition");process.exit(1)}
  const callCount=(wfText.match(/applyNeedsHumanTransition\(/g)||[]).length;
  if(callCount<2){console.error("CAUSE=consumer-not-converged -- expected at least 2 call sites (the needsHumanWrites loop + the quick-death path) in worker-driver.ts, found "+callCount);process.exit(1)}
  if(!/backoff\.newlyNeedsHuman/.test(wfText)){console.error("CAUSE=nongoal-moved -- the newlyNeedsHuman quick-death branch must still exist");process.exit(1)}
  const qdIdx=wfText.indexOf("backoff.newlyNeedsHuman");
  const qdWindow=wfText.slice(qdIdx,qdIdx+600);
  if(!/needsHumanResults\.push\(/.test(qdWindow)){console.error("CAUSE=quick-death-not-recorded -- the quick-death needs-human branch does not push its result into needsHumanResults");process.exit(1)}
  if(!/[\x22\x27]needs-human[\x22\x27]/.test(qdWindow)){console.error("CAUSE=quick-death-not-recorded -- the quick-death needs-human branch does not emit a needs-human json event like the other two paths");process.exit(1)}
  for(const name of ["export function advanceRetryCap(","export function reconcileNeedsHumanWithDisk(","export function markNeedsHuman("]){if(!pfText.includes(name)){console.error("CAUSE=nongoal-moved -- "+name+" must still exist with an unchanged signature in driver-filters.ts");process.exit(1)}}
  if(!/backoff\.cause\s*===\s*[\x22\x27]environment-fatal[\x22\x27]/.test(wfText)){console.error("CAUSE=nongoal-moved -- the environment-fatal halt branch must still exist, unmodified");process.exit(1)}
  const efIdx=wfText.indexOf("backoff.cause === \x22environment-fatal\x22");
  if(efIdx<0){console.error("CAUSE=nongoal-moved -- the environment-fatal halt branch must still exist, unmodified");process.exit(1)}
  const efTail=wfText.slice(efIdx);
  const efReturn=efTail.indexOf("return r;");
  const efNeedsHuman=efTail.indexOf("applyNeedsHumanTransition(");
  if(efReturn<0||(efNeedsHuman>=0&&efNeedsHuman<efReturn)){console.error("CAUSE=nongoal-moved -- the environment-fatal branch must still hard-return before reaching any needs-human code");process.exit(1)}
  })()' || { echo "CAUSE=structural-scan-red -- the scan above printed the specific CAUSE" >&2; exit 1; }
  oos=$(git diff --name-only develop...HEAD -- plugin/scripts/goal-driver.ts plugin/scripts/promotion-driver.ts plugin/scripts/meta-driver.ts plugin/scripts/quality-gate-driver.ts plugin/scripts/outer-driver.ts plugin/scripts/driver-runtime.ts plugin/scripts/driver-shared.ts plugin/scripts/driver-config.ts 2>/dev/null)
  [ -z "$oos" ] || { echo "CAUSE=out-of-scope-edit -- this goal must not touch: $(echo $oos | tr '\n' ' ')" >&2; exit 1; }
  echo "PASS: applyNeedsHumanTransition is the single mutator of retryState.needsHuman/counts in worker-driver.ts; all 3 real call sites (stop-terminal, retry-cap, quick-death) converge on it; the quick-death path now records its result like the other two; non-goal functions and the environment-fatal early return are untouched"
expect: exit 0 = 单一 mutator + 三路径收敛 + quick-death 可观测 + 非目标未动；exit 1 = CAUSE=
  指明哪一项；exit 3 = applyNeedsHumanTransition 尚未落地
origin: 继 GOAL-030~034 后第二阶段
activatedAt: 2026-10-10T09:38:55.464Z
statusLog:
  - at: 2026-10-10T09:38:55.464Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-10T09:38:55.464Z
---
