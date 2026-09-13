# SPEC：统一 quay server —— 一进程 / 一项目 / 一信任域

**作者**：manager（会话 `quay unified server design`）｜**日期**：2026-09-13｜**状态**：proposal，**待人裁定排期**
**来源**：人 2026-09-13 三轮裁定（见 §1）+ 同日落地的 spike `gap-quay-server-lightweight-peer-identity-spike`（done）
**前置阅读**：`SPEC-unified-driver-architecture-2026-08-23.md`（driver 侧的两级抽象，已落地为 `driver-runtime.ts`）
**证据基线**：本 SPEC 的每条读数标注来源与类型——【spike 实测】/【fleet 实测】/【官方文档】/【静态读码推断】。
⛔ 未标注来源的断言不得进入本文件。

---

## 0. 一句话

**把 web、全部 driver、与运行中 Claude Code 会话的双向通信收进一个进程；一个项目空间 = 一个 quay server
实例 = 一个信任域；认证与授权在容器/项目边界上做，边界内优先效率。**

**实施顺序（裁定 ⑤）**：先**合并已有实现** → 再**服务化启停**（可单独起停任一服务）→ 再**内收 driver**
→ **最后**才加 peer endpoint 这个全新功能；且每个新能力**CLI 先行**，Web 是它的投影。

---

## 1. 人的裁定链（本 SPEC 的授权基础）

| # | 日期 | 裁定 | 对本 SPEC 的效力 |
|---|---|---|---|
| ① | 2026-09-13 | 「收」方向走**轻量 peer 身份注册**（注册进会话注册表、不带模型循环），先立可行性验证任务 | 确立 peer endpoint 为「收」的主路径候选 → spike 已 done |
| ② | 2026-09-13 | 范围改为**「C 与 Channels 双路对照」** | spike 产出对照表（§4.1 的定性即来自它） |
| ③ | 2026-09-13 | 「若必须冒充 `agent:"claude"` 才可达，**也是可以接受的**」 | 诚实性不再是否决条件；⛔ 但仍须量运行时代价（spike AC5） |
| ④ | 2026-09-13 | **接受入站无认证风险**：「这是 Claude Code 既有的风险；客观上必须有这样便于调用的组件在这一生态位，而**认证和授权机制应当在更外围**——每个持续开发项目将有自己的空间，例如一个独立的 Docker Instance，其**内部效率是优先的**」 | **确立信任模型**（§6.6）：信任边界 = 项目空间边界；边界内不做进程间认证 |
| ⑤ | 2026-09-13 | **三条实施原则**：①「先合并已有的相关实现，再增加当前未实现的相关功能」②「更灵活的启动和停止选项——仅启动部分服务、追加启动部分服务、关闭部分服务」③「增加功能时优先完善 CLI，再实现 Web」 | **重排了 §7 的全部阶段**（peer endpoint 由初稿的阶段 1 移到最后的阶段 D）；新增 §6.8（CLI 先行）/ §6.9（服务独立起停）/ §6.10（作者据 ② 补充：每服务独立健康读数） |

**⊢ ④ 的推论，必须写明**：spike 报告把「任何同用户进程都能写 `~/.claude/sessions/` 并被当作 peer」列为
**采用 C 路的反对理由**；在裁定 ④ 的信任模型下，**同一事实变成它的优点**——边界内零配置、零握手、
任意组件即插即用。本 SPEC 据此**不采纳** spike 报告「两条路都不作生产主路径」的推荐中针对 C 路的那一半，
**并保留它针对 Channels 的那一半**（§6.4）。⛔ 这是一次有意识的、有依据的推翻，不是忽略。

---

## 2. 现状盘点（实测 2026-09-13，非印象）

### 2.1 要收敛的长驻进程

| 现状 | 数量 | 实测依据 |
|---|---|---|
| driver 进程 | 6 kind × (supervisor + driver) = **12** | `.quay/{goal,meta,outer,promotion,quality,worker}-driver{,-supervisor}.pid` |
| `quay serve` | 1 | `.quay/serve.pid` |
| **合计** | **13** | —— |

代价（实测，非推演）：pid 文件散落 `.quay/`、健康判定要跨 8 张 registry 表、冷启动孤儿需人工核对
（CLAUDE.md「driver 进程管理」节记录的 `ps aux | grep quay-task-worker` 习惯性负控制即由此而来）。

### 2.2 已经统一的部分（⛔ 不要重做）

- **Layer 0/1a/1b 的代码**已统一于 `plugin/scripts/driver-runtime.ts`（supervisor / loop / trigger /
  stopCondition / heartbeat / controlPlane / notify / profile / ResultVocab）。**没统一的是进程边界，不是代码。**
- **Web 面**已相当完整：`packages/quay/src/serve-{dashboard,git,goal,tests,task,board,live,sessions,send}.ts`。
- **出站会话通信**已实现并实测到达：`serve-send.ts` 的 `sendSessionFrames`（2026-08-15 实测）。
- **会话操作面的子集**已存在：`serve-sessions.ts`（列会话 / 看 transcript / spawn / resume / driver 生命周期）、
  `observation.ts`（读会话注册表）。

### 2.3 结构性缺口

