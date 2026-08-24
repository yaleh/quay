# SPEC：Codex 会话通信 Host Adapter

**status**: proposal（只定义宿主适配边界；不实现 Codex broker、daemon 或自治调度）

**date**: 2026-08-24

**scope**: 将 Claude Code 已验证的跨会话消息能力抽象为 quay 的宿主无关通信契约，并定义 Codex 的实现路径。

## 1. 决策摘要

Claude Code 的 `ListAgents → SendMessage` 是 quay 当前跨会话协作的重要能力，但它不是
quay Core 的权威状态，也不能直接移植为 Codex 的同名调用。

Codex 当前最接近的原生能力是 **App Server**：外部控制器可以创建、列出、读取、恢复和
分叉 thread，向目标 thread 启动新的 turn，向运行中的 turn 追加输入，并订阅生命周期与
消息事件。Codex CLI 0.149.1 已在本机暴露 `codex app-server`、`codex exec resume` 和
`codex exec fork`。

因此采用以下边界：

```text
quay Core / control plane
    -> Host Adapter：Claude | Codex | CLI | CI
        -> host-native session transport
```

Host Adapter 对外提供统一的 `list / status / send / events` 语义；Codex Adapter 使用
App Server 的 thread/turn 协议，Claude Adapter 保留已验证的 SendMessage socket 协议。
Core 不读取或写入任一宿主的 transcript 作为通信真值。

## 2. 能力判定

| 能力 | Claude Code | Codex | 本 SPEC 的处理 |
|---|---|---|---|
| 活跃会话发现 | `ListAgents` / `claude agents --json` | App Server `thread/list`、`thread/loaded/list` | 统一为 `list_sessions` |
| 向空闲会话发消息 | `SendMessage` | `thread/resume` + `turn/start` | 统一为 `send` |
| 向忙碌会话追加消息 | 平台 SendMessage 语义 | `turn/steer`，要求匹配 active turn | 统一为 `send`，状态由 adapter 决定 |
| 送达/执行事件 | Claude 消息帧；现有路径为 fire-and-forget | `turn/*`、`item/*` notifications | 必须由 Adapter 形成 ack 事件 |
| 子代理协作 | Claude Agent/SendMessage | Codex subagents；App Server 记录 `collabToolCall` | 视为子代理关系，不等同 peer message |
| 历史会话 | transcript / session 文件 | `thread/read`、`thread/resume` | 仅作诊断和恢复输入 |
| 任意 peer 的稳定 `SendMessage(to, text)` | 已有验证路径 | 未发现同等稳定的用户级 API | 不在 Codex CLI 表面伪造；由 Adapter 编排 |

Codex 官方 App Server 文档明确列出 `thread/start`、`thread/resume`、`thread/fork`、
`thread/read`、`thread/list`、`turn/start` 和 `turn/steer`，并定义了 thread/turn/item
事件流：

- <https://learn.chatgpt.com/docs/app-server>
- <https://learn.chatgpt.com/docs/agent-configuration/subagents>

## 3. 宿主无关通信契约

以下是语义契约，不是 MCP schema，也不是 Codex App Server 的直接透传。

### 3.1 SessionRef

```ts
type SessionRef = {
  adapter: "claude" | "codex" | "cli" | "ci";
  id: string;                 // adapter-qualified opaque id
  workspace?: string;
  cwd?: string;
  role?: string;
  capabilities: string[];
  observedAt: string;
};
```

`id` 必须是宿主适配器返回的 opaque id。不得由 pane 名称、PID、transcript mtime 或
模型输出推断会话身份。Codex 的 `threadId` 必须原样放在 `id` 中；Claude 的 session
identity 也必须保留其 adapter 前缀，避免跨宿主碰撞。

### 3.2 MessageRequest

