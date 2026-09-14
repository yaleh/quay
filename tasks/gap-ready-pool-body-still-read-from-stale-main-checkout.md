---
id: gap-ready-pool-body-still-read-from-stale-main-checkout
title: 闸的 task body 仍从主检出磁盘读（status 那一维早已改读 develop 权威 ref）——propagate 失败时闸连读旧体烧满重试
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**已确证一例(2026-09-14 manager 复核,读生产载体 + 历史重放,非猜测)**:`gap-rework-multiplier-predictors` 被翻 needs-human 的真正原因不是立案质量,而是**闸连续三轮读到了过期的任务体**。

| 时刻 | 事件 |
|---|---|
| 04:47:15Z | 立案 `c21a93310`,`## Touches` 的 3 个新文件未标 `(new)` |
| ~05:00Z round185 | 闸判 `missing:["touchesResolve=false"]` ⇒ 派 fix worker ⇒ 超时 ⇒ 烧第 1 次重试 |
| **05:05:16Z** | **`c6ebc6c5b` 补上 `(new)` 标注——修复已完成** |
| 05:05:17Z | `.quay/store-commit-propagation.jsonl` 记该次 task_write **`propagated:false`**、`branchClass:"other"` |
| ~05:09Z round188 | 闸**仍**判 `touchesResolve=false` ⇒ 再派 ⇒ 超时 ⇒ 第 2 次 |
| ~05:12Z round189 | 闸**仍**判 `touchesResolve=false` ⇒ 再派 ⇒ 超时 ⇒ 第 3 次 ⇒ **翻 needs-human** |

**区分性对照(历史重放,硬规则 4 推论四)**:把两个历史版本的 body 喂进**同一个** `checkTaskTouchesResolve`、**同一个** root:
```
立案版 c21a93310（无 (new)）=> mustExist:5 missing:3 majorityMissing:true  ⇒ touchesResolve=false
修复版 c6ebc6c5b（有 (new)）=> mustExist:2 missing:0 majorityMissing:false ⇒ touchesResolve=true
```
⇒ 修复版**结构上就能过闸**。若「闸读的是最新 body」为真,round188/189 的读数应与重放一致;实测不一致 ⇒ **该前提为假,它们读到的不是修复版**。

**成因落在代码自己的注释上**:`ready-pool-check.ts:2315` 用 `fs.readdirSync(tasksDir)` 从**主检出磁盘**构建 `allTasks`,`:2442` 的 `checkTaskTouchesResolve(task.body, root)` 等 body 维度判定全部消费它。而**同一文件 `:1913` 的注释已写明这是「硬规则 4b 的陈旧代理量」**,并说明 **status 那一维早已改读 canonical develop ref**(`readTaskStatusAtRef`,由 `gap-ready-pool-depends-on-status-stale-read` / `gap-dispatch-reads-stale-main-checkout-task-status` 一族修过)。
⇒ **硬规则 5b 的标准形态:同一个原则只落实到了被报出来的那一维(status),body 这一维漏了。** 而 body 恰恰驱动 `touchesResolve` / `fourArtifacts` / `touchesNarrow` / `selfTouch` 四个晋升判据。

**⚠️ 发生率已测,且它【不支持】大动读源(硬规则 12,立案当轮给出,⛔ 不推给 AC)**:
- `.quay/store-commit-propagation.jsonl` 全量 **592** 条,`propagated:false` **71** 条(**12%**),涉及 **56** 个唯一 task;最近一次 2026-09-14T10:05:40Z ⇒ **前置条件很常见且仍在发生**。
- **但交叉表显示它几乎从不致命**:27 次 needs-human 翻转中,翻转前 60 分钟内该任务有过 `propagated:false` 的**只有 1 次(4%)**——就是本条。
- **负控制**:propagate 失败涉及的 **56 个任务里,最终被翻 needs-human 的只有 1 个**。
⇒ **机制为真、影响面实测 = 1 例。** 因此本任务**刻意取窄范围**:先把那条痕迹接进可观测/可判定,⛔ 不在这一轮改 body 读源。
⚠️ 上述交叉表只能抓到「同一 task 在翻转前 1 小时内有 propagate 失败记录」的形态;若陈旧来自别的路径(例如提交落在某个 worktree 而根本没产生 propagation 记录),它抓不到 ⇒ **1/27 是下界,不是真值**(硬规则 5 来源完备性)。

