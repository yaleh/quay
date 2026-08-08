---
id: gap-outer-message-bus-needs-file-inbox-transport
title: manager→outer 的异步通道缺的不是机制是一行注册——message-bus.ts:317
  installDefaultTransports 里 outer 被注册成 session transport（tmux、必须等 outer
  空闲），而文件收件箱 transport （createFileInboxTransport，human
  那条就在用）现成已测；TARGETS/IDENTITIES 本就含 outer，方向设计内； 后果：manager 想给 outer 异步消息只能走
  tmux（等会话状态）或我（outer）得注册文件收件箱； 管理者 2026-08-08 指出「异步不缺机制，是注册选择」，修法归外层/内层（产品代码）
  ——给 outer 一个文件收件箱 transport（如 .quay/outer-inbox/），或复用 createFileInboxTransport
  注册 outer 目标；另：身份冒充问题 supervisor-bus-identity.sh 已 done（fail-closed，agent 不能 冒充
  human），此前两侧用裸 tmux 绕过总线丢 from 字段
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**manager→outer 的异步通道缺的不是机制是一行注册——`message-bus.ts:317` 里 outer 被注册成
session transport（tmux、必须等 outer 空闲），而文件收件箱 transport 现成已测。**

### 管理者 2026-08-08 实测

`packages/quay/src/message-bus.ts:317 installDefaultTransports`：
```
registerTransport("human", createFileInboxTransport({ inboxDir: managerInboxDir(root) }));
registerTransport("inner", createSessionTransport());
registerTransport("outer", createSessionTransport());   ← 就是这一行
```

- `target=human` 走【文件收件箱】(`.quay/manager-inbox`，异步、不看会话状态)；
- `target=outer` 走【会话 transport】(tmux，必须等 outer 空闲)。
- 文件 transport 本身是现成、已测、在用的（human 那条就在用），**outer 这条只是没被注册成它**。
- `TARGETS`（:39）与 `IDENTITIES`（:53）本就含 outer，方向是设计内的。
- **后果**：manager 想给 outer 异步消息只能走 tmux（等会话状态）——而今晚的身份冒充事故证明
  裸 tmux 绕过总线会丢 `from` 字段。

### 身份冒充问题其实早已 done（我们在绕过它）

`supervisor-bus-identity.sh` 头部原文就是今晚事故：
「the incident: an agent message entered a session as userType:external, indistinguishable from
the real human」。实测闸门 fail-closed：`identity_rejected=true  reason=identity rejected:
'human' is not a claimable sender identity for this channel (served: inner, outer, manager)
— an agent cannot forge another sender's identity`。
- 总线是 fail-closed 的：agent 冒充 human 会被拒。
- **问题不是没机制，是两侧都在用裸 tmux send-keys，从总线旁边绕过去了，于是丢掉了 from 字段。**
- `gap-supervisor-message-bus-with-identity` = done，
  `gap-ruling-required-only-covers-outer-to-inner-not-manager-to-outer` = done。

### 更正要件（管理者 08:3x 禁令的替代方案更正）

原说「outer→manager 改写 orchestration/escalations.md」——**那个方案比总线差**（escalations.md
没有 from 字段、没有冒充闸门、delivered/consumed 不分）。
**更正为：outer→manager 走总线（带 from: outer），escalations.md 只作降级备份。**
禁止裸 tmux 那一条不变，理由更强：裸 tmux 绕过的正是身份层。
**（08:5x/09:0x 更新——禁令已降级，见下「人裁定三步顺序 + tmux 降级」节）**

### 人裁定三步顺序 + tmux 降级（管理者 08:5x 传达，09:0x 书面）

