# Harness 作为语义压缩：从维度发现到 Meta-Driver Builder

**Status:** live reference / design hypothesis — 不是已证明的科学定理，是 Quay 当前的工程工作假设。
**承接（本文不发明新框架，只是既有框架在一个新场景上的应用）：**
- 理论源头 → `docs/references/基于几何信息论的未来软件开发与信息系统建设(两阶段周期版).md`（GIT 框架：`L(X)=L(G)+L(R|G)`、可行流形 `M_T`、Fisher 度量/自然梯度、本征维度 `d`、五项损失 `L_T/L_C/L_D/L_G/L_S`、扩张⇄收敛两阶段）。
- 该理论的严苛审计 → `docs/references/geometry-as-llm-architecture-interface.md`（manda 项目实证；判定：目标闭包与迁移两层「证据充分」，连续动力学层——Fisher 度量/本征维度/压缩率——「假统一」，不得援引其公式）。
- 该理论在本项目的经验验证 + 第一个前瞻设计 → `docs/references/维度边界与结晶——从熔融实现中发现原则.md`（九次真实结晶案例；§9「形变提出器」是本文第 7、8 节的直接前身——那里已经提出过一版「部分机械化人类形变供给」的构造协议，标注为「前瞻，不是承诺」）。
- Ownership-first 重构方法论（worked example，本文不重复其细节） → `docs/references/ownership-first-refactoring-methodology.md`。
- 硬规则/ADR 母体 → `CLAUDE.md`「GIT review checklist」、`adr/ADR-004~009`、`adr/ADR-021`、`adr/ADR-025~032`（轴框架）、`adr/ADR-033`（schema-agent）、`adr/ADR-035~036`。

**本文新增的唯一东西**：把上述已验证/已审计的框架，具体应用到 Quay 当前「meta-driver / meta-driver builder」这一真实工作上——这是一个尚未被上述任何文档覆盖的场景（见第 6 节的真实现状核实）。

**Non-goals：** 不重新论证 GIT 框架本身（已被审计）；不重复 维度边界与结晶 的九个历史案例；不重复 ownership-first 文档的 GOAL-030/031/032 细节；不是营销宣言——分级结论见第 13 节。

---

## 0. Quay 的母命题：分解带来复杂、harness 带来可靠、固化带来更高层智能

**原始信念（中文陈述）**：复杂能力来自可控分解；可靠能力来自局部 harness；更高层智能来自把已经可靠的局部能力当作新的 primitive。

**更完整的表述**：通过递归分解复杂任务，并把其中稳定下来的小任务固化为受 harness 保障的能力原语，系统逐层扩展自己能够可靠处理的问题层级与领域范围——这不是比喻，是对下文第 2-9 节（概念表、演化闭环、ownership-first 实例、meta-driver builder 设计）共同服务的那一条更上位的命题的显式陈述。

**English compressed version**：
> Scale intelligence by recursively decomposing open-ended work into semantically coherent slices, and turning each stabilized slice into a harnessed capability that becomes a primitive for the next level.

### 0.1 两条必要条件

这条命题要成立，缺一不可：

1. **子任务必须落入 harness 能覆盖的局部领域**——有相对明确的输入/输出/约束/验收标准/失败模式，而不是一个仍然开放式的问题。本仓库已经在运作的具体操作化：`SHAPE_REGISTRY`（`adr/ADR-023`）要求每个任务按其 shape 携带四件可核验的产物；GOAL-030~033 统一使用的三态退出码（`0` 达成 / `1` 未达成且带 `CAUSE=` / `3` 未评估）就是"验收标准 + 失败模式"必须显式声明这条要求的具体实例，不是额外发明。
2. **分解本身也必须逐步被 harness 化**——否则真正最难的那部分智能（"这个问题该怎么切"）永远留在人脑里，系统只学会了"执行已经切好的任务"，没有学会"切任务"。这正是第 7 节 meta-driver builder 设计（当前**零实现**，见第 6 节）试图覆盖、但本仓库目前完全没有做到的那一层——builder 的 A 类工作（识别"现状=已知分解模式的实例"）本质上就是尝试把第二条必要条件机械化。

### 0.2 不是无限拆细：最小充分颗粒度

这条命题常见的误读是"分解得越细越好"。实际判据是**最小充分颗粒度**：切片要足够小，小到可以被机械验证（独立的验收标准、独立的 before/after 读数、独立的负对照）；但也要足够大，大到仍然携带一个有意义的语义完整主张，不会碎成一句话说不清"为什么这一步值得做"的原子编辑。

