# Ownership-First 重构方法论 — 从 GOAL-030 首个真实试点提炼

**Status:** live reference — 供后续 `branch:true` Goal 重构复用，不是一次性复盘。
**Worked example:** GOAL-030（`goals/GOAL-030-晋升写入经-kernel-转移决策并留痕-...md`，AC-336..342，分支 `goal/GOAL-030`）。
**现状口径（2026-10-08）：** GOAL-030 在 `goal/GOAL-030` 分支上已经把 AC-336/337/338/339/340 跑到 `done`；并入 `develop` 的 fan-in 已尝试两次、均在全量 suite 步骤判红（判定为与合并内容无关的既有 flake，非合并冲突），**截至本文撰写尚未落地**，AC-341（post-merge 生产读数）与 AC-342（merge 形态）仍是 `active`/not-evaluated。本文引用的 `packages/quay/src/kernel/task-transition.ts`、`docs/rup/goal030-archguard-before-after.md` 等文件此刻只存在于 `goal/GOAL-030` 分支，尚不在 `develop`/`author` 上——这是方法论生效中的一个真实样本，不是假设。
**正本指针（不复制，只引用）：**
- `branch:true` Goal 机制细节 → `orchestration/SPEC-goal-branch-2026-10-03.md`
- GIT lens / hard-over-soft 的理论依据 → `adr/ADR-004-...md`、`adr/ADR-005-...md`、`adr/ADR-006-...md`、`adr/ADR-007-...md`
- 架构评审三层流程本体 → archguard 插件 `arch-layer-review` skill（`SKILL.md` + `references/goal-030-example-output.json`）
- `L_T/L_C/L_D/L_G/L_S` 词汇表 → `docs/references/` 下的 GIT 框架文档（见 CLAUDE.md「GIT review checklist」）

**Non-goals：** 不是 OO/设计模式教程；不是 GOAL-030 复盘报告（GOAL-030 只作可核验锚点）；不重复 `SPEC-goal-branch` 的机制细节或 archguard skill 的操作步骤——那些有各自的正本。

---

## 1. Ownership-first：先问"谁该拥有"，不先找 class

遇到一段行为分散、多处直写的代码，第一步不是"这段逻辑该放进哪个 class"，而是把它拆成四个独立的问题分别找拥有者：

- **状态**（这个决策依赖的规则表/边表本身，谁是唯一定义处？）
- **决策**（给定输入，判定走哪条路，这个判断函数归谁？）
- **副作用**（真正落盘/落事件的那一行写操作，归谁？）
- **编排**（谁在什么时机调用上面三者，这件事可以继续留在原处）

GOAL-030 的起点问题不是"任务转移该是哪个对象"，而是"任务转移决策该归谁拥有"——答案拆成四块都在 `packages/quay/src/kernel/task-transition.ts`（`goal/GOAL-030` 分支）：`LIFECYCLE_EDGES`（状态/规则表，从 `gate/lifecycle.ts` 收敛而来，原处降级为 re-export）、`decideTransition`（决策，三态 `allow/refuse/not-evaluated`，从不把"没判出来"塞进"拒绝"）、`patchStatusField` + `appendTaskStatusEvent`（副作用，从 `plugin/scripts/task-ops.ts` 收敛而来）。**编排**（何时调用、调用顺序）明确留在 `ready-pool-check.ts` 的 `applyPromotions`/`applyRevaluations` 里——不是每一块都要塞进同一个"对象"，四块可以、也应该落在不同模块。

四个问题分别回答完，剩下的才是"这个形状看起来像什么模式"（见第 3 节）——顺序不能反。

## 2. Canonical source ≠ 调用方真正收敛：避免搬壳

"建了一个新的权威实现"和"调用方真的收敛到那个权威实现"是两件独立的事，中间的陷阱是**搬壳（shell move）**：新模块存在、名字也对，但旧实现只是被套了个壳，或者调用方表面换了导入路径、骨子里还在走老的写法。真正收敛要同时满足三条（对齐 archguard `arch-layer-review` 的三个陷阱）：

1. **单一定义处**：状态/决策表在全仓库只有一个 `export` 来源，别处最多是 re-export，不能有"第三套实现"悄悄并存（GOAL-030 AC-336：`LIFECYCLE_EDGES`/`patchStatusField` 各恰好一个 `export` 站点，且站点在 kernel）。
2. **调用方真的改口**：把旧的直写路径数清楚、钉成具体数字，验收时确认这个数字归零（AC-336：`ready-pool-check.ts` 对 `patchStatusField(` 的直接调用从有到 0，转为 import kernel）。
3. **新实现不反向依赖旧实现的写原语**（搬壳不搬心）：如果新模块的 body 里还在 `import` 回旧的写函数，说明"心"没搬，只是换了个门面。

