---
id: gap-meta-needs-human-parking-recheck-3
title: 给 unpark-passed 一个执行者：解除 gap-goal-driver-filing-ledger 的过期停泊并按任务体自己的指令翻 done
status: ready
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

## AC
- [x] `node -e "const{execSync}=require('child_process');const fs=require('fs');const r=JSON.parse(execSync('node --experimental-strip-types plugin/scripts/needs-human-parking-recheck.ts --root . --json',{encoding:'utf8'}));const ids=((r.parked&&r.parked.entries)||[]).map(e=>e.id);const p='tasks/gap-goal-driver-filing-ledger.md';const st=fs.existsSync(p)?(((fs.readFileSync(p,'utf8').match(/^status:\s*(\S+)/m)||[])[1])||null):null;const stuck=ids.indexOf('gap-goal-driver-filing-ledger')>=0;if(stuck||st!=='done'){console.error(JSON.stringify({stillParked:stuck,status:st}));process.exit(1)}console.log(JSON.stringify({stillParked:false,status:st}))"` ⇒ needs-human-parking-recheck 的 parked 读面不再把 gap-goal-driver-filing-ledger 列为 unpark-passed，且该任务 frontmatter status 为 done ⇒ 依赖它的 gap-goal-driver-filing-throttle 进入可晋升集合。

## DoD
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Evidence

**2026-11-07 · worktree `/data/home/yale/work/quay-worktrees/gap-meta-needs-human-parking-recheck-3`
（分支 `task/gap-meta-needs-human-parking-recheck-3`，base = develop `5f80411f0`）。**

- **执行的动作（本任务的交付物就是这次执行本身）**——按 `tasks/gap-goal-driver-filing-ledger.md` 文末
  自己写的那一行 unpark 指令逐条执行：
  1. `git -C /data/home/yale/work/quay merge-base --is-ancestor 64fe08b25 develop && echo landed` ⇒ `landed`（exit 0）。
  2. `node --experimental-strip-types packages/quay-native/bin/quay-native.ts task check gap-goal-driver-filing-ledger --json`
     ⇒ `{"gate":"execute->done","ok":true,"acTotal":6,"acChecked":6,"dodTotal":0,"dodChecked":0,
     "reason":"all AC and DoD checkboxes checked; eligible to move to done"}`（在该 worktree 内跑，读的是本分支的盘上任务文件）。
  3. 经 Provider ABI 写入（`quay-native task edit gap-goal-driver-filing-ledger --body <删掉顶部 PARKED 行后的体>
     --status done --expect-status ready`，CAS 断言写者读到的就是 `ready`）⇒ 顶部 `> **PARKED**` 行已删、
     `status: ready → done`；提交 `bac5eff55`（`task_write by cli:` ⇒ 落在本工作树分支，develop 未被触碰）。
- **AC 判据逐字实跑：同一命令的负臂 → 正臂（硬规则 9：可见性 ≠ 执行，必须给出两个不同读数）**
  - 变更**前**（同一 worktree、同一命令）：`{"stillParked":true,"status":"ready"}`，**exit 1**。
  - 变更**后**：`{"stillParked":false,"status":"done"}`，**exit 0**。
  两次之间唯一的变量就是 `tasks/gap-goal-driver-filing-ledger.md` 本身 ⇒ 判据不是在回显实现，它能取假。
- **「⇒ 依赖它的 gap-goal-driver-filing-throttle 进入可晋升集合」的读数**（同一个 checker，
  `ready-pool-check.ts`；它读的是 **develop ref**，故变更后一组用 `--develop <本分支>` 读落地后形态）：
  - 变更前（默认 develop ref）：`gap-goal-driver-filing-throttle` → `depsReady:false`、
    `blockingDeps:["gap-goal-driver-filing-ledger"]`；`excluded` 含
    `gap-goal-driver-filing-ledger|parked,not-yet-flipped`。
  - 变更后（`--develop task/gap-meta-needs-human-parking-recheck-3`）：`gap-goal-driver-filing-throttle` →
    `depsReady:true`、`depsDone:["gap-goal-driver-filing-ledger"]`、`blockingDeps:[]`；`excluded` 只剩
    `gap-ci-self-hosted-runner-shares-fleet-host|parked`（与本任务无关的另一条，见下）。
- ⚠️ **诚实边界（读面时点，不是判据红）**：`ready-pool-check` 的规范读面是 **develop ref**
  （`readTaskFilesAtRefBatch`，硬规则 4b：工作树盘面是过期代理量）。本分支 ff 进 develop 之前，用默认 ref 跑
  仍会看到旧的 `blockingDeps`；上面「变更后」那一组因此用 `--develop <本分支>` 取，而不是把红读成绿。
- **同族人群的边界**：本轮 live 扫描 `parked.entries` 里还有
  `gap-ci-self-hosted-runner-shares-fleet-host`（它的 unpark 检查 `gh api … .status` 输出 `online`、exit 0）。
  它是**同一缺陷的下一个实例**，但不在本任务的 AC 内（AC 只点名 filing-ledger），且它的任务文件不在 `## Touches` 里
  ⇒ ⛔ 本任务不动它，避免制造一条未声明的越界改动。

## Mechanism judgment（DoD 第 2 条）

结论 = **「已有机制在管，缺的是那条指令的执行者」**，不是「机制坏了」：

- 探测器（`plugin/scripts/needs-human-parking-recheck.ts` 的 ARM 2，由
  `gap-meta-needs-human-parking-recheck-2` 落地，实现提交 `81ce2bdc5`）**按设计只报不动作**——
  文件头与 promotion-driver 的调用点都写明「删标记、翻 done 都是人/manager 的动作」。
  本轮 live 读数确实点名了它：`parked.counts={"unpark-passed":2,…}`，
  `gap-goal-driver-filing-ledger` 的 `exitCode:0 / output:"landed\n\n" / state:"unpark-passed"`。
- 这条读数经 `meta-driver` 的 `readingsDigestPartsForParking`（`parked-passed:<id>` token）送进语义半/manager，
  manager 据此立了**本任务** ⇒ 传递链是通的；断的是「读完谁来执行」。
- 所以本任务**只做一次性执行**：经 Provider ABI 删标记 + CAS 翻 done，⛔ **未新建并行机件**、
  未改探测器、更未给它加写模式（那会直接违反 2026-09-20 人裁定与任务 2 的既有设计边界）。
  下一条同类实例（filing-ledger 之外的 PARKED+passed 任务）仍走同一条链：探测器点名 → manager 立任务 → 执行者执行。

## ADR-007 dark axis

- 该轴仍暗,理由:本任务只改任务库里的停泊状态（删一条 PARKED 标记、翻一条任务的 status），不新增或删除任何模块依赖边，因而没有可测的 L_D/L_G 数值读数。

## Touches
- `tasks/gap-goal-driver-filing-ledger.md`
- `tasks/gap-meta-needs-human-parking-recheck-3.md`