| 缺口 | 性质 |
|---|---|
| **入站「收」= 0** | 纯 Node 进程在会话网络里没有身份，没有任何东西可以被 `SendMessage` 寻址 |
| 控制面只有 worker-driver 一家 | `grep serveControlPlane(` 仅 `worker-driver.ts:4955` 一处非定义命中 |
| Core MCP server 是 stdio、每客户端一子进程 | 无共享 daemon |

---

## 3. 与 quay-fleet 的分工（⛔ 本 SPEC 最重要的一节：不重复造）

### 3.1 quay-fleet 是什么（【fleet 实测】）

独立产品，**不是 quay 的上层**：「Operate Claude Code sessions across machines and projects from a phone
or a browser — without going through Anthropic's control plane」。"fleet" 指**跨机器的会话舰队**，不是任务编队。
与 quay 是纯工具关系（用 quay 做自己的 task store / driver / gate）。

**代码实际（与文档声称有显著差距，必须按实际来规划）**：
- `packages/` 下**只有 `agent-core` 一个包**；控制面、PWA **不存在**（路线阶段 2–4 未开工）。
- **没有任何可执行入口**（`package.json` 无 `bin`/`scripts`）；`createFleetAgent()` 只在 5 个测试文件里被构造，
  **生产上没有任何进程在跑它**。它现在是**一个库 + 测试**，不是常驻服务。
- `GET /events` 是**空壳**：只发一条 `hello` 就把 res 挂进 `eventClients`，`broadcastEvent` 的唯一调用方是测试
  ——**没有任何 watcher/poller 在产生事件**。
- **没有「创建会话」端点**（七端点里无 create）。
- `GET /projects` 硬编码返回**单元素数组**（只报自己 cwd 的项目）。

### 3.2 两者方向相反 —— 所以复用的是原语层，不是分层

```
quay-fleet node-agent 的第一纪律：「只做薄包装，不做判断」，语义判定留给控制面或人
统一 quay server 的全部价值：      就是做判断（派发、判停、归因、落地）
```

⇒ **⛔ 不照搬 fleet 的四层分层**；**✅ 复用它已经踩实的读写原语与审计层**。

### 3.3 共享原语层（四个零依赖纯 `.mjs` 模块，可直接取用）

| 模块 | 它解决的问题 | 为什么不自己写 |
|---|---|---|
| `pty-frame.mjs` | PTY 帧编解码，`decodeFrames` **支持部分帧**（返回 `{frames, rest}`，永不对截断尾抛异常） | 帧边界处理是一次性写对很难、写错很隐蔽的东西 |
| `delivery-audit.mjs` | 投递审计：**成功与失败走同一条写入路径**；payload 只存 `{length, sha256_12, firstLine}` 不落原文 | 「只记成功不叫审计」这条纪律已被它结构化 |
| `session-liveness.mjs` | 活性判定：`kill(pid,0)` + `/proc/<pid>/stat` 字段 22 starttime 比对 + pidDomain namespace 校验 | pid 复用与跨 namespace 是两个必踩的坑 |
| `session-schema.mjs` | 禁折叠校验器：记录里出现顶层 `status` 字段即判 invalid | 强制 §6.7 的状态分层 |

**取用形态（待定，§9 开放问题 4）**：抽成共享包 vs vendored 复制 vs fleet 发布为 npm 包。
**⛔ 唯一不可接受的是第二份手写实现**——本仓库「两份实现 = 假」的判据在此同样适用。

### 3.4 归属表

| 能力 | 归属 | 理由 |
|---|---|---|
| 会话状态/输出的**读取原语** | 共享原语层 | 两边都要，一份实现 |
| 会话输入的**帧协议** | 共享原语层 | 同上 |
| 面向**人**的跨机会话操作（PWA、控制面、审计 UI） | quay-fleet | 它的产品定义 |
| 面向**项目内执行**的判断（派发/判停/归因/落地） | quay server | fleet 明确不做判断 |
| quay server 自己作为 **peer** 收消息 | quay server | fleet 不提供「被寻址」的身份 |

---

## 4. 会话交互的通道清单（本 SPEC 的技术基础）

### 4.1 五条通道与稳定性定性

| 能力 | 通道 | 定性 | 来源 |
|---|---|---|---|
| 会话状态 | `claude agents --json`（idle/working/needs-input/completed/failed/stopped）⚠️ **只列【运行中】会话** | **稳定契约** | 【官方文档】agent-view.md；「只列运行中」由本仓库已 done 的 `gap-webui-session-discovery-claude-agents-json` 确立 |
| 最近屏幕输出 | `claude logs <id>` —— 只给**最近终端输出**，非完整历史 | **稳定契约** | 【官方文档】agent-view.md |
| 脚本取结构化结果 | `claude -p --resume <id> --output-format json` | **稳定契约**，官方推荐给脚本 | 【官方文档】sessions.md |
| 生命周期 | `claude attach / stop / rm`（+ fleet 用到 `respawn`） | **稳定契约** | 【官方文档】agent-view.md |
| 会话间消息 | `SendMessage` / `ListAgents` | **稳定契约** | 【官方文档】cross-session-messaging.md |
| **完整 transcript** | `~/.claude/projects/<hash>/<id>.jsonl` | ⚠️ **官方明写是内部格式、版本间会变** | 【官方文档】sessions.md |
| **消息直投** | `cc-socks/<pid>.sock` 写 user 帧 | ⚠️ 部分文档化，非面向外部进程的主路径 | 【spike 实测】 |
| **peer 身份注册** | 写 `~/.claude/sessions/<pid>.json` + 监听 socket | ⚠️ **完全未文档化** | 【spike 实测】 |
| **按键注入** | `cc-daemon/.../<id>.pty.sock` DATA 帧 | ⚠️ **完全未文档化**（fleet 从进程结构逆向） | 【fleet 实测，端到端】 |

