# 会话入站双路对照：轻量 peer 身份（方案 C） vs 官方 Channels

- **任务**：`tasks/gap-quay-server-lightweight-peer-identity-spike.md`
- **日期 / 环境**：2026-09-13，本机（Linux 6.8.0-48-generic，16 核）；Claude Code **2.1.270**
  （`/home/yale/.local/share/claude/versions/2.1.270`）；发送侧会话 = 本任务 worker 会话
  （`quay-task-worker`，sessionId `543fd7ee-1e28-4c38-9fe6-1dda0ee633c8`，pid 1676668）。
- **方法**：两个纯 Node 探针 + 真实平台动作。⛔ 探针不 spawn claude、无 LLM 循环。
  正控制一律由**真实 Claude Code 会话经平台 `SendMessage` 工具**发起（⛔ 不用 `send-to-session.ts` 代发）。
  证据逐帧落盘：`.quay/peer-identity-probe-evidence.jsonl`（C 路）、`.quay/channel-probe-evidence.jsonl`（Channels 路）。
- **产物**：`plugin/scripts/peer-identity-probe.ts`、`plugin/scripts/channel-probe-server.ts`
  （+ 各一份单测，35 条断言全绿）。

---

## 0. 结论（TL;DR）

| 问题 | 回答 |
|---|---|
| 方案 C 技术上可行吗？ | **可行，且无需冒充** —— 一个如实标注 `agent:"quay"`、`name:"quay-server-<pid>"` 的普通 Node 进程，被真实 Claude Code 会话经平台 `SendMessage` 投递成功（AC1 实测）。 |
| 需要冒充自己是 Claude Code 会话吗？ | **不需要**。`agent` 字段对整个可达性**毫无影响**：`"quay"`、缺省、`"claude"` 三种取值**同结果**（AC3 三行全 DELIVERED）。 |
| 值得采用吗？ | **不建议作为入站主路径**（依据见 §4）：它依赖一个**未文档化的内部契约**，且已实测到该契约在本版本内的具体实现与静态推断不符；同时它**打开了无认证的入站口**。 |
| Channels 可用吗？ | **契约正确，但本环境下未能端到端跑通**。channel **能注册**（实测启动横幅 `Channels (experimental) messages from server:quay-channel-probe inject directly in this session`），但接一个**自研** channel 要连续过**三道交互闸**：目录信任 → **项目 MCP server 批准（默认值是「不使用」）** → dev-flag 确认（`-p` 模式下结构上无法确认）。详见 §3.2、AC12。 |
| 推荐 | **两条都不作为「收」方向的生产路径**。C 路降级为**诊断/观测**用途（本仓库已在此形态上有 `send-to-session.ts` 的先例）；入站需求改为**官方 MCP 轮询/主动查询**形态（即 `list_agents`/任务存储式的「拉」而非「推」），或在目标会话**启动时**就规划好 Channels。若必须「推」进一个**已在运行、未预配置**的会话，本任务实测的答案是：**当前没有满足诚实性的合规路径**。 |

**一句话**：C 路能通，但它通的方式和官方文档/静态推断描述的不一样，而且它把「谁能给 quay server 发消息」这个问题交给了「谁能在 `~/.claude/sessions/` 写一个文件」。

---

## 1. AC13 对照表（本任务真正的交付物）

两路面对**同一组能力问题**。每一格都是实测读数或显式 `not-evaluated`。

