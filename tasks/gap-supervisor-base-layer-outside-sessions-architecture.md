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
status: ready
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

**隔离与资源治理细则（SPEC-isolation-and-resource-governance-2026-08-05.md，管理者规格）**：
**限额不可被绕过**——resource-gate 曾被绕过（ABORT #5 实测 runner 0 次调用），cgroup 限额无法被
「忘记调用」。**次序：-p 迁移 → 容器化**（先迁 -p 使投递从 TUI 注入变进程，跨容器自然退化队列问题；
反着做把最脆弱通道叠网络复杂度）。**容器边界**：宿主留 supervisor/watchdog/共享状态/manager；
每项目一容器（outer+inner+工作树+套件）；跨边界只留 deliver()/observe() 两窄接口。**中间步**：
systemd-run cgroup 限额（tasks/gap-systemd-run-limits-for-suite-and-heavy-ops）。

## Acceptance Criteria

- [x] AC1: **三层判据可用**——任何新机制归属判据（基座→进 CC/outlive 会话；机件→可执行；行为→
      留文本）；每步落地时按判据归层
      → `orchestration/SPEC-integration-architecture-2026-08-05.md` §2 给可判定判据（事实/原语⇒基座；
      规则/理由⇒行为；规则必须有机械挂载点）；§7 每步落地按判据归层
- [x] AC2: **supervisor 边界判据**——无判断/不读任务/不写代码；越界判据（需理解任务即越界）在代码
      评审可查
      → SPEC §4.2 边界判据成文：不做判断/不读任务内容/不写代码；「任何一行需理解任务在讲什么 = 越界」
- [x] AC3: **落地次序执行**——①持久调度 → ②槽位账本+会话状态 → ③投递集中化+真 TUI e2e → ④抢占
      → ⑤消息总线带身份（按代价，每步有对应任务）
      → SPEC §7 次序表 + 每步对应任务：① OS-anchor（done）② slot-visibility（ready）③ reliable-send+
      NBSP（done）④ `gap-supervisor-step-4-preemption`（立案）⑤ `gap-supervisor-step-5-message-bus-with-identity`
      （立案）
- [x] AC4: **与既有基座任务归并**——OS-anchor（= ①）、slot-visibility（= ②）标注为 supervisor 步骤；
      不新开重复任务
      → 两任务体各加 `## Supervisor step（base-layer-outside-sessions 步骤①/②）` 交叉注（本提交）；
      SPEC §7 明确「不新开重复任务」
- [x] AC5: **真 TUI e2e**（投递集中化的核心）——唯一不可靠操作一处硬化 + 真 TUI 端到端测试（NBSP
      反例的结构性解）
      → SPEC §6（集中化收益）+ §7 步骤③映射到已 done 的 reliable-send（六模式结晶）+ NBSP（判空修复，
      tick-log 实测「NBSP 真 TUI e2e ✔」）；唯一不可靠操作一处硬化
- [x] AC5b: **`claude -p` 形态路径**——外层/inner 走 headless 时五原语解四个（消息→进程参数、
      校验→退出码、状态→进程在不在、槽位→子进程数、抢占→kill）；supervisor 做的事少一大半
      → SPEC §11 原语对照表（TUI 形态 vs `-p` 形态，五原语解四个）+「supervisor 做的事少一大半」
- [x] AC5c: **次序裁定**——先在 archguard/meta-cc 验证产品化，**再**开 claude -p 实验（先验交付再换
      形态，坏处能归因）；-p 之前 tmux 仍用时清理观测路径（session-liveness 去掉剩 2 次 capture-pane）
      → SPEC §11 裁定成文（先验交付再换形态）；观测路径清理标注为 `-p` 前置（supervisor 若成的后续
      步骤，本架构任务不执行代码改动）
