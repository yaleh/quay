---
id: gap-design-evolution-share-caliber-net-vs-additions
title: 设计演化读数用「净行数增量」却对外宣称「只计新增」——同一窗口两种口径差出 serve 1.31%/2.25%、worker-post-909
  102.13%/93.81%，且 R1 的出度判据方向写反
status: ready
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**事实一（代码）**：`plugin/scripts/design-evolution-readings.ts` 的每个字段都按**净行数增量**计算——`delta = head.lines - base.lines`（中心文件逐个累加），非中心同样 `nonCentralDelta += (head.lines - base.lines)`，`share = centralDelta / (centralDelta + nonCentralDelta)`。代码自己的注释也写的是 "Per-commit net line deltas"（`:591`）。

**事实二（文档）**：`docs/references/ownership-first-refactoring-methodology.md` §13 与刚完成的任务 `gap-slice-before-after-readings-at-dispatch-and-fanin` 的 schema 说明都写成「**只计新增**」。两者不是同一个量。

**事实三（同一窗口两种口径的实测，2026-10-22，HEAD `329087733`）**：

| 窗口 | 记录值（净） | 只计新增 | 备注 |
|---|---|---|---|
| serve（`295e771b0..HEAD`） | 1.31%（153 / 11,687） | **2.25%**（349 / 15,502） | 方向结论不变 |
| worker-history（`2440b52d0..ff32d031d`） | 82.46%（4,820 / 5,845） | **79.70%**（5,210 / 6,537） | 方向结论不变 |
| worker-post-909（`024f9d7f2..HEAD`） | **102.13%**（288 / 282） | **93.81%**（288 / 307） | 占比超过 100%，见下 |

**事实四（异常的结构性成因）**：净口径下非中心文件可以净减少（删除多于新增），于是分母小于分子、占比大于 100%。worker-post-909 正是这样：非中心净 −6。这不是「回流特别严重」，而是口径导致的不可解释读数。

**事实五（后果一：掩盖）**：纯搬出提交会让中心文件净减少（负增量），从而在窗口内**抵消**随后的长回。用净口径读「增长回流中心」，等于把「先搬走、再长回来」和「根本没搬」混成一个数。

**事实六（后果二：跨项目对照失效）**：claudecodeui 会话用的是 `git --numstat` 的 additions-only 与单 commit churn（`centralChurnShare`）。我们对外引用的 1% / 82% 是净口径，两边并排展示就是错误对照。

**事实七（模型表述错误）**：`ownership-first §13.2` 把 R1（提取）的 Π 判据写成「call 出度（同口径前后比）」，暗示提取会让出度下降。跨三个代码库的实测相反——纯提取让出度**上升**（claudecodeui hook 38→56、plantuml-js elk 23→26），因为中心仍然调用被搬走的符号、又多出 import 边；注册表式扩展点才让出度下降（driver 203→187）；dispatch 缝基本不动（ws-proxy 65→66）。R1/R2 的真正判据只能是窗口增长落点占比。**分类更正（对方 2026-10-22 复核后确认）**：claudecodeui 的 ws-proxy 那一刀是「**registry 结构 + 缝签名**」（建了 register/dispatch，但出度 +1 说明没有塌掉 N 条边，帧处理边大多在同文件的兄弟函数里）⇒ 归「缝」，**不算 R2**。因此 claudecodeui 目前**干净的 R2 样本只有 driver 那一个**（203→187，−16）；hook 是 R1（38→56）；刀5 是断边（环 8→7）。文档里不要把 ws-proxy 当 R2 证据。

## Plan

1. **读数记录同时携带两种口径**：在 `.quay/design-evolution-history.jsonl` 的每条 subsystem 记录里增加
   - `netShare`（现 `share` 的语义，保留键名 `share` 以免打断既有消费者，并加 `shareBasis: "net"`）；
   - `additionsShare` + `additionsNumerator` / `additionsDenominator`（来自 `git numstat` 的 additions，窗口两端聚合，按同一 module glob 与 central 声明取文件）；
   - 两者都缺时才是 `evaluated:false`（硬规则 3b：不可评估是独立取值，不写 0）。
