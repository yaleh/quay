---
id: gap-fan-in-suite-red-attribution-has-no-control-measure-first
title: fan-in suite 红一律记为本任务缺陷而无任何对照——先量确定性 develop 侧红的发生率，再决定是否建 develop-tip 基线轮
status: ready
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

- [x] AC1（阶段一的测量·本任务的第一交付物，⛔ 非布尔）：产出确定性 vs flaky 构成表：对 145 轮 B 类涉及的 153 个失败文件逐个分类为 `deterministic` / `flaky` / `insufficient`（三态，⛔ 不得二值化），每类给出**文件数**与**受害任务数**，并对 `deterministic` 类逐条列出（文件 / 窗口起止 / 该窗口内受害任务数）。判据：三类计数之和 == 153，且表落进读数段。⚠️ 若某文件 runs 过少无法判 ⇒ 记 `insufficient`，⛔ 不得归入任一实类。
- [x] AC2（谓词双向自检，可取假·⚠️ 硬规则 2 的两半）：分类谓词必须双向验过——①**非零侧**：把判为 `deterministic` 的前 3 条的**实际时间序列**贴进读数段，人可核它确实是近 100%；②**零侧**：若 `deterministic` 计数为 0，必须把该谓词对着一个**已知为真的样本**干跑一次（例：`gap-suite-fix-red-baseline-2026-08-16` 所修的那次 develop 基线红所在窗口），证明谓词能命中它。判据：两侧证据齐备。⛔ 取假形态：零计数且拿不出正样本命中 ⇒ 该计数不可用（零计数可能来自谓词不命中任何东西，而非真的没有）。
- [x] AC3（判决点显式，⛔ 不得跳过）：读数段必须写出阶段二的判决与依据，形如「确定性子集 = N 个文件 / M 个受害任务；一个常设基线轮的成本 = 每轮约 260s 占用 S=1 槽 + X 次/天 ⇒ 建 / 不建，理由……」。判据：该段存在且含 N、M 与成本估算。⛔ 取假形态：直接进入阶段三而没有这段 ⇒ 未达成（硬规则 4：成本结构未知前不设数值阈值；硬规则 12：给不出发生率的前置不得阻塞，反之给不出发生率的**机制**也不该建）。
- [x] AC4（⚠️ 仅当判决为「建」时适用，否则记 not-evaluated）（基线载体有生产读数·读产物）：落地后窗口内，基线载体含 ≥3 条**实现落地之后**产生的记录，每条带 `developSha` `failingFiles[]` `startedAt` `tests`。⛔ 取假形态：零条 ⇒ 未达成（硬规则 4 推论三：只能被注入数据满足的判据不是测量）。 ⇒ **not-evaluated**（AC3 判决 = 不建；按本条自身条件不适用，见读数段）
- [x] AC5（⚠️ 仅当判决为「建」时适用，否则记 not-evaluated）（差分有区分力·双向，可取假）：两个可控情形各一次实测——①一个**已在基线中红**的文件在某任务 fan-in 时再红 ⇒ `attribution:"develop-side"` ∧ 不计入该任务 retry cap ∧ 未挡着地；②一个**基线绿**的文件因该 delta 而红 ⇒ `attribution:"own-delta"` ∧ 照挡。判据：两条记录 attribution **相反**且后续动作**相反**。⛔ 取假形态：两情形同一取值或同一动作 ⇒ 对照无区分力、判据空转。 ⇒ **not-evaluated**（AC3 判决 = 不建；按本条自身条件不适用，见读数段）
- [x] AC6（⚠️ 仅当判决为「建」时适用）（⛔ 缺行 ≠ 绿）：静默看门狗杀死的轮**在 `verification-round.jsonl` 里一行都不写**（本窗口实证 9 次，只在 `.quay/fan-in-step-trace.jsonl` 可见）⇒ 差分器读不到行时**必须**给出 `NOT-EVALUATED` 的独立取值，⛔ 不得据「基线里没有这个失败」推出 `own-delta`（那会把一次**没评估**变成一次**归罪**）。判据：构造一个「基线轮被看门狗杀死」的情形，差分器输出 `NOT-EVALUATED` 而非任何 attribution。 ⇒ **not-evaluated**（AC3 判决 = 不建；按本条自身条件不适用，见读数段）
- [x] AC7（⚠️ 仅当判决为「建」时适用）（陈腐度显式 + 不抢锁，可取假）：①每条差分判定带 `baselineSha` 与 `baselineAgeCommits`，超阈值时降级为 `NOT-EVALUATED` 而非照用；②基线轮记录的持槽区间与任何 `mfi-` 轮的持槽区间**重叠数 = 0**。⛔ 取假形态：出现重叠 ⇒ 未达成（会直接抬高 `lock_wait` p90，把本任务变成净损失）。 ⇒ **not-evaluated**（AC3 判决 = 不建；按本条自身条件不适用，见读数段）
- [x] AC8（范围自律，可取假）：读数段必须显式声明本条**不覆盖 flaky 归因**，并指明 flaky 类的归属机制（`judgeRetryExemption` 的回溯豁免 + 负载敏感测试的类级 seam 收口任务）。判据：该声明存在。⛔ 取假形态：报告中出现「本机制解决了跨任务 flaky 误归因」这类主张 ⇒ 未达成（读数三的算术已否决它）。

