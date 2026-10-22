# Ownership-First 重构方法论 — 从 GOAL-030、GOAL-031、GOAL-032 三次真实试点提炼

**Status:** live reference — 供后续 `branch:true` Goal 重构复用，不是一次性复盘。
**Worked examples：**
- GOAL-030（`goals/GOAL-030-晋升写入经-kernel-转移决策并留痕-...md`，AC-336..342，分支 `goal/GOAL-030`）——新增 kernel 模块、收敛两套写入路径，重构规模较大。
- GOAL-031（`goals/GOAL-031-needs-human-状态词汇-canonicalization-试点-...md`，AC-343..345，分支 `goal/GOAL-031`）——同一套方法在一个刻意切得更小的切片上的第二次独立验证：`goal-driver.ts` 里 5 处 `status === "needs-human"` 裸字面量比较收敛到已有正本 `plugin/scripts/task-status.ts`/`packages/quay/src/abi.ts`，不新造第二套声明。
- GOAL-032（`goals/GOAL-032-verdict-parser-ownership-收敛试点-...md`，AC-347..349，分支 `goal/GOAL-032`）——第三次独立验证，范围只收敛 ArchGuard `detect_duplicates` 命中的一对函数（`criterion-fidelity.ts::parseFidelityVerdict` / `goal-driver.ts::parseSemanticSufficiencyVerdict`），但先做了一次正式的等价性调查，再收敛为 kernel 单一实现 + 两个薄包装——是"ownership migration 而非删除重复"的例子（见第 2 节）。
**现状口径（2026-10-09）：** 三个 Goal 均已 **merge 入 `develop` 并 achieved**。GOAL-030 的 AC-336..342 全部 `achieved`（合并提交 `d71d2bde4`；post-merge 生产读数 AC-341、merge 形态 AC-342 均 `exit 0 PASS`）。GOAL-031 的 AC-343..345 全部 `achieved`（合并提交 `117ee91b8`）。GOAL-032 的 AC-347..349 全部 `achieved`（合并提交 `0da918926`）。本文引用的 `packages/quay/src/kernel/task-transition.ts`、`plugin/scripts/task-status.ts`、`packages/quay/src/kernel/verdict-parse.ts` 现在都在 `develop`/`author` 上可读，不再是分支限定产物。
**正本指针（不复制，只引用）：**
- `branch:true` Goal 机制细节 → `orchestration/SPEC-goal-branch-2026-10-03.md`
- GIT lens / hard-over-soft 的理论依据 → `adr/ADR-004-...md`、`adr/ADR-005-...md`、`adr/ADR-006-...md`、`adr/ADR-007-...md`
- 架构评审三层流程本体 → archguard 插件 `arch-layer-review` skill（`SKILL.md` + `references/goal-030-example-output.json`）
- `L_T/L_C/L_D/L_G/L_S` 词汇表 → `docs/references/` 下的 GIT 框架文档（见 CLAUDE.md「GIT review checklist」）
- 上位框架（本文三次重构是其具体实例，不是平行发明） → `docs/references/harness-semantic-compression-and-meta-driver-builder.md`（把"结晶/硬形变/残差维度"这套既有框架应用到 meta-driver builder 设计，第 4 节直接引用本文作 worked example）

**Non-goals：** 不是 OO/设计模式教程；不是 GOAL-030/031/032 复盘报告（三者只作可核验锚点）；不重复 `SPEC-goal-branch` 的机制细节或 archguard skill 的操作步骤——那些有各自的正本。

---

## 1. Ownership-first：先问"谁该拥有"，不先找 class

遇到一段行为分散、多处直写的代码，第一步不是"这段逻辑该放进哪个 class"，而是把它拆成四个独立的问题分别找拥有者：

- **状态**（这个决策依赖的规则表/边表本身，谁是唯一定义处？）
- **决策**（给定输入，判定走哪条路，这个判断函数归谁？）
- **副作用**（真正落盘/落事件的那一行写操作，归谁？）
- **编排**（谁在什么时机调用上面三者，这件事可以继续留在原处）

GOAL-030 的起点问题不是"任务转移该是哪个对象"，而是"任务转移决策该归谁拥有"——答案拆成四块都在 `packages/quay/src/kernel/task-transition.ts`：`LIFECYCLE_EDGES`（状态/规则表，从 `gate/lifecycle.ts` 收敛而来，原处降级为 re-export）、`decideTransition`（决策，三态 `allow/refuse/not-evaluated`，从不把"没判出来"塞进"拒绝"）、`patchStatusField` + `appendTaskStatusEvent`（副作用，从 `plugin/scripts/task-ops.ts` 收敛而来）。**编排**（何时调用、调用顺序）明确留在 `ready-pool-check.ts` 的 `applyPromotions`/`applyRevaluations` 里——不是每一块都要塞进同一个"对象"，四块可以、也应该落在不同模块。

四个问题分别回答完，剩下的才是"这个形状看起来像什么模式"（见第 3 节）——顺序不能反。

## 2. Canonical source ≠ 调用方真正收敛：避免搬壳

"建了一个新的权威实现"和"调用方真的收敛到那个权威实现"是两件独立的事，中间的陷阱是**搬壳（shell move）**：新模块存在、名字也对，但旧实现只是被套了个壳，或者调用方表面换了导入路径、骨子里还在走老的写法。真正收敛要同时满足三条（对齐 archguard `arch-layer-review` 的三个陷阱）：

1. **单一定义处**：状态/决策表在全仓库只有一个 `export` 来源，别处最多是 re-export，不能有"第三套实现"悄悄并存（GOAL-030 AC-336：`LIFECYCLE_EDGES`/`patchStatusField` 各恰好一个 `export` 站点，且站点在 kernel）。
2. **调用方真的改口**：把旧的直写路径数清楚、钉成具体数字，验收时确认这个数字归零（AC-336：`ready-pool-check.ts` 对 `patchStatusField(` 的直接调用从有到 0，转为 import kernel）。
3. **新实现不反向依赖旧实现的写原语**（搬壳不搬心）：如果新模块的 body 里还在 `import` 回旧的写函数，说明"心"没搬，只是换了个门面。