**GOAL-033（`core-root⇄core-cli` 依赖环切片，`achieved`，已并入 `develop`，合并提交 `ddb9c6ac0`）是这条判据的真实、已完成的例子**：ArchGuard 报出的 package 环有 6 个成员（`"", cli, fan-in, gate, gate/config, gate/factories`）。GOAL-033 显式声明范围是"**只拆 core-root⇄core-cli 这一对，不碰 `gate/`、`fan-in/`、`kernel/` 之间的其它互指**"（非目标明确排除，"不为了让 package 环数归零而顺手处理任何别的边"），因为处理整个环会立刻牵出 `gate`/`fan-in` 的其它职责问题，超出"这一次能独立验收"的范围。**最终实测结果是 SCC 6 → 4，不是立项时预期的 6 → 5**——`cli` 离开 SCC 的同时，`fan-in` 也跟着离开了，因为 `fan-in` 在这个环里唯一的入边恰好就是经 `cli`（`cli/driver.ts:37` 是 `packages/quay/src` 内对 `fan-in/` 的唯一 importer），这条入边本身没被这次改动动过，但它依附的宿主（`cli`）离环之后它就跟着脱离了。**GOAL-033 自己的 `origin` 字段原样记录了这次修正**（"2026-10-09 goal 作者更正 SCC 期望 6→5 为 6→4……由 GOAL-033 ② 的实测读数揭示"）——这正是 `ownership-first-refactoring-methodology.md` §8"一次红不是告诉你撤销，是告诉你去看"同一条纪律的另一个实例：初始边界估计（6→5）被执行中的实测证伪，goal 记录了修正过程而不是悄悄改数字。同时它也没有切得更碎：移动的两个符号（driver 控制客户端、driver 词表）被作为一个整体切片处理，因为"cli（与随之脱环的 fan-in）完整退出 SCC"是一个二元、可核验的主张（ArchGuard 环成员计数 6→4，负对照是在 scratch 副本里重新注入一条边验证 `cli` 会不会回到 SCC），而"只挪一半、留一半在环里"不构成任何可独立验收的语义主张。**这是"小到可机械验证、大到保留语义完整性"两个方向的边界同时被显式画出来的真实样本，且边界本身在执行中被测量修正过一次——这不弱化这条判据，反而是它的另一重证据：颗粒度的边界往往要等切开了才能完全看清。**

### 0.3 与 Search Space / Manifold / Residual Uncertainty / Mechanization 的关联

第 2 节已经把 Manifold 定义为"语义空间里已点亮的轴构成的坐标系"的比喻。这条母命题把 task decomposition 放进同一比喻里：

- **decomposition = 寻找一个局部坐标系（local chart）**——把一个开放式问题切成一个足够小的区域，使得一个廉价的局部 harness 就能覆盖它。`docs/proposals/quay-perpetual-stream-experiment-v5.md` 已经用过这个确切的说法（非本文发明）："Value Trajectory 活在 manifold/atlas 上：相邻 milestone 共享一个 local chart"。
- **harness = 在这个 chart 内把局部有效路径压缩并稳定下来**——即第 2 节定义的 `Mechanization`/`Π_{S→E}`，没有新内容，只是换了个主语。
- **稳定下来的能力 = 喂给上一层分解的新 primitive**——对应 `基于几何信息论...md` §5.2 的"支柱化"：被压缩发现的高复用抽象（`G` 的新分量）固化为系统的结构性支柱。残差（`Residual Uncertainty`）是那些还没被任何 chart 覆盖、仍需要下一轮分解才能处理的部分。

### 0.4 Quay 的演化层级

把母命题摆成一个具体的层级，标注每一层当前是「真实运作」还是「设计假设」（详见第 6、7 节）：

| 层级 | 当前状态 | 对应机制 |
|---|---|---|
| Task execution（单个任务 ready→done） | **真实运作** | GOAL-030~033 的每一个 slice task |
| Goal/investigation decomposition（一个 Goal 拆成少量串行 task） | **真实运作** | GOAL-030~033 本身（branch:true Goal 的标准流程） |
| Meta-driver proposal（对某个长期语义维度持续判断、产出结构化 proposal） | **真实但单一窄域，且当前故障**（见第 6 节） | 现有 `meta-driver.ts` |
| Meta-driver builder（对"如何正确切分一个新问题"这个模式本身建模/回放/固化） | **纯设计假设，零实现** | 第 7、8 节 |

