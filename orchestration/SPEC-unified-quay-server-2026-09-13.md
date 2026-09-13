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

---

## 1. 人的裁定链（本 SPEC 的授权基础）

| # | 日期 | 裁定 | 对本 SPEC 的效力 |
|---|---|---|---|
| ① | 2026-09-13 | 「收」方向走**轻量 peer 身份注册**（注册进会话注册表、不带模型循环），先立可行性验证任务 | 确立 peer endpoint 为「收」的主路径候选 → spike 已 done |
| ② | 2026-09-13 | 范围改为**「C 与 Channels 双路对照」** | spike 产出对照表（§4.1 的定性即来自它） |
| ③ | 2026-09-13 | 「若必须冒充 `agent:"claude"` 才可达，**也是可以接受的**」 | 诚实性不再是否决条件；⛔ 但仍须量运行时代价（spike AC5） |
| ④ | 2026-09-13 | **接受入站无认证风险**：「这是 Claude Code 既有的风险；客观上必须有这样便于调用的组件在这一生态位，而**认证和授权机制应当在更外围**——每个持续开发项目将有自己的空间，例如一个独立的 Docker Instance，其**内部效率是优先的**」 | **确立信任模型**（§6.6）：信任边界 = 项目空间边界；边界内不做进程间认证 |

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
| transcript jsonl 全量解析 | `claude -p --resume <id> --output-format json` | 从「读历史」退化为「问一次」；有成本 |
| pty.sock 按键注入 | `claude attach`（人工接管） | 从「程序可做」退化为「必须有人」 |

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
| 外部进程**无法订阅**「会话变 idle」（`notify_when_idle` 只在会话之间工作） | 要么轮询 `agents --json`，要么**用 peer 身份订阅**——这是 peer endpoint 的第二个不可替代用途 | 【官方文档】 |

---

## 5. 目标架构

```
┌── quay server（一个 OS 进程 · 一个项目 · 一个信任域）──────────────────┐
│                                                                        │
│  入站面（收）                                                           │
│    peer endpoint    注册 ~/.claude/sessions/ + 监听 socket              │
│                     ⇒ 任意会话【零配置】SendMessage 可达                 │
│                     ⛔ 只收通知/请求，不承载状态变更（§6.3）              │
│                     ⊕ 兼作 idle 订阅者（§4.3 末行）                      │
│    MCP over HTTP    控制面 halt/preference/forceDispatch                 │
│                     + 任务 ABI task_*/gate_*/lifecycle_*                │
│    HTTP             Web UI · /health · webhook 位                       │
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

---

## 7. 迁移路径（⛔ 不一次性重写）

| 阶段 | 内容 | 完成判据（可取假） |
|---|---|---|
| **1** | web + 控制面 + peer endpoint 合入一个进程；drivers 保持现状 | 进程数 **13 → 8**；现有 Web 路由与 driver 行为**零回退**（既有测试全绿）；peer 可被另一会话零配置寻址（负控制：删注册记录即不可达） |
| **2** | 例程型 kind（outer/goal/quality/meta）循环内收——无 spawn、无并发，风险最低 | 进程数 **8 → 4**；四种例程的 round 心跳**不中断**（载体连续性可查） |
| **3** | 任务处理型（promotion/worker）内收；多进程 supervisor 退役为一个外层 anchor | 进程数 **→ 2**（server + anchor）；派发吞吐与 fan-in 成功率**不低于**迁移前同窗口基线 |

每阶段独立可回退。**判据是两个量（进程数下降 + 能力零回退），⛔ 不是「重构完成」这种不可证伪的说法。**

---

## 8. 本 SPEC 的取假形态

若下列任一为真，本 SPEC 的设计即未达成：

1. 统一后仍存在**第二份**会话读写原语实现（与 §3.3 共享层并行的手写副本）。
2. peer endpoint 的可达性**不被持续测量**——即存在一条「注册了就假设一直能用」的代码路径（§4.2）。
3. 任一**状态变更**能力只经 peer 路径可达、MCP 路径不可达（违反 §6.3 的两个投影）。
4. 任一判据读的是会话的**自报状态**（`status`/`statusUpdatedAt`）而非直接量（违反 §6.7）。
5. 阶段完成被宣称，但进程数未下降或既有能力有回退（违反 §7 的双量判据）。

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
6. **Agent SDK 创建的会话是否出现在 `claude agents --json`**？官方文档未提及，需实测。

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
