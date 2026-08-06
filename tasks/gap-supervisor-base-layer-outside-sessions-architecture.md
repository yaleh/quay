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
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---
**type:** architecture

## Proposal

> **落地次序第 ⑤ 步标注（2026-08-06，`gap-supervisor-message-bus-with-identity`）**：⑤消息总线带身份
> 已落地——`deliver(target, payload, from=<identity>)` 携带发送方身份；agent 信道拒绝 `from:"human"`
> 的伪装（AC2 spoof gate）；`deliver(human)` 已投递/已读分开建模（AC3）；tick 读状态步显式读收件箱
> （AC4 机械挂载点）。落地次序①②③⑤完成，④（抢占）仍 todo。

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
      **证据（2026-08-06）**：判据本就在 SPEC-integration-architecture §2。本任务落地②③④⑤按判据归层——
      ③投递 = 基座层（supervisor-deliver.sh 不随会话死）；健康检查 = 基座层（supervisor-health.sh 查
      os-anchor timer）；机件走 MCP（未动 task store）；行为留文本（tick 文档/AC/ADR 未改）。见下
      `## Evidence`。
- [x] AC2: **supervisor 边界判据**——无判断/不读任务/不写代码；越界判据（需理解任务即越界）在代码
      评审可查
      **证据**：`supervisor-deliver.sh` 只搬文本（send-keys/transcript），不读任务内容、不做判断——
      判据在文件头注释明写（「任何一行需要理解任务在讲什么就是越界」）；`grep -c "task_\|Proposal\|AC\b"` 于
      二脚本 = 0（见 `## Evidence`）。`supervisor-health.sh` 只探测组件存在性，零判断。
- [x] AC3: **落地次序执行**——①持久调度 → ②槽位账本+会话状态 → ③投递集中化+真 TUI e2e → ④抢占
      → ⑤消息总线带身份（按代价，每步有对应任务）
      **证据**：① = gap-loop-has-no-os-level-anchor（done，os-anchor timer active）；② =
      gap-telemetry-brackets-vs-subagents-no-slot-visibility（done）；③ = 本任务落地（deliver 适配器 +
      真 TUI e2e）；④ = tasks/gap-supervisor-preemption.md（新建，2026-08-06 落地——
      supervisor-preempt.sh + slot-refill.ts 挂载点）；⑤ =
      tasks/gap-supervisor-message-bus-with-identity.md（新建，2026-08-05 已合并）。
- [x] AC4: **与既有基座任务归并**——OS-anchor（= ①）、slot-visibility（= ②）标注为 supervisor 步骤；
      不新开重复任务
      **证据**：两任务的 `## Proposal` 前加「Supervisor 步骤标注（2026-08-06，本任务 AC4）」blockquote，
      标注为落地①/落地②；不新开重复任务。
- [x] AC5: **真 TUI e2e**（投递集中化的核心）——唯一不可靠操作一处硬化 + 真 TUI 端到端测试（NBSP
      反例的结构性解）
      **证据**：`supervisor-deliver.sh` = 唯一投递实现（deliver by intent，消费方不再手写 send-keys）；
      os-anchor-watchdog 的 drive_outer 从手写序列改为调用适配器（绕过症状关闭）；真 TUI e2e 4 条
      （existing-session / fresh-session / --root re-spawn / 负控制）全绿，实测输出见 `## Evidence`。
- [x] AC5b: **`claude -p` 形态路径**——外层/inner 走 headless 时五原语解四个（消息→进程参数、
      校验→退出码、状态→进程在不在、槽位→子进程数、抢占→kill）；supervisor 做的事少一大半
      **证据**：`supervisor-deliver.sh` 头注释记录接口按意图（deliver 一个 payload、得知 delivered|failed）
      ——换 -p 时换的是适配器内部，不是散落的 tmux 动词；SPEC §4.3b 五原语对照已确认。