**⊢ 结构性事实**：能力最强的三条（transcript 全量、peer 身份、按键注入）**全部是未文档化的内部细节**；
文档化的那几条**能力较弱但稳定**。本 SPEC 不因此放弃强能力，而是要求 §4.2 的降级链。

### 4.2 降级链（本 SPEC 的硬要求）

**每条未文档化能力必须配一个文档化的后备，且「这条路还通不通」是被持续测量的量，不是一次性假设。**

| 强通道（未文档化） | 降级到（文档化） | 能力损失 |
|---|---|---|
| peer 身份注册（被任意会话零配置寻址） | MCP-over-HTTP（会话主动调 quay MCP 工具） | 从「推」退化为「拉」；失去 idle 订阅 |
| transcript jsonl 全量解析 | `claude -p --resume <id> --output-format json`<br>⚠️ **仅当目标【未在运行】** | 从「读历史」退化为「问一次」；**⛔ 目标运行中时这个后备会往同一个 transcript 静默写一轮**（§9 问题 5 实测）⇒ **观测行为改变被观测对象**，此时它不是后备 |
| **pty.sock 按键注入** | ⛔ **无程序化后备** —— 只能 `claude attach` 由**人**接管 | 从「程序可做」退化为「**必须有人在**」 |

**⊢ §9 问题 5 的实测把这张表撕开了一个口子，必须写明**：向一个**正在运行**的会话送入内容，
**一条文档化通道都没有**——`claude -p --resume` 的契约**未覆盖「目标正在运行」这一情形**
（实测：exit 0、无冲突提示、输入**从不进入该会话的活上下文**，却与目标进程**双写同一份 transcript**）。
⇒ **「每条未文档化能力必须配文档化后备」这条要求，对【按键注入】结构上无法满足**。
本 SPEC 据此**不假装它有后备**，而是承认：该能力一旦漂移失效，**降级的终点是「人来 attach」**，
并要求把这一事实写进运维文档而不是留给将来的人去撞（硬规则 3b：读不懂/做不到必须显式表达，不得与合格同形）。

**⊢ 降级的触发判据**：能力自检失败 ⇒ 报 `not-evaluated` **并切换到后备**，⛔ 不静默失败、⛔ 不假装成功
（硬规则 3b）。**⛔ 不接受「等出事了再说」**：漂移先例已实测两次——同一套消息协议在 2.1.233 → 2.1.241
跨 8 patch 行为已变（`plugin/scripts/send-to-session.ts:98`），且 spike 当日的静态读码推断被自己的实测推翻一次。

### 4.3 已实测的陷阱（直接作为实现约束，⛔ 不要重新发现）

| 陷阱 | 约束 | 来源 |
|---|---|---|
| `statusUpdatedAt` 可陈旧 **3.3 天**而仍报 `status=idle` | **活性只信直接量**；判定函数的**签名就不接受** `status`/`statusUpdatedAt`（结构上无法回退到自报） | 【fleet 实测】 |
| 短 id 有**两套互不相干的命名空间**（`agents --json` 取 sessionId 前 8 位；messaging 层另一套） | 跨接口 join **只用完整 sessionId 或 pid** | 【fleet 实测】 |
| `claude logs <bogus-id>` 把人类可读错误写 **stdout 且 exit 0** | 存在性检查**必须**先用结构化的 `agents --json`，⛔ 绝不嗅探日志字节 | 【fleet 实测】 |
| `claude agents --json` **只列运行中会话** | 会话发现**不能只靠它**：已结束会话须扫 transcript 目录补齐。⛔ 「不在 `agents --json` 里」≠「该会话不存在」（硬规则 5 来源完备性的一个实例） | 【本仓库】`gap-webui-session-discovery-claude-agents-json`（done） |
| pty 协议**没有「auth 成功」消息** | 用宽限窗以**缺席推断接受**（fleet 用 50ms）；拒绝帧到达必须**在 DATA 写出之前**中止 | 【fleet 实测】 |
| composer **会回显**你输入的 prompt ⇒ 「提交后 402ms 就看到答案」的假阳性 | 判据落 transcript 的**记录类型**（`type:"user"` / `type:"assistant"`），⛔ 不看屏幕内容 | 【fleet 实测】 |
| `ListAgents` 枚举**会删除**被判死的记录（`.json` + `.key` 一起删），socket 文件成孤儿 | peer endpoint 必须**周期自检自己的记录还在不在**，不在就重注册；并自行清理孤儿 socket | 【spike 实测】 |
| 收方向**根本不校验 auth 帧**（删掉 `.key` 仍投递成功） | ⛔ 不实现 token 校验（不会被调用），⛔ 更不拿它做安全判断 | 【spike 实测】 |
| `agent` 字段对可达性**零影响**（`"quay"` / 缺省 / `"claude"` 三取值同结果） | **如实标注**即可，裁定 ③ 的豁免用不上 | 【spike 实测】 |
| `pidDomain` 是 Claude Code 自己生成的稳定机器指纹 | ⛔ **不要自己发明 host id** | 【fleet 实测】 |
| SDK 起的会话在 `agents --json` 里报 `kind:"interactive"`，**与人开的交互式会话同形** | 要区分「这条会话是谁起的」**只能**读 `~/.claude/sessions/<pid>.json` 的 `entrypoint`（SDK=`sdk-cli` / 交互式=`cli`）——该字段 `agents --json` **不暴露** | 【本仓库实测】§9 问题 6 |
| `claude -p --resume <运行中 id>` 与目标进程**双写同一份 transcript**，且输入**不进目标的活上下文** | ⛔ 不得用它读/写一个**正在运行**的会话；判定「输入是否到达」的直接量是**那个会话自己看得见什么**，⛔ 不是 transcript 文件（文件此时有两个写者） | 【本仓库实测】§9 问题 5 |
| 外部进程**无法订阅**「会话变 idle」（`notify_when_idle` 只在会话之间工作） | 要么轮询 `agents --json`，要么**用 peer 身份订阅**——这是 peer endpoint 的第二个不可替代用途 | 【官方文档】 |