2. **finding 文本必须声明口径**：`design-evolution-readings` 产出的 finding（`evolution:<target>:<trigger>` 去重键）在正文里写明用的是 `netShare` 还是 `additionsShare`，不得只写「占比 X%」。
3. **更正文档**：`ownership-first-refactoring-methodology.md` §13.1 的三行读数改成双口径表；§13.2 的 R1/R2 判据改写为「窗口增长落点占比是唯一判据，出度只是签名」，并补两类签名（dispatch 缝 = 平、断边/依赖倒置 = 环数），刀5 的环 8→7 作为断边的实例；同时写明「**扩展点只盖叶子、不盖主干**」——叶子注册表不改变编排主干步骤的落点，跨 quay worker 与 claudecodeui driver 两例。
4. **不改 claudecodeui 侧口径**：对方的 additions-only 与 churn 定义正确，本任务只让 quay 侧与之一致。
5. **不设阈值**：两种口径都只记录与展示，不引入「超过 X 就报警」（成本结构未测，硬规则 4 推论）。

## Acceptance Criteria

- [x] AC1 记录含两种口径：实跑一次读数，`.quay/design-evolution-history.jsonl` 最后一条里同一 subsystem 同时有 `share`、`shareBasis`、`additionsShare`、`additionsNumerator`、`additionsDenominator`；贴该 subsystem 的完整 JSON 片段与前 3 条记录的同字段内容。
- [x] AC2 异常消失且可解释：对 `worker-post-909` 同一窗口，贴出 `share`（净）与 `additionsShare`（只计新增）两个值与各自的分子分母；断言 `additionsShare <= 1` 在代码里成立（用一个把非中心增量设为负的 fixture 验证），且 `share` 允许 >1 并在记录里带 `shareBasis:"net"`。贴 fixture 名与断言输出。
- [x] AC3 文档双口径表：`grep -n 'additionsShare\|净口径\|只计新增' docs/references/ownership-first-refactoring-methodology.md` 至少 3 行，且 §13.1 表中 serve / worker-history / worker-post-909 三行都同时给出两个口径的数；贴这些行原文。
- [x] AC4 R1 判据方向更正：§13.2 里 R1 那一行不再把「出度下降」当判据；文档写明「纯提取出度上升 / 注册表下降 / 缝持平」三种签名与各自实例（hook 38→56、driver 203→187、ws-proxy 65→66），并新增「断边（环数 8→7）」一类。贴对应行原文。
- [x] AC5 消费者审计（硬规则 5b）：`grep -rn 'sharePercent\|\.share\b' plugin/scripts/*.ts` 列出所有读取该字段的消费者，逐个说明它读到的是净口径还是新增口径、是否需要随本次改动调整；贴命中数与前 3 条内容。
- [x] AC6 finding 声明的口径：构造一次触发（fixture 或把阈值临时降为可触发），检查产出的 finding 正文包含 `netShare` 或 `additionsShare` 字样；贴该 finding 的一行。若无可靠触发手段，改用单元测试断言文本模板含口径词。

## Definition of Done

- 载体里同时存在两种口径的记录，且 `shareBasis` 必填；任一 finding 的正文都能看出它引用的是哪一种。
- `docs/references/ownership-first-refactoring-methodology.md` §13 的双口径表与三签名表述落地，并与 `design-evolution-readings.ts` 的字段名逐一对得上（不是另起一套叫法）。
- 与 claudecodeui 的对账可用：同一窗口用对方口径算出的数，与本例程的 `additionsShare` 一致（各贴一个数）。

## Touches

- plugin/scripts/design-evolution-readings.ts
- plugin/test/design-evolution-readings.test.mjs
- docs/references/ownership-first-refactoring-methodology.md
- tasks/gap-design-evolution-share-caliber-net-vs-additions.md

## Evidence

**ADR-007 暗轴记录**：
- 该轴仍暗,理由:本任务只改 RM1 读数口径与 §13 文档（双口径 + R1 签名更正），不改变仓库依赖结构；窗口内未对 `L_D`/`L_G` 跑探针，无 archguard 读数可贴。

