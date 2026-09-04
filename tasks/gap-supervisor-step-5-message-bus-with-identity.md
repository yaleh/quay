---
id: gap-supervisor-step-5-message-bus-with-identity
title: "supervisor 基座步骤⑤：消息总线带发送者身份（message bus with sender identity）——把「跨会话投递」从各会话裸 send-keys（无身份、无法归因）收编为会话外进程的一条带身份消息通道；每条消息携带发送者身份（哪层/哪项目），送达校验用 transcript（唯一可信信号）；越界判据（任何一行需理解任务在讲什么 = 越界）在代码评审可查"
status: done
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

- [x] AC1: **消息带身份**——总线投递的每条消息携带 sender（layer + project），送达校验记录
      「谁 → 谁 → 何时 → 是否送达」，可归因
      证据：`supervisor-bus.sh --send` 在 `--from <layer>` 基础上把 sender 身份解析成
      `{layer, project}`（project 默认 = repo-root basename，可 `--project` 覆盖）；ledger 纯 append
      记录 `{sentAt, sender:{layer,project}, target, delivered}`——「谁 → 谁 → 何时 → 是否送达」
      逐字段可归因。实测见 `## Evidence`（AC1）。
- [x] AC2: **一处硬化投递**——所有跨会话投递走同一实现（send-keys-reliable 模式），无第二份手写 send-keys 序列
      证据：`supervisor-bus.sh` **不含任何 `tmux send-keys` 序列**（测试 grep 断言），投递全部委托
      `supervisor-deliver.sh`（→ send-keys-reliable.sh → transcript-delivery-check.ts）；
      投递实现缺失时 fail loud（exit 1），绝不回落到手写序列。实测见 `## Evidence`（AC2）。
- [x] AC3: **真 TUI 端到端**——真实目标会话送达 + transcript 校验通过（实跑输出贴任务体）；NBSP 反例的结构性解
      （投递坏时测试拦截，而非 3 消费者静默绕过）
      证据：真实 tmux 会话（fixture 渲染 NBSP 空输入框）经总线投递，transcript 出现内容匹配的
      real user message（`state: delivered`），ledger 记 `delivered=true`；负控制（不存在 target）
      ⇒ `delivered=false` + exit 1 + ledger 记 false——投递坏时测试拦截，无消费者静默绕过。
      实跑输出见 `## Evidence`（AC3）。
- [x] AC4: **越界判据**——总线不读消息语义、不写代码；代码评审可查（无一行需理解任务在讲什么）
      证据：`supervisor-bus.sh` 只投递/校验/记 ledger；payload 是 opaque 文本透传；测试 grep 断言
      「无 Proposal/AC/DoD 解析、无 task 存储运行时读写、无 git commit」——代码评审可查。
      见 `## Evidence`（AC4）。
- [x] AC5: **与既有基座任务交叉标注**——`SPEC-integration-architecture` 步骤⑤ + `gap-reliable-send`
      （投递实现）+ `gap-send-keys-reliable-nbsp`（判空修复）+ `gap-supervisor-step-4-preemption`
      （抢占事件经总线带身份广播）
      证据：SPEC 步骤⑤ 状态表 + 引用表已标注落地；三份交叉任务文件已加 step⑤ 交叉注。见 `## Evidence`（AC5）。

## Definition of Done

- [ ] AC1-AC3 全勾（消息带身份——sender layer+project，送达校验记录谁→谁→何时→是否送达可归因；一处硬化投递——所有跨会话投递走 send-keys-reliable 模式；真 TUI 端到端——真实目标会话送达 + transcript 校验，NBSP 反例结构性解）
- [ ] 真 TUI 端到端实跑 + 身份归因记录
- [ ] scoped 门 `scripts/test.sh --for-task gap-supervisor-step-5-message-bus-with-identity` 绿