---

## 5. 目标架构

```
┌── quay server（一个 OS 进程 · 一个项目 · 一个信任域）──────────────────┐
│                                                                        │
│  入站面（收）—— 四个面，同一份能力实现的四个投影（§6.8）                  │
│    CLI  ⭐先行     quay server start/add/stop/status（§6.9）             │
│                     quay driver … · quay session …                      │
│                     ⊕ 新能力【必须先有 CLI】：它是最小可测面              │
│    MCP over HTTP    控制面 halt/preference/forceDispatch                 │
│                     + 任务 ABI task_*/gate_*/lifecycle_*                │
│    HTTP             Web UI · /health · webhook 位                       │
│                     ⊢ Web 是 CLI 能力的可视化投影，⛔ 不是独立能力面      │
│    peer endpoint    注册 ~/.claude/sessions/ + 监听 socket（阶段 D 才有）│
│                     ⇒ 任意会话【零配置】SendMessage 可达                 │
│                     ⛔ 只收通知/请求，不承载状态变更（§6.3）              │
│                     ⊕ 兼作 idle 订阅者（§4.3 末行）                      │
│                                                                        │
│  出站面（发）                                                           │
│    message   sendSessionFrames（已有，serve-send.ts）                   │
│    keys      pty.sock DATA 帧（新增，用 fleet 的 pty-frame.mjs）         │
│    lifecycle claude attach/stop/rm/respawn                              │
│    ⊢ 三者都经统一审计出口（fleet 的 delivery-audit.mjs 纪律）             │
│                                                                        │
│  执行面（drivers）                                                      │
│    Layer 0   supervisor · loop · trigger · stopCondition ·              │
│              heartbeat · controlPlane · notify · profile                │
│    Layer 1a  promotion · worker        （任务处理）                      │
│    Layer 1b  outer · goal · quality · meta（例程）                      │
│                                                                        │
│  状态面   内存 = 缓存 ｜ .quay/*.jsonl + tasks/*.md = 真相               │
└────────────────────────────────────────────────────────────────────────┘
              │ 共享原语层（§3.3，与 quay-fleet 同一份实现）
              ▼
   pty-frame · delivery-audit · session-liveness · session-schema
```

---

## 6. 关键决策

> **6.1–6.7 是架构决策；6.8–6.10 是人 2026-09-13【第五轮裁定】的实施原则**，它们不改变目标架构，
> 但**决定了 §7 的阶段划分与每个阶段内部的做事顺序**。裁定原文三条：
> ①「应要求**先合并已有的相关实现**，再增加当前未实现的相关功能」
> ②「应提供**更灵活的启动和停止选项**，例如仅启动部分服务、追加启动部分服务、关闭部分服务等」
> ③「在增加功能时，应**优先完善 CLI** 相关功能，再实现 Web 相关功能」
> 6.10 是本 SPEC 作者据 ② 推导补充的一条——**合并本身会引入一个现在还不存在的风险**，见该节。

### 6.1 一个进程，不是 13 个

**⊢ 诚实的反面论证**：多进程的真实收益是**故障隔离**——一个 kind 崩了不影响别的。进程内隔离**达不到**同等强度。
**对策**：每个 kind 循环用独立错误边界 + 重启计数（把 respawn 从 OS 进程层降到事件循环层），
剩余的不可恢复故障（OOM、段错误）由**一个**外层 anchor 兜（不是六个 supervisor）。
**⊢ 迁移顺序据此排**（§7）：先合并纯 I/O 的面，再收 CPU/spawn 密集的 driver，**⛔ 不一次性重写**。

### 6.2 peer endpoint 是「收」的主路径，且是一个**需要自愈的活体**

