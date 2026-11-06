---
id: gap-meta-needs-human-parking-recheck-2
title: PARKED 只有排除半边：任务体里写明的 unpark 检查无人复跑，GOAL-914 全部剩余任务卡在同一条 PARKED 依赖后面
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
ready-pool-check 的 isParked 只把带行首 `**PARKED` 标记的任务挡出派发池，没有任何机件复跑任务体里写明的 unpark 检查；GOAL-914 仅剩的 5 条任务（filing-throttle→next-projection→blocked-taxonomy→request-queue，以及 filing-chain-audit）全部 depends_on 同一个 PARKED 的 gap-goal-driver-filing-ledger，而它文末的 unpark 检查（git merge-base --is-ancestor 64fe08b25 develop && echo landed）今天已返回 landed ⇒ 4 条 open AC 每轮只落 stalled/world-gated 而无人被通知；同族缺陷 needs-human 已有 needs-human-parking-recheck（只报不翻，人 2026-09-20 裁定），但 PARKED 人群没有对应读数 ⇒ 本条是把该机制扩到第二个人群，⛔ 不新建并行机制。

本轮读数（criteria.AC-939.reason）= `"acceptance failed (exit 1) — {\"filedTaskIds\":[\"gap-goal-filing-chain-audit\"],\"pending\":[\"gap-goal-filing-chain-audit\"]}"`，采于 2026-11-06T13:28:00Z，由 meta-driver 机械采集。
⚠️ 机制词 `needs-human-parking-recheck` 命中【已完成】任务：gap-ci-red-needs-human-recheck-real-board-zero-pin.md[done]、gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency.md[done]、gap-meta-needs-human-parking-recheck.md[done]、gap-needs-human-park-overwritten-by-inflight-worker.md[done]、gap-routine-semantic-dedup-scan-parseargs-seven-forked-loops.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC
- [x] `node --no-warnings --experimental-strip-types --test plugin/test/needs-human-parking-recheck.test.mjs && node --no-warnings --experimental-strip-types plugin/scripts/needs-human-parking-recheck.ts --root . --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j;try{j=JSON.parse(s)}catch{console.error('reading is not JSON');process.exit(1)}const p=j.parked;if(!p||p.evaluated!==true||!Array.isArray(p.entries)){console.error('missing evaluated parked arm: '+Object.keys(j).join(','));process.exit(1)}console.log(JSON.stringify({parkedEvaluated:true,entries:p.entries.length}))})"` ⇒ recheck 每轮对 body-PARKED 人群也产出一个 evaluated 读数：复跑任务体宣告的 unpark 命令（超时受限、只读），只报「命令已通过而任务仍 PARKED」的那些，命令失败/未宣告/读不懂各自是独立取值；gap-goal-driver-filing-ledger 当轮即被点名，人/manager 据此删标记并翻 done（机件自身永不改 status）。

## DoD
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Evidence

**判据实跑（2026-11-06，worktree `/data/home/yale/work/quay-worktrees/gap-meta-needs-human-parking-recheck-2`，实现提交 `81ce2bdc5`）**

- 测试文件 17/17 绿：`node --no-warnings --experimental-strip-types --test plugin/test/needs-human-parking-recheck.test.mjs`
  —— AC1 的七个臂（needs-human 人群）全绿，本任务新增 AC2(a)…(j) 九个臂全绿。
- **AC 那条命令逐字实跑**：`{"parkedEvaluated":true,"entries":1}`（exit 0）。第二次单跑同一条 detector 得 `entries=2`
  ——`entries` 的条数取决于 `gh api` 当刻能否取到 runner 状态，这是被测量对象自身的抖动，不是判据抖动
  （判据只要求 `parked.evaluated===true` 且 `entries` 是数组）。
- **真实板读数**（`--root . --json`）：`parked.evaluated=true`、`parked_total=6`、
  `counts={"unpark-passed":2,"unpark-still-blocked":0,"no-unpark-check":4,"not-evaluated":0}`、
  `entries=["gap-ci-self-hosted-runner-shares-fleet-host","gap-goal-driver-filing-ledger"]`。
  两条 exitCode 均为 0，输出分别为 `online` / `landed` ⇒ **gap-goal-driver-filing-ledger 当轮即被点名**（AC 要求的正是它）。
- **负控制（判据能取假，两次定点变异，均只红对应的那一个臂）**：
  1. 把 pass 谓词里的 `missingToken` 改成恒 `false`（即「exit 0 就算通过」）⇒ `16 pass / 1 fail`，**唯一红的是 AC2(b)**。
  2. 把能力判定的守卫改成永不触发 ⇒ `16 pass / 1 fail`，**唯一红的是 AC2(f)**。
  两次都从备份还原后重跑 17/17 全绿 ⇒ 判据不是在回显实现。
- ⛔ 只读端到端：AC2(i)（CLI 单跑）与 AC2(h)（完整 driver 轮）都断言任务文件字节不变——status 与 `**PARKED` 标记都不被机件改动。
- 「已有机制在管、只是失败」的裁定：needs-human-parking-recheck 的**机制**是对的，缺的是它只覆盖一个人群；
  故本条**扩同一条读数**（`scanParkingBoard` = 两个臂，一个读数文件，一个每轮消费者），⛔ 未新建并行机件。

## ADR-007 dark axis

- L_G archguard: cycles=0, maxScc=1
- L_D archguard: removable-edges=76, bridges=0
  读数作用域 `packages`（typescript，44 entities / 182 relations，`evaluated=true`，archguard_analyze @ HEAD 3daca2db7b9）。
  ⚠️ 诚实边界：archguard 的包图只覆盖 `packages/`（它自己列的「未被任何 query scope 覆盖的目录」里就有 `plugin/scripts/`），
  而本任务的改动全在 `plugin/scripts/` 与 `plugin/test/` ⇒ 上面两条是**产品依赖图的回归读数**，
  不是对本任务新增的两条 `plugin/scripts → packages/quay/src/core` 边的测量。

## Touches
- `plugin/scripts/needs-human-parking-recheck.ts`
- `plugin/scripts/promotion-driver.ts`
- `plugin/test/needs-human-parking-recheck.test.mjs`
- `tasks/gap-meta-needs-human-parking-recheck-2.md`
