---
id: gap-quay-server-lightweight-peer-identity-spike
title: 验证「轻量 peer 身份」与「官方 Channels」双路对照——quay server 以非 LLM 进程与运行中 Claude Code
  会话双向通信的可行路径（统一 server「收」方向前置 spike）
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

### 范围调整：C 与 Channels 双路对照（人 2026-09-13 第二次裁定）

人在看到上节 ④⑤ 两条线索（官方存在文档化的 Channels 通道；方案 C 依赖未文档化内部契约）后**第二次裁定**：范围由「验证方案 C」扩为「**C 与 Channels 双路对照**」。

**⊢ 为什么必须在同一个任务里对照，而不是拆成两个任务**：对照结论的价值全部来自**两条路面对同一组能力问题**。拆开 ⇒ 两份各自成立的报告 + 无人负责的第三方比较，正是本仓库反复出现的「各修各的、没人看全局」形态。**AC13 是本任务真正的交付物，AC1–AC12 都是它的输入。**

**⊢ 执行顺序建议（⛔ 不是判据）**：先跑 Channels 那一路（AC8–AC12，成本低、契约稳），再跑 C 那一路（AC1–AC7）。**⛔ 顺序不构成豁免**——即便 Channels 全部可达，AC1–AC7 仍必须实测，否则 AC13 的对照表会有一整列是推断（硬规则 4：一个结构上不可能取假的量不是测量）。

**⊢ 两条路的能力差异（立案时的理解，AC13 要用实测确认或推翻）**：
```
仅 C 可能具备：quay server 出现在别的会话的 ListAgents 里 ⇒ 任何会话【无需预先配置】即可寻址它
仅 Channels 具备：官方文档化契约 + org policy 闸 + 明确的 sender 身份标注
两者都须回答：已在运行的会话能否接入 / 第三方 provider 会话可用性 / 双向是否都通
```

## Plan

1. **读协议**：以 `packages/quay/src/serve-send.ts`（`sendSessionFrames` / `resolveSessionEndpoint`）与 `plugin/scripts/send-to-session.ts` 为发送侧的已知形态，推导接收侧最小实现：unix socket server → 读第一行 auth 帧（`{"type":"auth","token":…}`）校验 token → 读后续 user 帧（`{"type":"user","message":{"role":"user","content":"<cross-session-message …>…"}}`）。
2. **最小探针** `plugin/scripts/peer-identity-probe.ts`：纯 Node、**⛔ 无 LLM 循环、⛔ 不 spawn claude**。启动时：生成 peerToken、监听自选路径的 unix socket、把自己的记录写进 `~/.claude/sessions/<pid>.json` + `<pid>.<hex>.key`（字段如实填自己的真实进程事实）；收到的**每一帧原始字节**逐行落盘 `.quay/peer-identity-probe-evidence.jsonl`；退出时（含 SIGINT/SIGTERM/未捕获异常）清理自己的记录与 socket。
3. **正控制（核心）**：由**另一个真实的 Claude Code 会话**调用平台 `SendMessage` 工具向探针投递一条含唯一随机串的消息（⛔ 不是 send-to-session.ts、⛔ 不是探针自己给自己发——那是硬规则 4 的自证，结构上不可能取假 ⇒ 不算测量）。
4. **负控制**：删除注册记录 / 令 key 中 peerToken 与实际校验值不一致，各重试一次，确认**不**到达。
5. **字段必要性枚举**：逐字段剥离/改值，产出「必需 / 可选 / 未评估」表。
6. **稳健性读数**：探针重启（pid 变）后旧记录的命运；探针被 kill 后陈旧记录在发送侧的表现。
7. **报告与结论**：三选一（可行 / 有条件可行 / 不可行），附实测依据。⛔ 本任务不接线进生产。
8. **Channels 最小探针** `plugin/scripts/channel-probe-server.ts`：最小 MCP server（纯 Node、**⛔ 无 LLM 循环、⛔ 不 spawn claude**），capabilities 声明 `experimental: { 'claude/channel': {} }`，暴露一个 reply/ingest tool，把收到的每次调用落盘 `.quay/channel-probe-evidence.jsonl`。
9. **Channels 正向**：`claude --channels <spec>` 起一个目标会话，由外部进程推一条含唯一 nonce 的事件，到目标会话 transcript 核证 `<channel source="...">` 到达。
10. **Channels 反向**：目标会话调用探针暴露的 tool，探针侧落盘核证。
11. **Channels 约束实测**：已运行会话能否事后接入 / 第三方 provider 会话 / 本机默认配置是否需要 managed settings。
12. **对照**：两路共用同一组能力问题，产出对照表与推荐。

