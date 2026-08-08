# 架构推演：哪些该进 Claude Code，哪些留在外面

**日期**：2026-08-05（管理者）
**触发**：人问「彻底与 Claude Code 集成是一种可能形式——哪些部分应当集成到 CC 内部，
哪些仍保留为独立工具和文本？考虑到短期做不到真集成，再推演一个与 CC 分开、但自身内部
集成度更高的形态。」
**方法**：不从设计偏好出发，从**今晚 12 小时里实际把我们打伤的每一处**出发归类。
**AC/DoD 与立案由外层判断。**

---

## 1. 先把今晚的事故按「谁的责任」分类

| # | 事故 | 代价 | 根因归属 |
|---|---|---|---|
| 1 | `CronCreate`/`ScheduleWakeup` 随会话死亡 | 三次崩溃 → 网络永久静默死亡；meta-cc/archguard 停摆 **29 小时** | **CC 缺持久调度** |
| 2 | `Monitor` 随会话死亡（outer 现有 6 个） | 崩溃即全丢，不留痕迹 | **CC 缺持久调度** |
| 3 | outer 看不到 inner 的在飞数/空槽 | 12 个可派发 vs 1 个在飞，**11 槽闲置且双方都看不见** | **CC 缺会话状态 API** |
| 4 | `send-keys` 作为进程间通道 | **6 种失败模式**；NBSP 判空让脚本对**任何**输入框失效；三个消费者全静默绕过 | **CC 缺会话间消息接口** |
| 5 | agent 的消息以 user 身份进入我的会话 | 权限边界被打穿，`userType:external` 与真人**完全不可区分** | **CC 缺发送方身份** |
| 6 | 只有 transcript 可信；pane 哈希 3 次假阳性、heartbeat 冻结 42 分钟 | 每个判断都要三重核实 | **CC 缺会话状态 API** |
| 7 | `.halt` 挡不住 inner 的自主循环 | halt 后仍派发 5 个 subagent、合并 4 次 | **CC 缺抢占原语** |
| 8 | 测试夹具泄漏 tmux server（217 + 12） | PSI 94 → 资源门 WAIT → 套件被迫 ABORT ×3 | **我们自己**（teardown 缺失） |
| 9 | `laneCount` 不传播、资源门被绕过 | 9× 超订、两次 ABORT | **我们自己**（产品 bug） |
| 10 | 恒真判据、无人调用的写入方、死 glob | 缺陷静默通过 | **我们自己**（设计卫生） |

**关键观察：1–7 全部是「CC 没有的原语，我们用屏幕抓取和文件轮询假装出来」，而它们
占了今晚代价的绝大部分。** 8–10 是普通的工程债，修就完了。

---

## 2. 三层划分（这是回答「哪些进 CC」的判据）

| 层 | 内容 | 归属 | 理由 |
|---|---|---|---|
| **基座** | 调度、消息+身份、会话状态、槽位账本、抢占、资源门 | **应进 CC** | 它们需要**在 agent 会话之外存活**。任何在会话内的实现都会随会话死亡——这是今晚三次崩溃的机制根 |
| **机件** | 任务库、闸门、检查器、遥测、resource-gate | **留在外面（可执行）** | 与 CC 无关，是**领域逻辑**。94 个 `plugin/scripts` + 14 个 gate-scripts 属于此层 |
| **行为** | loop tick 文档、`## Contract`、AC、ADR、指令 | **必须留作文本** | 它们的价值恰恰在于**被 LLM 读取并适应**。变成代码就失去了这一点 |

**推论：能进 CC 的只有基座层，而且必须整层进——半层进会更糟**
（例：给了持久调度但没给会话状态，调度器仍然只能靠 pane 哈希判断该不该唤醒）。

---

## 3. 若能真集成：CC 侧需要的五个原语

按今晚代价排序，不是按实现难度：

1. **持久调度**（对应事故 1、2）：一个不随会话死亡的 timer，会话重启后自动重新绑定。
   判据：kill 掉会话进程，N 分钟后循环自己回来了。
2. **会话间消息 + 发送方身份**（事故 4、5）：`send(target_session, payload, from=<identity>)`，
   接收侧能区分「人」与「agent-X」。判据：接收方能拒绝一条声称来自人的 agent 消息。
3. **会话状态 API**（事故 3、6）：`{busy|idle|blocked, in_flight_subagents, last_input_at}`。
   判据：不需要读 transcript、不需要 capture-pane 就能回答「它在忙吗/还剩几个槽」。
