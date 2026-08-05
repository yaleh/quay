---
id: gap-supervisor-base-layer-outside-sessions-architecture
title: "ARCHITECTURE: tonight's 10 incident classes reverse-engineered into a 3-layer judgment — BASE (scheduling/message+identity/session-state/slot-ledger/preemption/resource-gate) must live OUTSIDE agent sessions (7 of 10 classes are CC primitives we faked with screen-scraping + file-polling, and they cost the majority of tonight); MACHINERY (94 scripts + 14 gates + task store) stays executable outside; BEHAVIOR (loop-tick docs, Contract, AC, ADR, directives) MUST stay as text (value = read+adapted by LLM, becomes nothing as code); when true integration is impossible, a supervisor daemon consolidates the 7 faked base responsibilities out of the 3 agent sessions into one process that outlives them — periodic wakeup, single delivery implementation, delivery verification, session-state, slot-ledger, preemption, resource-gate guard, message bus with sender identity; it explicitly does NO judgment / does NOT read task content / does NOT write code — criterion: any line needing to 'understand what a task is about' is overreach; MCP is NOT the base-layer answer (session-scoped, dies with session — machinery continues via MCP, base cannot); unavoidable constraint: CC only accepts input via TUI (claude -p accepts API key not Pro/Max subscription, billing risk) => injection still via tmux, but centralization's payoff = the ONE unreliable op goes from '3 agents each hand-write' to 'one hardened implementation + real TUI e2e' (NBSP defect = the counterexample: broken for hours, 3 consumers all bypassed, zero real-TUI test coverage); landing order by tonight's cost not difficulty: 1 persistent scheduling → 2 slot-ledger+session-state → 3 delivery centralization+real-TUI e2e → 4 preemption → 5 message-bus-with-identity; relation to human's 'restrained layer growth': supervisor is NOT a 4th agent — no judgment, no decisions, no task semantics; 3-layer decision structure unchanged, only they stop each faking the base via screen-scraping; conversely if supervisor starts needing judgment the design is wrong, push that judgment back to the corresponding agent layer"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者（2026-08-05）——**架构推演：哪些该进 Claude Code，哪些留在外面**（人提问触发）。**不是
设计偏好，是从今晚 12 小时里实际把我们打伤的每一处倒推出来的。**

### 1. 今晚 10 类事故按责任归类

| # | 事故 | 代价 | 根因归属 |
|---|---|---|---|
| 1 | CronCreate/ScheduleWakeup 随会话死 | 三次崩溃→网络永久静默死亡；meta-cc/archguard 停摆 **29h** | **CC 缺持久调度** |
| 2 | Monitor 随会话死（外层 6 个） | 崩溃即全丢 | **CC 缺持久调度** |
| 3 | outer 看不到 inner 在飞数/空槽 | 12 可派发 vs 1 在飞，**11 槽闲置双方不可见** | **CC 缺会话状态 API** |
| 4 | send-keys 作进程间通道 | **6 种失败模式**；NBSP 让脚本对任何输入框失效；三消费者全绕过 | **CC 缺会话间消息** |
| 5 | agent 消息以 user 身份进会话 | 权限边界打穿，与真人不可区分 | **CC 缺发送方身份** |
| 6 | 只有 transcript 可信；pane 哈希 3 次假阳 | 每判断都要三重核实 | **CC 缺会话状态 API** |
| 7 | .halt 挡不住自主循环 | halt 后仍派 5 subagent、合并 4 次 | **CC 缺抢占原语** |
| 8 | 测试夹具泄漏 tmux（217+12） | PSI 94→gate WAIT→ABORT×3 | 我们（teardown） |
| 9 | laneCount 不传播、资源门绕过 | 9× 超订、两次 ABORT | 我们（产品 bug） |
| 10 | 恒真判据、无人调用写入方、死 glob | 缺陷静默通过 | 我们（设计卫生） |

**关键：1–7 全是「CC 没有的原语，用屏幕抓取和文件轮询假装出来」，占了今晚代价的绝大部分。**
8–10 是普通工程债，修就完了。

### 2. 三层划分判据

| 层 | 内容 | 归属 | 理由 |
|---|---|---|---|
| **基座** | 调度、消息+身份、会话状态、槽位、抢占、资源门 | **应进 CC** | 需**在 agent 会话之外存活**——任何会话内实现都随会话死 |
| **机件** | 任务库、闸门、检查器、遥测、resource-gate | **留在外面** | 与 CC 无关，是领域逻辑（94 scripts + 14 gates） |
| **行为** | loop tick 文档、Contract、AC、ADR、指令 | **必须留作文本** | 价值在于被 LLM 读取并适应，变代码就没了 |