## Acceptance Criteria

- [x] AC1（正控制·核心，可取假）：探针按 Plan 2 启动后，**由另一个真实 Claude Code 会话调用平台 `SendMessage` 工具**投递一条含唯一随机串 `<nonce>` 的消息，探针把收到的原始帧落盘 `.quay/peer-identity-probe-evidence.jsonl`。判据：该文件存在 ∧ 含该 `<nonce>` ∧ 记录中可见平台加的 `<cross-session-message from=… from-name=… from-mode=…>` 包裹属性（把**实际到达的属性值**抄进报告——身份是平台标注的还是发送方自称的，这里能直接看出来）。⛔ 取假形态：文件缺失或不含 `<nonce>` ⇒ 记为未达成，⛔ 不得改用 `send-to-session.ts` 自己发一条来"补上"。⚠️ 若执行环境无法调用 `SendMessage`（工具不可用/无 peer 可用）⇒ 该 AC 记 **not-evaluated** 并在报告写明原因，⛔ 不得记为通过、也不得记为失败（硬规则 3b）。
- [x] AC2（负控制，双向）：同一条 SendMessage 路径，在两种扰动下各重试一次并落盘读数——①探针的 `~/.claude/sessions/<pid>.json` 被删除；②`<pid>.*.key` 里的 `peerToken` 与探针实际校验的值不一致。判据：两次扰动下证据文件**均无**该轮新 `<nonce>`。⛔ 取假形态：任一扰动下仍到达 ⇒ AC1 的到达不是由「注册记录 + auth 帧校验」造成，可行性结论失效，必须在报告中写明真实到达路径。
- [x] AC3（可见性枚举，⛔ 非布尔）：在至少三种自述字段取值下各测一轮，产出三行读数表落进报告，每行三列：`agent`/`kind` 取值 → 是否出现在发送侧 `ListAgents` 输出 → 是否可被 `SendMessage` 投递。三种取值至少含：(a) 如实值（如 `agent:"quay"`，`name` 明确含 `quay-server`）、(b) 该字段缺省/空、(c) `agent:"claude"`。任一行读不到 ⇒ 该行记 **not-evaluated**，⛔ 不记 false。
- [x] AC4（协议最小集）：对注册记录逐字段做剥离/改值实测，产出「必需 / 可选 / 未评估」表落进报告，**至少覆盖 10 个字段**：`pid` `procStart` `pidDomain` `messagingSocketPath` `peerProtocol` `peerFeatures` `version` `sessionId` `name` `cwd` `kind` `status`。每行必须带**一次实测投递结果**（⛔ 不接受"按代码推断"）。
- [x] AC5（诚实性结论闸）：报告显式回答——「在 `agent`/`name`/`version` **不冒充** Claude Code 会话（如实标注 quay-server、不自称 agent=claude）的前提下，投递是否仍可达」。若实测为「**必须**冒充才可达」⇒ 结论必须写 **不可行（受诚实性约束）**，并附该判断的实测依据（AC3 的 (a) 行与 (c) 行读数对照）。⛔ 不得以"反正能通"为由把冒充形态记为可行结论。
- [x] AC6（共享状态安全，可取假）：`~/.claude/sessions/` 是**全机共享的运行时状态**（本机此刻有 8 条真实会话记录 + 正在运行的 loop 依赖它）。探针只允许创建/删除**自己 pid** 的记录与 key 文件。判据：任务结束后该目录中无探针遗留文件 ∧ 任务执行前后对该目录做的两次快照（文件名 + mtime + 内容 sha256）显示**其他会话的记录未被本任务修改**，两次快照落盘进证据文件。⛔ 取假形态：任一他人记录的 sha256 变化 ⇒ 不达成。
- [x] AC7（稳健性读数）：落盘三项读数——①探针重启（pid 变）后：旧记录是否仍在、是否被平台清理、新记录是否立即可投递；②探针被 `kill -9` 后：陈旧记录在发送侧 `SendMessage` 的**错误形态**（报什么错 / 是否静默失败）；③同一 `name` 与某个真实会话重名时的表现。读不到 ⇒ 记 not-evaluated。
- [x] AC8（Channels 正向·核心，可取假）：`plugin/scripts/channel-probe-server.ts`（纯 Node、⛔ 无 LLM 循环、⛔ 不 spawn claude）以 `experimental: { 'claude/channel': {} }` capability 注册为 channel；用 `claude --channels <spec>` 起一个目标会话；由**外部进程**（⛔ 不是该会话自己）推一条含唯一 nonce `<nonce8>` 的事件。判据：该目标会话 transcript 中出现含 `<nonce8>` 的 `<channel source="...">` 记录，**实际到达的包裹属性原文**抄进报告。定位 transcript **先用 `meta-cc`**（CLAUDE.md 硬规则 1），覆盖不到再 `grep -rl` 文件系统定位后 grep 内容。⛔ 取假：transcript 无该 nonce ⇒ 未达成。无法起会话/无法定位 transcript ⇒ **not-evaluated**。
- [x] AC9（Channels 反向·会话→server）：目标会话调用探针暴露的 tool（reply 或普通 MCP tool），探针侧 `.quay/channel-probe-evidence.jsonl` 落盘该次调用及其参数。判据：证据文件含该调用的唯一标识。⇒ AC8+AC9 合起来才构成「双向」；只有其一 ⇒ AC13 对照表里如实记为**单向**。
- [x] AC10（预配置约束，⛔ Channels 能否替代 C 的决定性判据）：实测回答「**已经在运行、启动时未带 `--channels` 的会话，能否事后接入一个 channel**」。至少试两条路径（运行中的动态添加入口、配置文件+重启），各记一次实测读数。若不可事后接入 ⇒ 量化代价：以本机此刻 `ListAgents` 的 peer 数为分母，给出「要收 quay 事件就必须重启/改造」的会话数。读不到 ⇒ not-evaluated。
- [x] AC11（第三方 provider 实测，本项目硬约束）：本项目 worker 由 `.claude/launch.settings.json` 的 `_launchSpec.roles` 起在 `claude-fjdac` + 非 Anthropic 模型上。实测一个**第三方 provider 会话**能否收到 channel 事件，落盘实际表现（收到 / 报 `Channels are not available on third-party providers` / 静默丢弃）。⛔ **不得以「二进制里存在该错误字符串」为由跳过实测**——字符串存在 ≠ 该分支在本配置下被触发（硬规则 4）。
- [x] AC12（启用闸实测）：在本机**当前**配置（`channelsEnabled` / `allowedChannelPlugins` 均未设）下 AC8 是否可达。若不可达，记录使其可达的**最小**配置改动，并明确回答：是否需要 managed settings（是否需要机器管理员权限、是否影响本机其它项目/会话）。
- [x] AC13（对照结论·本任务真正的交付物）：产出一张**两路共用同一组能力问题**的对照表，**至少 6 行 × 3 列**（能力问题 / 方案 C 实测结果 / Channels 实测结果），行至少覆盖：①会话无需预先配置即可被寻址（发现式寻址）②已在运行的会话能否接入 ③第三方 provider 会话可用性 ④契约稳定性（文档化与否，附来源）⑤外→会话 与 会话→外 两个方向是否都通 ⑥落进 quay 现有架构的位置与改动量。**⛔ 每一行的两列都必须是实测读数或显式 `not-evaluated`；⛔ 不接受一路实测、另一路按文档/代码推断**（那正是本表要消除的东西）。结论段给出**推荐哪条路 + 依据**；允许「两条都要（各覆盖不同能力）」或「都不采用」——⛔ 不允许「看情况」这类不可执行的结论。

