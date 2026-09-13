---
id: gap-quay-server-lightweight-peer-identity-spike
title: 验证「轻量 peer 身份」可行性——quay server 以非 LLM 进程身份被 SendMessage 直接投递（统一
  server「收」方向的前置 spike）
status: ready
labels:
  - gap
  - spike
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：人 2026-09-13 裁定。讨论「更统一的 quay server（web + drivers + 与运行中 Claude Code 会话收发消息）」时，「发」方向已解决（`packages/quay/src/serve-send.ts` 的 `sendSessionFrames` + `plugin/scripts/send-to-session.ts` 共用一份 socket 协议实现），**「收」方向结构性缺失**：driver/serve 都是纯 Node 进程，不是 Claude Code 会话，在 `~/.claude/sessions/` 里没有身份，因此没有任何东西可以被 `SendMessage` 投递到。

人在三个方案（A 常驻真会话做收件口 / B 只用 MCP 控制面 / C 注册轻量身份不带模型循环）中**裁定走 C**。本任务是 C 的**可行性验证**，⛔ 不是 C 的实现。

**已取得的一手读数（2026-09-13，Claude Code 2.1.270，本机）**：

注册记录 `~/.claude/sessions/<pid>.json` 的真实字段：
```json
{"pid":1257347,"sessionId":"<uuid>","cwd":"/home/yale/work/quay","startedAt":1789272075652,
 "procStart":"283506733","version":"2.1.270","peerProtocol":1,
 "peerFeatures":["notify_idle","reply_across_default_dirs","artifact_yield"],
 "kind":"bg","entrypoint":"cli","pidDomain":"linux:<hostid>:pid:[4026531836]",
 "messagingSocketPath":"/run/user/1000/cc-socks/<pid>.sock","name":"611cc551","nameSince":...,
 "agent":"claude","jobId":"...","spare":true,"status":"idle","updatedAt":...,"statusUpdatedAt":...}
```
凭据文件 `<pid>.<64hex>.key` = `{"peerToken":"<32hex>","procStart":"...","pidDomain":"..."}`。

**这批字段大部分是【关于真实进程的真实事实】**（pid / procStart（/proc/<pid>/stat 第 22 字段）/ pidDomain / cwd / startedAt / socket 绝对路径）——quay server 是真进程，这些都能**如实**填写，无需伪造。自述性字段只有 `agent` / `kind` / `version` / `peerProtocol` / `peerFeatures`。**方案 C 的可行性问题因此收敛为一个可实测的问题：平台（ListAgents / SendMessage）是否按这些自述字段过滤，以及在【如实标注自己不是 Claude 会话】的前提下是否仍可被投递。**

另一条读数：本机 `~/.claude/sessions/` 只有 8 条记录，而本会话 `ListAgents` 列出 60 个 peer（含 `Remote Control` / `cloud` 两类）⇒ **ListAgents 的枚举源不止本机注册表**，本机 peer 与远程 peer 走不同来源。本任务只验证**本机**这一半。

**⚠️ 诚实性边界（本任务的硬约束，⛔ 不得在验证中越过）**：
`plugin/scripts/send-to-session.ts:31-41` 已有一条既存裁定：该脚本写的 `from-mode="bypass"` 是**硬编码字符串**，对端无法区分真假 ⇒「⛔ 不要用于代替 SendMessage 给别的会话发消息」，并对应 CLAUDE.md §0.55「自报身份 = 无认证」。
**本任务与那条裁定管的不是同一件事，必须在报告里写清区分**：
- 那条管**发送侧冒充**（一个脚本自称是某个 bypass 会话发的）——**继续禁止**。
- 本任务管**接收侧登记**（一个真实进程如实登记自己的 pid/socket，声明「我可以收消息」）——这是**被投递方**，不伪造发送者身份。
**但**：若实测表明「只有把 `agent` 填成 `claude`（即冒充自己是一个 Claude Code 会话）才能被投递」，那就落回了自报身份的形态 ⇒ **本任务的结论必须是「不可行（受诚实性约束）」，⛔ 不得因为「反正能通」而把冒充形态记为可行**。这一条是 AC5。