4. **抢占**（事故 7）：一个能在**任意执行点**生效的停止信号，不只在 tick 边界。
   判据：halt 后不再产生任何新的 subagent。
5. **子代理槽位账本**（事故 3）：由运行时维护，不靠应用自己记账——今晚的遥测
   `--task-start/--task-end` 从没被调用，判据 `inProgress ≤ 3` 因此**恒真**。

**MCP 不是这一层的答案。** 现有 `mcp-server.ts` 已经在暴露任务库（机件层），这条路是通的；
但 MCP 是**会话内**调用的工具，它同样随会话死亡，无法承载基座层。
⇒ **机件层继续走 MCP，基座层走不通。**

---

## 4. 做不到真集成时的形态：一个 supervisor 守护进程

**核心思路：把今晚那 7 类「假装出来的基座」从三个 agent 会话里抽出来，收进一个不随会话
死亡的进程。** 它是**基座，不是第四层 agent**——这一点必须钉死。

### 4.1 它做什么

| 职责 | 替代掉今晚的什么 |
|---|---|
| 定时唤醒各层 | `CronCreate` / `ScheduleWakeup`（会话作用域） |
| 唯一的投递实现 | 三个 agent 各自手写的 `send-keys` 序列 |
| 投递校验 | 各自的 pane 哈希 / transcript 核对 |
| 会话状态 | pane 哈希 + heartbeat + transcript 三重猜测 |
| 槽位账本 | 从没被调用的遥测括号 |
| 抢占 | `.halt` 文件（挡不住连续流程） |
| 资源门守卫 | 被 `full-suite-runner` 绕过的 `resource-gate.sh` |
| 消息总线（带发送方身份） | `.quay/manager-inbox/`（我今晚临时建的） |

### 4.2 它明确**不**做什么（防止它长成第四层）

- **不做任何判断**：不决定派发什么、不排优先级、不裁定。它只搬运状态和消息。
- **不读任务内容**：任务库仍归 quay CLI/MCP。
- **不写代码、不跑测试**：那是 inner 的活。

> 判据：supervisor 的任何一行代码若需要「理解任务在讲什么」，就是越界了。

### 4.3 【已更正 2026-08-05，人指出】那条「绕不开的约束」是错的

**本节原先写**：CC 会话只能通过 TUI 收输入，`claude -p` 只接受 API key 不接受
Pro/Max 订阅，是计费风险，⇒ 注入只能走 tmux。

**错在把 manager 的计费模型推广到了三层。** 人指出：outer 和 inner **早就跑在
deepseek API key 上**（实测两侧 transcript 的 `message.model` 均为 `deepseek-v4-flash`）。
⇒ 对它们而言 `claude -p` 与现状**是同一个计费模型**，不构成任何障碍。
那条约束**只对 manager 成立**（manager 跑在 Anthropic 订阅上）。

### 4.3b `claude -p` 直接解掉五个缺失原语里的四个

一旦 outer/inner 走 headless，投递不再是「注入 TUI」而是「起一个进程」：

| 缺失原语 | TUI 形态（今晚） | `-p` 形态 |
|---|---|---|
| 会话间消息 | `send-keys` + 6 种失败模式 | **进程参数**——不可能 NBSP、不可能 ghost placeholder |
| 投递校验 | pane 哈希（3 次假阳性）/ transcript 核对 | **进程退出码 + stdout** |
| 会话状态 | pane 哈希 + heartbeat（冻结 42 分钟） | **进程在不在** |
| 槽位账本 | 从没被调用的遥测括号（判据恒真） | **子进程数——OS 就是账本** |
| 抢占 | `.halt`（挡不住连续流程） | **kill 进程——任意点生效** |

⇒ **不是「supervisor 帮我们把 tmux 用好」，是「走 -p 之后 supervisor 要做的事少了一大半」。**

### 4.3c 可行性的关键前提：已经满足

headless 的最大风险是**每次 tick 都是空上下文**——而当前 outer/inner 的连续性
依赖长驻会话里累积的上下文。**但 tick 文档已经为此设计过**：
`fast-mode-loop-tick.md` 开篇就是「## 冷启动（`/clear` 后的空上下文）」，
规定读四份文件 + 跑三条命令建立实况，并明写**「以实测为准，不以队列文件为准
——它可能是 compact 前的旧快照」**。
⇒ **「从空上下文重建状态」不是要新造的能力，是已经在跑的路径。**

### 4.3d 真实的代价（不掩盖）