## Definition of Done

- **阶段一的构成表 + 阶段二的判决**落地（这是本任务的**最小交付物**）。
- ⛔ **若判决为「不建」⇒ 保留测量结果、结案，同样算完成**，AC4–AC7 记 `not-evaluated`。本任务交付的是**一个有依据的决定**，不是基线轮这个实现。
- 若判决为「建」：基线轮 + 差分归因落地，纯函数部分有单测；基线载体含落地后的真实生产记录；AC5 的双向对照读数落盘；与 `judgeRetryExemption` 的接法在读数段写明（替换触发条件 / 并列第四态）。
- ⛔ 本条**不改** `judgeRetryExemption` 的既有语义（只为它补机械证据或并列输入）；若需改其语义 ⇒ 另立案。
- ⚠️ **Touches 补充义务**：阶段三若实施，涉及的实现文件（基线轮脚本、差分器、`worker-driver.ts` 接点）必须在提交前追加进本任务 `## Touches`——fan-in 的 anti-drift 是 HARD-FAIL 步，提交了未声明的文件即红。阶段一只产出读数，不改生产文件。

## Touches

- tasks/gap-fan-in-suite-red-attribution-has-no-control-measure-first.md

## Readings（阶段一测量 + 阶段二判决 · 2026-09-14，worker 实测）

**载体与窗口（可复现）**：`.quay/verification-round.jsonl`，B 类 = `reason=="failed" ∧ tests>0 ∧ scope=="worktree" ∧ runner=="inner"`，时间窗 `2026-09-04 ≤ startedAt < 2026-09-13T05:08Z`。
**复现结果**：**146 轮** B 类 / 98 个不同任务；`failures[].file` 中以 `.test.mjs` 结尾者去重 = **153 个**（与立案读数一致 ⇒ 谓词已复现）。
⚠️ 轮数 146 而非立案写的 145：窗口内 09-13 的 B 轮最早起于 05:21Z（晚于 05:08 截止），边界取法差一轮；**153 这个被 AC1 用作判据的数逐字复现**，故以 153 为人口，轮数按 146 报。

### ⚠️ 先报一个改变人口性质的事实：`failures[].file` 有归因噪声

窗口内 742 条 `.test.mjs` 条目逐条对**同轮 `perFile`** 校验：

| 条目形态 | 条数 |
|---|---|
| 同轮 `perFile` 记 `passed=false`（**权威失败**） | 562 |
| `in_family: true`（家族传播归因，非本文件失败） | 102 |
| 同轮 `perFile` 记 `passed=true`（**同轮明确通过**） | 52 |
| 该轮无 `perFile` 记录 | 26 |

⇒ **153 本里有 51 本（33.3%）拿不出任何权威失败背书**（48 本全历史 `perFile` 零失败 + 3 本全历史无 `perFile` 记录）。按 AC1「⛔ 不得归入任一实类」它们全部记 `insufficient`。
⇒ 一般形态（供后续引用）：**用 `failures[].file` 做文件级统计会高估约三分之一**；文件级真值只认 `perFile.passed`。