| # | 能力问题 | 方案 C（轻量 peer 身份）实测 | Channels（官方）实测 |
|---|---|---|---|
| ① | **会话无需预先配置即可被寻址**（发现式寻址） | **可达**。探针登记后立即出现在**任意**会话的 `ListAgents` 里（`quay-server-1695152 [79036c] · bg · idle`），对端**零配置**；投递用裸名即可 | **不可**。目标会话必须在**启动时**带 `--channels`/`--dangerously-load-development-channels`；官方原文：*"Being in `.mcp.json` isn't enough to push messages: a server also has to be named in `--channels`"*。实测：server 在 `--mcp-config` 里连上且 capability 正确声明，channel 仍**不注册** |
| ② | **已在运行的会话能否接入** | **可达**（本任务全部正控制都是在**已在运行**的会话里直接 `SendMessage`，对端会话无任何改动） | **不可**（无运行时接入入口；实测必须在启动时给 flag，且该 flag 要交互确认。代价见 AC10） |
| ③ | **第三方 provider 会话可用性** | **发送侧实测可用，接收侧未评**。发送侧本次就是第三方 provider 会话（`deepseek-v4-pro-anthropic` @ fjdac），21 条投递全部正常 ⇒ **发送（客户端）不因第三方 provider 受限**。但「第三方 provider 的**接收**会话能否收到」本任务未单独测 ⇒ `not-evaluated` | **未隔离（实测未达，但与确认闸混淆）**。第三方 env 下未收到事件；官方文档明确 *"not available on Amazon Bedrock, Google Cloud's Agent Platform, or Microsoft Foundry"*。⚠️ 本任务的第三方失败**无法归因给 provider**——因为同一次运行里 `-p` 模式本身就无法回答 dev-flag 确认闸（见 AC12） |
| ④ | **契约稳定性**（文档化与否） | **未文档化**。官方 `cross-session-messaging` 文档只描述行为，**注册表字段语义与过滤规则均无文档**；且实测与「静态读二进制推断」就**矛盾**（推断说 `agent` 会被读出但不参与排除——这条✓；推断说活的 `pid` 字段参与判定——**这条✗**，实测见 AC4） | **文档化**（`docs/en/channels.md` + `channels-reference.md`，本任务引用均附来源）。⚠️ 但官方明标 **research preview**：*"the `--channels` flag syntax and protocol contract may change"* |
| ⑤ | **外→会话 与 会话→外 两个方向是否都通** | **会话→server 通**（AC1 实测）；**server→会话**在本仓库已有实现（`packages/quay/src/serve-send.ts` 的 `sendSessionFrames`，2026-08-15 实测到达），**本次未复测** ⇒ 该方向 `not-evaluated` | **外→会话 未达**（AC8，事件未到达）；**会话→外 未达**（AC9，无 tool 调用）。⇒ 两向皆未达 |
| ⑥ | **落进 quay 现有架构的位置与改动量** | 需新增**常驻入站进程**（socket server + 注册器 + 生命周期/清理），且要与 driver 共存（谁注册、谁清理、崩溃后谁扫残留）。本任务两个探针已证明「注册 + 监听 + 逐帧落盘 + 自清理」约 400 行可完成；但**清理不可靠**（`kill -9` 会留残留，见 AC7） | 需**改造目标会话的启动方式**（加 flag + 交互确认），并且自研 channel 永远在 dev flag 上（官方 allowlist 只有 Anthropic 自维护的那几个）。⇒ 对**既有**运行会话改动量为「重启 + 人工确认」，无法批量 |
| ⑦ | **发送方身份的可靠性** | **平台标注**：到达帧的包裹属性由平台写入（`from="uds:…"` `from-name="quay-task-worker"` `from-mode="bypass"`，AC1 原文）。⚠️ 但接收方是**裸 unix socket**，同机同用户的任意进程都能写同样的字节 ⇒ 该 socket 本身不提供认证 | **平台标注**，且另有 sender allowlist（官方文档：*"only IDs you've added can push messages"*）+ org policy 闸 |
| ⑧ | **跨机** | **未测**（本任务只测本机；`~/.claude/sessions/` 是本机注册表） | 文档称支持（channel server 由会话自己 spawn，可远程）；**未测** ⇒ `not-evaluated` |

### 结论段

**推荐：两条路都不作为「收」方向的生产主路径；C 路保留为诊断用途。**

依据（逐条对应上面的实测）：
1. **C 路的可达性建立在一个无文档、且本版本内已被实测证伪过推断的契约上**（④）。本仓库已有同族漂移的**实测先例**：`plugin/scripts/send-to-session.ts:98` 记着同一套协议在 2.1.233 → 2.1.241 跨 8 patch 行为已变。今天我们又量到一次「推断错」——**这本身就是该契约不可依赖的直接证据**。
2. **C 路把入站认证交给了文件系统**（⑦）：任何能写 `~/.claude/sessions/<pid>.json` 并监听一个 socket 的同用户进程，都会被平台当作 peer 投递。这不是我们引入的新问题，但**采用它就意味着把它变成 quay server 的入站面**。
3. **诚实性方面 C 路是干净的**（AC5）：不需要冒充，如实标注即可 —— 这一点应当明确写清，避免把「不能冒充」误当成「C 路不可行」。
4. **Channels 是文档化的正确方向，但在本环境不可用**，且不可用的原因是**结构性的**（dev flag 的交互确认闸 + `server:` 名解析），不是配置疏漏（AC12）。