**越往下越接近"分解本身被 harness 化"（0.1 的第二条必要条件），当前进度也越稀薄**——这张表本身就是对"这条母命题离兑现还有多远"的一次诚实度量，不是进度宣传。

## 1. 诚实条款（继承，不重新论证）

`geometry-as-llm-architecture-interface.md` §4/§5/§8 已经把判断做完：**连续动力学层**（Fisher 信息度量、自然梯度 `I⁻¹∇L`、本征维度 `d`、压缩率 `ρ` 的数值计算）在本项目「没有算过、也基本算不了」，援引其公式是 **abuse of notation**。`adr/ADR-006` 独立得出同一结论并把它写成 accepted 决策。`维度边界与结晶` §6.3 的诚实条款进一步把「语义空间」这套读法限定在三处真正付过钱的地方：**(a) 目标闭包**（哪些维度存在、暗维度可被探测）、**(b) 迁移**（同一原则跨载体低损复用）、**(c) 共享控制-验证协议**（类型化指令低损传给执行）。

**本文继承这条边界，不重新论证它。** 下文出现的「语义空间 / 流形 / 维度 / 压缩」全部在上述三处含义下使用——**是比喻与工作假设，不是被计算出来的几何量**。任何地方如果读起来像在断言"我们量出了本征维度是 N"或"压缩率是 ρ"，那是表达失误，应按本节订正。

## 2. 核心概念正式化

下表把用户/讨论中出现的英文概念，映射到本项目既有、且已被验证/审计过的中文/英文表达——**刻意不发明新词**，只给已存在的概念一个统一的英文锚点，便于跨文档引用。

| 英文概念 | 本项目既有对应 | 定义 / 出处 |
|---|---|---|
| **Search Space** | 语义空间 `S` / 程序空间 `P` | 所有能执行信息处理的系统描述构成的空间——自然语言 prompt、workflow、DSL、代码，乃至操作手册，都是其中的点（`基于几何信息论...md` §2.1）。 |
| **Manifold** | 可行流形 `M_T` / 语义空间里「已点亮的轴构成的坐标系」 | **比喻，非计算量**（见第 1 节）。可操作化为：`维度边界与结晶` §6.1 的读法——设计是点，原则/边界是轴（坐标），演化是轨迹；`M_T` = 满足当前测试集 `T` 的系统集合。 |
| **Constraint (Harness)** | 硬形变 / `Π_{S→E}`（region → executable check）/ 可行域截断 | `geometry-as-llm...md` §8.3：硬形变不动模型自身的条件分布 `U`，而是直接截断状态空间——离开可行域的轨迹判负，因此不被先验的density-prior 长程侵蚀。`exp5-driver-deliverability-packaging.md` 给出本项目自己的操作定义："harness = driver prompt + mutable state files + mechanized check scripts + 单一 subagent 依赖"。 |
| **Residual Uncertainty** | 残差 `R\|G` / 暗轴（dark axis） | `维度边界与结晶` §6.1："残差是那些还没被任何已发现原则覆盖的设计决策"；`adr/ADR-025~032` 把暗轴做成一等记录（`proposed + tag:axis` → `accepted`），本质是给残差编目录。 |
| **Mechanization** | 结晶 / 硬形变 / Π_{S→E} 投影 | 把连续意图投影成会在漂移时失败的可执行检查（第 5 节「元规则 1」：减法+可执行，不是加散文）。 |
| **Replay** | replay dataset / replay harness | 已有真实 precedent：`experiments/offline-replay/`（155 样本语料 + `harness.py`，用于预先校准 SPC 式控制限——"预先声明好'健康'的定义，不是事后定义"，见 `quay-perpetual-stream-experiment-v5.md`）。本文第 8 节把这个既有模式搬到 driver 候选的验证上，不是发明新机制。 |
| **Meta-driver Builder** | 形变提出器（deformation proposer）的下一步实例化 | `维度边界与结晶` §9 已经提出一版「部分机械化人类形变供给」的构造，标注「前瞻、不是承诺」。本文第 7、8 节是这个前瞻设计在「驱动组合（driver portfolio）」这一具体场景下的延伸，详见下文。 |

