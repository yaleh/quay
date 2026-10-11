# 架构自我演化闭环：Evidence Store → Semantic Investigator → Evolution Planner → Quay Goal/Task/AC/Gate/Fan-in → 独立 Evaluator → Learning Store

**Status:** live reference / design hypothesis — **全文零实现**，是把既有已验证框架的若干环节，第一次
显式切成可分别设计、可分别落地的具名角色与载体。不是科学定理，不创建 Goal，不改运行代码。

**本文不重复、只指路的既有正本：**
- 六步 bootstrap 管线（discover→propose→offline replay→shadow→limited-proposal→gated-activation）、
  meta-driver builder 设计（§7-9）、候选评价指标（§10）、已知结构性缺口（退役侧零工具化、"有产物≠有效"）
  → `docs/references/harness-semantic-compression-and-meta-driver-builder.md`。本文是把该文档的六步管线，
  在"架构证据与语义判断"这一个具体场景上，拆成更细的具名阶段——**不是平行发明一条新闭环**。
- Builder/Subject/Validator 三位一体身份、五步闭环（观察→语义架构判断→可证伪实验→实施/测试/合并→结果反馈）、
  GOAL-030~035 可核验案例索引、ownership/locality/演化成本/跨项目迁移等候选指标
  → `docs/references/quay-as-self-improving-engineering-system.md`。本文第 1 节直接把该文档的五步闭环
  映射到本文的七阶段命名，不重写其身份陈述。
- Ownership-first 具体方法论（branch:true Goal 标准流程、self-host 身份证明、negative control、
  before/after 指标表） → `docs/references/ownership-first-refactoring-methodology.md`。本文第 6 节直接
  引用其第 5、6、9、10 节作为"Evaluator 怎么对账"的既有技术，不重写。
- 概念模型、ownership matrix、ArchGuard 静态事实、8 条不变量、排序候选（含已拒绝清单）
  → `docs/architecture/quay-domain-model-2026-10-11.md`。本文把该文档的"Ranked candidates"一节，当作
  "Evolution Planner 的输出长什么样"的**已经发生过一次的真实样本**（人工产出，不是驱动产出），见第 2.4 节。
- 更早一版审查 → `docs/analysis/ownership-first-architecture-review-2026-10-10.md`。
- ADR 母体 → `adr/ADR-021`（元机制必须比被治理机制至少简单一个量级）、`adr/ADR-033`（schema-agent：
  语义值必须来自带 schema 的 agent，值到手后的算术必须是确定性代码）、`adr/ADR-004~007`（硬形变优先于散文）。

**Non-goals：** 不重新论证 GIT 几何框架；不重复既有六步管线/五步闭环的文字；不定义 Architecture Evidence
Store 的具体 JSON schema 代码或存储实现（只给字段级设计说明）；不创建、不草拟任何 Goal/Task；不裁定
GOAL-030~036 之外的任何任务应该做什么；不对"端到端架构自举实验"会话的实现细节下指令——两者并行、互相引用，
不是一份指挥另一份。

---

## 0. 与三层自举（L1 Execution / L2 Architecture Evolution / L3 Methodology Evolution）的对应

用户要求的三层命名不是平行发明，而是 `harness-semantic-compression-and-meta-driver-builder.md` §0.4
"Quay 的演化层级"表的重新标注——该表已经按"当前状态"分了四行，本文把它们合并映射到三层：

| 本文层级 | 对应 harness 正本 §0.4 行 | 当前状态 |
|---|---|---|
| **L1 Execution** | Task execution（单个任务 ready→done） | **真实运作** |
| **L2 Architecture Evolution**（本文主体，第 1-8 节） | Goal/investigation decomposition + 本文新增的 Evidence Store/Investigator/Planner/Evaluator 具名阶段 | Goal 层**真实运作**（GOAL-030~036）；本文新增的具名角色**设计假设，零实现** |
| **L3 Methodology Evolution** | Meta-driver proposal + Meta-driver builder | Meta-driver **真实但窄域且当前故障**（见 harness 正本 §6）；Meta-driver builder **零实现** |

