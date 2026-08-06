---
id: gap-supervisor-deliver-no-wait-for-idle-retry
title: supervisor-deliver.sh one-shot send→verify→failed — doesn't wait for
  target idle or retry; can-receive (pane-state-classify) exists but not wired
  into delivery path
status: todo
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

## 实测（2026-08-06 17:50，outer 驱动失败）

- outer 17:50 向 inner 发 targeted drive（修静态链）——inner 正处长 thinking（Puzzling 2m40s+, ↓13k tokens）。
- `send-keys-reliable.sh` 60s 有界轮询 FAIL：`FAIL——60s 有界轮询后 transcript 仍未出现内容匹配的真实 user message（已含一次独立 Enter 补发）；需要人工，不假装成功`。
- **后果：链路停摆 8 分钟**。唯一重试触发是外层下一个 `*/20` cron tick（最坏一整个周期空转）——实际靠管理者人工介入才重发成功（inner 17:53 空闲后直接投递即达）。
- 管理者核实：inner 空闲后（输入框空，`pane-state-classify --check-residue` state=empty）投递即达。

## 根因

投递路径只关心"发没发出去 + transcript 有没有"（fault 5 判据），**不先判"目标能不能收"**。目标在 busy/thinking 时，文本进输入框但不被提交，send→verify 必然失败。而"能不能收"（pane 五态：waiting-input 可收 / busy 不可收）已可机械判定——只是没接进投递前置。

## 修复方向（接法留执行时）

把 can-receive 检查接入投递前置：`supervisor-deliver.sh`/`send-keys-reliable.sh` 在 send 前用 `pane-state-classify` 判定目标态，非 waiting-input 则**有界等待**（目标转空闲）或**有界重试**（每轮重判），而非一次失败即退。与 session-liveness 的 idle 判定同源（不重复造）。

## AC（draft）

- [ ] 投递前判目标可接收（pane-state-classify 五态，waiting-input 才发）
- [ ] 目标 busy 时有界等待/重试（不一次失败即退；有上限，超限才需人工）
- [ ] 负控制：构造目标 busy 场景 ⇒ 投递等待而非立即 FAIL
- [ ] 测试用 `node:test` 且带 `// @test-group governance`

## DoD（draft）

- [ ] 对 busy 目标投递：等待其转空闲后送达（不等同一次失败）
- [ ] 对 idle 目标投递：行为不变（无回归）
- [ ] 超上限仍未空闲：fail loud 需人工（不假装）
- [ ] 完整套件绿

## Evidence

- 17:50 outer tick：`send-keys-reliable: FAIL——60s 有界轮询后 transcript 仍未出现...需要人工`
- inner 空闲后同一驱动重发即达（`delivered: true`）
- `grep pane-state-classify plugin/scripts/`：session-liveness.sh / supervisor-health.sh / inner-blocked-signal.ts 消费，supervisor-deliver.sh 无
