---
id: gap-ownership-active-proposal-repair-loop
title: "ownership-active investigation loop: bounded proposal-repair on
  ArchGuard slice-delta rejection (classify
  evidence_gap/invalid_move/tool_limitation/honest_abstain, retry ≤3 rounds,
  same commit+scope, no new dirs, no source edits, no hardcoded answer)"
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

本任务是「端到端架构自举实验」(用户 2026-10-11 批准推动)的下一刀——承接刚实测的真实读数:当前 production carrier(`.quay/ownership-shadow-proposals.jsonl`,90 条/21 候选)里,**11/11 次**package-cycle 候选到达 ArchGuard `slice-delta` 这一步都被拒绝(`NO_EDGE_EXPLAINED_BY_MOVES` ×4、`MOVE_TO_NOT_AN_INTERNAL_DIR`(`"model"`/`"gate/contract"`/`"gate/core"`/`"gate/runtime"`) ×4、"切法覆盖不足"(部分符号未被覆盖,拒绝文本已点名具体符号) ×2、其余 1 条;独立重跑一轮,7 轮/6 次证据请求/24,805 字节,再次独立发现同一个真实四环但仍被拒),这是 `gap-ownership-active-limited-proposal-mode` 准入门限(§条件2)至今无法满足的唯一真实瓶颈。本任务只做一件事:对这类拒绝做**严格有界的反馈修复重试**,修不成就诚实 abstain——**不改变任何既有安全闸门、不绕过 3 连续轮次准入、不凭空建目录、不改源代码、不硬编码四环答案、不用 holdout 结果指导候选生成**。

<!-- dedup-ref -->
去重已查:`tasks/*.md` 无 "proposal repair"/"slice-delta retry"/"move rewrite" 同机制任务(搜索零命中);`gap-ownership-active-investigation-loop-shadow`(done)只建了一次性投研环,从未对拒绝做过重试;`gap-ownership-active-limited-proposal-mode`(done)只读拒绝结果判准入,不修复。两者均不碰,本任务是它们之间的新增中间层——本次用户重述同一需求时复用本 task,未另开。

**与 ArchGuard 协作的结论,已折入下方设计(2026-10-11,非事后补记)**:
- 与「archguard 架构语义映射」会话核实:liaison **纠正了原设计的一个真实风险**——用独立 `grep`/`find` 算"scope 内真实存在的目录",可能与 ArchGuard 自己判定的"scope 内部节点"不一致(两个实测过的不一致来源：① ArchGuard 的目录节点来自分析快照,未被分析到的文件所在目录不一定是节点；② 扁平目录如 `plugin/scripts` 被当成单一节点)。**采纳：合法目录清单改为直接复用同一次投研轮次已经取得的 ArchGuard 图数据,不独立 find/grep 算一份。**同时采纳"被拒绝 vs 没能评估"的失败契约区分：ArchGuard 返回 `not-evaluated`/`capability_gap` 归入 `tool_limitation`,不折进 `invalid_move`。
- 已联系「Quay refactor architecture liaison」会话(用户点名的 ArchGuard 协作对象),求证 `slice-delta`/`simulate_refactor_slice` 原语本身对"遗漏消费者"/"未知符号"是否已有独立拒绝码、以及是否存在 dry-validate 细粒度接口——**回复待补;本任务不预先假设任何未确认的新接口已合并,按现有接口的具体反馈字段自洽设计**(硬规则 12:没有发生率/确认数据不设新前置)。若回复带来新信息,在 DoD 报告追加记录。

## Proposal

新增 `docs/analysis/ownership-active-proposal-repair.mjs`:

