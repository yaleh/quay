---
id: gap-meta-readparkingrecord
title: needs-human 停放理由有两个生产者、一个读者：worker 写的 `## Blocker` 段 parking-recheck 读不到
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
worker-driver 的 projectBlockerToTaskRecord 把 exited-not-landed 的停放理由写进 `## Blocker`，而 needs-human-parking-recheck 的 readParkingRecord 只认 `## Needs-Human` + `阻碍原因` 行 ⇒ 由 worker 路径停放的整批 needs-human 任务每轮都落 not-evaluated，它们的停放理由永远不会被重判、也就永远不会被判定为已过期。

本轮读数（parking.needsHuman.counts.not-evaluated）= `4`，采于 2026-11-06T17:17:58Z，由 meta-driver 机械采集。
涉及机制关键词：`readParkingRecord`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [ ] `node --experimental-strip-types plugin/scripts/needs-human-parking-recheck.ts --root . --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const r=JSON.parse(s);const c=r.needsHuman.counts;const total=Object.values(c).reduce((a,b)=>a+b,0);if(total<1){console.error('no needs-human tasks judged');process.exit(1)}if((c['not-evaluated']||0)>0){console.error(JSON.stringify(c));process.exit(1)}console.log(JSON.stringify(c))})"` ⇒ recheck 对每一条 needs-human 任务都能从它自己记录下来的停放理由给出判定（not-evaluated 计数为 0），而不是整批不可评估；同时判定的总数仍 >0（负控：⛔ 不许通过把任务移出 needs-human 来凑绿）。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/needs-human-parking-recheck.ts`
- `plugin/scripts/worker-driver.ts`
- `tasks/gap-meta-readparkingrecord.md`