**本文的定位**：L2 层目前只有"Goal 怎么切、怎么落地"这一半是真实机制（`branch:true` Goal 标准流程），
"观察怎么变成结构化、可复核、可对账的证据"这一半——目前只以**人工撰写的 prose 审查文档**（本文开头列出的
两份审查文档）形式存在，没有结构化载体、没有独立于撰写者的对账步骤、没有反馈回下一轮判断的机制。第 1-8 节
就是把这一半显式设计出来。L3 层（meta-driver builder）已经点名"退役/归并判据"是最弱环节（harness 正本
§7.4/§12）——本文第 2.7/9 节的 Learning Store 正是尝试填这个洞,但同样零实现。

---

## 1. 闭环总览：七阶段命名是既有五步闭环的细化，不是新闭环

`quay-as-self-improving-engineering-system.md` §2 的五步闭环：

```
观察（ArchGuard + git + 运行/测试）→ 语义架构判断（LLM，必须独立复核）
  → 可证伪的 Goal/Task/AC 实验 → 实施/测试/合并 → 结果反馈
```

本文把中间三步拆成七个具名阶段，每个阶段回答"谁产出、产出什么形状、现状是真实机制还是设计假设"：

```
Observe（ArchGuard/git/运行/测试，真实工具）
  → Architecture Evidence Store（结构化、带 provenance/commit/confidence，§2.2，设计假设）
  → Semantic Investigator（主动 bounded evidence / 显式 hypothesis / abstain / negative control，§2.3，设计假设）
  → Evolution Planner（确定性排序/去重/预算/准入，§2.4，设计假设，已有一次人工产出的真实样本）
  → Quay Goal/Task/AC/Gate/Fan-in（§2.5，真实机制，不改）
  → 独立 Evaluator（预测 vs 实测对账，§2.6，设计假设，已有两次人工 ad hoc 实例）
  → Learning Store / 策略更新（§2.7，设计假设，零实现）
  → （回到 Observe，下一轮）
```

**对应关系**：Observe = 五步闭环的"观察"；Evidence Store + Investigator = "语义架构判断"（拆成"先结构化
留痕"与"再做语义判断"两步，这正是第 2.2/2.3 节要新增的边界）；Planner + Goal/Task/AC/Gate/Fan-in = "可证
伪实验"+"实施/测试/合并"；Evaluator + Learning Store = "结果反馈"（拆成"先核对单次预测"与"再把核对结果
喂回策略"两步）。**拆分本身就是本文唯一的新增内容**——没有新发明观察/判断/实验/反馈这四件事,只是把"判断"
和"反馈"两个此前被含糊成一步的环节,各自切成两个独立可核验的子步骤。

---

## 2. 逐阶段设计

### 2.1 Observe — 真实工具，无需新设计

ArchGuard MCP 全部分析/依赖/重复/环检测工具、`git log`/`git archive`/`git diff`、suite/测试读数、
`/proc/<pid>/cmdline` 式直接量（`ownership-first-refactoring-methodology.md` §6）——全部已经是真实、
可复现的工具（`quay-domain-model-2026-10-11.md` §3 的两组独立审计互相印证就是现成证据）。**本节不提出
任何新机制**，只确认这一层不是本文要解决的缺口。

### 2.2 Architecture Evidence Store — 设计假设，零实现

**现状缺口**：今天的"证据"以两种形式存在——ArchGuard 工具调用的原始返回（短命，不落盘）与人工撰写的
prose 审查文档（`ownership-first-architecture-review-2026-10-10.md`、`quay-domain-model-2026-10-11.md`
本身）。后者已经按文档自己的惯例标注了 FACT/JUDGMENT/ASSUMPTION，但**这个标注活在散文里，不可查询、
不可跨文档聚合、没有 commit/时间锚点之外的结构化字段**。

**设计含义（字段级，不是代码/schema 实现）**：一条 Architecture Evidence 记录至少需要：
- `instrument`：产出这条证据的工具（`archguard_detect_cycles`/`git log`/suite 读数/人工 grep…）；
- `commit`：被观察对象的 commit SHA（`quay-domain-model.md` 已经在文中手写了这个字段——"both runs below
  target `develop @ 4743da9340f9b0845fcc8ad9d6aa0f084d11594c`"——本节只是把这个已经在人工实践里出现过
  的字段,正式列进载体设计）；
- `confidence`：复用既有的三态词表 FACT/JUDGMENT/ASSUMPTION（不新造词表——这正是 `quay-domain-model.md`
  开头"Method"一节已经在用的分级，本文只要求它变成结构化字段而不是散文标注）；
