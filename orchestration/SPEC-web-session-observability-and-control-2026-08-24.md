# SPEC：quay web server 的通用 Claude Code 会话观测 + 消息投递 + 生命周期管理

**status**: proposal（本文件是 manager 豁免面内文档，非产品代码；实现归 inner，立案/派发归 outer）
**date**: 2026-08-24
**author**: manager（本会话，2026-08-24T16:2x-16:47Z 独立调研 + 人当场裁定三条开放问题）

## 0. 动机（人原话，2026-08-24）

> 讨论如何在 quay web server 中实现一个通用的观察 Claude Code 会话以及向其发送消息的能力。
> - 以尽可能接近 Claude Code web 端的形态观察 Claude Code 会话——包括运行中的和已结束的，
>   包括以交互式方式运行和以 `-p` 参数模式运行的
> - 向运行中的 Claude Code 会话发送消息——用本项目已验证的向 Claude Code 执行 SendMessage 的能力
> - 修改现有 web sessions 页，以提供本项目 Claude Code 会话列表——包括运行中的和已结束的
> - 提供更强的会话管理能力——可创建/停止/重启会话

三个开放问题人已当场裁定（§1），本文件据此定形。

## 1. 三条已裁定的开放问题（人 2026-08-24T16:4xZ，逐字/转述）

| # | 问题 | 裁定 |
|---|---|---|
| ① | web server 无鉴权、默认绑 `0.0.0.0`（`serve.ts:189-194`，人称 QX-038，已有意为之）——本功能会新增读 transcript / 注入消息 / 控制进程，是否要先补鉴权？ | **不阻塞**——按现状（无鉴权、0.0.0.0）推进，记为已知缺口，不作为本功能的前置。 |
| ② | 与刚立案的 `gap-worker-task-transcript-access-webui`（worker-only 范围，已 ready）范围重叠，如何排序？ | **先落地那条窄范围任务，再泛化**——按同一 session-id 机制扩展，不现在扩大那条任务的范围。 |
| ③ | 向【本 web server 未曾亲自 spawn 的】既有会话（manager/outer/inner、人手起的会话）发消息，用的是 `send-to-session.ts` 的 peerToken 路径——此前的人裁定只覆盖 own-child；是否扩大授权？ | **明确扩大授权**（人原话：「本项目现有实现可以向本机任意 Claude Code 会话。这已经验证，我也明确授权。」）——`send-to-session.ts` 面向**本机任意会话**，不限 own-child。 |

**⊢ ③ 的裁定范围**：扩大的是"对象"（可以是任意本机会话，不限自己 spawn 的子进程），**不改变该机制本身已有的身份声明形态**（`from-mode="bypass"` 自报，非平台验证盖印——§3.3 见下）。

## 2. 现状盘点（本会话直读代码 + 3 个 Explore 子代理独立核实，均带 file:line）

### 2.1 `/sessions` 页已存在，是真实起点而非空白

- 路由：`GET /sessions` → `handleSessions`（`serve-handlers.ts:3473`，实现 `:3125`）。
- 数据源 `readSessions`（`observation.ts:2493-2536`）：跑 `session-liveness.sh --once --json` 取
  `{name, alive, pid, halted}` 逐行；对每个 alive+有 pid 的会话再跑
  `session-liveness.sh --resolve-transcript <name> <root> <pid>` 解出 transcript 路径，
  `readTranscriptTail()`（`observation.ts:2448-2490`，读尾部 200KB）取最近 3 条 user/assistant 消息。
- 渲染 `renderSessionsPage`（`serve-handlers.ts:3079-3123`）按 `SESSION_LAYERS`
  （`observation.ts:2427-2432`，按名字子串分 Manager/Outer/Inner/Other）分组卡片。
- **发现方式（session-liveness.sh 内部链）**：tmux 窗口名 → `#{pane_pid}`（+ 子进程 `pgrep -P`）
  → `~/.claude/sessions/<pid>.json`（Claude Code 自己维护的 pid→sessionId 权威映射）
  → `~/.claude/projects/<slug>/<sessionId>.jsonl`。
- **局限（本次调研新发现，非文档已知）**：只覆盖固定的 3 个角色名（Manager/Outer/Inner），
  只覆盖**当前活着**的会话（`alive` 布尔），**不覆盖 `-p`/headless、不覆盖已结束会话**。
  **⚠️ 这条局限是【本页面的】，不是 Claude Code 的**——它源于 `readSessions` 用
  `buildManagerSessionTargets` 只注册三个角色名，**⛔ 不要与 §2.2 那条被推翻的
  「`claude agents --json` 不覆盖 `-p`」混为一谈**（后者是错的，本条是对的）。
  **⇒ 恰恰因为平台侧覆盖 `-p`，本页面的这条局限是【可以修的】，不是结构性的。**

### 2.2 `claude agents --json`（官方 CLI）

> **🔴 2026-08-24T17:0xZ 本节原内容【错误】，已由实测推翻——原文与更正一并保留（硬规则：认账不删账）。**
>
> **原断言（错）**：「仅覆盖交互式会话」「**结构性排除 `-p` 会话**」。
> **原推理（错在哪）**：我跑 `claude -p "…" --bg` 得到报错
> `"--bg and --print conflict: --print never starts the interactive session that claude agents
> attaches to, so the job would be unattachable."`，**据此推出「`-p` 会话不进登记表」**。
> **⇒ 那条报错说的是 `--bg` 不能【附着】一个 print 会话，与「`-p` 会话是否【注册】」是两件事**
> （硬规则 C28 方向 A：谓词问的不是被问的那个问题）。
> **⇒ 且我当时手里就有反证没去看**：同一份 `claude agents --json` 输出里的
> `quay-task-worker` 条目，其 argv 逐字含 `-p`（`worker-driver.ts:613 launchArgv` 构造
> `quay-launch.sh <role> -p <prompt>`）——**生产中的 `-p` 会话一直在那份清单里，我却在同一屏输出上断言它们不在**。
> **⇒ 硬规则 4 推论四的教科书实例：一个能解释现象的说法（报错 ⇒ 不支持）不是一个被检验的结论；
> 而推翻它只要一条命令。**

