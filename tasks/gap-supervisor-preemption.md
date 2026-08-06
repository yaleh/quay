---
id: gap-supervisor-preemption
title: "supervisor 落地④抢占——.halt 语义从 tick 边界检查改成任意点生效
  (SPEC-integration-architecture §4.4 第 4 步)：今晚事故 7 实测 halt 后内层仍派发 5 个
  subagent、合并 4 次——.halt 是「tick 步骤 0 检查」，连续流程没有步骤 0 就绕过了；
  fix direction：把停止信号做成 supervisor 基座层的抢占原语——对目标 agent 进程/会话在
  任意执行点生效的停止信号，判据 = halt 后不再产生任何新的 subagent；在 -p 迁移后 =
  kill 进程；与 SPEC-state-crystallization 的「规则必须有机械挂载点」一致
  （.halt 是「规则正确但缺机械挂载点」的实例）"
status: todo
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

- [ ] AC1: 抢占原语存在——`preempt(target)` 对任意执行点生效的停止信号，测试覆盖「halt 后不再产生新 subagent」（进程级计数不增长）
- [ ] AC2: `.halt` 的强制点移到代码（机械挂载点），不再是「tick 步骤 0」文本规则
- [ ] AC3: 与 SPEC-isolation-and-resource-governance 交叉标注（抢占/限额都是「不可被绕过」族）
- [ ] AC4: `-p` 迁移后抢占 = kill 进程（与 AC5b 形态路径一致）
- [ ] AC5: 测试用 `node:test` 且带 `// @test-group governance`
- [ ] AC6: 与 gap-supervisor-base-layer-outside-sessions-architecture 交叉标注（落地次序第 ④ 步）

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] 实测：halt 后 5 分钟内新派发 subagent 数为 0（进程/遥测双计数）
- [ ] `.halt` 检查在代码有挂载点（grep 可查），tick 文档只留规则文本
- [ ] 全量套件绿（fail 0 且 cancelled 0）

## Touches

- `plugin/scripts/*supervisor*`（抢占原语实现）
- `orchestration/SPEC-integration-architecture-2026-08-05.md`（§4.4 第 4 步引用）
- `orchestration/SPEC-state-crystallization-2026-08-05.md`（§2.1 `.halt` 缺机械挂载点引用）
- `tasks/gap-supervisor-base-layer-outside-sessions-architecture.md`（AC4/落地次序标注）
- `tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash.md`（Session 实体/pid 账本引用）

## Contract

measure   preemption_halt_no_new_subagent = `bash <抢占原语> halt-check` stdout 的字段（若成脚本）
band      preemption_halt_no_new_subagent = 0（halt 后新派发 subagent 计数不增长）
invariant preemption_is_process_level = 1（抢占不依赖被抢占方主动调用——不可被绕过）
control   halt 置位后仍派发 subagent（旧形态，事故 7 实测）⇒ 抢占实现后该计数为 0、不增长
invoke    `grep -rn "preempt\|抢占" orchestration/SPEC-integration-architecture-2026-08-05.md`
resume    每落地一步即写盘，AC 逐条勾

## Dispatch review

reviewer: none
at: 2026-08-06T07:4xZ
changed: 由 gap-supervisor-base-layer 落地④立案（未审）