自检问法：**改一条调用点，是否还需要同时跑去两个地方改规则表？** 如果是，说明还没真正收敛，只是又多了一层转发。

**GOAL-031 是这条原则更干净的第二个实例，且不需要新造任何权威实现**：权威实现（`plugin/scripts/task-status.ts` 自包含副本 + `packages/quay/src/abi.ts`）早已存在、早已 `done`，缺口只在调用方——`goal-driver.ts` 里还有 5 处 `status === "needs-human"` 裸字面量比较从未迁移。整个 slice 就是纯粹的"调用方改口"：`grep -c 'status === "needs-human"' plugin/scripts/goal-driver.ts` 从 6 精确降到 1（唯一保留的一行是另一词表——GOAL-AC 的 `status`，不是 task 状态，判定靠逐行核实位置，不是关键词计数）。这也说明"canonical source"不必是物理上的单一文件：plugin 树不能静态 import packages 源码（打包边界），所以两份声明并存是合法的"单一正本的两个已声明副本"，不算第三套实现——真正要收敛的只是**调用方**，不是逼着两棵树共享一份物理文件。

**先导检查：duplicate ≠ equivalent，ArchGuard 的重复命中只是调查入口，不是合并触发器。** `detect_duplicates` 报出两段代码重复，证明的只是"文本/结构相似"，不证明"该不该合并"——合并前必须逐项核实：①调用语义是否真的相同（同一问题的两种答案，还是看起来像、实际回答不同问题）；②输入/输出形状是否一致；③错误与 `not-evaluated` 行为是否一致（fail-closed 的触发条件、兜底值是否逐字相同）；④调用方实际怎么消费返回值（同步/异步、是否缓存、失败后的编排是否不同）。四项都核实过、结论是 **equivalent**（不是"碰巧长得像"的 intentionally-divergent）才进入收敛；核实本身要留痕（谁比较了哪几行、下的什么结论），不能只凭 ArchGuard 的相似度分数直接动手合并。

**GOAL-032 是这条先导检查 + ownership migration（而非删除重复）的例子。** `criterion-fidelity.ts::parseFidelityVerdict` 与 `goal-driver.ts::parseSemanticSufficiencyVerdict` 先经过上面四项核实：算法逐字相同（`exitCode!==0 ⇒ not-evaluated` → 裸 token 匹配 → 从末行向上扫描 JSON → 其余一律 `not-evaluated`），两处源码注释与测试文件都自述"复刻"对方手法（证明是蓄意复制，不是巧合），结论 equivalent；但两边的**调用方编排故意保持不同**（一个同步无缓存，一个异步、两次采样一致才入缓存）——这部分不碰，留在原处（呼应第 1 节"编排可以继续留在原处"）。收敛动作是：新建 `packages/quay/src/kernel/verdict-parse.ts::parseBinaryVerdict` 作为唯一算法实现；`parseFidelityVerdict`/`parseSemanticSufficiencyVerdict` **保留原函数名/签名/返回类型，改成调用 kernel 函数的薄包装**；两处真实调用方（`criterionFidelityVerdict`/`sampleSemanticSufficiency`）**零改动**，仍然调用原来的函数名，只是那个函数内部已经委托给 canonical 实现。**这和 GOAL-030/031"调用方改口直接调新正本"是不同的收敛形状**：这次是"责任迁移到了正确的层，调用点感觉不到"——目标从来不是"删掉重复的那一份"，是"让两份实现背后只有一个真正的算法"。

## 3. OOA/OOD 与设计模式：边界已明确才用，不建 pattern zoo

State / Strategy / Command / Specification / Repository / Application Service / Domain Service / Domain Event 这些名字描述的是**责任边界已经清楚之后**长出来的形状，不是动手前要往代码里"安装"的蓝图：

- `LIFECYCLE_EDGES` + `decideTransition` 事后看像一张 State 表 + Strategy 判定——但起点不是"我们来套用 State 模式"，是第 1 节四问里"决策归谁"先有了答案，形状自然收敛成这样。
- 只有一个调用点、看不到第二个实现在望的时候，不要先搭 Repository 抽象层、不要先建 Domain Event 总线、不要先引入 Specification 对象——这是 CLAUDE.md 已有原则（"不要为假设的未来需求设计"）在重构场景下的具体化：三行相似代码好于一个过早的抽象。
- 判据：先完成第 1 节的四问拆分，**只有当某个边界已经出现第二个真实实例（第二个 provider、第二条调用链、第二种策略）** 时，才把这个边界正式升格为一个命名模式；否则它只是一个单一职责的函数/模块，不需要模式名字。

## 4. 小而真实的 refactor slice：一次只切一个可独立验收的问题

每个 slice 必须能**用数字钉死范围**，而不是用一句"顺手也清理一下"模糊掉边界。GOAL-030 的 AC-336 把范围钉成：fan-in（`worker-fan-in.ts`，4 处调用）、needs-human/branch-sync（`driver-filters.ts`，2 处调用）**明确排除**；"ABI vs kernel 的归属决策""`gate/lifecycle.ts` CLI 路径行为改变""目录环清理""driver 机制改动"**明确列为 non-goals**，不是被遗忘，而是被数清楚、点名留给以后的 slice——下一个 slice 不需要重新发现这些边界,直接从这张清单接手。

一次 slice 只解决一个能独立验收的问题；如果验收条件要同时证明两件不相关的事，说明 slice 切得太大，应该拆成两个 Goal 或两个 task。