依据裁定 ①④ + spike 实测。三条实现要求来自 §4.3：周期自检记录存在性并重注册、自行清理孤儿 socket、
⛔ 不实现也不依赖 auth 帧校验。**可达性是持续测量的量**：注册后自检「我能被看见吗」，看不见 ⇒ `not-evaluated` + 降级。

### 6.3 「推」只做通知，「拉」才做控制 —— 架构约束，非实现细节

```
peer endpoint（推）  事件通知：任务落地 / suite 红 / needs-human / driver 判停
MCP over HTTP（拉）  状态变更：halt / forceDispatch / task 写入 / lifecycle 转换
```

三条理由：① 推路径契约不稳定（§4.1）不能承载关键操作；② 推失败代价小（对方下次拉就看到），
推控制失败代价大且静默；③ **它收窄了裁定 ④ 接受的那个风险**——边界内即使有别的进程冒充 quay server 的身份，
它也只能发通知，改不了状态（状态面在 MCP 那一侧，走另一套路径）。

**⊢ 推论**：任何 peer 路径能做的事，MCP 路径都要能做（**同一能力两个投影**），契约漂移时能力**退化而不断裂**。

### 6.4 Channels 不进架构（spike 实测排除）

不是「暂不采用」，是**结构性不可用**：自研 channel 要连过目录信任 → 项目 MCP server 批准（默认值「不使用」）
→ dev-flag 确认三道**交互**闸，而 driver spawn 的 worker 是 `-p` 模式，**结构上无法回答最后一道**；
且官方无运行时接入入口（`.mcp.json` 里有不够，必须启动时在 `--channels` 点名），已在运行的会话接不进来。
**⊢ 复议条件**：若将来把「会话如何启动」纳入 quay 控制面，则 Channels 值得重新评估——那是独立的架构决策。

### 6.5 内存是缓存，载体是真相

合并后 Web 可直接读 driver 的内存状态（不再读 `.quay/*.jsonl` 的滞后快照），但**载体必须保留**：
内存是进程私有、重启即失；载体是持久的、可被外部工具与别的项目读。**任何判据仍然读载体。**

### 6.6 项目空间 = 部署单元 = 信任域（裁定 ④）

一个项目一个实例；多项目 = 多实例（同机或各自 Docker）。跨项目协调（manager 层）走**外围**通道，
**不共享内部信任**。⇒ `~/.claude/sessions/` 的「同用户可写」在容器化部署下不构成问题：一个容器 = 一个用户空间。
**⊢ 本条是 §6.3 的前提**：边界内不做进程间认证，是因为边界本身由外围保证。

### 6.7 活性只信直接量（从 fleet 抄的铁律，⛔ 不重新发明）

状态词表**三层不许折叠**：`session.lifecycle`（`agents --json`）/ `session.activity`（注册表）/ `task.status`（quay）。
同一会话三个接口给三个词，且 `agents --json` 把 `shell` 折叠进了 `busy`。
⇒ 字段一律带层前缀，并由 `session-schema.mjs` 强制（出现顶层 `status` 即 invalid）。
活性判定只用 `pidAlive` / `lastTranscriptWriteAt`(mtime) / `lastCommitAt`(git)，
**函数签名结构上不接受自报字段**。

### 6.8 能力的单一实现 + 四面投影，**CLI 先行**（裁定原则 ③）

```
一个能力（一份实现）
  ├─ CLI    ⭐【先行】新功能必须先有 CLI —— 它是能力的最小可测面
  ├─ MCP    程序/会话消费
  ├─ Web    人消费；是 CLI 能力的【可视化投影】，⛔ 不是独立能力面
  └─ peer   推通知（受 §6.3 约束：只通知、不控制）
```

**⊢ CLI 先行不只是偏好，有两条可核的理由**：
1. **判据可跑得更早**：CLI 的判据是「一条命令 + exit code + stdout」，脚本化即可；Web 要浏览器 e2e，
   而本仓库的浏览器/agent e2e 是**里程碑节奏**（`adr/ADR-010`，status: proposed），不是每轮
   ⇒ **先做 Web 会让这条能力的判据晚好几轮才可跑**。
2. **改动落点的体量差 3.7 倍**（实测 `wc -c`，2026-09-13）：`packages/quay/src/serve-*.ts`
   **16 个文件 / 497,272 字符**，而 CLI 面 `packages/quay/src/cli/*.ts` 只有 **133,299 字符**
   ⇒ 新能力先进 Web = 直接写进全仓最大的那一坨，且它的判据还要等浏览器 e2e（见理由 1）。

**⊢ 与 §6.3 同构**：§6.3 说 peer 与 MCP 是同一能力的两个投影；本条把它推广到四个面
——**能力只有一份实现，四个面都是薄适配**。

**判据（可取假）**：任一新能力，若 **Web 面可用而 CLI 面不可用** ⇒ 违反本条。

### 6.9 服务是可独立起停的单元，进程只是宿主（裁定原则 ②）

**⊢ 这条与「合并成一个进程」不矛盾，它是合并的【前提】**：现状 13 个进程时
`quay driver stop --kind worker` 是可用的；若合并后只能整体起停，**那是能力回退**，
而 §7 每个阶段的判据都含「零回退」⇒ 不做这条，合并本身就过不了自己的判据。