### AC1 — 记录同时携带两种口径（实跑一次，2026-10-22）

实跑（工作树 `gap-design-evolution-share-caliber-net-vs-additions`，载体 = `.quay/design-evolution-history.jsonl` 的副本续写；RM1/RM2 都是真实读数）：

```
$ node --experimental-strip-types plugin/scripts/design-evolution-readings.ts --json --findings .quay/ac-probe-findings.jsonl
→ ts=2026-10-22T07:38:51.359Z  head=52558cad2  evaluated=true  state=stable
```

最后一条记录里三个 subsystem **同一条**都同时带 `share` / `shareBasis` / `additionsShare` / `additionsNumerator` / `additionsDenominator`：

```
{"name":"serve","share":0.013091469153760589,"shareBasis":"net","additionsShare":0.02320787338741854,"additionsNumerator":349,"additionsDenominator":15038,"additionsSharePercent":2.32}
{"name":"worker-history","share":0.8246364414029085,"shareBasis":"net","additionsShare":0.7970016827290806,"additionsNumerator":5210,"additionsDenominator":6537,"additionsSharePercent":79.7}
{"name":"worker-post-909","share":1.0212765957446808,"shareBasis":"net","additionsShare":0.9381107491856677,"additionsNumerator":288,"additionsDenominator":307,"additionsSharePercent":93.81}
```

`worker-post-909` 的完整 JSON 片段：

```
{"name":"worker-post-909","evaluated":true,"reason":null,"baseline":"024f9d7f2","head":"HEAD","baselineSha":"024f9d7f24b1e463ff7dbce5f74a00459a46a501","headSha":"52558cad2f9018ed1b45a3bb9eb14b133db43edb","central":[{"atBaseline":"plugin/scripts/worker-driver.ts","atHead":"plugin/scripts/worker-driver.ts"},{"atBaseline":"plugin/scripts/worker-fan-in.ts","atHead":"plugin/scripts/worker-fan-in.ts"}],"modules":["plugin/scripts/*worker*.ts","plugin/scripts/*pool*.ts","plugin/scripts/*dispatch*.ts","plugin/scripts/*fan-in*.ts"],"centralDelta":288,"nonCentralDelta":-6,"denominator":282,"share":1.0212765957446808,"shareBasis":"net","shareReason":null,"additionsNumerator":288,"additionsDenominator":307,"additionsShare":0.9381107491856677,"additionsSharePercent":93.81,"additionsReason":null,"sharePercent":102.13,"sharePercentRounded":102,"centralFiles":[{"atBaseline":"plugin/scripts/worker-driver.ts","atHead":"plugin/scripts/worker-driver.ts","baselineLines":6866,"headLines":6945,"delta":79},{"atBaseline":"plugin/scripts/worker-fan-in.ts","atHead":"plugin/scripts/worker-fan-in.ts","baselineLines":3779,"headLines":3988,"delta":209}],"moduleFileCount":19,"newModuleFiles":[],"maxCentralChangeCommit":{"sha":"d88ad2db8ea5f9e079434cd3bf9e67463fa68d33","centralDelta":171,"nonCentralDelta":0},"oppositeSignCommits":[]}
```

前 3 条记录的同字段（它们**早于**本次改动，所以四个新键不存在——这正是本次补上的东西）：

```
2026-10-22T05:16:47.100Z {"share":1,"shareBasis":"(absent)","additionsShare":"(absent)","additionsNumerator":"(absent)","additionsDenominator":"(absent)"}
2026-10-22T05:47:48.790Z {"share":1,"shareBasis":"(absent)","additionsShare":"(absent)","additionsNumerator":"(absent)","additionsDenominator":"(absent)"}
2026-10-22T06:07:06.398Z {"share":1.0212765957446808,"shareBasis":"(absent)","additionsShare":"(absent)","additionsNumerator":"(absent)","additionsDenominator":"(absent)"}
```

### AC2 — 异常消失且可解释

