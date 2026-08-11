---
id: gap-supervisor-deliver-no-wait-for-idle-retry
title: supervisor-deliver.sh one-shot send→verify→failed — doesn't wait for
  target idle or retry; can-receive (pane-state-classify) exists but not wired
  into delivery path
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
## Finding

`supervisor-deliver.sh`（用 `send-keys-reliable.sh` 作后端）做**一次性** send→verify→failed：目标（inner/outer/manager）忙时不等待空闲、不重试，一次失败即返回需人工。**"目标可接收"的判据已经存在**——`pane-state-classify.ts` 五态分类已被 `session-liveness.sh` / `supervisor-health.sh` / `inner-blocked-signal.ts` 消费，但**没有接到投递路径上**。

## 实测（机制可复现证据，2026-08-06）

**投递机制主张独立为真**（与今晚任何具体事故无关）：`supervisor-deliver.sh`/`send-keys-reliable.sh` 是**一次性** send→verify→failed——send 前不判目标可接收、不等空闲、不重试；目标 busy 时一次失败即退（fail loud 需人工）。

**可复现实例**：向一个 busy/thinking 目标投递 ⇒ 文本进输入框但不被提交 ⇒ 60s 有界轮询 FAIL（`FAIL——60s 有界轮询后 transcript 仍未出现内容匹配的真实 user message`）；目标转 waiting-input 后同一投递即达。

**时间线澄清（2026-08-06 管理者更正，以 git 为准）**：17:4x 的 static-chain 驱动**已送达** inner 并执行；17:50 的一次 send FAIL 正是因 inner 在执行【前一次已送达的同一请求】（busy）；inner 17:52 提交 25196d9a + c2b6244f 完成。**不存在"重试从未发生导致停摆"这条因果**——红窗 hold 下 inner 空闲（无待办）是正确行为。tick 文档判据：**推进的判据不是 TUI，是文件系统**。

## 根因

投递路径只关心"发没发出去 + transcript 有没有"（fault 5 判据），**不先判"目标能不能收"**。目标在 busy/thinking 时，文本进输入框但不被提交，send→verify 必然失败。而"能不能收"（pane 五态：waiting-input 可收 / busy 不可收）已可机械判定——只是没接进投递前置。

## 修复方向（接法留执行时）

把 can-receive 检查接入投递前置：`supervisor-deliver.sh`/`send-keys-reliable.sh` 在 send 前用 `pane-state-classify` 判定目标态，非 waiting-input 则**有界等待**（目标转空闲）或**有界重试**（每轮重判），而非一次失败即退。与 session-liveness 的 idle 判定同源（不重复造）。

## AC（draft 已固化，2026-08-11 inner）

- [x] 投递前判目标可接收（pane-state-classify 五态，waiting-input 才发）
- [x] 目标 busy 时有界等待/重试（不一次失败即退；有上限，超限才需人工）
- [x] 负控制：构造目标 busy 场景 ⇒ 投递等待而非立即 FAIL
- [x] 测试用 `node:test` 且带 `// @test-group governance`

## DoD（draft 已固化，2026-08-11 inner）

- [x] 对 busy 目标投递：等待其转空闲后送达（不等同一次失败）
- [x] 对 idle 目标投递：行为不变（无回归）
- [x] 超上限仍未空闲：fail loud 需人工（不假装）
- [x] 完整套件绿（本任务 scoped 门全绿，`--for-task`；全量套件由集成/fan-in 门承担——inner 纪律不跑全量）

## Contract

measure can_receive_pure = `node --test plugin/test/send-keys-reliable.test.mjs 2>&1 | grep -cE "can-receive pure: waiting-input is receivable"` stdout 数字段（= 1：waiting-input 是唯一可接收态；busy/permission/error/unknown 不可收）
measure busy_waits_then_delivers = `node --test plugin/test/send-keys-reliable.test.mjs 2>&1 | grep -cE "AC2/AC3 e2e: a BUSY target is WAITED on"` stdout 数字段（= 1：busy 目标有界等待转空闲后送达，非一次失败即退）
measure busy_timeout_fail_loud = `node --test plugin/test/send-keys-reliable.test.mjs 2>&1 | grep -cE "DoD e2e: a target that NEVER turns idle"` stdout 数字段（= 1：超限 fail loud 需人工，transcript 无 marker——不假装成功）
measure adapter_busy_waits = `node --test plugin/test/supervisor-deliver.test.mjs 2>&1 | grep -cE "adapter delegates the can-receive pre-flight"` stdout 数字段（= 1：supervisor-deliver 委托路径同样等待 busy→idle 后送达）
band can_receive_pure = 1 且 busy_waits_then_delivers = 1 且 busy_timeout_fail_loud = 1 且 adapter_busy_waits = 1
invoke `bash scripts/test.sh --for-task gap-supervisor-deliver-no-wait-for-idle-retry --allow-thin 2>&1 | grep -E "pass [0-9]+|fail [0-9]+"`（scoped 门全绿）
control can-receive 判定单源在 pane-state-classify（canReceiveInput 纯判据 / --can-receive 单探针 / --can-receive-wait 有界等待），与 session-liveness 的 idle 判定同源（同一分类器，不重复造）；两投递脚本共享同一探针，等待循环只在探针里一份，脚本里不复制；waiting-input 是唯一可接收态，busy/permission/error/unknown 一律不可收——不靠人盯
resume 若中断，先 `node --test plugin/test/pane-state-classify.test.mjs plugin/test/send-keys-reliable.test.mjs plugin/test/supervisor-deliver.test.mjs 2>&1 | tail -3` 确认全绿，再跑上面的 invoke 命令贴输出