**允许的组合结论**：若将来要把 quay 事件「推」进会话，应当**在会话启动时就规划 Channels**（而不是事后接入）。这需要把「会话怎么起」纳入 quay 的控制面 —— 那是一个**架构决策**，不是本 spike 的范围。

---

## 2. 方案 C —— 实测读数（AC1–AC7）

### 2.0 从实测反推的**真实到达路径**

> 这一节是本报告最有复用价值的部分：它描述的是**实测出来的**行为，不是文档推导。

```
① 枚举（ListAgents）：
   读 ~/.claude/sessions/ 下文件名形如 ^\d+\.json$ 的记录，逐条做活性判定：
     读 /proc/<【文件名里的 pid】>/stat 第 22 字段（starttime）
     与记录里的 procStart 比对 —— 不等 ⇒ 判死
   ⇒ 判死的记录会被【从磁盘删除】，.json 与 <pid>.*.key 一起删（实测，见下）
   ⇒ spare === true 或 parkedJobId 非空的记录被【排除】（不删）
   ⇒ 枚举本身会对每个存活 peer 发起一次 connect/close（无帧）

② 投递（SendMessage）：
   connect 到记录里的 messagingSocketPath
   ⛔ 不发 auth 帧 —— 直接写一帧 user 帧
   包装属性由平台写入（发送方无法自报）

③ 文件的真实作用域：
   <pid>.json              —— 【必需】（删掉即不可达）
   <pid>.*.key             —— 【收方向完全不被使用】（删掉整个文件仍可达）
```

**支持①「枚举即删除」的受控对照**（AC7）：
`kill -9` 探针后，记录与 socket 都还在盘上；**只**调一次 `ListAgents` ⇒ `1695152.json` **与** `1695152.*.key` 双双消失（socket 文件**不被清理**，成为孤儿）。
⇒ 归因明确：是**枚举**触发清理，不是发送路径。

**支持②「无 auth 帧」的直接证据**：全部 27 轮投递中，探针侧 `authVerdict` **无一例外**是 `not-auth`
（该取值与 `ok` 在探针里是**两个不同的词**，所以「没有 auth 帧」不会被伪装成「auth 通过」）。

### 2.1 AC1（正控制·核心）—— **达成**

由本 worker 会话（一个**真实 Claude Code 会话**）调用平台 `SendMessage` 工具投递唯一串
`AC1-NONCE-QUAYPROBE-a7f3c91e2b4d`。探针落盘的**原始一帧**（逐字节）：

```json
{"msgV":1,"msg_id":"7c479e10-e44c-4e43-a10b-66e2d702a0f7","type":"user",
 "message":{"role":"user","content":"<cross-session-message from=\"uds:/run/user/1000/cc-socks/1676668.sock\" from-name=\"quay-task-worker\" from-mode=\"bypass\">\nAC1-NONCE-QUAYPROBE-a7f3c91e2b4d — …\n</cross-session-message>"},
 "priority":"next","from":"uds:/run/user/1000/cc-socks/1676668.sock"}
```

**实际到达的包裹属性原文**（AC1 要求抄录）：
```
from      = "uds:/run/user/1000/cc-socks/1676668.sock"
from-name = "quay-task-worker"
from-mode = "bypass"
```
⇒ 属性由**平台**注入（发送方 payload 里没有这些字段），与 `send-to-session.ts` 那条「`from-mode` 是硬编码字符串」的既有裁定相比，**收方向的身份是平台标注的**。

### 2.2 AC2（负控制，双向）

| 扰动 | 结果 | 说明 |
|---|---|---|
| ① `<pid>.json` **被删除** | **NOT DELIVERED**（`No agent named … is reachable`） | 注册记录是必需的 |
| ② `<pid>.*.key` 里 `peerToken` 改成与探针校验值**不一致** | **DELIVERED** ⚠️ | **auth 帧根本没被使用** —— 与 2.0② 一致 |
| （追加）`<pid>.*.key` **整个删除** | **DELIVERED** ⚠️ | key 文件在收方向**完全不被读取** |

