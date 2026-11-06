---
id: gap-meta-classifyrecoveryround
title: 恢复阶梯把 SUITE-NOT-RUN 轮折成 complete-red：被拒轮从未跑过任何测试，却判「baseline-equivalence
  not evaluable — needs a code fix」
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
worker-fan-in.ts 的主路径已按 SUITE-NOT-RUN 标记区分「没跑」与「跑了且红」，但恢复阶梯的 classifyRecoveryRound 只看 watchdog/spawnFailed/空日志三态，把资源闸 WAIT 的恢复轮判成 complete-red，进而在 A/B 里得到 not-evaluated；判词因此指向受害任务自己的代码（实测：gap-goal-driver-filing-ledger 的 recovery-16 日志整份只有一行 SUITE-NOT-RUN branch=resource-gate-wait，3.4 秒内被判红），而该任务正是 GOAL-914 整条依赖链的链头

本轮读数（criteria.AC-937.verdict）= `"fail"`，采于 2026-11-06T10:08:02Z，由 meta-driver 机械采集。
⚠️ 机制词 `classifyRecoveryRound` 命中【已完成】任务：gap-routine-semantic-dedup-scan-defaultroot-byte-identical-quad.md[done]、gap-routine-semantic-dedup-scan-list-script-basenames-diverged-under-one-name.md[done]、gap-routine-semantic-dedup-scan-print-json-three-behaviours.md[done]、gap-suite-recovery-ladder-log-wiring-reads-wrong-file-always-log-unreadable.md[done]、gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## Acceptance Criteria
- [x] `node --experimental-strip-types --input-type=module -e "import {classifyRecoveryRound} from './plugin/scripts/worker-fan-in.ts'; const log='[full-suite-runner] SUITE-NOT-RUN branch=resource-gate-wait ts=x reason=overloaded - no test was executed by this round\n'; const run={outcome:'done',exitCode:1,signalCode:null,hungByWatchdog:false,startedAt:'x',finishedAt:'x',durationMs:3400,error:null,pid:1}; const r=classifyRecoveryRound(run,log,16,process.cwd()); console.log(r.kind); if(r.kind==='complete-red'||r.kind==='certified') process.exit(1);"` ⇒ 一行只含 SUITE-NOT-RUN 的恢复轮日志既不得被判成 complete-red（会进入 A/B 并误指代码缺陷），也不得被判成 certified（更坏：没跑当绿）；分类须落到一个具名的「本轮未运行」取值并带出拒绝分支名，与主路径 failSuite('suite NOT run (refused) …') 同形