- `provenance`：谁产出这条记录——机械工具 vs 单次 LLM 判断 vs 经过独立复核的 LLM 判断 vs 人工裁定
  （对应硬规则 4 推论四"能解释的说法不等于被检验的结论"——provenance 字段存在的目的就是让"未经独立复核的
  语义判断"和"已经独立复核过的判断"在存储层面可区分，不是读者凭记忆分辨）；
- 到被引用的原始载体的指针（审查文档的文件:行号，或工具调用的原始 JSON 落盘路径）。

**没有这个载体之前的真实代价**：`quay-domain-model.md` §3 自己记录过一个例子——"Gate↔Fan-in 是平行
宇宙"这条判断在第一轮被第二轮反证推翻（`ScopedGateVerdict` 其实根本不到达 `GateEvent`），而这次纠正
目前只存在于该文档自己的文字里,下一次任何人（或驱动）重新调查同一个问题,没有结构化记录可查,只能重新读
一遍文档全文,或者更糟——重新犯一次同样的错误。Evidence Store 要解决的正是这个"纠正只存在于散文里"的
问题。

### 2.3 Semantic Investigator — 设计假设，零实现，但有真实的人工先例

**人工先例（本文不是凭空设计）**：今天两份审查文档的产出方式——"四组并行、各自标注 FACT/JUDGMENT/
ASSUMPTION 的 bounded 审查 + 一轮独立的、以证伪为目的的 Opus 反证"——已经是 Semantic Investigator
应该做的事的真实、完整的一次人工执行。本节要做的是把这个已经执行过的模式,列成一个**可重复调用的角色
的契约**,不是发明新的调查方法。

**契约（四条，全部已经在人工实践或既有硬规则里出现过，本节只是第一次合并列出）**：
1. **bounded evidence budget**——一次调查必须声明它打算调用多少次工具/读多少文件,不能无限探索（呼应
   `adr/ADR-021`"元机制必须比被治理机制至少简单一个量级"：一个无预算的调查本身就会变成比它调查的对象
   更重的机制）。
2. **显式 hypothesis，不是裸"判断"**——每条结论必须写成"如果 X 为真，应该能观察到 Y"的形式，而不是
   一句"我认为架构有问题"（呼应硬规则 4 推论四：没有"若 Y 为假结果会不同"的对照，不得作为结论投递）。
3. **abstain 是合法输出**——三态 FACT/JUDGMENT/ASSUMPTION 之外，还必须允许"证据不足，不给判断"
   （`NOT-EVALUATED`，呼应硬规则 3b："无法评估"必须有独立取值，不能与"合格"同形）。