**实测更正（2026-08-24T17:0xZ，干净针）**：起一个 `-p --input-format stream-json` 会话（`/tmp` cwd，
throwaway），同时查三个面：
```
claude agents --json          ⇒ 命中：{pid:300596, kind:"interactive", sessionId:"4cf8ed4a-…", name:"tmp-7b"}
ListAgents（本会话工具）       ⇒ 命中：tmp-07 列为 peer session（即 SendMessage 可寻址）
~/.claude/sessions/<pid>.json ⇒ 存在，且 messagingSocketPath 有值（socket=YES）
负控制：同刻 6 个生产 `-p` 进程（ps argv 含 `-p`）全部出现在 agents --json
```
**⇒ 正确结论：`-p` 会话【与交互式会话同等注册】**——同样进 `claude agents --json`（`kind` 字段值也是
`"interactive"`，该字段不区分 print/interactive）、同样进 `ListAgents`、同样有 messaging socket。
**⇒ §2.3 与 §3.1 中一切基于「`-p` 不可发现」的推论随之作废，已重写。**

### 2.3 `-p`/headless 会话的可观测性（**已按 §2.2 更正重写**）

- **活体发现：与交互式同路**（`claude agents --json` / `ListAgents` / `~/.claude/sessions/<pid>.json`），
  §2.2 已实测。**⇒ 不需要"必须自己记 session id 才能发现"** ——那是原版基于错误前提的结论。
- **`--session-id <uuid>` 仍然值得在 spawn 时钉，但理由变了**：不再是"否则发现不了"，而是
  **①把「哪个任务/哪次派发」与「哪个 transcript」的关联做成【机械可查】而非【按时间猜】**
  （`claude agents --json` 只告诉你"现在有哪些会话"，答不了"上周那次 X 任务的会话是哪个"）；
  **②会话结束后登记表条目消失**（§2.4），届时只剩 transcript 文件，没有预先记下的 id 就只能按 mtime 猜。
- `gap-worker-task-transcript-access-webui` 的 AC1 因此仍然成立、仍建议升为通用契约（§4.1），
  **只是它解决的是【历史可追溯】而非【活体可发现】。**

### 2.4 已结束会话——无登记表，只能扫 transcript 目录

- `~/.claude/projects/<hash>/` 下每个 `.jsonl` 都是一个（活或死的）会话的完整记录，
  **文件本身不区分死活**——死活要么靠外部记录（pid 是否还在 `/proc`），要么干脆不关心
  （"已结束会话观测"本来就该覆盖这两种情况都能看）。
- 本项目 project-hash 固定（单一 workspace），扫描面是已知、有限的目录，不需要跨项目发现。

### 2.5 消息投递机制——已验证、已落地、非空想（`plugin/scripts/send-to-session.ts`）

- 139 行纯 Node 脚本，落地提交 `62853261`（2026-08-15），不依赖 Claude Code SDK。
- **协议**（脚本头注释，2026-08-15 实测确认 Claude Code 2.1.233，`send-to-session.ts:1-21`）：
  ```
  连接 ~/.claude/sessions/<pid>.json 的 messagingSocketPath（unix domain socket）
  第一行：{"type":"auth","token":"<peerToken 或 childToken>"}
  第二行：{"type":"user","message":{"role":"user","content":"<文本>"}}
  socket 返回 0 字节（fire-and-forget，无 ack）
  ```
- **两种身份模式**：`--token <childToken>`（own-child，直接投递不 hold）
  vs 默认读 `.key` 文件的 `peerToken`（**对端进 hold-for-approval 队列**，不是无声执行）。
- **端到端验证过 3 次**（`SPEC-unified-driver-architecture-2026-08-23.md:306-318`）：
  真实 headless `-p` worker 收到注入指令、执行、并用它自己的 SendMessage 回复；
  `--self` 自发自收；本 SPEC 作者当场复测收到真实 `<cross-session-message>` 帧。
- **身份声明形态（人 2026-08-23 已定性，本次 §1③ 只是扩大适用对象，不改这条）**：
  `from-mode="bypass"` 由脚本自己写入消息帧，**不经平台投递层验证盖印**——
  这是该通道的结构性特征（能连上目标 socket + 读到目标 token 本身就是权限边界，
  `.key` 文件 600 权限仅本 OS 用户可读），不是缺陷，但**读者需要知道**：
  收到消息的会话侧无法从消息本身区分"真的另一个 bypass 会话发的"与
  "一个知道协议的脚本发的"——对端若据此做权限相关判断会被这一事实影响。
  **本次人的裁定（§1③）是在知晓这条的前提下，明确把使用对象从 own-child 扩大到本机任意会话。**

### 2.6 会话生命周期管理——两套完全不同、成熟度差异大的机制

