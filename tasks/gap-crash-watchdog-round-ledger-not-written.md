---
id: gap-crash-watchdog-round-ledger-not-written
title: 不可捕获地死掉的 runner（外部 SIGKILL / OOM）在 verification-round.jsonl 零行，而
  full-suite-state.json 已诚实写 reason=crashed —— 同族第四条路径
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：`gap-watchdog-killed-round-writes-no-verification-round-record`（2026-09-13）AC6 的族成员枚举。

**族**：「轮未完整跑完 ⇒ `verification-round.jsonl` 不落记录」。已修成员：`gap-verification-round-static-fail-no-record`（done，静态闸 fail / 动态测试 fail）、`gap-fan-in-realsuite-bypasses-verification-round-ledger`（done，真跑 suite 分支零入账）、`gap-watchdog-killed-round-writes-no-verification-round-record`（看门狗 SIGKILL 整组 + suite 从未起来 spawn-failed）。

**本条是第四条，机制不同**：runner 被【不可捕获地】杀死（外部 SIGKILL / OOM-killer）时，runner 自己的 `uncaughtException` / `unhandledRejection` handler 跑不到（`full-suite-runner.ts:2221-2270` 的注释自己就写明 SIGKILL 抓不到），于是 `full-suite-state.json` 的终态由 **suite-state-trigger 的 crash-watchdog** 补写（`reason=crashed`，`plugin/scripts/suite-state-trigger.ts` 的 `writeCrashState`）。**但 crash-watchdog 只写 state 载体、不写 round 台账** ⇒ 同一轮上两个载体各说各话：state 说「runner 死在中途」，round 台账一行都没有 ⇒ 任何以 round 台账为输入的判定器把「没评估」读成「没问题」（硬规则 3b 的镜像半边）。

**读数（发生率）**：`.quay/suite-state-events.jsonl` 中 reason=crashed 的转移 **1 次**（2026-08-12，outer runner，scope=main）；同窗口 `.quay/verification-round.jsonl` 中 reason=crashed 的行 **0 行** ⇒ 那一次转移在 round 台账上没有对应行。发生率低（1 次），故本条不是紧急缺陷，而是族完备性的第四条；但修法与兄弟条同源（把判据挪到产物上）。

**与相邻任务的分工（均非重复）**：`gap-suite-state-trigger-crash-watchdog-breaks-running-transition-test`（done）修的是 crash-watchdog 的【判定】（无 pid 的 running 被误判 crashed），⛔ 不碰 round 台账；`gap-full-suite-state-red-no-failure-detail-static-check-invisible`（done）修的是 state 载体的 reason 词表，**另一个载体**；兄弟条 `gap-watchdog-killed-round-writes-no-verification-round-record` 新增的 `evaluated:false` + `--not-evaluated <token>` 形状正是本条要复用的落法。

## Plan

1. 在 crash-watchdog 的终态写入处（`detectCrashedRunner` 命中后的分支）补写一条 round 台账行：复用 `buildPreVerifiedRoundRecord` + `appendPreVerifiedRound`（⛔ 不新造第二个 writer），`--not-evaluated` 取**独立 token**（如 `runner-died`，⛔ 不与 `watchdog-killed` / `failed` 共用取值）。
2. 幂等：crash-watchdog 由常驻 `runOnce` 驱动、每轮都扫 ⇒ 必须保证**同一 runId 只写一行**（按 runId 在台账里查重，或把已写标记落在 state 上）。⛔ 每轮补写一次 = round 号虚增。
3. 两个载体的 `runId` / `startedAt` 必须同源（否则同一轮在两个载体上对不上，是新的各说各话）。
4. ⛔ 不改 crash-watchdog 的**判定**（那是 `gap-suite-state-trigger-crash-watchdog-breaks-running-transition-test` 的轴）；⛔ 不改控制流。

## Plan 落实的一处偏离（Plan 1 的字面 vs 实际，已核）