**AC2 判据的诚实判读**：AC2 的⛔取假形态写的是「任一扰动下仍到达 ⇒ AC1 的到达不是由『注册记录 + auth 帧校验』造成，可行性结论失效，必须在报告中写明真实到达路径」。
实测②与追加行**仍到达** ⇒ 按判据，AC1 的到达**不是**由 auth 帧校验造成的。真实到达路径已在 §2.0 写明：
**注册记录（文件名 pid + procStart + socket 路径 + 未被 spare/parkedJobId 排除）**。
⇒ **可行性结论不受影响**（记录仍必需，AC2① 已证），但 AC2 原文中「auth 帧校验」这半边的预期被实测**推翻**——这正是本 spike 要量的东西之一。

### 2.3 AC3（可见性枚举，⛔ 非布尔）

| 轮 | `agent` 取值 | `name` | 出现在 `ListAgents`？ | 可被 `SendMessage` 投递？ |
|---|---|---|---|---|
| a | `"quay"`（如实） | `quay-server-1695152` | **是**（`quay-server-1695152 [79036c] · bg · idle`） | **是** |
| b | 缺省（键不存在） | `quay-server-1695152` | **是** | **是** |
| c | `"claude"`（冒充） | `quay-server-1695152` | **是** | **是** |

⇒ **`agent` 字段对可达性零影响**。三行同结果 ⇒ 对 AC5 而言是**好消息**：如实标注不会损失任何能力。
（`kind="bg"` 与 `kind="interactive"` 也都可投递，见 AC4-11。）

### 2.4 AC4（协议最小集）—— 必需 / 可选 / 未评估

**方法**：探针对**正在运行的自己**的注册记录做逐字段剥离/改值（`patch` 子命令只认带本脚本标记的记录），
每次改完立刻投递一条唯一 nonce，以探针是否落盘该 nonce 为判据。**每行都是实测**。

| 字段 | 扰动 | 结果 | 判定 |
|---|---|---|---|
| `procStart` | 改成 `"1"` | **NOT DELIVERED** | **必需** |
| `messagingSocketPath` | 指向不存在的路径 | **NOT DELIVERED** | **必需** |
| `spare` | 设为 `true` | **NOT DELIVERED** | **必需「不置真」**（与静态推断②(a) 一致） |
| `parkedJobId` | 设为非空 | **NOT DELIVERED** | **必需「不置非空」**（与静态推断②(b) 一致） |
| （记录文件本身） | 删除 `<pid>.json` | **NOT DELIVERED** | **必需**（AC2①） |
| `pid` | 改为不存在的 1695153 | DELIVERED | 可选（字段值不参与判定） |
| `pid` | 改为存在的 1 | DELIVERED | 可选 |
| `pid`=1 **且** `procStart`=pid 1 的真实 starttime | — | **NOT DELIVERED** | ⇒ **判别实验**：判定用的是**文件名 pid** 所指进程，**不是**记录里的 `pid` 字段 |
| `peerProtocol` | 99 | DELIVERED | 可选 |
| `peerFeatures` | `[]` | DELIVERED | 可选 |
| `version` | `"0.0.0"` | DELIVERED | 可选（**⇒ 不必自称 Claude Code 版本**） |
| `sessionId` | 换成另一个 UUID | DELIVERED | 可选 |
| `name` | 剥离（键不存在） | DELIVERED | 可选（平台**回退派生显示名** = cwd 目录名；本轮显示为 `gap-quay-server-lightweight-peer-identity-spike`，可按该名寻址） |
| `cwd` | `/nonexistent/zzz` | DELIVERED | 可选 |
| `kind` | `"interactive"` | DELIVERED | 可选 |
| `status` | `"busy"` | DELIVERED | 可选 |
| `pidDomain` | 换成外机域 | DELIVERED | 可选 |
| `jobId` | 设为非空 | DELIVERED | 可选（⚠️ 与 `parkedJobId` 不同） |
| `agent` | 缺省 / `"claude"` | DELIVERED | 可选 |
| `entrypoint` | 全程 `"quay-peer-probe"`（非 CC 值） | DELIVERED | 可选 |
| 自定义额外字段 `__quayProbe` | 剥离 | DELIVERED | 可选（未知字段不影响） |
| `startedAt` `nameSince` `updatedAt` `statusUpdatedAt` | 未单独扰动 | — | **未评估** |

