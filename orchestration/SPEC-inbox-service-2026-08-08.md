# SPEC — 收件箱服务（agent 间通信信道）

**状态**：**定稿待命——人 2026-08-08 09:5x 明确「现在不用向 outer 提」。**
本文件已完成（D1–D13 零待定、AC-1..9 可机械核对），**但不派发**：
当前排序是 **AC19 → AC16 → 本 SPEC**。**下一轮 tick 读到本文件时不要把它当作待派发项。**
**归属**：本文件定义**要什么**与**怎么判**；**实现归 outer**（AC5：管理者定义、不实现）
**日期**：2026-08-08
**上游裁定**：人 2026-08-08 08:0x–09:1x 的连续裁定（逐条标在 §2）

**一句话**：`manager` / `outer` / `inner` 之间的通信，从裸 tmux 改为**每项目一个后台服务**承载的收件箱；
tmux 退回**仅用于紧急控制**。

---

## 1. 为什么（问题陈述）

**触发事件（2026-08-08 08:2xZ，人发现）**：outer 经 tmux 投给 manager 的消息，与人亲自打字的消息，
**在 manager 的 transcript 里字段完全相同**：

| | outer 转达 `04a2d0dd` | 人打字 `08:22:36` |
|---|---|---|
| `type` | `user` | `user` |
| `isSidechain` | `False` | `False` |
| `userType` | `external` | `external` |

唯一标记是 `[外层→管理者]` 前缀，而**前缀由发送方自己写 ⇒ 等于没有认证**。
后果不是理论上的：**manager 记录里每一条「人裁定 X」，依据都是这个不可认证的通道。**

**第二个问题（同日实测）**：manager→outer 的每一次投递都必须先等 outer 空闲
（当晚挂了 4 个等待器，每个上限 20 分钟），**发送方被接收方的会话状态阻塞**。

**⇒ 本 SPEC 要解决的正是这两条**：① 通道无身份；② 发送方阻塞。

---

## 2. 决定（decisions of record）

| # | 决定 | 来源 |
|---|---|---|
| D1 | 收件箱**不进 git 跟踪**，**不假设内容持久** | 人 2026-08-08 |
| D2 | **完整产品化**，产品也提供推送；检查收件箱**可有分钟级延迟** | 人 |
| D3 | 通信**优先走收件箱**，tmux **仅用于紧急控制** | 人 |
| D4 | **不做 `resolved` 层**——收件箱只是通信信道，不是工作流引擎 | 人 |
| D5 | 身份走 `CLAUDE_CODE_SESSION_ID` + 注册表；**接受「挡 agent、不挡能改宿主配置的人」这个边界** | 人 |
| D6 | 承载形态为**每项目一个后台服务**（不是文件目录） | 人 |
| D7 | **消息注入不得复用 web UI 的 listener** | 人 2026-08-08 09:1x |
| D8 | 顺序**不可换**：① 建写侧 → ② 建消费侧 → ③ 才收紧 tmux | 人 |
| D9 | 旧 `.quay/manager-inbox/` 全面废弃（分类处理见 §7） | 人 |
| D10 | manager 的收件箱**由三个项目的服务各自承载**，不新起 manager 专属服务 | **人 2026-08-08 09:4x 裁定** |
| D11 | **端口分配**：配置显式指定 + 注册表登记，**不做自动分配**（现状 4173/4174 即手工指定） | **人 2026-08-08 09:4x 裁定**（原 P1） |
| D12 | **token 形态**：注册时签发的**不透明随机串**，存于注册表，MCP server 持有 | **人 2026-08-08 09:4x 裁定**（原 P2） |

**⇒ 本 SPEC 的所有待定项已清零。** D11 的一个副作用要写明：
**不自动分配意味着端口冲突由人发现，不由机制发现** —— 这是刻意的（少一个会出错的机制），
但注册表登记必须是**硬性**的：**未登记的端点不可寻址**（fail closed），
否则「手工指定」会退化成「谁都不知道端口是多少」。

---

## 3. 实测现状（引用前已按判准 ②i 逐条核实，2026-08-08 09:0xZ）