## 3. 演化闭环：六步结晶管线的重新标注

用户讨论里给出的循环——**explore → discover manifold → encode bias → mechanize stable dimensions → expose residual uncertainty → explore again**——不是新循环，是 `维度边界与结晶` §0 既有六步管线的重新命名：

```
熔融实现跑起来 → 沿某个维度失效（或静默失效） → 外部压力/测量让维度显形
→ 沿该轴量出真实距离 → 画出正确边界 → 抽象成原则 → 立即受反例检验
→ 投影成可执行检查（Π_{S→E}）→ 结晶为单源
```

对应关系：

| 用户讨论的步骤 | 本项目既有步骤 | 正本 |
|---|---|---|
| explore | 熔融实现跑起来 | §0 |
| discover manifold | 失效/静默失效 → 测量让维度显形（§2 三触发器：外部压力、静默失败、测量） | §2.1-2.2 |
| encode bias | 抽象成原则 + **形变方向由人供给**（§3 两体结构：Claude 测量验证、人指定沿已点亮轴的形变方向） | §3-4 |
| mechanize stable dimensions | 投影成可执行检查 `Π_{S→E}`，结晶为单源 | §5 |
| expose residual uncertainty | 残差编目（轴框架，`ADR-025~032`） | §6.1 |
| explore again | 两阶段呼吸：收敛完成后`∂L_D/∂t→0`且需求队列非空 ⇒ 切回扩张（`adr/ADR-008`，`proposed`，未接线） | `基于几何信息论...md` §5.4 |

**此处必须带一条继承来的限定**：`维度边界与结晶` §3 的核心发现是——**测量决定"该往哪测"，但不决定"下一步往哪变"**。encode bias 这一步的"方向"，在本项目迄今的九次真实案例里，绝大多数由人（或其他 OOD 源）供给，不是自动从测量里长出来的。任何把这个闭环描述成"全自动"的叙述，都与本项目自己的实证记录矛盾。

## 4. Ownership-first 重构作为 manifold compression 的一个实例

`docs/references/ownership-first-refactoring-methodology.md`（GOAL-030/031/032）是上述闭环在「代码所有权」这个具体维度上的三次真实实例，不重复其细节，只标注对应关系：

- **discover manifold**：ArchGuard `detect_duplicates`/`get_dependencies` 把"状态/决策/副作用散落在多处"这件事变成可测量的事实（重复组、反向边、edge strength）——这正是"失效/静默失效 → 测量让维度显形"。
- **encode bias**：人裁定"这一对函数该不该合并"（GOAL-032 的等价性调查结论），对应"形变方向由人/OOD 源供给"。
- **mechanize stable dimensions**：收敛到 kernel 单一实现 + 薄包装，是 `Π_{S→E}` 的具体实例——状态/决策/副作用被截断进一个单一可执行入口。
- **expose residual uncertainty**：每个 Goal 的「非目标」清单（如 GOAL-032 明确不碰的 27 文件分散字面量）就是显式保留的残差，没有被这次收敛覆盖。
- Branch self-host 身份证明、负对照、post-merge 读数——这些都是"硬形变必须长在写入路径上"（`维度边界与结晶` §10.2 对 ADR-004 的限定）的具体应用：不是写一条巡检规则，而是让检查本身就在合并/生产读数的写入路径上。

## 5. 元规则（继承，第 7 节设计以此为前提）

`维度边界与结晶` §7 的四条元规则直接适用于本文第 7、8 节的设计，不重写：

1. 减法 + 可执行，绝不加法散文。
2. 找维度靠三问：错的时候谁先知道（频率×静默）；那个"先知道"的机制与对象共享死因吗；我们是不是把两个不可区分的点当成了同一个点（投影塌缩）。
3. 结晶完成的标准是**动作的实际执行形态**，不是文档/脚本的存在。
4. 测量点亮轴，**形变方向需要外部供给**——不要指望自主循环自动产生正确方案。

## 6. Meta-driver 当前真实状态（核实于 2026-10-09，不是设计叙述）

在设计「meta-driver builder」之前，先核实"meta-driver"现在到底是什么——这是避免把一个单一、窄域的现有机制，误当成本文要设计的东西。