**为什么必须是 spike 而不是直接实现**：上述三个未知（枚举过滤规则 / 投递校验规则 / 诚实标注下的可达性）任何一个取假，方案 C 的形态就完全不同（从「几十行注册+socket server」变成「必须常驻真会话」= 退回方案 A）。先量再改（硬规则 4 推论）。

### 立案当轮已取得的线索（2026-09-13，manager 会话，Claude Code 2.1.270）

**⚠️ 下列①②是【静态读 minified 二进制的推断】，⛔ 不是实测结论，⛔ 不得用来替代任何一条 AC。** 它们只是给执行者的起点：告诉你去测什么、预期看到什么，**若实测与推断矛盾，以实测为准并在报告中记下这次矛盾**（推断错了本身是有价值的读数）。

**① 会话记录枚举实现（`/home/yale/.local/share/claude/versions/2.1.270` 内，函数经 minify）**：
枚举只按**文件名** `^\d+\.json$` 过滤，逐个解析；解析结果里 `agent` 字段**被读出但不参与排除**（`agent: typeof o.agent === "string" ? o.agent : void 0`）。
⇒ **对 AC3 的预期**：如实填 `agent:"quay"` 时记录**可能仍可见**。⚠️ 但 AC3 仍必须实测三行——静态可见 ≠ SendMessage 可投递（两者是不同的判定路径）。

**② 存活/身份判定（对 AC4、AC7 直接相关）**：
```
pidDomain 与本机不同      ⇒ "present"（跨容器/跨机记录不判死）
pid 不存在                ⇒ "gone"
procStart（/proc starttime）不匹配 ⇒ "recycled"（pid 复用防护）
```
⇒ **对方案 C 是好消息**：quay server 是真进程，`pid`/`procStart`/`pidDomain` 如实填即可通过，**无需伪造**。
⇒ **同时读到两条反向事实，AC6/AC7 必须覆盖**：(a) `spare === true || parkedJobId !== undefined` 的记录会被**排除**；(b) 被判 `gone` 的记录会被**其它会话主动删除**，文件名非 canonical 的记录**直接删文件** ⇒ 探针的记录可能被别人清掉，这不是 bug 而是平台设计，AC7 要量它。

**③ 发送侧校验消息清单（二进制内字符串，实测可见）**——AC2 负控制预期看到的错误形态可能出自这批：
```
Refusing to send: cannot vet reply target
Refusing to send: reply target is a symlink
Refusing to send: connected endpoint identity could not be read
Refusing to send: connected endpoint is not the expected process
Refusing to send: connected endpoint owner could not be read
Refusing to send: connected endpoint is not owned by this user
Refusing to send: connected endpoint is a different process with the expected pid
```

**④ ⚠️ 平台侧存在一条【文档化的官方等价通道】：Channels —— 本任务结论必须与它对照，否则结论不完整。**
实测（本机 2.1.270）：`claude --channels <servers...>` 是真实存在的 CLI 参数（`--help` 不显示，传空参数报 `option '--channels <servers...>' argument missing`）。二进制内含接入示例：**一个 channel 就是一个 MCP server**，在 capabilities 里声明 `experimental: { 'claude/channel': {} }`（注释原文：`Required: presence of this key registers the channel notification listener on Claude's side`），外部事件以 `<channel source="...">` 注入会话，会话回话走 reply tool。配套闸：`channelsEnabled`（managed settings）/ `allowedChannelPlugins`（org allowlist）/ `--dangerously-load-development-channels`（本地开发）。**已知限制**：二进制内字符串 `Channels are not available on third-party providers` ⇒ 跑 `claude-fjdac`/deepseek 的 worker 收不到；未启用时 `Inbound messages will be silently dropped`。

**⑤ 官方文档侧的定性（2026-09-13 核实，含来源）**：`~/.claude/sessions/` 注册表的**结构、字段语义、ListAgents 的过滤规则均无官方文档**——官方只说"会话把自己注册到磁盘文件，Claude 列出/发消息时读这些文件"（https://code.claude.com/docs/en/cross-session-messaging.md），字段与过滤规则属**内部实现细节、不承诺稳定**；第三方进程接入**完全无文档支持**；官方推荐的等价路径是 **Channels**（https://code.claude.com/docs/en/channels.md）。
**⊢ 这一条直接构成本任务结论的一个必答项**：即使 AC1–AC7 全部实测为「技术上可行」，**报告仍必须回答「赌一个未文档化的内部契约是否值得」**——本仓库已有同族漂移的实测先例：`plugin/scripts/send-to-session.ts:98` 记着同一套协议在 2.1.233 → 2.1.241 跨 8 patch 行为已变（当时的记述被实测推翻）。