**共 18 行实测**（AC 要求 ≥10 个字段、每行一次实测投递结果）。
**最小必需集 = { 文件名 `<pid>.json` 存在，`procStart` 与该 pid 的真实 starttime 一致，`messagingSocketPath` 可达，`spare`/`parkedJobId` 未置 }**。

> ⚠️ 一条**推断被实测推翻**的记录：立案当轮静态读二进制得出「`pid` 不存在 ⇒ gone；`procStart` 不匹配 ⇒ recycled」。
> 实测表明 **`pid` 字段本身完全不参与判定**（改成一个不存在的值、甚至改成 1，都照常投递），
> 真正被比对的是**文件名里的 pid**。这正是任务 §「线索」里要求「若实测与推断矛盾，以实测为准并记下这次矛盾」的那一条。

### 2.5 AC5（诚实性结论闸）—— **达成：不冒充也完全可达**

**显式回答**：在 `agent`/`name`/`version` **均不冒充** Claude Code 会话的前提下，投递**仍然可达**。

实测依据（三行对照，全部来自 AC3/AC4）：
- (a) 行：`agent:"quay"` ∧ `name:"quay-server-1695152"` ⇒ **DELIVERED**；
- (b) 行：`agent` 缺省 ⇒ **DELIVERED**；
- (c) 行：`agent:"claude"` ⇒ **DELIVERED**（同结果 ⇒ 无增益）。
- 补充：`version:"0.0.0"`（非 CC 版本号）⇒ DELIVERED；`entrypoint:"quay-peer-probe"`（非 CC 值，全程如此）⇒ DELIVERED。

⇒ **不存在「必须冒充才可达」的情形**，因此**不触发** AC5 的「不可行（受诚实性约束）」分支。

⚠️ **残留（必须与 AC5 区分开）**：不冒充**发送方身份**是一回事；平台在 `SendMessage` 的**返回文案**里会把探针称作
`"another Claude session on this machine"`（平台自己的措辞，非本方声明）。这不构成本方伪装，
但说明**平台侧没有任何机制区分「真会话」与「如实登记的非会话进程」**——这正是 §4 的采用顾虑之一。

### 2.6 AC6（共享状态安全）—— 达成，**但字面判据有一处偏差，见 §5**

> ⚠️ 先读这句：AC6 的判据原文是「**任一**他人记录的 sha256 变化 ⇒ 不达成」。
> 实测**确实发生了 1 条他人记录变化**（且已证明不是本任务写的）。**该字面判据在活机器上不可满足**，
> 完整的读数、归因与「替代判据」见 **§5**。本节的「达成」指的是**它要保护的安全性质**成立（探针只动自己的文件）。

- 任务开始时对 `~/.claude/sessions/` 做快照（文件名 + mtime + sha256），任务结束后再做一次；
  两次快照**已追加进证据文件** `.quay/peer-identity-probe-evidence.jsonl`（`kind: registry-snapshot-before/after`），逐文件比对。
- 探针的清理闸（`shouldCleanupFile`）**只允许**删「自己 pid 的文件」或「带本脚本 marker 的文件」，
  单测里对「别人的记录」「只带相同 pid 前缀的别的 pid」「无 marker 的孤儿」三类负控制各有一条断言。
- 比对结果、以及「探针遗留文件 = 0」的读数见 §5 的落地读数。

### 2.7 AC7（稳健性读数）

| 项 | 实测 |
|---|---|
| ① 探针**重启**（pid 变）后：旧记录命运 / 新记录是否立即可投递 | **旧记录被平台删除**（受控对照：`kill -9` 后**只**调 `ListAgents` ⇒ `.json` 与 `.key` 双双消失；**socket 文件残留**成为孤儿）。**新记录立即可投递**（新 pid 的探针注册后，一次 `SendMessage` 即 DELIVERED，无需等待） |
| ② 探针被 `kill -9` 后，陈旧记录在发送侧的**错误形态** | 发送侧返回 **`No agent named '<name>' is reachable`** —— 与「记录被删除」**同一形态**（不区分「进程死了」与「记录没了」）。socket 侧无连接尝试（枚举阶段就被过滤） |
| ③ 同一 `name` 与另一个 peer 重名 | `ListAgents` **两条都列出**（同名，靠 ref 区分：`quay-server-1695152 [b71902]` 与 `[79036c]`）。裸名投递**路由到「本会话此前确认过的那个」**并给出明确提示：*"1 other live session is also named '…'. This went to the one this conversation confirmed; to switch, re-send with that session's 'name [ref]'"*。按 `name [ref]` 显式寻址**精确命中第二个**（探针侧 label 证实） |