```ts
type MessageRequest = {
  requestId: string;           // caller-generated idempotency key
  target: SessionRef;
  body: string;
  mode?: "new-turn" | "steer" | "auto";
  authorizationRef?: string;
  deadlineAt?: string;
};
```

`authorizationRef` 是控制面授权引用，不是宿主 token。Host Adapter 不得把“能够连接
socket”或“拥有 threadId”解释为获得 quay 生命周期权限。

### 3.3 Ack 状态

消息投递至少区分：

```text
accepted -> delivered -> started -> completed
                    \-> failed / expired / cancelled
```

- `accepted`：Adapter 接受并记录了请求及幂等键。
- `delivered`：宿主传输层接受了消息；不代表模型已读取。
- `started`：目标 thread/turn 已开始处理。
- `completed`：目标回合结束；结果仍是诊断证据，不自动改变 Quay task 状态。
- `failed`、`expired`、`cancelled`：必须带可枚举原因。

Claude 当前 socket 路径是 fire-and-forget，不能声称天然提供 `delivered` 之后的确认；
Claude Adapter 必须通过目标会话的可观察事件或显式回执补齐，补不齐时返回
`accepted`/`delivered-unknown`，不能伪造 `started`。

Codex Adapter 可将 App Server 响应和事件映射为上述状态：

```text
turn/start response       -> accepted / started
item/* on target thread   -> delivered / progress
turn/completed             -> completed | failed | cancelled
thread/status/changed     -> status projection, not task authority
```

### 3.4 Adapter API

```ts
interface SessionHostAdapter {
  capabilities(): Promise<{
    adapter: string;
    version: string;
    operations: string[];
  }>;

  listSessions(filter?: { workspace?: string; cwd?: string; role?: string }):
    Promise<SessionRef[]>;

  send(request: MessageRequest): Promise<{
    requestId: string;
    state: "accepted" | "delivered" | "delivered-unknown" | "started" | "failed" | "expired";
    hostEventRef?: string;
    reason?: string;
  }>;

  events(target: SessionRef): AsyncIterable<{
    requestId?: string;
    state: string;
    hostEventRef?: string;
    payload?: unknown;
  }>;
}
```

`send` 必须幂等：同一 `requestId` 重试不得重复创建 turn、重复注入消息或重复执行
外部副作用。若宿主没有幂等原语，Adapter 必须在自身持久化层拒绝不确定重试。

## 4. Codex Adapter 设计

### 4.1 传输

第一实现使用本机 Codex App Server stdio 或 Unix socket；跨机器时才启用 WebSocket，
并显式配置认证。App Server 连接必须完成 `initialize` / `initialized` 握手。

```text
adapter.start
  -> codex app-server
  -> initialize
  -> thread/list / thread/loaded/list
  -> registry maps SessionRef.id -> threadId
```

不得把 Codex 的本地 JSONL、SQLite state DB 或未公开文件格式作为 quay ABI。

### 4.2 send 路由

```text
target thread idle/notLoaded
  -> thread/resume (if needed)
  -> turn/start

target thread active
  -> turn/steer with expectedTurnId

target status unknown or stale
  -> re-read thread/status
  -> do not guess; return not-evaluated or failed
```

`thread/fork` 是建立新工作分支的操作，不是消息发送；不得把 fork 当作
`SendMessage` 的替代品。`thread/inject_items` 直接修改模型可见历史，属于高风险的
专用集成能力，默认禁止用于普通跨会话消息。

### 4.3 角色与权限

Codex subagent 是 parent thread 派生的执行角色。Host Adapter 必须区分：

- `peer`：独立、可寻址的会话；
- `child`：由目标 parent 派生的 subagent；
- `fork`：复制历史得到的新 thread；
- `review`：审查型子 thread。

只有 `peer` 的消息投递可被称为跨会话通信。对 `child`/`fork`/`review` 的操作必须在
事件中保留 parent/ancestor 关系，不能把结果伪装成独立 peer 的授权消息。

## 5. Quay 权威边界