自检问法：**改一条调用点，是否还需要同时跑去两个地方改规则表？** 如果是，说明还没真正收敛，只是又多了一层转发。

## 3. OOA/OOD 与设计模式：边界已明确才用，不建 pattern zoo

State / Strategy / Command / Specification / Repository / Application Service / Domain Service / Domain Event 这些名字描述的是**责任边界已经清楚之后**长出来的形状，不是动手前要往代码里"安装"的蓝图：

- `LIFECYCLE_EDGES` + `decideTransition` 事后看像一张 State 表 + Strategy 判定——但起点不是"我们来套用 State 模式"，是第 1 节四问里"决策归谁"先有了答案，形状自然收敛成这样。
- 只有一个调用点、看不到第二个实现在望的时候，不要先搭 Repository 抽象层、不要先建 Domain Event 总线、不要先引入 Specification 对象——这是 CLAUDE.md 已有原则（"不要为假设的未来需求设计"）在重构场景下的具体化：三行相似代码好于一个过早的抽象。
- 判据：先完成第 1 节的四问拆分，**只有当某个边界已经出现第二个真实实例（第二个 provider、第二条调用链、第二种策略）** 时，才把这个边界正式升格为一个命名模式；否则它只是一个单一职责的函数/模块，不需要模式名字。

## 4. 小而真实的 refactor slice：一次只切一个可独立验收的问题

每个 slice 必须能**用数字钉死范围**，而不是用一句"顺手也清理一下"模糊掉边界。GOAL-030 的 AC-336 把范围钉成：fan-in（`worker-fan-in.ts`，4 处调用）、needs-human/branch-sync（`driver-filters.ts`，2 处调用）**明确排除**；"ABI vs kernel 的归属决策""`gate/lifecycle.ts` CLI 路径行为改变""目录环清理""driver 机制改动"**明确列为 non-goals**，不是被遗忘，而是被数清楚、点名留给以后的 slice——下一个 slice 不需要重新发现这些边界,直接从这张清单接手。

一次 slice 只解决一个能独立验收的问题；如果验收条件要同时证明两件不相关的事，说明 slice 切得太大，应该拆成两个 Goal 或两个 task。

## 5. `branch:true` Goal 的标准流程

机制细节见 `orchestration/SPEC-goal-branch-2026-10-03.md`；这里只记录 GOAL-030 实际走过的闭环顺序，作为后续复用的检查单：

1. **Fork point**：ArchGuard before-基线，在 goal 分支创建前先对 `develop` 尖端拍一次。
2. **Goal 激活**：`goal/<GOAL-ID>` 从 `develop` 尖端惰性创建；该 Goal 下的任务派发自动把 `mergeTarget` 解到这个分支，worktree 从它 fork。
3. **少量串行 task**：每个 task 对应第 4 节的一个 slice，在 goal 分支上串行落地（彼此 fan-in 到 goal 分支，而非各自散落）。
4. **Branch 自举（self-host）**：见第 6 节——证明分支尖端跑的是分支自己的代码，不是侥幸读到了主检出。
5. **Before/after 对比**：同一套 ArchGuard CLI，对 fork point 和分支尖端（或合并提交两个父提交）各做一次单根 `git archive` 提取后分析，比较结构性指标（见第 10 节）。
6. **人工触发 merge**：`quay goal merge <GOAL-ID> --reason ...` 只记录 `goal-merge-request` GateEvent，不直接执行；机械 fan-in 由 worker-driver 按固定顺序（goal 锁 → develop 锁）做 `git merge --no-ff`，跑 anti-drift/typecheck/scoped-gate/全量 suite，绿则 `ff-only` 推进 `develop`，红则记录 gap、分支保留等下一次重试。
7. **规定 merge shape**：`develop` 的 first-parent 链上恰好一个合并提交，第二父提交是 goal 分支尖端，不允许分支内部的中间提交泄漏到 first-parent 上（AC-342 的判据）。
8. **Post-merge 验证**：合并落地后，针对生产环境的真实读数做核验（见第 6 节 AC-341 的形态），而不是止步于"合并没冲突"。
9. **全部 AC achieved 后关闭**：Goal 的收尾条件是其下全部 AC 进入 `achieved`（含 post-merge 类 AC），不是 merge commit 落地那一刻——GOAL-030 当前正卡在这一步：AC-336..340 已 `done`，AC-341/342 要等 merge 真正落地才能评估，这正是"merge 完成 ≠ Goal 完成"的真实例子。