**Plan 1 说「复用 `buildPreVerifiedRoundRecord` + `appendPreVerifiedRound`」，实现只复用了后者（共享 appender），行形状在本层定义。** 理由是**实测的**、不是偏好：`buildPreVerifiedRoundRecord` 那条 **fan-in 行形状**的【必需】字段，被杀的一轮**结构上取不到**：

| 必需字段 | 被杀的一轮为什么取不到（实测） |
|---|---|
| `taskId`（非空） | 只有 `mfi-<task>-…` 派生得出；生产实例的 runId 是 **UUID**（`.quay/suite-state-events.jsonl` 唯一那次 `reason=crashed`：`runId=081f8335-a46c-494e-b918-0619f8d59d55`, `scope=main`, `runner=outer`）⇒ 无任务号可填 |
| `load`（数字 ≥0） | 语义是「suite **结束时**的 /proc/loadavg 1min」；这一轮**没有结束** ⇒ 该读数不存在（填 0 会读成「跑完且机器空载」，硬规则 6 禁止的「缺值当为假」） |
| `commit`（40-hex） | `terminalCommit` 只在终态写；被杀的一轮可能只有 `verifiedCommit`，也可能两个都没有 |
| `scope` | builder 硬编码 `"worktree"`，而上面那次生产转移是 `scope="main"` |

⇒ 复用**共享的 appender + 台账路径 + 轮次编号**（`appendPreVerifiedRound` / `roundsPath`），让「这一种轮」的行形状只在**一个取用点**定义（`buildRunnerDiedRoundRow`），⛔ 不散落。**取不到的字段【缺席】，⛔ 不填 0 / 伪造 sha。** 兄弟条落地后若 `pre-verified-round-record.ts` 长出可表达「无可评估字段」的形状，本层可收敛到它（本层的形状是幂等的、收敛是纯删除）。

## Acceptance Criteria

- [x] AC1（可取假·核心）：人为制造一次「runner 被不可捕获地杀」的场景（seam 注入：写一个 state=running 且 pid 指向一个已死进程的 `full-suite-state.json`，跑一轮 crash-watchdog），断言 round 台账出现一行**且只出现一行**（evaluated:false + reason=runner-died）；再跑第二轮 crash-watchdog，断言**台账行数不变**（幂等可取假）。〔取证见 Readings/AC1：两轮台账原文 + 两个方向的取假控制〕
- [x] AC2（与合格不同形·可取假）：该行的 `evaluated` 为 false，且 `reason` 不等于 `failed` / `gate-failed` / `watchdog-killed`；与同窗口的绿轮、红轮各贴一条原文对照。〔取证见 Readings/AC2：同载体真生产绿轮 #1626 / 真生产红轮 #1621 / 本任务 crash 轮三条原文〕
- [ ] AC3（生产载体验证·⚠️允许 not-evaluated）：落地后窗口内台账含 ≥1 条 `reason=runner-died` 的行；⛔ 不得用注入数据记为通过（硬规则 4 推论三：只能被 fixture 满足的判据只证明「能产出」）。若窗口内未自然发生 ⇒ 记 not-evaluated 并写明窗口长度。（待外部）
- [x] AC4（⛔ 不引入阻塞）：落地后窗口内 `mfi-` 轮的 `exited-not-landed` 比例未因本改动上升（给出落地前后两个读数）。〔取证见 Readings/AC4：落地前 7 日 305/591=0.516 + 逐日；落地后窗口 0 长度 ⇒ 不可观测，附结构化对照与新增 I/O 实测〕
- [x] AC5（硬规则 5b）：本轮修好后，用**同一条命令**再枚举一次「该族还有没有第五条」，附命中数与前 3 条。〔取证见 Readings/AC5：族表 + 反查「events 词表 − 台账词表 = {crashed}」〕

## Definition of Done

- crash-watchdog 的补写落地；纯函数 / 幂等部分有单测且含**可失败控制**（把写入去掉即红、把幂等判据去掉即红）。〔取证见 Readings/「DoD 控制」：两个方向实测，基线 60/60〕
- AC1 的两轮台账读数、AC2 的三条记录原文、AC5 的族复核读数全部落进任务体读数段。
- ⛔ 不修改 crash-watchdog 的判定逻辑；⛔ 不承担 `void:true` 的下游误读问题。