```
serve 进程实况
  pid=1983583  cwd=/home/yale/work/quay        port=4173   源码路径
  pid=1975220  cwd=/home/yale/work/archguard   port=4174   【跑的是已安装的 quay 二进制】
  meta-cc      无（已 .halt）
⇒ 「每项目一个 quay 后台服务」不是新基建，已经在跑，且 archguard 那个正是产品化路径

serve.ts:38          host 默认 "0.0.0.0"（全接口）；当前实例绑 100.87.141.82（LAN 可达）
serve-handlers.ts    1303 行，【已有 POST 路由】；ADV-003 刚修过该 POST 路径的 open-redirect 绕过
message-bus.ts       registry + deliver/observe + checkIdentityClaim（fail-closed）已存在
  TARGETS    = ["inner","outer","human"]      ← 无 manager，需新增
  IDENTITIES = ["human","manager","inner","outer"]
  installDefaultTransports:317  outer/inner 注册的是 createSessionTransport（tmux）
写侧现状          零个 shell/CLI 入口；deliver() 的非测试调用方 = 0
  ⇒ 总线 delivered=0 不是纪律问题，是【写侧没有可走的路】
```

---

## 4. 架构

### 4.1 寻址与身份是两件事（不得合并）

| | 用什么 | 为什么不能用另一个 |
|---|---|---|
| **地址**（发给谁） | 逻辑名 **`<project>:<role>`** | 用 session id 当地址，对方 `/clear` 或 `--resume` 一次，所有发送方全断 |
| **身份**（我是谁） | **`CLAUDE_CODE_SESSION_ID` → 注册表** | 用 role 名当身份 = 自述，谁都能声称 |

**注册表是两者的联结点**（形状照抄已有的 `$QUAY_GLOBAL_DIR/manager/projects.tsv`）：

```
# 身份表
session_id                              project   role     token
3cc1c0b9-…                              quay      outer    <opaque>
728a4610-…                              quay      inner    <opaque>
b8dc91a6-…                              *         manager  <opaque>     ← 跨项目，无单一 project
# 服务发现表
project     endpoint
quay        127.0.0.1:<inbox-port>
archguard   127.0.0.1:<inbox-port>
```

- **未注册的会话发消息 ⇒ fail closed**（拿不到身份即拒发），与总线现有身份闸门一致。
- 注册挂在已有的 `quay manager start/adopt`（`quay.ts:1674`），**不新造入口**。
- **地址用逻辑名的第二个好处**：换 provider 时地址不变（`quay-github` 下解析成 issue，本机下解析成服务端点，上层不知道差别）。

### 4.2 三个面（各有各的理由，不冗余）

| 面 | 形状 | 非它不可的理由 |
|---|---|---|
| `inbox_send(target, text)` | **MCP 工具** | 只有 MCP server 能拿到 agent 改不了的 `CLAUDE_CODE_SESSION_ID` |
| `inbox_read()` | **MCP 工具** | 标 `consumed` 必须以该 role 的身份做 |
| `quay inbox watch --target <t>` | **CLI 进程** | Monitor 要的是**进程**，不是函数调用 |

**规则：调用形状的走 MCP，进程形状的走 CLI。**

**CLI 不提供 `send`** —— 因为 bash 里任何环境变量都能自己设，一旦 CLI 能发，身份立刻退回自述。
代价明说：**非 Claude Code 宿主暂时发不了消息**（没有可信身份来源）。
**宁可少一个宿主，不要一个假身份。**

### 4.3 通信序列

```
A 的会话                                    B 的会话
  │ inbox_send("quay:outer", text)
  ▼
A 的 MCP server
  ├─ 我是谁：CLAUDE_CODE_SESSION_ID → 注册表 → from="quay:manager"   ← agent 改不了
  ├─ 发给谁：target → 服务发现表 → endpoint
  ├─ POST <endpoint>/inbox   Authorization: <token>
  └─ 立即返回 {id, delivered:true}                    ← 不等 B，不看 B 的会话状态
                                       ┌────────────────────────────────┐
                        项目服务 ──────┤ 会合点：内存队列，per-target    │
                                       └────────────────────────────────┘
                                                    │  SSE / 长轮询
                                B 的 Monitor: quay inbox watch --target quay:outer
                                  ├─ 连上去等（非轮询），新消息 → stdout 一行
                                  │     "id | from | 前 80 字"
                                  ▼
                                harness → <task-notification> 落进 B 的会话
                                  │
                                  ▼ B 调 inbox_read() → 取全文 + 标 consumed
```

### 4.4 监听面分离（D7，硬性）

**消息注入端点不得挂在 web UI 的 listener 上。**

理由（实测）：web UI **绑 `0.0.0.0` 默认、当前绑 LAN IP、已有 POST 路由、且 ADV-003 刚修过其
POST 路径的一个 open-redirect 绕过**。把消息注入放同一个 listener 上，
**UI 的每一个漏洞都会变成消息注入漏洞**。