**附**：`ListAgents` 自身会对每个存活 peer 发起一次 connect/close（受控：单独一次 `ListAgents` ⇒ 恰好 +1 次 connect/close，无帧）。

---

## 3. Channels —— 实测读数（AC8–AC12）

### 3.1 契约（官方文档，附来源）

- 一个 channel = 一个 MCP server，capability 声明 `experimental: { 'claude/channel': {} }`
  （官方原文：*"Presence registers the notification listener"*）。
- 事件注入 = `notifications/claude/channel`，`content` 成为 `<channel>` tag 正文，`meta` 的每个键成为 tag 属性
  （键必须是标识符，含连字符的**静默丢弃**）。
- 会话回话 = 普通 MCP tool（本例暴露 `reply` / `ingest`）。
- 启动：`claude --channels plugin:<name>@<marketplace>`；自研 channel 用
  `claude --dangerously-load-development-channels server:<name>`。
- 来源：<https://code.claude.com/docs/en/channels.md>、<https://code.claude.com/docs/en/channels-reference>。

**探针侧已独立核验**（不依赖 Claude Code）：用真实 MCP stdio 握手控制，服务端 `initialize` 返回
`capabilities = {"experimental":{"claude/channel":{}},"tools":{}}`，`tools/list` 返回 `["reply","ingest"]`。

### 3.2 AC8 / AC9（正向 / 反向）—— 未达成（`not-evaluated`，原因已定位到具体机制闸）

按执行顺序列的**四次实测**：

| # | 配置 | 结果 |
|---|---|---|
| 1 | `-p` 非交互 + 第三方 provider + `--mcp-config` + dev flag | server 连上、capability 正确、外部 push 被接受并 `notification_sent`；**会话答 `NO-EVENT`** ⇒ 事件未达 |
| 2 | `-p` 非交互 + Anthropic auth（清空 fjdac 全部 env + `--model sonnet`） | 同上。**会话是健康的**（正常答 `READY`，`is_error=false`）⇒ 不是模型/认证问题 |
| 3 | **交互**（tmux）+ 回答 dev flag 确认闸 | 启动横幅出现：**`Channels (experimental) messages from server:quay-channel-probe inject directly in this session`** ⇒ **channel 注册成功**；**但紧随一行**：`server:quay-channel-probe · no MCP server configured with that name` ⇒ `--mcp-config` 里的 server **不能**被 `server:` 解析到 |
| 4 | 交互 + dev flag 确认 + server 放进**项目** `.mcp.json` | **警告消失** ⇒ 名字解析问题解决（横幅只剩注册成功那三行）。**但 server 进程始终未启动**（探针证据无新 `mcp_connected`、8799 端口无监听）⇒ 卡在**项目 MCP server 的批准闸**上：该 prompt 的**默认选项是拒绝**（`❯ Continue without using this MCP server`），实测用方向键选中第一项后仍未能使其启动 |

⇒ **AC8/AC9 记 `not-evaluated`**：本环境里，要把一个**自研 channel** 接进一个会话，需要**连续通过三道交互闸**
（目录信任 → 项目 MCP server 批准 → dev-channels 确认），其中**项目 MCP 批准闸的默认值是「不使用」**。
这不是 channel 契约的问题（契约本身已被 real MCP 握手独立核验，且第 3 轮的注册横幅证明**契约正确、能注册**），
而是**本机非交互/半交互执行形态**下的人工闸成本问题 —— 这本身就是 AC10「已在运行的会话能否接入」的一条实测读数。

**关键机制闸（实测，非推断）**：`--dangerously-load-development-channels` **必须交互确认**：

```
  WARNING: Loading development channels
  --dangerously-load-development-channels is for local channel development only. …
  Channels: server:quay-channel-probe
  ❯ 1. I am using this for local development
    2. Exit
  Enter to confirm · Esc to cancel
```