- `Monitor` 工具在 `-p` 下不可用（今晚已调研确认）——但 supervisor 本来就要接管定时与观测
- `CronCreate` 是会话作用域，而 `-p` 会话短命——同上，调度归 supervisor
- **人无法再 attach 上去看/打字**——这是真损失，需要另一套可观测性（日志/Web UI）来补
- 长会话内的隐性连续性会消失，**任何没有落盘的状态都会丢**
  ——这既是代价，也是好处：它会把「只存在于某个会话上下文里」的隐性状态逼成显式文件

### 4.3e 次序（人 2026-08-05 裁定）

> **先在 archguard / meta-cc 上把产品化验证完，再开 `claude -p` 实验。**

理由（管理者补充）：`-p` 改的是**运行形态**，产品化验证的是**交付内容**。
先验交付、再换形态，任何一处坏掉都能立刻归因；两件事同时动，就分不清是
交付缺件还是形态不适配。

### 4.3f 在 `-p` 之前，tmux 仍在时的处置

**观测路径现在就能清零**：`session-liveness.sh` 自己已经用行动投票——
transcript 引用 **85 次** vs `capture-pane` **2 次**；今晚实测可信度
（pane 哈希 3 次假阳性 / heartbeat 冻结 42 分钟 / transcript 0 次误判）
支持把剩下那 2 次也去掉。ADR-016 早已把 screen-use 收敛到「只看底部输入框」。

**投递路径隔离成窄接口**：`send-keys` 只出现在 **2 个文件**里，耦合面本就很小。
接口按**意图**表达而非终端操作——`deliver(session,payload)->delivered|failed`、
`observe(session)->{busy,idle,blocked,last_at}`——这样换成 `-p` 进程时，
换掉的是一个适配器，不是散落在 24 个文件里的 tmux 动词。

**注意一个症状**：`send-keys-reliable.sh` 今晚被证明对任何输入框都不可用，
而三个消费者**全都绕过它自己手写序列**——**绕过行为本身就是「窄接口不存在」的症状**。

### 4.4 落地次序（按今晚代价，不按难度）

1. **持久调度**（唯一能防止「崩溃 = 永久死亡」的一条）
2. **槽位账本 + 会话状态**（直接解 11 槽闲置，且是当前吞吐的主要损失）
3. **投递集中化 + 真 TUI e2e**（NBSP 那一族的结构性解）
4. **抢占**（`.halt` 语义从「tick 边界检查」改成「任意点生效」）
   → **已落地 2026-08-06**（`tasks/gap-supervisor-preemption`）：`supervisor-preempt.sh` 基座层原语
   （halt-check 读哨兵 / preempt 对目标发停止信号——TUI 形态 tmux C-c，`-p` 迁移后 `kill <pid>` /
   preempt-all halt 时对全部在飞层发信号）；新派发被 `slot-refill.ts` 的代码挂载点挡住
   （`.halt` 存在 ⇒ `should_refill=false`）。`preempt` 的「任意点生效 + 不依赖被抢占方主动调用」
   与 SPEC-isolation-and-resource-governance §2「限额不可被绕过」同族（AC3 交叉标注）。
5. **消息总线带身份**（把我今晚临时建的收件箱正式化）

> **落地标注（2026-08-06，`gap-supervisor-message-bus-with-identity`）**：第 ⑤ 步已落地——收件箱
> 正式化为带身份的传送带信道。`deliver(target, payload, from=<identity>)` 携带发送方身份
> （`IDENTITIES` = human/manager/inner/outer）；agent 信道（session transport）只服务 agent 身份，
> **声称 `from:"human"` 的 agent 消息在注入前被拒**（AC2 spoof gate，fail-closed）；
> `deliver(human)` 的「已投递 / 已读」两字段分开建模（AC3）；tick 的读状态/观察步显式读收件箱
> （`supervisor-bus-identity.sh inbox-summary`）——「文件在、无人读」的失败形态有机械挂载点（AC4）。

### 4.5 补充（2026-08-06，人给出方向）：**人是第三个 target**

第 5 项「消息总线」原本只想着机器之间。人指出 web 面应当承载**人 ↔ manager/outer 的 chat 信道**
⇒ 这两件事**是同一个机制**，不该做成两套：

| target | `deliver` | `observe` |
|---|---|---|
| inner | `send-keys` → 校验目标 transcript | `classifyPaneState`（已参数化 `--target`，2026-08-05 落地） |
| outer | 同上 | 同上（管理者盯外层已实测可用） |
| **human** | **写收件箱 / web 推送** | **「他读了没有」——回执，不是缺席推断** |