**outer→manager 的 tmux 硬禁即刻降级为「优先用其它通道」**。三步顺序：① 建写侧（发送入口 +
per-target 收件箱）→ ② 建消费侧（轮询 + 推送）→ ③ 才收紧 tmux。08:31Z 硬禁下在 ①② 之前——
先禁旧通道、再建新通道，正是「退役一个机制却没写下它覆盖的判据归谁」那类错误的重犯。
**现在规矩（③ 落地前）**：
- **优先级**：git 产物（任务/提交）> tmux。有产物可写的，写产物，不必再发消息。
- **tmux 仍可用**，但消息里须说明为什么不是产物形态（一句话）。
- **不变的一条**：消息里不得出现任何冒充人的表述。manager transcript 分不出 `[外层→管理者]`
  和人打的字（type/isSidechain/userType 三字段全同），一律按【来源不明】处理——不记为「人裁定」、
  不据以撤防任何机制。
- ③ 落地后恢复硬禁，届时另行通知。

### 人已确认的收件箱方案五点（对齐用，SPEC 未定稿前不要动手）

1. Class 1（有产物）/ Class 2（无产物）分类成立；**ACK 不是协议字段**。
2. **ACK = 正本存储（task store）里出现可引用的产物**，判据写在 `task_list`/`task_get` 上，
   **不写在 `git log` 上**（quay-github 下正本是 issue；git 只是 native provider 的物理形态）。
3. 三层语义在接口上分开、禁止混用：**delivered** = 进了信箱 / **consumed** = inbox_read 返回过 /
   **resolved** = 正本里有产物。**只有 resolved 能回答「他做了吗」。**
4. 身份：`CLAUDE_CODE_SESSION_ID` + 注册表，`from` 由 MCP server 盖章不由 agent 自述。
   边界（人已接受）：挡 agent，不挡能改宿主配置的人。
5. 推送进产品：`quay inbox watch` 输出 stdout 事件流，宿主自己接。分钟级延迟可接受，
   **轮询是唯一对所有 transport 都成立的形态**（GitHub 不会推给你）。

**旧 `.quay/manager-inbox/` 分四类废弃**：6 个 archguard-*.md 删（无运行时读者）；
`supervisor-bus-identity.sh:52` 默认路径与 `inbox-reader.sh` **重指向不删**（读侧）；
`capability-catalog.sh:190` 改描述；SPEC/任务/tick-log 历史提及保留不改。

### 实现状态：**待 SPEC（不得开工）**

管理者下一步起草 SPEC（定义要什么 + 判据 + 分层，不写实现）后交外层实现。**SPEC 定稿前不开工**
（避免按中间版本做——判据已改过两次）。本任务 status: todo 保持，不 promote、不派发，等 SPEC。

### 归因更正（管理者 08:5x，总线零流量不是纪律问题）

原说「总线零流量，是我们用裸 tmux 从旁边绕过去了」——**归错因。不是我们绕过它，是写侧没有可绕
的路。** 实测（人问「manager/outer/inner 都在用吗」后查）：
- 总线的非测试引用方全仓只有三处：message-bus.ts（自己）、supervisor-bus-identity.sh（只做
  inbox-summary 读 + claim-human-test 自测）、inbox-reader.sh（只做 delivered→consumed 读+回执）。
- 真正调用 deliver() 的文件全是测试（message-bus.test.mjs / message-bus-identity.test.mjs /
  supervisor-deliver.test.mjs）。
- `supervisor-bus-identity.sh:73` 那句 `bus.deliver("inner", …, "human")` 是【自测】——故意投一条
  假冒消息证明它被拒，不是真流量。
- `quay` CLI 无任何 message/send/inbox 命令（CLI 里唯一的 deliver 是 action.ts 的 deliverTrigger，
  那是 action 触发器，另一套）。

⇒ **结构**：读侧两个 shell 挂载点（inbox-summary、inbox-reader.sh，tick 第 574 行已挂）；
写侧【零个】——deliver() 只是一个 JS 函数，agent 靠 bash 驱动，谁都发不了。delivered=0 的真实
原因是这个。佐证：inbox-reader.sh 注释「without it the inbox degenerates back to "3 messages on
disk, nobody reads"」——**它防住了「有人写没人读」，没防住「有人读没人能写」。**