## Readings

### AC1 — 两轮台账读数（seam：`full-suite-state.json` = state=running + pid 指向已死进程 + `mfi-` runId）

```
round 1（崩溃首次被观测，跑一轮 runOnce）:
  ledger rows: 1
  {"startedAt":"2026-09-13T06:00:00.000Z","durationMs":13159898,"laneCount":16,"state":"red",
   "evaluated":false,"reason":"runner-died",
   "runId":"mfi-gap-crash-watchdog-round-ledger-not-written-1789293000000-a1b2c3",
   "runner":"inner","scope":"worktree","commit":"0bce0eebd7c93cda527475416244d7d1bb9514fe",
   "taskId":"gap-crash-watchdog-round-ledger-not-written","round":1}
round 2（**同一个 runId** 再被观测为 running + 死 pid，再跑一轮 runOnce）:
  ledger rows: 1      ← 行数不变，且该行逐字同上（round 仍为 1，未虚增）
```

同源核对（Plan 3）：台账行的 `runId` / `startedAt` 与 `full-suite-state.json` **逐字相同**（单测断言 `row.runId === onDisk.runId` ∧ `row.startedAt === onDisk.startedAt`），且 `onDisk.reason === "crashed"` ⇒ 两个载体对同一轮说同一件事。

### DoD 控制 — 两个方向都可取假（实测）

```
控制 A：把 `recordRunnerDiedRound(root, cur);` 整行删掉
  ⇒ 台账 0 行 ⇒ `✖ AC1` + `✖ AC2`（58 pass / 2 fail）
控制 B：把 `if (runnerDiedRoundRecorded(file, runId)) return …already-recorded…;` 整行删掉
  ⇒ 同一 runId 落 2 行、round 号虚增 ⇒ `✖ AC1` + `✖ AC1 unit`（58 pass / 2 fail）
基线（未改动）：60 tests / 60 pass / 0 fail
```

⚠️ **一个被实测抓到的恒真判据（记在此以免重犯）**：AC1 第一版写的是「跑第二轮 `runOnce`，断言行数不变」。那条**结构上不可能取假** —— 第一轮已把 state 载体写成终态 red，而 `detectCrashedRunner` 只在 `state === "running"` 时开火 ⇒ 第二轮**根本走不到补写处**。实测：把幂等判据整条删掉，那种写法仍 **60/60 全绿**（「不产生新红」正是恒真检查会给出的结果，硬规则 4）。改成「**重新注入**同一 runId 的 running + 死 pid」后两个方向才都取假 —— 重注入模拟的正是真实重入来源：并发的第二个 watcher 在第一个写终态**之前**读到的陈旧快照，或同一 runId 的 running 被重发布。

### AC2 — 三条原文对照（同一载体 `.quay/verification-round.jsonl`；省略 perFile 大数组）

```
真生产绿轮 #1626: {"round":1626,"startedAt":"2026-09-13T09:28:39.919Z","state":"green","evaluated":"(absent)",
                   "reason":null,"runner":"inner","scope":"worktree","load":29.11,"laneCount":24,
                   "taskId":"gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root"}
真生产红轮 #1621: {"round":1621,"startedAt":"2026-09-13T08:31:14.971Z","state":"red","evaluated":"(absent)",
                   "reason":"failed","load":5.34,"laneCount":28,
                   "failures":[{"line":"✖ failing tests:","file":"plugin/test/long-term-guarantee-goal-backed-check.test.mjs"}]}
本任务 crash 轮 : {"round":1,"state":"red","evaluated":false,"reason":"runner-died",
                   "failures":(absent — 被杀的一轮没有失败信号可解析),"load":(absent — 这一轮没有「结束」),"laneCount":16}
```

- `evaluated`：与两条合格轮的**缺席**取值不同（显式 `false`）；⛔ 缺席本身**不**被读成 true（硬规则 6），因此只有显式 `false` 授权「未评估」读法 —— 这一条有单测（同 runId 的绿轮不算「已入账」）。
- `reason`：`runner-died` ∉ {`failed`, `gate-failed`, `watchdog-killed`} —— 三条逐字断言（⛔ 不共用取值：共用会让「runner 死了」与「测试红了」在台账上同形）。
- 与红轮的区分**不止靠 `state`**（两者都是 `red`）：靠 `evaluated` + `reason` 两个轴，单测各断言一次。