⇒ 在 `-p` / SDK 等**非交互**形态下这个闸**结构上无法通过**，channel 永不注册（debug 日志印证：
`[session-notices] … pollChannel=false … nonInteractive=true`）。
**这是 AC8/AC9 在 `-p` 下不可达的根因，且它与 provider 无关** —— 也正因如此，**AC11 的失败不能被归因给第三方 provider**（见 3.3）。

### 3.3 AC11（第三方 provider）—— 未隔离，`not-evaluated`

- 实测：第三方 env（`ANTHROPIC_BASE_URL=https://fjbigmodel.fjdac.cn/`、`ANTHROPIC_AUTH_TOKEN` 存在、
  `ANTHROPIC_DEFAULT_*_MODEL=deepseek-v4-pro-anthropic`）下，**未收到** channel 事件。
- ⛔ **但没有把它记为「provider 导致」**：同一次运行里 `-p` 模式**同时**被 dev-flag 确认闸挡住（3.2）。
  provider 效应与确认闸效应**在本任务的设计里无法分离** ⇒ `not-evaluated`。
- ⛔ 也未以「二进制里有 `Channels are not available on third-party providers` 这个字符串」为由跳过实测
  （字符串存在 ≠ 该分支本次被触发）。官方文档另有明确来源：*"not available on Amazon Bedrock,
  Google Cloud's Agent Platform, or Microsoft Foundry"* —— 但 fjdac 不在该列表里，故**不能**由文档外推到本环境。

### 3.4 AC10 / AC12（预配置约束 / 启用闸）

**AC12 实测回答**：本机**当前**配置下（`~/.claude/settings.json` 无 `channelsEnabled`、无 `allowedChannelPlugins`；
`/etc/claude-code/managed-settings.json` **不存在**）——
- 使 channel 可达的**最小**改动 = **不需要 managed settings**（该键仅对 Team/Enterprise/Console-with-managed-settings 生效；
  本机走 claude.ai 登录，属于「Pro/Max 无组织 ⇒ 跳过这两个检查」）；
- 真正卡住的是**两条**：**(a)** 自研 channel 不在 Anthropic 维护的 allowlist 上 ⇒ 必须 `--dangerously-load-development-channels`；
  **(b)** 该 flag **必须交互确认** ⇒ 非交互形态不可用；
- 另加一条实测发现：**(c)** `server:<name>` 的解析**不读 `--mcp-config`**（3.2 第 3 行），必须来自项目 `.mcp.json` 一类的常规 server 定义。

⇒ **是否需要机器管理员权限**：**不需要**（未使用 managed settings）。
⇒ **是否影响本机其它项目/会话**：只要不写 managed settings 就**不影响**；但 `--dangerously-load-development-channels`
是一个**逐会话**的显式人工确认，无法静默批量化。

**AC10 实测回答（已在运行的会话能否事后接入）**：
- 路径 (a) **运行时动态添加**：**无可用入口**。官方契约里 channel 由**启动参数** `--channels` 选择，
  `-p` 下 `pollChannel=false`，且没有运行时开启通道的命令；官方原文 *"no channel runs until a user opts it in for the session with `--channels`"*。
- 路径 (b) **配置文件 + 重启**：**实测走了这条**——把 server 定义放进 `.mcp.json` 并**重启**会话、带 dev flag 并确认。
- **量化代价**：以本机当时 `ListAgents` 的 peer 数（**10**）为分母，「要收 quay 事件就必须重启并人工确认」的会话数 = **10/10**（含 2 个 `interactive`、7 个 `bg`、1 个 `shell`）。
  ⇒ 对已在运行的会话，Channels 的接入成本是**逐会话重启 + 人工确认**，不是配置一次。

---

## 4. 推荐与依据

**推荐：两路都不作为入站主路径。**

1. **C 路能通，但通在一个无文档的契约上**（AC13 ④），且我们已经**实测到该契约与静态推断不符一次**（AC4 的 `pid` 字段）。
   本仓库有同族先例（同一协议 2.1.233 → 2.1.241 行为已变）。
2. **C 路把入站认证降级为「能否写一个文件」**（AC13 ⑦ / §2.0）。若采用，必须**在这一点上做出显式决定**（是否可接受同用户任意进程冒充 peer 给 quay server 投递）。
3. **Channels 是文档化的正确方向，但本环境不可用**，且不可用是**结构性**的（dev-flag 交互确认 + allowlist），不是配置疏漏。
   若要采用，需要**在会话启动时**就规划（属于「quay 如何起会话」的架构决策）。
