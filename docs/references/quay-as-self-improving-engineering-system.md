# Quay 的长期身份：Builder / Subject / Validator 三位一体，与它自己的演化闭环

**Status:** live reference — 长期愿景与设计原则声明，不是已证明的科学定理。**本文只声明"是什么"和"闭环长什么样"，
不发明新机制、不创建新 Goal、不改动运行代码。** 与本文并列、互相引用、不重复彼此细节：

- 理论与演化闭环的既有正本 → `docs/references/harness-semantic-compression-and-meta-driver-builder.md`
  （harness/结晶框架、六步演化管线的完整形式化、meta-driver builder 设计含义——本文**不重复**其第 0-13 节，
  只在它已有的框架之上补三件它没做的事：Builder/Subject/Validator 三位一体的身份陈述、GOAL-030~035 的可追
  踪案例索引、把"Quay 建造其他系统"而非只"Quay 建造自己"摆到同等位置）。
- Ownership-first 具体机制 → `docs/references/ownership-first-refactoring-methodology.md`。
- 今天产出的两份闭环现场样本 → `docs/analysis/ownership-first-architecture-review-2026-10-10.md`（观察）、
  `docs/architecture/quay-domain-model-2026-10-11.md`（语义判断 + 两轮对抗性反证）——本文第 3 节直接引用
  这两份作为"闭环现在跑到哪一步"的实物证据，不是假设的例子。
- 产品层"Quay 是什么"的既有陈述 → `README.md`（尤其"Quay in practice"一节的 dogfooding + CloudCLI 跨项目
  实测数据，本文第 2 节直接引用，不重新测量）。

**Non-goals：** 不重新论证 GIT 几何框架本身（已被 `geometry-as-llm-architecture-interface.md` 审计过，
本文继承其"诚实条款"，不援引连续几何层的数值）；不设计 meta-driver builder 的具体实现（见既有正本第 7-9
节）；不虚构任何未发生的效果——第 4 节的案例索引只收录本仓库 git 历史上**真实 achieved 并已并入 develop**
的 Goal，每条附可复核的提交 SHA。

---

## 1. 身份陈述：Quay 同时是 Builder、Subject 与 Validator

**Quay 是一个用来建造更多软件系统的软件工程系统**——它的产品面（Core + Provider ABI + 六类 driver 常驻
循环）面向**任意**代码仓库，不只面向自己（`README.md`"What you can do with quay"一节、Provider ABI 的
"quay-native / quay-github / 原则上任何实现同一 ABI 的 tracker"设计）。

这个系统同时扮演三个角色，且**三者的对象可以是同一个仓库，也可以是不同仓库**：

| 角色 | 含义 | 本仓库的具体样本 |
|---|---|---|
| **Builder** | 把一个 Goal 拆成 task，派 worker 并行实现，落地到 develop。 | 本仓库自己的 `tasks/*.md`（`quay` 的产品代码）；`CloudCLI`（`README.md`"Quay in practice"：18 天 5,548 commits，一个独立、可公开核验的 fork）。 |
| **Subject** | 被 Builder 改造的对象——代码本身，连同它的架构。 | 本仓库 `packages/quay/src`、`plugin/scripts` 自身；CloudCLI 自己的代码库。 |
| **Validator** | 判断 Subject 的改动是否可接受——gate/fan-in 的机械判据 + ArchGuard/语义审查的架构判据。 | `gate/engine.ts::runGate`（机械层）；本文第 3 节引用的两份今日审查文档（语义层）。 |

**当 Builder 改造的 Subject 恰好是 Quay 自己时，三个角色重合在一个仓库里**——这正是本仓库"BAIME
（Bootstrapped AI Methodology Engineering）"实验的字面含义（`README.md` 已有陈述，本文不重新定义，只把
它放进 Builder/Subject/Validator 这套更一般的词表里）。**这不是比喻，是结构性事实**：GOAL-030~035（第 4
节）的每一条，Quay 的 driver 既是"正在被改的代码"（Subject），也是"落地这次改动的机制"（Builder）——
GOAL-035 的落地说明文字本身就记录了这一点："本 goal 修改的是 worker-driver.ts 自身……fan-in 阶段恰好由
生产中的 worker-driver 来执行"。

