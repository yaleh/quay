---
id: gap-fan-in-suite-red-attribution-has-no-control-measure-first
title: fan-in suite 红一律记为本任务缺陷而无任何对照——先量确定性 develop 侧红的发生率，再决定是否建 develop-tip 基线轮
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：2026-09-13 本会话对「worker 退出时未落地率 62%」的实证调查（`.quay/worker-outcome.jsonl` 1801 条：exited-not-landed 1062 / completed 637 / failed 99；其中 614 个曾落地任务平均 2.63 次 / 中位 2 次 dispatch 才落地）。

**读数一（判据侧的结构问题——本条的根本理由）**：
窗口 2026-09-04…09-13 的 B 类（行为测试红）**145 轮**中，失败测试落在该轮**当时** `## Touches` 之外的占 **92.4%**（用 `git show <该轮时刻的 sha>:tasks/<id>.md` 去污染后测得；用**当天**的 Touches 会得到 24.1% 的假象，因为 worker 修完 blocker 会把它补进 Touches）。同一批轮里 scoped 门（= 正是 Touches 基础的影响面选择）**在 147 次中是绿的** ⇒ **fan-in 的 suite 红按构造就是影响面选择覆盖不到的残差。**
而现状的结论是「suite 红 ⇒ 这个任务有缺陷」，**它没有任何对照**。硬规则 4 推论四要求：任何「我认为 X 是因为 Y」在投递前必须附一个**若 Y 为假则结果会不同**的对照；给不出 ⇒ 降为假说。⇒ 当前这条归因结论**结构上从未被检验**。

**读数二（空缺是真实的，而且是回归）**：按 `scope/runner` 分桶 `verification-round.jsonl`——
`('worktree','inner')` 1257 条（末次 2026-09-13T05:08Z）、`('main','outer')` 215 条（**末次 2026-08-24T03:54Z，之后归零**）、`('worktree','outer')` 135 条（末次 2026-08-20）。
⇒ **自 2026-08-24 起 100% 的轮都是 per-task worktree 轮，任务无关的全量轮一条也没有了**（随 outer 层 2026-09-04 退役而消失）。
⇒ 并且那个曾存在的 `scope=main` 轮跑的是**主检出 = `author` 分支，不是 develop tip** —— 按既有实证 author 可落后 develop 53 提交 ⇒ **即便它还活着也不是本条要的基线。** 目前**没有任何已落地机制占位**。

**⚠️ 读数三（前提负控制：一个已被定量否决的相邻方案，本条必须回应它而不是无视）**：
`gap-perfile-failure-rate-baseline-step-change`（**done**）已落 `plugin/scripts/perfile-failure-rate.ts`，从 `verification-round.jsonl` 全历史算逐文件 `{runs, fails, rate}` 并四态分类（`new-event` / `within-baseline` / `step-change` / `insufficient`），接进 `fan-in-execute.js` 的 FIX_SCOPE_GATE。**它的「基线」是历史失败率基线，不是 develop-tip 对照轮。**
**它明确记录了一个已被定量否决的方案**：「两臂对照」被判**欠功效**——全历史 642 轮 / 243954 条 perFile，**总体失败率 0.1246%**，头部抖动源也只有个位数百分比。
**⇒ 这条算术对本条同样适用**：一个 flaky 失败在一次 develop-tip 基线轮里**同样极可能不复现** ⇒ **对照只对【确定性】的 develop 侧红有分辨力，对 flaky 类基本没有。**

**⚠️ 读数四（我手上的读数进一步削弱了「值得建」这个前提——必须先量，不能先建）**：
本次调查的逐文件真读数显示，跨任务复发最凶的五本失败率是 **0.94% ~ 8.55%**（`gap-git-graph-task-view-aggregate…` 117/10 = 8.55%、`observation.test.mjs` 700/25 = 3.57%、`worker-driver-resident` 610/17 = 2.79%、`suite-bucket-reattr-ratchet-check` 645/10 = 1.55%、`ts-typecheck-gate-config-wiring` 532/5 = 0.94%）⇒ **它们是 flaky，不是确定性的。** 一个确定性的 develop 侧红在它存活的窗口里应接近 **100%**。
**⇒ 我没有「确定性 develop 侧红占多少」的读数。** 该类事件确实发生过（`gap-suite-fix-red-baseline-2026-08-16` 就是一次专门修 develop 基线红的任务；另有记录在案的「全仓套件红、谁都落不了地」与「loop 级零落地」形态），**但发生率未测。**
按硬规则 12：**要求一个新机制之前先给出它已经发生过几次；给不出就降为观察项，不作阻塞。** ⇒ **本任务因此是【先量后建】：第一件事是测那个发生率，而不是实现基线轮。**