**服务清单（每个都是独立起停单元）**：
```
web        HTTP + Web UI
control    MCP over HTTP 控制面
peer       peer endpoint（阶段 D 才存在）
driver:promotion · driver:worker · driver:outer · driver:goal · driver:quality · driver:meta
```

**CLI 形态（先行，§6.8）**：
```
quay server start  [--only <svc,...>] [--without <svc,...>]
quay server add    <svc,...>          # 追加启动，⛔ 不影响已在跑的
quay server stop   [--only <svc,...>] # 部分停止，⛔ 不波及其余
quay server status [--json]           # 每服务一行 + §6.10 的健康读数
```

**三条不变式（各自可取假）**：
1. **幂等**：`start` 一个已在跑的服务 = no-op ——⛔ 不是报错、⛔ 更不是静默重启
   （重启会打断该 driver 在飞的 worker 子进程）。
2. **部分操作不波及其余**：停 `web` ⇒ 六个 driver 的 round 心跳**不中断**（取假：读载体连续性）。
3. **⛔ 不得只能整体重启**：任一服务可单独重启，且其余服务的**在飞工作不受影响**
   ——`driver:worker` 尤其：它的在飞 worker 是**独立子进程**，重启 driver ⛔ 不得杀它们
   （现状 `quay driver stop` 已经是这个语义，见 CLAUDE.md「driver 进程管理」节，**合并后必须保持**）。

### 6.10 合并引入的新风险：**每服务必须有独立健康读数**（作者据原则 ② 补充）

**⊢ 这是合并【带来的】、现在还不存在的风险**：13 个进程时 `ps` 能直接看出哪个 driver 死了；
合并成一个进程后 `ps` 只剩一行 ⇒ **「进程活着」与「六个 driver 都在转」之间的区别在外部不可见**。
这正是 §6.7 禁止的那种折叠——把两个不同的事实压成一个词。

⇒ **要求**：`quay server status` **每服务一行**，每行的活性是**直接量**（该服务自己的 round 心跳时刻 /
最后一次成功动作时刻），⛔ 不得用「进程在，所以它们都在」推导。
**读不到 ⇒ `not-evaluated`，⛔ 不是「正常」**（硬规则 3b）。

**⊢ 反面参照（本仓库已实证）**：CLAUDE.md 记着「pane 进程存在 ≠ 会话在处理（实证：inner 的 pane 一直在
而 tick 停 21 分钟）」——那次误判的结构与这里完全一样，只是载体从 pane 换成了进程。

---

## 7. 迁移路径（⛔ 不一次性重写）

**⊢ 排序由裁定原则 ① 决定：先把【已有实现】合并完，再加【当前未实现】的功能。**
**本节相对初稿是一次实质重排**：初稿的「阶段 1」把 *web+控制面合并*（已有实现）与 *peer endpoint*（全新功能）
放进了**同一个阶段**，直接违反原则 ① ⇒ 已拆开，**peer endpoint 移到最后（阶段 D）**。
⊢ 这个重排还有一个独立好处：peer endpoint 是全架构里**唯一依赖未文档化契约**的部分（§4.1），
把它排在最后 ⇒ 前面三个阶段的收益都是确定性的，**不被那条契约的漂移绑架**。

### 阶段 A —— 纯合并已有实现，⛔ 零新功能

| 步 | 内容 | 已有实现在哪（⇒ 这是「合并」不是「新建」） | 判据（可取假） |
|---|---|---|---|
| **A1** | `serveControlPlane` 由 worker-driver 上收进 Layer 0，**六个 kind 全部获得控制面** | `driver-shared.ts:283` 早已实现，只是仅 `worker-driver.ts:4955` 一处调用 | 六个 kind 的控制面各自可达；逐个负控制：对该 kind 发 halt 后它判停 |
| **A2** | `web`(serve) + `control` 合入一个进程；**drivers 仍是独立进程** | `serve.ts` + `driver-shared.ts` 两边都已存在 | 进程数 **13 → 12**；Web 全部路由零回退（既有测试全绿） |
| **A3** | 会话读写原语统一到共享层（§3.3），退役 `observation.ts` / `serve-send.ts` 里的重复实现 | 两边都有实现，合并即可 | **全仓仅一份** socket/注册表读写实现（`grep` 可取假） |

**⊢ 阶段 A 不新增任何用户可见能力**，所以它的判据**全部**是「零回退」+「重复实现消失」。
⛔ **若 A 的任一步引入了新能力，即违反原则 ①**（§8 判据 9）。

### 阶段 B —— 服务化启停（原则 ②），仍零新业务功能

CLI 先行（§6.8）：实现 §6.9 的四个动词 + 服务清单。

判据：① 每个服务可**独立**起停（逐个负控制）；② 停 `web` 时 driver 的 round 心跳不中断；
③ **合并后的独立起停能力 ≥ 合并前**——`quay driver stop --kind X` 的等价物必须仍在，
且**仍不杀该 kind 在飞的 worker 子进程**（§6.9 不变式 3）。

### 阶段 C —— driver 内收（两步，风险从低到高）