- **headless driver 管的两个 kind（promotion/worker）**：`quay driver <start|stop|drain|status|restart>
  --kind <promotion|worker>`（`packages/quay/src/cli/driver.ts`），底层 `promotion-driver-launch.sh`
  的 supervisor（`setsid nohup` 自守护 + 固定间隔重拉 + `.stop` 哨兵）。**成熟、已生产验证**：
  `stop` 硬杀 supervisor+driver 但不碰 worker 在飞子进程；`drain` 只挡新派发（写
  `worker-control.json` `halted:true`），两者语义清晰分离且已文档化。
- **交互式会话（manager/outer/inner）**：**没有程序化生命周期管理**，只有 tmux 窗口放置脚本
  （`quay-topology.sh`/`manager-start.sh`），用于冷启动/拓扑搭建，不是"随时创建/停止/重启任意会话"的
  通用 API。这一类的"生命周期管理"目前 = 人手动跑脚本或 tmux 操作。
- `orchestration/SPEC-unified-driver-architecture-2026-08-23.md`（同作者，前一天）已提议把 bash
  supervisor 港成可测的 TS driver-kernel，**status 仍是 proposal，未落地**——本 SPEC 与它是同一条
  演进路径上的两级台阶，不重复设计 kernel 本体，需要时直接引用该 SPEC。

### 2.7 页面渲染约定——零客户端 JS 是反复重申的硬约定，本功能会首次打破它

- `modernistStyles()`（`serve-handlers.ts:387-389`）+ `pageStyles()` 是每页必带的 token 化样式；
  模板是纯字符串拼接 `html` 标签函数（`serve-handlers.ts:24-26`），无框架。
- **除 `/git-history` 的 d3 提交图外，全站零客户端 JS**，且多处注释明确点名这是不变式
  （如 `serve-handlers.ts:2340-2341` "pure CSS, zero client JS — the AC4 invariant"；
  `:1689` "no `<script>` anywhere (AC3)"）。
- **全站无 `setInterval`/`WebSocket`/`EventSource`/`fetch()`**——所有"实时"页面
  （`/live`/`/manager`/`/system`）的新鲜度只靠访客手动刷新页面获得。
- **本功能要求的"观测运行中的会话"若要真的接近 Claude Code web 端的实时感，
  必然需要某种轮询/推送，这是对该不变式的首次打破**——应作为一条显式决定记录，
  不应作为某个 route 的副作用悄悄引入。

## 3. 设计

### 3.1 观测（running + ended, interactive + `-p`）

**统一锚点：session id + transcript 文件**——这是唯一横跨全部四种组合都成立的量；
task id、OS pid、tmux 窗口名都只覆盖其中一部分。

**发现层（按会话类型分流，不可能统一成一条路径）**：

| 类型 | 发现方式 | 备注 |
|---|---|---|
| 交互式·运行中 | `claude agents --json`（官方，本会话今日验证） | 取代/补强 `session-liveness.sh` 的 tmux 猜测式发现——更权威、不需 tmux 前提 |
| `-p`/headless·运行中 | **同上，与交互式同路**（🔴 2026-08-24T17:0xZ 更正：本行原写「必须在 spawn 时记录 session id，`claude agents --json` 天然不覆盖」，**该断言已被实测推翻，见 §2.2**） | `--session-id` 仍建议钉，但理由是【历史可追溯】不是【活体可发现】（§2.3） |
| 任意类型·已结束 | 扫 `~/.claude/projects/<固定 hash>/*.jsonl`，按 mtime/内容判定起止时间 | 本项目单 workspace，扫描面已知、有限 |

**渲染层（"接近 Claude Code web 端"的实质要求）**：现有 `readTranscriptTail` 只取最近 3 条纯文本，
是预览级而非观测级。需要一个新的 transcript 解析器，按 `type: user/assistant/system` 分流，
把 `message.content` 的 `text`/`tool_use`/`tool_result`/`thinking` 块渲染成可折叠的工具调用/结果对，
而不是摊平成一段文字——这部分是**真正的新工作**，不是复用已有的 tail 预览。

**"运行中"的实时感（§2.7 的打破点，需要显式决定，本 SPEC 不代为决定）**：三个选项，
成本/侵入性递增，均可行：
1. `<meta http-equiv="refresh">` 定时整页刷新——零 JS，符合现有约定，体验最弱。
2. 手动刷新（保持现状，只是新增了可刷新的观测视图）——最保守。
3. 新增一个专用的 SSE/轮询端点，仅用于"运行中会话"这一个视图——打破零 JS 约定，
   体验最接近要求，但需要人明确认这是"本功能特批的例外"而非默认扩大到全站惯例。

### 3.2 消息投递

**机制**：直接复用 `send-to-session.ts` 的协议（不重新发明），web server 侧新增一个 handler
调用同等逻辑（可以是 shell 出该脚本，也可以是把它的 ~30 行核心逻辑内联成一个 TS 模块——
后者更适合被 HTTP handler 直接调用而非每次 spawn 子进程，建议内联）。

**身份模式选择（人 §1③ 已扩大授权到"本机任意会话"）**：
- 目标是**本功能自己 spawn 的会话**（若后续做"创建会话"功能）→ 用其 childToken → 直接投递。
- 目标是**任意其它本机会话**（manager/outer/inner、人手起的）→ 用其 `peerToken`（读 `.key` 文件）→
  **对端进 hold-for-approval 队列**，不是无声立即执行——这是协议本身的行为，不是本设计加的限制。
  **人的裁定是"可以对任意会话发"，没有裁定"要绕过对端的 hold-for-approval"**——两者是两件事，
  混同会把一个已裁定的授权范围悄悄扩大成另一件没问过的事，落地时需要保持这条区分。

