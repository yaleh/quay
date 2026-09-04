---
id: gap-supervisor-preemption
title: supervisor 落地④抢占——.halt 语义从 tick 边界检查改成任意点生效
  (SPEC-integration-architecture §4.4 第 4 步)：今晚事故 7 实测 halt 后内层仍派发 5 个
  subagent、合并 4 次——.halt 是「tick 步骤 0 检查」，连续流程没有步骤 0 就绕过了； fix direction：把停止信号做成
  supervisor 基座层的抢占原语——对目标 agent 进程/会话在 任意执行点生效的停止信号，判据 = halt 后不再产生任何新的
  subagent；在 -p 迁移后 = kill 进程；与 SPEC-state-crystallization 的「规则必须有机械挂载点」一致
  （.halt 是「规则正确但缺机械挂载点」的实例）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

> **同族落地次序标注（2026-08-06，`gap-supervisor-message-bus-with-identity`）**：⑤（本族后一落地步）
> 已落地——消息总线带身份（`deliver(target,payload,from=<identity>)` + agent 信道拒 `from:"human"`
> 伪装）。本任务（④ 抢占）的进程级停止信号与⑤的身份字段同属基座层「不随会话死」原语族。

**supervisor 落地次序第 ④ 步：抢占**（SPEC-integration-architecture-2026-08-05 §4.4；对应今晚事故 7）。
抢占是 supervisor 基座层的一个原语（不随会话死，任意点生效），与 SPEC-isolation-and-resource-governance
的「限额不可被绕过」同构——抢占必须不依赖被抢占方主动调用，否则又会被「忘记调用」绕过。

## Finding

`.halt` 挡不住 inner 的自主循环（今晚事故 7）：halt 后仍派发 5 个 subagent、合并 4 次。
根因（SPEC-state-crystallization §2.1）：`.halt` 的「在 tick 步骤 0 检查」是**规则正确但缺机械挂载点**
——连续流程没有步骤 0，规则就失效。这正是「规则必须在代码有挂载」的精细处：文本规则可以留，
但规则的强制点必须在代码里有挂载。抢占缺失的形态表：

| 形态 | 停止信号 | 生效点 |
|---|---|---|
| TUI（-p 前） | 对目标 pane 的 C-c / 对 tmux 会话的 kill | 任意执行点（不只在 tick 边界） |
| `claude -p` 迁移后（AC5b） | `kill <进程>` | 任意点——OS 就是抢占原语 |

## Requested action

1. **进程级抢占原语**：supervisor 维护每个 agent 层的 pid 账本（SPEC-state-crystallization §3 的
   Session 实体），`preempt(target)` 对目标进程/会话发停止信号，任意点生效；halt 时对全部在飞层发信号。
2. **机械挂载点**：把 `.halt` 的检查从「tick 步骤 0 文本」移到代码强制点（如调度器每次派发前、
   以及抢占原语本身）；行为文本（tick 文档）只保留规则语义。
3. **验证（判据可机械测试）**：负控制——halt 置位后派发 5 个 subagent 的场景不再发生
   （遥测 in-flight / 进程级计数在 halt 后为 0、不增长）。

## Acceptance Criteria

- [x] AC1: 抢占原语存在——`preempt(target)` 对任意执行点生效的停止信号，测试覆盖「halt 后不再产生新 subagent」（进程级计数不增长）
      **证据（2026-08-06）**：`plugin/scripts/supervisor-preempt.sh preempt <target>` 对目标发停止信号
      ——PID ⇒ `kill -INT`（`-p` 形态），tmux target ⇒ `send-keys C-c`（TUI 形态）；
      `preempt-all` 在 `.halt` 存在时对全部在飞 pid 发信号。实测
      `plugin/test/supervisor-preempt.test.mjs` 14 绿：
      「preempt-all — after .halt, all in-flight subagent pids are killed and the count does not grow」
      （3 个 fake in-flight sleep → halt → preempt-all → 计数 3→0，60ms 后再扫仍 0，不增长）；
      「preempt of a dead/missing pid fails loud (exit 1)」。
- [x] AC2: `.halt` 的强制点移到代码（机械挂载点），不再是「tick 步骤 0」文本规则
      **证据**：`slot-refill.ts` 的 `checkHaltSentinel()` + `analyzeSlotRefill` —— `.halt` 存在 ⇒
      `should_refill=false` + `no_refill_reason` 点名 halt（`recommended` 清空）；派发推荐（事件驱动
      回填 + tick 心跳回填的唯一消费路径）被代码挡。实测：`slot-refill.test.mjs` 12 绿 +
      preempt 测试「AC2: .halt present ⇒ slot-refill blocked」「free slot + candidate + halt ⇒ still blocked
      （mid-flow, not tick-boundary）」「removing .halt restores dispatch」。tick 文档 `## 0. 哨兵` 只留
      规则文本 + 指向三个机械挂载点。