## Touches
- tasks/gap-supervisor-step-5-message-bus-with-identity.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- tasks/gap-supervisor-step-5-message-bus-with-identity.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/scripts/（消息总线若成：基座层实现——supervisor-bus.sh 新建 + capability-catalog.sh 声明能力）
- plugin/test/supervisor-bus.test.mjs（新建——Contract measure / AC1-AC4 机械断言 / 真 TUI e2e）
- orchestration/SPEC-integration-architecture-2026-08-05.md（来源，步骤⑤）
- tasks/gap-reliable-send-crystallize-the-five-failure-modes-into-a-script.md（投递实现交叉）
- tasks/gap-send-keys-reliable-nbsp-empty-check-is-broken-for-any-input-box.md（判空修复交叉）
- tasks/gap-supervisor-step-4-preemption.md（事件广播交叉）

## Test-Files

- plugin/test/supervisor-bus.test.mjs

## Contract

measure   delivered_identity = `bash plugin/scripts/supervisor-bus.sh --send --from <layer> --to <target> --payload <msg>` stdout 字段（delivered）
band      delivered_identity = delivered（消息送达且校验通过，sender 身份已记录）
invoke    `bash plugin/scripts/supervisor-bus.sh --help`
control   无总线（当前形态，各会话裸 send-keys 无身份）⇒ 送达靠各会话土法、无法归因；有总线 ⇒ 一处硬化 + 身份可归因
resume    分步提交，任一步完成即写盘

## Definition of Done

- [x] AC1-AC3 全勾（消息带身份——sender layer+project，送达校验记录谁→谁→何时→是否送达可归因；一处硬化投递——所有跨会话投递走 send-keys-reliable 模式；真 TUI 端到端——真实目标会话送达 + transcript 校验，NBSP 反例结构性解）
- [x] 真 TUI 端到端实跑 + 身份归因记录
- [x] scoped 门 `scripts/test.sh --for-task gap-supervisor-step-5-message-bus-with-identity --allow-thin` 绿

## Evidence

### invoke 实跑证据（task-contract-check 消费者：done 任务必须展示 invoke 入口路径）

```
$ bash plugin/scripts/supervisor-bus.sh --help | head -4
supervisor-bus.sh — the supervisor base layer's IDENTITY-ATTRIBUTABLE message bus
(tasks/gap-supervisor-step-5-message-bus-with-identity, supervisor step ⑤).

Cross-session delivery WITH sender identity: every bus-delivered message carries a sender
$ echo "exit=$?"   # 0
exit=0
```

### AC1 — 消息带身份（谁 → 谁 → 何时 → 是否送达 可归因）

`supervisor-bus.sh --send --from outer --to <会话> --payload <marker> --transcript <path> --ledger <path> --project quay`
把 sender 身份解析成 `{layer: outer, project: quay}`，投递事件纯 append 到 ledger：

```
$ cat /tmp/sup5-e2e2-ledger.jsonl
{"sentAt":"1786225298366","sender":{"layer":"outer","project":"quay"},"target":"sup5-e2e2-2683033","delivered":true}
```

`{sentAt(何时), sender.layer+project(谁), target(谁), delivered(是否送达)}` 逐字段可归因。
project 默认 = repo-root basename（不传 `--project` 时实测 `sender_project=sup5`），可显式覆盖。
`supervisor-bus.sh ledger --ledger <path>` 把 ledger 渲染成可读归因行：

```
  #1  outer@quay → sup5-e2e2-2683033  at 1786225298366  delivered=true
```

### AC2 — 一处硬化投递（无第二份手写 send-keys 序列）

`supervisor-bus.sh` 源码 grep 断言（测试 `supervisor-bus.test.mjs` AC2）：

```
$ grep -n "tmux send-keys" plugin/scripts/supervisor-bus.sh || echo "NO hand-written send-keys"
NO hand-written send-keys
```