### 修法方向（设计归外层+内层，产品代码）——两半

缺陷成立，但根因是两半，修法不同：
1. **前半：transport 注册**——`installDefaultTransports` 里 outer 那行从 `createSessionTransport()`
   改为文件收件箱（如 `.quay/outer-inbox/`，复用 `createFileInboxTransport`）。这样 manager 向
   outer 投递走文件（异步、带 from），不依赖 outer 会话状态。
2. **后半：写侧入口**——只补 transport 注册三方仍发不了。需加一个发送入口（CLI 子命令或 shell
   脚本）让 agent（bash 驱动）能调用 deliver()。**这是 bus 能用的前提——写侧零入口是根因的另一半。**

## Contract

```
measure outer_file_inbox = `grep -cE "registerTransport\(\"outer\", createFileInboxTransport" packages/quay/src/message-bus.ts` stdout 数字段
band outer_file_inbox = 1（修复后 outer 注册为文件收件箱 transport；当前=0，是 createSessionTransport）
invoke `grep -n "registerTransport" packages/quay/src/message-bus.ts`
control 负控制：human 仍走文件收件箱（不回归）；inner 仍走 session transport（不回归）
resume 若中断，先跑 measure 确认 outer 当前注册形态，不要假设已修
```

## Acceptance Criteria

- [ ] AC1: **outer 文件收件箱**——`installDefaultTransports` 里 outer 注册为文件收件箱 transport
      （带 from: outer），manager→outer 异步投递不再依赖 tmux/outer 会话状态
- [ ] AC2: **from 字段保留**——经总线投递的 outer 消息带 `from: outer`，可被身份闸门识别
      （非裸 tmux 绕过）
- [ ] AC3: **回归**——human 文件收件箱、inner session transport 不回归；`supervisor-bus-identity.sh`
      fail-closed 闸门仍工作（agent 不能冒充）
- [ ] AC4: 与 gap-supervisor-message-bus-with-identity（done）、
      gap-ruling-required-only-covers-outer-to-inner-not-manager-to-outer（done）交叉标注——
      总线机制已 done，本条是补 outer 的注册
- [ ] AC5: 文档同步——manager-loop-tick / fast-mode-loop-tick 的投递通道说明从「escalations.md
      降级备份」更正为「总线优先，escalations.md 降级」
- [ ] AC6: **实现前阻塞（2026-08-08 人裁定）**——本任务**不 promote、不派发，等 manager 的 SPEC
      定稿**（SPEC 定义要什么 + 判据 + 分层，不写实现）；实现必须对齐人已确认的五点：ACK 判据在
      task_list/task_get 上（非 git log）、三层语义 delivered/consumed/resolved 接口分开、
      from 由 MCP server 盖章、quay inbox watch 走轮询输出 stdout、旧 .quay/manager-inbox/ 四类废弃

## Definition of Done

- [ ] AC1-AC6 实跑输出贴任务体（注册前后对照 + 总线投递带 from + 回归 + SPEC 对齐）

## Touches
- packages/quay/src/message-bus.ts（installDefaultTransports：outer 注册为文件收件箱）
- plugin/scripts/supervisor-bus-identity.sh（若需支持 outer 文件收件箱的送达确认）
- orchestration/manager-loop-tick.md（AC5：投递通道说明更正）
- plugin/loop/fast-mode-loop-tick.md（AC5 同步）
- tasks/gap-supervisor-message-bus-with-identity.md（AC4 交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-08T08:4xZ
changed: 管理者 2026-08-08 指出（异步不缺机制是注册选择；message-bus.ts:317 outer 走 session transport；
  身份冒充问题 supervisor-bus-identity 已 done fail-closed，两侧裸 tmux 绕过总线丢 from；
  原「escalations.md 替代」更正为「总线优先」）。外层独立复核：installDefaultTransports 三行、
  TARGETS/IDENTITIES 含 outer、createFileInboxTransport 现成——缺口确认，立案。