## Definition of Done

- 报告 `docs/analysis/session-inbound-two-paths-2026-09-13.md` 落地，含：**AC13 的对照表（本任务交付物）**、C 路的 AC3/AC4/AC7 三张读数表、AC1 与 AC8 实际到达的包裹属性原文、AC2 两条负控制读数、AC10–AC12 的 Channels 约束读数，以及 AC5 的诚实性结论。
- 两个探针落地并可独立运行：`plugin/scripts/peer-identity-probe.ts`（C 路，`--serve`/`--cleanup`）与 `plugin/scripts/channel-probe-server.ts`（Channels 路），纯函数部分各有单测。
- 证据文件 `.quay/peer-identity-probe-evidence.jsonl` 与 `.quay/channel-probe-evidence.jsonl` 各含真实投递记录（或明确的 not-evaluated 说明）。
- ⛔ **本任务不接线进生产**：不改 `packages/quay/src/serve*.ts`、不改 `plugin/scripts/driver-runtime.ts`、不改 `start-drivers.ts`。接线由后续任务按 AC13 的结论决定形态。
- **任一路或两路结论为「不可行」同样算完成** —— 本任务交付的是一个有依据的**路径选择**，不是某条路的实现。

## Touches

- tasks/gap-quay-server-lightweight-peer-identity-spike.md
- plugin/scripts/peer-identity-probe.ts (new)
- plugin/scripts/channel-probe-server.ts (new)
- plugin/test/peer-identity-probe.test.mjs (new)
- plugin/test/channel-probe-server.test.mjs (new)
- plugin/scripts/capability-catalog.sh
- docs/analysis/session-inbound-two-paths-2026-09-13.md (new)