**指标服从 scope，不为指标扩大重构范围（GOAL-031 的核心教训）**：GOAL-031 立项时的初始目标是把 `needs-human` 的 ArchGuard literal dispersion 从 5 降到 ≤2。执行前核实发现这个数字本身算错了——`packages/quay/src/observation.ts`、`plugin/scripts/workflow-baseline-metrics.ts` 里命中的其实是不同词表的字段（促晋升账本的 `action`、workflow 事件的 `outcome`），和 task 状态无关，是异词表假阳性；`packages/quay-github/src/github-client.ts` 那一处早被另一个已完成任务显式豁免、由 needle 测试钉死形状，不能动；再加上正本声明自身必然带一处字面量——四处里有三处结构上不可能被这次改动影响。正确的底线是 **4**（正本 1 + 豁免 1 + 假阳性 2），不是 2。GOAL-031 选择**把目标数值改成 4、把范围继续钉在 `goal-driver.ts` 的 5 处真实调用点上**，而不是反过来为了凑到 ≤2 去扩大 scope（比如去改 `observation.ts`/`workflow-baseline-metrics.ts`，或者去碰已豁免的 `github-client.ts`）。原则：**当"目标数值"和"已声明的 scope/非目标"冲突时，先检查数值本身有没有算错，不要为了凑数值反过来扩大 scope**——数值服务于已经划定的责任边界，不是反过来定义边界。

## 5. `branch:true` Goal 的标准流程

机制细节见 `orchestration/SPEC-goal-branch-2026-10-03.md`；这里只记录 GOAL-030、GOAL-031、GOAL-032 实际走过的闭环顺序，作为后续复用的检查单：

1. **Fork point**：ArchGuard before-基线，在 goal 分支创建前先对 `develop` 尖端拍一次。
2. **Goal 激活**：`goal/<GOAL-ID>` 从 `develop` 尖端惰性创建；该 Goal 下的任务派发自动把 `mergeTarget` 解到这个分支，worktree 从它 fork。
3. **少量串行 task**：每个 task 对应第 4 节的一个 slice，在 goal 分支上串行落地（彼此 fan-in 到 goal 分支，而非各自散落）。
4. **Branch 自举（self-host）**：见第 6 节——证明分支尖端跑的是分支自己的代码，不是侥幸读到了主检出。
5. **Before/after 对比**：同一套 ArchGuard CLI，对 fork point 和分支尖端（或合并提交两个父提交）各做一次单根 `git archive` 提取后分析，比较结构性指标（见第 10 节）。
6. **人工触发 merge**：`quay goal merge <GOAL-ID> --reason ...` 只记录 `goal-merge-request` GateEvent，不直接执行；机械 fan-in 由 worker-driver 按固定顺序（goal 锁 → develop 锁）做 `git merge --no-ff`，跑 anti-drift/typecheck/scoped-gate/全量 suite，绿则 `ff-only` 推进 `develop`，红则记录 gap、分支保留等下一次重试。
7. **规定 merge shape**：`develop` 的 first-parent 链上恰好一个合并提交，第二父提交是 goal 分支尖端，不允许分支内部的中间提交泄漏到 first-parent 上（AC-342 的判据）。
8. **Post-merge 验证**：合并落地后，针对生产环境的真实读数做核验（见第 6 节 AC-341 的形态），而不是止步于"合并没冲突"。
9. **全部 AC achieved 后关闭**：Goal 的收尾条件是其下全部 AC 进入 `achieved`（含 post-merge 类 AC），不是 merge commit 落地那一刻。GOAL-030 实际经历过这个等待——AC-336..340 先 `done`，AC-341/342 要等 merge 真正落地（合并提交 `d71d2bde4`）才评估完 `achieved`，GOAL-030 随后整体 `achieved`；GOAL-031 走完同一闭环（合并提交 `117ee91b8`，AC-343..345 全部 `achieved`）。两次都证实了"merge 完成 ≠ Goal 完成"：中间那段等待不是流程多余的一步。

**复用技术，不跨分支复用产物**：GOAL-031 立项时 `goal/GOAL-030` 还没并入 `develop`，GOAL-031 显式把"不依赖、不 import 任何只存在于 `goal/GOAL-030` 分支的文件"写进非目标——复用的是 GOAL-030 验证过的**自举校验技术**（校验被加载模块的 realpath 落在本 goal 的 worktree 内），而不是直接 import 对方未并入分支上的脚本，避免制造跨 goal-branch 的隐性耦合（见第 6 节）。

## 6. Branch self-host 身份证明：driver/serve/entry 的 realpath 必须在 goal 树内

"分支上跑测试通过"不等于"分支上跑的代码就是分支自己的代码"——如果子进程解析模块时意外落回主检出或全局安装的版本，所有绿色都是假的。证明身份用**直接量**，不用自报量：

- 从 `/proc/<pid>/cmdline` 读 entry 脚本的真实路径，而不是信任进程自己汇报的参数（AC-340："真实读到的实体 realpath 在被评估的树内"）。
- 每条事件（如 `.quay/task-status-events.jsonl` 的 promote/retreat 记录）都带 `writerModule`/`entry` 的 realpath，验收时核对这些 realpath 落在 goal 树的 worktree 路径下，不是主检出路径（AC-337）。
- **负对照是这条证明的另一半，不是可选项**：同一个 sandbox，换成**主检出**的 driver 去驱动，必须产出 0 条匹配事件（AC-337 的 `mainHasModule` 字段——这个负控制只在"主检出确实还没有这个模块"时才有效，所以要显式记录前提，而不是假定它永远成立）。
- 同理应用在 preview/serve 上：分支的 preview 实例若注册的是外来代码的 serve，必须报错退出（而不是悄悄通过）；若目标树根本没注册，必须报 `NOT-EVALUATED`，不能伪装成 PASS（见硬规则 3b 同形：没查成的状态要有独立取值）。
- GOAL-031 没有直接复用 GOAL-030 的 `scripts/branch-selfhost-probe.mjs`（当时只存在于未并入的 `goal/GOAL-030` 分支，且规模也不对等）——而是写了一个规模相应缩小的自包含校验 `scripts/goal-031-selfhost-probe.mjs`，落盘到 `.quay/goal-031-evidence/selfhost-identity.json`，复用的是上面同一条**判据**（realpath 落在本 goal worktree 内），不是跨分支复用那份脚本本身。

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