同一窗口 `worker-post-909`（基线 `024f9d7f2` → HEAD），同一条记录里的两个数：

- **净口径**：`share` = **1.0212765957446808**（102.13%），分子 `centralDelta` = **288**，分母 `denominator` = **282**（= 288 + 非中心净 **−6**）。
- **只计新增**：`additionsShare` = **0.9381107491856677**（93.81%），分子 `additionsNumerator` = **288**，分母 `additionsDenominator` = **307**。
- 记录带 `shareBasis:"net"`，所以 102.13% 这个 >1 的读数**不再是无口径的裸数**；同一窗口的 additions 口径恒 ≤100%。

`additionsShare <= 1` 是**结构性**成立并被代码**检查**（不是 clamp）：`additionsDenominator = additionsNumerator + nonCentralAdditions`，两项都是非负计数；若出现 >1，代码报 `additions-share-above-one: …` 并让 additions 口径取 null（⛔ 不夹到 1，那会把记账 bug 藏成一个像样的数）。

把非中心增量设为负的 fixture（测试名与断言输出）：

```
$ node --experimental-strip-types --test --test-name-pattern="AC2: a NEGATIVE non-central NET delta" plugin/test/design-evolution-readings.test.mjs
✔ measureSubsystem — AC2: a NEGATIVE non-central NET delta pushes `share` above 1 while `additionsShare` stays <= 1 (144.58ms)
ℹ pass 1  ℹ fail 0
```

该 fixture（`plugin/test/design-evolution-readings.test.mjs`，`makeRepo` + `mod/central.ts 100→110`、`mod/other.ts 100→94`）断言：`nonCentralDelta === -6`、`share === 10/4`（>1）、`shareBasis === "net"`、`additionsNumerator/Denominator === 10/10`、`additionsShare === 1` 且 `<= 1`。

### AC3 — 文档双口径表

```
$ grep -n 'additionsShare\|净口径\|只计新增' docs/references/ownership-first-refactoring-methodology.md | wc -l
16
```

§13.1 表的 serve / worker-history / worker-post-909 三行原文：

```
| serve | 按关注点拆分 **+ 分发器（扩展点）** | **1.31%**（中心 +153 / 分母 11,687；基线 `295e771b0` → HEAD） | **2.32%**（349 / 15,038） | … |
| worker-history | 抽出一块区域（`2440b52d0`，`worker-fan-in.ts`），**没有扩展点** | **82.46%**（4,820 / 5,845；基线 `2440b52d0` → `ff32d031d`，即 GOAL-909 动手前） | **79.70%**（5,210 / 6,537） | … |
| worker-post-909 | 同上，窗口从 GOAL-909 最后一次落地提交（`024f9d7f2`）起 | **102.13%**（288 / 282 —— 非中心**净 −6**，分母小于分子，见上） | **93.81%**（288 / 307） | … |
```

⚠️ **与 Proposal 事实三的差异（如实记录）**：serve 的 additions 分母本例程读 **15,038**（2.32%），而事实三写的是 15,502（2.25%）。分子 349 两者一致；分母差 464 行来自一次性命令的文件集/rename 归并方式，本例程按 `.quay/config.yml` 声明的 module glob + central 声明 + `git diff --numstat -M`（rename 目的地归属）计算，因此**以本例程读数为准**并已写进 §13.1。同一窗口独立复算（见 DoD）与 worker-history / worker-post-909 三个数逐位一致。

### AC4 — R1 判据方向更正

§13.2 的 R1 行原文（不再把出度当判据）：

```
| R1 | 提取（extraction） | 改边，**不改增长方向** | **窗口增长落点占比**（`netShare` / `additionsShare`）——与 R2 同一个判据；⚠️ call 出度**不是**判据，只是**签名**（见下） | quay worker `2440b52d0`；plantuml-js elk 拆分（出度 23→26，**上升**） |
```

三种签名 + 断边一类的原文：