- **真实存在、生产运行**：`plugin/scripts/meta-driver.ts` + `plugin/probes/meta-driver.md`。按 `adr/ADR-033`（schema-agent）的机械/语义分工：脚本做算术/gating，一个独立的 `claude -p` 探针做语义判断（divergence 解读、新 AC 提案、autoDrive 机制识别、决策路由、META 消息分流）。它是**单一领域**（goal-criterion divergence）的驱动，不是驱动组合，不是 builder。
- **⚠️ 现场核实到的真实缺陷（作为本文§1「静默失败/压扁原理」的活体例证，不是假设）**：`.quay/meta-driver-round.jsonl` 显示语义半边自 **2026-09-14** 起持续失败（`"routine threw: snapshotTrackedChanges is not defined"`），截至 2026-10-09 已 **1,738 条失败记录、0 条验证通过**，而机械心跳整段时间照常跳动，看起来"一切正常"。这正是 `维度边界与结晶` §2.2 描述的"静默失败与一切正常同形"——不是比喻，是同一个机制自己踩中了自己描述的陷阱。**该文件不入版本库，此读数是现场检查的快照，会随时间推进；本文不据此创建修复任务（用户本轮指令范围排除）。**
- `orchestration/meta-driver-focus.md`（人工方向的转向通道）机械上每轮都读，但内容"暂无具体人工方向"从未被真正使用过——`维度边界与结晶` §4.4 "结晶到脚本 ≠ 结晶到习惯"的又一独立实例。
- `orchestration/SPEC-capability-planes-and-mechanism-lifecycle-2026-09-05.md` §12.2/§12.3 已经写过一版"driver-candidate 提名管线"（discover → 提议 `label:driver-candidate` 任务 → 人裁定 → 实现），该 SPEC 自己承认"是 prose 指令，没有机械闸验证它真的被执行过"——**设计已存在，零实现**，与本文第 7、8 节重叠，第 7、8 节应视为对它的具体化，不是平行发明。
- `docs/proposals/local-multi-project-coevolution-pilot.md` + `docs/proposals/quay-control-plane-host-adapters-human-control-surface.md`：跨项目（quay/meta-cc/archguard）协同的联邦式设计，Stage 0/4，**文档顶部明确声明"仅为架构讨论，不授权任何全局 loop/daemon/Host Adapter/任务联邦"**，且这条边界有一个活的机械守卫（`plugin/scripts/codex-stage1-selfcheck.sh:59-63`）防止它被提前接线。
- "driver 组合（portfolio）""元驱动构建器/孵化器""shadow mode""driver 的 offline replay"——这几个概念在 `tasks/`、`goals/`、`orchestration/` 里**零命中**（两次独立检索确认：本次调研的子代理 + 另一个并行会话的独立调研）。**这是真正的空白，不是被忽视的既有机制。**

## 7. Meta-driver Builder 设计含义

基于第 6 节的真实现状，以下是把第 2-5 节的框架应用到"驱动组合"这一具体场景的设计含义——**全部是设计假设，标注依据哪一条既有原则，不是已落地的机制**。

### 7.1 多 meta-driver = 对不同长期语义维度的分解

单一 `meta-driver.ts` 目前只拥有一个维度（goal-criterion divergence）。设计含义：**每个 meta-driver 对应一个长期存在、需要持续判断的语义维度**（例如：任务粒度是否恰当、重复实现是否出现、文档与代码是否漂移），**输出结构化 proposal，不直接执行**——执行权仍归确定性的 lifecycle/gate 层（呼应 `adr/ADR-033`："值从哪来决定形式；值一旦到手，算术/路由必须是确定性 JS"）。这不是发明新架构，是把 `adr/ADR-033` 已经确立的"语义判断用 schema-agent，拿到值之后用确定性代码"原则，从单个值的粒度，升格到单个 driver 的粒度。

### 7.2 Arbitration/policy 层负责确定性的冲突、去重、预算与准入

多个 meta-driver 的 proposal 之间可能冲突、重复、争抢预算——这一层**必须是确定性代码，不能是又一层语义判断**（否则产生"meta 的 meta"，违反 `adr/ADR-021` 的"元机制必须比它治理的机制至少简单一个量级"原则）。现有的 `routineQuotaDecision` 式仲裁（本仓库已有的"例行任务配额决策"机制）是这一层的既有雏形，不是新发明。

### 7.3 Builder/incubator 负责发现、孵化、验证、合并与退役

这正是 `维度边界与结晶` §9「形变提出器」的 A/B/C/D 四类工作在 driver 粒度上的实例化：