## Definition of Done
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/worker-fan-in.ts`
- `plugin/test/full-suite-runner-oom-policy.test.mjs`
- `tasks/gap-meta-classifyrecoveryround.md`

## Evidence

### 0. 查重：那 5 个 done 任务都没有在管这条缺陷（⛔ 所以是修既存机制，不是新建并行机制）
`classifyRecoveryRound` 的机制词命中 5 个 done 任务，逐个核对**它们改的是哪一半**：
- `gap-suite-recovery-ladder-log-wiring-reads-wrong-file-always-log-unreadable`[done]：修的是**写/读路径**（`recoverySuiteCommand` 把 argv 的 `--log-file` 重定向到本档自己的 `recLogFile`，使 runner 写的那份与分类器读的那份是同一个路径）。它把「恒 `log-unreadable`」修好了，**判定逻辑本身一字未动**——`classifyRecoveryRound` 仍是「watchdog / spawnFailed / 空日志」三态。⇒ 本任务接的是它没覆盖的那一段：**日志读到了、内容明说「没跑」，却落进 complete-red**。
- `gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls`[done]、3 × `gap-routine-semantic-dedup-scan-*`[done]：与本缺陷无因果关系（分别是资源测量 adapter 与例程查重）。
⇒ 结论：**已有机制在管、只是漏了一种形态** ⇒ 按 DoD 第二条，**在原函数上扩一个取值**（`RecoveryRoundReading` 新增 `{kind:"not-run"}`）+ 在既有阶梯消费者上加一条分支，⛔ 未新建任何并行分类器/并行判据。

### 1. 生产复现（真实载体，⛔ 不是造出来的夹具）
- 日志：`.quay/fan-in-suite-gap-goal-driver-filing-ledger~wk-prod-anchor~recovery-16-1793956845521-c91de4.log`，**333 字节、整份 1 行**：
  `[full-suite-runner] SUITE-NOT-RUN branch=resource-gate-wait ts=2026-11-06T09:20:48.929Z reason="resource gate says WAIT — => WAIT: 过载窗口（load 396.68 >= nproc×2≈256）…" — no test was executed by this round`
  （另一例同形：`…gap-routine-semantic-dedup-scan-discovery-config-reader-template~…~recovery-16-1793957270077-322106.log`，同为 333 字节、同为 `resource-gate-wait`。）
- 修复**前**（基线 098f2d178 的 worktree 副本，逐字跑 AC 判据）：`complete-red`，`exit=1` ⇒ 正是 Finding 说的形态（随后进 A/B ⇒ `baseline-equivalence not evaluable — needs a code fix`，把一次**过载拒绝**指到受害任务自己的代码上）。
- 修复**后**（同一命令、同一入参）：`not-run`，`exit=0`。

### 2. 实现（改动面 = 2 个代码文件，均在 ## Touches 内）
- `extractSuiteNotRunMarker`（新）：复用既存 `extractSuiteNotRunLine` 与同源前缀常量 `SUITE_LOG_NOT_RUN_PREFIX`，把标记行解析成 `{line, branch, reason}`。`reason=` 是生产者 `JSON.stringify` 的产物（值里合法地含空格/破折号/中文标点）⇒ 按 JSON 字符串整体取，**⛔ 不用 `(\S+)` 切**（那会把原因截成第一个词）；解析失败退回原始捕获（⛔ 不丢证据）。
- `RecoveryRoundReading` 新增 `{ kind: "not-run"; run; refusal; concurrency }`：**没有 `failures` 字段** ⇒ 与 `incomplete` 同一纪律，签名比较器（A/B）**结构上**拿不到它；**也没有 `plan` 字段**（没跑的轮次不会写 SUITE-PLAN，给个恒 null 字段只会造假读数）。
- `classifyRecoveryRound`：标记判定**先于**退出码/plan/incomplete/exit-0 ⇒ 「跑没跑」由标记给出，⛔ 不由退出码推断（拒绝分支今天恒返回 1，但以 0 退出的拒绝轮若被归为 `certified` 就是「没跑当绿」，AC 明写这更坏）。
- 消费者（恢复阶梯循环）：`not-run` ⇒ 记 `refusedSeen` + 一条带 `refused:true / branch / refusal` 的 `suite-recovery` 事件，然后**降一档**（梯子仍是有界声明式序列，⛔ 不加档、⛔ 不原地重试）；整条梯子一档都没认证时，判词是 `recovery round NOT run (refused at concurrency N) — <标记行>` + `branch=<name>` + `NOT evidence of a code defect`，**⛔ 不再回落成 `needs a code/config fix`**，也 ⛔ 不再出现 `baseline-equivalence not evaluable`。终局 `suite-recovery-blocked` 事件带 `refused`/`refusal`。
- ⚠️ 当场撞到并修掉的自身缺陷（记下来，⛔ 不粉饰）：`blockedNextStep ?? (refusedSeen ? … : …)` 若省掉括号会被解析成 `(blockedNextStep ?? refusedSeen) ? … : …`（`??` 优先级高于 `?:`）⇒ 任何**有真结论**的恢复轮都会去求值 `refusedSeen`（此时恒 null）并抛 `TypeError`。是本文件里 4 个既有测试当场变红暴露的，已加括号并在注释里钉住原因。

### 3. 判据能取假（硬规则 4 的对照臂）
- 测试① 内含**逐字复制**的修复前判定链（基线 098f2d178），对**同一份生产日志**取出 `complete-red`；同一份日志交给修复后的函数取出 `not-run`。两臂同时留在测试里 ⇒ 判据不是恒真。
- **变异控制（实跑）**：把新分支改成 `if (false && refusal !== null)` 后重跑两条新测试 ⇒ **2/2 红**（`actual: 'complete-red'`，`expected: 'not-run'`；消费者半边红在 `recovery round NOT run (refused at concurrency N)`）。恢复实现后 2/2 绿。
- 负控制（⛔ 新取值不吞既有三类结论）：真红日志仍 `complete-red`；全绿仍 `certified`；0 字节日志仍 `no-conclusion(log-unreadable)`。

### 4. 消费者半边的端到端读数（`plugin/test/full-suite-runner-oom-policy.test.mjs` 新增第 2 条）
原轮 OOM（planned=579 terminal=65 missing=514 oomKill=4 laneCount=64）⇒ 阶梯 `[48,32,16]`，**每一档**都只写出那一行 SUITE-NOT-RUN、exit 1：
- `outcome=red`；`reason` 匹配 `recovery round NOT run (refused at concurrency \d+)` ∧ `branch=resource-gate-wait` ∧ `NOT evidence of a code defect`；**不匹配** `needs a code(/config)? fix`、**不匹配** `baseline-equivalence not evaluable`。
- 梯子仍**有界**：`recoveryRoundsSeen` 的 laneCount 序列 = `["48","32","16"]`（每档恰好一次、降序、然后停）。
- 留痕：3 条 `suite-recovery` refused 事件（各自档位 + 分支名 + 原始标记行）+ 1 条 `suite-recovery-blocked{refused:true, refusal:<marker>}`。

### 5. 门与静态读数
- 全文件：`node --test plugin/test/full-suite-runner-oom-policy.test.mjs` ⇒ **26/26 pass**（含既有的 AC10/AC11/AC12/AC13(a)(b) 恢复阶梯用例，逐字无改动）。
- 类型：`for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done` ⇒ exit 0。
- scoped 门：`bash scripts/test.sh --for-task gap-meta-classifyrecoveryround --allow-thin` ⇒ **36 pass / 0 fail**（48.1s）。
- anti-drift：`anti-drift-touches-check.ts --task gap-meta-classifyrecoveryround --worktree <wt> --merge-target develop` ⇒ `ANTI-DRIFT OK — 3 actual file(s), all within declared Touches (3 glob(s))`。
- `fan-in-ac-completion-gate.ts --worktree <wt> --json` ⇒ `ok:true, status:"pass", 3/3`。
- L_D archguard（`plugin/scripts/archguard-runner.ts --root <worktree>`，worktree HEAD `839046bb6`，2026-11-06）：6/6 scope `evaluated=true`，全部 `entitySccCount=0` ∧ `directoryCycleCount=0`（scripts scope：entities=4810 relations=10978；`PASS — no dependency cycles in any scope`）。

### 6. 顺带发现（⛔ 不在本任务 Touches 内，仅记录，未改）
`packages/quay-native/src/store.ts` 的 execute→done 闸用 `sectionAfterHeading(body, ["AC","Acceptance Criteria"])`（kernel `extractSection` 要求**精确**标题），而驱动侧 `ready-pool-check.ts` 的 `extractSectionByShape` 认 `AC（draft）` 等 registered 变体 ⇒ 同一个 finding 形状任务在两侧可得出「3/3」与「0/0」两个读数（本任务当场复现）。本任务把标题改成 `## Acceptance Criteria` / `## Definition of Done`（内容一字未改）使两侧一致；两解析器的口径差本身是独立缺口，未在本任务内修。