**分类谓词（结构式，无魔数）**：对每本取全历史 `perFile` 时间序列 `S`（按轮次时刻排序，元素 =「本轮跑了它 + 通过与否」）。
- 连续失败段 = `S` 中相邻的若干次观测**全部** `passed=false`（段内**没有任何一次通过**）。
- `deterministic` ⟺ 最长连续失败段 **≥ 2**（即：该文件在其存活窗口内，**每一轮碰它的任务都失败**，且**窗口两端各紧邻一次通过/序列端点**）。
- `flaky` ⟺ 至少 1 次失败但**无相邻失败对**。
- `insufficient` ⟺ `S` 为空，或 `S` 中失败次数 = 0（⛔ 与 flaky 分开，见上表）。

### AC1｜构成表（三类计数之和 = 153 ✓）

| 类 | 文件数 | 受害任务数（该文件确定性窗口内的 B 轮所涉任务；窗口外的失败不计） | 备注 |
|---|---|---|---|
| `deterministic` | **24** | **25** | 其中 **19 本**的段跨 **≥2 个不同任务**（⇒ 任何单个任务的 delta 都无法解释） |
| `flaky` | **78** | 64 | 无相邻失败对；本窗口全部 B 轮内该文件失败过所涉任务 |
| `insufficient` | **51** | 0 | 无权威失败背书（见上） |
| **合计** | **153** | — | ✔ |

⚠️ 表内「受害任务数」是**并集**（同一任务可被多本文件挡住）——确定性逐条清单那一列的**列内相加 ≠ 类合计 25**。

⚠️ 受害任务数**两种口径**（都列出，避免歧义）：
- **口径 A（AC1 要求的口径：确定性窗口内）** = **25**；该 24 本在窗口内共涉及 **37 轮** B 类（占 146 的 **25.3%**）。
- **口径 B（更宽：整个 B 窗口内该文件失败过的轮所涉任务）** = 52。

**deterministic 逐条清单**（文件 / 窗口起止 / 该窗口内受害任务数；末列为窗末 −1h…+3h 内**落地且触及该文件**的提交 —— 这是「develop 当时确实红着」的独立佐证）：