**要求**：同进程可以，但必须是**独立监听面**（独立端口 + 每会话 token）。
`from` **由服务端按 token 判定，永不采信客户端字段**。

---

## 5. 语义

只有两层，**没有第三层**（D4）：

| 层 | 含义 | 谁写 |
|---|---|---|
| `delivered` | 消息已进入服务的队列 | 服务 |
| `consumed` | 接收方调过 `inbox_read` | 接收方的 MCP（**全系统唯一写者**） |

**通道不承诺送达**：内存队列，服务重启即空。**这是刻意的**（D1）。

**「对方受理了没有」不归本信道管。** 它归 manager 的巡检实践（tick 时看 task store），
且遵守一条不对称原则：

> **「发现未受理」不得依赖接收方的配合；接收方配合只是让「确认受理」更精确。**
> （②e 的结构用在流程上：**证明某方失职的证据，不能由该方提供。**）

---

## 6. 硬约束与失效模式

### 6.1 服务形态消解掉的（**不要再把它们加回来**）

文件方案曾需要六条约束，服务化后五条消失——它们本来就是「多写者无协调」的补丁：

| 约束 | 文件方案为何需要 | 服务方案 |
|---|---|---|
| 一消息一文件 | 多写者并发 | **消失**（服务是单写者） |
| temp + `rename()` | 防读到半个文件 | **消失** |
| seen 集合在内存、不落游标文件 | 防两 watcher 互偷边沿 | **消失**（服务端记 per-consumer 位置） |
| 路径不从 cwd 推导 | worktree 会漂到 `/tmp/quay-wt-*` | **消失**（没有路径） |
| 收件箱在检出目录之外 | 防 `clean -fd` / `reset --hard` | **消失** |
| **一 target 一消费者** | — | **保留** |

### 6.2 服务形态**新引入**的失效（文件方案结构上没有）

**通道自己会死。** 文件收件箱在没有任何进程运行时照常工作；服务不在，发送方直接失败。

**处理方式（明确不这么做的也写下来）**：

- ✅ **发送失败必须硬失败、可见**，绝不静默丢弃。
- ❌ **不做「服务不可达就降级回文件」**——两套并存意味着两套都要维护，
  且降级路径永远是没被测过的那条。
- ❌ **不靠「再挂一个监视器盯服务」**——那又是一个会死的机制。
  代之以 **AC-7 的差分对表**（下）。

### 6.3 `watch` 的输出契约（每条对应一次实测教训）

| # | 约束 | 不这么做会怎样 |
|---|---|---|
| 1 | 一行 = `id \| from \| 前 80 字`，**不打全文** | 全文进通知会把事件流变成内容通道；且这样 `delivered`(通知) 与 `consumed`(`inbox_read`) 才是两件事 |
| 2 | **`watch` 只读，绝不写回执** | 一旦 watch 写 consumed，`delivered≠consumed` 当场死掉（`inbox-summary` 已有 READ-ONLY 先例） |
| 3 | **按 id 去重，只报新的，不发心跳** | Monitor 事件过多会被自动停掉 |
| 4 | **连上时先吐「未读」再进增量** | 否则挂晚了永远错过——2026-08-07 实测过一次「整个生命周期没有边沿可转换」 |
| 5 | 断线**自动重连**，重连后同 #4 | 服务重启后 watcher 静默 = 最隐蔽的失效 |

---

## 7. 旧 `.quay/manager-inbox/` 的处理（D9，**分四类，不可一律删**）

| 对象 | 处理 | 依据 |
|---|---|---|
| 目录内 6 个 `archguard-*.md` | **删** | 实测无任何运行时读取者 |
| `supervisor-bus-identity.sh:52` 默认路径、`inbox-reader.sh` | **重指向，不删** | 这是总线的**读侧**，删了就没人读 |
| `capability-catalog.sh:190` 的能力描述 | **改文字** | — |
| SPEC / 任务 `.md` / tick-log 里的历史提及 | **保留不改** | 是历史记录，改了就是篡改 |

---

## 8. 验收判据（AC，可机械核对）

