---
id: gap-supervisor-base-layer-outside-sessions-architecture
title: "ARCHITECTURE: tonight's 10 incident classes reverse-engineered into a
  3-layer judgment — BASE
  (scheduling/message+identity/session-state/slot-ledger/preemption/resource-ga\
  te) must live OUTSIDE agent sessions (7 of 10 classes are CC primitives we
  faked with screen-scraping + file-polling, and they cost the majority of
  tonight); MACHINERY (94 scripts + 14 gates + task store) stays executable
  outside; BEHAVIOR (loop-tick docs, Contract, AC, ADR, directives) MUST stay as
  text (value = read+adapted by LLM, becomes nothing as code); when true
  integration is impossible, a supervisor daemon consolidates the 7 faked base
  responsibilities out of the 3 agent sessions into one process that outlives
  them — periodic wakeup, single delivery implementation, delivery verification,
  session-state, slot-ledger, preemption, resource-gate guard, message bus with
  sender identity; it explicitly does NO judgment / does NOT read task content /
  does NOT write code — criterion: any line needing to 'understand what a task
  is about' is overreach; MCP is NOT the base-layer answer (session-scoped, dies
  with session — machinery continues via MCP, base cannot); unavoidable
  constraint: CC only accepts input via TUI (claude -p accepts API key not
  Pro/Max subscription, billing risk) => injection still via tmux, but
  centralization's payoff = the ONE unreliable op goes from '3 agents each
  hand-write' to 'one hardened implementation + real TUI e2e' (NBSP defect = the
  counterexample: broken for hours, 3 consumers all bypassed, zero real-TUI test
  coverage); landing order by tonight's cost not difficulty: 1 persistent
  scheduling → 2 slot-ledger+session-state → 3 delivery centralization+real-TUI
  e2e → 4 preemption → 5 message-bus-with-identity; relation to human's
  'restrained layer growth': supervisor is NOT a 4th agent — no judgment, no
  decisions, no task semantics; 3-layer decision structure unchanged, only they
  stop each faking the base via screen-scraping; conversely if supervisor starts
  needing judgment the design is wrong, push that judgment back to the
  corresponding agent layer"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---
**type:** architecture

## Proposal

**ARCHITECTURE：今晚 10 类事故倒推三层判断**——BASE（调度/消息+身份/会话状态/槽位账本/
抢占/资源门）必须活在 agent 会话**之外**（10 类中 7 类是 CC 原语，我们用屏幕抓取+文件轮询伪造，
代价占今晚大部分）；MACHINERY（94 脚本 + 14 gate + 任务存储）留在会话外可执行；BEHAVIOR
（loop-tick 文档 / Contract / AC / ADR / 指令）**必须留文本**（价值 = LLM 读+适配，变代码就归零）。

**当真正的整合不可能时**，supervisor 守护进程把 7 个伪造的基座职责从 3 个 agent 会话收进一个
不随会话死的进程：定时唤醒 / 唯一投递实现 / 投递校验 / 会话状态 / 槽位账本 / 抢占 / 资源门守卫 /
带发送者身份的消息总线。**它明确不做判断 / 不读任务内容 / 不写代码**——越界判据：任何一行需要
「理解任务在讲什么」就是越界。MCP 不是基座层答案（会话作用域，随会话死）；注入仍走 tmux，但
集中化的收益 = 唯一不可靠操作从「3 个 agent 各写一遍」变成「一处硬化 + 真 TUI e2e」（NBSP 缺陷
是反例：坏几小时、3 个消费者全绕过、零真 TUI 测试）。

**落地次序（按今晚代价不按难度）**：①持久调度 → ②槽位账本+会话状态 → ③投递集中化+真 TUI e2e
→ ④抢占 → ⑤消息总线带身份。

**与人的「克制层增长」关系**：supervisor **不是**第 4 个 agent——无判断、无决策、无任务语义；
三层决策结构不变，只是各层不再用屏幕抓取伪造基座。反过来，若 supervisor 开始需要判断，说明设计
错了，把判断推回对应 agent 层。

**状态结晶细则（SPEC-state-crystallization-2026-08-05.md，管理者规格 + 人裁定）**：
②（槽位账本+会话状态）的实体化设计准则——**名词进代码，动词留文本**：
- 六实体（Task/Run/Session/SuiteRun/Signal/Resource）各有**恰好一个写入者**——今晚矛盾全来自
  「多写入者无人权威」
- 切分判据：一段文本断言「可被查询的事实」⇒ 错位状态进代码；断言「对事实的规则」⇒ 留文本。
  实例：queue-state 的「已完成/在飞」是事实⇒错位；tick 文档「red⇒停派」是规则⇒正确；
  `.halt` 是「规则正确但缺机械挂载点」（连续流程绕过步骤 0）⇒ 规则的强制点必须在代码有挂载
- 形式化三约束：规则引用状态字段名不复述状态；每条规则有机械挂载点；禁止手写逃生舱
  （note 那次说明逃生舱位置 = 缺失字段位置）

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
- [ ] AC8: **状态结晶设计准则落地**（SPEC-state-crystallization-2026-08-05.md）——②槽位/会话状态
      实现时：六实体各恰一个写入者；名词进代码动词留文本；规则引用字段名不复述；每条规则有机械
      挂载点；禁止手写逃生舱（逃生舱位置 = 缺失字段位置）。实测「一个事实六个源四个答案」为验收基
      准——实现后问「几个任务在飞」各源答案应一致

## Definition of Done

- [ ] AC1–AC8 全部勾上；落地次序①②③完成 + ④⑤有对应任务
- [ ] 基座层从三会话抽出（supervisor 在，不随会话死）；机件走 MCP、行为留文本；越界判据在
- [ ] 「几个任务在飞」单一答案（遥测/阻塞/会话状态/槽位账本一致，实测输出贴任务体）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- orchestration/SPEC-integration-architecture-2026-08-05.md（引用）
- orchestration/SPEC-state-crystallization-2026-08-05.md（AC8 引用）
- tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash.md（AC4：= 落地①）
- tasks/gap-telemetry-brackets-vs-subagents-no-slot-visibility.md（AC4：= 落地②）
- plugin/scripts/（supervisor 若成：基座层实现，后续步骤）
- tasks/gap-axis-generator-question-what-range-every-standing-criterion.md（AC6 记账引用）

## Contract

measure   base_layer_outside = `bash <supervisor 健康检查>` stdout 的 alive 字段（若成脚本）
band      base_layer_outside = alive（基座层进程不随 agent 会话死亡）
invariant supervisor_has_no_judgment = 1（越界判据：无一行需理解任务内容）
invariant in_flight_single_answer = 1（「几个任务在飞」各源答案一致，六实体唯一写入者）
invoke    `grep -rn "supervisor\|base.layer\|基座" orchestration/SPEC-integration-architecture-2026-08-05.md`
control   多写入者（当前形态）⇒ 六源四答案（AC8 实测基准）；唯一写入者实现后 ⇒ 答案收敛
resume    每落地一步（①②③④⑤）即写盘，AC 逐条勾