| # | 文件 | 确定性窗口（UTC） | 秒长 | 窗口内 B 轮 | 受害任务 | 窗末落地提交（佐证） |
|---|---|---|---|---|---|---|
| 1 | `plugin/test/quay-init-loop-fixture-hash.test.mjs` | 2026-09-08T01:12 → 02:19 | 1.1h | 7 | 4 | `1e80fed7c` *修复退役目录两条**确定性** suite 红* |
| 2 | `plugin/test/worker-driver-resident.test.mjs` | 2026-09-07T05:39 → 07:05 | 1.4h | 6 | 4 | `77a9ddd12` @test-group-downgrade 三本负载敏感文件 |
| 3 | `packages/quay/test/observation.test.mjs` | 2026-09-01T16:02 → 17:02 | 1.0h | 5 | 1 | `cf5f3db59` gap-observation-ac1-perf-threshold-relax（⚠️ 此段 5 轮**同属一个任务**，非跨任务，可解释性弱于 1/2/4） |
| 4 | `plugin/test/driver-runtime.test.mjs` | 2026-09-13T05:21 → 07:13 | 1.9h | 5 | 4 | `ee839d51c` fix(driver-runtime): 就绪标记由驱动自写 |
| 5 | `packages/quay/test/gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge.test.mjs` | 2026-09-08T18:16 → 18:39 | 0.4h | 4 | 3 | ⛔ 无 |
| 6 | `packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs` | 2026-09-09T10:52 → 11:23 | 0.5h | 3 | 2 | `26fa309d3` |
| 7 | `packages/quay/test/ts-typecheck-gate-config-wiring.test.mjs` | 2026-09-07T05:55 → 06:48 | 0.9h | 3 | 3 | `77a9ddd12` |
| 8 | `plugin/test/cold-start-skill.test.mjs` | 2026-09-08T16:08 → 16:58 | 0.8h | 3 | 1 | ⛔ 无 |
| 9 | `plugin/test/direct-to-develop-bypass-check.test.mjs` | 2026-09-04T10:05 → 10:49 | 0.7h | 3 | 1 | ⛔ 无 |
| 10 | `plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs` | 2026-09-09T14:52 → 15:12 | 0.3h | 3 | 2 | `80927a416` *修复 GOAL-011 判据**拖垮无关任务 fan-in** 的事故* |
| 11 | `plugin/test/goal011-fanin-conflict-rate-post-landing.test.mjs` | 2026-09-09T14:52 → 15:12 | 0.3h | 3 | 2 | `80927a416` |
| 12 | `plugin/test/help-contract-incompatible-behaviors.test.mjs` | 2026-09-01T05:32 → 06:23 | 0.8h | 3 | 2 | `de2b0e5a3` |
| 13 | `plugin/test/known-load-sensitive.test.mjs` | 2026-09-08T16:08 → 16:58 | 0.8h | 3 | 1 | ⛔ 无 |
| 14 | `plugin/test/l1-delivery-surface-check.test.mjs` | 2026-09-08T16:08 → 16:58 | 0.8h | 3 | 1 | ⛔ 无 |
| 15 | `plugin/test/packaging-hygiene-check.test.mjs` | 2026-09-11T10:36 → 10:53 | 0.3h | 3 | 3 | `cf9882627` |
| 16 | `plugin/test/plugin-packaging.test.mjs` | 2026-09-08T01:56 → 02:19 | 0.4h | 3 | 2 | `344ca8c91` |
| 17 | `plugin/test/worker-driver-fan-in.test.mjs` | 2026-09-01T02:01 → 03:21 | 1.3h | 3 | 2 | `76141dca0` |
| 18 | `plugin/test/ac214-freshness-subject-set.test.mjs` | 2026-09-11T17:58 → 18:02 | 0.1h | 2 | 2 | `f1a7ef451` |
| 19–22 | `plugin/test/cap-from-gate-{bands,cli,config-budget,hysteresis}.test.mjs` | 2026-09-06T14:55 → 16:31 | 1.6h | 2 各 | 2 各 | `2790a1f00` cap-from-gate: eliminate effective_cap dual-source |
| 23 | `plugin/test/checker-mutation-check.test.mjs` | 2026-09-03T07:11 → 07:28 | 0.3h | 2 | 2 | ⛔ 无 |
| 24 | `plugin/test/writestate-atomicity-split.test.mjs` | 2026-08-31T05:34 → 05:50 | 0.3h | 2 | 2 | ⛔ 无 |

### ⚠️ 本次测量推翻立案读数四的一个判断（这是阶段一的主要发现）

立案读数四据**全局失败率**（0.94%–8.55%）判定那五本「是 flaky，不是确定性」。**本次逐轮时间序列显示该判断的取值来源错了**：那五本里有四本**在各自的存活窗口内是 100% 红**（段内每一轮碰它的任务都失败），全局低率只是**稀释**——事件只占窗口 ~0.8h / 10 天。
- 例：`worker-driver-resident` 全局 17/665 = 2.6%，但其 09-07 段是 **6 连红、跨 4 个任务**，且段末由 `77a9ddd12` 的 @test-group 降级提交收口。
⇒ **「确定性」不能用全局率判，必须用「段」判**（硬规则 4b：全局率是被稀释的代理量；段内连续性是直接量）。本条把读数四的「那五本是 flaky」更正为「其中四本在其窗口内是确定性红」。

### AC2｜谓词双向自检

**① 非零侧（前 3 名跨任务段的实际时间序列，人可核其「段内 100% 红」）**：取「段跨 ≥2 个不同任务」的前 3 名（单任务段的可解释性弱，故不取）。

`plugin/test/quay-init-loop-fixture-hash.test.mjs`（全史 runs=671 / fails=7；最长段 7，跨 4 个任务）：