## 6. Branch self-host 身份证明：driver/serve/entry 的 realpath 必须在 goal 树内

"分支上跑测试通过"不等于"分支上跑的代码就是分支自己的代码"——如果子进程解析模块时意外落回主检出或全局安装的版本，所有绿色都是假的。证明身份用**直接量**，不用自报量：

- 从 `/proc/<pid>/cmdline` 读 entry 脚本的真实路径，而不是信任进程自己汇报的参数（AC-340："真实读到的实体 realpath 在被评估的树内"）。
- 每条事件（如 `.quay/task-status-events.jsonl` 的 promote/retreat 记录）都带 `writerModule`/`entry` 的 realpath，验收时核对这些 realpath 落在 goal 树的 worktree 路径下，不是主检出路径（AC-337）。
- **负对照是这条证明的另一半，不是可选项**：同一个 sandbox，换成**主检出**的 driver 去驱动，必须产出 0 条匹配事件（AC-337 的 `mainHasModule` 字段——这个负控制只在"主检出确实还没有这个模块"时才有效，所以要显式记录前提，而不是假定它永远成立）。
- 同理应用在 preview/serve 上：分支的 preview 实例若注册的是外来代码的 serve，必须报错退出（而不是悄悄通过）；若目标树根本没注册，必须报 `NOT-EVALUATED`，不能伪装成 PASS（见硬规则 3b 同形：没查成的状态要有独立取值）。

## 7. 架构评审三层：mechanical facts / declared rules / semantic judgment

这是 archguard `arch-layer-review` skill 的既有分工，三层物理上不合并成一张表：

| 层 | 产出 | 谁判定 | 可复现性 |
|---|---|---|---|
| **mechanical facts** | ArchGuard `analyze` 的原始输出（`moduleGraph` 边、环、度量） | ArchGuard，唯一真相来源 | 同输入字节级一致 |
| **declared rules** | `layers.yml` + `check-layers.mjs` 的 `pass`/`fail`/`not-evaluated` | 人审过的声明 + 确定性检查器 | 同输入字节级一致 |
| **semantic judgment** | 四态语义判断（`converged`/`cosmetic`/`regressed`/`not-evaluated`），附证据引用 | LLM，**仅建议，从不作为门禁** | 证据可复现，措辞可能变 |

四态判断只回答四个 MVP 问题：①责任真的只留在声明层（不是又长出第三套实现）；②旧层里的实现是否真的消失，不是看起来挪了但旧实现仍是 load-bearing（cosmetic）；③编排层是不是真的停止自己读+判+写，改成只传意图给领域层；④新模块是不是只是改名复制、body 里仍反向 import 旧的写原语（搬壳）。全 DDD 建模、OOD 审查（类职责/继承/组合）、架构风格诊断、全局打分，都明确排除在这个薄语义层之外——若回答判断需要新写一个确定性检查器，那是下一阶段的事，不归这层。

## 8. Mechanical pass ≠ architecture good；deterministic fail 也可能是改进或声明过期

`check-layers.mjs` 报 `pass` 只证明"声明的规则没被机械图违反"，不证明责任真的搬过去了——这正是第 7 节的 cosmetic 陷阱：看起来挪了，旧实现仍在干活,机械检查看不出来。

反过来，重构后一次 `fail` 不等于"改坏了，回滚"：

- 可能是**实现真的改进了**，出现了一条新的、符合预期的所有权边，只是声明文件（`layers.yml`）还没跟上这个新边，需要更新声明而不是改代码；
- 可能是**声明本身过期**，描述的是重构前的旧形状；
- 也可能真的是回归。

GOAL-030 的 AC-339 撞到过一个具体案例：最初为"单一 import 的玩具分支"设计的负对照算术，被真实落地的两条边（`ready-pool-check.ts` 直接 import + 经由 `task-ops.ts` 的 re-export）证伪了——只移除其中一条边，`strength` 仍然通过（因为另一条边还在撑着）；移除两条才正确触发 `CAUSE=kernel-edge-not-observed`。任务记录里原样保留了这次证伪过程，没有悄悄改数字掩盖掉。**这是模板：一次红不是告诉你"撤销"，是告诉你"去看"。**