**安全边界（人已知晓、裁定不阻塞，§1①）**：web server 目前无鉴权、绑 `0.0.0.0`——
本功能落地后，任何能访问该端口的人都能对本机任意 Claude Code 会话发消息（即使有 hold-for-approval
兜底，也是"任何人都能往队列里塞一条待批准消息"）。**已记为已知缺口，人明确裁定不作为本功能前置**；
落地时仍建议在页面上把这条风险原样标注给访问者看到（"当前无鉴权"提示），不建议静默隐藏。

### 3.3 `/sessions` 页扩展

- 保留现有分组卡片形态，扩展数据源：① `claude agents --json` 替代/补强纯 tmux 发现（交互式）；
  ② 新增"最近已结束会话"区块，来源 = §3.1 的 transcript 目录扫描，按结束时间倒序，
  不要求 `-p`/interactive 分开渲染（同一列表，用一个类型标签区分）；
  ③ 每个会话卡片如果目标是 alive 的，加一个消息投递入口（§3.2）。
- **与 `gap-worker-task-transcript-access-webui` 的关系（§1② 已裁定：先落地那条，本条随后跟进）**：
  该任务给 task 详情页加 Runs 区块 + 新端点，是"按 task 过滤"的窄视角；本条 `/sessions` 扩展是
  "按会话本身"的全量视角——**两者共享同一个底层能力（session-id → transcript 安全读取），
  应该收敛成同一个读取/鉴权函数，不要出现两份实现**（硬规则 5b 同族：修好一处 ≠ 只有一处）。
  落地顺序：worker 任务窄范围先行 → 沉淀出的 session-id 读取+路径穿越防护逻辑 → 本条复用它做泛化。

### 3.4 会话生命周期管理

- **headless driver 两个 kind**：直接暴露既有 `quay driver <verb> --kind` 到 web（新 POST 路由
  调同一 CLI 实现，不重造），成本低、机制已验证。
- **交互式会话（manager/outer/inner 及"新建一个交互式会话"）**：目前无程序化机制，
  只有 tmux 冷启动脚本。**本 SPEC 不建议现在设计这一部分**——"从 web 点一下按钮新建一个
  交互式会话"背后还是需要一个人（或另一个自动化）去驱动它，价值主张不如驱动一个 headless
  任务清楚；且"从 web 停止/重启 manager/outer/inner"在无鉴权（§1①）前提下是一个真实的
  生产风险点（任何能访问该端口的人都能杀掉正在工作的 manager）。**建议留作观察项**，
  等出现具体需求（例如"人想从手机上重启卡住的 outer"）再设计，而不是现在凭空定形态
  （硬规则⑫：给不出发生率就降观察项）。

## 4. 通用契约建议（跨越本 SPEC 与已在飞的窄范围任务）

### 4.1 「spawn 时钉 session-id」应该是通用契约，不只是 worker 专属

`gap-worker-task-transcript-access-webui` AC1 的模式（spawn 传 `--session-id <uuid>`，
落一条可查记录）**在结构上适用于本项目 spawn 的任何 Claude Code 进程**——selector、
fix-worker、未来任何新 driver kind，都应该照此办理，而不是每个 kind 各自发明一套。
本 SPEC 不建议现在就去改 selector/fix-worker 的 spawn 点（那是没人问过的额外范围），
只是记录这条通用性，供后续设计新 kind 或泛化本功能时直接复用，不必重新论证。

### 4.2 消息投递逻辑建议内联而非 shell 出脚本

`send-to-session.ts` 目前设计成一个独立可执行的诊断/工具脚本（CLI，逐次 spawn node 进程）。
web server 每次用户点"发消息"就 `spawnSync` 一次这个脚本，是可行的最小实现，但更干净的形态
是把其 socket 协议部分（约 30 行核心逻辑，`send-to-session.ts:101-129` 那段连接/写帧逻辑）
提炼成一个可 `import` 的 TS 模块，web handler 直接调用，脚本本身继续作为独立诊断工具保留
（两者共享同一个底层函数，不是两份实现）。

## 5. 非目标 / 明确排除

- 不涉及跨主机会话（Remote Control / `--cloud` / `--teleport`）——`claude-code-guide` 子代理调研
  确认这几个机制的本地端点协议未公开文档化，跨主机场景不在本次讨论范围，需要时另行调研。
- 不在本 SPEC 阶段设计 driver-kernel 本体（TS 化 supervisor）——已有独立 SPEC
  （`SPEC-unified-driver-architecture-2026-08-23.md`）在跟，避免重复设计。
- 不给出鉴权方案的具体设计——人已裁定不阻塞本功能，若后续要做，应是独立的任务/讨论。
- manager 本轮只做到"架构 + 建议"——不写任务体/AC/DoD、不改产品代码，按 CLAUDE.md D 段边界。

---

# 第二轮（2026-08-24T17:0xZ）：人追加的三个问题

人追加：①`-p` 会话能否长期等待用户输入（能 ⇒ web 启动的会话就用 `-p`，否则仍需 tmux+交互式）；
②设计更统一可重用的会话观测/交互机制，可从 Live / Tasks 多个源页面跳转；③支持用户定义多组
启动 profile（wrapper + model + env）。以下 §6–§8 逐条，**全部读实测或读代码，不引未核实的转述**。

## 6. `-p` 会话能否长驻等待输入——**能，判据已实测**

### 6.1 实测（干净针，throwaway 会话，cwd=/tmp，⛔ 未碰任何生产会话）