**当 Builder 的对象是另一个仓库（CloudCLI）时，角色分离**：Quay 是 Builder+Validator，CloudCLI 的代码是
Subject。**两种模式目前都是真实运作的（证据充分），不是其中一种已验证、另一种是设想**——`README.md` 的
dogfooding 数字（84 天、27,008 commits、5,110 个任务分支落地）与 CloudCLI 数字（18 天、5,548 commits）
是同一条机制在两个不同 Subject 上的独立观测。

**长期能力目标的表述（本文新增，之前没有被这样写过一次）：Quay 的标准不是"能不能建完一个功能"，而是能不能
持续理解、评价、并改善自己与其他项目的架构**——"理解"= 第 3 节的观察层（ArchGuard 结构事实 + 语义判断）；
"评价"= 第 5 节的扩展指标；"改善"= 落地的 Goal/Task/AC（第 4 节的案例索引是这件事目前仅有的、真实发生过的
样本，不是宣称）。

---

## 2. 闭环：观察 → 语义架构判断 → 可证伪实验 → 实施/测试/合并 → 结果反馈

```
观察（ArchGuard 结构事实 + git 历史 + 运行时/测试读数）
  → 语义架构判断（LLM 对结构事实的解释，必须独立验证，不能只信一次通过）
  → 可证伪的 Goal/Task/AC 实验（branch:true Goal + 负对照 + 最小切片）
  → 实施 / 测试 / 合并（worker 落地 + fan-in 机械判据 + post-merge 读数）
  → 结果反馈（下一轮观察读到这次改动的真实效果，closes the loop）
```

这不是新循环——它是既有正本 `harness-semantic-compression-and-meta-driver-builder.md` §3 "六步结晶管线"
在"谁来验证语义判断"这一环上的具体化（那份文档已经写过 explore→discover manifold→encode bias→mechanize
→expose residual→explore again；本文的五步是它在"架构审查"这一具体场景下的重新标注，不是平行发明）。

**本文新增的唯一澄清：第二步"语义架构判断"必须与第一步"观察"结构上分离，且必须被独立复核，不能只跑一次。**
这是 `ADR-004`（硬形变优先于散文）与硬规则 4 推论四（"能解释的说法不等于被检验的结论"）在"架构判断"这个
具体场景下的落地——理由见第 3 节的继承边界，证据见第 3 节引用的两轮对抗性反证现场样本。

**闭环今天跑到哪一步（如实陈述，不夸大）**：

- `docs/analysis/ownership-first-architecture-review-2026-10-10.md`——**观察**步骤的完整样本：ArchGuard
  结构事实（SCC/fan-in/fan-out/体量）+ 四组并行语义审查（每组都标注 FACT/JUDGMENT/ASSUMPTION）+ 一轮对抗性
  反证（独立 Opus 会话，专门尝试证伪强claim，而非确认）。该文档本身记录了反证**纠正了什么**（一条 claim
  被证实更严重，两条被降级为表面问题，一条被证明根本不成立）——这是"语义判断必须独立验证"这条原则**真实
  发生过一次**的记录，不是本文凭空提出的要求。
- `docs/architecture/quay-domain-model-2026-10-11.md`——把观察推进到**概念模型 + 不变量 + 候选切片**：
  两个独立的 ArchGuard 静态审计（本会话 + 一个同机 peer 会话，针对同一个 commit，彼此交叉确认）；一次
  "提出目标设计"→"第二轮独立对抗性反证"的往返（其中我自己起草的两条提案被反证推翻——一条判断错了问题
  本身，一条被判过度设计——都在该文档里原样保留记录，没有悄悄改掉）。
- **闭环尚未推进到的步骤（如实声明，不假装已完成）**：这两份文档产出的候选切片**还没有**被开成
  branch:true Goal、**没有**走到实施/测试/合并、**没有**产出"结果反馈"——按本轮人的明确指示，这一步
  暂缓。本文第 4 节的案例索引（GOAL-030~035）记录的是**之前**几轮确实走完整个闭环的真实样本，不是本次
  审查已经产出的新样本。