## 9. Negative control / falsifiability：AC 必须能在负对照下失败

一条 AC 如果在故意破坏它本应守护的东西之后仍然通过，它就不是在测那个东西——这是本方法论对硬规则 4 的直接应用。GOAL-030 里三个具体负对照：

- **身份负对照**（AC-337）：主检出驱动同一个 sandbox 必须产出 0 条事件；
- **结构负对照**（AC-339）：移除声明边后重新测 `strength` 是否真的下降——且这个负对照本身也要被验证过（见第 8 节的两条边案例，证明"负对照的算术假设"同样需要经受真实数据的检验，不能只设计一次就当永久有效）；
- **身份负对照的镜像**（AC-340）：外来代码注册 → 必须报错退出；未注册目录 → 必须报 `NOT-EVALUATED`，不能和"通过"同形。

写一条新 AC 时，先问："如果我故意把它该守护的东西破坏掉，这条 AC 会变红吗？" 答不出来就不是一条可信的验收条件。

## 10. 可测指标：这次重构实际读的是哪些数字

| 指标 | 含义 | GOAL-030 的具体读数 |
|---|---|---|
| **cycles / SCC** | 目录级强连通分量数量，重构不应新增环 | 1 → 1（不变） |
| **reverse edges** | 声明的上下游关系被反向调用的边数 | `packages→plugin` 反向边 0（两端都 0） |
| **layer violations** | `check-layers.mjs` 报的违规数 | 本 slice 范围内 0 |
| **edge strength** | 两个包/模块之间的调用边权重 | `plugin/scripts→kernel`：14→16（上升）；`plugin/scripts→non-kernel`：44→44（不变，没有"顺手"把别的也挪过去） |
| **duplicate disappearance** | 原本重复的声明/实现是否真的消失 | `LIFECYCLE_EDGES` 由两处定义收敛为一处 + 一个 re-export |
| **literal dispersion** | 同一个字面量/常量散落在几个文件里 | 转移决策相关字面量收口到 kernel 单文件 |
| **canonical definition count** | 某个状态/规则表的 `export` 定义点数量 | `LIFECYCLE_EDGES`/`patchStatusField` 各恰好 1 |
| **direct-write count** | 旧模块里直写副作用的调用点数量 | `ready-pool-check.ts` 对 `patchStatusField(` 的直接调用：有 → 0 |
| **import direction** | 新模块是否反向 import 旧模块的写原语 | 否（通过 archguard 语义判断核实，非仅计数） |
| **post-merge event evidence** | 合并落地后，生产环境的真实事件是否能对上预期的行为 | AC-341：`develop` 上每一次 `promotion-driver` 机械晋升都要能在 `.quay/task-status-events.jsonl` 里找到对应的 `promote` 事件——**这条指标只能在 merge 真正落地后读，之前只能是 not-evaluated，不能用 pre-merge 的读数顶替** |

这些指标共同回答的问题是"责任真的搬了吗"，而不是"文件数变了吗"——文件数、行数变化只是会计记账（`AC-339`：file-count delta == `git diff` A−D，只是一致性校验，不是判好坏的依据）。

## 11. 当前阶段：优先 ownership convergence，再谈规模化 OO 化

Quay 现阶段的重构应该优先把"状态/决策/副作用/编排四件事分别归谁"理清、把 canonical source 真正收敛、把调用方真正改口（第 1–4 节），而不是急于铺开大规模的领域对象/模式体系。原因：

- 边界不清楚的时候提前建模式，代价是搬壳（第 2 节的陷阱）——换了名字没换责任，之后还要再收敛一次。
- 模式名字应该是"已经收敛形状"的标注，不是"打算收敛成什么样"的蓝图（第 3 节）；在只有一个真实实例的时候谈 Strategy/Repository 没有意义。
- 等多个 slice 把若干个所有权边界理清之后，真正需要的模式会自己浮现出来（有第二个真实实例时才升格），这时候做规模化 OO 化才是收敛后的自然延伸，而不是收敛前的猜测。

## 12. 一句话压缩版

**先把状态、决策、副作用、编排四件事分别钉给唯一拥有者，用 ArchGuard before/after + 负对照 + 分支自举证明调用方真的收敛到了那个唯一实现（不是搬了个壳），每次只切一个能独立验收的小问题，在 `branch:true` Goal 的 fork → 串行 task → 自举 → before/after → merge → post-merge 闭环里把这套验证跑穿到底，模式名字只用来标注已经收敛出来的形状，不用来提前设计。**
