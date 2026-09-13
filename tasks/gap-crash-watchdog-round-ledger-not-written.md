---
id: gap-crash-watchdog-round-ledger-not-written
title: 不可捕获地死掉的 runner（外部 SIGKILL / OOM）在 verification-round.jsonl 零行，而
  full-suite-state.json 已诚实写 reason=crashed —— 同族第四条路径
status: ready
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

## Acceptance Criteria

- [ ] AC1（可取假·核心）：人为制造一次「runner 被不可捕获地杀」的场景（seam 注入：写一个 state=running 且 pid 指向一个已死进程的 `full-suite-state.json`，跑一轮 crash-watchdog），断言 round 台账出现一行**且只出现一行**（evaluated:false + reason=runner-died）；再跑第二轮 crash-watchdog，断言**台账行数不变**（幂等可取假）。
- [ ] AC2（与合格不同形·可取假）：该行的 `evaluated` 为 false，且 `reason` 不等于 `failed` / `gate-failed` / `watchdog-killed`；与同窗口的绿轮、红轮各贴一条原文对照。
- [ ] AC3（生产载体验证·⚠️允许 not-evaluated）：落地后窗口内台账含 ≥1 条 `reason=runner-died` 的行；⛔ 不得用注入数据记为通过（硬规则 4 推论三：只能被 fixture 满足的判据只证明「能产出」）。若窗口内未自然发生 ⇒ 记 not-evaluated 并写明窗口长度。
- [ ] AC4（⛔ 不引入阻塞）：落地后窗口内 `mfi-` 轮的 `exited-not-landed` 比例未因本改动上升（给出落地前后两个读数）。
- [ ] AC5（硬规则 5b）：本轮修好后，用**同一条命令**再枚举一次「该族还有没有第五条」，附命中数与前 3 条。

## Definition of Done

- crash-watchdog 的补写落地；纯函数 / 幂等部分有单测且含**可失败控制**（把写入去掉即红、把幂等判据去掉即红）。
- AC1 的两轮台账读数、AC2 的三条记录原文、AC5 的族复核读数全部落进任务体读数段。
- ⛔ 不修改 crash-watchdog 的判定逻辑；⛔ 不承担 `void:true` 的下游误读问题。

## Touches

- tasks/gap-crash-watchdog-round-ledger-not-written.md
- plugin/scripts/suite-state-trigger.ts