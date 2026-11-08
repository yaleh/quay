---
id: gap-meta-collectinertcheckers
title: inertCheckers 的「在飞 vs 写者丢维」判别只看 state==='running'，红套件运行中被误报为 dimension-missing
status: done
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
- [x] `node --experimental-strip-types --input-type=module -e "import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {collectInertCheckers} from './plugin/scripts/meta-driver.ts';const mk=(o)=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'ic-'));fs.mkdirSync(path.join(d,'.quay'));fs.writeFileSync(path.join(d,'.quay','full-suite-state.json'),JSON.stringify(o));return collectInertCheckers(d)};const inflight=mk({state:'red',reason:'failed',startedAt:'2026-01-01T00:00:00.000Z',finishedAt:null,durationMs:null,failures:[]});const terminal=mk({state:'red',reason:'failed',startedAt:'2026-01-01T00:00:00.000Z',finishedAt:1794129259,durationMs:451212,failures:[]});const measured=mk({state:'green',startedAt:'2026-01-01T00:00:00.000Z',finishedAt:1794129259,durationMs:1,notEvaluatedCheckers:[{name:'x'}]});const bad=[];if(inflight.evaluated!==false||inflight.cause!=='suite-in-flight')bad.push('in-flight red snapshot -> '+JSON.stringify(inflight));if(terminal.evaluated!==false||terminal.cause!=='dimension-missing')bad.push('terminal without the field -> '+JSON.stringify(terminal));if(measured.evaluated!==true||measured.names.join(',')!=='x')bad.push('measured -> '+JSON.stringify(measured));if(bad.length){console.error(bad.join('; '));process.exit(1)}console.log('ok')"` ⇒ 三臂同时成立：finishedAt:null 的在飞红快照报 suite-in-flight；finishedAt 有值的终态缺字段仍报 dimension-missing（负控，防止把所有情况都翻成「在飞」）；带 notEvaluatedCheckers 的终态报 evaluated:true 并逐名列出。

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## 落地（worker 记录）
- 修的是**已有机制**（`collectInertCheckers`），未新建并行机制；三个 `evaluated:false` 成因 token 集合不变。
- 判据改为**两条信号取并集**：`finishedAt` 键在且显式 `null` ⇒ `suite-in-flight`；`state:"running"` ⇒ `suite-in-flight`（保留只带 state 的旧载体/手工载体的既有行为，gap-meta-inertcheckersreading 的 AC 即 `{state:"running"}` 单键）；**两个信号都没有 ⇒ 仍按终态缺维度**（宁严不宽——猜成「在飞」会把真正的镜像回归静音）。
- 直接量取自载体自己的写者不变式（契约在 `full-suite-runner.ts`）：起跑 / 早红 / 早红静态检查 / abort / spawn-error 五处在飞写都落 `finishedAt:null`，终态写落 `finishedAt`(epoch 秒)。
- 消费侧规格 `plugin/probes/meta-driver.md` 的 `suite-in-flight` 释义同步 —— 否则语义半仍会以为「只有 state:running 才算在飞」而对红套件在飞重新报回归。
- 判据实跑（worktree）：AC 命令 `ok`（exit 0）；**负控** = 同一条命令在改动前的代码上 exit 1，打印 `in-flight red snapshot -> {"evaluated":false,"names":[],"cause":"dimension-missing"}`；新增单测 `collectInertCheckers: finishedAt 是终态判别量` 在「把判据改回 `state==="running"`」的变异实现上判红（1 fail / 1 pass），恢复后绿。
- 单文件回归：`node --test plugin/test/meta-driver.test.mjs` ⇒ 184 tests / 184 pass / 0 fail。

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `plugin/probes/meta-driver.md`
- `tasks/gap-meta-collectinertcheckers.md`

## 暗轴记录（ADR-007）
- 该轴仍暗,理由:本任务只改 meta-driver 读数侧的终态判别量与它的单测/规格，不新增也不删除任何模块间依赖边，L_D 的依赖结构面与 L_G 的目标闭合面无新增可测增量。
