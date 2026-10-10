---
id: AC-359
title: 结构护栏：computeDispatchExclusion 是 {inFlight,retryExhausted} 的唯一纯函数计算点，不含
  backoff；两消费者收敛到一次调用
status: draft
kind: criterion
goal: GOAL-036
criterion: |
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  df="plugin/scripts/driver-filters.ts"
  wf="plugin/scripts/worker-driver.ts"
  grep -q "computeDispatchExclusion" "$df" || { echo "NOT-EVALUATED: $df does not define computeDispatchExclusion yet" >&2; exit 3; }
  node -e '(()=>{const fs=require("fs");
  const rd=(f)=>fs.readFileSync(f,"utf8");
  const live=(t)=>t.split("\n").filter(l=>{const s=l.trim();return !(s.startsWith("//")||s.startsWith("*")||s.startsWith("/*"))}).join("\n");
  const df="plugin/scripts/driver-filters.ts",wf="plugin/scripts/worker-driver.ts";
  const dfText=live(rd(df)),wfText=live(rd(wf));
  const defCount=(dfText.match(/^export function computeDispatchExclusion\(/mg)||[]).length;
  if(defCount!==1){console.error("CAUSE=not-single-definition -- computeDispatchExclusion must be defined exactly once in driver-filters.ts, found "+defCount);process.exit(1)}
  const fnStart=dfText.indexOf("export function computeDispatchExclusion(");
  const fnBody=dfText.slice(fnStart,fnStart+1200);
  const fnEnd=fnBody.indexOf("\n}\n")>=0?fnBody.slice(0,fnBody.indexOf("\n}\n")+2):fnBody;
  if(/backedOff|isBackedOff/.test(fnEnd)){console.error("CAUSE=scope-crept -- computeDispatchExclusion must NOT fold in backoff/backedOff; backoff must stay a per-candidate fresh Date.now() check, not a round-start snapshot (that would reintroduce the stale-backoff bug this goal explicitly excludes)");process.exit(1)}
  if(/fs\.|spawnSync|spawn\(|await /.test(fnEnd)){console.error("CAUSE=not-pure -- computeDispatchExclusion must be a pure function (no I/O), found fs/spawn/await inside its body");process.exit(1)}
  const stepIdx=wfText.indexOf("step = \"ready-pool\"");
  if(stepIdx<0){console.error("CAUSE=nongoal-moved -- the ready-pool dispatch step marker is gone");process.exit(1)}
  const applyIdx=wfText.indexOf("step = \"apply-filters\"");
  if(applyIdx<0||applyIdx<stepIdx){console.error("CAUSE=nongoal-moved -- the apply-filters dispatch step marker is gone or reordered");process.exit(1)}
  const window=wfText.slice(stepIdx,applyIdx+400);
  const callCount=(window.match(/computeDispatchExclusion\(/g)||[]).length;
  if(callCount!==1){console.error("CAUSE=not-converged -- expected exactly 1 call to computeDispatchExclusion between the ready-pool and apply-filters steps (both consumers must read the same computed value), found "+callCount);process.exit(1)}
  const inFlightTasksCallsInWindow=(window.match(/inFlightTasks\(\)/g)||[]).length;
  if(inFlightTasksCallsInWindow>0){console.error("CAUSE=not-converged -- the old inFlightTasks() closure is still called "+inFlightTasksCallsInWindow+" time(s) in this window; both call sites must read the single computeDispatchExclusion result instead");process.exit(1)}
  if(!/Date\.now\(\)/.test(wfText.slice(applyIdx,applyIdx+1200))){console.error("CAUSE=nongoal-moved -- the per-candidate fresh Date.now() backoff check near apply-filters is gone");process.exit(1)}
  for(const name of ["export function advanceRetryCap(","export interface RetryState","export function isBackedOff("]){const inD=dfText.includes(name),inW=wfText.includes(name);if(!inD&&!inW){console.error("CAUSE=nongoal-moved -- "+name+" must still exist unchanged");process.exit(1)}}
  })()' || { echo "CAUSE=structural-scan-red -- the scan above printed the specific CAUSE" >&2; exit 1; }
  oos=$(git diff --name-only develop...HEAD -- packages/quay/src/gate packages/quay/src/goal-store.ts packages/quay/src/goal-merge.ts plugin/scripts/worker-fan-in.ts plugin/scripts/ready-pool-check.ts 2>/dev/null)
  [ -z "$oos" ] || { echo "CAUSE=out-of-scope-edit -- this goal must not touch: $(echo $oos | tr '\n' ' ')" >&2; exit 1; }
  echo "PASS: computeDispatchExclusion is the single, pure, round-start source of {inFlight, retryExhausted}; both the ready-pool and apply-filters call sites read its one result instead of independently re-deriving; backoff stays an unchanged per-candidate fresh Date.now() check; Gate/Fan-in/Goal files untouched"
expect: exit 0 = 单一纯函数 + 双调用归零 + backoff 现场判定不变 + 越界文件未动；exit 1 = CAUSE=
  指明哪一项；exit 3 = computeDispatchExclusion 尚未落地
origin: 用户 2026-10-11 正式批准推进三条架构改进（Driver/Routine/Pool、Gate/Fan-in、Goal
  transition），本 goal 是优先项①的实施，②③本轮只设计不实施
---