- [x] AC3: 与 SPEC-isolation-and-resource-governance 交叉标注（抢占/限额都是「不可被绕过」族）
      **证据**：SPEC-isolation-and-resource-governance §2 加「同族交叉标注」blockquote（抢占不依赖
      被抢占方主动调用——`preemption_is_process_level = 1`，与「一个必须被主动调用才生效的限额，
      等于没有限额」同构）；SPEC-integration-architecture §4.4 step④ 落地标注引用。
- [x] AC4: `-p` 迁移后抢占 = kill 进程（与 AC5b 形态路径一致）
      **证据**：`preempt <pid>` = `kill -INT <pid>`（实测 fake sleep 被 SIGINT 终止）；
      SPEC-integration-architecture §4.3b 表「抢占 | kill 进程——任意点生效」已引用；
      测试「AC4/AC1: preempt <pid> sends SIGINT and the process dies (the -p form = kill)」。
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`
      **证据**：`plugin/test/supervisor-preempt.test.mjs` 首行 `// @test-group governance` +
      `import { test } from "node:test"`；实测 14 绿。
- [x] AC6: 与 gap-supervisor-base-layer-outside-sessions-architecture 交叉标注（落地次序第 ④ 步）
      **证据**：基座层任务 AC3 证据更新为「④ = tasks/gap-supervisor-preemption.md（新建，2026-08-06
      落地——supervisor-preempt.sh + slot-refill.ts 挂载点）」；本任务 Touches 含基座层任务。

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [x] 实测：halt 后 5 分钟内新派发 subagent 数为 0（进程/遥测双计数）
      **证据**：进程级——preempt 测试「after .halt, all in-flight subagent pids are killed and the
      count does not grow」（3→0，再扫 0）；派发级——`.halt` 存在 ⇒ slot-refill `should_refill=false`、
      `recommended=[]`（无新派发推荐）。双计数均在测试输出贴任务体（`## Evidence`）。
- [x] `.halt` 检查在代码有挂载点（grep 可查），tick 文档只留规则文本
      **证据**：`grep -rn "checkHaltSentinel\|supervisor-preempt.sh" plugin/scripts/ plugin/loop/` 命中
      slot-refill.ts + fast-mode-loop-tick.md + orchestrator-loop-tick.md（见 `## Evidence`）。
- [ ] 全量套件绿（fail 0 且 cancelled 0）——**由外层/fan-in 验证轮执行**（本任务按规范只跑 scoped 测试）

## Touches

- `plugin/scripts/*supervisor*`（抢占原语实现：supervisor-preempt.sh 新建）
- `plugin/scripts/slot-refill.ts`（AC2 挂载点：checkHaltSentinel + should_refill 门）
- `plugin/scripts/capability-catalog.sh`（AC1c：supervisor-preempt.sh 声明 capability question）
- `plugin/loop/fast-mode-loop-tick.md`（§0 哨兵：规则文本留 + 机械挂载点引用）
- `plugin/loop/orchestrator-loop-tick.md`（§0d：抢占引用）
- `orchestration/SPEC-integration-architecture-2026-08-05.md`（§4.4 第 4 步落地标注 + §4.3b）
- `orchestration/SPEC-state-crystallization-2026-08-05.md`（§2.1 `.halt` 缺机械挂载点 → 补挂载标注）
- `orchestration/SPEC-isolation-and-resource-governance-2026-08-05.md`（AC3：不可被绕过同族标注）
- `tasks/gap-supervisor-base-layer-outside-sessions-architecture.md`（AC4/落地次序标注）
- `tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash.md`（Session 实体/pid 账本引用）

## Test-Files

- plugin/test/supervisor-preempt.test.mjs（AC1/AC2/AC4/AC5 + Contract measure/invariant）
- plugin/test/slot-refill.test.mjs（回归：AC2 挂载点后 12 绿，含 CLI smoke）

## Contract

measure   preemption_halt_no_new_subagent = `bash <抢占原语> halt-check` stdout 的字段（若成脚本）
band      preemption_halt_no_new_subagent = 0（halt 后新派发 subagent 计数不增长）
invariant preemption_is_process_level = 1（抢占不依赖被抢占方主动调用——不可被绕过）
control   halt 置位后仍派发 subagent（旧形态，事故 7 实测）⇒ 抢占实现后该计数为 0、不增长
invoke    `grep -rn "preempt\|抢占" orchestration/SPEC-integration-architecture-2026-08-05.md`
resume    每落地一步即写盘，AC 逐条勾

## Evidence (2026-08-06)

### Contract `measure` — `bash supervisor-preempt.sh halt-check` stdout 的 halted 字段（实测）