**唯一实质差别**：人不能被注入，只能等他自己来读 ⇒
`deliver(human, …)` 的语义是「投递成功」，**不是「已送达意识」**，两者必须分开建模。

**已验证的同构先例**：`inner-blocked-signal.ts` 的 `--target` 参数化让 inner/outer/manager
各成为「一次调用」而非各写一份——**观测方向的通用化已经做过了，投递方向应当同构。**

**次序上的一条硬约束**：`.quay/manager-inbox/` 今晚的失败形态是**文件在、无人读**
⇒ **信道正规化的第一优先级不是投递，是消费者的机械挂载点**（tick 的某一步显式读收件箱）。
否则又是「写了但不在决策时被调用」——本仓 AC9/AC10 反复踩的同一个坑。

**展开见** `docs/proposals/quay-message-bus-human-in-the-network.md`
（含 AC12b 因此第一次可机械测量的论据，以及它自身的 fail-safe 缺陷）。

---

## 5. 与「克制层数增长」的关系

人先前明确：*「未来出现第四层我也不会太意外，但我在非常克制地处理这一层次的增长。」*

**supervisor 不是第四层 agent**——它没有判断力、不参与决策、不消费任务语义。
它是把 manager/outer/inner 三层**共同依赖但都不该自己实现**的东西沉下去。
三层的**决策结构完全不变**，变的是它们不再各自用屏幕抓取假装基座。

**反过来说：如果 supervisor 开始需要做判断，那说明它设计错了，
应当把那个判断退回给对应的 agent 层。**

---

**本文件不建 AC/DoD、不排优先级——那是外层的活。**
管理者提供：今晚 10 类事故的责任归类、三层划分判据、CC 侧五原语、
supervisor 的职责边界与落地次序。
# 规格：集成架构——基座层必须活在 agent 会话之外（supervisor）

**日期**：2026-08-05（管理者；2026-08-06 由 `gap-supervisor-base-layer-outside-sessions-architecture` 落地成文）
**触发**：人问「未来如何处理此类问题？」（资源治理，见 isolation 规格）；管理者把今晚 10 类事故倒推成三层判断。
**性质**：**集成架构规格**——基座层（BASE）为什么必须活在 agent 会话**之外**、它如何被一个不随会话死亡的
supervisor 守护进程收编、按什么次序落地。本文件是 `SPEC-state-crystallization-2026-08-05.md`（AC8）与
`SPEC-isolation-and-resource-governance-2026-08-05.md`（AC9）的**上位合流点**：两份规格各自的「实体该归谁」
与「边界该怎么划」都指向同一个宿主——**不随会话死亡的基座进程**。
**AC/DoD 与立案由外层判断。** 本文件给架构判据与落地次序。

---

## 1. 实测：今晚 10 类事故，7 类是我们在会话里伪造的 CC 原语

今晚每一类事故的根，都能落进三层判断中的某一层。**关键不是分类，是分布**：

| # | 事故类（实测） | 层的判断 | 它伪造的 CC 原语 |
|---|---|---|---|
| 1 | 崩溃后无法自恢复（三次全灭 + 29h 停摆） | **BASE** | 调度/周期锚点（CronCreate/ScheduleWakeup 全是会话作用域） |
| 2 | NBSP 判空坏数小时，3 个消费者全绕过，零真 TUI 测试 | **BASE** | 投递实现（send-keys 是唯一可靠操作，却每个会话各写一遍） |
| 3 | 送达确认三信号全假（哈希/输入框空/SESSION-RESUMED） | **BASE** | 投递校验（唯一可信 = 目标会话自己的 transcript） |
| 4 | 「几个任务在飞」六个源四个答案 | **BASE** | 会话状态（Session 实体无权威家） |
| 5 | 遥测括号 ≠ 真实 subagent 并发（5 bracket vs 1 agent） | **BASE** | 槽位账本（--task-start/--task-end 没被调用） |
| 6 | 资源门被绕过（ABORT #5，runner 0 次调用） | **BASE** | 资源门守卫（必须主动调用才生效 = 没有限额） |
| 7 | `.halt` 挡不住连续流程（inner 绕过步骤 0 仍派发 5 个） | **BASE** | 抢占/暂停（规则无机械挂载点） |
| 8 | tmux 泄漏 217 / 并发 8 / ugrep 8.8GB | **MACHINERY** | ——（资源耗尽由 isolation 规格承接，见 AC9） |
| 9 | 套件耗时/每测试成本/晋级速率恶化无人报 | **BEHAVIOR** | ——（趋势判据应留文本，由生成器承接） |
| 10 | 假 OVER90 冻结（92min 被假信号吃掉） | **BASE（复发）** | 槽位/会话状态（#4/#5 同一原语的下游复发——崩溃遗留 bracket 不闭合） |