| 指标 | 含义 | GOAL-030 的具体读数 | GOAL-031 的具体读数 | GOAL-032 的具体读数 |
|---|---|---|---|---|
| **cycles / SCC** | 目录级强连通分量数量，重构不应新增环 | 1 → 1（不变） | `import-graph-check.ts` 四个棘轮量不回退 | `import-graph-check.ts` 四个棘轮量不回退 |
| **reverse edges** | 声明的上下游关系被反向调用的边数 | `packages→plugin` 反向边 0（两端都 0） | 同上，棘轮不回退 | 同上，棘轮不回退 |
| **layer violations** | `check-layers.mjs` 报的违规数 | 本 slice 范围内 0 | 本 slice 范围内 0 | 本 slice 范围内 0（kernel 是 `layers.yml` 已声明允许的落点，无需新加边） |
| **edge strength** | 两个包/模块之间的调用边权重 | `plugin/scripts→kernel`：14→16（上升）；`plugin/scripts→non-kernel`：44→44（不变，没有"顺手"把别的也挪过去） | — | `plugin/scripts→packages/quay/src/kernel` 新增一条边（方向正确，与 GOAL-030 引入 kernel 同构） |
| **duplicate disappearance** | 原本重复的声明/实现是否真的消失 | `LIFECYCLE_EDGES` 由两处定义收敛为一处 + 一个 re-export | 不适用——GOAL-031 不新造任何声明，权威实现早已存在、早已 `done`（见第 2 节） | ArchGuard `detect_duplicates` 命中的该组 before 存在、after 消失——算法只有 `verdict-parse.ts::parseBinaryVerdict` 一份 |
| **literal dispersion** | 同一个字面量/常量散落在几个文件里 | 转移决策相关字面量收口到 kernel 单文件 | `get_literal_dispersion(value:"needs-human")`：5 → 4（不是 ≤2——见第 4 节"指标服从 scope"） | 不适用——本 slice 收敛的是算法重复，不是字面量分散 |
| **canonical definition count** | 某个状态/规则表的 `export` 定义点数量 | `LIFECYCLE_EDGES`/`patchStatusField` 各恰好 1 | `task-status.ts` 正本声明处恰好 1（不变——本 slice 不碰正本，只迁调用方） | `parseBinaryVerdict` 的算法实现 2 → 1（两处旧函数各自一份完整算法 → kernel 唯一一份） |
| **direct-write count** | 旧模块里直写副作用的调用点数量 | `ready-pool-check.ts` 对 `patchStatusField(` 的直接调用：有 → 0 | `grep -c 'status === "needs-human"' plugin/scripts/goal-driver.ts`：6 → 1（剩 1 处是另一词表 GOAL-AC `status`，判定靠逐行核实位置，非关键词） | 不适用——GOAL-032 不是"消灭直写"，是"消灭重复算法"（见 consumer convergence 行） |
| **consumer convergence** | 真实消费方的调用方式是否仍指向正确的入口，而不是绕开封装直连内部实现 | 随 direct-write count 一起验证：`ready-pool-check.ts` 两处调用点确认走 kernel 路径 | 随 direct-write count 一起验证：`goal-driver.ts` 5 处调用点确认走 `task-status.ts` | `criterionFidelityVerdict`/`sampleSemanticSufficiency` 两个真实调用方**零改动**，仍调用 `parseFidelityVerdict`/`parseSemanticSufficiencyVerdict` 原函数名——验证靠读两层源码（调用方仍调旧函数名；旧函数体内已委托 `parseBinaryVerdict`），不是看调用点数字变化（本例调用点数字根本不变） |
| **import direction** | 新模块是否反向 import 旧模块的写原语 | 否（通过 archguard 语义判断核实，非仅计数） | 否——`goal-driver.ts` 新增 `import { TASK_STATUS } from "./task-status.ts"`，方向正确 | 否——`verdict-parse.ts` 零依赖纯函数，`criterion-fidelity.ts`/`goal-driver.ts` 单向 import 它，不反向 |
| **post-merge event evidence** | 合并落地后，生产环境的真实事件是否能对上预期的行为 | AC-341：`develop` 上每一次 `promotion-driver` 机械晋升都要能在 `.quay/task-status-events.jsonl` 里找到对应的 `promote` 事件——`exit 0 PASS`，merge 落地（`d71d2bde4`）后实测达成 | AC-345：`develop` 上重跑 grep 读数、核对以恰好一个合并提交（`117ee91b8`）进入 first-parent 链——`exit 0 PASS` | AC-349：`develop` 上 grep 两个旧函数体确认已是薄包装（不是叙述，是读到的事实），两处调用方测试在主检出上仍绿——merge 落地（`0da918926`）后实测达成 |

这些指标共同回答的问题是"责任真的搬了吗"，而不是"文件数变了吗"——文件数、行数变化只是会计记账（`AC-339`：file-count delta == `git diff` A−D，只是一致性校验，不是判好坏的依据）。

## 11. 当前阶段：优先 ownership convergence，再谈规模化 OO 化

Quay 现阶段的重构应该优先把"状态/决策/副作用/编排四件事分别归谁"理清、把 canonical source 真正收敛、把调用方真正改口（第 1–4 节），而不是急于铺开大规模的领域对象/模式体系。原因：

- 边界不清楚的时候提前建模式，代价是搬壳（第 2 节的陷阱）——换了名字没换责任，之后还要再收敛一次。
- 模式名字应该是"已经收敛形状"的标注，不是"打算收敛成什么样"的蓝图（第 3 节）；在只有一个真实实例的时候谈 Strategy/Repository 没有意义。
- 等多个 slice 把若干个所有权边界理清之后，真正需要的模式会自己浮现出来（有第二个真实实例时才升格），这时候做规模化 OO 化才是收敛后的自然延伸，而不是收敛前的猜测。
- GOAL-031 进一步验证了这个优先级在小切片上同样成立：范围已经划清之后，连"量化目标数值"都要服从那个范围，不能反过来用数值牵动范围（第 4 节）——规模化 OO 化更容易把"为了让数字好看"包装成"为了架构更好"，ownership convergence 阶段应该先把这条反射练成本能。

