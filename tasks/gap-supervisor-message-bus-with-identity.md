---
id: gap-supervisor-message-bus-with-identity
title: "supervisor 落地⑤消息总线带身份——投递信道正规化（含人↔manager/outer chat）：
  SPEC-integration-architecture §4.4 第 5 步 + §4.5（人是第三个 target，同一个机制）——
  .quay/manager-inbox 的失败形态是「文件在、无人读」⇒ 信道正规化的第一优先级不是投递，
  是消费者的机械挂载点（tick 某一步显式读收件箱）；sender identity：接收侧能区分
  「人」与「agent-X」（今晚事故 5：agent 消息以 user 身份进入会话，userType:external 与
  真人不可区分）；deliver(human) 语义 = 已投递 ≠ 已读，两者分开建模；
  展开见 docs/proposals/quay-message-bus-human-in-the-network.md"
status: todo
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

**supervisor 落地次序第 ⑤ 步：消息总线带身份**（SPEC-integration-architecture-2026-08-05 §4.4 第 5 步 + §4.5）。
投递方向与观测方向应当同构（`inner-blocked-signal.ts` 的 `--target` 参数化已证明观测方向通用化）；
本任务把 `deliver` 做成 supervisor 基座层的带身份信道。

## Finding

【实测失败形态】`.quay/manager-inbox/` 是「文件在、无人读」（今晚管理者临时建的收件箱）。
⇒ 信道正规化的第一优先级**不是投递，是消费者的机械挂载点**——tick 的某一步显式读收件箱。
否则又是「写了但不在决策时被调用」——本仓 AC9/AC10 反复踩的同一个坑。

【sender identity】（今晚事故 5）：agent 的消息以 user 身份进入会话，权限边界被打穿，
`userType:external` 与真人完全不可区分。接收侧必须能区分「人」与「agent-X」。

【人是第三个 target】（§4.5，人给出方向）：web 面承载人 ↔ manager/outer 的 chat 信道，
与机器间消息**是同一个机制**，不做成两套：

| target | deliver | observe |
|---|---|---|
| inner | send-keys → 校验目标 transcript | classifyPaneState（已参数化 --target） |
| outer | 同上 | 同上 |
| **human** | 写收件箱 / web 推送 | **「他读了没有」——回执，不是缺席推断** |

**唯一实质差别**：人不能被注入，只能等他自己来读 ⇒ `deliver(human, …)` 的语义是
「投递成功」，**不是「已送达意识」**，两者必须分开建模。

## Requested action

1. **投递方向 `--target` 参数化**：把 `deliver` 做成 supervisor 基座层的带身份信道——
   `deliver(target, payload, from=<identity>)`；`from` 携带发送方身份（inner/outer/manager/human）。
2. **接收侧身份区分**：接收侧能拒绝一条声称来自人的 agent 消息（判据，可机械测试）。
3. **人的机械挂载点**：tick 文档某一步显式读收件箱（挂载点在代码/文档流程，规则留文本）；
   `deliver(human)` 分离「投递成功」与「已读回执」两个字段。

## Acceptance Criteria

- [ ] AC1: `deliver(target, payload, from=<identity>)` 存在，`from` 携带发送方身份
- [ ] AC2: 接收侧能区分「人」与「agent-X」（测试：声称来自人的 agent 消息被拒绝）
- [ ] AC3: `deliver(human)` 的「已投递」与「已读」分开建模（回执不是缺席推断）
- [ ] AC4: 消费者的机械挂载点存在——tick 某一步显式读收件箱（「文件在无人读」不再发生）
- [ ] AC5: 与内层收件箱（.quay/manager-inbox/ 或同类）既有失败形态交叉标注
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group governance`
- [ ] AC7: 与 gap-supervisor-base-layer-outside-sessions-architecture 交叉标注（落地次序第 ⑤ 步）

## Definition of Done

Standard `experiments/quay-perpetual-stream/inherited-core.md` DoD clauses apply.

- [ ] 实测：一条 agent 消息声称来自人被接收侧拒绝（机械测试输出贴任务体）
- [ ] 收件箱有消费者挂载点（grep 可查 tick 流程读收件箱的步骤）
- [ ] 全量套件绿（fail 0 且 cancelled 0）

## Touches

- `plugin/scripts/*supervisor*`（带身份投递实现）
- `orchestration/SPEC-integration-architecture-2026-08-05.md`（§4.4 第 5 步 + §4.5 引用）
- `docs/proposals/quay-message-bus-human-in-the-network.md`（展开）
- `tasks/gap-supervisor-base-layer-outside-sessions-architecture.md`（AC4/落地次序标注）
- `tasks/gap-supervisor-preemption.md`（同族落地次序任务）

## Contract

measure   message_identity_reject = `bash <带身份投递> claim-human-test` stdout 的字段（若成脚本）
band      message_identity_reject = 拒绝（agent 声称来自人被拒）
invariant deliver_human_delivered_ne_read = 1（投递成功 ≠ 已读，两字段分开）
invoke    `grep -rn "身份\|identity\|收件箱\|inbox" orchestration/SPEC-integration-architecture-2026-08-05.md`
resume    每落地一步即写盘，AC 逐条勾

## Dispatch review

reviewer: none
at: 2026-08-06T07:4xZ
changed: 由 gap-supervisor-base-layer 落地⑤立案（未审）