## Evidence

- 机制可复现：对 busy/thinking 目标投递 ⇒ 文本进输入框不被提交 ⇒ `send-keys-reliable` 60s 有界轮询 FAIL（fail loud 需人工，不假装成功）
- 目标转 waiting-input 后同一投递即达（`delivered: true`）
- `grep pane-state-classify plugin/scripts/`：session-liveness.sh / supervisor-health.sh / inner-blocked-signal.ts 消费，supervisor-deliver.sh 无
- 时间线（以 git 为准，2026-08-06）：17:4x 驱动送达并执行（inner 25196d9a + c2b6244f, 17:52 完成）；17:50 的 send FAIL 因目标 busy（执行前一次已送达请求）；红窗 hold 下空闲（无待办）是正确行为，无"停摆"因果
- **实现（2026-08-11，worktree `gap-supervisor-deliver-no-wait-for-idle-retry`，三分步提交）**：
  - 前置（8373b646）：`pane-state-classify.ts` 新增纯判据 `canReceiveInput()`（waiting-input 唯一可收）+ `--can-receive` 探针（capture tmux → classifyPaneStateOrthogonal）；`send-keys-reliable.sh` step 0 与 `supervisor-deliver.sh` fresh path 在 send 前判可接收，非 waiting-input fail closed 不发送。
  - 等待重试（fbaef1d4）：`--can-receive-wait`（默认 30s 上限 / 2s 轮询，--wait/--poll 可调；每轮重判，转 waiting-input 即继续，超限 fail loud）；两脚本改调它，env `RELIABLE_CAN_RECEIVE_WAIT_S(_POLL_S)` / `SUPERVISOR_DELIVER_CAN_RECEIVE_WAIT_S(_POLL_S)` 设界；等待循环单源在探针里，两脚本共享。
  - 测试（a99ea2cb）：纯判据 + busy 等待 e2e + 永不 idle 超限 e2e + adapter 委托 e2e，全 `node:test` + `// @test-group governance`。
- **实跑（scoped 门全绿）**：`bash scripts/test.sh --for-task gap-supervisor-deliver-no-wait-for-idle-retry --allow-thin` → `tests 72 / pass 72 / fail 0`（exit 0）。分项：pane-state-classify 29 绿（纯分类）、send-keys-reliable 34 绿（含 busy 等待 5.7s e2e：busy 3s→flip→送达；超限 5.1s e2e：elapsed≈4s 界 + fail loud + transcript 无 marker）、supervisor-deliver 9 绿（含 adapter 委托 busy 等待 e2e）。静态检查全 PASS（task-contract-check / adr016-screen-use-check / superseded-capability / dead-code-after-return / tick-core / delivery-inventory-drift）。
- **负控制强度说明**：busy fixture 在 busy 期丢弃键入（`read -r -t 0.1`，真实 busy Claude TUI 不提交 thinking 期击键）——前置等待前发送必被丢弃 ⇒ e2e 只在"等待→flip→发送"下通过；busy-forever fixture 断言 elapsed ≥ 界（非立即 FAIL）且未发送。

## Touches

- plugin/scripts/supervisor-deliver.sh
- plugin/scripts/pane-state-classify.ts
- plugin/scripts/send-keys-reliable.sh
- plugin/test/send-keys-reliable.test.mjs
- plugin/test/supervisor-deliver.test.mjs
- tasks/gap-supervisor-deliver-no-wait-for-idle-retry.md

## Dispatch review

reviewer: inner
at: 2026-08-11T00:00:00Z
changed: pane-state-classify.ts 新增 canReceiveInput + --can-receive + --can-receive-wait（有界等待，30s/2s 默认）；send-keys-reliable.sh step 0 与 supervisor-deliver.sh fresh path 加 can-receive 前置（RELIABLE_/SUPERVISOR_DELIVER_CAN_RECEIVE_WAIT_S(_POLL_S) 设界）；测试补纯判据 + busy 等待 e2e + 超限 fail loud e2e + adapter 委托 e2e
- 接法符合修复方向：can-receive 判定接投递前置，非 waiting-input 有界等待/每轮重判，与 session-liveness 的 idle 判定同源（同一 pane-state-classify 分类器）。
- 分步提交（前置 / 等待重试 / 测试）各为独立行为步：先 fail-closed 不发送，再有界等待后发送，后测试固证。
- 等待循环单源在 pane-state-classify `--can-receive-wait`，两投递脚本共享——未在脚本里复制循环（反漂移）。
- 边界：cross-host（`gap-supervisor-deliver-cross-host-target-support`）未派发、无冲突；本实现保持本机路径（bare tmux）为主，与 send 同 socket。