**⊢ 两条路径提供的能力不同，⛔ 不是纯替代**（这是本任务结论要帮人裁定的真正取舍点）：
```
方案 C 独有：quay server 出现在别的会话的 ListAgents 里，任何会话【无需预先配置】即可寻址它
Channels 独有：官方契约 + policy 闸 + 跨机；但 quay server 不是 peer，会话须在启动时 --channels 声明
```

## Plan

1. **读协议**：以 `packages/quay/src/serve-send.ts`（`sendSessionFrames` / `resolveSessionEndpoint`）与 `plugin/scripts/send-to-session.ts` 为发送侧的已知形态，推导接收侧最小实现：unix socket server → 读第一行 auth 帧（`{"type":"auth","token":…}`）校验 token → 读后续 user 帧（`{"type":"user","message":{"role":"user","content":"<cross-session-message …>…"}}`）。
2. **最小探针** `plugin/scripts/peer-identity-probe.ts`：纯 Node、**⛔ 无 LLM 循环、⛔ 不 spawn claude**。启动时：生成 peerToken、监听自选路径的 unix socket、把自己的记录写进 `~/.claude/sessions/<pid>.json` + `<pid>.<hex>.key`（字段如实填自己的真实进程事实）；收到的**每一帧原始字节**逐行落盘 `.quay/peer-identity-probe-evidence.jsonl`；退出时（含 SIGINT/SIGTERM/未捕获异常）清理自己的记录与 socket。
3. **正控制（核心）**：由**另一个真实的 Claude Code 会话**调用平台 `SendMessage` 工具向探针投递一条含唯一随机串的消息（⛔ 不是 send-to-session.ts、⛔ 不是探针自己给自己发——那是硬规则 4 的自证，结构上不可能取假 ⇒ 不算测量）。
4. **负控制**：删除注册记录 / 令 key 中 peerToken 与实际校验值不一致，各重试一次，确认**不**到达。
5. **字段必要性枚举**：逐字段剥离/改值，产出「必需 / 可选 / 未评估」表。
6. **稳健性读数**：探针重启（pid 变）后旧记录的命运；探针被 kill 后陈旧记录在发送侧的表现。
7. **报告与结论**：三选一（可行 / 有条件可行 / 不可行），附实测依据。⛔ 本任务不接线进生产。

## Acceptance Criteria