4. **negative control 是强制的，不是可选项**——一条 hypothesis 若说不出"故意破坏它所称的架构性质后，
   这条 hypothesis 会不会变成假"，就不能被记录为已验证（直接复用 `ownership-first-refactoring-
   methodology.md` §9 对 AC 的要求，本节把它从"验收条件"泛化到"架构判断"这一类更一般的陈述）。

**与 phase B（shadow mode，第 9 节）的关系**：Investigator 在 phase B 阶段只读、只写 Evidence Store,
**没有** Goal 提案权限——这是 `harness-semantic-compression-and-meta-driver-builder.md` §8 既有 bootstrap
管线"shadow mode（接生产输入，只记录不产出）"这一步的直接复用,不是新发明的门槛。

### 2.4 Evolution Planner — 设计假设，已有一次真实的人工产出样本

**人工先例**：`quay-domain-model-2026-10-11.md` §7"Ranked candidates"一节——8 条候选，每条标注
impact/evidence strength/risk/minimal slice，外加一张"明确拒绝/降级"表——**这就是 Evolution Planner
的输出形状应该长什么样的真实样本**，只是今天由人工（两轮 Opus 对话）产出，不是由一个驱动产出。

**确定性边界（继承 ADR-033，不新造原则）**：Planner 消费 Investigator 产出的 Hypothesis 记录之后，
**排序/去重/预算/准入必须是确定性代码，不能是又一层语义判断**——否则产生"meta 的 meta"（`harness`
正本 §7.2 已经把这条原则应用在"多个 meta-driver 的 proposal 之间仲裁"这一层，本节是同一条原则在
"候选架构改动排序"这一层的复用）。哪些输入是语义值（Investigator 的 hypothesis/confidence）、哪些
计算是确定性算术（排序分数、预算扣减、重复 hypothesis 的去重键），必须在实现时显式分离——**这正是
ADR-033 的判据本身,不是本文新增的要求**。

**与第 5 节"no blind SCC optimization"的关系**：Planner 的排序函数是本文唯一一处"策略"真正体现的地方，
第 5 节的约束直接作用在这个函数上，不是一句独立的口号。

### 2.5 Quay Goal/Task/AC/Gate/Fan-in — 真实机制，不改

本文不改这一层的任何机制。Planner 的候选草案要变成真实工作，仍然走现有 `branch:true` Goal 标准流程
（`ownership-first-refactoring-methodology.md` §5）——fork point → Goal 激活 → 少量串行 task → branch
self-host → before/after → 人工触发 merge → 机械 fan-in → post-merge 验证 → 全部 AC achieved。**本文
唯一要求**（见第 9 节 phase C）：这一步的 Goal 立项必须经人工批准，Planner 产出草案不等于自动开 Goal。

### 2.6 独立 Evaluator — 设计假设，已有两次真实的人工 ad hoc 实例

**人工先例**：
- **GOAL-033**：立项时预测 package SCC `6→5`，分支落地后实测是 `6→4`（`fan-in` 随 `cli` 一并脱环）。
  Goal 自己的 `origin` 字段原样记录了这次"预测 vs 实测"的修正过程——**这就是 Evaluator 要做的事**，只是
  今天由任务作者本人记录，不是由一个独立于 Planner/Investigator 的角色核对。
- **GOAL-034**：立项时**明确预测并声明不会收缩 SCC**（因为收缩需要连带移动真实 config 加载逻辑，
  ownership 判断上是错的），落地后实测 SCC 维持 4——预测与实测一致，同样被原样记录。

**本节新增的唯一要求**：这两次对账目前都由**写下预测的同一个人/同一次会话**事后自己核对。独立性要求
（直接复用 `quay-as-self-improving-engineering-system.md` §3"语义判断必须经过至少一轮独立的、以证伪为
目的的复核"，从"架构判断"泛化到"预测-实测对账"）：**核对 Evaluator 的身份不能与产出 Hypothesis/Planner
草案的身份重合**——否则确认偏误（已经相信自己判断对的人,核对自己的预测,天然倾向于读出"对了"）。这正是
"独立"这个词在本文标题里出现的唯一理由。

**对账的技术手段**：复用 `ownership-first-refactoring-methodology.md` §6/§10 既有的 before/after +
negative control 技术（见第 6 节），不新造度量方法——Evaluator 新增的只是"必须有一个独立身份的角色
专门做这一步，并把结果写回 Learning Store"，不是新的测量技术。

### 2.7 Learning Store / 策略更新 — 设计假设，零实现，填一个已点名的洞

**已点名但未填的洞**：`harness-semantic-compression-and-meta-driver-builder.md` §7.4 已经说过，每个
driver"孵化时必须附带……明确的 retire/merge 判据——这是本仓库目前最弱的一环"；§12 进一步引用两份独立
分析确认"收缩相从未被机制触发，全部由人发起"。**Learning Store 就是尝试填这个洞的具体载体**——不是
本文凭空提出的新需求，是既有文档已经点名缺失、本文给出一个具体形状的尝试。

**设计含义（同样只是字段级，非实现）**：按实验（一次 Goal 的立项→落地→Evaluator 对账）为单位，持久化
"预测了什么、实测了什么、匹配/不匹配、Investigator 的哪条 hypothesis 和 Planner 的哪条排序分量对这次
匹配/不匹配负责"。**用途有且只有两个，不能再加**（呼应 ADR-021 对元机制规模的约束）：
1. 校准 Investigator 的 confidence 标注（某类 hypothesis 反复被独立复核推翻 ⇒ 下调该类的默认 confidence，
   而不是继续允许它以同样的置信度进入 Planner 排序）；
2. 触发 retire/merge 判据（某个 driver-candidate 或 hypothesis 类别反复被证伪 ⇒ 这是 harness 正本
   §7.3 D 类工作"纠偏过度推广"第一次有机械数据可以触发，而不是只能靠人凭印象）。

**现状**：零条真实记录——GOAL-033/034 的"预测 vs 实测"目前各自散落在各自的 Goal 文件里，没有被聚合进
任何可跨 Goal 查询的载体。第 9 节 phase D 把"至少一次真实聚合+至少一次真实触发"列为 exit 读数，不是
现状。

---

## 3. Domain Driver vs Execution Infrastructure

本文新增的角色（Investigator/Planner/Evaluator）**不应该被实现成新的执行基础设施**——现有 6 种 Driver
kind（promotion/worker/outer/quality/meta/goal，`quay-domain-model-2026-10-11.md` §1"Driver"行）已经
共享 anchor 托管、`KIND_STOP` 注册、control-state、resource-gate 这套 **Execution Infrastructure**。
设计含义：

- **Execution Infrastructure**（不新造）：anchor 进程托管（`driver-anchor.ts::runAnchor`）、启停/暂停
  原语（`driver-shared.ts`/`driver-runtime.ts` 的 `applyHalt`/`writeControlState`）、worker 派发与
  fan-in（`worker-driver.ts`/`worker-fan-in.ts`）、Gate 引擎（`gate/engine.ts::runGate`）——这些是
  domain-agnostic 的"怎么跑起来、怎么落地"，Investigator/Planner/Evaluator 应该作为**第 7 种 Driver
  kind**（或挂在既有 `meta`/`quality` kind 之下的新 Routine）复用它们，不是重新实现一套调度/锁/落地
  机制。
- **Domain Driver**（本文新增角色的真实落点）：Investigator 的"怎么判断架构语义"、Planner 的"怎么排序
  候选"、Evaluator 的"怎么对账"——这些是 domain-specific 的语义/策略逻辑，对应 `harness` 正本 §7.1
  "每个 meta-driver 对应一个长期语义维度，输出结构化 proposal，不直接执行"同一条原则：**执行权仍归
  确定性的 lifecycle/gate 层**。
- 这与 `harness` 正本 §9"Layer A（通用引擎）/ Layer B（项目本地配置）/ Layer C（运行时状态）"三层切分
  是同一条边界的两种措辞——Domain Driver 的产出落在 Layer B（本项目的架构判断策略），不碰 Layer A
  （execution infrastructure 本身）。

---

## 4. Quotas 作为 Driver 声明式策略 + 全局 cap

本文不新造配额机制。既有正本 `routineQuotaDecision({perRoutine, global}, {k, globalCeiling})`
（`plugin/scripts/routine-file-gate.ts`）已经是"声明式策略 + 全局上限"的真实实现——`globalCeiling`
是该函数签名里已经存在的参数（当前至少一个调用点把它设为 `Infinity`，即"声明了上限参数、但这次调用没有
真正设上限"——这本身是硬规则 4 推论二"「在本机等价于无限制」的字面值不是无限制"的一个真实活体例子，
值得在接入新 Domain Driver 时一并核实，不要延续同一个"参数存在但形同虚设"的状态）。

**设计要求**：Investigator/Planner 的调度频率（phase B/C，第 9 节）必须复用这同一个函数/同一套
`{perRoutine, global}` 输入形状，并为 `globalCeiling` 声明一个真实、非 `Infinity` 的值——不新建一套
平行的配额判断。GOAL-034/GOAL-035/`DIR-132`已经把"声明式配额/独立策略/全局安全上限"这条轴投资过一轮
（`ownership-first-architecture-review-2026-10-10.md` 开头明确声明"本审查不重新讨论该轴，已在本会话早些
时候调查并关闭"）——本文同样不重新讨论该机制设计本身，只要求新角色接入时复用它。

---

## 5. 不盲目优化 SCC（no blind SCC optimization）

这是对第 2.4 节 Evolution Planner 排序函数的一条硬约束，直接继承自两个已经发生过的真实裁定，不是本文
新提出的口号：

- **GOAL-033**：最终实测 SCC `6→4`，但立项时的范围声明是"只拆 `core-root⇄core-cli` 这一对，不碰 `gate/`
  `fan-in/`之间的其它互指"——SCC 数字的改善是范围正确之后的**副产物**，不是立项时追的指标。
  （`ownership-first-refactoring-methodology.md` §0.2 已有详述。）
- **GOAL-034**：立项时**明确拒绝**为了让 SCC 归零而移动真实 config 加载逻辑——"ownership 判断上是错的，
  所以没做"，并把"SCC 维持 4、这次不会让数字变好看"原样写进 Goal 记录。

**Planner 排序函数的约束**：候选排序**不得**把"ArchGuard SCC 数下降"当作单一或首要的排序分量。
Ownership 是否正确（状态/决策/副作用归属是否清楚，`ownership-first-refactoring-methodology.md` §1）
必须优先于任何单一结构性指标的好看程度——这与"指标服从 scope，不为指标扩大范围"（该正本 §4 GOAL-031
的教训）是同一条原则在"排序"而非"范围"这个环节上的应用。

---

## 6. Self-host N/N+1 独立验证 + promotion/rollback gates

**N/N+1 的既有定义**：`ownership-first-refactoring-methodology.md` §5 第 5 步——"同一套 ArchGuard CLI，
对 fork point（N）和分支尖端或合并提交两个父提交（N+1）各做一次单根 `git archive` 提取后分析，比较结构
性指标"。本文第 2.6 节的 Evaluator **复用这同一个技术**作为它对账"预测 vs 实测"的主要手段,不新造测量
方法。

**self-host 身份证明**（同正本 §6）：分支上跑的代码必须被证明是分支自己的代码，不是侥幸读到主检出或
全局安装版本——靠 `/proc/<pid>/cmdline` 直接量 + 负对照（主检出驱动同一 sandbox 必须产出 0 条匹配事件）。
这是 Evaluator 对账"实测"读数之前的**前置有效性条件**：一个 N+1 读数如果不能先证明是分支自己跑出来的，
对账本身就是无意义的。

**promotion/rollback gates 已经是真实机制**：`quay task check`（CLAUDE.md"Gate engine"一节）已经暴露
`promote`/`retreat`/`adjudicate`/`complete` 等 lifecycle 动词——**retreat 就是本文语境下的 rollback**。
本文不新造回滚机制：一个经 Evaluator 对账后"预测与实测不匹配、且判定为回归"的 Goal/Task，走现有
`retreat`（退回 `needs-human` 或更早状态）路径，不是发明一个新的"撤销"动作。

---

## 7. 正/负案例语料：现状核实结果（含两处与用户原始措辞的冲突，必须先更正）

| 案例 | 用户原始措辞 | **本次核实结果** | 状态 |
|---|---|---|---|
| GOAL-030~035 | "GOAL-030~036" | `goals/GOAL-030`~`GOAL-035` 六个文件均已 **achieved 且并入 develop**，已有完整案例索引 → `quay-as-self-improving-engineering-system.md` §4，本文不重复 | **证据充分** |
| GOAL-036 | 用户把它与"ClaudeCodeUI"并列提及 | **核实结果：`goals/GOAL-036-...md` 真实存在，但主题是"WorkerPool 在飞排除集合收敛到单一纯函数计算点"，与 ClaudeCodeUI 无关**；`.quay/` 下有该 Goal 对应的 fan-in/suite 日志，像是另一条会话/worker 正在执行中,**尚未 achieved**，不应作为"已完成正案例"引用 | **编号冲突，已向协作会话（"端到端架构自举实验"）同步，避免其把 GOAL-036 误用为 ClaudeCodeUI 案例** |
| ClaudeCodeUI | 作为 GOAL-036 的同义词 | **全仓库零命中**（`grep -rln "ClaudeCodeUI\|claude-code-ui\|claudecodeui"` 只命中与本次任务无关的既有文件：`README.md`/`webui-guide.md` 等讨论 quay 自己 Web UI 的文档，没有一处指向一个叫 ClaudeCodeUI 的外部项目）| **ASSUMPTION，未核实** — 若要用作跨项目正案例语料，需先确认这是哪个具体仓库/版本，再补充独立验证（参照第 0.2 节"跨项目迁移是验证压缩是否可迁移的关键实验"——语料必须可独立核验，不能是听闻） |
| ArchGuard `readDeviceName` | 作为负案例 | **全仓库零命中**（`grep -rn readDeviceName`，含 `.ts`/`.md`/`.js`） | **ASSUMPTION，未核实** — 本仓库找不到出处，可能来自 ArchGuard 自身代码库或另一个项目的历史案例；在没有源头指针之前，不得在任何 replay harness（`experiments/offline-replay/harness.py` 式）里当作已验证负样本使用 |

**对 Evaluator/Learning Store 的含义**：第 9 节 phase A/B 的"正负案例语料"输入，**暂时只能真实使用
GOAL-030~035**（+ GOAL-036 落地后，若其主题被确认与架构-ownership 轴相关，可追加）；ClaudeCodeUI 与
`readDeviceName` 在补上可核验来源之前，只能标记为**候选**，不得进入任何机械对账的基线语料（呼应硬规则
5"在某来源搜不到 X，只有当该来源对 X 完备时才等于 X 不存在"——这里的结论是"在本仓库找不到"，不是"这两个
案例不存在"，措辞必须准确）。

---

## 8. 评价指标：复用既有候选表，只新增本文特有的两项

`quay-as-self-improving-engineering-system.md` §5（ownership 质量、变更局部性、复杂度增长、演化成本、
故障恢复、跨项目迁移）与 `harness-semantic-compression-and-meta-driver-builder.md` §10（proposal
acceptance rate、后续成功率、重复率、干预后改善、误报成本、portfolio 覆盖/重叠、可重现历史决策链）
**已经覆盖用户要求的 ownership/locality/costs/error rates/transfer 五类**，本文不重复列表，只新增
Investigator/Evaluator 这组具名角色特有的两项（同样标注候选、未实现、未测量）：

- **hypothesis 级证伪率**：Investigator 产出的 hypothesis 中,被独立复核推翻/降级/判定非缺陷的比例。
  **已有真实历史数据点，不是凭空定义**——`quay-domain-model-2026-10-11.md` §7 的"Explicitly rejected or
  downgraded"表：8 条候选中 1 条被判"错误问题本身"、1 条被判"过度设计"；`ownership-first-architecture-
  review-2026-10-10.md`：9 条发现中 1 条被纠正为更严重、2 条被降级为表面问题、1 条被判"根本不成立"。
  两轮合计约 5/17 条初始判断在独立复核后被修正——**这是一个真实比例，不是假设**，可作为 phase B（第 9 节）
  的 baseline 参照，但样本量小（两轮、同一批审查），不应外推为稳定比率。
- **预测-实测对账一致率**：Planner/Evaluator 环节落地的 Goal 中，post-merge 实测与立项时声明预测一致的
  比例。**目前仅有两个真实数据点**：GOAL-033（预测 6→5，实测 6→4，不一致，已自我修正并记录原因）、
  GOAL-034（预测维持 4，实测维持 4，一致）。样本量为 2，不足以定任何阈值，仅作为第 9 节 phase C 的
  exit 读数起点。

---

## 9. 四阶段路线图：A Evidence Store / B Shadow Investigator / C Supervised Goal Experiments / D Meta-driver Builder

| Phase | 目标 | 产物 | Exit 读数（不设无历史支撑的阈值，呼应硬规则 12） | 当前状态 |
|---|---|---|---|---|
| **A — Evidence Store** | 把 Observe 层的输出结构化（§2.2 字段设计）落到一个可查询载体，首批写入对象就是本文引用的两份既有审查文档里已经做过的判断 | 一个载体（格式未定——JSONL/sqlite 均可，本文不替实现选型）+ 一个把既有两份审查文档的判断回填进去的一次性迁移 | 至少把本文引用的两份既有审查文档的全部 FACT/JUDGMENT/ASSUMPTION 标注，结构化迁移进载体并可按 `confidence`/`commit` 查询——这是一个已知、有限的回填任务，不是凭空设的数字 | **零实现** |
| **B — Shadow Investigator** | Investigator 按 §2.3 四条契约运行，只读、只写 Evidence Store，无 Goal 提案权限（直接复用 harness 正本 §8 既有 shadow mode 定义） | N 条结构化 hypothesis 记录（N 由实际运行决定，不预设） | 若干条 hypothesis 经独立复核后，§8 的"hypothesis 级证伪率"有一个基于**本阶段真实产出**（不是沿用第 8 节两轮人工审查的旧数据）的读数 | **零实现** |
| **C — Supervised Goal experiments** | Planner 候选经人工批准后开 `branch:true` Goal，走现有标准流程（第 2.5/6 节），Evaluator 独立对账 | 若干条"预测 vs 实测"对账记录 | 至少一次由本阶段真实产出的对账记录（不是第 8 节引用的 GOAL-033/034 旧样本）落进 Learning Store | **零实现**，但沿用的底层机制（branch:true Goal 流程）**真实运作** |
| **D — Meta-driver builder** | Learning Store 聚合 phase C 的对账记录，触发 Investigator 置信度校准或 driver-candidate 的 retire/merge 判据（填 harness 正本 §7.4/§12 已点名的洞） | 策略更新记录 + 至少一次机制触发的 retire/merge 判定 | 至少一次真实的 retire/merge 判定由 Learning Store 数据触发，不是人凭印象裁定——这正是 `docs/analysis/crystallization-the-contraction-phase-has-no-mechanism.md` 指出的"收缩相从未被机制触发"第一次被证伪的机会，而不是又一次宣称"接上就会好" | **零实现** |

**四阶段的依赖关系是严格串行的**：B 需要 A 的载体才能把 hypothesis 写到有结构的地方；C 的 Evaluator
对账需要 B 产出的 hypothesis 作为"预测"的来源（而不是像 GOAL-033/034 那样由人工在 Goal 文件里手写
预测）；D 的 Learning Store 需要 C 产出至少一批真实对账记录才有东西可聚合。**任何阶段都不应该在前一阶段
产出真实数据之前,跳着设计**——这正是硬规则 12"没有发生率读数不得设前置/阈值"在路线图设计本身上的应用。

---

## 10. 分级结论（沿用既有四级惯例，不新造分级）

- **证据充分（已验证事实）**：Observe 层现有工具的可复现性（第 2.1 节，`quay-domain-model.md` §3 两组
  独立审计互证）；GOAL-033/034 的预测-实测对账是真实发生过的 ad hoc Evaluator 实例（第 2.6 节）；
  `routineQuotaDecision` 的声明式配额+全局 cap 参数形状真实存在（第 4 节，但 `globalCeiling:Infinity`
  这一具体调用点提醒接入时需要核实是否真的设了上限）；GOAL-033/034 对"不盲目优化 SCC"的裁定是真实、
  已记录的先例（第 5 节）；GOAL-036 存在但主题与 ClaudeCodeUI 无关、`readDeviceName` 在本仓库零命中
  （第 7 节，两处均为本次核实的真实读数，不是假设）。
- **机制成立，待验（设计工作假设）**：Architecture Evidence Store 的字段设计（§2.2）；Semantic
  Investigator 的四条契约（§2.3）——结构上可以从既有的三态词表/负对照/bounded 审查实践拼出来，但没有
  任何一步被实际作为一个可重复调用的角色跑过；Evolution Planner 的确定性排序层（§2.4）——`quay-domain-
  model.md` §7 证明了"产出形状"可以由人工做出来，没有证明"由驱动做出来"同样可行；Learning Store（§2.7）
  ——填一个已被两份独立分析点名的洞，但本文给出的只是用途边界，没有实现。
- **工作假设，非定理**：第 0 节 L1/L2/L3 三层映射本身是一个解释性框架；第 3 节 Domain Driver vs
  Execution Infrastructure 的切分是对既有 Layer A/B/C 切分的重新措辞，尚未在新角色上实际验证过这条边界
  是否真的够用。
- **观察项（研究方向，含两处需要外部确认才能转为事实）**：ClaudeCodeUI、ArchGuard `readDeviceName` 作为
  跨项目语料的可用性——两者在本仓库均未核实，需要来源指针（第 7 节）；第 9 节四阶段的 exit 读数——目前
  只有 phase 间的依赖顺序是确定的，具体数值全部待第一次真实运行产出后才能回填，本文不预先虚构。

---

## 一句话压缩版

**既有五步闭环（观察→语义判断→可证伪实验→实施→反馈）里,"判断"与"反馈"两步此前含糊不清——本文把它们
各自拆成两个具名、可独立核验的角色（Evidence Store 让观察变成带 provenance/commit/confidence 的结构化
记录而不是散文；Semantic Investigator 把"判断"收紧成 bounded evidence + 显式 hypothesis + abstain +
negative control 四条契约；Evolution Planner 把候选排序钉死成确定性算术,且明确禁止拿单一结构性指标
当排序分量；独立 Evaluator 把"落地后到底对不对"从事后自我感觉收紧成预测-实测对账,且核对者不能是提出
预测的人；Learning Store 把对账结果喂回策略,去填 harness 正本早已点名但从未被填的"退役判据零机制"的
洞）——四个阶段（Evidence Store→Shadow Investigator→Supervised Goal Experiments→Meta-driver Builder）
严格串行、每一步的 exit 条件都要求真实产出的读数而非预设阈值，且全文核实结果显示：GOAL-030~035 是真实
正案例，GOAL-036 存在但与 ClaudeCodeUI 无关，ClaudeCodeUI 与 ArchGuard `readDeviceName` 在本仓库目前
都找不到出处,用作语料前必须先补上可核验的来源指针。**
