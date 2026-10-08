---
id: AC-341
title: 并入后生产读数：GOAL-030 并入之后，develop 上每一次 promotion-driver 机械晋升 todo→ready 都在
  .quay/task-status-events.jsonl 有对应的 promote 事件
status: active
kind: criterion
goal: GOAL-030
criterion: |
  set -u
  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: not inside a git repository" >&2; exit 3; }
  cd "$root"
  t=$(node -e '(()=>{const fs=require("fs");let s="";try{s=fs.readFileSync(".quay/gate-events.jsonl","utf8")}catch{};let r="";for(const l of s.split("\n")){try{const e=JSON.parse(l);if(e.gate==="goal-merge-result"&&e.item_id==="GOAL-030"&&e.payload&&e.payload.outcome==="landed")r=e.timestamp}catch{}};process.stdout.write(r)})()')
  [ -n "$t" ] || { echo "NOT-EVALUATED: GOAL-030 has no landed goal-merge-result yet (post-merge AC)" >&2; exit 3; }
  ids=$(git log develop --since="$t" --format='%s' | sed -nE 's/^tasks: ([^ ]+) todo→ready（promotion-driver 机械晋升）.*/\1/p' | sort -u)
  n=$(printf '%s\n' "$ids" | grep -c .)
  [ "$n" -ge 1 ] || { echo "NOT-EVALUATED: no production promotion-driver todo→ready commit on develop since the merge ($t)" >&2; exit 3; }
  printf '%s\n' "$ids" | node -e '(()=>{const fs=require("fs");const t=Date.parse(process.argv[1]);let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const ids=s.split("\n").filter(Boolean);let ev="";try{ev=fs.readFileSync(".quay/task-status-events.jsonl","utf8")}catch{console.error("CAUSE=event-carrier-absent — .quay/task-status-events.jsonl missing while "+ids.length+" production promotions happened since the merge");process.exit(1)}
  const have=new Set();for(const l of ev.split("\n")){try{const e=JSON.parse(l);if(e.to==="ready"&&e.kind==="promote"&&Date.parse(e.ts)>=t-60000)have.add(e.taskId)}catch{}}
  const miss=ids.filter(i=>!have.has(i));if(miss.length){console.error("CAUSE=flip-without-event — "+miss.length+"/"+ids.length+" production todo→ready flips since the merge have no promote event: "+miss.slice(0,5).join(","));process.exit(1)}
  console.log("PASS: all "+ids.length+" production promotion-driver todo→ready flips since the merge carry a promote event")})})()' "$t"
expect: exit 0 = 并入后的全部生产晋升翻转（至少 1 次）都带事件；exit 1 = 有翻转无事件或事件载体缺失；exit 3 =
  尚未并入或并入后尚无生产晋升。
origin: 人 2026-10-08「现在开始执行…正式创建一个真实的重构 goal，并启用 goal branch」：goal
  分支机制首个真实试点，范围严格限于晋升路径的 todo→ready / ready→todo 两条写入；先验证“在分支上运行 Quay 并验证
  Quay”的自举路径，健康度达标后才进入更大重构。
activatedAt: 2026-10-08T02:31:49.635Z
statusLog:
  - at: 2026-10-08T02:31:49.635Z
    from: draft
    to: active
    actor: cli
    reason: 人 2026-10-08 授权立项并进入 GOAL-030（goal 分支首个真实试点）；承接任务已立并停放（needs-human），激活本
      AC 不会触发乱序自动立案
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-08T02:31:49.634Z
phase: post-merge
---