**7/10 落在 BASE（7 个不同的伪造 CC 原语；#10 是 #4/#5 原语的复发，不另算一类）。**
而且这不是边缘统计——这 7 类是今晚**工时的大头**：管理者今晚绝大部分时间花在
「调和互相矛盾的状态源」（state-crystallization §1）和「修一个又坏一个的投递」（CRYSTALLIZED-reliable-send）。

**这 7 类的共同形态**：都是 CC（Claude Code）平台已经有的原语（定时唤醒、消息投递、会话存活、进程账本、
抢占、资源门），我们却**在 agent 会话里用屏幕抓取 + 文件轮询重新实现了一遍**——每次实现都脆弱、每次都是
「写下来了但没人调用」或「被绕过了」。**在会话里伪造平台原语，是今晚所有代价的机制根。**

---

## 2. 三层判据（可判定，不靠品味）

> **基座（BASE）**：调度 / 消息+身份 / 会话状态 / 槽位账本 / 抢占 / 资源门——必须是**平台级原语**，
> 进 CC 能力或**出会话**（outlive 会话）。
> **机件（MACHINERY）**：94 脚本 + 14 门 + 任务存储——保持**可执行**，留在会话外（走 MCP 调用）。
> **行为（BEHAVIOR）**：loop-tick 文档 / Contract / AC / ADR / 指令——**必须留文本**。
>
> 任何新机制归属时问一句：**它是「事实/原语」还是「规则/理由」？** 事实与平台原语 ⇒ 基座（进代码/出会话）；
> 可执行机制 ⇒ 机件（脚本/MCP）；规则与理由 ⇒ 行为（文本）。

| 层 | 判据 | 价值形态 | 反面（错位时） |
|---|---|---|---|
| **BASE** | 平台原语（调度/消息/状态/槽位/抢占/资源门） | 进程存活 + 确定性操作 | 在会话里用屏幕抓取/文件轮询伪造 ⇒ 每次崩溃重写、每次绕过 |
| **MACHINERY** | 可执行的机制（脚本/门/存储） | 会话外可运行、走 MCP 调用 | 退化成散文描述 ⇒ 没有执行者 |
| **BEHAVIOR** | 规则与理由（tick 文档/Contract/AC/ADR/指令） | 被 LLM 读 + 适应，价值 = 文本本身 | 变代码 ⇒ 价值归零（新项目语义不同，代码改分支） |

**判据的精细处**（state-crystallization §2.1 最后一行的延伸）：规则可以留文本，但**规则的强制点必须在
代码里有挂载**。`.halt` 的教训：规则说「步骤 0 检查」，连续流程没有步骤 0，规则就失效了。挂载点在代码里、
规则文本在文档里——这是「行为留文本」不变成「行为没人执行」的前提。

---

## 3. 为什么基座必须离开会话（而不是继续在会话里伪造）

三条实测理由，每一条都独立成立：

1. **锚点随会话死**（gap-loop-has-no-os-level-anchor）：CronCreate / ScheduleWakeup 是**会话作用域**——
   会话一死，锚点**永久消失且不留任何痕迹**。三次崩溃 + 两个项目停摆 29h，死循环与健康循环的判据**完全一样**。
   修复必须活在会话外（OS 级 systemd user timer / crontab）。
2. **MCP 不是基座层的答案**：MCP server 是**会话作用域**的——会话死，MCP 连接死。**机件**可以继续通过 MCP
   调用（脚本与存储留在会话外），但**基座**（要 outlive 会话的那个东西）不能依赖 MCP。基座必须是一个**进程**。
3. **七个基座职责被三会话各写一遍 = 七个脆弱点**：投递、会话状态、槽位账本……每个 agent 会话都手写一份，
   每一份都只有它自己的屏幕视角。**集中化**是唯一能同时消除「多写入者无权威」和「屏幕抓取脆弱性」的方向。

---

## 4. supervisor 守护进程：当真正的整合不可能时