| §9 原分类 | 在 driver 粒度上的含义 |
|---|---|
| A 识别（现状 = 已知原则的实例） | 发现"某类判断反复出现、且目前靠人或散文巡检完成" |
| B 生成反众数方向的候选 | 给定一个反复出现的语义维度，生成候选 driver 契约（scope/输入/预算/归属） |
| C 作用域/减法裁定 | 任何新 driver 候选，先检查能否归并进已有 driver，不能归并才新建（`adr/ADR-021` 的"拒绝新增而非归并既有机制"原则） |
| D 纠偏过度推广 | 推翻一个已孵化 driver 的唯一通道是新的证伪数据，不是嫌它"看起来不够用" |

### 7.4 Driver 自身的可追责性：replay、success metric、retire/merge criteria

每个 driver（含 meta-driver 本身）在孵化时必须附带（这是设计要求，当前实现**不满足**，见第 6 节）：
- 一个 replay 数据集或至少一组历史样本，可在不碰生产数据的前提下重放其判断（参照 `experiments/offline-replay/harness.py` 的既有模式）；
- 一个可观测的 success metric（见第 10 节的候选清单，未定稿）；
- 明确的 retire/merge 判据——**这是本仓库目前最弱的一环**：`docs/analysis/crystallization-the-contraction-phase-has-no-mechanism.md` 已经量化过"收缩相从未被机制触发过，全部由人发起"；`docs/proposals/archguard-generation-era-primitives.md` §2.7 和 `docs/proposals/exp6-queue-driven-concurrent-executor.md` 都独立确认"方法学层只有创建侧的度量和闸门，删除/退役侧几乎零工具化"。**任何 meta-driver builder 设计如果不正面解决这个已知缺口，就只是在复制一个已经被诊断过两次、从未修复的问题。**

### 7.5 跨项目 bootstrap 是验证"压缩是否可迁移"的关键

`docs/proposals/quay-harness-crystallization-roadmap.md`（superseded by `adr/ADR-022`，但框架仍可借用）已经提出"不变量内核（跨项目通用：收敛判据、反馈环形状、schema、哈希身份）vs 校准后的策略配置（项目特定：分层边界、时间预算、路由系数）"的切分，并提议验证内核能否迁移到第二个项目（archguard）而只重新校准配置。`docs/proposals/baime-lite-driving-external-projects.md` 和 `docs/proposals/fast-mode-cross-project-portability.md` 做过同类迁移测试，但都是测试**一个固定机制**的迁移，不是"builder 发现一个新项目需要什么样的 driver 组合"。**后者才是本文 §2 "Meta-driver Builder" 概念真正新增的部分**——到目前为止，本仓库没有任何实现或提案做到"给定一个新项目，发现它需要哪些 driver，而不是把 quay 自己的 driver 原样搬过去"。跨项目 bootstrap 因此是检验"压缩是否真的可迁移，而不是只对 quay 自己的历史过拟合"的关键实验，而不是已完成的能力。

## 8. Bootstrap 流程：discover → propose → replay → shadow → limited-proposal → gated activation

```
discover recurring concern
  → propose driver contract (scope / inputs / budget / attribution / replay dataset / retire criteria)
  → offline replay（对历史样本重放判断，不碰生产）
  → shadow mode（接生产输入，只记录不产出）
  → limited proposal mode（产出 proposal，但不授权执行）
  → gated activation（人或确定性闸门批准后才获得执行权）
```

这个六步管线不是新发明——它是 `维度边界与结晶` §9.3 构造协议（`RECOGNIZE → ANTI-MODE → FALSIFY → NO-SUPERSEDE → ESCALATE`）与 `SPEC-capability-planes...md` §12.2 "discover → propose → human rule → implement" 两个既有提案的合并与细化，补上了两者都缺的中间两步（offline replay、shadow mode）——这两步直接借用 `experiments/offline-replay/harness.py` 已经验证过的"预先声明健康基线，再拿真实数据对照"模式。**六步中每一步都必须附带"什么样的读数会让它停在这一步、不晋升到下一步"（呼应 §9.3 的 `FALSIFY` 步骤与硬规则 12"没有发生率读数不得设前置"）**——这是设计要求，当前没有任何 driver 走过这六步中的任何一步（第 6 节已核实：零实现）。

## 9. 跨项目能力：通用框架 + project-local driver packs