```
spawn: claude -p --session-id <uuid> --input-format stream-json --output-format stream-json --verbose
       stdin 保持打开（不 close），逐条写 {"type":"user","message":{...}}
[+0.0s]  → msg1                        [+11.4s] ← RESULT #1 "ONE"
[+25.1s] 存活=true；~/.claude/sessions/<pid>.json：kind=interactive socket=YES name=tmp-7b
[+25.1s] --- 静默 60s（不写任何输入）---
[+85.1s] 存活=true（⇒ 无 60s 级空闲超时）；注册表条目仍在、socket 仍在
[+85.1s] → msg2                        [+86.3s] ← RESULT #2 "TWO"（同一 session_id）
```
**⇒ 三条判据全过**：①首答后不退出 ②静默 60s 不退出 ③同一 stdin 上的第二条消息被正常处理。
**⊢ 长静默补测进行中**（15min 静默 + 末条消息，`probe-p-idle-long.mjs`）：**已过 3min 静默存活**，
末值落定后补记。**⛔ 在补测落定前，本节的可断言上界是【实测 60s 静默 + 3min 采样点】，不是"任意长"**
（硬规则：不把未测的量写成已测）。

### 6.2 与既有事实的一致性交叉验证（不止靠上面那一次实验）

- 生产 `quay-task-worker` 本来就是 `-p`（`launchArgv` 构造 `quay-launch.sh <role> -p <prompt>`），
  实测单个 worker 墙钟可达 `wall_clock_ms=814357`（≈13.6 分钟，`worker-outcome.jsonl` 真实记录）
  ⇒ **`-p` 进程长时间存活本来就是本项目每天在跑的常态**，不是新能力。
- 区别只在**输入形态**：生产 worker 用 `-p <prompt>`（一次性 prompt，跑完即退）；
  长驻交互需要 `--input-format stream-json` + **stdin 不关闭**——**后者才是"能等输入"的开关**。

### 6.3 ⇒ 对「web 页面启动的会话用什么形态」的结论

**用 `-p --input-format stream-json --output-format stream-json`，⛔ 不需要 tmux + 交互式。**

| 维度 | `-p` + stream-json（建议） | tmux + 交互式（现状用于 manager/outer/inner） |
|---|---|---|
| 能否等用户输入 | ✅ 实测可（§6.1） | ✅ 可 |
| 输入通道 | **stdin（结构化 JSON，进程直接持有）** | tmux send-keys（要 C-u 清行、要稳态轮询、要 NBSP 特判——`send-keys-reliable.sh` 355 行全在处理这些） |
| 输出通道 | **stdout stream-json（结构化，可直接渲染）** | 只能读 transcript 文件或解析 TUI（ADR-016 禁解析 TUI） |
| web server 能否直接持有 | ✅ 就是它 spawn 的子进程 | ❌ 要经 tmux 这一层 |
| 依赖 tmux | ❌ 无 | ✅ 硬依赖 |
| 是否可被 SendMessage/socket 投递 | ✅（§7.3） | ✅ |

**⊢ 决定性理由不是"两者都能等输入"，是【输入/输出通道的形态】**：`-p` + stream-json 给 web server
一个**双向结构化管道**（写 JSON、读 JSON），而 tmux 路径给的是**键盘模拟 + 屏幕**，
后者已经在本项目里长出了 355 行的可靠性补丁（清行/稳态/NBSP/重发/三态退出码）
**且结构上无法覆盖非 tmux 目标**。**⇒ 新建面选 `-p`，是选一个不需要那 355 行的通道。**

**⊢ tmux 路径【不退役】**：manager/outer/inner 三个长驻人机会话仍在 tmux 里，
**它们不是本功能新建的**；本结论只约束"**web 页面新建的**会话"。

### 6.4 一条必须一并设计的约束：`-p` 会话的权限模式

`-p` 会话没有 TUI，**没有地方弹权限确认框**。生产 worker 靠 `permissions.defaultMode=bypassPermissions`
（`launch.settings.json:3-5`）绕开。⇒ web 新建会话必须**显式选定权限模式**并**在页面上显示它**，
⛔ 不得沉默地继承 bypass——否则"从 web 起一个会话"= 静默起一个全权限 agent。
**这是 profile 的一个必填字段（§8），不是实现细节。**

## 7. 统一、可重用的会话观测/交互机制

### 7.1 核心设计：一个会话视图，一个寻址键，多个入口

**寻址键 = `sessionId`（UUID），⛔ 不用 pid、⛔ 不用 task id、⛔ 不用 transcript 路径。**
理由逐条：pid 会复用且进程退出即失效；task id 一对多（重派 N 次）；
**transcript 路径若进 URL 就是路径穿越面**（§7.4）。sessionId 是唯一横跨"活/死 × 交互式/`-p`"都稳定的量。

```
路由： /session/<sessionId>            ← 唯一会话视图（活的、死的、交互式、-p 全用它）
入口： /sessions   列表 → 每张卡片链到它
      /live       在飞行 → 该任务当前 worker 的会话
      /task/<id>  Runs 区块 → 该任务历次尝试各自的会话
      /manager    会话表 → 同 /sessions
```
**⇒ "可从多个源页面跳转"不需要每个页面各做一套**：它们只需要各自算出一个 `sessionId` 然后链过去。

### 7.2 每个入口缺什么（已逐条读代码核实，附最小改动量）

