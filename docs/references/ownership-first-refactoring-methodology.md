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