| 步 | 内容 | 判据 |
|---|---|---|
| **C1** | 例程型（`outer`/`goal`/`quality`/`meta`）：无 spawn、无并发，风险最低 | 进程数 **12 → 8**；四种例程的 round 心跳不中断 |
| **C2** | 任务处理型（`promotion`/`worker`）；多进程 supervisor 退役为**一个**外层 anchor | 进程数 **→ 2**（server + anchor）；派发吞吐与 fan-in 成功率**不低于**同窗口基线；每服务健康读数在位（§6.10） |

### 阶段 D —— 新功能：peer endpoint（⛔ 排在最后）

| 步 | 内容 | 判据 |
|---|---|---|
| **D1** | **CLI 先行**：`quay session send/list/…`（直接消费共享原语层，**此步不需要 peer 身份**） | CLI 可向一个真实会话投递并核证到达；⛔ 不经 Web |
| **D2** | peer endpoint 注册 + 自愈（§6.2）+ 可达性持续测量（§4.2） | 可被另一会话**零配置**寻址；负控制：删注册记录即不可达；**自愈可观测**（记录被他人 `ListAgents` 删除后能自动重注册，§4.3） |
| **D3** | Web 面投影（**最后**，§6.8） | Web 上能做的，CLI 已经能做（取假：存在只有 Web 能做的动作 ⇒ 违反 §6.8） |

每阶段独立可回退。**判据是两个量（进程数下降 + 能力零回退），⛔ 不是「重构完成」这种不可证伪的说法。**

---

## 8. 本 SPEC 的取假形态

若下列任一为真，本 SPEC 的设计即未达成：

1. 统一后仍存在**第二份**会话读写原语实现（与 §3.3 共享层并行的手写副本）。
2. peer endpoint 的可达性**不被持续测量**——即存在一条「注册了就假设一直能用」的代码路径（§4.2）。
3. 任一**状态变更**能力只经 peer 路径可达、MCP 路径不可达（违反 §6.3 的两个投影）。
4. 任一判据读的是会话的**自报状态**（`status`/`statusUpdatedAt`）而非直接量（违反 §6.7）。
5. 阶段完成被宣称，但进程数未下降或既有能力有回退（违反 §7 的双量判据）。
6. 任一新能力 **Web 面可用而 CLI 面不可用**（违反 §6.8 CLI 先行）。
7. 合并后**无法单独起停**某个服务，或一次部分操作**波及了其余服务**——尤其：重启 `driver:worker`
   杀掉了它在飞的 worker 子进程（违反 §6.9 三条不变式）。
8. `quay server status` **无法区分**「进程活着」与「某个服务已停摆」（违反 §6.10）——
   取假形态：杀掉/卡住一个服务后 status 仍报全绿。
9. **阶段 A 的任一步引入了新的用户可见能力**（违反原则 ①：合并阶段应零新功能）。
10. peer endpoint 早于阶段 A/B/C 落地（违反原则 ① 的排序，且把确定性收益绑上了未文档化契约）。

---

## 9. 开放问题（需要量，⛔ 不拍脑袋）

1. **kind 循环内收后会不会互相饿死**？Node 单线程；driver 多数时间 await 子进程，理论上可行，
   但 suite runner 那类 CPU 密集的必须留子进程。**需实测**：满负载下各 kind 的 round 间隔抖动。
2. **合并后的内存峰值**？12 个 Node 堆合成一个；本机已有 cc-daemon 内存压力先例。**先量再定。**
3. **peer 注册自愈的检查频率**？⛔ 成本结构未知前不设数值（硬规则 4 推论）——先量「记录被别人的
   `ListAgents` 删掉」的**实际发生率**。
4. **共享原语层的取用形态**？共享包 / vendored 复制 / fleet 发 npm 包——三者在「谁先落地、谁负责升级」上不同。
5. **`claude -p --resume <id>` 能否向【运行中】的会话注入输入**？`--bg --resume` 的帮助写着
   「…**or starts a copy and says so when the session is already running**」⇒ 疑似起副本而非注入。
   **这决定了运行中会话的输入通道到底有几条**，需实测确认。

   > **✅ 结论（实测，2026-09-13，Claude Code 2.1.270）**：**不能。该通道【不向运行中会话注入输入】。**
   > 读数引用：`docs/analysis/resume-injection-and-sdk-visibility-2026-09-13.md` §1。
   > - `claude -p --resume <运行中 id>`：exit 0，**⛔ 无任何「已在运行/起副本」提示**，
   >   **⛔ 不产生新 session-id / 新 transcript**，那一轮被写进**同一个 session-id 的同一个
   >   transcript 文件**，但由 resume 进程自己执行（该轮 `entrypoint:"sdk-cli"`，目标会话自己的
   >   各轮是 `entrypoint:"cli"`）。**运行中会话的活上下文从不接收它**（问它收到了哪些 user
   >   消息 → 注入的那条不在其中；两个 nonce 直接问 → 「No — for both」）。
   >   ⇒ 两个进程**静默双写同一份 transcript**，**文件与活上下文分叉**。
   > - 文档里那句「starts a copy and says so」**只对 `--bg --resume` 成立且被实测证实**：
   >   `note: session 0e20eed2 is open in another Claude Code process, so this started a copy as
   >   becb979c. The original conversation is unchanged.` + 新 session-id + 新 transcript。
   >   ⇒ **`-p --resume` 的同一冲突检测【缺席】**——这是文档化契约的一个缺口。
   > - ⚠️ **方法论**：AC 原定的三项读数（提示原文 / nonce 是否进原 transcript / 是否新 id）**全是
   >   文件代理量**，而该文件此时**有两个写者** ⇒ 三条合起来会把「起了副本」**判成「注入原会话」**。
   >   判定「输入是否到达运行中会话」的唯一直接量是**那个会话自己看得见什么**（硬规则 4b）。
   >
   > **⇒ 对 §4.2 降级链的影响（本问题原本要回答的架构判断）**：§4.1 通道清单里
   > 「向**运行中**会话送入内容」**确实一条文档化通道都没有**——
   > `claude -p --resume <id> --output-format json` 虽被官方推荐为「从脚本访问会话数据」，
   > 但其契约**未覆盖「目标正在运行」这一情形**（静默双写、输入不到达）。
   > ⇒ §4.2「未文档化能力必须配文档化后备」对这一项**结构上无法满足**，应改写为
   > **「该能力无后备，只能降级为『必须有人 attach』」**（messaging socket 直投与 pty.sock
   > 按键注入仍是仅有的两条可用通道，且两条都未文档化）。