**第二个半边:`propagated:false` 有人写、没人读。** 落痕机制本身工作正常(由 `gap-doc-develop-sync-semantic-conflict-resolution` 修好),但**没有任何判据消费这条痕迹** ⇒ 一次失败的 propagate 可以静默地让闸连续几轮用旧 body 判定。

## Plan

1. **先做窄的一半(本轮范围)**:让 `propagated:false` 被消费——propagate 失败后须有一个**能取假**的后续动作。最低限度:让闸对该 task 报**「未评估」而非照旧用旧 body 判定**(三态可区分,硬规则 3b);或接一次重试/升级语义兜底。
2. **宽的一半只在证据到位后才做(⛔ 本轮不做)**:把 body 维度改到与 status 同一个权威读源。触发条件 = 上面那张交叉表的命中数**超过 1**(即出现第二个独立案例),或步骤 1 的「未评估」态在生产上被触发超过 N 次(N 由步骤 1 的读数定,⛔ 不预设数字)。
3. ⚠️ **步骤 2 有一个反向陷阱,动手前必须先取读数**:闸改读 develop ref 后,**「刚在主检出写下、尚未 propagate 的合法新任务」会不会被读成不存在**?(写面保留 author 是人 2026-08-31 的裁定 ⇒ 这种任务是常态,不是边角。)给不出这个反向案例的读数 ⇒ **不得改读源**。
4. 若步骤 2 最终要做,须覆盖 **四个维度而非一维**(`touchesResolve` / `fourArtifacts` / `touchesNarrow` / `selfTouch`)——硬规则 5b,这正是本缺陷的成因,⛔ 不要用同一个错误去修这个错误。

## Acceptance Criteria

- [x] **能取假的复现**:构造一个 body 在主检出与 develop 不一致的对象,闸对它某个 body 维度的判定**随读源不同而不同**;**负控制**:两侧一致时两种读源给出**相同**判定。两次读数都贴进 `## Resolution`。
- [x] **痕迹被消费(步骤 1)**:存在一条能取假的判据,证明 `propagated:false` 已接进某个动作,且输出词表里有**独立的「未评估」取值**(⛔ 不与「合格」同形——硬规则 3b)。判据:人为制造一次 propagate 失败后,闸对该 task 的输出与正常态**可区分**。
- [x] **范围纪律写进产物**:`## Resolution` 里写明本轮**没有**改 body 读源、以及触发宽修法的条件(交叉表命中数 > 1),⛔ 不得顺手扩大到步骤 2。
- [x] **反向陷阱已验(仅当本轮真要动读源时才需)**:若实现者判断必须提前做步骤 2,则 Plan 步骤 3 的反向案例读数必须先贴进 `## Resolution`;不做步骤 2 则本条记 N/A 并写明理由(⛔ 不静默跳过)。
- [ ] `bash scripts/test.sh --for-task gap-ready-pool-body-still-read-from-stale-main-checkout` 全绿,新增用例在该轮**被实际选中执行**(按测试名核对,不看总数)。

## Definition of Done

`propagated:false` 不再是一条无人消费的痕迹——闸在读源可能陈旧时给出**可区分的第三态**,而不是拿旧 body 照判;范围纪律(本轮不改读源、宽修法的触发条件)写在产物里。⛔「把 body 读源改了」不是本轮的达成条件,反而**超范围**;⛔「单测绿了」不算——AC1/AC2 的读数须来自真实可区分的对照。

## Resolution

**读源方向与立案描述相反(实证,非推断)——这一条改变了修法的落点。**

