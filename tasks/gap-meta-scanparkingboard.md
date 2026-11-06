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

## AC
- [x] `node --experimental-strip-types --input-type=module -e "import fs from 'node:fs'; import { collectReadings } from './plugin/scripts/meta-driver.ts'; const r = await collectReadings(process.cwd(), null); const p = r && r.parking && r.parking.parked; if (!p || p.evaluated !== true) { console.error('round readings carry no evaluated body-PARKED arm'); process.exit(1); } const c = p.counts || {}; const keys = ['unpark-passed','unpark-still-blocked','no-unpark-check','not-evaluated']; if (!keys.every(k => typeof c[k] === 'number')) { console.error('body-PARKED arm lacks the four-state counts: ' + JSON.stringify(c)); process.exit(1); } const f = '.quay/needs-human-parking-recheck.json'; if (fs.existsSync(f)) { const d = JSON.parse(fs.readFileSync(f,'utf8')); if (JSON.stringify(d.parked.counts) !== JSON.stringify(c)) { console.error('round readings disagree with the durable parking file'); process.exit(1); } } console.log(JSON.stringify(c));"` ⇒ collectReadings 返回里带 parking.parked（evaluated:true + unpark-passed/unpark-still-blocked/no-unpark-check/not-evaluated 四态计数），且与 promotion-driver 落盘的 .quay/needs-human-parking-recheck.json 逐字一致——即读数来自生产载体而不是桩；未评估时 evaluated:false 带 cause，不与「全部解停」同形。

## DoD
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Evidence

**实现提交 `33092d818`（worktree `/data/home/yale/work/quay-worktrees/gap-meta-scanparkingboard`）**

- 单测 163/163 绿（`node --no-warnings --experimental-strip-types --test plugin/test/meta-driver.test.mjs`），
  其中本任务新增 6 条 parking 用例：载体优先（夹具计数不可能由现扫得到 ⇒ 重扫会当场红）、
  载体缺失时回退现扫且回退可见、两路皆失败 ⇒ `evaluated:false` + `counts:null`、
  载体自身 `evaluated:false`（生产方落全 0）⇒ 消费侧翻 `null` 不清零透传、
  载体读不懂/自相矛盾/来自别的工作区 ⇒ 不采用、digest 只随点名清单与未评估位变化（计数/年龄不进）。

**AC 判据实跑（worktree，干净态 = 无 `.quay/needs-human-parking-recheck.json`）**
`{"unpark-passed":2,"unpark-still-blocked":0,"no-unpark-check":4,"not-evaluated":0}`，exit 0。
⚠️ 诚实边界：干净 worktree 里没有该载体，`fs.existsSync(f)` 为假 ⇒ AC 里的**等值子句**在这一跑是空过的；
它由下面第二、三条跑真正行使。

**生产载体确被消费（root = 主检出）**：`collectParkingReadings('/data/home/yale/work/quay')` ⇒
`source:"carrier"`、`ageMs≈5489`（promotion-driver 每轮在写）、counts `2/0/4/0` 与盘上文件逐字相同、
entries = `gap-ci-self-hosted-runner-shares-fleet-host`, `gap-goal-driver-filing-ledger`。

**等值子句的真实行使**：在 worktree 内放一份载体，其计数 `5/1/0/0` **不可能**由现扫得到
（现扫当时是 `2/0/4/0`）⇒ AC 打印 `{"unpark-passed":5,...}`、exit 0 ⇒ 读数确实来自载体而非重跑探测器。
（该夹具随后删除，worktree 回到干净态；`.quay/needs-human-parking-recheck.json` 非 gitignore，已用 `rm` 清理，`git status` 只剩两个代码文件。）

**负控制（判据能取假，三次定点变异，各自只红对应的那条信息）**
1. `collectParkingReadings` 忽略载体（强制走现扫）⇒ `round readings disagree with the durable parking file`，exit 1。
2. `collectReadings` 不再挂 `parking` 字段 ⇒ `round readings carry no evaluated body-PARKED arm`，exit 1。
3. 把四态计数键之一改坏（`not-evaluatedX`）⇒ 载体被判读不懂 → 回退现扫 → `round readings disagree…`，exit 1。
三次均从备份还原后重跑 AC 得 exit 0 ⇒ 绿不是在回显实现。

**DoD 第 2 条（修既有机制、不新建并行）**：`scanParkingBoard` / `PARKING_READING_REL` 全部从
`needs-human-parking-recheck.ts` 取（同一个探测器、同一个载体路径），本任务只补【消费者】——
未新增任何判据、未新增任何载体文件。

## ADR-007 dark axis

- L_G archguard: cycles=0, maxScc=1
- L_D archguard: bridges=0, removable-edges=76
  读数作用域 `packages`（typescript，44 entities / 182 relations，`evaluated=true`，archguard_analyze @ HEAD f4bd37d708cf）。
  ⚠️ 诚实边界：archguard 的包图只覆盖 `packages/`（它自报未被任何 query scope 覆盖的目录里就有 `plugin/scripts/`），
  而本任务的改动全在 `plugin/scripts/meta-driver.ts` + `plugin/test/` ⇒ 上面两条是**产品依赖图的回归读数**，
  不是对本任务新增的 `plugin/scripts/meta-driver.ts → plugin/scripts/needs-human-parking-recheck.ts` 这条边的测量。

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-scanparkingboard.md`