6. **Agent SDK 创建的会话是否出现在 `claude agents --json`**？官方文档未提及，需实测。

   > **✅ 结论（实测，2026-09-13，Claude Code 2.1.270 + `@anthropic-ai/claude-agent-sdk` 0.3.270）**：
   > **【出现在】。§4.1/§6.7 以 `agents --json` 为会话发现正源【没有】SDK 盲区。**
   > 读数引用：`docs/analysis/resume-injection-and-sdk-visibility-2026-09-13.md` §2。
   > - `claude agents --json` 含该会话：
   >   `{"pid":1659404,"kind":"interactive","sessionId":"1a77f89e-2238-4729-bb89-a1712852c869","status":"idle",…}`
   > - `~/.claude/sessions/1659404.json` 同样存在（19 键，含 `entrypoint:"sdk-cli"`、
   >   `messagingSocketPath`、`peerFeatures`）。
   > - **⚠️ 限定（必须写进设计）**：`agents --json` 把它报成 **`kind:"interactive"`** ——
   >   **与交互式会话同形，`kind` 区分不出 SDK 会话**。唯一可区分的字段是 **`entrypoint`**
   >   （SDK=`sdk-cli` / 交互式=`cli`），而它**只在 `~/.claude/sessions/<pid>.json` 里，
   >   `agents --json` 不暴露**。⇒ 需要「这条会话是谁起的」时，**必须读那个文件的 `entrypoint`**。

---

## 附录 A：本 SPEC 依据的读数来源

| 来源 | 内容 | 位置 |
|---|---|---|
| spike（done） | 方案 C 可达性 / `agent` 三取值 / auth 帧不校验 / 枚举即删除 / Channels 三道闸 | `docs/analysis/session-inbound-two-paths-2026-09-13.md`（355 行）、探针 `plugin/scripts/peer-identity-probe.ts` |
| quay-fleet | 五条原语清单 / pty 帧协议 / 四条状态载体 / 七个已踩的坑 | `/home/yale/work/quay-fleet/docs/design/quay-fleet-design.md`（附录 A 为同日本机实测） |
| 官方文档 | 各通道的稳定性定性 | `code.claude.com/docs/en/{agent-view,sessions,cross-session-messaging,cli-reference}.md` |
| 本仓库 | 进程清单 / driver 分层 / 既有 Web 面 | `.quay/*.pid`、`plugin/scripts/driver-runtime.ts`、`packages/quay/src/serve-*.ts` |

---

## 附录 B：一个连带发现（不属本 SPEC 范围，建议单独立案）

quay-fleet 在被 quay 驱动时发现：quay 的机械 fan-in 用 **`hasTestSh()` 裸文件存在性**当作「该仓实现了 bucket
协议」的代理，于是给第三方项目的 `test.sh` 发 `--buckets <task-id>`；第三方脚本的 `-*) shift ;;` 只 shift 1，
task-id 掉进文件名列表 ⇒ **每个 fleet 任务的 fan-in suite 步假红** ⇒ 重试分类器落到
`verdict:"insufficient-data-fallback"` ⇒ **盲目重派 worker 三次**后升 needs-human。

**⊢ 值得立案的原因不是第三方边缘情况**（读数由本 SPEC 作者复核，⛔ 不是转述）：
`.quay/worker-round.jsonl` 17820 条记录里共 **294** 条 `retry_exemptions`，其中
`verdict:"insufficient-data-fallback"` **130 条 = 44.2%**。

**⚠️ 但这 130 条【不是同一个成因】——立案时不要只盯 bucket 协议那一条**：

| reason（该 verdict 下的实际分布） | 条数 |
|---|---|
| `no mechanical fan-in result on the outcome (cannot attribute)` | **76** |
| `no failing test file extracted from the suite log`（= fleet 撞到的 bucket 协议那条） | **43** |

⇒ 主仓的高频归因盲区**至少有两个**，且更大的那个（无机械 fan-in 结果）与第三方无关。
转述版本把 44% 整体归给 bucket 协议，是一次**合集被归给单一成因**的误读；此处按实际分布更正。