## 12. 一句话压缩版

**先把状态、决策、副作用、编排四件事分别钉给唯一拥有者，用 ArchGuard before/after + 负对照 + 分支自举证明调用方真的收敛到了那个唯一实现（不是搬了个壳），每次只切一个能独立验收的小问题，在 `branch:true` Goal 的 fork → 串行 task → 自举 → before/after → merge → post-merge 闭环里把这套验证跑穿到底，模式名字只用来标注已经收敛出来的形状，不用来提前设计。**

## 13. 提取 ≠ 扩展点：R1 与 R2（2026-10-22 增补）

第 2 节防的是「搬壳」：新模块存在，责任却没搬过去。本节补另一种陷阱：**责任确实搬出去了，但下一次增长仍然流回中心。**
光抽代码、不建扩展点，新功能的落点就不会变。第 3 节「有第二个真实实例时才升格为模式」仍然成立，本节不推翻它，
只补一条：**被拆的那个中心如果是「每加一种 X 就要改它」的形状，拆分的验收就必须写明「下一个 X 加在哪」。**

### 13.1 读数（每个数都附载体与基线；**同一窗口两种口径**）

**两种口径，正本 = `plugin/scripts/design-evolution-readings.ts` 的字段名**（⛔ 不要另起一套叫法；
任务 `gap-design-evolution-share-caliber-net-vs-additions` 之前本文误把 quay 口径写成「只计新增」）：

- **`netShare`**（记录键名 `share`，旁边带 `shareBasis: "net"`）= 中心文件**行数净差** ÷（中心净差 + 非中心净差）。
  窗口两端 `wc -l` 相减。两个后果：纯搬出提交让中心净减少（**负**的中心增量，会**抵消**随后的长回，
  「先搬走再长回来」和「根本没搬」在净口径下同形）；非中心文件净减少时分母可以小于分子 ⇒ **占比可以 >100%**。
- **`additionsShare`** = `git diff --numstat` 的**新增行**（窗口两端聚合；`-M` rename 检测开启 ⇒ 纯搬家计 0 新增）÷
  （中心新增 + 非中心新增）。两个性质：**结构上 ≤100%**（两项都是非负计数）；与 claudecodeui 会话的
  additions-only 口径**可比**（这也是本文此前写「只计新增」的来源——那个数当时并不存在，代码一直算的是净口径）。
- 两者是**同一个窗口的两个数**：⛔ 不可互引，也不可引用对方的数值作基线；引用任一都必须**连口径一起写**。

| 子系统 | 重构形状 | `netShare`（净口径） | `additionsShare`（只计新增） | 载体 / 命令 |
|---|---|---|---|---|
| serve | 按关注点拆分 **+ 分发器（扩展点）** | **1.31%**（中心 +153 / 分母 11,687；基线 `295e771b0` → HEAD） | **2.32%**（349 / 15,038） | `.quay/design-evolution-history.jsonl`（gitignored，主检出）；复跑 `node --experimental-strip-types plugin/scripts/design-evolution-readings.ts --no-history --json` |
| worker-history | 抽出一块区域（`2440b52d0`，`worker-fan-in.ts`），**没有扩展点** | **82.46%**（4,820 / 5,845；基线 `2440b52d0` → `ff32d031d`，即 GOAL-909 动手前） | **79.70%**（5,210 / 6,537） | 同上；统一公式与口径更正见 `tasks/DIR-133.md`「口径更正（2026-10-22）」。**DIR-133 早先的「88%」作废**（漏算分母，只计了新增模块） |
| worker-post-909 | 同上，窗口从 GOAL-909 最后一次落地提交（`024f9d7f2`）起 | **102.13%**（288 / 282 —— 非中心**净 −6**，分母小于分子，见上） | **93.81%**（288 / 307） | 同上。⚠️ 这一行就是「净口径会产出不可解释读数」的实例：**同一窗口**只计新增时是 93.81%，**恒 ≤100%** |
| quay worker（另一个窗口） | 同上，但窗口跨过 GOAL-909 的搬家提交 | **约 70%**（10-21T23:14Z 记录：基线 `2440b52d0` → HEAD `5c74f38f2`，中心 +4,420 / 非中心 +1,897 = 69.97%）；2026-10-22 对 HEAD `584e10c60` 复跑得 70.77% | 该窗口已整体退役（config 把 `worker-history` 钉在 `ff32d031d`），只保留净口径历史值 | 同上。这个窗口把 GOAL-909 本身的搬出量算进了分母，所以读数偏低。**两个数各对应自己的基线，不能互相替换** |
| plantuml-js `ElkLayoutEngine` | `gap-elk-layout-engine-split-responsibilities`：拆成 layers / elk-graph / elk-result，**没写扩展点判据** | 该仓**未接入本载体**⇒ 缺（⛔ 不要把这行的数与 quay 的两个口径并排当同一量）：`elk.ts` 570 → **150** 行（`76d1808`，10-22 00:58 +0800），类级 `outDegree` 9（≤11）、methodCount 3（≤8）；此后 8 个改动 `elk.ts` 的布局/渲染功能提交又把 `elk.ts` 长回 **278** 行（`1eb90a0`，06:47），summary 口径的 call 出度 **26**（探针当时 23），methodCount 15 | 缺（同左，该仓无本载体） | plantuml-js `tasks/gap-elk-layout-engine-split-responsibilities.md`「执行证据」；`tasks/gap-elk-layout-strategy-extension-point.md` Proposal；`git show <rev>:src/layout/elk.ts \| wc -l`；会话 `69ce95b8` 中 Claude 的原话：「上一轮我立的拆分任务没写扩展点判据，结果就是文件短了、出度反而升了」 |