- [ ] AC1（正控制·核心，可取假）：探针按 Plan 2 启动后，**由另一个真实 Claude Code 会话调用平台 `SendMessage` 工具**投递一条含唯一随机串 `<nonce>` 的消息，探针把收到的原始帧落盘 `.quay/peer-identity-probe-evidence.jsonl`。判据：该文件存在 ∧ 含该 `<nonce>` ∧ 记录中可见平台加的 `<cross-session-message from=… from-name=… from-mode=…>` 包裹属性（把**实际到达的属性值**抄进报告——身份是平台标注的还是发送方自称的，这里能直接看出来）。⛔ 取假形态：文件缺失或不含 `<nonce>` ⇒ 记为未达成，⛔ 不得改用 `send-to-session.ts` 自己发一条来"补上"。⚠️ 若执行环境无法调用 `SendMessage`（工具不可用/无 peer 可用）⇒ 该 AC 记 **not-evaluated** 并在报告写明原因，⛔ 不得记为通过、也不得记为失败（硬规则 3b）。
- [ ] AC2（负控制，双向）：同一条 SendMessage 路径，在两种扰动下各重试一次并落盘读数——①探针的 `~/.claude/sessions/<pid>.json` 被删除；②`<pid>.*.key` 里的 `peerToken` 与探针实际校验的值不一致。判据：两次扰动下证据文件**均无**该轮新 `<nonce>`。⛔ 取假形态：任一扰动下仍到达 ⇒ AC1 的到达不是由「注册记录 + auth 帧校验」造成，可行性结论失效，必须在报告中写明真实到达路径。
- [ ] AC3（可见性枚举，⛔ 非布尔）：在至少三种自述字段取值下各测一轮，产出三行读数表落进报告，每行三列：`agent`/`kind` 取值 → 是否出现在发送侧 `ListAgents` 输出 → 是否可被 `SendMessage` 投递。三种取值至少含：(a) 如实值（如 `agent:"quay"`，`name` 明确含 `quay-server`）、(b) 该字段缺省/空、(c) `agent:"claude"`。任一行读不到 ⇒ 该行记 **not-evaluated**，⛔ 不记 false。
- [ ] AC4（协议最小集）：对注册记录逐字段做剥离/改值实测，产出「必需 / 可选 / 未评估」表落进报告，**至少覆盖 10 个字段**：`pid` `procStart` `pidDomain` `messagingSocketPath` `peerProtocol` `peerFeatures` `version` `sessionId` `name` `cwd` `kind` `status`。每行必须带**一次实测投递结果**（⛔ 不接受"按代码推断"）。
- [ ] AC5（诚实性结论闸）：报告显式回答——「在 `agent`/`name`/`version` **不冒充** Claude Code 会话（如实标注 quay-server、不自称 agent=claude）的前提下，投递是否仍可达」。若实测为「**必须**冒充才可达」⇒ 结论必须写 **不可行（受诚实性约束）**，并附该判断的实测依据（AC3 的 (a) 行与 (c) 行读数对照）。⛔ 不得以"反正能通"为由把冒充形态记为可行结论。
- [ ] AC6（共享状态安全，可取假）：`~/.claude/sessions/` 是**全机共享的运行时状态**（本机此刻有 8 条真实会话记录 + 正在运行的 loop 依赖它）。探针只允许创建/删除**自己 pid** 的记录与 key 文件。判据：任务结束后该目录中无探针遗留文件 ∧ 任务执行前后对该目录做的两次快照（文件名 + mtime + 内容 sha256）显示**其他会话的记录未被本任务修改**，两次快照落盘进证据文件。⛔ 取假形态：任一他人记录的 sha256 变化 ⇒ 不达成。
- [ ] AC7（稳健性读数）：落盘三项读数——①探针重启（pid 变）后：旧记录是否仍在、是否被平台清理、新记录是否立即可投递；②探针被 `kill -9` 后：陈旧记录在发送侧 `SendMessage` 的**错误形态**（报什么错 / 是否静默失败）；③同一 `name` 与某个真实会话重名时的表现。读不到 ⇒ 记 not-evaluated。

## Definition of Done

- 报告 `docs/analysis/peer-identity-lightweight-registration-2026-09-13.md` 落地，含 AC3 / AC4 / AC7 三张读数表、AC1 实际到达的 `from-*` 属性原文、AC2 两条负控制读数，以及 **AC5 的三选一结论**（可行 / 有条件可行 / 不可行（受诚实性约束）），每条结论附实测依据。
- 探针 `plugin/scripts/peer-identity-probe.ts` 落地，可独立运行（`--serve` 起探针 / `--cleanup` 清理），纯函数部分（注册记录组装、auth 帧校验、帧解析）有单测 `plugin/test/peer-identity-probe.test.mjs`。
- 证据文件 `.quay/peer-identity-probe-evidence.jsonl` 含 AC1 的真实投递记录（或 AC1 记 not-evaluated 时的明确说明）。
- ⛔ **本任务不接线进生产**：不改 `packages/quay/src/serve*.ts`、不改 `plugin/scripts/driver-runtime.ts`、不改 `start-drivers.ts`。接线由后续任务按本任务结论决定形态。
- **结论为「不可行」同样算完成** —— 本任务交付的是一个**有依据的可行性判断**，不是方案 C 的实现；一个证否的结论直接改变统一 server 设计的走向（退回方案 A 或 B），与证成同等有价值。

## Touches

- tasks/gap-quay-server-lightweight-peer-identity-spike.md
- plugin/scripts/peer-identity-probe.ts (new)
- plugin/test/peer-identity-probe.test.mjs (new)
- docs/analysis/peer-identity-lightweight-registration-2026-09-13.md (new)