**前提**：理想情况下基座应该「进 CC 能力」（平台原语）。**当真正的整合（进 CC 能力）不可能时**——例如 CC 只
接受 TUI 输入、`claude -p` 只接受 API key 不接受 Pro/Max 订阅（计费风险，见 §6）——**一个 supervisor 守护进程**
把 7 个伪造的基座职责从 3 个 agent 会话收进**一个不随会话死亡的进程**。

### 4.1 收编的职责清单（从三会话里抽出来）

| 职责 | 现状（伪造方式） | supervisor 里变成 |
|---|---|---|
| 周期唤醒 | 各会话 CronCreate/ScheduleWakeup（随会话死） | systemd user timer 触发（OS 级，已落地 = 步骤①） |
| 唯一投递实现 | 每个会话手写 send-keys 序列 | **一处硬化**的投递实现 |
| 投递校验 | 各会话各认一个信号（全假过） | transcript-delivery-check（唯一可信信号） |
| 会话状态 | transcript + pane + ps 反推 | Session 实体（唯一写入者） |
| 槽位账本 | 遥测括号（没人调用） | Slot/Ledger 实体（唯一写入者） |
| 抢占 | `.halt` 文件（挡不住连续流程） | 确定性抢占操作（进程/时长/槽位等可查询事实驱动） |
| 资源门守卫 | resource-gate.sh（被绕过） | 守卫接线（不可被「忘记调用」；配合 cgroup 硬限额，AC9） |
| 带发送者身份的消息总线 | 各会话裸 send-keys、无身份 | 每条消息携带发送者身份（哪层/哪项目） |

### 4.2 边界判据（AC2：无判断 / 不读任务 / 不写代码）

> **supervisor 明确不做判断、不读任务内容、不写代码。**
> **越界判据（在代码评审可查）：任何一行需要「理解任务在讲什么」就是越界。**

- **不做判断**：不决定「该不该派发/该不该停」——那是 outer/inner 层的判断，supervisor 只提供可查询的事实。
- **不读任务内容**：不解析 Proposal/Plan/AC 的语义——它只读**可查询的事实**（进程在不在、跑多久了、
  槽位空不空、资源够不够、消息送没送到）。
- **不写代码**：不改任务文件、不改仓库内容——它只投递、校验、记录状态。

**反过来裁定**：若 supervisor 开始需要判断（要理解任务语义才能行动），**说明设计错了**——把那份判断
**推回对应的 agent 层**。这是 §8「克制层增长」的机制含义。

### 4.3 分层决策结构不变

supervisor **不是第 4 个 agent**——它无判断、无决策、无任务语义。三层决策结构（manager → outer → inner）
**不变**，只是每一层不再用屏幕抓取伪造基座：基座是它们脚下共享的、不随会话死的地基。

---

## 5. MCP 不是基座层的答案（为什么「机件走 MCP」和「基座出会话」是两件事）

`SPEC-complete-delivery-surface` 与 `quay-product-outline` §5 已经确认：**机件（94 脚本 + 14 门 + 任务存储）
可以且应该继续走 MCP**——它们是会话外的可执行对象，MCP 是它们的调用面。**基座不能**：

| | 机件（MACHINERY） | 基座（BASE） |
|---|---|---|
| 生命周期 | 会话外可执行，MCP 只是调用面 | 必须 outlive 会话，MCP 连接随会话死 |
| 失败模式 | 脚本 bug → 修脚本 | 会话死 → 锚点/状态/投递全没 |
| 宿主 | 磁盘上的脚本 + 存储 | **一个进程** |

**一句话**：机件是「别人调用的程序」，基座是「没人在也活着的进程」。MCP 能承载前者，承载不了后者。

---

## 6. 不可避免的约束（TUI-only）与集中化的收益

**约束**：CC 目前只接受 TUI 输入。`claude -p` 接受的是 API key，不是 Pro/Max 订阅——有计费风险。
因此**投递仍然走 tmux**（AC5c 裁定：先验交付、`-p` 未开）。这不是放弃，是承认当前形态的边界。

**集中化的收益**（为什么「仍然走 tmux」不等于「维持现状」）：

> **唯一不可靠的操作从「3 个 agent 各写一遍」变成「一处硬化实现 + 真 TUI 端到端测试」。**

**NBSP 缺陷是反例，正是集中化的论据**：send-keys 判空坏了几小时，3 个消费者全部绕过（各自用自己的土法），
**零真 TUI 测试覆盖**——坏的时候没有任何一方报警。若投递是**一处硬化实现** + **真 TUI e2e**（AC5），
NBSP 这类缺陷会在合并时被测试拦住，而不是让 3 个消费者在坏掉的通道上静默绕过数小时。