1. `classifyRejection(sliceDelta)`——纯函数,**枚举、不布尔**(硬规则 3),把一次 `slice_delta` 拒绝归到四类之一(对应用户给的中文命名,一一对应):
   - `evidence_gap`(证据不足,需要补充调查)——拒绝原因表明判断者缺一个本可查到的事实(目前实测的 11 条真实拒绝里暂未观察到这类样本;模块仍声明该枚举值并给出可触发它的合成样本,如实记录"生产未见,结构上保留"而不是编一个假案例充数)。
   - `invalid_move`(切片定义错误,可以修正)——移动集本身不完整/不正确,但**拒绝文本已经携带足够结构反馈去修**:`NO_EDGE_EXPLAINED_BY_MOVES`(有未被任何移动解释的边)、"切法覆盖不足"(拒绝文本已点名具体未覆盖符号)、`MOVE_TO_NOT_AN_INTERNAL_DIR`(目标目录不存在)。**目录反馈的合法来源 = 原投研轮次已经取得的同一份 ArchGuard 图数据,⛔ 不独立跑 `find`/`grep` 另算一份**。本类也覆盖两个新增负场景(用户本轮点名):**遗漏消费者**(修订后的移动覆盖了命名符号,但漏了另一个同样 import 这些符号的消费文件——原语自己的覆盖校验若能检测则沿用其拒绝码;若原语把这种情况和"切法覆盖不足"归并成同一笼统拒绝,本模块也不额外拆分,按同一分类处理,不假装有更细的区分)、**未知符号**(judge 修订后的移动提了一个在 ArchGuard 图数据里根本不存在的符号名)——未知符号一律视为该轮修订本身无效,不计入"修复成功",必须再分类(不得把"图里查不到"误当"图里有但没覆盖"而伪造出一个看似合理的 delta)。若原投研证据里没有携带可用的目录节点清单,本模块不临时补查,直接按"证据不足以支持结构化反馈"归入 `honest_abstain`。
   - `tool_limitation`(工具能力缺失,需要反馈 ArchGuard)——拒绝本质上是原语能力边界,修复会要求凭空建目录/改源代码才能绕开;ArchGuard 返回 `not-evaluated`/`capability_gap` 也归入本类。两种情形都**不进入重试循环,直接终态为 abstain**,且与 `honest_abstain` 分开记录"为什么不可修"——本类的记录本身就是"反馈给 ArchGuard"的素材(写入报告供 liaison 复核,不是自动发工单)。
   - `honest_abstain`(不可合理修复,应 abstain)——**fail-closed 默认值**(硬规则 3b):拒绝文本本身无法解析/不属于已知三类任一 ⇒ 直接判这一档;也是重试轮次耗尽后的最终落点。
2. `attemptRepair({ candidateRecord, root, invokeJudge, maxRounds, maxWallClockMs })`——有界修复会话:
   - **有界维度四个,全部硬编码常量、不接受外部调大**:`maxRounds`(默认 3)、单轮证据预算(复用既有 `DEFAULT_BUDGET` 量级,不新设更宽的)、**总 judge 调用次数**(= maxRounds,不因重复失败而多给)、**总 wall-clock 时间**(`maxWallClockMs` 默认 1,800,000ms=30 分钟——按 3 轮 × 每轮 judge 最长 600,000ms 的既有超时量级设的硬顶,整个 repair 会话用 `Date.now()` 累计监督,超时立即终止为 `honest_abstain`,不是"再等一轮")。
   - 先 `classifyRejection`;`tool_limitation`/`honest_abstain` **立即**终止,0 轮重试。
   - `invalid_move`/`evidence_gap`:**锁定同一个 `ref_commit` + `scope_root`**(人为改动即抛异常,不是重试);每轮把**结构事实反馈**(未覆盖符号列表、来自同一份 ArchGuard 图数据的合法目录/包节点清单、未被解释的边列表、原假设/`concern_key`——均为可机械核验的事实,不包含任何历史 GOAL 的"正确答案")喂给同一个无工具纯补全 judge;重新跑 `slice-delta`;若返回未知符号 ⇒ 视为本轮未解决,计入轮次消耗,继续下一轮(不是立即放弃,因为 judge 可能下一轮纠正);重新分类;可修复则继续直到计算出通过负对照的 delta,或四个有界维度任一耗尽 ⇒ `honest_abstain`。
   - 每一轮(**原假设/`concern_key`**、分类结果、喂给 judge 的反馈文本、judge 的修订输出、新的 slice-delta 读数、本轮成本——轮次号/字节/耗时毫秒)都追加写入新载体记录类型 `repair_attempt`(`architecture-evidence-store.mjs` 新增 `appendRepairAttemptRecord`,必填字段同其余三类:`tool/ref/ts/sha256`等,外加 `attempt_no`、`bucket`、`locked_commit`、`locked_scope`、`original_hypothesis`、`elapsed_ms`)。
