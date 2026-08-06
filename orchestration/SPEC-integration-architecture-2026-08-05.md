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
| **⑤ 消息总线带身份** | 每条消息携带发送者身份（哪层/哪项目） | `tasks/gap-supervisor-step-5-message-bus-with-identity.md`（本规格立案） | todo | 消息总线 + 发送者身份 |

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
- `tasks/gap-supervisor-step-5-message-bus-with-identity.md` —— 步骤⑤（本规格立案，todo）
- `tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md` —— AC9 前置（todo）
- `tasks/gap-axis-generator-question-what-range-every-standing-criterion.md` —— AC10 记账引用（AC6）