---

## 7. 落地次序（按今晚代价，不按难度）与对应任务

**次序原则**：先落地「代价最大、今晚痛得最深」的，不按实现难度排。每一步**都有对应任务**（AC3）；
既有基座任务**标注为 supervisor 步骤，不新开重复任务**（AC4）。

| 步骤 | 内容 | 对应任务 | 状态 | supervisor 职责收编 |
|---|---|---|---|---|
| **① 持久调度** | OS 级周期锚点，不随会话死 | `tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash.md` | done | 周期唤醒（systemd timer + os-anchor-watchdog.sh） |
| **② 槽位账本 + 会话状态** | 「几个在飞」单一答案；六实体唯一写入者 | `tasks/gap-telemetry-brackets-vs-subagents-no-slot-visibility.md` | ready | 会话状态 + 槽位账本（Session/Slot 实体） |
| **③ 投递集中化 + 真 TUI e2e** | 唯一不可靠操作一处硬化 + 真 TUI 端到端测试 | `tasks/gap-reliable-send-crystallize-the-five-failure-modes-into-a-script.md` + `tasks/gap-send-keys-reliable-nbsp-empty-check-is-broken-for-any-input-box.md` | done | 唯一投递实现 + 投递校验 |
| **④ 抢占** | 确定性抢占（超时/资源争抢/高优先派发时 kill 子进程树） | `tasks/gap-supervisor-step-4-preemption.md`（本规格立案） | todo | 抢占 |
| **⑤ 消息总线带身份** | 每条消息携带发送者身份（哪层/哪项目） | `tasks/gap-supervisor-step-5-message-bus-with-identity.md`（本规格立案） | done（2026-08-08 `supervisor-bus.sh --send --from <layer> --to <target> --payload <msg>`，ledger 记谁→谁→何时→是否送达） | 消息总线 + 发送者身份 |

**AC4 标注**：① = `gap-loop-has-no-os-level-anchor`（OS-anchor），② = `gap-telemetry-brackets-vs-subagents-no-slot-visibility`
（slot-visibility）——已在各自任务体标注为 supervisor 步骤（见两任务体的 `## Supervisor step` 交叉注）。
**不新开重复任务**：①、② 不重开；③ 复用已落地的 reliable-send/NBSP 任务，不重开。

---

## 8. 与人的「克制层增长」关系

人的裁定：**层数增长是被刻意克制的**（quay-product-outline §7）。supervisor 是基座，**不是第 4 层**：

- 无判断力、不参与决策、不消费任务语义 —— 决策结构仍然是 manager → outer → inner 三层；
- 它只是把「各层脚下都要踩的地基」从「每层各伪造一份」变成「一份共享的、不随会话死的」；
- **若 supervisor 开始需要做判断，说明设计错了** —— 把判断推回对应的 agent 层（§4.2）。

---

## 9. 状态结晶（AC8，引用 `SPEC-state-crystallization-2026-08-05.md`）

基座收编状态的前提是**状态结晶**：六个实体（Task / Run / Session / SuiteRun / Signal / Resource）各**恰好
一个写入者**。两份规格在此合流——**supervisor 是结晶状态的自然宿主**：它不随会话死亡，因此状态也不随会话死亡。

实体化设计准则（落地 ② 槽位/会话状态时执行）：
1. **名词进代码，动词留文本**——「已完成/在飞」是事实 ⇒ 进代码；「red ⇒ 停派」是规则 ⇒ 留文本；
2. **规则引用状态字段名，不复述状态**——写 `suiteState.reason == 'aborted'`，不写「套件因为资源被中止了」；
3. **每条规则有机械挂载点**——`.halt` 的教训：规则说「步骤 0 检查」，连续流程没有步骤 0，规则就失效了；
4. **禁止手写逃生舱**——`note` 字段那次：schema 不够用时人会发明字段。**逃生舱出现的位置 = 缺失字段的位置**。

**验收基准（实测可判）**：实现后问「现在有几个任务在飞」，遥测 / 阻塞信号 / 会话状态 / 槽位账本各源答案
**应一致**——从今晚的「六个源四个答案」收敛到单一答案。

---

## 10. 隔离与资源治理（AC9，引用 `SPEC-isolation-and-resource-governance-2026-08-05.md`）

资源事故（§1 事故 8）的边界设计：