3. **不改的红线(逐条可核)**:不触碰 `evaluateEntryBar` 四条件本身、`deterministicGate`/`quotaGate`、run-streak 计算、3 连续轮次准入、人工批准机制;修复模块**不 import** `fileProposals`/`driveItems`/`fileDecisions`/`proposeDraftGoal`,**不写任何源码文件**,**不新建任何不存在的目录**,**不用任何 holdout(Holdout A/B)结果指导候选生成或反馈内容**。

## Plan

1. `classifyRejection`:对已实测的 4 种真实拒绝文本模式做分类测试;对一个合成未知拒绝文本分类到 `honest_abstain`;对一个模拟 ArchGuard `not-evaluated`/`capability_gap` 的样本分类到 `tool_limitation`(两者都不得被误判为 `invalid_move` 可修)。
2. `attemptRepair` 的"目录反馈"子函数:输入 = 原投研轮次证据里已含的 ArchGuard 图数据,**不额外跑 `find`/`grep`**;测试断言该清单与原始证据逐字一致;覆盖"快照外目录误判为合法"与"扁平目录单节点粒度"两个负样本。
3. 四个有界维度与锁定:测试断言 `maxRounds`/`maxWallClockMs` 超过硬编码上限时被拒绝;测试断言总 judge 调用次数不超过 `maxRounds`(stub 计数器验证,耗尽后归零不再调);测试断言 `ref_commit`/`scope_root` 人为篡改时函数抛错。
4. **负对照①(tool_limitation 零重试)**:目录受限的拒绝 fixture 与模拟 `not-evaluated` 的拒绝样本,均 0 轮 judge 调用、直接 abstain、分类为 `tool_limitation`。
5. **负对照②(修不成仍诚实 abstain)**:stub judge 重复同一错误移动,四个有界维度任一耗尽后终态为 `honest_abstain`,未产出任何通过负对照的 delta。
6. **负对照③(遗漏消费者)**:fixture 让 judge 修订后的移动覆盖命名符号但漏掉一个真实消费该符号的文件,断言该结果不被当作"修复成功"(无论原语自己是否单独报出这个拒绝码,本模块都不得把它误判为已解决)。
7. **负对照④(未知符号不得伪造预测)**:fixture 让 judge 的修订提一个图数据里不存在的符号名,断言不产出任何"计算成功"的 delta(即使负对照形式上能跑通,也不能因为符号本身是编造的就算数——测试显式构造这种"形式通过但语义造假"的陷阱并断言被拒)。
8. **反作弊:不硬编码四环答案**:测试对模块源码做字符串扫描,断言不含已知四环重构的具体移动字面量组合;同时断言不 import 任何 `GOAL-0*` 正文/`docs/architecture/quay-domain-model-2026-10-11.md`/已完成 `gap-*` task body/任何 Holdout A/B 记录作为反馈或候选生成来源。
9. **可复现盲测(fixture,不依赖真实 judge/网络)**:`repair-invalid-move-fixture.arch.json` 构造一个确定性可修复的 `invalid_move` 场景(stub judge 第二轮给出正确移动,目标来自 fixture 自带的 ArchGuard 图节点),断言重试后 `slice_delta.status` 变为计算成功且负对照证伪通过,重试轮次 ≤ 3。
10. **集成**:在 `ownership-active-loop.mjs` 的 slice_delta 拒绝分支后挂一个**可选**调用 `attemptRepair`(默认关闭,需显式 `--repair` CLI 标志开启,不改变现有默认行为)。
11. **真实复跑(pre-merge,worktree 内,盲测)**:对当前 develop 尖端用 `--live --repair --rounds 1` 跑一次真实投研+修复,记录到 `docs/analysis/ownership-active-proposal-repair-replay.md`;如实记录,哪怕仍是 `honest_abstain`。
12. **真实复跑(post-merge,独立,盲测)**:fan-in 落地后,**在 develop 新尖端上**(不是任务自己的 worktree)再跑一次 `--live --repair --rounds 1`,作为独立验证——用户本轮明确要求"通过 Quay task、测试、fan-in 和 post-merge 完成机制改进,然后运行新的、独立的 live blind test",这一步与步骤 11 必须是两次不同的调用、两条不同的记录,不得用同一次结果充当两次。
13. **与 ArchGuard 协作记录**:上方「与 ArchGuard 协作的结论」一节已记录与两个 ArchGuard 相关会话的真实交互;若「Quay refactor architecture liaison」回复带来新信息,DoD 报告追加一段引用。