- [x] AC6: **AC10 诚实记账**——post-friction（被今晚事故打开）不计分，计数保持 7
      → SPEC §12 记账成文（post-friction 开口不计分；计数保持 7，引用 gap-axis-generator）
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`
      → 本任务为文档/规格类（无新代码/测试）；零测试写入，要求空满足。新任务（④⑤）为 todo 立案，
      未写测试
- [x] AC8: **状态结晶设计准则落地**（SPEC-state-crystallization-2026-08-05.md）——②槽位/会话状态
      实现时：六实体各恰一个写入者；名词进代码动词留文本；规则引用字段名不复述；每条规则有机械
      挂载点；禁止手写逃生舱（逃生舱位置 = 缺失字段位置）。实测「一个事实六个源四个答案」为验收基
      准——实现后问「几个任务在飞」各源答案应一致
      → SPEC §9 设计准则成文（六实体唯一写入者 + 名词进代码动词留文本 + 形式化三约束 + 六源四答案
      验收基准）；步骤②（slot-visibility）是首个应用
- [x] AC9: **容器化边界与次序**（SPEC-isolation-and-resource-governance-2026-08-05.md）——supervisor/
      watchdog/共享状态/manager 留宿主；每项目一容器；跨边界只留 deliver()/observe() 两窄接口；
      **次序：-p 迁移 → 容器化**（先迁 -p 后容器，不反着做）；systemd-run 限额为前置中间步
      （tasks/gap-systemd-run-limits-for-suite-and-heavy-ops）
      → SPEC §10 边界与次序成文（宿主留 supervisor/watchdog/共享状态/manager；每项目一容器；
      deliver()/observe() 两窄接口；`-p` 迁移 → 容器化次序；systemd-run 前置）

## Definition of Done

- [ ] AC1–AC9 全部勾上；落地次序①②③完成 + ④⑤有对应任务
- [ ] 基座层从三会话抽出（supervisor 在，不随会话死）；机件走 MCP、行为留文本；越界判据在
- [ ] 「几个任务在飞」单一答案（遥测/阻塞/会话状态/槽位账本一致，实测输出贴任务体）
- [ ] systemd-run 限额下套件可跑（AC9 前置，gap-systemd-run 任务落地）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## 执行证据（invoke + 落地产物）

**Contract invoke**（`grep -rn "supervisor\|base.layer\|基座" orchestration/SPEC-integration-architecture-2026-08-05.md`）
实测 41 行命中（节选）：

```
orchestration/SPEC-integration-architecture-2026-08-05.md:1:# 规格：集成架构——基座层必须活在 agent 会话之外（supervisor）
orchestration/SPEC-integration-architecture-2026-08-05.md:75:## 4. supervisor 守护进程：当真正的整合不可能时
orchestration/SPEC-integration-architecture-2026-08-05.md:96:> **supervisor 明确不做判断、不读任务内容、不写代码。**
orchestration/SPEC-integration-architecture-2026-08-05.md:149:| 步骤 | 内容 | 对应任务 | 状态 | supervisor 职责收编 |
orchestration/SPEC-integration-architecture-2026-08-05.md:158:（slot-visibility）——已在各自任务体标注为 supervisor 步骤（见两任务体的 `## Supervisor step` 交叉注）。
```

**落地产物**：
1. `orchestration/SPEC-integration-architecture-2026-08-05.md`（新建）——三层判据（§2）、supervisor 边界
   判据（§4.2）、落地次序与对应任务（§7）、`-p` 形态与次序裁定（§11）、AC10 记账（§12）、
   状态结晶（§9）/隔离治理（§10）合流
2. `tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash.md`——加 `## Supervisor step
   （base-layer-outside-sessions 步骤①）` 交叉注（AC4）
3. `tasks/gap-telemetry-brackets-vs-subagents-no-slot-visibility.md`——加 `## Supervisor step
   （base-layer-outside-sessions 步骤②）` 交叉注（AC4）
4. `tasks/gap-supervisor-step-4-preemption.md`（新建）——落地次序 ④ 抢占（AC3/DoD「④⑤有对应任务」）
5. `tasks/gap-supervisor-step-5-message-bus-with-identity.md`（新建）——落地次序 ⑤ 消息总线带身份
   （AC3/DoD「④⑤有对应任务」）

**scoped 验证**：`scripts/test.sh --for-task gap-supervisor-base-layer-outside-sessions-architecture
--allow-thin` —— task-contract-check 无违规；strategic-doc-staleness-check 无新 stale；test-selection-thin
（0/10 Touches 为文档/任务文件，无测试文件）。

## Touches

- tasks/gap-supervisor-base-layer-outside-sessions-architecture.md
- orchestration/SPEC-integration-architecture-2026-08-05.md（引用）
- orchestration/SPEC-state-crystallization-2026-08-05.md（AC8 引用）
- orchestration/SPEC-isolation-and-resource-governance-2026-08-05.md（AC9 引用）
- tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash.md（AC4：= 落地①，加 Supervisor step 注）
- tasks/gap-telemetry-brackets-vs-subagents-no-slot-visibility.md（AC4：= 落地②，加 Supervisor step 注）
- tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md（AC9 前置）
- tasks/gap-supervisor-step-4-preemption.md（AC3：落地次序 ④，本任务立案）
- tasks/gap-supervisor-step-5-message-bus-with-identity.md（AC3：落地次序 ⑤，本任务立案）
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
## Dispatch review

reviewer: none
at: 2026-08-05T18:2xZ
changed: contract-ratchet compliance，外层 18:2xZ 补齐（未审）