- **留在宿主（不进容器）**：supervisor / watchdog / 共享状态存储（六实体）/ manager——必须能看见并重启所有容器；
- **每项目一个容器**：outer + inner + 该项目工作树与套件运行；
- **跨边界只留两个窄接口**：`deliver(target, payload) -> delivered | failed` 和
  `observe(target) -> {busy, idle, blocked, last_at}`——如果还需要第三个接口，说明状态或职责放错了位置；
- **次序：`-p` 迁移 → 容器化**（先迁 `-p` 使投递从 TUI 注入变进程，跨容器自然退化队列问题；**反着做**把最脆弱
  通道叠网络复杂度）；
- **`systemd-run` 限额是前置中间步**（`tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md`）：cgroup 限额
  无法被「忘记调用」，先拿 80% 收益、不付通信改造成本。

---

## 11. `claude -p` 形态路径（AC5b）与次序裁定（AC5c）

**`claude -p` 形态路径**（外层/inner 走 headless 时，五原语解四个）：

| 原语 | TUI 形态 | `-p` 形态 |
|---|---|---|
| 消息 | send-keys 注入 | 进程参数 |
| 校验 | transcript 轮询 | 退出码 |
| 状态 | pane + ps 反推 | 进程在不在 |
| 槽位 | 遥测括号（没人调用） | 子进程数 / OS 就是账本 |
| 抢占 | `.halt`（挡不住） | kill |

**supervisor 做的事少一大半**——四个原语变成进程语义，只剩消息总线需要自定义。可行性子已满足
（cold-start 路径存在；outer/inner 早已跑 deepseek API key，`-p` 与现状同一计费模型）。

**次序裁定（AC5c）**：**先在 archguard/meta-cc 验证产品化，再开 `-p` 实验**——先验交付再换形态，坏处能归因。
`-p` 之前 tmux 仍用期间，**清理观测路径**：session-liveness 去掉剩余的 2 次 `capture-pane`（观测不依赖屏幕抓取）。
**该清理是 `-p` 的**前置条件**，不在本架构任务里执行**（`plugin/scripts/` 是本规格的「supervisor 若成的后续
步骤」；先验交付当前在 archguard/meta-cc 验证，`-p` 未开，清理未到期）。

---

## 12. AC10 诚实记账（AC6）

本任务（supervisor 基座层架构）由**今晚事故打开**（ABORT 族 + 停摆 + NBSP），属 **post-friction**——**不计分**。
AC10 计数保持 **7**（`gap-axis-generator-question-what-range-every-standing-criterion.md` 记账引用）。
**post-friction 开口**：架构任务是事故的产物；若它也计分，机器会因「修自己的烂摊子」而虚增维度——这与
「在没疼之前打开维度才算 pre-friction」的判据相矛盾。

---

## 13. 本文件的边界

**本文件不建 AC/DoD、不排优先级——那是外层的活。**
管理者提供：10 类事故的三层倒推、可判定的三层判据、supervisor 的职责与边界判据、
`-p`/容器化/systemd-run 的次序判断、与状态结晶/隔离治理两份规格的合流点。

---

## 14. 引用

- `orchestration/SPEC-state-crystallization-2026-08-05.md` —— 六源四答案实测、切分判据、六实体（AC8）
- `orchestration/SPEC-isolation-and-resource-governance-2026-08-05.md` —— 6 起事故、限额不可被绕过、容器边界（AC9）
- `orchestration/SPEC-complete-delivery-surface-2026-08-05.md` —— 交付面六类、周期锚点第 5 类
- `orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md` —— 投递六种失败模式（步骤③的基础）
- `docs/proposals/quay-product-outline.md` §5 基座 —— 同一件事的产品投影
- `tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash.md` —— 步骤①（done）
- `tasks/gap-telemetry-brackets-vs-subagents-no-slot-visibility.md` —— 步骤②（ready）
- `tasks/gap-reliable-send-crystallize-the-five-failure-modes-into-a-script.md` + `tasks/gap-send-keys-reliable-nbsp-empty-check-is-broken-for-any-input-box.md` —— 步骤③（done）
- `tasks/gap-supervisor-step-4-preemption.md` —— 步骤④（本规格立案，todo）
- `tasks/gap-supervisor-step-5-message-bus-with-identity.md` —— 步骤⑤（本规格立案，done 2026-08-08）
- `tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md` —— AC9 前置（todo）
- `tasks/gap-axis-generator-question-what-range-every-standing-criterion.md` —— AC10 记账引用（AC6）