## Touches

- docs/analysis/ownership-active-proposal-repair.mjs (new)
- docs/analysis/ownership-active-loop.mjs
- docs/analysis/architecture-evidence-store.mjs
- docs/analysis/ownership-active-proposal-repair-replay.md (new)
- plugin/test/ownership-active-proposal-repair.test.mjs (new)
- plugin/fixtures/ownership-active-slice/repair-invalid-move-fixture.arch.json (new)
- plugin/fixtures/ownership-active-slice/repair-tool-limitation-fixture.arch.json (new)
- plugin/fixtures/ownership-active-slice/repair-missing-consumer-fixture.arch.json (new)
- plugin/fixtures/ownership-active-slice/repair-unknown-symbol-fixture.arch.json (new)
- tasks/gap-ownership-active-proposal-repair-loop.md

## AC

- [ ] AC1 四类拒绝分类枚举且 fail-closed:4 种真实拒绝文本精确分类;合成未知文本 → `honest_abstain`;模拟 `not-evaluated`/`capability_gap` → `tool_limitation`;`evidence_gap` 如实标注"生产未见"。
- [ ] AC2 锁定同一 commit+scope:篡改任一值时函数抛错拒绝执行。
- [ ] AC3 目录反馈不独立计算,覆盖两种 liaison 指出的不一致负样本。
- [ ] AC4 负对照①(tool_limitation 零重试,两种来源)。
- [ ] AC5 负对照②(四个有界维度任一耗尽仍诚实 abstain,含总 judge 调用数与 wall-clock 上限两项新增维度的独立测试)。
- [ ] AC6 负对照③(遗漏消费者不被误判为修复成功)。
- [ ] AC7 负对照④(未知/编造符号不产出伪造 delta)。
- [ ] AC8 反作弊:不硬编码四环答案,不读取/不 import 任何 GOAL 正文、架构文档、已完成任务 body、Holdout A/B 记录作为反馈或候选生成来源。
- [ ] AC9 可复现盲测修复成功路径(fixture,重试轮次 ≤3)。
- [ ] AC10 真实 live 复跑——pre-merge(worktree)与 post-merge(develop 新尖端)**各一次独立记录**,结果如实写入报告,无论 computed 还是 honest_abstain。
- [ ] AC11 既有机制不回退:`evaluateEntryBar`/`deterministicGate`/`quotaGate`/run-streak/3 连续轮次准入/人工批准机制的既有回归测试全绿,本任务未触碰其判据。
- [ ] AC12 全量回归绿:`bash scripts/test.sh --for-task gap-ownership-active-proposal-repair-loop` exit 0。

## DoD

`docs/analysis/ownership-active-proposal-repair-replay.md` 提交,记录:四类拒绝分类定义与真实样例分布、与两个 ArchGuard 相关会话核实的结论原文引用、四个负对照的读数(含遗漏消费者/未知符号两个新增)、pre-merge 与 post-merge 两次独立 live 复跑的诚实终态(含成本:轮次/judge 调用数/字节数/耗时)、修复前后候选质量对比(拒绝原因分布变化,即使没有候选真正变为可提案)。⛔ 本任务不新建任何不存在的目录、不改任何生产源码(仅 `docs/analysis/`/`plugin/test/`/`plugin/fixtures/` 范围)、不硬编码四环的真实答案、不用 holdout 结果指导候选生成、不触碰 `evaluateEntryBar` 四条件/安全闸门/run-streak/3 连续轮次准入/人工批准机制、不创建或激活任何 Goal(至多产出一个 `draft`,且仍按 `gap-ownership-active-limited-proposal-mode` 既有门限,不降低)、不派发任何架构重构任务、不改任何生产 Gate。全部新增测试 + 既有回归绿。