### AC3 — 生产载体验证（**not-evaluated**）

```
落地后窗口长度 = 0（本提交只在本任务分支上，未进 develop ⇒ 生产载体上结构上不可能观察到）
落地前基线：.quay/suite-state-events.jsonl 窗口 2026-08-12T03:28:02Z .. 2026-08-24T04:28:37Z（12.04 天，606 行）
            reason=crashed 转移 = 1 次（2026-08-12T06:47:05.087Z）
            .quay/verification-round.jsonl 中 reason=runner-died 行 = 0 行（修前）
⇒ 自然发生率 ≈ 1 次 / 12 天 ⇒ 自然观察一次平均需 ~12 天。记 **not-evaluated**。
⛔ 未用注入数据记为通过（硬规则 4 推论三：只能被 fixture 满足的判据只证明「能产出」）。
可复核（一条命令）：
  python3 -c "import json;l=[json.loads(x) for x in open('.quay/verification-round.jsonl') if x.strip()];print(sum(1 for r in l if r.get('reason')=='runner-died'))"
```

### AC4 — ⛔ 不引入阻塞（落地前读数 + 结构化对照）

```
谓词: exited-not-landed := (.quay/worker-outcome.jsonl).mechanical_fan_in.outcome !== "landed"
谓词自检（硬规则 2 的配套动作，前 3 条命中原文）:
  2026-08-27T13:39:32.418Z gap-web-session-drops-queue-operation-records  outcome=red  step=acquire-workflow-lock
  2026-08-27T14:37:22.336Z gap-web-session-drops-queue-operation-records  outcome=red  step=acquire-workflow-lock
  2026-08-27T14:57:38.149Z gap-mech-fan-in-acquire-lock-timeout-queue-sem  outcome=red  step=acquire-workflow-lock
正样本干跑（前 3 条【不】命中）:
  2026-08-28T04:51:48Z outcome=landed · 2026-08-28T05:46:06Z outcome=landed · 2026-08-28T08:24:32Z outcome=landed   ✓

落地前 · 近 7 日合计:  total=591  exited-not-landed=305  ratio=0.516
落地前 · 逐日:  09-06 67/103=0.650 · 09-07 81/124=0.653 · 09-08 56/114=0.491 · 09-09 41/95=0.432
                09-10 19/61=0.311 · 09-11 31/64=0.484 · 09-12 10/30=0.333 · 09-13 14/26=0.538
落地后:  窗口 0 长度 ⇒ 不可观测（同一谓词同一脚本可重算）
```

结构化对照（为什么该比例**不可能**因本改动上升）：

- **控制流逐字未变**：改动只在 `detectCrashedRunner` 命中分支**追加一次台账写入**；`writeCrashState`、转变事件、`routeRed` / `shouldStopDispatch`、以及所有 `return` 路径全部未动。既有 `AC6 — runOnce crash-watchdog` 测试对同一夹具的断言（`status=red` / `stopSignal=false` / 事件 `SUITE-RED` + `reason=crashed`）修前修后都绿。
- **该追加永不抛**：`buildRunnerDiedRoundRow` 是纯函数；`runnerDiedRoundRecorded` 整段 try/catch；`appendPreVerifiedRound` 的调用点 try/catch —— 同 `writeCrashState` 的 fail-open 契约（watchdog 是通知者不是闸）。
- **调用频次有界**：只在 `state === "running"` ∧ held pid 已死时进入；state 载体写成终态后下一轮不再进入 ⇒ **每次崩溃至多一次**，不是每轮一次。
- **新增 I/O 实测**（不藏代价）：台账 66 MB / 1626 行；`runnerDiedRoundRecorded` 未命中 ≈0.93 s、命中 ≈1.69 s（读全文件 + 子串扫；只 parse 含 runId 的那一行，不 split、不做 1626 次 `JSON.parse`）。相对于它触发的整轮 suite 重跑是噪声。