**读法**：serve 与 worker 的区别在于有没有扩展点，而不在拆没拆（DIR-133 F3）。**两种口径在 serve / worker-history
上给出同方向的结论**（1.31% vs 2.32%、82.46% vs 79.70%——方向一致、数值不同），所以「方向结论不变」；
但 `worker-post-909` 的净口径读数 102.13% 是**口径产物**而不是「回流特别严重」，引用时必须用 `netShare`/`additionsShare`
同时说明。plantuml-js 一例把这件事压缩到 6 小时内：拆分当时数值全绿，接下来的功能增长又全部落回 `ElkLayoutEngine`。
随后的 `gap-elk-layout-strategy-extension-point`（`134934a`，done）才给出「从外部注入合成策略、不改 `src/layout/elk.ts`
即生效 + 抛错负对照」的判据。
⚠️ 口径提示：「出度 23 → 26」比较的是 archguard summary 的 `topByOutDegree`（方法级关系计数），
不是拆分 AC 用的 cognitive summary 类级 `outDegree`（落地时 9）。两个口径不可混比，这里只取同口径的 23 → 26。

### 13.2 重构分类（工作模型，**机制成立待验**）

| 级 | 名称 | 改变了什么 | 低一级满足不了的 Π 检查 | 实例 |
|---|---|---|---|---|
| R0 | 搬家（relocation） | 只改分区/目录边 | **目录级环**：GOAL-910 AC-916（`packages/quay/src` 目录级 SCC = 0） | `e7e84366a`（serve* 搬进 `src/serve/`）+ `d21a018aa`（observation 拆进子目录）在 10-21 16:26–16:27Z 造出 `{., observation, serve}` 环。plantuml-js 反方向：`4327862` 沉核心后环仍在，`feba9f3` 再搬一次才断 |
| R1 | 提取（extraction） | 改边，**不改增长方向** | **窗口增长落点占比**（`netShare` / `additionsShare`）——与 R2 同一个判据；⚠️ call 出度**不是**判据，只是**签名**（见下） | quay worker `2440b52d0`；plantuml-js elk 拆分（出度 23→26，**上升**） |
| R2 | 扩展点（extension point） | **改增长方向** | **中心增长占比**（`netShare` / `additionsShare` 两口径并记，§13.1）——只能**事后**在后续功能上判，落地当时测不出 | quay serve 分发器；quay AC-915（WorkerPool 结局处理单元可从外部注册）；plantuml-js 策略注入 |
| R3 | 所有权收敛（ownership consolidation） | 一处定义、调用方改口 | **重复组数 / 定义点数**（本文第 10 节 duplicate disappearance、canonical definition count） | GOAL-030/031/032 |

**R1 与 R2 的判据是同一个：窗口增长落点占比。出度不是判据，是签名（2026-10-22 更正）。**
本文此前把 R1 的 Π 写成「call 出度（同口径前后比）」，暗示**纯提取会让出度下降**——跨三个代码库的实测**方向相反**：

| 签名 | 出度方向 | 实例（同口径前后比） | 这一刀实际是什么 |
|---|---|---|---|
| 纯提取（R1） | **上升** | claudecodeui hook 38 → 56；plantuml-js elk 23 → 26 | 中心仍然调用被搬走的符号，**又多出 import 边** ⇒ 出度只增不减 |
| 注册表式扩展点（R2） | **下降** | claudecodeui driver 203 → 187（−16） | 中心把 N 条分支换成一次注册表调用，边真的塌掉了 |
| dispatch 缝（缝签名，**不算 R2**） | 持平 | claudecodeui ws-proxy 65 → 66 | 建了 register/dispatch，但帧处理边大多留在**同文件的兄弟函数**里 ⇒ 没有塌边。2026-10-22 复核：这一刀归「缝」 |
| 断边 / 依赖倒置 | 不适用 | claudecodeui 刀5：**环 8 → 7** | 只断依赖，不改增长方向 ⇒ 用**环数**做签名 |

⇒ **出度只能当签名读**：上升 = 提取留下了调用边（正常），下降 = 真把 N 条边收进了一条（R2 的形状），持平 = 缝。
**R1/R2 的判读永远回到「下一個 X 加在哪」**（`netShare` / `additionsShare` 两口径并记），⛔ 不要用出度方向给一刀定级。
claudecodeui 因此**目前干净的 R2 样本只有 driver 那一个**（203→187）；hook 是 R1（38→56）；刀5 是断边（环 8→7）。

**扩展点只盖叶子、不盖主干（2026-10-22 增补）**。叶子注册表（「结局怎么处理」「这一帧走哪个 handler」）不改变
**编排主干步骤**的落点：主干每一步仍然写着 `if/for`，新功能仍然要改中心文件。两个实例：
① **quay worker**——GOAL-909 的 `WorkerPool` 只覆盖「结局处理」这一类，派发决策与派发执行仍在 `runResidentLoop` 里，
它的 call 出度**仍是 84**（§13.4 的读数），所以 §13.4 的样本外预测仍按「回流中心 ≥50%」登记；
② **claudecodeui driver**——注册表只盖 handler 叶子，主干编排步骤没动，出度才下降得动那 16 条（不是更多）。
⇒ 拆分的验收要写明「下一个 X 加在哪**一层**」：只盖叶子的扩展点，落点判据必须看**主干步骤**有没有跟着搬。

每一级都要用它自己的 Π 检查来验，低一级的检查证明不了高一级：R1 的行数/方法数全绿，证明不了 R2（plantuml-js）；
R0 的目录环为 0，证明不了 R1。R2 的检查天生滞后，所以 R2 的**落地验收**只能用代理形态（「外部注册一个合成单元，
不改中心文件即生效，且改动前为红」，DIR-133 裁定 2 / AC-915），真正的判读要等后续功能落地之后再读中心增长占比
（同时记 `netShare` 与 `additionsShare`，见 §13.1）。