**⇒ 本条与既有机制的分工（立案时必须写清，否则会被判重）**：
`gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky`（**done**）的 `judgeRetryExemption`（`plugin/scripts/worker-driver.ts`）是**回溯式**判定：三态 `unrelated-flaky-exempt` / `own-defect-counted` / 数据不足；触发条件 = 失败文件 ∉ 本任务 `## Touches` **且**同一断言签名在近期窗口命中 **≥2 个不同任务**。它的三个结构性缺口：
① **第一个受害者照样付账**（签名只出现 1 次 ⇒ `own-defect-counted`，这是它的负控制半边，设计如此）；
② **只豁免重试计数，不放行着地**（命中后走延后重派，任务仍 `exited-not-landed`、worktree 保留）；
③ **不为 develop 侧缺陷单独立案**。
⇒ 本条若建，是把同一判定从「回溯统计」升级为「前瞻对照」，**且只在确定性红这个子集上** ⇒ 恰好补 ① 与 ②。⛔ 本条**不得**声称解决 flaky 归因（那属 `judgeRetryExemption` 与「负载敏感测试类级收口」那条任务）。
另：`gap-suite-round-record-missing-failures-field`（done）已把 `failures[]` 补进 `SuiteRoundRecord` ⇒ 差分有可比对象，是本条的**使能前置**（已满足）。
另：管理者 2026-08-08 有一条裁定——**「事后用一次通过追认分类」= 用结果反推分类，不许**。本条的基线是**事前**对照 ⇒ 不违反该裁定，但须在报告里写明这个区别。

## Plan

1. **阶段一（测量，⛔ 不写任何生产机制）**：在现有语料上量出确定性 vs flaky 的构成。做法：对 145 轮 B 类的每个失败文件，取其在 `verification-round.jsonl` 的 `perFile` 时间序列，判断该失败是否呈**连续窗口内近 100%**（确定性：窗口内每一轮碰它的任务都失败）还是**零散低率**（flaky）。产出构成表与各自的受害任务数。
2. **阶段二（判决点）**：若确定性子集的受害任务数**不足以偿付**一个常设基线轮的成本（基线轮要占同一把 S=1 槽，`lock_wait` p90 已 776s）⇒ **结案为「不建」并保留测量结果**，⛔ 不得因为机制听起来合理就建。
3. **阶段三（仅当阶段二判决为建）**：实现 develop-tip 基线轮 + 按 sha 差分归因：
   - 基线：独立于任何任务在 **develop tip** 跑全量 suite，失败集合落盘（`runId` 前缀 `base-`，沿用既有 `mfi-` 规约）
   - 差分：基线中已有 ⇒ `develop-side`（不计 retry cap、不挡着地、**按失败文件**去重立案）；基线中没有 ⇒ `own-delta`（照现状挡）
   - **调度：只在槽空闲时日和见地跑**，⛔ 不与在飞 fan-in 抢槽
   - 与 `judgeRetryExemption` 的接法必须明确：是替换其触发条件，还是并列成为第四态输入（⛔ 不得两套判定各说各话）

## Acceptance Criteria

