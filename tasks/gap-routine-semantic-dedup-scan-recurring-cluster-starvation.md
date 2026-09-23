---
id: gap-routine-semantic-dedup-scan-recurring-cluster-starvation
title: "semantic-dedup-scan: 264 candidate findings rejected vs 6 tasks filed
  across 3 rounds (DEFAULT_RATE=3); the highest-recurrence clusters have NO task
  at all — grep of tasks/*.md ret"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
264 candidate findings rejected vs 6 tasks filed across 3 rounds (DEFAULT_RATE=3); the highest-recurrence clusters have NO task at all — grep of tasks/*.md returns 0 files for readServerCarrier, resolveCliPath, readJsonLines — while manifest.ts has been re-reported in all 6 rounds and the server-verify pair in 5, and the code is still duplicated today (verified byte-identical).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790118332027` · ts `2026-09-22T23:05:32.027Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`DEFAULT_RATE`、`gateFinding`
- 涉及文件：
- `plugin/scripts/routine-file-gate.ts:16`
- `plugin/scripts/routine-file-gate.ts:46`
- `.quay/routine-findings.jsonl`
- kind：`other`
- verdict：`real-duplication`

## Requested action
prioritize by recurrence count rather than re-discovering the same clusters each round

## Disposition（复核与处置）
**结论：修掉 —— 机制缺陷（立案预算按**探针发射顺序**发放）。** ⛔ 不是观测误报，也不是「已注意到」。
修复落在两处：`plugin/scripts/routine-file-gate.ts`（新增复现读数与排序）、`plugin/scripts/probe-routine.ts`
（`selectFilings` 按复现序消费 rate 预算）。

### 复核：每一句都取读数，⛔ 不靠「我认为是因为」
1. **"264 rejected vs 6 filed across 3 rounds"** —— 载体 `filing-round` 记录实测（`semantic-dedup-scan`）：
   第 1..3 轮累计 rejected **264** / filed **6**（第 4 轮 +49/+3 ⇒ 313/9）。**逐字吻合**。
   同期闸门分布 `rate: 277 / action: 36`、**`dedup:` 0** ⇒ 「键不稳」那半已由上一条任务
   （`…-routine-dedup-branch-never-fires`，done）修掉；本条是**剩下那半**。
2. **机制读数（本轮 `semantic-dedup-scan-1790118332027`，52 候选，k=3）** —— 立案的 3 条按**已复报轮数**为
   `{0, 0, 2}`，而被 `rate:` 拒绝的候选一路到 `{4, 3, 3, 3}`：`mergeenv·mergeprofileenv`(4)、
   `isdeadinflight·isdeadmerge`(3)、`parseargs`(3)、`statecolortoken·timelinecolortoken`(3)。
   ⇒ **限流恰好卡在载体反复证明过的那批工作，而三个名额里两个给了首次出现的 finding。**
   根因不是任何一道闸判错 —— 是**谁先花预算**：判定顺序 = 探针发射顺序，而那个顺序不携带任何价值信号。
3. **finding 的点名例子（逐条核过，并要点明它与本修复的轴不同）**：`readmanifest` 在该轮之前被**6 轮**
   重复报过（总 7 轮）——与 "re-reported in all 6 rounds" 逐字吻合；但 `readServerCarrier` /
   `resolveCliPath` / `readJsonLines` 是**文件级**观测，其 symbols 集合逐轮漂移（实测该族出现 **6 种不同集合形状**）
   ⇒ 在**精确 symbols 键**下各成一个主语、复现被碎片化。⛔ 这不是本任务引入的：那个键是上一条任务按实测选定的
   （纯文件集作键会把 **121 个不同主语**吞进 40 个键值），本任务**继承同一条轴**并把它写进边界（见下 §边界②）。

### 处置（可核的落点，⛔ 不以「已注意到」结案）
- **修复**（`plugin/scripts/routine-file-gate.ts`）：
  - `recurrenceByKey(carrierPath)`：主语 → **不同 runId 的轮数**（⛔ 不是记录数：一轮分片会重复报同一主语）。
    **三值**（硬规则 3b）：读不出/读不懂 ⇒ `null`；空载体 ⇒ 真空读数 —— ⛔ 两者不共用输出。
  - `recurrenceOrder(findings, recurrence)`：复现降序、**同分保探针序**；无读数 ⇒ 探针序（= 修复前逐字节）。
  - 键**复用 `findingKey`**（同一渲染器）⇒ 优先级与去重键是**同一个量**，⛔ 不开第二条会静默漂移的键。
- **接线**（`plugin/scripts/probe-routine.ts`）：`selectFilings` 的**判定顺序**改为复现序（rate 预算由高复现者先花），
  输出仍按**探针序**（载体记录跨轮可比）；`rate:` 拒绝的理由追加复现读数（残余饥饿可审，
  ⛔ 否则「限流正确」与「优先级没生效」在记录里同形）。
- **生产载体重放（红/绿，`plugin/test/probe-routine.test.mjs`）**：把该轮 52 条候选、空板、当轮 rate 窗口
  原样重放两遍，**唯一变量 = 是否消费复现序**：
  - **withheld（`recurrence: null`）⇒ 复现了那一轮的 `filing-round` 记录**：filed 集合**逐字相同**，
    49 条拒绝**理由也逐字相同** ⇒ 重放**就是**那一轮（这是该用例的自检；不再复现即整条作废）。
  - **applied ⇒ 立案集合改变**，且 **`rate:` 拒绝者的复现 ≤ 已立案者的复现**（withheld 时该不变式**被违反**：
    filed 下限 0 而 rate 拒绝上限 4）。
- **负对照（可复跑）**：把 `selectFilings` 里的 `recurrenceOrder(findings, recurrence)` 改成 `…, null)`
  （**读了但不消费**）⇒ 上条用例 **1 条红**，纯函数用例（`plugin/test/routine-file-gate.test.mjs` 10 条）仍**全绿**
  ⇒ 对照证明该用例咬的是「消费优先级」这个动作，不是别的。
- **未修的边界（写明，⛔ 不留给读者猜）**：
  ①**优先级 ≠ 资格**：复现再高、`suggestedAction: "leave"` 的仍不进（`action:` 闸）——`readmanifest`（6 轮）
    正是这样被排除的 ⇒ 「优先级表头」不等于「立案表头」。
  ②**粒度继承去重键**：symbols 集合逐轮漂移的族（实测 346/360 对是子集/超集关系）复现被碎片化，
    仍可能排在某个集合稳定的高复现主语之后 ⇒ **退化为修复前顺序，⛔ 不会更差**（修复后序 = 复现降序、
    同分即探针序 ⇒ 对任何候选都不比修复前更靠后）。没有引入族级/子集排序：那会让优先级与去重键分家。
  ③**探针仍会每轮重发现同一批集群**（那是探针侧的事，`plugin/probes/*.md` 不在本任务 Touches 内）；
    本任务修的是**发现之后谁先花预算**，故残留成本是**载体体积**，不再是**饥饿**。
- **回归面**：`plugin/test/probe-routine.test.mjs` 23 / `plugin/test/routine-file-gate.test.mjs` 10；
  消费方 `plugin/test/meta-driver.test.mjs` 131、`experiments/quay-perpetual-stream/test/routine-file-gate.test.mjs` 4、
  `packages/quay/test/loop-params.test.mjs` 42、`experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs` 46 —— 全绿。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `recurring-cluster-starvation`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790118332027`）所描述的问题被复核并处置（见 §Disposition：复核取了读数——264/6 逐字吻合、本轮 filed 复现 {0,0,2} vs rate 拒绝到 {4,3,3,3}；机制缺陷已修，生产载体重放 withheld 逐字复现该轮、applied 按复现序改判）
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案（已修；可核落点=两处源码 + 三条边界已写明：优先级≠资格 / 粒度继承精确 symbols 键 / 探针侧重发现不在本任务面内）

## DoD
- [x] 上面的判据实跑通过（`plugin/test/probe-routine.test.mjs` 23 passed（含真实载体重放与负对照）/ `plugin/test/routine-file-gate.test.mjs` 10 passed；消费方 meta-driver 131、experiments 侧 gate 4、loop-params 42、symlink-mirror 46 全绿；负对照 = 读了不消费 ⇒ 重放用例 1 红、纯函数用例仍 10 绿；scoped 门 `scripts/test.sh --for-task … --allow-thin` 绿）
- [x] ⛔ 探针只立案不执行：本任务由例程经 `routine-file-gate.ts` 机械立案，修复由派发链（worker）在本任务自己的 worktree 内执行 —— 例程本身一行都没跑

## Touches
- `plugin/scripts/routine-file-gate.ts`
- `plugin/scripts/probe-routine.ts`
- `plugin/test/routine-file-gate.test.mjs`
- `plugin/test/probe-routine.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-recurring-cluster-starvation.md`