### AC5 — 族复核（硬规则 5b，**同一条命令**）

```
命令（可重跑）: python3 /tmp/family-enum.py   ← 逐载体枚举「轮未完整跑完 ⇒ 台账不落记录」的各机制；
               核心反查 = events 的终态 reason 词表 − 台账的 reason 词表
```

| # | 机制 | 生产载体命中数 | 该不该修 |
|---|---|---|---|
| 1 | `outcome=hung`（driver 静默看门狗 SIGKILL 整组） | `silence watchdog` 20 行（worker-outcome） | 已修（兄弟条 `gap-watchdog-killed-…`，**尚未落 develop**） |
| 2 | `spawnFailed`（suite 从未起来） | 0（生产未发生；结构上可达） | 已修（同上，同根） |
| 3 | **runner 被不可捕获地杀死（外部 SIGKILL / OOM）** | events `reason=crashed` **1**；台账对应行 **0** | **★本任务已修** |
| 4 | runner **自己的**进程内看门狗（runner 存活） | 台账 `reason∈{hung,timeout}` = 0 | 不需要（写得到） |
| 5 | suite 之前的闸失败（merge-develop / anti-drift / scoped-gate / typecheck） | trace `ok=false` 非 suite 步 = 377 | 不修（无 suite 轮；已有 per-step 载体） |
| 6 | suite 真红 | 台账 `reason∈{failed,gate-failed,static-check}` = 470 | 不需要（在册） |
| 7 | `infra-error` / `aborted` 红轮 | events = 9 | 不需要（在册） |
| 8 | doc-only / reuse skip | 0 | 不修（设计如此） |

**反查（这才是「还有没有第五条」的机械判据）**：

```
台账 reason 词表      : ['aborted', 'failed', 'gate-failed', 'infra-error', 'static-check']
events 终态 reason 词表: ['aborted', 'crashed', 'failed', 'infra-error', 'static-check']
差集（events 有、台账无）: ['crashed']      ← 只有本任务修的那一个
⇒ **没有第五条**：没有任何别的机制在 state 载体上留下终态而在 round 台账上没有对应行。
```

⚠️ 两条观察（**非**族成员，记下以免下次误判）：

- 台账里 3 行是**异形记录**（`{"round":11,"at":"2026-08-12T09:15:04Z","suiteGreen":false,"closed":[…]}`，无 `state` 字段）—— 2026-08-12 一次短暂的外来 writer 污染，不是「轮没记录」而是「记了别的东西」。`按 state 分类` 的读者要容忍它们（本次统计里显示为 `(None, no-reason)` 3 行）。
- 机制 #1 的 20 行 worker-outcome 证据是**修前**population：兄弟条未落 develop ⇒ 这 20 轮在台账上仍然缺行。本任务**不**覆盖它（不同机制、已立案），两者落地后应收敛到 0 差值。

### 落地时的一处机制观察（不属于本任务范围，记录以备下一步）

`task_write`（MCP / Provider ABI）把 `tasks/gap-crash-watchdog-round-ledger-not-written.md` 提交到了**主检出所在的 `author` 分支**（`cf91b5634`），**不是**任务分支。而 fan-in 的 anti-drift 与 ac-precheck **都从 worktree 读** `tasks/<id>.md`（`anti-drift-touches-check.ts:157`）。本任务因此把 ABI 写出的文件**逐字复制**到任务分支并提交（`d11c4b8ba`，`diff` 验过字节一致）—— ⛔ 不是手改勾选字符，是把 ABI 产物搬到 fan-in 真正读的那个路径上。若 `author→develop` 的传播先于 fan-in 发生则本步骤冗余（幂等）；反序则它正是避免 anti-drift HARD FAIL 的那一步。**未在本任务修**（属 doc→develop 同步机制的轴）。

## Touches

- tasks/gap-crash-watchdog-round-ledger-not-written.md
- plugin/scripts/suite-state-trigger.ts
- plugin/test/suite-state-trigger.test.mjs