```
AC-1 写侧存在：三方各自实跑发出过 ≥1 条真实消息（非测试）
AC-2 身份不可自述：伪造测试——直接对端点 POST 一个声称 from=<别的 role> 的消息，必须被拒；
     且 `from` 与注册表里该 token 对应的 role 一致
AC-3 发送方不阻塞：接收方会话处于忙碌态时，inbox_send 仍在 <1s 内返回 delivered
AC-4 监听面分离：消息注入端点与 web UI 端点【端口不同】；
     无 token 的请求被拒；web UI 端口上不存在任何注入路由
AC-5 非持久安全：服务重启后队列为空，且三方在 ≤1 个 tick 内不因此卡住
     （这是 D1「不假设持久」的真正验收，不是「消息删得掉」）
AC-6 推送延迟：从 inbox_send 返回到接收方 Monitor 打出事件行，中位 <5s
AC-7 差分对表：inbox_read 报 unread>0 而接收方本会话未收到过通知 ⇒ 判 watch 失效
     （进程存活只能发现「死了」，发现不了「活着但不响」）
AC-8 tmux 用量：连续 N 个 tick 内，不满足「紧急控制」定义的 tmux 发送数 = 0
     紧急控制 = (a) 停机/中断类指令；(b) 目标收件箱积压且目标空闲 ≥N 分钟（通道失效兜底）
     每次 tmux 发送必须在 tick-log 记原因码
AC-9 旧收件箱：§7 四类各自处理完毕；`git ls-files .quay/manager-inbox` 为空
```

---

## 9. 非目标（明确不做）

- **不做 `resolved` / ACK 协议字段**（D4）——收件箱是信道，不是工作流引擎。
- **不做重传、不做已读回执的强一致**——非持久前提下这些都是假保证。
- **不做「消息内容的持久化」**——正本在 task store，收件箱丢了最多晚一个 tick。
- **不做跨机 NAT 穿透**——当前三方同机；跨机（B/C）只需服务端点可达即可。

---

## 10. 实施顺序（D8，不可换）

1. **写侧**：注册表 + 独立监听面 + `inbox_send`（MCP）+ `manager` target
2. **消费侧**：`inbox_read`（MCP）+ `quay inbox watch`（CLI）+ 各方挂 Monitor
3. **才收紧 tmux**：AC-8 生效

> **顺序的理由是付过代价的**：manager 于 08:31Z 下过一次 outer→manager 的 tmux 硬禁，
> 而当时 ①② 都不存在——**先禁旧通道、再建新通道**，正是本仓批过的
> 「退役一个机制却没写下它覆盖的判据归谁」。outer 退回用 git 提交通信，碰巧可行，
> **是运气不是设计**。该硬禁已于 09:0xZ 降级为「优先用其它通道」，待第 3 步恢复。

---

## 11. 承载技术：进程内 + 复用已有服务（D13，人 2026-08-08 09:5x 裁定）

**裁定原文**：「就用『进程内 + 复用已有服务』，不考虑 Redis/NATS。」

**实现形态**：队列是**每 target 一个进程内结构**，挂在**已经在跑的 quay 服务进程**里
（quay:4173、archguard:4174 —— 后者跑的正是已安装的二进制），
**独立监听面**（D7）+ SSE 推流。**不引入任何外部 broker。**

**这条裁定的三个依据（实测，写下来防止被重新辩一遍）**：

1. **量级不匹配到荒谬**：实测消息量 **≈20 条/小时**；Redis 的设计点是 10 万 ops/秒，
   **差七个数量级**。**队列机制从来不是这件事的难点。**
2. **broker 不解决任何一个真难点，还让其中一个变差**：

   | 难点 | broker 有帮助吗 |
   |---|---|
   | **身份**（`from` 必须服务端盖章、不可自述） | **完全没有**——Redis/NATS 不知道「哪个会话发的」；**MCP 盖章层一条都省不掉** |
   | **存活**（§6.2「通道自己会死」） | **变差**——身份层省不掉 ⇒ 变成**两个进程都要活着**，失效面翻倍 |
   | **产品化**（D2） | **变差**——quay 现在是 `npm i` + node（运行时依赖仅 2 个：`@modelcontextprotocol/sdk`、`yaml`），加 broker 等于要求每个用户装并运行它，**为了每小时 20 条消息** |

3. **没有比它更轻的了**：那个服务**已经在跑**，SSE 用 node 自带 `http` 就够，
   **零新增依赖、零新增进程**。增量约等于「一个 listener + 两条路由 + 一个数组」。
   （实测：本机 `redis-server` / `nats-server` / `mosquitto` **均未安装** ⇒ 全都是真新增安装要求。）

**本裁定的前提（写明，因为前提变了结论才需要重看，而不是因为有人想换技术）**：
依据 1 建立在**每小时约 20 条**这个实测量级上；依据 2 的「存活变差」建立在
**身份必须由 MCP 盖章**（D5）之上。**这两个前提本身没变时，本条不重开。**

---