1. SessionRef、MessageRequest、ack 和事件是 control-plane 的通信记录，不是 task 状态。
2. session transcript、Codex thread 内容和 Claude 消息内容均为诊断证据。
3. 收到消息不等于获得 Quay task 写权限。
4. `task_write` 仍必须经过现有的人类授权、CAS、读回、schema check、CLI readback 和
   scoped commit 纪律。
5. Host Adapter 不得自动 tick AC/DoD、关闭 task、SELECT/execute milestone、launch worker、
   merge、ABSORB 或 schedule continuation。
6. 多个 Adapter 同时连接同一 workspace 时，workspace lease 和 single-writer 规则仍由
   Quay control plane 负责，不能由 session 通信顺序替代。

## 6. 故障与安全

- 目标消失：返回 `failed(reason=session-not-found)`，不得根据旧 transcript 重发。
- 目标忙且不能 steer：进入控制面队列；不通过 tmux 或 shell 偷注入。
- App Server 重启：用持久化 threadId 做 `thread/read`，状态不明则标记
  `not-evaluated`，不得自动重放非幂等消息。
- 送达无回执：记录 `delivered-unknown`，不升级为 `started`。
- 同一 thread 被多个 writer 控制：Adapter 返回冲突，交给 lease/人处理。
- 跨机器：必须有 workspace authorization、身份认证、TLS/安全 socket 和审计事件。
- 任意 `threadId`、socket path、peer token 都是能力边界，不是人类授权本身。

## 7. 分阶段落地

### Stage A：只读能力探测

- 增加 Codex Adapter capability probe。
- 验证 `thread/list`、`thread/read`、`thread/status/changed`。
- 输出 opaque SessionRef，不写 task、不发送消息。

### Stage B：单目标、人工授权发送

- 实现 `send(mode="auto")` 到 `turn/start` / `turn/steer`。
- 记录 requestId、threadId、turnId、授权引用和完整 ack 状态。
- 用真实但无副作用的 Codex thread 验证重复 requestId 不重复发送。

### Stage C：Quay control-plane 接入

- 将消息请求、ack、事件和 retry 状态持久化为控制面记录。
- 加入 workspace lease、目标过期和重启恢复。
- 与 Claude Adapter 运行同一组宿主无关契约测试。

### Stage D：跨机器/持续调度

- 仅在 Stage C 完成后评估 WebSocket、daemon、scheduled task 和长期 supervisor。
- 不把 Codex Goal、subagent 或 App Server 本身当作 restart-safe supervisor。

## 8. 验收标准

- [ ] Codex Adapter 能从 App Server 枚举真实 thread，并生成带 adapter 前缀的 SessionRef。
- [ ] 对 idle thread 的 `send` 能得到可审计的 `requestId`、`threadId`、`turnId` 和 ack 状态。
- [ ] 对 active thread 的 `send` 正确使用 `turn/steer`，不伪造新的独立 peer。
- [ ] `turn/completed`、失败、取消和连接中断均能映射到明确状态；未知状态不报告成功。
- [ ] 相同 requestId 重试不会重复发送或重复执行。
- [ ] Codex Adapter 不把 transcript/thread 状态当作 Quay task 权威状态。
- [ ] Claude Adapter 与 Codex Adapter 通过同一宿主无关契约测试。
- [ ] 失败、过期、冲突和跨机器认证均有负向测试。
- [ ] 本 SPEC 的实现不会扩大当前 Codex Stage 1 的自治生命周期权限。

## 9. 非目标

- 不在本 SPEC 中实现通用消息 broker。
- 不把 MCP `task_write` 改造成会话消息 API。
- 不实现 Codex transcript 解析器或 session evidence authority。
- 不承诺 Codex 已经存在 Claude `SendMessage` 的完全等价 peer API。
- 不启用无人值守的 task lifecycle、milestone scheduler 或 perpetual loop。