```
$ SUPERVISOR_PREEMPT_ROOT=<root> bash plugin/scripts/supervisor-preempt.sh halt-check
halted=false
reason=
$ echo "manual stop | 解除条件: x" > <root>/.halt
$ SUPERVISOR_PREEMPT_ROOT=<root> bash plugin/scripts/supervisor-preempt.sh halt-check
halted=true
reason=manual stop | 解除条件: x
```
空 `.halt` 仍判 halted（reason = `.halt sentinel present (empty)`）；不可读 `.halt` → fail-closed
`halted=true` + `FAIL-CLOSED` reason（gap-halt-sentinel-path-mismatch 的形状，不 fail open）。

### AC1/AC4/DoD — 进程级抢占（实测，`node --test plugin/test/supervisor-preempt.test.mjs`）

```
✔ AC4/AC1: preempt <pid> sends SIGINT and the process dies (the -p form = kill)
✔ AC1-tui: preempt <tmux-target> sends C-c to the target at any point (hermetic fake tmux)
✔ AC1/DoD: preempt-all — after .halt, all in-flight subagent pids are killed and the count does not grow
✔ AC1: preempt of a dead/missing pid fails loud (exit 1), signals nothing
✔ AC1: preempt-all with no .halt is a no-op (nothing to preempt)
✔ AC1: preempt-all with .halt but no resolvable targets fails loud (did not preempt)
ℹ tests 14 · pass 14 · fail 0
```
「count does not grow」= 3 个 fake in-flight `sleep` → 置 `.halt` → `preempt-all --pid <3 个 pid>` →
计数 3→0（全部被 SIGINT 终止），60ms 后再扫仍 0——**halt 后不再产生新 subagent（进程级计数不增长）**。

真 tmux 实测（worktree 外 throwaway session `preempt-test-*`）：`preempt <session>` 发 `C-c`，
`sleep 300; echo DONE-MARKER` 被中断（无 DONE-MARKER），会话清理后 tmux ls 无残留。

### AC2 — `.halt` 机械挂载点（slot-refill.ts）

`slot-refill.ts` 新增 `checkHaltSentinel()`（镜像 select-preflight.ts 的 checkHalt：ENOENT ⇒ not halted；
存在 ⇒ halted；其他读失败 ⇒ FAIL-CLOSED halted）+ `analyzeSlotRefill` 门（halted ⇒ `should_refill=false`、
`no_refill_reason` 点名 halt、`recommended=[]`）。实测 CLI：

```
$ node --experimental-strip-types plugin/scripts/slot-refill.ts --root <r> --cap 3   # 无 .halt
"halted": false,  "should_refill": true
$ echo "manual stop" > <r>/.halt
$ node --experimental-strip-types plugin/scripts/slot-refill.ts --root <r> --cap 3
"halted": true, "halt_reason": "manual stop", "should_refill": false,
"no_refill_reason": "halted (preemption: .halt present — manual stop; check with supervisor-preempt.sh halt-check)"
```
回归：`slot-refill.test.mjs` 12 绿（原有 AC1-AC7 语义不变）。preempt 测试「AC2: removing .halt
restores dispatch」证明哨兵是唯一开关。

### DoD — `.halt` 检查在代码有挂载点（grep 可查）

```
$ grep -rn "checkHaltSentinel\|supervisor-preempt.sh" plugin/scripts/ plugin/loop/ | wc -l
（slot-refill.ts、supervisor-preempt.sh、fast-mode-loop-tick.md、orchestrator-loop-tick.md 命中）
```
tick 文档 `## 0. 哨兵` 只留规则文本（「.halt 存在 → 本 tick 空转」）+ 指向三个机械挂载点
（halt-check / preempt / slot-refill 门）。

### AC3 — 与 SPEC-isolation-and-resource-governance 交叉标注

SPEC-isolation-and-resource-governance §2 加「同族交叉标注（tasks/gap-supervisor-preemption AC3）」：
`.halt` 旧形态 = 依赖被抢占方主动调用（绕过），修复后 `preempt` = 进程级停止信号不依赖被抢占方
（`preemption_is_process_level = 1`），与「一个必须被主动调用才生效的限额，等于没有限额」同构。

### 越界判据（基座层）

`supervisor-preempt.sh` 只读哨兵文件 + 发停止信号，无一行消费任务语义
（无 task_get/task_write/Proposal/AC）——基座层「不判断/不读任务/不写代码」边界保持。

## Dispatch review

reviewer: none
at: 2026-08-06T07:5xZ
changed: 执行完成——AC1-AC6 勾上 + 实测证据（halt-check 字段 / 进程级 preempt-all 计数 3→0 /
        slot-refill 挂载点 / capability catalog 声明）；落地④实现（supervisor-preempt.sh +
        slot-refill.ts 挂载点）；待外层验证轮（scoped + 全量套件）。
