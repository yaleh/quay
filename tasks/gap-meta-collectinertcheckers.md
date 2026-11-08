---
id: gap-meta-collectinertcheckers
title: inertCheckers 的「在飞 vs 写者丢维」判别只看 state==='running'，红套件运行中被误报为 dimension-missing
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
collectInertCheckers 用 state==='running' 作为唯一的在飞信号，但 full-suite-runner.ts:4585 在红套件运行中写的是 state:'red' + reason:'failed' + finishedAt:null（SUITE-RED 事件带文件归因需要这次早写），于是整个红套件的运行期（本例 durationMs=451212ms）都被读成 cause:'dimension-missing'——把「还没测到」说成「写者丢了这一维」，正是硬规则 3b 要消灭的同形；而且它会让每一轮 meta-driver 抓着人报一个并不存在的写者回归。载体自己的 finishedAt/durationMs 就是现成的终态判别量，不需要新机制。

本轮读数（inertCheckers.cause）= `"dimension-missing"`，采于 2026-11-08T09:09:32Z，由 meta-driver 机械采集。
⚠️ 机制词 `collectInertCheckers` 命中【已完成】任务：gap-meta-extractnotevaluatedchecker.md[done]、gap-meta-inertcheckersreading.md[done]、gap-meta-parsenotevaluatedcheckers.md[done]、gap-not-evaluated-checkers-never-persisted.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `node --experimental-strip-types --input-type=module -e "import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {collectInertCheckers} from './plugin/scripts/meta-driver.ts';const mk=(o)=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'ic-'));fs.mkdirSync(path.join(d,'.quay'));fs.writeFileSync(path.join(d,'.quay','full-suite-state.json'),JSON.stringify(o));return collectInertCheckers(d)};const inflight=mk({state:'red',reason:'failed',startedAt:'2026-01-01T00:00:00.000Z',finishedAt:null,durationMs:null,failures:[]});const terminal=mk({state:'red',reason:'failed',startedAt:'2026-01-01T00:00:00.000Z',finishedAt:1794129259,durationMs:451212,failures:[]});const measured=mk({state:'green',startedAt:'2026-01-01T00:00:00.000Z',finishedAt:1794129259,durationMs:1,notEvaluatedCheckers:[{name:'x'}]});const bad=[];if(inflight.evaluated!==false||inflight.cause!=='suite-in-flight')bad.push('in-flight red snapshot -> '+JSON.stringify(inflight));if(terminal.evaluated!==false||terminal.cause!=='dimension-missing')bad.push('terminal without the field -> '+JSON.stringify(terminal));if(measured.evaluated!==true||measured.names.join(',')!=='x')bad.push('measured -> '+JSON.stringify(measured));if(bad.length){console.error(bad.join('; '));process.exit(1)}console.log('ok')"` ⇒ 三臂同时成立：finishedAt:null 的在飞红快照报 suite-in-flight；finishedAt 有值的终态缺字段仍报 dimension-missing（负控，防止把所有情况都翻成「在飞」）；带 notEvaluatedCheckers 的终态报 evaluated:true 并逐名列出。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-collectinertcheckers.md`