## 12. 修订 —— 2026-08-08 14:5xZ 之后的实测输入（本节由 manager 追加，均为**实测**，非推断）

### 12.1 D5 的身份根**会随 `/clear` 变**（这条使 D5 在当前形态下不成立）

实测：对 outer 连发两次 `/clear`，其会话 id 依次为 `3cc1c0b9 → fcf04ca2 → 7795bb75`；
**清后由它派生的进程带的 `CLAUDE_CODE_SESSION_ID` 正是新 id**（`pid=2883208` 实读）。
⇒ D5 把身份绑在该变量上、D11 又规定「未登记的端点不可寻址（fail closed）」，
两者合起来意味着 **每清一次上下文，该 role 就失去发信能力，直到重新注册**。
**SPEC 写于 08:3x，那时还没做过 `/clear` 实验** ⇒ 必须补再注册路径，或改绑一个不随 `/clear` 变的量。
（附带实测：`CLAUDE_CODE_SESSION_ID` **不在 claude pane 进程自身的环境里**，
只注入它派生的工具/MCP 进程 —— 身份来源是「派生时注入」，不是「进程属性」。）

### 12.2 消费侧的 Monitor 进程会被清理器扫掉（§6.2 追加一条实测失效）

实测：`sweepTmp` 的 `pkill -f` 一次杀光**两层**的 `session-liveness` 观测者
（已立案 `682ee526`；当时全机 4–5 个实例只剩 1 个 etime=4s 的新进程）。
**`quay inbox watch` 是同一进程形态，继承同一暴露面。**
⇒ §6.2 增列：**清理器按进程名/路径匹配杀进程时，无法区分「泄漏残留」与「在用实例」**；
判据应为**属主会话是否存活**，不是名字匹配。**「观测者被杀」这件事本身没有观测者。**

### 12.3 tmux 作为主信道的摩擦是可量的（支持 D3，不是理由的重复）

本轮实测：manager→outer 的每条长消息都撞 `paste again to expand`，**每次都要回读目标 transcript 才能确认送达**。
⇒ D3「tmux 仅用于紧急控制」的依据从"设计偏好"变成"每次投递都在付的成本"。

### 12.4 **`manda` 可能已经提供了本 SPEC 要建的东西**（今晚第七次「对象存在，我没去找」）

`.manda/config.yml` **已在本仓**，且已含：`channels: ["inbox-*"]`、`manda send <target> <json>`、
`reply_to` 约定、`cap-requests-{name}` / `cap-results` 双向信道、`manda-dispatch cross-session` 适配器、
`mcp_adapters`（`manda-dispatch mcp` / `manda-tools mcp --self {name}`，带 `allow` 白名单）、
`audit` 与 `monitor` 两段。源码树在 `/home/yale/work/manda`。
本仓 `docs/references/geometry-as-llm-architecture-interface.md:38` 记的架构反转是
**「`manda watch` 进程即 server」** —— **正是本 SPEC D13 与 `quay inbox watch` 那一面的形状**。

**身份模型的关键差异（这条改变结论，不只是补充）**：
```
SPEC   身份根 = CLAUDE_CODE_SESSION_ID（D5）+ 硬性注册表（D11）
manda  身份根 = 「port-is-identity」(TASK-6)：no instance registry
       docs/dispatch-addressing.md:20 / docs/extensions.md:345
```
⇒ **manda 的身份模型免疫 12.1 的失效**（进程不退、端口不变，`/clear` 影响不到它），
且用**少一个机制**（不要注册表）达到同样的 fail-closed —— 与 D11 拒绝自动分配的理由同源。

**诚实的限度（不得据此直接采用）**：
1. `port-is-identity` 我读的是**它的文档**；`internal/dispatch` / `internal/caps` 里 `Sender|From` **grep 零命中**，
   **没有读到实际盖章的代码路径** ⇒ 采用前必须先验证「发送方身份由服务端确定，调用方改不了」。
2. **manda 不在 PATH、本机零进程、本会话无 `mcp__manda__*` 工具** ⇒ 现状是「结构上能」，不是「现在就能」。
3. **采用与否是范围决定，归人**（§1.5：改变 AC 本身 ⇒ 问人）。manager 只给实测与判据形态。

**⇒ 建议的下一步（若采用）**：先做一次**最小可证伪实验**——两个会话各起一个 manda daemon，
A 用 `manda send` 发给 B，B 在**不信任发送方自述**的前提下确认 `from` 与端口绑定；
**该实验失败 ⇒ manda 不满足 D5，本 SPEC 按原路走**。