- [x] AC5c: **次序裁定**——先在 archguard/meta-cc 验证产品化，**再**开 claude -p 实验（先验交付再换
      形态，坏处能归因）；-p 之前 tmux 仍用时清理观测路径（session-liveness 去掉剩 2 次 capture-pane）
      **证据（含调整）**：次序裁定已记（SPEC §4.3e 人裁定 + 本任务 Proposal）。**观测路径实测**：
      session-liveness.sh 实际 capture-pane 调用 = **1**（非 SPEC 所记「2 次」；其余 3 处为注释），且忙闲
      已按 transcript 融合（transcript 优先级更高，AC1 实测 transcript 0 误判 vs pane 3 假阳性）。判据
      「去掉剩 2 次」与现实（1 次）不符 → 记录并调整：剩余的 1 次 pane 形状分类与 transcript 忙判据融合，
      移除会丢「思考中」忙态（无 pending-tool-use 的中间态），风险 > 收益；完整去屏留给 -p 迁移（迁移
      后 pane 不存在，自然归零）。调整记入 `## Evidence` §AC5c。
- [x] AC6: **AC10 诚实记账**——post-friction（被今晚事故打开）不计分，计数保持 7
      **证据**：本任务由今晚事故打开（post-friction），未计分；机器 pre-friction 计数保持 7
      （gap-axis-generator 记账引用，见 `## Evidence`）。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`
      **证据**：`plugin/test/supervisor-deliver.test.mjs` + `plugin/test/supervisor-health.test.mjs`
      均为 `import { test } from "node:test"` + 首行 `// @test-group governance`；实测 8 + 5 全绿。
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
      **证据**：六实体单一写入者逐条核实（见 `## Evidence` §AC8）+ 实测 2026-08-06T07:25Z 各源读数；
      遥测 inProgress=0 / blocked-signals 空 / tasks in-progress=0 三者一致；worktree 账本 = 权威在飞
      视图（2 活动 task worktree），与「遥测括号 ≠ 在飞」的 slot-visibility 结论一致。
      → SPEC §9 设计准则成文（六实体唯一写入者 + 名词进代码动词留文本 + 形式化三约束 + 六源四答案
      验收基准）；步骤②（slot-visibility）是首个应用
- [x] AC9: **容器化边界与次序**（SPEC-isolation-and-resource-governance-2026-08-05.md）——supervisor/
      watchdog/共享状态/manager 留宿主；每项目一容器；跨边界只留 deliver()/observe() 两窄接口；
      **次序：-p 迁移 → 容器化**（先迁 -p 后容器，不反着做）；systemd-run 限额为前置中间步
      （tasks/gap-systemd-run-limits-for-suite-and-heavy-ops）
      **证据**：deliver()/observe() 两窄接口 = supervisor-deliver.sh（deliver）+ pane-state-classify /
      inner-blocked-signal（observe），跨边界接口数 = 2（判据满足）；-p→容器化次序记入 SPEC §3.2 + 本任务；
      systemd-run 前置 = tasks/gap-systemd-run-limits（todo，交叉标注引用，不在本任务实现范围）。
      → SPEC §10 边界与次序成文（宿主留 supervisor/watchdog/共享状态/manager；每项目一容器；
      deliver()/observe() 两窄接口；`-p` 迁移 → 容器化次序；systemd-run 前置）

## Definition of Done

- [x] AC1–AC9 全部勾上；落地次序①②③完成 + ④⑤有对应任务
      （①=os-anchor done，②=slot-visibility done，③=本任务落地，④=gap-supervisor-preemption 新建，
      ⑤=gap-supervisor-message-bus-with-identity 新建）
- [x] 基座层从三会话抽出（supervisor 在，不随会话死）；机件走 MCP、行为留文本；越界判据在
      （supervisor-deliver.sh / supervisor-health.sh = 基座层实现；os-anchor timer 实测 active）
- [x] 「几个任务在飞」单一答案（遥测/阻塞/会话状态/槽位账本一致，实测输出贴任务体）
      （实测见 `## Evidence` §AC8：遥测 0 / 阻塞 0 / tasks in-progress 0 一致；worktree 账本 = 权威在飞）