| 入口 | 现状 | 缺口 | 最小改动 |
|---|---|---|---|
| `/sessions` | 已渲染 `s.pid`（`serve-handlers.ts:3092`） | 有 pid 无 sessionId | pid → `~/.claude/sessions/<pid>.json` 已有解析器（`session-liveness.sh --resolve-transcript`），取 sessionId 即可 |
| `/live` | `InFlightTask`（`observation.ts:89-127`）**无 pid 字段** | **pid 被读了又丢**：`readLiveWorkerProcesses`（`observation.ts:665-690`）`:686` 用 `e`（pid）算完 start time 后**只 push `{taskId, startedAtMs}`** | `LiveWorker` 加 `pid`、`:686` push 带上、`readLive` `:843-853` 透传 ⇒ **3 行** |
| `/task/<id>` | **完全没读 worker-outcome**（`serve-handlers.ts:1349-1420` 只有 `client.taskGet`，全文件 grep `worker-outcome` = 0 命中） | 无 Runs 区块；且 handler **没有 `cfg` 参数**拿不到 workspaceRoot | 路由 `:3548-3553` 照 `/goal/:id`（`:3529-3533`）加 `cfg`；`parseWorkerOutcomeRecords`（`observation.ts:563-578`）**当前只取 4 个字段，而磁盘上每条有 14 个**——`worker_pid` 就在磁盘上但被丢弃 ⇒ 加 `session_id`/`worker_pid` 两个字段即可 |

**⊢ 一条关键实测（决定 Runs 区块能不能做历史追溯）**：`.quay/worker-outcome.jsonl` 真实字段有
`ts/task/selector_reason/exit_code/signal/wall_clock_ms/final_state/failure_reason/started_at/ended_at/`
**`worker_pid`**`/run_id/in_flight_count/timed_out` —— **`worker_pid` 已经在盘上了**，
只是 parser 没读。**但 pid 在进程退出后无法反查 sessionId**（`~/.claude/sessions/<pid>.json` 随进程删除）
⇒ **历史追溯仍然必须靠 spawn 时钉 `--session-id` 并写进 outcome**（= `gap-worker-task-transcript-access-webui` AC1）。
**⊢ 亦即：`worker_pid` 对【在飞】够用，对【历史】不够用——两者不可互替。**

**⊢ 另一条**：`run_id` **不是每次派发唯一**（实测三条不同任务的记录共享 `wk-prod-1787572144`，
它是 driver 进程启动时算一次的前缀）⇒ **⛔ 不得用 run_id 作会话寻址键**，与 §7.1 的裁定一致。

### 7.3 交互（发消息）——已实测的必要条件

**受控实验（唯一变量 = `crossSessionInbound` 设置）**：
```
A（不设该项）：SendMessage → tmp-07  ⇒ 工具返回 success:true / msg_id
               目标 transcript grep 该 marker ⇒ 【0 命中】       ← 未送达
B（--settings '{"crossSessionInbound":"accept"}'）：
   send-to-session.ts --pid <pid> "<marker> …"（peerToken 路径，纯 Node 进程发）
               目标 transcript grep 该 marker ⇒ 【4 命中】
               且该会话【真的处理了它】：RESULT #2 = "Received cross-session probe message —
               session is active and ready. No action required."   ← 送达且被消费
```
**⇒ 正向路径证成**：一个**不是 Claude Code 会话的普通 Node 进程**（正是 web server 的处境）
可以把消息投进一个 `-p` 会话并被真正处理。**这正是本功能需要的能力，已端到端实测。**

**🟢 2026-08-24T17:2xZ 更新——A 的失败原因【已由平台自己告知】，不再是未定项。**
本文原写「A 的失败原因未定（可能是设置/可能是 hold 队列/可能是 idle 不排空 inbox）」。
随后平台向发送方（我）投回两条投递回执：
```
[Cross-session delivery notice] ... held for the recipient user's approval
                                (recipient: uds:/run/user/1000/cc-socks/312474.sock)
[Cross-session delivery notice] ... not approved before expiry — Not delivered to that session's Claude.
```
（`312474` = A 组那个长静默探针的 pid，socket 逐字对上。）
**⇒ A 的真实形态是【held for approval → 到期未批准 → 丢弃】，不是"静默无视"、不是"inbox 不排空"。**
**⇒ 三个候选成因里 2 个被排除，剩下的正是 `crossSessionInbound` 那一个。**

**⊢ 对照的受控程度也随之提高**（比我原先的自评更强）：A 与 B **发送方身份类别相同**
（都是 peer 身份：A=SendMessage 的 peer 投递，B=`send-to-session.ts` 的 `peerToken` 路径），
**差的是接收方的 `crossSessionInbound` 设置** ⇒ **同身份类别 + 切设置 ⇒ held/expired vs delivered/consumed**。
**⚠️ 仍有一个未消的差异：传输通道（工具 vs 脚本）。** ⇒ **仍不写"充要条件"**，
但可以写：**`crossSessionInbound:accept` 是【当前唯一未被排除】的成因，且方向与文档一致。**
落地前那次单变量对照仍建议补（成本 60 秒），**但它现在是【确认】而非【探明】。**

**🔴 这条回执还暴露了一个必须写进设计的产品事实（比上面的归因更重要）**：
```
SendMessage 返回 success:true + msg_id   ≠   已送达
真实状态机至少有四态：  已发送 → 待接收方批准(held) → 到期未批准(expired,丢弃)
                                            ↘ 已批准 → 送达并被消费
```
**⇒ 调用点拿到的 `success:true` 与【最终没送到】完全同形**（硬规则 3b 的教科书形态：
"失败"与"合格"共用一个返回值），**而真相是【异步、事后、经另一条回执通道】才到达发送方的。**
**⇒ 对 web UI 的硬要求（⛔ 不可省）**：
- **⛔ 页面不得在 POST 成功后显示"已发送给 X"** —— 那是把 `success:true` 当送达，会稳定地骗用户。
- **必须显示真实状态**：`待对方批准` / `已送达` / `到期未批准（未送达）`，并**保留回执**。
- **⊢ 这恰好也解释了为什么 §6.4（权限）与本条要一起设计**：向一个**你没启动的**会话发消息，
  接收方那侧是要**人去批准**的；而向**web server 自己启动的**会话（可在 spawn 时设 accept）则直通。
  **⇒ 两类目标的用户体验本质不同，页面必须区分呈现，⛔ 不要做成一个统一的"发送"按钮然后假装都一样。**