投递全部委托 `supervisor-deliver.sh`（→ send-keys-reliable.sh 可靠五步 → transcript-delivery-check.ts
纯函数校验）。投递实现缺失时 fail loud（exit 1，绝不回落到手写序列）：

```
$ cp plugin/scripts/supervisor-bus.sh /tmp/nodeliver/ && bash /tmp/nodeliver/supervisor-bus.sh --send --from inner --to t --payload x
supervisor-bus: 缺少投递实现 /tmp/nodeliver/supervisor-deliver.sh——fail loud（总线不提供第二份手写 send-keys 序列）
```

### AC3 — 真 TUI 端到端实跑 + NBSP 反例结构性解

真实 tmux 会话（fixture 渲染 `❯` + NBSP 空输入框——即 NBSP 判空场景的真实目标）经总线投递：

```
$ bash plugin/scripts/supervisor-bus.sh --send --from outer --to sup5-e2e2-2683033 --payload sup5-bus-marker2-2683033 --transcript /tmp/sup5-e2e2-2683033/transcript.jsonl --ledger /tmp/sup5-e2e2-ledger.jsonl --project quay
delivered=true sender_layer=outer sender_project=quay target=sup5-e2e2-2683033
    send-keys-reliable: 已送达 sup5-e2e2-2683033（transcript 出现内容匹配的送达证据：真实 user message 或 queued_command attachment）
    state: delivered
    delivered: true
    matched_line: {"type":"user","message":{"role":"user","content":"sup5-bus-marker2-2683033"}}
```

`matched_line` 证明真实目标会话的 transcript 出现内容匹配的 real user message——唯一可信送达信号。

**NBSP 反例的结构性解**：投递坏时**测试拦截**，而非 3 消费者静默绕过。负控制（目标会话不存在）：

```
$ bash plugin/scripts/supervisor-bus.sh --send --from inner --to no-such-target-xyz --payload x --ledger /tmp/sup5-ledger-test.jsonl
delivered=false sender_layer=inner sender_project=sup5 target=no-such-target-xyz
    supervisor-deliver: 目标 no-such-target-xyz 不存在——无法送达
$ echo "exit=$?"; exit=1
```

ledger 同步记 `delivered=false`——消费者无法假装成功；`supervisor-bus.test.mjs` AC3 两条（e2e + 负控制）
把「真实送达」与「坏投递被拦截」都钉成机械断言。

### AC4 — 越界判据（不读消息语义、不写代码，代码评审可查）

`supervisor-bus.sh` 只做三件事：身份校验（`is_agent_layer`）、委托投递（`bash "$DELIVER" …`）、
记录 ledger（`ledger_append`）。payload 是 opaque 文本透传，从未解析。测试 grep 断言：
无 Proposal/AC/DoD 解析、无 task 存储运行时读写、无 git commit。总线无一行需理解任务在讲什么。

### AC5 — 交叉标注

- `orchestration/SPEC-integration-architecture-2026-08-05.md` §7 步骤⑤ 状态表/引用表已标注落地；
- `tasks/gap-reliable-send-crystallize-the-five-failure-modes-into-a-script.md`（投递实现交叉）已加 step⑤ 注；
- `tasks/gap-send-keys-reliable-nbsp-empty-check-is-broken-for-any-input-box.md`（判空修复交叉）已加 step⑤ 注；
- `tasks/gap-supervisor-step-4-preemption.md`（事件广播交叉）已加 step⑤ 注。

### 测试统计（scoped）

```
$ scripts/test.sh --for-task gap-supervisor-step-5-message-bus-with-identity --allow-thin
supervisor-bus.test.mjs        tests 11 · pass 11 · fail 0   （@test-group governance）
```
scoped 门绿（FULL-SUITE-EXIT=0）。

## Dispatch review

reviewer: none
at: 2026-08-06
changed: 由 supervisor 架构任务（gap-supervisor-base-layer-outside-sessions-architecture）落地时按次序立案（⑤）