- [ ] AC1（阶段一的测量·本任务的第一交付物，⛔ 非布尔）：产出确定性 vs flaky 构成表：对 145 轮 B 类涉及的 153 个失败文件逐个分类为 `deterministic` / `flaky` / `insufficient`（三态，⛔ 不得二值化），每类给出**文件数**与**受害任务数**，并对 `deterministic` 类逐条列出（文件 / 窗口起止 / 该窗口内受害任务数）。判据：三类计数之和 == 153，且表落进读数段。⚠️ 若某文件 runs 过少无法判 ⇒ 记 `insufficient`，⛔ 不得归入任一实类。
- [ ] AC2（谓词双向自检，可取假·⚠️ 硬规则 2 的两半）：分类谓词必须双向验过——①**非零侧**：把判为 `deterministic` 的前 3 条的**实际时间序列**贴进读数段，人可核它确实是近 100%；②**零侧**：若 `deterministic` 计数为 0，必须把该谓词对着一个**已知为真的样本**干跑一次（例：`gap-suite-fix-red-baseline-2026-08-16` 所修的那次 develop 基线红所在窗口），证明谓词能命中它。判据：两侧证据齐备。⛔ 取假形态：零计数且拿不出正样本命中 ⇒ 该计数不可用（零计数可能来自谓词不命中任何东西，而非真的没有）。
- [ ] AC3（判决点显式，⛔ 不得跳过）：读数段必须写出阶段二的判决与依据，形如「确定性子集 = N 个文件 / M 个受害任务；一个常设基线轮的成本 = 每轮约 260s 占用 S=1 槽 + X 次/天 ⇒ 建 / 不建，理由……」。判据：该段存在且含 N、M 与成本估算。⛔ 取假形态：直接进入阶段三而没有这段 ⇒ 未达成（硬规则 4：成本结构未知前不设数值阈值；硬规则 12：给不出发生率的前置不得阻塞，反之给不出发生率的**机制**也不该建）。
- [ ] AC4（⚠️ 仅当判决为「建」时适用，否则记 not-evaluated）（基线载体有生产读数·读产物）：落地后窗口内，基线载体含 ≥3 条**实现落地之后**产生的记录，每条带 `developSha` `failingFiles[]` `startedAt` `tests`。⛔ 取假形态：零条 ⇒ 未达成（硬规则 4 推论三：只能被注入数据满足的判据不是测量）。
- [ ] AC5（⚠️ 仅当判决为「建」时适用，否则记 not-evaluated）（差分有区分力·双向，可取假）：两个可控情形各一次实测——①一个**已在基线中红**的文件在某任务 fan-in 时再红 ⇒ `attribution:"develop-side"` ∧ 不计入该任务 retry cap ∧ 未挡着地；②一个**基线绿**的文件因该 delta 而红 ⇒ `attribution:"own-delta"` ∧ 照挡。判据：两条记录 attribution **相反**且后续动作**相反**。⛔ 取假形态：两情形同一取值或同一动作 ⇒ 对照无区分力、判据空转。
- [ ] AC6（⚠️ 仅当判决为「建」时适用）（⛔ 缺行 ≠ 绿）：静默看门狗杀死的轮**在 `verification-round.jsonl` 里一行都不写**（本窗口实证 9 次，只在 `.quay/fan-in-step-trace.jsonl` 可见）⇒ 差分器读不到行时**必须**给出 `NOT-EVALUATED` 的独立取值，⛔ 不得据「基线里没有这个失败」推出 `own-delta`（那会把一次**没评估**变成一次**归罪**）。判据：构造一个「基线轮被看门狗杀死」的情形，差分器输出 `NOT-EVALUATED` 而非任何 attribution。
- [ ] AC7（⚠️ 仅当判决为「建」时适用）（陈腐度显式 + 不抢锁，可取假）：①每条差分判定带 `baselineSha` 与 `baselineAgeCommits`，超阈值时降级为 `NOT-EVALUATED` 而非照用；②基线轮记录的持槽区间与任何 `mfi-` 轮的持槽区间**重叠数 = 0**。⛔ 取假形态：出现重叠 ⇒ 未达成（会直接抬高 `lock_wait` p90，把本任务变成净损失）。
- [ ] AC8（范围自律，可取假）：读数段必须显式声明本条**不覆盖 flaky 归因**，并指明 flaky 类的归属机制（`judgeRetryExemption` 的回溯豁免 + 负载敏感测试的类级 seam 收口任务）。判据：该声明存在。⛔ 取假形态：报告中出现「本机制解决了跨任务 flaky 误归因」这类主张 ⇒ 未达成（读数三的算术已否决它）。

## Definition of Done

- **阶段一的构成表 + 阶段二的判决**落地（这是本任务的**最小交付物**）。
- ⛔ **若判决为「不建」⇒ 保留测量结果、结案，同样算完成**，AC4–AC7 记 `not-evaluated`。本任务交付的是**一个有依据的决定**，不是基线轮这个实现。
- 若判决为「建」：基线轮 + 差分归因落地，纯函数部分有单测；基线载体含落地后的真实生产记录；AC5 的双向对照读数落盘；与 `judgeRetryExemption` 的接法在读数段写明（替换触发条件 / 并列第四态）。
- ⛔ 本条**不改** `judgeRetryExemption` 的既有语义（只为它补机械证据或并列输入）；若需改其语义 ⇒ 另立案。
- ⚠️ **Touches 补充义务**：阶段三若实施，涉及的实现文件（基线轮脚本、差分器、`worker-driver.ts` 接点）必须在提交前追加进本任务 `## Touches`——fan-in 的 anti-drift 是 HARD-FAIL 步，提交了未声明的文件即红。阶段一只产出读数，不改生产文件。

## Touches

- tasks/gap-fan-in-suite-red-attribution-has-no-control-measure-first.md