**⊢ 安全注记（人 2026-08-24 已扩大授权到"本机任意会话"，见 §1③）**：`send-to-session.ts` 的
`from-mode="bypass"` 是**发送方自写**、非平台盖印（`send-to-session.ts:24-34` 自带该警告）。
本功能落地后，web server 将以该形态向本机会话投递。**人已在知晓此形态的前提下授权**；
**⛔ 但仍不得把它包装成"平台验证过的身份"呈现给页面访问者**——页面应如实显示"由 quay web 注入"。

### 7.4 渲染与安全

**一个渲染器覆盖全部四种会话**（实测支撑）：`-p` 会话与交互式会话的 transcript **schema 同族**——
`-p` 探针会话记录类型 `{user, assistant, attachment, queue-operation, ai-title, atis-latch, last-prompt}`，
本会话（交互式）为其超集（多 `system`/`mode`/`bridge-session`/`file-history-*`）。
**⇒ ⛔ 不要为 `-p` 单写一个渲染器。** 现有 `readTranscriptTail`（`observation.ts:2448-2491`）
只取最近 3 条纯文本、每条截 500 字符——**它是预览级，不是观测级**；
接近 Claude Code web 端需要新解析器：按 `message.content` 的 `text`/`tool_use`/`tool_result`/`thinking`
分块，工具调用与结果配对折叠。**这是本功能真正的新工作量所在**，不是复用即可。

**路径穿越（人在第一轮点名的唯一安全敏感点）——本仓库现有防护形态实测如下**：
- `/tests/file?path=`（`serve-handlers.ts:3065-3077`）**没有穿越防护，且不需要**——
  该参数**从不作为文件路径使用**，只作 `r.perFile.find(f => f.file === filePath)` 的**等值查找键**，
  真正读盘用的 `runId` 来自盘上记录而非 URL。**⇒ house pattern = 用户输入只做查找键，永不做路径分量。**
- 唯一的真·输入校验样板是 `isSafeRelativeRedirect`（`serve-handlers.ts:626-635`，含 25 行威胁模型注释，
  防 `/\evil.com` / `/\t/evil.com` 这类 WHATWG 归一化绕过）。
**⇒ `/session/<sessionId>` 应照 house pattern 办**：`^[0-9a-f-]{36}$` 严格 UUID 校验 **+ 路径固定拼
已知 project slug**，**且**（更强的一层）**先在"已发现会话集合"里查得到该 id 才渲染**——
即把它降级成查找键而非路径分量，与 `/tests/file` 同形。

## 8. 用户可定义的多组启动 profile

### 8.1 现状（读代码 + 读机器实测，非转述）

- **地基已有但很薄**：`_launchSpec.roles`（`.claude/launch.settings.json:19-65`）6 个 role，
  每个 `{name, launcher, model, env, bare?}`，由 `quay-launch.sh` 经 `jq` 消费（`:69-82`），
  `exec` 出去（`:127`）。
- **本机实存 8 个 wrapper**（`~/.local/bin/claude-*`，**均在仓库外、personal tooling**）：
  `claude-fjdac` / `claude-deepseek` / `claude-aliyun` / `claude-glm` / `claude-kimi` /
  `claude-litellm` / `claude-bobdong`（+1 个 .bak）。每个 = `source ~/.local/etc/<vendor>-api-key`
  → `export ANTHROPIC_BASE_URL=…` + 认证变量 → `exec claude "$@"`。
- **历史用过的组合（有仓库证据的）≥6 组**：`claude`(无 wrapper)+Anthropic 默认 ·
  `claude-deepseek`+`deepseek-v4-flash` · `claude-aliyun`+`qwen3.8-max-preview` ·
  `claude-fjdac`+`glm-5.3`（回退） · `claude-fjdac`+`deepseek-v4-flash` ·
  `claude-fjdac`+`deepseek-v4-pro`（当前）。**⇒ 人要求的"多组 profile"是真实历史需求，不是假想。**

### 8.2 三个必须在设计里解决的坑（全部已实测，非推测）

**坑①：认证变量分两族，且与 `--bare` 结构性冲突。**
```
claude-kimi                          ⇒ 用 ANTHROPIC_API_KEY
其余 6 个 wrapper                     ⇒ 用 ANTHROPIC_AUTH_TOKEN
其中 fjdac/aliyun/litellm/bobdong     ⇒ 还【显式把 ANTHROPIC_API_KEY 置空】
而 --bare 的认证【严格只认】 ANTHROPIC_API_KEY / apiKeyHelper（CLI --help 原文）
⇒ bare:true + 这 4 个 wrapper 中任意一个 = 100% spawn 失败
```
**这不是假想：AC142 记录的 fix-worker 13/13 全败就是它**（selector `bare:true` 3/3 null、
fix-worker `bare:true` 10/10 exit=1、task-worker 无 bare 键 3/3 通过——**一个天然的三组对照**）。
**⇒ profile schema 必须能表达并校验这条约束**（`bare:true` ⇒ 该 profile 必须提供 `ANTHROPIC_API_KEY`）。