`docs/proposals/exp5-driver-deliverability-packaging.md` 已经给出可直接复用的三层切分（这是本仓库自己对"harness"的操作定义，不是本文新造）：

- **Layer A（通用引擎，可移植）**：driver prompt 模板、机械检查脚本的抽象形状、subagent 调用协议——这是 **generic framework**。
- **Layer B（每实例配置）**：某个具体项目的阈值、路径、命名约定——这是 **project-local driver pack**。
- **Layer C（运行时状态，从不随包交付）**：`.quay/` 下的事件/状态文件。

设计含义：meta-driver builder 的产出物应该落在 Layer B，不是改写 Layer A——**builder 发现的是"这个项目需要哪些 driver、每个 driver 的本地参数"，不是为每个项目重写一套 driver 引擎**。这与第 7.5 节"不要把 quay 自己的 driver 原样搬过去"是同一条原则的两种措辞。

## 10. 评价指标（研究性信号，不是既定 KPI）

以下指标均为**候选**、**未实现**、**未测量**——按用户指令，明确不作为既定验收标准，列出是为了让后续实验有一组具体可核对的候选量，而不是空谈"效果好":

- proposal acceptance rate（driver 产出的 proposal 被人/确定性闸门采纳的比例）
- 后续 goal/task 成功率（被该 driver 影响的任务，落地后是否真的达成了预期）
- 重复率（同一 driver 反复产出同一条 proposal、或多个 driver 产出重叠 proposal 的频率）
- 干预后指标改善（driver 介入前后，它所监控维度的度量是否真的变好，而不只是"报告变少了"——后者可能只是第 6 节"静默失败"的另一种形态）
- 误报成本（false positive 的处理代价，尤其是消耗人工裁定时间的那部分）
- portfolio 覆盖/重叠（多少语义维度被至少一个 driver 覆盖；多少被两个以上 driver 同时覆盖，这可能是归并信号也可能是健康冗余）
- 能否重现近期人工推动 GOAL-030/031/032 的决策链（见第 4 节）——这是目前**唯一有真实历史数据可供对照**的候选评价方式：如果一套 builder 机制在只给它这三个 Goal 之前的信息的情况下，能独立产出与人类实际做出的决策方向一致的候选，这是比任何单一数值指标更有说服力的样本外验证（呼应 `geometry-as-llm...md` §0 的三条价值判据之一："压缩/迁移"）。

**关于 semantic compression ratio / decision entropy**：这两个量**在概念上可以定义**（例如：压缩率 = 被 driver 覆盖后残留的、仍需人工逐案判断的语义维度数 / 总维度数；决策熵 = proposal 被接受前的不确定性度量），**但本仓库目前没有任何实现在计算它们，也没有验证它们与"系统真的变好了"之间的相关性**。`docs/analysis/crystallization-half-life.md` 的发现是一条必须认真对待的反例：该分析对 36 个 ADR 做统计，发现"有可执行强制产物"**没有**可测量地降低同类问题的复发率——即"结晶"本身不自动等于"有效"。在没有类似的实证检验之前，这两个量只能是**研究性信号**，不能写成验收 KPI。

## 11. 关键设计原则

**Harness 存在的目的，是让智能只花在仍有残留不确定性的维度上（把已经验证稳定的维度让位给机械判断）。**

中文表达：**harness 的职责不是替智能多做事，是把已经验证有效的推理固化成约束，腾出智能去处理还没被固化覆盖的那部分。**

这条原则不是本文新造，是对已有多条线索的汇总措辞：
- `adr/ADR-005`（proposed）："验证是绑定约束——稀缺资源是可信的廉价验证，不是生成能力"。
- `基于几何信息论...md` §8.3："人类擅长的：发明 `G` 的新分量……AI 擅长的：在学到的先验分布中采样"。
- `维度边界与结晶` §3.2："问题发现是在当前 G 内运行仪器……方案是对 G 本身的形变方向……稀缺物是 OOD 形变"。
- `geometry-as-llm...md` §6："统一模型最深的价值是人机二元体的共享控制-验证协议……放大的是通道，不是任一端"。

把这条原则应用到 meta-driver builder：builder 的孵化判据不应该是"这个维度看起来值得监控"，而应该是"**这个维度上，稳定判断已经被反复验证、只是还没被机械化**"——对应第 7.3 节 A 类工作（识别已结晶但未固化的模式）。**仍然需要人/OOD 源介入的，是命名一根全新的维度，或者当证伪协议本身无法区分候选时的裁决**（`维度边界与结晶` §9.2 残差）——这部分不应该被 builder 吞掉，吞掉本身就违反了本节的原则。