```
| 签名 | 出度方向 | 实例（同口径前后比） | 这一刀实际是什么 |
| 纯提取（R1） | **上升** | claudecodeui hook 38 → 56；plantuml-js elk 23 → 26 | 中心仍然调用被搬走的符号，**又多出 import 边** ⇒ 出度只增不减 |
| 注册表式扩展点（R2） | **下降** | claudecodeui driver 203 → 187（−16） | 中心把 N 条分支换成一次注册表调用，边真的塌掉了 |
| dispatch 缝（缝签名，**不算 R2**） | 持平 | claudecodeui ws-proxy 65 → 66 | 建了 register/dispatch，但帧处理边大多留在**同文件的兄弟函数**里 ⇒ 没有塌边。2026-10-22 复核：这一刀归「缝」 |
| 断边 / 依赖倒置 | 不适用 | claudecodeui 刀5：**环 8 → 7** | 只断依赖，不改增长方向 ⇒ 用**环数**做签名 |
```

并新增「扩展点只盖叶子、不盖主干」一节（quay worker 的 `WorkerPool` 只盖结局处理、`runResidentLoop` 出度仍 84；claudecodeui driver 只盖 handler 叶子）。

### AC5 — 消费者审计（硬规则 5b）

```
$ grep -rn 'sharePercent\|\.share\b' plugin/scripts/*.ts | wc -l
32
$ grep -rl 'sharePercent\|\.share\b' plugin/scripts/*.ts
plugin/scripts/design-evolution-readings.ts
$ grep -rn 'sharePercent\|\.share\b' plugin/scripts/*.ts | grep -v 'plugin/scripts/design-evolution-readings.ts' | wc -l
0
```

前 3 条命中：

```
plugin/scripts/design-evolution-readings.ts:440:  sharePercent: number | null;
plugin/scripts/design-evolution-readings.ts:442:  sharePercentRounded: number | null;
plugin/scripts/design-evolution-readings.ts:500:    sharePercent: null,
```

逐个说明（**32 条全部在本模块内，`plugin/scripts/*.ts` 里没有第二方消费者**）：

| 位置 | 角色 | 读的是哪个口径 | 本次是否需要调整 |
|---|---|---|---|
| `SubsystemReading` 定义 + `measureSubsystem` 的 base/return（:416-:442, :490-:500, :669-:670 附近） | **产出方** | `share`/`sharePercent`/`sharePercentRounded` = 净口径 | 已就地补 `shareBasis:"net"`、`shareReason` 与 `additions*` 四键；净口径公式**未改** |
| `SubsystemVerdict` / `EvolutionTriggerHit` / `judgeEvolutionRegression`（:1370, :1394, :1631-:1721） | 读者（判定） | `num(cs.sharePercent)` = 净口径；trigger 仍按**净增量**判 | 已加 `additionsSharePercent` 随行携带；**trigger 语义未改**（⛔ 不偷偷改 `share-up` 的含义） |
| `EvolutionFinding` / `evolutionFindings` / `evolutionFindingRecord`（:1434, :1812-:1910） | 读者（产出 finding 载体） | 净口径 + 新增口径**同时**写进正文 | 已改：正文写 `netShare` 与 `additionsShare`，载体行加 `shareBasis`/`additionsSharePercent` |
| `renderHuman`（:2268-:2287） | 读者（CLI 文本） | 两个口径各带自己的名字与「n/a + 原因」 | 已改 |
| `plugin/scripts/quality-gate-driver.ts`（`runDesignEvolutionRound`） | 外部消费者 | **不读任何 share 字段**：整条记录作为 `fact.value` 透传 | 无需调整 |
| `plugin/test/quality-gate-driver.test.mjs:2833/2846` | 外部测试 | 钉 `sharePercentRounded` / `share`（净口径） | 无需调整；其 fixture 窗口是纯新增 ⇒ 记录仍是 `evaluated:true`，该测试在 scoped 门里通过 |

### AC6 — finding 正文声明口径（真实触发）

用生产代码路径跑出一个真实 finding（fixture 仓库 `.quay/ac6-fixture/repo`，两轮：第一轮 baseline，第二轮中心 +40 ⇒ 净增量分母 +50 > 0 且中心增量 +40 > 0 ⇒ `share-up`）：