**推论：能进 CC 的只有基座层，且必须整层进——半层进更糟。**

### 3. CC 侧五原语（按今晚代价排序）

1. **持久调度**（事故 1、2）：kill 会话进程，N 分钟后循环自己回来。
2. **会话间消息 + 发送方身份**（4、5）：接收侧能区分人与 agent-X。
3. **会话状态 API**（3、6）：不读 transcript、不 capture-pane 能答「在忙吗/剩几槽」。
4. **抢占**（7）：任意执行点生效的停止信号，不只 tick 边界。
5. **子代理槽位账本**（3）：运行时维护，不靠应用记账。

**MCP 不是基座层答案**：`mcp-server.ts` 暴露任务库（机件层）是通的；但 MCP 会话内调用、随会话死。
⇒ **机件层走 MCP，基座层走不通。**

### 4. supervisor 守护进程（做不到真集成时）

**把 7 类假装出来的基座从三个会话抽进一个不随会话死亡的进程。它是基座，不是第四层 agent。**

**它做什么**：定时唤醒 / 唯一投递实现 / 投递校验 / 会话状态 / 槽位账本 / 抢占 / 资源门守卫 /
带身份的消息总线。

**它明确不做**：判断（不派发/不排优先级/不裁定）、读任务内容、写代码跑测试。
**判据：supervisor 任何一行需要「理解任务在讲什么」就是越界。**

**绕不开的约束**：CC 只经 TUI 收输入（claude -p 只接受 API key 不接受 Pro/Max 订阅，计费风险）
⇒ 注入仍走 tmux。但这是集中化最大收益：**唯一不可靠操作从「三个 agent 各写一遍」变成「一处硬化
实现 + 真 TUI e2e」**——NBSP 缺陷是反例（坏几小时无人发现、三消费者全绕过、零真 TUI 覆盖）。

**落地次序（按今晚代价）**：持久调度 → 槽位账本+会话状态 → 投递集中化+真 TUI e2e → 抢占 →
消息总线带身份。

### 5. 与「克制层数增长」的关系

supervisor **不是第四层 agent**——无判断力、不参与决策、不消费任务语义。三层决策结构不变，变的
是它们不再各自用屏幕抓取假装基座。**反之若 supervisor 开始需要做判断，说明设计错了，把判断退回
对应 agent 层。**

### 选定机制（外层裁定：立案为架构 umbrella + 归并标注）

1. **supervisor 是已立基座任务的统一框架**：`gap-loop-has-no-os-level-anchor`（= 落地次序第 1 步
   持久调度的最小形态 watchdog）+ `gap-telemetry-brackets-vs-subagents`（= 第 2 步槽位账本）标注为
   supervisor 的落地步骤；本任务提供完整愿景 + 判据（基座/机件/行为三层 + 越界判据）。
2. **落地次序是机械路线图**：按代价不按难度——持久调度 → 槽位/会话状态 → 投递集中化 → 抢占 →
   消息总线。每步对应已立/将立任务。
3. **AC10 记账**：post-friction（被今晚 12 小时事故打开），**不计分**，计数保持 7。
4. **与 SPEC 的关系**：本任务是 SPEC 的落地载体；机件层继续走 MCP、行为层留文本、基座层 supervisor。

### 追加 2026-08-05 09:0xZ —— `claude -p` 形态（管理者更正 + 人次序裁定）

**管理者更正（人指出 + 实测确认）**：§4.3 那条「CC 只能 TUI 收输入、claude -p 计费风险」**错了**——
outer/inner **早就跑在 deepseek API key 上**（两侧 `--model deepseek-v4-flash`，外层已核实），claude -p
与现状**同一计费模型**。那条约束**只对 manager 成立**（跑 Anthropic 订阅）。**管理者如实记：把 manager
的计费模型错误推广到三层，是今晚第七次测量/推理错误。**

**更正后结论更强**：走 `-p` 后投递从「注入 TUI」变「起进程」，五个缺失原语**解掉四个**：
- 会话间消息 → 进程参数（不可能 NBSP/ghost placeholder）
- 投递校验 → 进程退出码 + stdout（不需要 pane 哈希）
- 会话状态 → 进程在不在（不需要冻结 heartbeat）
- 槽位账本 → 子进程数（**OS 就是账本**——恒真判据的根本解）
- 抢占 → kill 进程（任意点生效——.halt 挡不住连续流程的根本解）

⇒ **不是「supervisor 帮我们把 tmux 用好」，是「走 -p 之后 supervisor 要做的事少一大半」。**

**可行性关键前提已满足**：`-p` 每次 tick 空上下文，但 tick 文档「## 冷启动」已规定读四文件+三命令
建实况、以实测为准——**从空上下文重建状态不是新能力，是已在跑的路径**。

