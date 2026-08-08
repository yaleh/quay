---
id: gap-supervisor-step-5-message-bus-with-identity
title: "supervisor 基座步骤⑤：消息总线带发送者身份（message bus with sender identity）——把「跨会话投递」从各会话裸 send-keys（无身份、无法归因）收编为会话外进程的一条带身份消息通道；每条消息携带发送者身份（哪层/哪项目），送达校验用 transcript（唯一可信信号）；越界判据（任何一行需理解任务在讲什么 = 越界）在代码评审可查"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**来源**：`orchestration/SPEC-integration-architecture-2026-08-05.md` §7 落地次序 **⑤ 消息总线带身份**
（supervisor 基座层七职责之一）。基座层判据：消息/身份是平台原语，必须 outlive 会话；当前每个会话各写各的
send-keys 序列，**无身份、无法归因**。

**实测依据**（今晚）：
- NBSP 判空坏几小时，3 个消费者全绕过（各自土法），**零真 TUI 测试**——投递没有一处硬化实现，坏时无人报
  （SPEC-integration §6）；
- 送达确认三信号全假（哈希/输入框空/SESSION-RESUMED），唯一可信 = 目标会话自己的 transcript
  （CRYSTALLIZED-reliable-send 故障 5）；
- 消息无身份 ⇒ 无法回答「这条指令是谁发的、该归因给哪层」——今晚多起事故的归因困难都由此而来。

**supervisor 消息总线（越界边界内）**：
- **带身份**：每条消息携带发送者身份（layer + project），送达校验时记录「谁 → 谁 → 何时 → 是否送达」；
- **复用已验证能力**：投递实现 = send-keys-reliable.sh 的可靠发送模式 + transcript-delivery-check.ts
  （唯一可信送达信号）；
- **不读任务语义**：总线只投递「消息」，不解析内容——「这条消息是什么意思、该怎么处理」是 agent 层的判断；
- **不写代码**：不改任务文件/仓库，只投递、校验、记录投递事件（ledger）。

### 选定机制

1. **消息格式**：`{sender_layer, sender_project, target, payload, sentAt}`——身份在消息上，不在调用方记住
2. **投递实现**：复用 send-keys-reliable 的可靠发送模式（C-u/逐字/Enter + 渲染稳定轮询）——**一处硬化**
3. **送达校验**：transcript-delivery-check（唯一可信信号），有界轮询（60s 超时，故障 4 教训）
4. **投递事件记录**：append 到 ledger（`{sentAt, sender, target, delivered}`）——纯 append、零判断
5. **验证**：真 TUI e2e——真实目标会话送达 + 校验通过（NBSP 反例的结构性解）

## Acceptance Criteria

- [ ] AC1: **消息带身份**——总线投递的每条消息携带 sender（layer + project），送达校验记录
      「谁 → 谁 → 何时 → 是否送达」，可归因
- [ ] AC2: **一处硬化投递**——所有跨会话投递走同一实现（send-keys-reliable 模式），无第二份手写 send-keys 序列
- [ ] AC3: **真 TUI 端到端**——真实目标会话送达 + transcript 校验通过（实跑输出贴任务体）；NBSP 反例的结构性解
      （投递坏时测试拦截，而非 3 消费者静默绕过）
- [ ] AC4: **越界判据**——总线不读消息语义、不写代码；代码评审可查（无一行需理解任务在讲什么）
- [ ] AC5: **与既有基座任务交叉标注**——`SPEC-integration-architecture` 步骤⑤ + `gap-reliable-send`
      （投递实现）+ `gap-send-keys-reliable-nbsp`（判空修复）+ `gap-supervisor-step-4-preemption`
      （抢占事件经总线带身份广播）

## Definition of Done

- [ ] AC1-AC3 全勾（消息带身份——sender layer+project，送达校验记录谁→谁→何时→是否送达可归因；一处硬化投递——所有跨会话投递走 send-keys-reliable 模式；真 TUI 端到端——真实目标会话送达 + transcript 校验，NBSP 反例结构性解）
- [ ] 真 TUI 端到端实跑 + 身份归因记录
- [ ] scoped 门 `scripts/test.sh --for-task gap-supervisor-step-5-message-bus-with-identity` 绿

## Touches

- plugin/scripts/（消息总线若成：基座层实现）
- orchestration/SPEC-integration-architecture-2026-08-05.md（来源，步骤⑤）
- tasks/gap-reliable-send-crystallize-the-five-failure-modes-into-a-script.md（投递实现交叉）
- tasks/gap-send-keys-reliable-nbsp-empty-check-is-broken-for-any-input-box.md（判空修复交叉）
- tasks/gap-supervisor-step-4-preemption.md（事件广播交叉）

## Contract

measure   delivered_identity = `bash plugin/scripts/supervisor-bus.sh --send --from <layer> --to <target> --payload <msg>` stdout 字段（delivered）
band      delivered_identity = delivered（消息送达且校验通过，sender 身份已记录）
invoke    `bash plugin/scripts/supervisor-bus.sh --help`
control   无总线（当前形态，各会话裸 send-keys 无身份）⇒ 送达靠各会话土法、无法归因；有总线 ⇒ 一处硬化 + 身份可归因
resume    分步提交，任一步完成即写盘
## Dispatch review

reviewer: none
at: 2026-08-06
changed: 由 supervisor 架构任务（gap-supervisor-base-layer-outside-sessions-architecture）落地时按次序立案（⑤）