```
$ node --experimental-strip-types plugin/scripts/design-evolution-readings.ts --root .quay/ac6-fixture/repo --config .quay/ac6-fixture/section.yml --history .quay/ac6-fixture/history.jsonl --findings .quay/ac6-fixture/findings.jsonl
  state=regression  …  share-up:demo (Δcentral=40 Δdenominator=50 Δnon-central=10 netShare=54.55% additionsShare=54.55%)
  findings: 1

$ tail -1 .quay/ac6-fixture/findings.jsonl
{"ts":"2026-10-22T07:33:34.682Z",…,"symbols":["evolution:demo:share-up"],…,"sharePercent":54.55,"shareBasis":"net","additionsSharePercent":54.55,…,
 "rationale":"子系统 `demo` 本轮相对上一条读数分母增加 `50`、中心增量 `40`、非中心增量 `10` ⇒ 新增的净行数落进了中心文件（分解没有把新代码挡在外面）。累计净口径 `netShare` `54.55%`（centralΔ=`60` / denominator=`110`）；同一窗口只计新增口径 `additionsShare` `54.55%`（additionsNumerator=`60` / additionsDenominator=`110`）。⛔ 两种口径不可互引：…"}
```

单元测试（文本模板，作为同一条判据的机械化半边）：

```
$ node --experimental-strip-types --test --test-name-pattern="AC6 — the share-up finding" plugin/test/design-evolution-readings.test.mjs
✔ AC6 — the share-up finding's TEXT names its caliber (⛔ never a bare 「占比 X%」) (3.95ms)
ℹ pass 1  ℹ fail 0
```

### DoD 对账（与 claudecodeui 口径一致）

同一窗口 `worker-post-909`，用**独立 shell 命令**（对方口径：`git diff --numstat` 的 additions）复算，与本例程记录逐位一致：

```
$ git diff --numstat 024f9d7f2 HEAD -- plugin/scripts/worker-driver.ts plugin/scripts/worker-fan-in.ts | awk -F'\t' '{a+=$1} END {print a}'
288
$ git diff --numstat 024f9d7f2 HEAD -- plugin/scripts/worker-driver.ts plugin/scripts/worker-fan-in.ts 'plugin/scripts/*worker*.ts' 'plugin/scripts/*pool*.ts' 'plugin/scripts/*dispatch*.ts' 'plugin/scripts/*fan-in*.ts' | awk -F'\t' '{a+=$1} END {print a}'
307
⇒ 288 / 307 = 93.81%  ==  记录里的 additionsSharePercent
```

`shareBasis` 的「必填」语义：每条 subsystem 记录都**必有该键**；`"net"` 当且仅当 `share` 非 null，`share` 为 null 时取 null（⛔ 不给不存在的数贴口径标签），此时 `shareReason` 必给原因。

### 验证（本任务窗口内）

```
$ bash scripts/test.sh --for-task gap-design-evolution-share-caliber-net-vs-additions --allow-thin
ℹ tests 49  ℹ pass 49  ℹ fail 0     (exit 0，含静态检查)
$ node --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts --task … --worktree … --merge-target develop
ANTI-DRIFT OK: 3 actual file(s), all within declared Touches (4 glob(s))
```

## Blocker

**2026-10-22T08:08:34.943Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=ff: fan-in-ff-merge: suite 证书 — suite_head..tip 恰为本任务的单个 flip-done 提交（身份判定：仅 M tasks/gap-design-evolution-share-caliber-net-vs-additions.md）⇒ 判惰性，⛔ 未调分类器
fan-in-ff-merge: FF FAILED — ! [rejected]            task/gap-design-evolution-share-caliber-net-vs-additions -> develop (non-fast-forward); not a fast-forward. Retry record written (attempt 1). Return to 无锁段 step 1 (merge develop again — 必须 merge 不得 rebase, AC75), re-judge the delta (step 2) and re-run.
fan-in-ff-merge: measure ff_only_locked=false
- run_id：wk-prod-anchor
- session_id：f1183193-9d62-4d62-8366-9e3b22e89040
