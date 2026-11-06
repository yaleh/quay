---
id: gap-meta-scanparkingboard
title: 把 body-PARKED 的 unpark 读数接进 meta-driver 轮读数（当前只有探测器、没有消费者）
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
promotion-driver 每轮已把 body-PARKED 的 unpark 结果写进 .quay/needs-human-parking-recheck.json，但 meta-driver.ts 的 collectReadings 从不读它——于是「解停条件已成立而任务仍 PARKED」这一读数到不了唯一能处置它的层：任务保持 ready+PARKED（被派发池排除，永远不翻 done），而 judgeDeps 把任何非 done 非 superseded 的依赖都算作活跃阻塞，所以它后面的 todo 任务被无限期饿死。GOAL-914 的 AC-939 记录的理由正是这条链：filed 行的 taskId gap-goal-filing-chain-audit 仍 pending，而它的唯一前置 gap-goal-driver-filing-ledger 的声明式 unpark 检查（git merge-base --is-ancestor 64fe08b25 develop && echo landed）今天已经输出 landed。

本轮读数（criteria.AC-939.verdict）= `"fail"`，采于 2026-11-06T14:50:32Z，由 meta-driver 机械采集。
⚠️ 机制词 `scanParkingBoard` 命中【已完成】任务：gap-meta-needs-human-parking-recheck-2.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node --experimental-strip-types --input-type=module -e "import fs from 'node:fs'; import { collectReadings } from './plugin/scripts/meta-driver.ts'; const r = await collectReadings(process.cwd(), null); const p = r && r.parking && r.parking.parked; if (!p || p.evaluated !== true) { console.error('round readings carry no evaluated body-PARKED arm'); process.exit(1); } const c = p.counts || {}; const keys = ['unpark-passed','unpark-still-blocked','no-unpark-check','not-evaluated']; if (!keys.every(k => typeof c[k] === 'number')) { console.error('body-PARKED arm lacks the four-state counts: ' + JSON.stringify(c)); process.exit(1); } const f = '.quay/needs-human-parking-recheck.json'; if (fs.existsSync(f)) { const d = JSON.parse(fs.readFileSync(f,'utf8')); if (JSON.stringify(d.parked.counts) !== JSON.stringify(c)) { console.error('round readings disagree with the durable parking file'); process.exit(1); } } console.log(JSON.stringify(c));"` ⇒ collectReadings 返回里带 parking.parked（evaluated:true + unpark-passed/unpark-still-blocked/no-unpark-check/not-evaluated 四态计数），且与 promotion-driver 落盘的 .quay/needs-human-parking-recheck.json 逐字一致——即读数来自生产载体而不是桩；未评估时 evaluated:false 带 cause，不与「全部解停」同形。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-scanparkingboard.md`