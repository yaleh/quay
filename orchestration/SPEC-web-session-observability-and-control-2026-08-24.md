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

### 2.2 `claude agents --json`（官方 CLI，本会话今日实测）

- `kind`/`status`/`pid`/`sessionId`/`name`/`cwd`/`startedAt` 逐条给出，**仅覆盖交互式会话**。
- **结构性排除 `-p` 会话**：`claude --bg --print` 报错
  `"--bg and --print conflict: --print never starts the interactive session that claude agents
  attaches to, so the job would be unattachable."`——不是遗漏，是设计如此（无 TUI 可附着）。
- `--all` 加 "completed background sessions"，但仅指 `--bg` 派生的后台会话，
  **实测未见任何 `-p`/print 或已结束会话**（本会话 `--all` 实跑 7 条，全为当前存活 interactive）。

### 2.3 `-p`/headless 会话的可观测性——唯一路径是 transcript 文件本身

- 无论 `claude agents --json` 或 `~/.claude/sessions/`，**`-p` 会话都不在任何"活体登记表"里**
  （`~/.claude/sessions/<pid>.json` 确实也给 `-p` 会话写，但发现它需要先知道 pid——
  `-p` 进程本身若不是本项目自己 spawn 的，没有独立发现入口）。
- 因此：**要观测一个 `-p` 会话，必须在 spawn 时就记下它的 session id**（或至少 pid），
  否则事后唯一能做的是扫描 `~/.claude/projects/<hash>/*.jsonl` 的 mtime 猜"最近"，不可靠。
- `gap-worker-task-transcript-access-webui` 的 AC1（`worker-driver.ts` spawn 时传
  `--session-id <uuid>` 并把它写进 `worker-outcome.jsonl`）**正是这个通用问题在 worker 场景下的解**——
  本 SPEC 建议把该模式当作**通用契约**，不只是 worker 专属：任何本项目 spawn 的会话，
  spawn 点都应现生成 `--session-id` 并落一条可查记录（下方 §4.1 展开）。

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
| `-p`/headless·运行中 | **必须在 spawn 时记录 session id**（`--session-id <uuid>` + 落一条 dispatch 记录） | 结构性限制，`claude agents --json` 天然不覆盖（§2.3），无法绕过 |
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