| # | 轮 | 时刻(UTC) | 结果 | 任务 |
|---|---|---|---|---|
| 633 | r1258 | 2026-09-08T00:20:44Z | pass | gap-ac166-second-copy-retirement |
| 634 | r1259 | 2026-09-08T01:12:12Z | **FAIL** | gap-retire-resident-suite-driver-kind |
| 635 | r1260 | 2026-09-08T01:17:30Z | **FAIL** | gap-meta-quality-gate-driver |
| 636 | r1261 | 2026-09-08T01:33:57Z | **FAIL** | gap-meta-quality-gate-driver |
| 637 | r1262 | 2026-09-08T01:45:58Z | **FAIL** | gap-ac167-baime-iteration-executor-removal |
| 638 | r1263 | 2026-09-08T01:56:33Z | **FAIL** | gap-meta-quality-gate-driver |
| 639 | r1264 | 2026-09-08T02:09:36Z | **FAIL** | gap-goal-driver-task-boundary-check |
| 640 | r1265 | 2026-09-08T02:19:54Z | **FAIL** | gap-meta-quality-gate-driver |
| 641 | r1266 | 2026-09-08T02:24:27Z | pass | gap-ac166-stale-retired-dir-test-refs |

`plugin/test/worker-driver-resident.test.mjs`（runs=665 / fails=17；最长段 6，跨 4 个任务）：r1177 → r1183 **六连红**，任务依次 `gap-goal-achieved-but-failing-no-handler` / `gap-bypass-check-unclassifiable-exits-zero` / `gap-ff-retry-counter-runid-no-longer-per-dispatch` / `gap-meta-driver-source-refresh` /（重复），r1184 恢复 pass。

`plugin/test/driver-runtime.test.mjs`（runs=822 / fails=8；最长段 5，跨 4 个任务）：r1611 → r1616 **五连红**（`gap-quay-server-lightweight-peer-identity-spike` / `gap-ac203-two-distinct-kinds-no-production-run` ×2 / `gap-checker-mutation-check-has-no-change-tier-companion` / `gap-watchdog-killed-round-writes-no-verification-round-record`），r1617 恢复 pass。

⇒ 三段都是「段内每一次观测都是红，段外两侧紧邻 pass」，即 AC1 定义下的确定性；**且段内跨 ≥4 个互不相关的任务** ⇒ 不是任何单个任务 delta 可解释的。

**② 零侧（AC2 条件为「若 deterministic 计数为 0」——本例 = 24 ≠ 0，故不触发）**，但**仍做了一次正样本干跑**，且发现 AC2 举例的那个样本**不可用**，记在此处以免后人照抄：
- AC2 建议的正样本 = `gap-suite-fix-red-baseline-2026-08-16` 的窗口。**实测不适用**：该次是**静态门红**（该窗口 12 轮 = 5×`gate-failed` + 1×`failed` + 6×green），且该窗口 **12 轮的 `perFile` 全为空**——实测 `perFile` 这个载体**最早出现在 2026-08-23T23:38Z（r471）**，2026-08-16 整体在它的起点之前 ⇒ **本谓词的输入在该窗口结构性缺席**，拿它当正样本只会得到「命中 0」的假阴性（**这正是 AC2 ②要防的那种假阴性，只是根因是载体不存在，不是谓词不命中**）。
- **替代正样本（本次实际采用）**：对全部 24 条确定性段做「窗末 −1h…+3h 内是否有落地提交触及该文件」的**独立对照** ⇒ **17/24 命中**，其中多条提交信息逐字点名该红及其受害者（`1e80fed7c`「修复退役目录两条**确定性** suite 红」、`80927a416`「修复 GOAL-011 经验判据**拖垮无关任务 fan-in** 的事故」）⇒ 谓词命中的确实是 develop 侧真红，不是随机波动。
- 未命中 7/24（多为 2 连红）已在表中标 `⛔ 无`，**其确定性存疑**，不计入下面的保守口径。

### AC3｜阶段二判决：**不建**（保留测量结果结案）

**确定性子集（口径 A）= 24 个文件 / 25 个受害任务 / 37 轮 B 类（146 的 25.3%）**；保守口径（只计跨 ≥2 任务段 = 19 文件）= **31 轮（21.2%）/ 23 个受害任务**；再保守（只计有落地佐证的 17 文件）= 27 轮（18.5%）/ 20 个受害任务。