4. **对「必须推给一个已在运行、未预配置的会话」这个需求**，本任务实测的答案是：**当前没有满足诚实性的合规路径**。
   最接近的合规替代是**改成「拉」**——由会话/驱动侧主动查询（本仓库的既有形态：MCP tool + 任务存储 + `sendSessionFrames` 的出方向）。
5. **本任务的两个探针保留为诊断机件**（C 路探针的 `--serve/--patch/--cleanup` 与 Channels 探针的 `--selfcheck`），
   ⛔ **但不接线进生产**（DoD 明令）。

---

## 5. AC6 落地读数（共享状态安全）

**探针自身残留：0**。全部探针退出后扫描 `~/.claude/sessions/`，带本脚本标记（`__quayProbe`）的记录 = **0 条**；
`pgrep` 探针进程 = **0**。优雅退出（`SIGTERM` / `--shutdown`）**实测会**清掉记录 + key + socket（probe#2、probe#3、probe#4 均验证）。

**我们的代码写过的全部路径（穷举，来自探针自己的证据文件 `register-record` / `register-key` / `listening` 三处落盘）：**
```
/home/yale/.claude/sessions/1695152.json        + 1695152.<64hex>.key
/home/yale/.claude/sessions/1745824.json        + 1745824.<64hex>.key
/home/yale/.claude/sessions/1753085.json        + 1753085.<64hex>.key
/home/yale/.claude/sessions/1753464.json        + 1753464.<64hex>.key
```
⇒ **8 个路径，全部属于本探针自己的 pid**；⛔ 无一落在别处。

**⚠️ AC6 的判据未按字面达成 —— 如实记录，不解释掉：**

| 项 | 读数 |
|---|---|
| 任务前后两次快照 | 20 → 26 个文件 |
| **他人记录 sha256 变化** | **1 条**：`2065370.json`（一个**真实**会话 `quay unified server design`，无探针标记）。sha 变化、mtime `04:27:27Z → 04:37:35Z`、**字节数不变（1088）** |
| 归因 | **不是本任务写的**：上表穷举了我们写过的全部 8 个路径，从未触及该文件；且该记录不含本脚本标记 |
| 对照组（我做的） | 零探针进程下相隔 75s 的两次快照 ⇒ **没有**任何记录自更新 |
| ⇒ 结论 | **该变化的成因未定**。我不能用「会话本来就会自更新」解释它（对照**未**复现）；也不能说它是我们写的（穷举证明相反）。两种说法都超出证据 ⇒ **成因记为未知** |

**⇒ 判据形态的教训（值得后续任务采用）**：`AC6` 字面写的是「任一他人记录的 sha256 变化 ⇒ 不达成」。
但在**活机器**上，`~/.claude/sessions/` 是**全机共享的活运行时状态**（本任务期间：2 条记录消失、4 条新增、1 条变更 —— 都不是我们写的），
这条判据**结构上不可满足**，且失败时**无法区分**「我们破坏了共享状态」与「别人自己动了」。
**可满足的等价判据应当是**：「本任务代码写过的路径集合 ⊆ 自己 pid 的文件集」——
它**可取假**（穷举全部写入点即可），且**与共享状态的其它参与者无关**。（这正是本报告 §5 上表实际给出的形式。）

**已知残留（设计使然，已实测）**：
- `kill -9` 的探针会留下 **孤儿 socket 文件**（`/run/user/1000/cc-socks/<pid>.sock`）——平台只清记录与 key，**不清 socket**（实测 2 例）。
  本次两枚孤儿 socket（`1695152.sock`、`1753464.sock`）已在任务收尾时手工删除。

---

**未评估项（明确列出，⛔ 不以推断填充）**：
- AC4 的 `startedAt` / `nameSince` / `updatedAt` / `statusUpdatedAt` 四字段未单独扰动。
- AC8 / AC9：未达成，原因是三道交互闸（见 §3.2），非契约问题。
- AC11：第三方 provider 效应与确认闸效应**未分离**。
- AC13 ⑤ 的「server→会话」方向未复测（既有实现 `packages/quay/src/serve-send.ts` 存在）。
- AC13 ⑧ 跨机未测。