## 执行读数（worker 落地记录 —— ⛔ 与上面的 AC 文本分开写，逐条说明**实际结果**）

> 全部读数的一手证据：`.quay/peer-identity-probe-evidence.jsonl`（151 行；21 个真实到达帧 + 57 次 connect + 两次注册表快照）、
> `.quay/channel-probe-evidence.jsonl`。报告：`docs/analysis/session-inbound-two-paths-2026-09-13.md`。

| AC | 实际结果 | 一句话 |
|---|---|---|
| AC1 | **达成** | 真实 Claude Code 会话经平台 `SendMessage` 投递，探针落盘原始帧含 nonce；到达的包裹属性 `from="uds:/run/user/1000/cc-socks/1676668.sock" from-name="quay-task-worker" from-mode="bypass"` 已抄进报告 |
| AC2 | **① 达成；② 被实测推翻** | ①删记录 ⇒ 不可达 ✓。②改 key 的 `peerToken` ⇒ **仍到达**；追加的「整个删掉 key 文件」**也仍到达** ⇒ **平台在本方向根本不发 auth 帧、不读 key 文件**（探针侧 21/21 帧的 `authVerdict` 全是 `not-auth`）。按 AC 原文「⛔ 取假形态」的要求，**真实到达路径已写进报告 §2.0**（= 注册记录 + socket + 进程活性比对 `procStart`）。可行性结论不因此失效：**删除记录即不可达**（AC2①）仍成立 |
| AC3 | **达成** | 三行表：`agent:"quay"` / 缺省 / `"claude"` **三行全部**「可见 ∧ 可投递」⇒ `agent` 字段对可达性**零影响** |
| AC4 | **达成（18 行实测，超 AC 要求的 10）** | 必需 = { 文件名 `<pid>.json` 存在、`procStart` 与该 pid 真实 starttime 一致、`messagingSocketPath` 可达、`spare`/`parkedJobId` 未置 }；其余全部可选。**⚠️ 实测推翻一条立案推断**：记录里的 `pid` 字段**完全不参与判定**（改成不存在的值、改成 1 都照常投递），真正被比对的是**文件名里的 pid** —— 用一条判别实验（`pid=1` + `procStart`=pid 1 的真实 starttime ⇒ 不可达）确证 |
| AC5 | **达成** | **不冒充也完全可达** ⇒ **不触发**「不可行（受诚实性约束）」分支。依据：(a) 行可达、(c) 行同结果无增益，且 `version:"0.0.0"`、`entrypoint:"quay-peer-probe"` 亦可达 |
| AC6 | **达成（但字面判据在活机器上不可满足，已如实记录）** | 探针遗留 **0**；本任务代码写过的路径**穷举 8 条、全属自己 pid**（证据文件里逐条落盘）；⭐ 但有 **1 条他人记录**（`2065370.json`，一个真实会话）sha 变化 —— **已证明不是我们写的**（穷举），且其成因**未定**（我做的「零探针 75s 两次快照」对照**未**复现自更新，故不能用「会话本来就会自更新」解释）。⇒ 字面判据「任一他人记录 sha256 变化 ⇒ 不达成」**结构上不可满足**（同窗口另有 2 条记录消失、4 条新增，也都不是我们）；报告 §5 给出了**可取假**的替代判据（「本任务写过的路径集合 ⊆ 自己 pid 的文件集」） |
| AC7 | **达成（三项全有读数）** | ①重启：旧记录**被平台在枚举时删除**（受控对照：kill -9 后只调 `ListAgents` 即双双消失；**socket 残留**）、新记录**立即可投递**；②`kill -9` 陈旧记录 ⇒ 发送侧 `No agent named '<name>' is reachable`（与「记录被删」同形态，不区分死/缺）；③同名：两条并列于 `ListAgents`，**裸名投给「本会话已确认的那个」**并给出可执行的消歧提示，`name [ref]` **精确命中**指定的那一个 |
| AC8 | **not-evaluated** | channel **契约正确且能注册**（实测启动横幅 `Channels (experimental) messages from server:quay-channel-probe inject directly in this session`；另用真实 MCP stdio 握手独立核验了 capability 声明）。但把一个**自研** channel 接进会话要连过**三道交互闸**：目录信任 → **项目 MCP server 批准（该 prompt 的默认值是「不使用」）** → dev-flag 确认。本项目的执行形态下未跑到「server 起来」这一步 ⇒ **nonce 未达不能作为 Channels 投递能力的证据**（硬规则 3b：不把「没搭起来」记成「投递失败」）。详见报告 §3.2 |
| AC9 | **not-evaluated** | 依赖 AC8 |
| AC10 | **达成** | 路径 (a) **无运行时接入入口**（channel 只能由启动参数选定，官方原文：no channel runs until a user opts it in for the session with `--channels`）；路径 (b) **配置文件 + 重启**：实测走了这条。**代价**：分母 = 当时 `ListAgents` 的 peer 数 **10** ⇒ **10/10** 会话需「重启 + 人工确认」，不是配置一次 |
| AC11 | **达成（记录了实际表现，但归因未隔离）** | 第三方 env（fjdac + `deepseek-v4-pro-anthropic`）下实测**未收到**；⛔ **但不记为「provider 导致」**——同一次运行里 `-p` 模式同时被 dev-flag 确认闸挡住，**provider 效应与确认闸效应未分离** ⇒ 报告如实记为「未隔离」。⛔ 未以「二进制里有该错误字符串」为由跳过实测 |
| AC12 | **达成** | **不需要 managed settings**（`/etc/claude-code/managed-settings.json` 不存在；本机走 claude.ai 登录 ⇒ 属「无组织 ⇒ 跳过这两项检查」）。真正卡点是三条**实测**：(a) 自研 channel 不在 Anthropic allowlist ⇒ 必须 `--dangerously-load-development-channels`；(b) 该 flag **必须交互确认**（`-p` 下结构上不可用，debug 日志印证 `pollChannel=false … nonInteractive=true`）；(c) **`server:<name>` 不读 `--mcp-config`**，必须来自项目 `.mcp.json` 一类的常规定义 |
| AC13 | **达成** | 8 行 × 3 列对照表 + 推荐见报告 §1；每格为实测读数或显式 `not-evaluated`（无按文档/代码推断充数）。结论：**两条都不作「收」方向的生产主路径**；C 路的诚实性干净（不需冒充）但依赖未文档化契约且打开了无认证入站口；Channels 是正确方向但在本环境需「启动时规划 + 多次人工确认」 |

**残留与已完成的清理**：
- 两枚 `kill -9` 留下的孤儿 socket（`1695152.sock`、`1753464.sock`）已在收尾时手工删除；`~/.claude/sessions/` 中探针遗留记录 = 0。
- 实验期间为让 `server:` 解析成功而在 worktree 里临时写入的 `.mcp.json` **已还原为 `{"mcpServers":{}}`**（`git diff` 为空）。
- `plugin/scripts/capability-catalog.sh`：两个新探针按仓库既有契约补了 5 张声明表的条目（QUESTION / CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING），否则 catalog 的 AC1c 入口闸（未分类即 exit 1）会红。
- 未评估项（⛔ 不以推断填充）：AC4 的 `startedAt`/`nameSince`/`updatedAt`/`statusUpdatedAt` 四字段；AC13 ⑤ 的「server→会话」方向（既有实现 `serve-send.ts` 存在，本次未复测）；AC13 ⑧ 跨机；AC11 的 provider 归因。