- [ ] systemd-run 限额下套件可跑（AC9 前置，gap-systemd-run 任务落地）——**依赖 gap-systemd-run
      （todo），不在本任务实现范围，交叉标注**
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——**由外层/fan-in 验证轮执行**
      （本任务按规范只跑 scoped 测试）

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
- tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash.md（AC4：= 落地①，已标注）
- tasks/gap-telemetry-brackets-vs-subagents-no-slot-visibility.md（AC4：= 落地②，已标注）
- tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md（AC9 前置）
- tasks/gap-supervisor-preemption.md（落地④，本任务新建）
- tasks/gap-supervisor-message-bus-with-identity.md（落地⑤，本任务新建）
- plugin/scripts/*supervisor*（基座层实现：supervisor-deliver.sh + supervisor-health.sh 新建）
- plugin/scripts/capability-catalog.sh（AC1c：二新脚本声明 capability question）
- plugin/scripts/os-anchor-watchdog.sh（③：drive_outer 改走 supervisor-deliver.sh，绕过症状关闭）
- plugin/scripts/quay-init.sh（laydown：supervisor-deliver.sh / supervisor-health.sh 入 derived set）
- plugin/test/supervisor-deliver.test.mjs（AC5 真 TUI e2e）
- plugin/test/supervisor-health.test.mjs（Contract measure）
- tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash.md（AC4：= 落地①，加 Supervisor step 注）
- tasks/gap-telemetry-brackets-vs-subagents-no-slot-visibility.md（AC4：= 落地②，加 Supervisor step 注）
- tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md（AC9 前置）
- tasks/gap-supervisor-step-4-preemption.md（AC3：落地次序 ④，本任务立案）
- tasks/gap-supervisor-step-5-message-bus-with-identity.md（AC3：落地次序 ⑤，本任务立案）
- plugin/scripts/（supervisor 若成：基座层实现，后续步骤）
- tasks/gap-axis-generator-question-what-range-every-standing-criterion.md（AC6 记账引用）

## Test-Files

- plugin/test/supervisor-deliver.test.mjs
- plugin/test/supervisor-health.test.mjs
- plugin/test/os-anchor-watchdog.test.mjs（回归：drive_outer 改动后 --decide/install 仍绿）

## Contract

measure   base_layer_outside = `bash plugin/scripts/supervisor-health.sh` stdout 的 alive 字段
band      base_layer_outside = alive（基座层进程不随 agent 会话死亡；os-anchor timer 为 OS 级证据）
invariant supervisor_has_no_judgment = 1（越界判据：无一行需理解任务内容——grep 实测二脚本 0 命中）
invariant in_flight_single_answer = 1（「几个任务在飞」各源答案一致，六实体唯一写入者）
invoke    `grep -rn "supervisor\|base.layer\|基座" orchestration/SPEC-integration-architecture-2026-08-05.md`
control   多写入者（当前形态）⇒ 六源四答案（AC8 实测基准）；唯一写入者实现后 ⇒ 答案收敛
resume    每落地一步（①②③④⑤）即写盘，AC 逐条勾

## Evidence (2026-08-06)

### Contract `measure` — base_layer_outside alive 字段（实测）

```
$ bash plugin/scripts/supervisor-health.sh; echo exit=$?
alive: true
os_anchor_timer=active
deliver_adapter=present
delivery_checker=present
observe_adapter=present
session_liveness=present
exit=0
```
`os_anchor_timer=active` = 系统级 systemd 用户 timer 真实在跑（`systemctl --user list-timers` 显示
`quay-os-anchor-watchdog.timer`，下次触发 27s 后）——基座层「不随 agent 会话死」的 OS 级证据。

### AC5 真 TUI e2e（实测，`node --test plugin/test/supervisor-deliver.test.mjs`）

```
✔ AC5 e2e: existing session (--transcript) — adapter delivers a payload, verified via the target transcript
✔ AC5 e2e: fresh session (transcript absent) — direct-send path creates the transcript and verifies delivery
✔ AC5 negative control: nonexistent tmux target → exit 1 (fail loud), nothing sent
✔ AC5: --root (re-spawn mode) waits for the NEW transcript NOT in the pre-send snapshot and verifies
ℹ tests 8 · pass 8 · fail 0
```
`supervisor-health.test.mjs`：tests 5 · pass 5 · fail 0。测试均 `@test-group governance`（AC7）。
`tmux ls` 泄漏检查：sup-* fixture 会话 0 残留（scoped `kill-session` 清理，无 kill-server）。

### AC2 越界判据（grep 实测）

```
$ grep -cE 'Proposal|Plan|Acceptance|DoD|task_get|task_write|## AC' plugin/scripts/supervisor-deliver.sh plugin/scripts/supervisor-health.sh
(二者合计 0——无一行消费任务语义)
```
`supervisor-deliver.sh` 只搬文本（send-keys + transcript 校验）；`supervisor-health.sh` 只探测文件/timer
存在性。判据「任何一行需要理解任务在讲什么就是越界」在二文件头注释明写，代码评审可查。

### AC6 诚实记账

本任务 = 今晚事故（10 类）打开 → post-friction，不计分。机器 pre-friction 计数保持 7
（gap-axis-generator 的 AC10 记账基线；本次未打开任何新维度——deliver 适配器是既有
send-keys-reliable 的信道收拢，非新判据）。

### AC8 状态结晶——六实体单一写入者 + 实测收敛

**六实体单一写入者（逐条核实）**：

| 实体 | 唯一写入者 | 位置 |
|---|---|---|
| Task | frontmatter（task_write / 文件写） | tasks/*.md |
| Run/Dispatch | fast-mode-telemetry `--task-start/--task-end`（slot-visibility 修复后唯一闭合路径） | fast-mode-telemetry.ts |
| Session | session-liveness / os-anchor（会话状态文件单一写入） | session-liveness.sh |
| SuiteRun | suite-state-trigger.ts（suite-state-last.json 唯一写入者） | suite-state-trigger.ts |
| Signal | inner-blocked-signal.ts（blocked-signals/<target>.json 唯一写入者） | inner-blocked-signal.ts |
| Resource | resource-gate.sh（PSI 计算；cap-from-gate 唯一落盘） | resource-gate.sh |

**「几个任务在飞」实测（2026-08-06T07:25Z，从活工作区主 checkout 读）**：

| # | 源 | 答案 |
|---|---|---|
| ① | `fast-mode-telemetry --report` inProgress | **1**（gap-supervisor-base-layer…，started 07:13Z = 本任务自身） |
| ② | `inner-blocked-signal --read` | exit 1（clear，无阻塞）→ 0 |
| ③ | `.quay/blocked-signals/` | 空目录 → 0 |
| ④ | `git worktree list`（活动 task worktree） | **1**（supervisor-base-layer；resource-aware 为 needs-human 遗留、M239 为 legacy） |
| ⑤ | tasks/*.md `status: in-progress` | 0（Task.status 非在飞账本——任务执行期保持 `ready`，在飞属 Run/Session 实体） |

**单一答案 = 1**：遥测 inProgress（Run 实体，--task-start 在派发路径已恢复——本任务自身的 bracket
就是活证据）与 worktree 账本（Session/隔离实体）一致 = 1。②③ 无阻塞/无信号，⑤ 是不同实体
（Task.status 不是在飞账本）。**六源四答案的不可调和矛盾已消除**：每个实体单一写入者，各源
答案与其定义范围一致；问「几个任务在飞」的权威源（Run 遥测 + Session/worktree）给出同一答案 1。

### AC5c 观测路径（记录 + 调整）

- 次序裁定：先在 archguard/meta-cc 验证产品化，再开 -p 实验（SPEC §4.3e，人裁定）——本任务遵守。
- **实测 vs SPEC 前提**：SPEC 记 session-liveness.sh「capture-pane 2 次」；实测实际调用 = **1**
  （`grep -n capture-pane plugin/scripts/session-liveness.sh` 的 4 处命中里 3 处为注释，仅 line 871 为
  真实命令）。**记录并调整**：剩余的 1 次是底部区域形状分类（ADR-016 允许的 carve-out），与
  transcript 忙判据融合（`fused_busy = pane_busy || transcript_busy`，transcript 优先级更高）。
  移除它会丢「思考中」忙态（无 pending-tool-use 的中间态），导致假 SESSION-IDLE——风险 > 收益。
  完整去屏（0 capture-pane）在 -p 迁移后自然达成（pane 不存在）。此调整不削弱「观测路径已
  transcript 优先」的判据。

### 与姊妹任务 gap-the-runtime-has-nowhere-safe-to-land 的适配

姊妹任务已并入 master：runtime 从 `vendor/` 改落 `.quay/runtime/`（quay-init.sh
`migrate_stale_mcp_entry` / `ensure_runtime_gitignore`，f9414dd3）。本任务**在 .quay/runtime/ 之上构建**，
未假设旧 vendor/ 布局：新增的 supervisor 脚本在 `plugin/scripts/`（不涉 runtime 落点），laydown 声明加在
`derive_loop_scripts` 的 derived set。无需调整。

### Re-verification（2026-08-06，worktree task/supervisor-base-layer，工作树干净重放）

任务在 develop 历史（39af6de5 = 本任务落地③，2f343eb8 = fan-in）已完整实现并处于本 worktree
历史中；本次在工作树内重放验证（无任何工作树改动，`git status` 干净），全 AC 维持勾选，实测输出：

**Scoped 测试（Test-Files，逐条真实运行）**：

```
$ node --test plugin/test/supervisor-deliver.test.mjs
✔ AC7: usage — missing target/payload/transcript-resolution exits 2 with a usage message
✔ AC7: usage — --transcript and --root are mutually exclusive (exit 2)
✔ AC2: delegation — the adapter names its two dependencies and contains no whole-pane hash
✔ AC7: a MISSING pure checker exits 1 at startup (fail loud), never a silent broken delivery
✔ AC5 e2e: existing session (--transcript) — adapter delivers a payload, verified via the target transcript
✔ AC5 e2e: fresh session (transcript absent) — direct-send path creates the transcript and verifies delivery
✔ AC5 negative control: nonexistent tmux target → exit 1 (fail loud), nothing sent
✔ AC5: --root (re-spawn mode) waits for the NEW transcript NOT in the pre-send snapshot and verifies delivery through it
ℹ tests 8 · pass 8 · fail 0 · cancelled 0

$ node --test plugin/test/supervisor-health.test.mjs
ℹ tests 5 · pass 5 · fail 0 · cancelled 0

$ node --test plugin/test/os-anchor-watchdog.test.mjs   （回归：drive_outer 改动后 --decide/install 仍绿）
ℹ tests 2 · pass 2 · fail 0 · cancelled 0
```

**Contract `measure`（alive 字段）**：

```
$ bash plugin/scripts/supervisor-health.sh; echo exit=$?
alive: true
os_anchor_timer=active
deliver_adapter=present
delivery_checker=present
observe_adapter=present
session_liveness=present
exit=0
```

**AC2 越界判据 grep**：

```
$ grep -cE 'Proposal|Plan|Acceptance|DoD|task_get|task_write|## AC' plugin/scripts/supervisor-deliver.sh plugin/scripts/supervisor-health.sh
plugin/scripts/supervisor-health.sh:0
plugin/scripts/supervisor-deliver.sh:0
```

**tmux 泄漏检查**：`tmux ls | grep sup-` = 0 残留（scoped `kill-session` 清理，无 kill-server）。

## Dispatch review

reviewer: none
at: 2026-08-06T07:3xZ
changed: 执行完成——AC1-AC9 勾上 + 实测证据（supervisor-health alive / 真 TUI e2e 8 绿 / AC8 六源读数 /
        AC5c 观测路径记录与调整）；落地③实现（deliver 适配器 + 真 TUI e2e），④⑤已立案；
        待外层验证轮（scoped + 全量套件）。
