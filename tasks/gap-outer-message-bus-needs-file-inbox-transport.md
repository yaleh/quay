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

### 修法方向（设计归外层+内层，产品代码）

给 outer 一个文件收件箱 transport（如 `.quay/outer-inbox/`），或复用 `createFileInboxTransport`
注册 outer 目标——`installDefaultTransports` 里 outer 那行从 `createSessionTransport()` 改为
文件收件箱。这样 manager 向 outer 投递走文件（异步、带 from），不依赖 outer 会话状态。

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

## Definition of Done

- [ ] AC1-AC5 实跑输出贴任务体（注册前后对照 + 总线投递带 from + 回归）

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