---

## 3. ArchGuard 提供结构事实，语义模型需要独立验证——两者不可混同

**这条边界不是本文发明，是继承**（`geometry-as-llm-architecture-interface.md` 的审计结论 + 本仓库
`docs/architecture/quay-domain-model-2026-10-11.md` 的第 3 节已经逐条标注）：

- **ArchGuard 提供的是结构事实**：SCC 成员、fan-in/fan-out 边数、文件/函数体量、重复代码组、依赖方向——
  这些是**可复现的**（同一 commit、同一 scope，不同会话跑出相同数字——`quay-domain-model-2026-10-11.md`
  §3 的两组独立审计互相印证就是这条可复现性的真实样本，不是假设）。
- **"这个结构事实意味着什么"是语义判断，ArchGuard 不提供，也不应该被要求提供**——是否构成"god module"、
  "职责下沉错误"、"隐式状态机"，是 LLM 在结构事实之上做的解释，天然可能出错（`quay-domain-model-
  2026-10-11.md` 记录的"ScopedGateVerdict 从未真正到达 GateEvent"就是一次语义判断被证明读错代码的真实
  例子）。
- **混同两者的危险形态**：把"ArchGuard 报了一个重复组"直接读成"这里有重复代码该合并"（`ownership-first-
  refactoring-methodology.md` §2 已经提醒过这一点："duplicate ≠ equivalent，ArchGuard 的重复命中只是
  调查入口，不是合并触发器"——本文把这条既有纪律泛化到整个语义判断层，不只是重复检测）。

**本文新增的唯一要求**：任何由 Quay（或任何 LLM 会话）产出的架构级语义判断，在被当作"结论"写进 Goal/Task
之前，必须经过**至少一轮独立的、以证伪为目的的复核**（不是"再读一遍确认"，是"专门尝试找出它错在哪里"）。
这不是新流程发明——是把今天两份现场文档里**实际发生过**的两轮 Opus 对抗性反证，从"这次恰好这样做了"提升
为"以后每次都应该这样做"的声明。

---

## 4. GOAL-030~035 案例索引（真实、可复核，不虚构效果）

每条只收录**已 achieved 且已并入 develop**的 Goal，附合并提交 SHA（可用 `git log --oneline develop | grep
<sha>` 直接复核）与**实测**（非预测）的结构性读数。