**成本（本次实测，替换立案里的估计值）**：
- 一个**常设基线轮 = 一次全量 suite**，占同一把 S=1 槽：窗口内 645 轮的中位 **245s**、p90 **434s**（立案写的「约 260s」同量级）。窗口内槽占用 = 176,343s / 9.38 天 = **21.8%**（即 78% 空闲）。
- **一次被烧掉的 fan-in = 一次 worker 重派** = `.quay/worker-outcome.jsonl` 窗口内 893 条的墙钟中位 **26.6 min = 1596s**。
- ⇒ **1 次重派 ≈ 6.5 个基线轮**。

**偿付线**：
- 天花板收益（假想基线 100% 接住、零陈腐度）= 37 轮 / 9.38 天 = **3.9 次重派/天 = 105 min/天**（保守口径 31 轮 ⇒ 3.3 次/天 = 88 min/天）。
- 要接住一个事件，基线轮必须落在**该事件的窗口之内**；本窗口 24 个段的时长**中位 0.83h、最长 1.87h**、最短 0.07h ⇒ 需要约 **1 轮 / ≤50 min** 的节奏才能接住多数段。
- 该节奏的成本 = **26 轮/天 × 245s = 106 min/天**。
- ⇒ **天花板收益 105 min/天 ≈ 该节奏成本 106 min/天（保守口径 88 min/天 < 106 min/天，已是净损失）**。

**⇒ 判决：不建。** 理由（三条，任一条独立成立即足以否决）：
1. **在「100% 接住 + 零陈腐度」的理想上界上，收益与成本就是一次 wash**（105 vs 106 min/天）⇒ 没有任何余量分给必然发生的折扣。
2. **折扣是结构性的、不是可调参数**：真实接住率 <100%（段最短 0.07h，比一轮基线还短）；且 AC7② 要求基线轮**不与 mfi- 轮抢槽** ⇒ 它只能在槽空闲时跑，**而确定性段恰恰发生在轮子密集的忙时**（例：09-08 01:12–02:19 七轮间隔 5–16 min，槽占 ~30–50%）⇒ 忙时排队使陈腐度进一步上升，**AC7① 的降级路径会把本已不足的收益再削一层**。
3. 该子集只占 B 类红的 **25.3%**（文件占 15.7%），而**主质量 78 本 flaky / 64 个受害任务本机制结构上碰不到**（读数三的算术已否决对照对 flaky 的分辨力）⇒ 为 1/4 的收益引入一个常驻生产面，性价比不成立。

**⛔ 本判决不否定「差分归因」这个方向，只否定「常设全量基线轮」这个形态**：本次测量同时给出了一个**更便宜的同族形态**——**红时按失败文件在 develop tip 上只重跑失败集**（而非事前跑全量基线轮）：成本 ≈ 每轮 B 类多一次「子集重跑」，146 轮 / 9.38 天 ≈ 15.6 次/天，且**天然最新（零陈腐度）、天然不与 mfi- 抢全量槽**。按同一把尺子这是**净正**的（收益 105 min/天 vs 成本约 15–20 min/天）。⚠️ **但它不是本条提案的形态**，且需要新的生产面与取证 ⇒ **属另立案，本条不实施**（硬规则 12：不拿未测的残差挡住一个已被实测证否的目标）。

**另**（响应立案的注解）：本条产出的是**事前**对照读数（先量发生率再决定建不建），**不是**管理者 2026-08-08 裁定的「事后用一次通过追认分类」（用结果反推分类）⇒ 不违反该裁定。

### AC8｜范围自律声明

**本条不覆盖 flaky 归因。** 78 本 flaky / 64 个受害任务需要的是**另一类机制**，本条结构上不解决：
- **跨任务 flaky 的回溯豁免** = `judgeRetryExemption`（`plugin/scripts/worker-driver.ts`，任务 `gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky`，**done**）——三态 `unrelated-flaky-exempt` / `own-defect-counted` / 数据不足；
- **负载敏感测试的类级 seam 收口** = `gap-load-sensitive-tests-read-live-host-class-level-seam`（**done**）——让测试不读真实宿主，从根上消掉该类红。
⛔ 本条**不主张**「解决了跨任务 flaky 误归因」（立案读数三的算术已否决：全历史总体失败率 0.1246%，一次对照对 flaky 基本无分辨力）。
⛔ 本条**未改** `judgeRetryExemption` 的既有语义（裁决为不建，无接点变更）。