**坑②：`bare` 现在是【或】不是【优先级】，且有一半是死配置。**
`quay-launch.sh:115` 实际是 `if [[ "$BARE" == "1" || "$ROLE_BARE" == "true" ]]` ——
**CLI 与 role 任一为真即加 `--bare`，没有任何办法为某个 role 强制关掉它**；
而**顶层 `_launchSpec.bare`（`launch.settings.json:66-70`）从头到尾没有任何代码读它**
（`grep -n bare quay-launch.sh` 只有 `roles[$r].bare` 与 CLI 两处）
⇒ **`bare.enabled:true` 是纯文档、纯死配置**。
**⊢ 比 `SPEC-unified-driver-architecture` §2.5 记的"两级且优先级无文档"更糟：一级是 inert 的。**

**坑③：同一 schema 已有【三份互相漂移的副本】。**
`.claude/launch.settings.json`（6 role，fjdac+deepseek-v4-pro，7 个 env）·
`plugin/.claude/launch.settings.json`（3 role，全 `launcher:"claude"`，3 个 env，是 quay-init 的出厂模板）·
`packages/quay/src/init.ts:303-323 generateLaunchSettingsContent()`（3 role，1 个 env，
**且注释 `:301-302` 仍写着已过时的 "claude-deepseek + deepseek-v4-flash"**）。
**⇒ profile 化若不同时收敛这三份，只会变成四份。**

**⊢ 另有一条隐式约定必须显式化**：`quay-launch.sh:98` 的
`with_entries(select(.value != ""))` —— **空字符串 = "取消继承"**（manager role 靠它取消 917k 三件套）。
而 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0"` 是字面 `"0"` 会保留。
**⇒ `""` 与 `"0"` 语义不同且仅靠一行 jq 表达，profile 化必须写成显式 `unset: [...]`**
（与 `SPEC-unified-driver-architecture:244-246` 的裁定一致）。

### 8.3 一条硬约束：秘密与端点【不能进 git】

`plugin/test/launch-settings.test.mjs:107-115` 断言 launch 配置文件里**不得出现**
`DEEPSEEK_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` 字面量，以及 `/sk-[A-Za-z0-9_-]{8,}/`。
**当前之所以能满足，正是因为 wrapper 这层间接**：仓库只写 `launcher: "claude-fjdac"` 这个**名字**，
真正的 endpoint 与 token 在仓库外的 `~/.local/bin/` + `~/.local/etc/`。
**⇒ profile 设计有且仅有两条路**：
```
(a) 继续按【名字】引用 wrapper                    ⇒ 秘密天然在外，测试不动。代价：profile 不自足，
                                                    换机器要先装 wrapper（本项目已实际踩过：跨主机验证）
(b) profile 直接写 base_url/auth 变量名 + 值来源  ⇒ 必须引入【gitignored 的凭据层】+ 放宽该测试断言，
                                                    ⛔ 不得直接放宽了事（那等于删掉唯一的防泄漏检查）
```
**本 SPEC 建议 (a) 为默认、(b) 作为可选扩展**（profile 可声明"我需要哪些 env 变量名"，
但**值**始终来自仓库外）——**理由：(b) 的收益是自足性，而代价是把项目唯一的秘密防线改成"要记得别写错"。**

### 8.4 与既有排期的关系（⛔ 不重复立条）

**profile 化已有正本与任务**：`tasks/gap-ac154-claude-code-profile-extraction.md`（status `ready`，
5 个 `depends_on` 未清）· 判据正本 `manager-phase-goal.md:60-67`（AC154）·
设计 `SPEC-unified-driver-architecture-2026-08-23.md:216-247`。
**⇒ 本节【不新立任务】，是给 AC154 补三条它没写的实测细节**：
坑②的"一级 inert"、坑③的"三份副本"、§8.3 的"秘密防线是 (a) 路线在承担"。
**⇒ 落地时按 AC154 走，本节作为其输入。**

### 8.5 profile 与本功能（web 启动会话）的接口

web "新建会话"表单需要且只需要**四个**选择：**profile**（wrapper+model+env 的具名组合）·
**权限模式**（§6.4，必须显式）· **cwd/工作区** · **`crossSessionInbound`**
（§7.3 更新后新增：**决定这个会话此后能不能被 web 直接投递消息，还是每条都要人去批准**；
⇒ 它是 profile 的一个字段，不是隐藏默认值）。
**⇒ profile 系统是本功能的前置依赖，但不是它的一部分**——本功能只消费 profile 名字。
**⊢ 若 AC154 尚未落地，本功能可先用现有 `_launchSpec.roles` 的 role 名当 profile 名**
（形态兼容，`quay-launch.sh <role>` 已经是这个接口），**AC154 落地后自然升级，⛔ 不需要重做。**

## 9. 第二轮的开放问题（留给人/outer 裁定，⛔ 我不代拍）

1. **实时性方案**（第一轮 §3.1 已列三选项，仍未裁定）：`-p` + stream-json 让"推流"变得容易得多
   （stdout 就是结构化事件流），**但零客户端 JS 的约定仍然会被打破**——决定权在人。
2. **§7.3 的单变量对照（🟢 已降级为"确认"而非"探明"** —— 平台回执已排除三个候选成因中的两个，
   见 §7.3 的 17:2xZ 更新）：落地前仍建议补一次（只切 `crossSessionInbound`，发送方固定），
   代价 = 一次 60 秒实验；**在此之前按"必须显式 accept"设计。**
3. **§8.3 的 (a)/(b) 路线**：建议 (a)，但若人要 profile 自足（换机器即用），则须先设计凭据层。