| Goal | 范围（一句话） | 合并提交 | 实测结果（非预测） | 一条教训 |
|---|---|---|---|---|
| **GOAL-030** | 任务转移决策（状态表/决策/副作用）从 `gate/lifecycle.ts`/`task-ops.ts` 收敛到 `kernel/task-transition.ts` | `d71d2bde4` | `LIFECYCLE_EDGES`/`patchStatusField` 各恰好 1 个 export 站点；`ready-pool-check.ts` 对 `patchStatusField(` 的直接调用从有到 0；`plugin/scripts→kernel` 边强度 14→16 | 负对照本身也需要被验证：最初为"单一 import 玩具分支"设计的负对照算术被真实落地的两条边证伪过一次，任务记录保留了这次证伪过程，没有悄悄改数字（方法论正本 §8）。 |
| **GOAL-031** | `needs-human` 字面量比较从 `goal-driver.ts` 5 处收敛到既有正本 `task-status.ts` | `117ee91b8` | `grep -c 'status === "needs-human"' goal-driver.ts`：6→1（剩 1 处是另一词表，非漏改） | 立项时的目标数值（literal dispersion 5→≤2）本身算错了——执行前核实发现 3 处是异词表假阳性，正确底线是 4 不是 2；选择订正数值而不是为了凑数值扩大范围（方法论正本 §4）。 |
| **GOAL-032** | `criterion-fidelity.ts`/`goal-driver.ts` 两个重复验证函数收敛到 `kernel/verdict-parse.ts::parseBinaryVerdict` | `0da918926` | 算法重复组 2→1（ArchGuard `detect_duplicates`）；两个真实调用方**零改动**（ownership migration，不是删除重复） | duplicate ≠ equivalent：合并前核实了四项（算法是否真的相同/输入输出形状/not-evaluated 行为/调用方消费方式），结论 equivalent 后才动手，且编排层故意保持不同（一个同步无缓存、一个异步两次采样）不碰。 |
| **GOAL-033** | `packages/quay/src`⇄`cli/` 依赖环切除（driver 控制客户端+词表下沉 core-root） | 该 goal 自身记录的合并提交 | package SCC **6→4**（立项预期 6→5，`fan-in` 随 `cli` 一并脱环——实测修正了预期，goal 的 `origin` 字段原样记录这次修正） | 最小充分颗粒度的真实边界样本：边界本身在执行中被测量修正过一次，这不弱化判据，是判据的另一重证据。 |
| **GOAL-034** | `gate/config/utils.ts` 的纯原语+两个类型下沉 `kernel/gate-run-options.ts`，删除死 re-export shim | 本会话落地，`1cab409f0` | root→`gate/config` 边 1→0；两个死文件/shim 消失；**SCC 维持 4（本刀明确不承诺收缩，经两位独立 peer 会话手工推导确认：收缩需要连带移动真实 config 加载逻辑，ownership 判断上是错的，所以没做）** | ownership 正确的窄切片与能让 SCC 收缩的宽移动可能存在真实张力——本 goal 选择前者，**诚实记录"这次不会让数字变好看"**，不为了指标好看反过来扩大范围。 |
| **GOAL-035** | WorkerPool "needs-human 终态转移"的决策/副作用从 3 条独立写法收敛到 `applyNeedsHumanTransition` | 本会话落地 | quick-death 路径的转移此前结构上不可观测（不进 `needsHumanResults`、不发 json 事件），现在三条路径行为一致；`kind` 误标（quick-death 被默认标成 `retry-cap`）已修正 | 两个真实实例（stop-terminal 路径 + retry-cap 路径）已经共享同一段批处理代码，第三个（quick-death）不跟进才是异常——"第二个真实实例才升格为模式"原则的反向确认：抽函数不是提前设计,是补齐已经存在的收敛。落地后还牵出一个真实的尾部缺陷（`gap-ac356`：判据自己的子检查结构上恒假，被两轮独立复核修好）。 |

**没有收录的**：本会话今天产出的两份审查文档（第 2 节已如实声明）提出的候选切片——它们**还不是** Goal，
不满足本节"已 achieved 且已并入 develop"的收录门槛。

---

## 5. 评价指标：不只是完成率/测试绿

既有正本 `harness-semantic-compression-and-meta-driver-builder.md` §10 已经列过一组候选指标（proposal
acceptance rate、后续任务成功率、重复率等），**本文不重复，只补它没覆盖的六项**——同样标注为**候选、
未实现、未测量**，不作既定 KPI（继承既有文档的分级纪律，不是降低标准）：