**真实代价（不掩盖）**：Monitor 在 -p 下不可用（supervisor 接管）；CronCreate 会话作用域而 -p 会话
短命（同上归 supervisor）；**人无法 attach 看/打字**（真损失，需可观测性/Web UI 补）；长会话隐性
连续性消失（隐性状态被逼成显式文件——既是代价也是好处）。

**人的次序裁定（按此排）**：**先在 archguard/meta-cc 上把产品化验证完，再开 claude -p 实验。**
理由：-p 改运行形态、产品化验交付内容；先验交付再换形态，任何一处坏掉都能归因，同时动分不清是
交付缺件还是形态不适配。

**-p 之前 tmux 仍在时的处置**：观测路径现在就能清零——session-liveness.sh 已行动投票（transcript
引用 85 vs capture-pane 2，去掉剩 2）；投递路径 send-keys 只在 2 文件，耦合面小，隔离成
deliver()/observe() 两个窄接口。

## Acceptance Criteria

- [ ] AC1: **三层判据可用**——任何新机制归属判据（基座→进 CC/outlive 会话；机件→可执行；行为→
      留文本）；每步落地时按判据归层
- [ ] AC2: **supervisor 边界判据**——无判断/不读任务/不写代码；越界判据（需理解任务即越界）在代码
      评审可查
- [ ] AC3: **落地次序执行**——①持久调度 → ②槽位账本+会话状态 → ③投递集中化+真 TUI e2e → ④抢占
      → ⑤消息总线带身份（按代价，每步有对应任务）
- [ ] AC4: **与既有基座任务归并**——OS-anchor（= ①）、slot-visibility（= ②）标注为 supervisor 步骤；
      不新开重复任务
- [ ] AC5: **真 TUI e2e**（投递集中化的核心）——唯一不可靠操作一处硬化 + 真 TUI 端到端测试（NBSP
      反例的结构性解）
- [ ] AC5b: **`claude -p` 形态路径**——外层/inner 走 headless 时五原语解四个（消息→进程参数、
      校验→退出码、状态→进程在不在、槽位→子进程数、抢占→kill）；supervisor 做的事少一大半
- [ ] AC5c: **次序裁定**——先在 archguard/meta-cc 验证产品化，**再**开 claude -p 实验（先验交付再换
      形态，坏处能归因）；-p 之前 tmux 仍用时清理观测路径（session-liveness 去掉剩 2 次 capture-pane）
- [ ] AC6: **AC10 诚实记账**——post-friction（被今晚事故打开）不计分，计数保持 7
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC7 全部勾上；落地次序①②③完成 + ④⑤有对应任务
- [ ] 基座层从三会话抽出（supervisor 在，不随会话死）；机件走 MCP、行为留文本；越界判据在
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- orchestration/SPEC-integration-architecture-2026-08-05.md（引用）
- tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash.md（AC4：= 落地①）
- tasks/gap-telemetry-brackets-vs-subagents-no-slot-visibility.md（AC4：= 落地②）
- plugin/scripts/（supervisor 若成：基座层实现，后续步骤）
- tasks/gap-axis-generator-question-what-range-every-standing-criterion.md（AC6 记账引用）

## Contract

measure   base_layer_outside = `bash <supervisor 健康检查>` stdout 的 alive 字段（若成脚本）
band      base_layer_outside = alive（基座层进程不随 agent 会话死亡）
invariant supervisor_has_no_judgment = 1（越界判据：无一行需理解任务内容）
invoke    `grep -rn "supervisor\|base.layer\|基座" orchestration/SPEC-integration-architecture-2026-08-05.md`
control   kill agent 会话 ⇒ supervisor 存活 + 定时唤醒仍在（AC1）；supervisor 需理解任务 ⇒ 越界标出（AC2）
resume    架构裁定与落地①（OS-anchor）分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T09:0xZ
changed: 外层受管理者 SPEC 裁定立案（架构 umbrella）。四处收紧：
(1) **三层判据**——基座（会话外存活）/机件（可执行）/行为（留文本）；前 7 类事故是 CC 缺原语、
    占今晚代价大部分；
(2) **supervisor 边界**——无判断/不读任务/不写代码；越界判据=需理解任务即越界；非第四层；
(3) **落地次序**——按代价：持久调度→槽位/会话状态→投递集中化+真 TUI e2e→抢占→消息总线；
    OS-anchor/slot-visibility 标注为落地①②；
(4) **AC10 post-friction 不计分**（被今晚事故打开），计数保持 7。
status: todo——基座层架构方向；最高优先（决定崩溃后能否自恢复 + 吞吐），与 OS-anchor 并列前排。
