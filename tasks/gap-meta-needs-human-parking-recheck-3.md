---
id: gap-meta-needs-human-parking-recheck-3
title: 给 unpark-passed 一个执行者：解除 gap-goal-driver-filing-ledger 的过期停泊并按任务体自己的指令翻 done
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
needs-human-parking-recheck 每轮报出 unpark-passed（该任务自身声明的检查已输出 landed，exit 0），但这个读数没有执行者：任务体明确写着「输出 landed … 删掉顶部 **PARKED** 行后按 quay task check 走 ready→done 即可」，条件已满足而没有任何机制去执行它 ⇒ 该任务停在 status: ready + PARKED，其下游整条 GOAL-914 工作链（filing-throttle → next-projection → blocked-taxonomy → request-queue，以及 filing-chain-audit）全部无法晋升，AC-935/936/937/939 连续 32/32/34/21 轮红。

本轮读数（parking.parked.reportedPassed）= `2`，采于 2026-11-06T16:33:50Z，由 meta-driver 机械采集。
⚠️ 机制词 `needs-human-parking-recheck` 命中【已完成】任务：gap-ci-red-needs-human-recheck-real-board-zero-pin.md[done]、gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency.md[done]、gap-meta-needs-human-parking-recheck-2.md[done]、gap-meta-needs-human-parking-recheck.md[done]、gap-meta-scanparkingboard.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node -e "const{execSync}=require('child_process');const fs=require('fs');const r=JSON.parse(execSync('node --experimental-strip-types plugin/scripts/needs-human-parking-recheck.ts --root . --json',{encoding:'utf8'}));const ids=((r.parked&&r.parked.entries)||[]).map(e=>e.id);const p='tasks/gap-goal-driver-filing-ledger.md';const st=fs.existsSync(p)?(((fs.readFileSync(p,'utf8').match(/^status:\s*(\S+)/m)||[])[1])||null):null;const stuck=ids.indexOf('gap-goal-driver-filing-ledger')>=0;if(stuck||st!=='done'){console.error(JSON.stringify({stillParked:stuck,status:st}));process.exit(1)}console.log(JSON.stringify({stillParked:false,status:st}))"` ⇒ needs-human-parking-recheck 的 parked 读面不再把 gap-goal-driver-filing-ledger 列为 unpark-passed，且该任务 frontmatter status 为 done ⇒ 依赖它的 gap-goal-driver-filing-throttle 进入可晋升集合。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `tasks/gap-goal-driver-filing-ledger.md`
- `tasks/gap-meta-needs-human-parking-recheck-3.md`