| 候选指标 | 含义 | 现状 |
|---|---|---|
| **领域模型质量** | 核心概念（Driver/Routine/Pool/Task/Goal/Gate/Fan-in/Session/Run/Attempt/Policy）是否各有单一、声明式的身份，关系是否显式而非靠约定 | `quay-domain-model-2026-10-11.md` 是第一次把这件事变成一份可复核文档，但文档本身只是**观察**，还没有变成一个随每次改动自动重算的度量 |
| **变更局部性** | 一次改动真实触达的文件/边数，相对于它解决的问题的语义范围（GOAL-030~035 的"非目标"清单是这项指标的既有操作化——明确排除不碰的文件，而不是事后数文件数） | 每个 branch-mode Goal 已经在人工写 AC 时隐式做这件事；没有自动计算 |
| **复杂度增长** | ArchGuard 体量/SCC/耦合矩阵随时间的轨迹（而不是单点快照） | 本文第 3 节引用的两次独立审计给出了一个时间点的快照；没有跨时间的轨迹数据 |
| **演化成本** | 落地一个等价大小的切片，所需的 task 数/worker 轮次/人工裁定次数，是否随 harness 成熟而下降 | GOAL-030~035 六次样本理论上可以互相对照，但本文不虚构这个对照——没有人做过这项统计 |
| **故障恢复** | 一次改动引入的回归，被发现到被修复的时间/轮次（GOAL-035 自己的 `gap-ac356` 尾部缺陷是一个真实样本：从"achieved"到"发现判据恒假"到"两轮复核修好"全程有时间戳可查） | 有单个真实样本，没有汇总统计 |
| **跨项目迁移** | 同一条机制/原则搬到第二个项目，是否只需要重新校准参数，而不需要重新发明 | **这是本仓库目前唯一有真实、独立可核验数据的一项**——CloudCLI（`README.md`"Quay in practice"）是同一条 Builder 机制作用在一个完全独立仓库上的真实样本（18 天、5,548 commits，公开 fork）；本会话内 archguard 插件会话以只读方式独立复核了本仓库的 ArchGuard 读数，是"评价机制本身也能跨会话复用"的一个小样本。**仍然不是**"给定一个新项目，发现它需要哪些 driver"（既有正本 §7.5 已经点名这是零实现的部分，本文不重复声明已解决）。 |

**正负样本存档**：今天的 `ownership-first-architecture-review-2026-10-10.md` 的"Explicitly rejected or
downgraded"表 和 `quay-domain-model-2026-10-11.md` §7 末尾的同类表，是本仓库**第一次**把"被否定的重构提案"
当作与"被采纳的提案"同等重要的记录对象，而不是事后遗忘。**本文建议（不是本轮实施）**：未来的架构审查应
持续向这两份文档（或其后继）追加正负样本，而不是每次重新发现同一批已经被否定过的候选——但建立这个追加
机制本身是否需要新代码/新 Goal，留给之后裁定，本文只记录这个方向，不落地。

---

## 6. As-is vs. 未来展望（分级，继承既有正本的分级惯例）

按 `harness-semantic-compression-and-meta-driver-builder.md` §13 已经建立的四级惯例（不新造分级）：

- **证据充分（已验证事实）**：Builder=Subject=Validator 的身份重合在 GOAL-030~035 六次真实样本里逐条成立
  （第 1、4 节）；CloudCLI 是跨项目 Builder 的真实、独立可核验样本（第 1、5 节）；"语义判断需要独立对抗性
  复核"这条原则今天在两份现场文档里真实发生并纠正了具体错误（第 2、3 节）；ArchGuard 结构事实的可复现性
  （第 3 节，两组独立审计互相印证）。
- **机制成立，待验（设计工作假设）**：第 2 节的五步闭环作为一个**持续重复发生**的机制——目前每一步都有
  真实样本，但还没有观测到"同一个闭环自动跑完整整一圈并触发下一圈"；第 5 节六项新指标——概念上可定义，
  无实现、无跨时间测量。
- **工作假设，非定理**：第 1 节"长期能力目标"的表述本身是一个目标陈述，不是已经达成的状态。
- **观察项（研究方向）**：第 5 节"正负样本存档"的持续化机制；"给定一个新项目自动发现所需 driver 组合"
  （既有正本已点名零实现，本文不重复声明已解决，只是把它摆进了"跨项目迁移"这项指标下面，位置更清楚）。

## 7. 一句话压缩版

**Quay 同时是建造软件的机制（Builder）、被建造的对象（Subject，常常是它自己）与判断建造结果是否可接受的
机制（Validator）；它的长期能力不是"又完成了一个功能"，而是能不能持续把"观察结构事实→做语义架构判断→
开可证伪的实验→落地→用下一轮观察检验这次改动的真实效果"这个闭环，既用在自己身上，也用在别的项目身上——
GOAL-030~035 是这个闭环目前仅有的六次真实、可核验的完整样本，CloudCLI 是它跨项目生效的真实样本，而今天
产出的两份架构审查文档，是这个闭环走到"语义判断需要独立复核"这一步、且被两轮对抗性反证真实纠正过错误的
现场记录——不是宣称，是已经发生的事。**