立案把陈旧源写成「主检出磁盘读(`fs.readdirSync` 构建 allTasks)」。实测:那个 `readdirSync` 构建的是
`analyzeTasks` 的 `fileNames`(**id 清单**,它确实来自磁盘),而 body 本身走的是
`taskReadRef` ⇒ `loadParsedTaskStoreAtRef(root, taskReadRef, ids)`,**全部维度(含 body)从 git ref 读**。
生产两处调用点都传了 ref:
- `promotion-driver` spawn 的 `ready-pool-check --apply`(CLI 末段:`apply ? applyPromotions({...base, taskReadRef: develop}) : analyzeTasks({...base, taskReadRef: develop})`);
- `slot-refill` 的 `analyzeTasks({..., taskReadRef })`(默认 `"develop"`)。

⇒ **陈旧的是 develop ref 那一侧,不是磁盘**:写面 05:05:16 提交了修复,05:05:17 的 propagate 失败
(`branchClass:"other" changeKind:"must-propagate" propagated:false`),develop 上仍是修复前的体。闸读 ref
⇒ 读到修复前的体 ⇒ `touchesResolve=false` ⇒ `fixable` 三类之一 ⇒ **派 fix worker 去修一个当前体里根本
不存在的缺陷** ⇒ 修不了 ⇒ 超时 ⇒ 三次 ⇒ needs-human。
⇒ **这是 `gap-dispatch-reads-stale-main-checkout-*` 家族的镜像半边**:那一族是「盘落后 ref,修法是读 ref」;
本条是「写面领先 ref(propagate 失败),读 ref 才陈旧」。两方向需要相反的判据,只有传播账本带方向。

### AC1 能取假的复现(两次读数)

同一 root、同一 `checkTaskTouchesResolve`,只换读源(fixture = 3 个新文件未标 `(new)` 的修复前体 vs 标了 `(new)` 的修复后体):

| 读源 | body | `touchesResolve` | bodyFreshness |
|---|---|---|---|
| `analyzeTasks({taskReadRef:"develop"})`(**生产读源**) | 修复前 | `false` | `stale-suspected` |
| `analyzeTasks({})`(盘) | 修复后 | `true` | `fresh` |

⇒ **同一个 body 维度的判定随读源翻转**(AC1 上半)。**负控制**:两侧体一致时(HEAD 移到 develop 上,写面不再持有 ref 没有的版本),两种读源**都判 `touchesResolve=false`**,且 `not_evaluated` 为空。

### AC2 痕迹被消费(第三态,独立取值)

触发 = 两个独立读数之**合**:
- (a) 账本该任务最后一条是**写面真实传播失败**(`other` + `must-propagate` + `false`;⛔ 刻意排除两种**设计如此**的 `propagated:false`:`task-branch`(worktree 写,由 fan-in 带过去)与 `self-only`(AC tick,同样由自身 fan-in 带过去));
- (b) 直接量 `git rev-list --count <ref>..HEAD -- tasks/<id>.md` > 0 —— 写面持有 ref 没有的版本。**(b) 自带方向**:既有的「主检出落后 develop」一族量到 **0**,永不被误判(由测试的负控制钉住)。

**(a) 单独会滥用**(propagate 失败下一次同步就自愈,账本却仍写 `false`);**(b) 单独会在每次在飞写时滥发**。两者相合才精确,且**自愈**:无缓存、每轮重取,内容一到 ref,(b) 即归 0。

输出词表(三个值,⛔ 不与「合格」同形——硬规则 3b):`fresh` / `stale-suspected`(测得:写面领先)/ `unknown`(写了失败记录但方向**测不到** ⇒ 绝不与「量过且干净」同形)。`bodyEvaluated = (fresh)` 进 `eligible`;顶层 `not_evaluated` 数组带 id/freshness/reason/evidence(含 `commitsAhead` 与账本 `ts`)。

读数:ref 读源下该 candidate ⇒ `bodyFreshness:"stale-suspected"`、`bodyEvaluated:false`、`eligible:false`、`promotions:[]`、`not_evaluated:[{freshness:"stale-suspected",reason:"write-face-ahead-of-ref",evidence:{commitsAhead:1,ts:"2026-09-14T05:05:17.097Z"}}]`。
负控制:①已自愈的 propagate(账本仍 `false` 但写面不领先)⇒ `fresh`、照常晋升;②两种设计如此的 `propagated:false` ⇒ `fresh`、照常晋升;③方向测不到(无 develop ref)⇒ `"unknown"`(独立取值)。

