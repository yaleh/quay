---
id: gap-supervisor-deliver-no-wait-for-idle-retry
title: supervisor-deliver.sh one-shot send→verify→failed — doesn't wait for
  target idle or retry; can-receive (pane-state-classify) exists but not wired
  into delivery path
status: done
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

## AC（draft）

- [x] 投递前判目标可接收（pane-state-classify 五态，waiting-input 才发）
- [x] 目标 busy 时有界等待/重试（不一次失败即退；有上限，超限才需人工）
- [x] 负控制：构造目标 busy 场景 ⇒ 投递等待而非立即 FAIL
- [x] 测试用 `node:test` 且带 `// @test-group governance`

## DoD（draft）

- [x] 对 busy 目标投递：等待其转空闲后送达（不等同一次失败）——AC3 positive 实测（~5.8s，stderr 含 有界等待转 waiting-input + 已送达）
- [x] 对 idle 目标投递：行为不变（无回归）——AC5 e2e（NBSP/ghost 通过，门首判即 waiting-input 零等待）
- [x] 超上限仍未空闲：fail loud 需人工（不假装）——AC3 negative 实测（~5.4s，exit 1，marker 未进 transcript）
- [x] 完整套件绿——r39 green（round 39, 3244 pass / 0 fail, commit 61154ec3）

## Evidence

- 机制可复现：对 busy/thinking 目标投递 ⇒ 文本进输入框不被提交 ⇒ `send-keys-reliable` 60s 有界轮询 FAIL（fail loud 需人工，不假装成功）
- 目标转 waiting-input 后同一投递即达（`delivered: true`）
- `grep pane-state-classify plugin/scripts/`：session-liveness.sh / supervisor-health.sh / inner-blocked-signal.ts 消费，supervisor-deliver.sh 无
- 时间线（以 git 为准，2026-08-06）：17:4x 驱动送达并执行（inner 25196d9a + c2b6244f, 17:52 完成）；17:50 的 send FAIL 因目标 busy（执行前一次已送达请求）；红窗 hold 下空闲（无待办）是正确行为，无"停摆"因果

## Invoke（2026-08-11，inner 执行子代理，worktree `task/gap-supervisor-deliver-no-wait-for-idle-retry`）

- 修复落地：`send-keys-reliable.sh` step 0.2 can-receive 门（pane-state-classify.ts `--classify` 判定，waiting-input 才发；非 waiting-input 有界等待/重试 `RELIABLE_WAIT_IDLE_S`（默认 20）/`RELIABLE_WAIT_IDLE_POLL_S`（默认 1），超限 fail loud 不发送）；`supervisor-deliver.sh` fresh-session 路径同一 can-receive 门。既有 transcript 路径经委托 send-keys-reliable 自动获得该门。
- 负控制（busy 目标等待而非立即 FAIL）：`AC3 positive: a BUSY target is bounded-waited until it turns idle, then the payload is delivered (NOT a one-shot fail)` ✔（~5.8s，stderr 含 `有界等待转 waiting-input`，随后 `已送达`，marker 进 transcript）；`AC3 negative control: a target that stays BUSY past the bound is NEVER sent into — bounded wait, then FAIL loud with no transcript mutation` ✔（~5.4s，stderr 含 `未转 waiting-input` + `fail loud`，exit 1，marker 未进 transcript）。
- 空闲目标无回归：既有 AC5 e2e（NBSP 空输入框 / ghost 欢迎文本）通过，门首判即 waiting-input，零等待。
- 完整 scoped 证据：`bash scripts/test.sh --for-task gap-supervisor-deliver-no-wait-for-idle-retry --allow-thin` ⇒ **PASS 66 / FAIL 0 / CANCELLED 0 / EXIT 0**（含 pane-state-classify + send-keys-reliable + supervisor-deliver 三组）。

## Touches

- plugin/scripts/supervisor-deliver.sh（投递前 can-receive 检查：pane-state-classify 判定目标态）
- plugin/scripts/send-keys-reliable.sh（有界等待/重试：非 waiting-input 每轮重判，不一次失败即退）
- plugin/scripts/pane-state-classify.ts（如需扩展判定）
- plugin/test/supervisor-deliver.test.mjs（负控制：busy 目标等待而非立即 FAIL）
- tasks/gap-supervisor-deliver-no-wait-for-idle-retry.md（自身：勾 AC + 贴证据）