**R0–R3 表的读法补充：方法体 vs 方法壳（2026-10-22 增补）**：`methodCount` 在一次职责外移后几乎不降——
公开**方法壳**留在契约上、只有**方法体**搬走了（driver 88→86；刀1 完成后 methodCount 反而是 88，比先前
报告的 87 +1，因为读数这一步多出一个 registry 委托壳）。因此判 R1（提取）不能只看 `methodCount`：
要么用同口径的 call out-degree（`archguard_summary` 的 `topByOutDegree`，前后同口径比），要么把
「方法体行数」与「方法壳数量」分开记。`methodCount` 下降只证明壳少了，不证明体搬了；两者混读会把
「有进展」误判成「没进展」（硬规则 4b：一个代理量混了两类对象）。⚠️ 但出度本身也**只是签名**（上表）：
它解释「这一刀是什么形状」，**不**判定 R1/R2——判定回到增长落点占比。
四臂判据的机械检查器：`plugin/scripts/extension-point-criteria-check.ts`（四态 `satisfied` /
`missing-arms` / `not-applicable` / `NOT-EVALUATED`）；骨架生成器：
`plugin/scripts/extension-point-criteria.ts --scaffold --task-id <id> --central <file> --outside <module>`。

**分级**：三组读数**证据充分**（载体可复跑）；「R0–R3 是四个可分离的级、每级需要独立的 Π」是**机制成立待验**，
依据只有本节的 quay 两个子系统 + plantuml-js 一例。

### 13.3 DIR-133 规则 ② 已升格为 Π 检查（2026-10-22 落地）

DIR-133 裁定 2（「设计调查/切片的 AC 必须含扩展点判据」）原先**只是散文**。它防的那种失败（拆分 AC 没写扩展点，
增长回流）已在 **2 个代码库发生过 2 次**：quay worker `2440b52d0`，plantuml-js `gap-elk-layout-engine-split-responsibilities`
（这个计数不含 claudecodeui 的 ws-proxy——它 2026-10-22 又提供了一例，使发生率升到 3 个代码库）。
按硬规则 12，发生率 ≥2 足以把它做成可执行检查；本任务（`tasks/gap-extension-point-refactor-criteria-scaffold`）
已落地机械形态：

- **判据正本** = 本节 13.5 的四臂（正臂 / 负臂 / 注入泄漏 / 红线基线）；
- **检查器** `plugin/scripts/extension-point-criteria-check.ts`——按位置只读任务的 `## Acceptance Criteria` 列表项，
  四态输出 `satisfied` / `missing-arms`（逐臂具名）/ `not-applicable` / `NOT-EVALUATED`；
- **骨架生成器** `plugin/scripts/extension-point-criteria.ts --scaffold --task-id <id> --central <file> --outside <module>`
  （stdout dry-run；任务体仍只经 Provider ABI `task_write` 写入）；
- **skill** `plugin/skills/extension-point-refactor/SKILL.md` 把「生成骨架 → 填四臂 → 跑检查器 → 落 AC」串成一次调用。


### 13.4 登记一条样本外预测（2026-10-22 登记）

- **对象**：quay worker 在 GOAL-909 之后的增长，载体子系统 `worker-post-909`（`.quay/config.yml`
  `design_evolution_readings`，基线 `024f9d7f2`，即 AC-915 扩展点落地提交）。
- **模型依据**：GOAL-909 的 `WorkerPool` 是 R1，不是完整的 R2。状态归属收进了类（`WorkerPool` methodCount 16），
  扩展点也只覆盖「结局处理」这一类；派发决策与派发执行仍在 `runResidentLoop` 里，后者的 call 出度**仍是 84**
  （archguard scope `b4f87b21`，快照生成于 2026-10-22T00:58Z，晚于 `024f9d7f2`；`archguard_summary` `topByOutDegree`，
  与 GOAL-909 前的 discovery 任务读数相同）。
- **预测**：后续 worker 增长中，落在中心文件（`worker-driver.ts` + `worker-fan-in.ts`）的占比**保持 ≥50%**。
- **证伪条件**：读数 **≤20%** ⇒ 对这个案例而言，R1/R2 的区分被证伪（R1 也改变了增长方向）。落在 20%–50% 之间：不判，记为不确定。
- **判读时点**：`worker-post-909` 的分母（中心 + 非中心增量）第一次 ≥ 1,000 行的那条记录。这个门槛是临时的，
  量级取自历史窗口（`worker-history` 分母约 5,800 行）；它只决定何时判读，不是质量阈值。
- **登记时的现状（不作判读）**：2026-10-22 复跑 `design-evolution-readings.ts`（HEAD `584e10c60`）得 `worker-post-909`
  中心 +172 / 非中心 +0（**净口径**；`additionsShare` 的同窗口读数见 §13.1 的 `worker-post-909` 行），共 2 个提交（`d88ad2db8`、`80d75e886`，都是 fan-in 暗轴谓词）。分母远不到 1,000 行，**不计入判读**；
  10-22T00:40Z 那条载体记录里，这个子系统还是 `evaluated:false`（分母为 0）。

### 13.5 扩展点判据四件套（正本；生成器与检查器都引用本节）

来源：claudecodeui 会话「Quay 的 OO 设计重构」2026-10-22 在 5 刀 OO 重构里**每刀手写**的同一套判据。
本节是它的唯一正本：`plugin/scripts/extension-point-criteria.ts` 输出它，
`plugin/scripts/extension-point-criteria-check.ts` 按下面四条臂判它。

### 臂 1 — 正臂（positive arm）：从中心文件之外注册的 handler 被触发

**断言形态**：从 `<outside>` 注册一个新的处理单元、**不修改** `<central>`，运行后读数必须是 **`triggered=1`（计数）**——
不是「handler 存在」。存在性检查在断线时仍然绿，测不到接线。
**取假方式**：删掉/断线外部注册后同一断言读数为 `triggered=0` ⇒ 本条必红。红色落点是「注册被移除/接线断开」这一步。
**是否活性臂**：**是**。这条正臂就是活性检查，不另配一条；负臂不能替代它。