## 12. 已知结构性缺口（不回避）

- **退役/归并侧几乎零工具化**（第 7.4 节）——两份独立分析（`crystallization-the-contraction-phase-has-no-mechanism.md`、`archguard-generation-era-primitives.md` §2.7）都确认收缩相从未被机制触发。任何 meta-driver builder 设计如果只写孵化、不写退役，就是在复制这个已知未解的缺口。
- **"有产物"不自动等于"有效"**（`crystallization-half-life.md`）——有执行强制物的规则，复发率没有可测量地低于没有的。本文第 10 节的全部候选指标都应该在这条阴影下被看待：先验地相信"接上 builder 就会变好"是没有证据支持的。
- **元机制规模倒挂**（`exp6-queue-driven-concurrent-executor.md` 引用的实测：方法学层体量是产品层的 3.7 倍，与 `adr/ADR-021` 的"元机制应比被治理对象小一个量级"要求方向相反）——任何新的 builder/incubator 代码，必须先问自己是不是又在加重这个倒挂，而不是默认"再加一层协调就会更好"。
- **当前唯一真实存在的 meta-driver 本身正处于第 6 节描述的静默失败状态**（1,738 条失败、0 条验证通过，持续近一个月）——在讨论"如何孵化更多 meta-driver"之前，这个事实本身就是对"现有一个 driver 都没能做到可观测自愈"的提醒。

## 13. 分级结论

按本仓库既有的证据分级惯例（`维度边界与结晶` §8、`geometry-as-llm...md` §5/§7）：

- **证据充分（已验证事实）**：GIT 框架的目标闭包层与迁移层（第 1、2 节）；ownership-first 重构的三次真实实例是硬形变/`Π_{S→E}` 的具体落地（第 4 节）；现有单一 meta-driver 的真实窄域范围与其当前的静默失败状态（第 6 节，现场核实）；退役/归役侧零工具化（第 12 节，两份独立分析交叉确认）；**GOAL-030~033 是四次真实、可核验、均已 achieved 并并入 `develop` 的任务分解实例，GOAL-033 最终实测 SCC 6→4（非立项时预期的 6→5，`fan-in` 随 `cli` 一并脱环）是"最小充分颗粒度"判据的真实样本，不是假设的例子**（第 0.2 节）。
- **机制成立，待验（设计工作假设）**：第 7、8、9 节的 meta-driver builder 设计——结构上可以从既有的 §9 形变提出器 + `SPEC-capability-planes` §12.2 + `experiments/offline-replay` 三个既有构件拼出来，但**没有任何一步被实际跑过**；跨项目 bootstrap 能否真的发现（而非搬运）driver 组合，同属此档；**母命题本身"decomposition = 找 local chart，harness = chart 内压缩，稳定能力 = 喂给上一层的新 primitive"这套映射（第 0.3 节）是一个解释性框架，不是被测量验证过的机制**。
- **工作假设，非定理**：「智能=信息压缩/流形搜索」整体表述（第 0、1、2、11 节）——继承自已被本项目自己审计过"假统一"的连续几何层，本文只在审计许可的三处含义下使用它。
- **观察项（研究方向）**：第 10 节全部评价指标，含 semantic compression ratio / decision entropy——概念可定义，无实现、无验证，`crystallization-half-life.md` 是现成的反例警示，不作阻塞判据，也不作验收 KPI；**第 0.4 节"演化层级"表中的第四层（meta-driver builder 对分解本身建模/回放/固化）是全文最具推测性的一层，零实现，是后续实验的方向，不是现状描述**。

## 14. 一句话压缩版

**Harness 不是让智能做更多事，是把已经验证稳定的语义判断投影成可执行约束（硬形变 `Π_{S→E}`），腾出智能去处理尚未被约束覆盖的残差维度；meta-driver builder 如果要存在，它的工作不是发明新的流形几何，是把"识别已结晶但未固化的模式→生成反众数候选→可证伪地验证→机械裁定能否归并→人裁定真正全新的维度"这条已经在本项目验证过的管线，搬到"驱动组合"这个粒度上跑——而退役/归并和"有产物就有效"这两个已知缺口，必须先被正面承认，再谈孵化更多东西。**