**消费端**(`promotion-driver.ts`,见下方范围说明):`classifyCandidate` 在 `bodyEvaluated===false` 时给出独立第三态(`fixable:false` / `missing:[]` / `notEvaluated:true`),⛔ **不派 fix worker**。**取假对照**:同一个 `touchesResolve=false`,`bodyEvaluated:true` ⇒ `fixable:true`(照旧派);`bodyEvaluated:false` ⇒ `fixable:false`(不派)。`computeReverifyOutcome` 把该 id 归 `notEvaluatedIds`,**`advanceRetryCap` 不计数**(否则重验证仍会把它计入失败上限,翻 needs-human 的形状原样保留)。`bodyEvaluated` 缺值(旧版闸输出)⇒ 读作「未标记」而非 `false`(硬规则 6)。

### AC3 范围纪律(写在产物里)

- **本轮【没有】改 body 读源。** `taskReadRef` 的语义、`allTasks` 的构建、四个 body 维度判据的输入一字未动;新增的是**这些判据之外**的一个三值新鲜度字段 + 它的消费。
- 宽修法(把 body 维度改到与 status 同一个权威读源)的**触发条件**:立案给的交叉表命中数 **> 1**(即出现第二个独立案例),或本轮的「未评估」态在生产上被触发超过 N 次(N 由步骤 1 的读数定,⛔ 不预设)。本轮实测交叉表命中 **1** ⇒ 未达触发条件 ⇒ ⛔ 不扩大。
- ⛔ 若将来做步骤 2,须**覆盖四个维度而非一维**(`touchesResolve`/`fourArtifacts`/`touchesNarrow`/`selfTouch`),并先取 Plan 步骤 3 的反向案例读数——这正是本缺陷的成因(硬规则 5b),⛔ 不用同一个错误去修它。

### AC4 反向陷阱 —— N/A(并写明理由)

本轮**没有**动读源 ⇒ 按 AC4 自己的规定记 N/A,⛔ 不静默跳过。理由:Plan 步骤 3 的反向案例(「刚在主检出写下、尚未 propagate 的合法新任务」在改读源后会不会被读成不存在)没有读数,而写面保留 author 是人 2026-08-31 的裁定 ⇒ 那种任务是常态 ⇒ 给不出该读数就**不得改读源**。本轮的第三态**顺带**把那个反向陷阱的边界显式化了:`unknown` 与 `fresh` 分列,读不到就不装作读到。

### 范围说明:Touches 扩展(为什么加了 promotion-driver)

立案的 Touches 只有 `ready-pool-check.ts` 与它的测试。**但只做生产者半边不构成修复**:`classifyCandidate`
的 `touchesResolve=false` ⇒ `fixable` 三类之一 ⇒ **派 fix worker**,而派 worker 正是本条缺陷的**危害本身**。
生产者单独上线时,复现场景下仍会:闸判 `eligible:false` ⇒ driver 读 `touchesResolve=false` ⇒ 派 worker
⇒ 超时 ⇒ 三次 ⇒ needs-human ⇒ **危害原样保留**。故 Touches 增列:
- `plugin/scripts/promotion-driver.ts`(消费端:分类第三态 + 重验证不计数)
- `plugin/test/promotion-driver.test.mjs`(其取假对照)

⛔ 除此之外未触碰任何文件;这份扩展本身写在这里,作为范围变更的记录。

### AC5 scoped 门

（待本轮 scoped 门读数填入）

## Touches

- `plugin/scripts/ready-pool-check.ts`
- `plugin/test/ready-pool-check.test.mjs`
- `plugin/scripts/promotion-driver.ts`
- `plugin/test/promotion-driver.test.mjs`
- `tasks/gap-ready-pool-body-still-read-from-stale-main-checkout.md`