### 臂 2 — 负臂（negative arm）：未注册时不触发

**断言形态**：同一个断言在【未注册】时读数为 `triggered=0`。
**建议伴生读数**：负臂同时断言 `handlerRegistered=false`（注册表确认无此 handler）。负臂绿有两条路径——
unregister 真的被 gate 掉了 / unregister 没生效但恰好被正臂拦住；多这一个读数才把两条路拆开，
让「unregister 真生效」由负臂自己直接证出（claudecodeui 2026-10-22 审阅建议，采纳）。
**取假方式**：分派器泄漏/无条件调用时，`triggered=0` 必红。
**是否活性臂**：**否**（它是真空绿的来源，必须配正臂）。⚠️ 负臂单独看，对「注册了但断线」是**假绿**——
断线时 `triggered=0`，负臂照样绿，只是绿错了理由。因此：**只写负臂、不写正臂 ⇒ 判据无效**，
检查器判 `missing-arms` 并具名到正臂；负臂只有在与一条 counted 正臂（`triggered=1`）成对时才被接受。

### 臂 3 — 注入泄漏（injection leak）：把分派器替换成泄漏实现后，同一断言必红

**断言形态**：把 `<central>` 的分派器替换成泄漏实现（无视注册表、无条件调用），臂 1 / 臂 2 的同一断言必须打红。
**取假方式**：替换后仍绿 ⇒ 该臂没测到分派器，判红。
**是否活性臂**：**否**。它的作用是证明**负臂断言本身不真空**（不是给正臂兜底）：如果泄漏实现下负臂仍然绿，
说明负臂测的不是分派器。

### 臂 4 — 红线基线（red-line baseline）：改动前 `wc -l <基线>` 的断言必红

**断言形态**：改动前记录 `wc -l <central>` 的基线 B，并断言改动后中心文件行数 < B（或等价的结构读数）；
在改动前跑这条断言必须为红。
**取假方式**：基线之前跑不红 ⇒ 断言没测到那次增长。
**是否活性臂**：**否**。**本臂是单次任务 AC，不是常设棘轮**：只在重构任务验收时由 worker 检查一次，
任务 done 后永不复评，因此它**不会**在后续增长里恒红，**不需要重锚规则**。常设棘轮属于设计演进读数例程
（`design-evolution-readings.ts`）的领域，不要在这条 AC 里假装拥有它。（本仓库「把行号钉进判据」的历史教训
只在**常设**检查上成立，单次 AC 不适用。）

**机械形态**：`plugin/scripts/extension-point-criteria-check.ts` 按位置只读 `## Acceptance Criteria` 的
GFM 列表项（`## Proposal` 散文、代码围栏、注释里的同名文字都不算——硬规则 2），四态输出
`satisfied` / `missing-arms`（逐臂具名，正臂写成「handler 存在」也算 weak 缺失）/ `not-applicable`
（不是设计切片）/ `NOT-EVALUATED`（AC 段读不到，独立取值，不得与 `satisfied` 同形——硬规则 3b）。
脚手架：`plugin/scripts/extension-point-criteria.ts --scaffold --task-id <id> --central <file> --outside <module>`；
skill：`plugin/skills/extension-point-refactor/SKILL.md`。

### 13.6 三种「占比」口径：`centralChurnShare` ≠ `netShare` ≠ `additionsShare`（不可互引）

**结论：不是同一个量，⛔ 不得互相引用**（claudecodeui 2026-10-22 复核后已撤回原比较）。

- **`centralChurnShare`（canonical 键名；claudecodeui 口径；单 commit churn，含删除。早期写作 `centralΔ`——
  `Δ` 易被读成「净变化」，而本量是 insertions+deletions 的 churn，故 canonical 键名取 `centralChurnShare`）** =
  (该 commit 内中心文件的 insertions + deletions) ÷ (该 commit 全部文件的 insertions + deletions)。
  实例：driver 那一刀 263 / 1275 = 0.206。它度量「**这次重构**的 churn 有多少落在中心文件」。
- **quay 的两个时间窗口口径（`design-evolution-readings.ts` 的字段名，正本在 §13.1）**：
  · **`netShare`**（记录键 `share` + `shareBasis:"net"`）= 窗口两端的中心文件**行数净差** ÷（中心净差 + 非中心净差）。
    实例：`worker-history` 基线 `2440b52d0` → `ff32d031d`，4,820 / 5,845 = 82.46%；serve 153 / 11,687 = 1.31%。
    ⚠️ **本文此前把这个数写成「只计新增」是错的**（2026-10-22 更正，任务
    `gap-design-evolution-share-caliber-net-vs-additions`）：代码一直算的是净差；净差可为负、分母可小于分子，
    所以同一窗口能读出 >100%（`worker-post-909` 102.13%）。
  · **`additionsShare`** = 窗口两端 `git diff --numstat` 的**中心新增行** ÷（中心新增 + 非中心新增），纯搬家计 0。
    实例：`worker-history` 5,210 / 6,537 = 79.70%；serve 349 / 15,038 = 2.32%；`worker-post-909` 288 / 307 = 93.81%。
    **这个才是与 claudecodeui 的 additions-only 口径可比的那个数**。
  两者都度量「**后续增长**回流中心的比例」，只是一个按净差、一个按新增。
- **差异的来源**：分子与分母都不同——`centralChurnShare` 单 commit、删除也计入；quay 的两个口径是时间窗
  （一个按行数净差、一个按新增行）。
  0.21 回答不了「后续增长回流中心的比例」；**三个数不可互相替换，也不可引用对方的数值作基线**。
  ⛔ 引 quay 的数时必须写成 `netShare X%` 或 `additionsShare Y%`——只写「占比 X%」读者无法判断是哪一个。
