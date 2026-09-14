# 套件快了 5 倍，吞吐没有跟上——一次基于遥测载体的定量复核

> 2026-09-14。目的：把 `docs/references/` 里几条一直只有定性论证的主张，放到本项目自己的
> 遥测载体上量一遍。结论分三档：**已量出**（有读数、有窗口、可复跑）/ **被自己的读数推翻**
> （包括本文作者当场犯的两个错）/ **结构上还量不了**。
>
> 全部读数取自 `.quay/*.jsonl` 与 `git log develop`，窗口 2026-08-11 → 2026-09-14。
> ⚠️ 高分辨率遥测最早只到 2026-08-11，更早的历史只能靠 git（粒度到「周 + 行数」），
> 任何耗时/延迟类结论都不要往 8 月之前外推。

## 0. 数据面盘点（先盘载体，再设计指标）

| 载体 | 条数 | 窗口 | 能回答什么 |
|---|---|---|---|
| `measure-history.jsonl` | 503,380 | 08-12 → 09-14 | 按**测试文件**粒度的耗时/通过 |
| `promotion-round.jsonl` | 43,323 | 08-22 → 09-14 | 晋升轮 |
| `promotion-outcome.jsonl` | 41,977 | 08-22 → 09-14 | 每次晋升判定的结果 |
| `gate-events.jsonl` | 96,779 | 08-12 → 09-14 | 闸判定 pass/fail |
| `checker-cost.jsonl` | 94,668 | 08-11 → 09-14 | 每个 checker 的单次耗时 |
| `worker-round.jsonl` | 17,994 | 08-23 → 09-14 | worker 轮 |
| `verification-round.jsonl` | 1,678 | 08-12 → 09-14 | 每轮套件时长/绿红/lane |
| `fan-in-step-trace.jsonl` | 12,308 | **09-04** → 09-14 | fan-in 分步耗时（有缺口，见 §5） |
| `worker-outcome.jsonl` | 1,896 | 08-23 → 09-14 | 每次 worker 执行的墙钟与终态 |
| `fan-in-lock-events` + `fan-in-merge-lock-events` | 2,311 + 2,554 | — | 锁获取/释放（本次未展开） |

## 1. 已量出：套件快了 5 倍，吞吐没有跟上

`verification-round.jsonl` 按天聚合，中位套件时长：

| 时期 | 中位时长 | 每日轮数 |
|---|---|---|
| 08-18 ~ 08-21 | **14.6 – 17.2 min** | 33 – 45 |
| 09-06 ~ 09-11 | **3.1 – 4.3 min** | 56 – 115 |

同期「每日落地任务数」（直接量 = `git log develop` 上 `翻 … done` 的提交数，全窗口 940 次）
并没有随之系统性上升。日粒度相关性（n=34 天）：

```
corr(中位 suite 时长, 当日落地数)     = −0.11      ← 基本无关
corr(当日 suite 轮数,  当日落地数)     = +0.57
corr(中位 suite 时长, 当日 suite 轮数) = −0.37
```

**⊢ 「把测试跑快就能提高迭代速度」在这一个月的数据里不成立。** 派生指标「每落地任务的
验证成本」确实降了（138 min @08-12 → 13–18 min @8 月中 → **5–8 min** @9 月），但那是
成本下降，不是吞吐上升。

## 2. 已量出：熔融 → 结晶是一次可见的相变

`git log develop --numstat` 按周聚合，净增行数（加 − 删）分类统计：

| 周起 | code : doc 净增比 |
|---|---|
| 07-13 | **1 : 6.8**（与 `exp5-crystallization-strategy.md` 当时诊断的 1:9.38 同量级） |
| 07-20 | 1 : 1.5 |
| 07-27 | 1 : 0.7 ← 反转 |
| 08-03 | 1 : 0.3 |
| 08-17 | **散文净 −1,810 行**，代码净 +32,847 ← 真的发生过收缩 |
| 08-24 | 1 : 0.1 |
| 09-07 | 1 : 0.0 |

**⊢ 这是 ADR-008「呼吸」里收敛相的第一份连续曲线证据**——不是快照，是 10 周轨迹，
且中间有整整一周散文是净负的。注意这不等于 ADR-008 的**切换规则**被验证：收缩仍然
全部由人发起（见 `crystallization-the-contraction-phase-has-no-mechanism.md`），
本图只证明「收缩发生过且可测」，不证明「机制会自己触发收缩」。

## 3. 已量出：返工倍数中位 2 次

`worker-outcome.jsonl`：703 个不同任务、1,896 次 worker 执行。

| 一次落地 | 2 次 | 3 次 | 4 次 | 5 次 | ≥6 次 |
|---|---|---|---|---|---|
| 303 (43%) | 165 | 77 | 55 | 37 | 66 |

中位 2 次，p90 = 5 次，最高 **27 次**（`gap-retire-session-liveness`）。

## 4. 已量出（意外）：最贵的「验证」不是测试，是晋升闸

`checker-cost.jsonl`，145 个 checker，累计 217 小时：

| checker | 调用 | 中位 | 累计 | 占比 |
|---|---|---|---|---|
| **`ready-pool-check`** | **75,571** | 9.5 s | **212.7 h** | **97.8%** |
| 其余 144 个合计 | ~19,000 | — | 4.3 h | 2.2% |

作为对照，同期**整个测试套件**累计约 231 小时。**晋升闸的开销和跑完所有测试一样贵。**

而且在加速增长（调用数与单次时长同时涨，单次时长涨是因为它是 O(池大小)）：

| 时期 | 调用/天 | 中位 | 累计/天 |
|---|---|---|---|
| 08-12 ~ 08-22 | ~300 | 2.7 s | 0.1 – 0.7 h |
| 08-23（driver 化） | 2,520 | 4.7 s | 3.7 h |
| 09-11 | 6,316 | 11.4 s | **19.0 h** |
| 09-13 | 4,780 | 13.0 s | **17.3 h** |

三周涨 5 倍。可并发，所以不等于占满单核，但已是约 1 核持续占用，且**没有任何判据在盯它**。

## 4.1 已实现：晋升闸的两项 O(库大小) / O(history) 成本（生产对照待 ≥3 天）

（`tasks/gap-ready-pool-check-is-o-pool-size-and-costs-as-much-as-the-whole-suite`）

### 先量：钱花在哪一步

`analyzeTasks()` 单次调用（本机，2,141 个任务）分步实测（同一台共享机，19–35 s 是折算；
本文末尾的 A/B/D 三组是**交叉执行 + min-of-3** 的最终读数，以那三组为准）：

| 步骤 | 成本 | 与什么成正比 |
|---|---|---|
| `readTaskFilesAtRefBatch`（`cat-file --batch` 读**全部** blob）+ 逐个 `parseTask` | **7.8 s** | 库大小 N |
| `buildGitHistoryIndex`（`git log <ref> --full-history -m --name-only`，21,309 commit ⇒ **11 MB** 文本 + 建索引） | **10.1 s** | 历史长度 |
| `listRefTaskBlobs`（`git ls-tree -r`，命名全部 blob 而不读内容） | **0.03 s** | 库大小（但常数极小） |
| 其余（worktree 扫描 / `testProcessesInUse` / `wordMatch` / 相关性） | ~4 s | worktree 数 |

⇒ 前两项合起来约 **75%**，且**都与调用时刻的真实状态无关**：`develop` 这个 ref 从上一次轮询
（中位间隔约 0.6 s）到现在一个字节都没变。**每次轮询都在重算同一个纯函数。**

### 修法：按 git 对象身份寻址的持久缓存

git ref 是**内容寻址**的——「`develop` 在 OID X」永远对应逐字节相同的内容。所以这两项派生
不必对同一份内容算第二次。两处缓存的键都是**git 对象身份**，没有 mtime、没有 TTL：

- **任务库缓存**：键 = **blob OID**。`git ls-tree -r <ref> tasks/` 用 **28 ms** 列出全部 2,141 个
  blob 的 OID（对比 5,100 ms 把内容读出来），只有缓存里没有的 OID 才走一次批量 `cat-file`。
  ⇒ `develop` 前进一个 commit 时，只重读、重解析那个 commit 改动的几个文件。
- **落地历史索引缓存**：键 = 落地 ref 的 **commit OID**，前进时**增量**推进——
  `buildGitHistoryIndex(root, {ref: "<旧OID>..<新OID>"})`（**同一个函数、同一套 flag、同一个解析器**；
  一个 range 是合法的单个 git revision 参数）⇒ `develop` 前进一次的代价是那几个 commit，
  不是 21,309 个。

**缓存放在 repo 的 git dir**（`<git-common-dir>/quay-ready-pool-cache/`），**不是 `.quay/`**。
两个理由都承重，且第一条是**被测试逼出来的**：
① `.quay/` 下的文件是**逐个**写进 `.gitignore` 的，新载体放在那里会以 `?? .quay/` 弄脏工作树——
**两条既有测试（`applyPromotions` 之后 `git status --porcelain` 必须为空）在改后当场变红**，
是它们把这条约束顶出来的，不是我先想到的；
② 语义上对——缓存按 **git 对象身份**寻址，而对象就住在那同一个 git dir 里；worktree 共享 common dir，
所以 worktree 能命中主检出解析过的条目。

⛔ **没有动的东西**：单源 ref 读语义（`gap-dispatch-reads-stale-main-checkout-task-status`，硬规则 4b）。
缓存里存的是**该 ref 上**那份 blob 的解析结果，工作树只在「ref 上没有这个 id」时被读——和改前逐字一致。
缓存读**只分命中与未命中，绝不是真相来源**：文件缺失 / 截断 / 版本漂移 / 非 git 根，
全部退回改前那条路径（该路径原样保留）。`QUAY_READY_POOL_CACHE=0` 强制退回（负控制的接缝：
它让前/后读数能在**同一个 commit** 上取，把「缓存」与「其它任何改动」分开）。

### 读数

| 量 | 改前 | 改后（缓存命中） |
|---|---|---|
| 任务库装载（2,141 个任务，真库） | 4,701 ms | **410 ms** |
| 任务库装载（`cat-file --batch` 部分） | 3,536 ms | — |
| `ls-tree` 命名全部 blob | — | 29 ms |

规模判据（AC1，`rpc-ac1-scale.mjs`，同一条真库的**等距抽样**子集；详情见附录）：

**A. 受控形态：固定 ready 数 = 4，只让库大小变**（这才是「是否 O(库大小)」的正确对照：
AC1 的比例抽样把**库大小**与 **ready 数**耦合在了一起，而生产里 ready 池**不随库增长**——
它是派发管道的函数，不是库的函数）

| 格子 | N=536 | N=2,121 | ratio 大/小 | Δ(大−小) |
|---|---|---|---|---|
| 改前 | 8,899 ms | 11,803 ms | 1.33 | **2,904 ms** |
| 改后（缓存命中） | 4,091 ms | 4,556 ms | **1.11** | **465 ms** |

两组读数都是**交叉执行 + min-of-3**。**两臂 `pool` 都打印为 4**（对照成立，不是推测）。
⇒ 库大小相关的那部分 **2,904 ms → 465 ms（6.2×）**，ratio **1.33 → 1.11**；
绝对量在 N=2,121 上是 **11,803 ms → 4,556 ms（2.6×）**。

**B. `analyzeTasks()` 全量，按 AC1 字面读法（等距抽样的两个子集）**——**两个 N 上都快约 2 倍，
但 ratio 几乎没动**

| | N≈536 | N≈2,142 | ratio 大/小 |
|---|---|---|---|
| 改前 | 9,318 ms | 16,229 ms | **1.74** |
| 改后（缓存命中） | 4,833 ms | 7,913 ms | **1.64** |

**这个 ratio 没变，不是缓存没生效**，而是总量被两个**与库大小无关、或与库大小之外的量成正比**的项稀释：

1. **固定开销**（worktree 扫描 / `/proc` / 历史宽度）在两个 N 上相同；
2. **ready 扫描与 ready 任务数成正比**——按比例抽样时 ready 数随 N 一起涨（**4 → 22**）。
   每个 ready 任务约 170 ms（`worktreeExists` 的 `git worktree list` 子进程、
   `resolveSymbol` 的 grep、`wordMatch`），**这一项本任务没有处理**。

⇒ **AC1 若按这个读法判定，判据【未达成】**——如实记在此，不修饰。判据达成与否成了
**子集构造方式**的函数，这本身就是一条结论：**用总量做规模判据，必须先固定其它随 N 变的量。**

**C. 部件读数：任务库装载**（真正携带 N 依赖的那一项）

| | N=536 | N=2,142 |
|---|---|---|
| 未缓存（**= 改前那条路径**） | 899 ms | 3,634 ms |
| 缓存命中（改后） | 119 ms | 425 ms |

**D. 隔离对照：同一个 commit，kill-switch 关/开**（把「缓存」与「别的什么也变了」分开；N=2,142）

| | 读数 |
|---|---|
| `QUAY_READY_POOL_CACHE=0`（改前路径） | 3,992 ms / 4,254 ms |
| 缓存命中 | 565 ms / 424 ms |

⇒ 同一条库装载路径上 **约 9×**。这一对是四组里**唯一把变量控制到一个**的：同一份代码、同一个
checkout、同一个子集，只差缓存开关。

**E. 负控制（本任务新增的回归测试）**：N=2,000 的 fixture 库上，
`cached == uncached × 0.75` 这条断言，在**把缓存旁路掉**的同一份代码上**红**：

```
AssertionError: cached analyzeTasks must beat the uncached baseline on an N=2000 store:
  cached=4044ms uncached=4116ms ratio=0.98 (pre-fix ratio ≈ 1.0)
```

而缓存打开时 ratio ≈ **0.52**。⇒ 这条断言**可取假**，且取假的正是要证明的那件事。

### 正确性：四条等价 + 一条内容寻址

新增 8 条测试（`plugin/test/ready-pool-check.test.mjs`），全部在改前后双向可取假：

- 缓存读 **== 未缓存的批量读**（冷、暖、以及 ref 前进后）；
- **内容寻址**：某个任务的 blob 变了 ⇒ 下一次调用**立刻**看到新内容（没有"陈旧窗口"这回事——
  键是对象身份，不是时间）；
- **ref 仍然是唯一真相**：让工作树与 ref 的任务状态不一致，缓存读与未缓存读**都**给出 ref 的值；
- **fail-soft**：缓存缺失 / 损坏 / 版本漂移 / 被 kill-switch 关掉 ⇒ 结果逐字节相同；
- **增量 (A..B) == 全量重建**（21,309 commit 的全量索引 vs 40 commit 的增量合并，结构完全相等）；
- 非祖先 tip（rebase / 无关历史）⇒ 退回全量重建，不并一个错的 range。

### 残留成本（本次没有消除，诚实登记）

改后一次热调用仍有约 4.5 s（N=2,121，min-of-3），且这些**不是 O(库大小)**：

| 残留项 | 约 | 性质 |
|---|---|---|
| `computeMergeWorktreeSurfaces` 逐个 worktree 的 merge 判定 | 1.5 s | O(worktree 数)；worktree 状态是活的，缓存它会引入陈旧窗口 ⇒ 本次不动 |
| `testProcessesInUse`（`defaultLaneCount()` 的默认参数在每次 `computeSuiteBlocking` 调用时求值） | 1.6 s | `/proc` 扫描，宿主相关 |
| `wordMatch`（`gitHistoryLanded` 对声明的**目录**路径展开出的全部 hash 逐个跑 `messageReferencesTask`） | 1.7 s | O(触及该路径的 commit 数)，不是 O(N) |
| 两份缓存的读入 + `JSON.parse`（19 MB + 10 MB） | 0.7 s | 固定 |

⇒ **改后的单次调用不再随库大小增长**（这正是 AC1 的要害）；剩下的是一条由 worktree 数与历史宽度
决定的常数下限，与任务库规模无关。

### 硬规则 5b：同类路径清点（缺陷成簇）

谓词是「**每次调用都把整个任务库读进来并逐个解析**」——即 `readdirSync(tasksDir)` 或
`ls-tree`/`cat-file` 之后对**全部**文件 `readFileSync` / `parseTask`（按位置判定，不按关键词）。
按硬规则 2，引用计数**之前**先打印前 3 条实际命中：

```
$ grep -rn 'readTaskFilesAtRefBatch(' --include=*.ts plugin/scripts packages | grep -v /dist/
plugin/scripts/slot-refill.ts:489:    ? readTaskFilesAtRefBatch(root, taskReadRef, fileNames.map((f) => f.replace(/\.md$/, "")))
plugin/scripts/ready-pool-check.ts:2255:export function readTaskFilesAtRefBatch(root, ref, ids) {
plugin/scripts/ready-pool-check.ts:2288:  return readTaskFilesAtRefBatch(root, ref, [taskId]).get(taskId) ?? null;
命中 3 条，其中 2 条是【定义】与【单文件包装】，不是实例 ⇒ 实例 1 条
$ grep -rn -A6 'readdirSync(tasksDir)' --include=*.ts plugin/scripts packages/quay-native/src | grep -B1 readFileSync
plugin/scripts/cap-counts-subagents-check.ts:334:  for (const f of fs.readdirSync(tasksDir)) {
plugin/scripts/rhythm-consumer-check.ts:393:    for (const e of fs.readdirSync(tasksDir).sort()) {
plugin/scripts/touches-one-entry-one-path-check.ts:183:  for (const f of fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"))) {
命中 10 条
```

| # | 路径 | 同类？ | 本次修复？ |
|---|---|---|---|
| 1 | `plugin/scripts/slot-refill.ts:485` `buildTaskMetaById` —— `readdirSync` → `readTaskFilesAtRefBatch(全部)` → 逐文件 `parseTask`（只投影 `{status, role}`） | **是，且是最贵的兄弟**：slot-refill 是**同一 tick 的下一步**，与 ready-pool-check 同频同量 | **否**（不在 Touches）。本次缓存**没有被它复用** |
| 2 | `packages/quay/plugin/scripts/slot-refill.ts:489` | 是（#1 的生成镜像） | 否（build 产物，随 #1） |
| 3 | `packages/quay/src/observation.ts:1441,1473` —— `readTaskFilesAtRefBatch(root, ref, listTaskFilesAtRef(root, ref))` | **是**：整库 blob 读，在 serve observation 请求面 | 否 |
| 4 | `plugin/scripts/task-status-drift-check.ts:869` | 是（整库读 + 逐任务符号解析；符号解析已批量化） | 否 |
| 5–11 | `stale-ready-audit.ts:81,122` · `touches-orthogonality-check.ts:463` · `task-contract-check.ts:554` · `long-term-guarantee-goal-backed-check.ts:163` · `cap-counts-subagents-check.ts:334` · `it0-split-or-commit-check.ts:142` · `rhythm-consumer-check.ts:393` / `prod-data-audit.ts:319` / `task-ac-carryover-check.ts:154` / `touches-one-entry-one-path-check.ts:183,245` | 是（整库读 body；其中 334/142 只需要 `status`/frontmatter 却读全文） | 否（均在 Touches 外） |
| 12 | `plugin/scripts/landing-target-check.ts:156` | **否**：只列文件名，不读内容 | — |
| 13 | `packages/quay-native/src/store.ts` `list()` / `listWithMalformed()` —— **AC 点名的 `task_list` 路径** | **已是同类修复的先行者**：`ensurePersistentCacheLoaded()` / `flushPersistentCache()`（`gap-task-store-parse-cost-0-8s-compounds-suite-slowdown`），该缓存已进 vendored bundle | 无需本次修复 |
| 14 | `plugin/scripts/dist/*.js`、`plugin/vendor/quay/dist/quay.js`、`plugin/vendor/quay-native/dist/quay-native.js` | 否：都是**打包产物**（`.gitignore` 的 `dist/`、`packages/quay/plugin/`），由上面源码生成 | 随源码重新生成 |

**AC 点名的那条**：`gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp`
**`status: ready`，仍未闭合**。它的**解析成本**面已由 #13 覆盖，但该任务没翻 done ⇒ 它要解的
多半是**另一面**（MCP 级超时 / 队头阻塞），**不是**解析成本。**本次不从本文件修它，也不声称已修。**

**为什么没有一并修**：本任务 `## Touches` 只声明 `plugin/scripts/ready-pool-check.ts`（+ 测试 + 本文）。
上表除 #2/#14（产物）外的每一条都在 Touches 之外，改了会触发 anti-drift。
**最高价值的下一步是 #1（slot-refill）**——同 tick、同量级，且本次这份按 blob OID 的缓存
可以直接被它复用。**这里只是一个清单，不是「已经都修好了」的声明。**


### 附录：AC1 规模实验的可复跑脚本

三个脚本，逐字如下（`min-of-3` + **交叉**执行——把每个格子摊到同一个墙钟窗口上，让负载尖峰
同时落在所有格子上，再由 `min` 丢弃尖峰：负载只会让一次运行**更慢**，不会更快）。
`pre` 指向改前检出，`post` 指向改后检出；`QUAY_READY_POOL_CACHE=0` 在**同一个 commit** 上
取改前那条路径，把「缓存」与「别的什么也变了」分开。

**① `rpc-ac1-scale.mjs`** —— AC1 字面要求的量（`analyzeTasks()` 单次耗时）。子集用**等距抽样**
（每 k 个取一个），不是「前 N 个」：真库的 ready 任务并非沿字母均匀分布，前 500 个文件里
**一个 ready 都没有**，而全库有 18–22 个 —— 那样两个子集差的就不只是**大小**，还有**成分**，
ratio 量到的是 ready 扫描而不是库读。抽样把状态配比按比例保留，并把配比**打印出来**让人核。

```js
// rpc-ac1-scale.mjs — Usage: node --experimental-strip-types rpc-ac1-scale.mjs <repo-root> <stride>
import * as fs from "node:fs"; import * as os from "node:os"; import * as path from "node:path";
const [repoRoot, strideRaw] = process.argv.slice(2);
const stride = Number(strideRaw);
const mod = await import(`${repoRoot}/plugin/scripts/ready-pool-check.ts`);
const all = fs.readdirSync(path.join(repoRoot, "tasks")).filter((f) => f.endsWith(".md")).sort();
const picked = all.filter((_, i) => i % stride === 0);
const subset = path.join(os.tmpdir(), `rpc-stride-${stride}`);
if (!fs.existsSync(subset) || fs.readdirSync(subset).length !== picked.length) {
  fs.rmSync(subset, { recursive: true, force: true });
  fs.mkdirSync(subset, { recursive: true });
  for (const f of picked) fs.copyFileSync(path.join(repoRoot, "tasks", f), path.join(subset, f));
}
const counter = (re) => picked.filter((f) => re.test(fs.readFileSync(path.join(repoRoot, "tasks", f), "utf8").split("---")[1] || "")).length;
const t0 = Date.now();
const r = mod.analyzeTasks({ tasksDir: subset, root: repoRoot, taskReadRef: "develop" });
console.log(JSON.stringify({ stride, n: r.scanned, ready_in_store: counter(/^status:\s*ready$/m),
  todo_in_store: counter(/^status:\s*todo$/m),
  cache: process.env.QUAY_READY_POOL_CACHE === "0" ? "off" : "on", ms: Date.now() - t0, pool: r.pool }));
```

**② `rpc-ac1-store.mjs`** —— 同一问题问到**真正携带 N 依赖的那个部件**（ref 读 + 解析）。
`analyzeTasks()` 的总时长里还含 O(worktree 数) 与 O(历史宽度) 的工作，两者在两个 N 上相同，
会把 ratio 稀释掉；这个脚本把它剥掉。同一份脚本跑两种代码状态：模块导出
`loadParsedTaskStoreAtRef` 就用它，否则就做改前那段内联的
`readTaskFilesAtRefBatch` + `parseTask`。

```js
// rpc-ac1-store.mjs — Usage: node --experimental-strip-types rpc-ac1-store.mjs <repo-root> <stride> <cold|warm>
import * as fs from "node:fs"; import * as path from "node:path";
const [repoRoot, strideRaw, mode] = process.argv.slice(2);
const stride = Number(strideRaw);
const mod = await import(`${repoRoot}/plugin/scripts/ready-pool-check.ts`);
const { parseTask } = await import(`${repoRoot}/plugin/scripts/task-schema.ts`);
const all = fs.readdirSync(path.join(repoRoot, "tasks")).filter((f) => f.endsWith(".md")).sort();
const ids = all.filter((_, i) => i % stride === 0).map((f) => f.replace(/\.md$/, ""));
const cached = typeof mod.loadParsedTaskStoreAtRef === "function" && process.env.QUAY_READY_POOL_CACHE !== "0";
const load = cached
  ? () => mod.loadParsedTaskStoreAtRef(repoRoot, "develop", ids)
  : () => { const m = new Map(); for (const [id, raw] of mod.readTaskFilesAtRefBatch(repoRoot, "develop", ids)) m.set(id, parseTask(raw)); return m; };
if (mode === "warm") load();
const t0 = Date.now();
const store = load();
console.log(JSON.stringify({ stride, n: store.size, path: cached ? "cached" : "uncached", mode, ms: Date.now() - t0 }));
```

**③ `rpc-ac1-driver.sh`** —— 交叉执行的壳（`min-of-3`；先跑一轮 warm-up 把缓存捂热，
使每个 cache-on 格子测到的都是**命中**）。

```bash
#!/bin/bash
PT=<pre-fix-checkout>; WT=<post-fix-worktree>; ONE=/tmp/rpc-ac1-scale.mjs
run() { local env=""; [ "$4" = off ] && env="QUAY_READY_POOL_CACHE=0"
  env $env node --experimental-strip-types "$ONE" "$2" "$3" 2>/dev/null | tail -1 | sed "s/^/$1 /"; }
rm -f /tmp/ac1-raw.txt
run warmup-pre "$PT" 4 on >> /tmp/ac1-raw.txt; run warmup-pre "$PT" 1 on >> /tmp/ac1-raw.txt
run warmup-post "$WT" 4 on >> /tmp/ac1-raw.txt; run warmup-post "$WT" 1 on >> /tmp/ac1-raw.txt
for rep in 1 2 3; do
  run pre      "$PT" 4 on  >> /tmp/ac1-raw.txt; run pre      "$PT" 1 on  >> /tmp/ac1-raw.txt
  run post-off "$WT" 4 off >> /tmp/ac1-raw.txt; run post-off "$WT" 1 off >> /tmp/ac1-raw.txt
  run post-on  "$WT" 4 on  >> /tmp/ac1-raw.txt; run post-on  "$WT" 1 on  >> /tmp/ac1-raw.txt
done
# 每个格子取 min，再算 ratio 与「t(2142)-t(536)」（后者把固定开销减掉，直接看 N 依赖那部分）
```

```bash
# ② 的调用（每个格子一次 warm-up + 一次实测；pre 与 post 用的同一份脚本）
node --experimental-strip-types rpc-ac1-store.mjs <pre-fix-checkout> 4 warm
node --experimental-strip-types rpc-ac1-store.mjs <pre-fix-checkout> 1 warm
node --experimental-strip-types rpc-ac1-store.mjs <post-fix-worktree> 4 warm
node --experimental-strip-types rpc-ac1-store.mjs <post-fix-worktree> 1 warm
```

## 5. 被自己的读数推翻：本文作者当场犯的两个错

这一节是刻意保留的——它们是「先盘载体再下结论」这条纪律的现成实例。

**错误一：把「fan-in 耗时几乎全是排队」说死了。**
分步耗时显示 8 个步骤合计中位仅 ~2 min（`scoped-gate` 76 s 占 53%、`doc-check` 29 s、
`merge-develop` 25 s），而单次 fan-in 端到端中位 **9.7 min**、p90 **154.6 min**、最大 693 min。
初稿据此断言「75% 以上是等待」。**但复核发现：最贵的 suite 步骤结构上不在这个载体里**
（见 §6），所以那段差值里既有排队也有 suite 本身，**不能全算等待**。真实结论只能是
「端到端时长远大于已记录步骤之和，缺口的构成尚未拆开」。

**错误二：把一个已修复的缺陷当成现存缺陷。**
初稿断言「机械 fan-in 不写 `complete` GateEvent（396 条 vs 940 次落地）」。按天拆开后：

| 窗口 | complete 事件 / git 落地 |
|---|---|
| 08-20 ~ 09-03 | **0%**（14 天全零） |
| 09-04 ~ 09-14 | **74% – 100%** |

`gap-mechanical-fan-in-writes-no-complete-gateevent` 已于 09-02 落地实现、09-04 翻 done。
**全期聚合掩盖了一次真实修复。** 残留的是「修复后仍有约 20% 落地不写该事件」，
这是个小得多、且形状不同的问题。

⊢ 两个错误同源：**都在没有分时间窗、没有核对载体覆盖面的情况下，把聚合数字当成当前状态。**

## 6. 载体自身的三个完整性缺口（已按实测修正表述）

| 缺口 | 实测 | 影响 |
|---|---|---|
| `worker-outcome.final_state` 有死取值 `landed` | 全库 **1** 条（2026-08-28），真实成功态是 `completed`（09-13：45 条 vs git 落地 48 次） | 拿 `landed` 统计吞吐会得到「吞吐 ≈ 0」 |
| `fan-in-step-trace` 孤儿 `step-end` | 2,097 / 7,204 = 29%，**100% 集中在 4 个 step**（`ac-precheck` 697、`suite-start` 697、`suite-end` 695、`suite-skip` 15），其余 8 个步骤孤儿率 **0%** | 这 4 步的 `step-begin` 自 08-28 改写去 per-run 文件而 `step-end` 仍写共享载体 ⇒ **最贵的 suite 步骤在该载体里结构上不可测时长**；已 done 的 `gap-fan-in-step-trace-suite-step-stopped-writing` 认为这批步骤已整体停写，与盘上实际（end 仍在写）不符 |
| `complete` GateEvent 覆盖率 | 修复后 74–94%，非 100% | 用它统计完成数会少 6–26% |

## 7. 还能做什么

**数据已就位、可立刻做：**
1. **排队论建模**——`fan-in-lock-events` + `fan-in-merge-lock-events` + 端到端时长，
   用 Little's law 回答「加并发能否提吞吐，还是只会加长队列」。§1 与 §5 都把矛头指向这里，
   优先级最高。
2. **验证的边际收益**——`gate-events` 96,779 条带 pass/fail 的判定 × `checker-cost`，
   算**每拦下一个缺陷的成本**。这正是 ADR-005「验证是绑定约束」从来只有定性论证的那个量。
3. **结晶半衰期**——规则落笔日期 → 其可执行强制落地日期，git 可直接算；把 ADR-004
   的「散文会被侵蚀」从故事变成分布（中位多少天、多少条至今无产物）。
4. **返工预测因子**——§3 的返工次数对任务属性（Touches 宽度、有无 `goal_ac`、shape、
   立案者）回归。

**需要先补仪器：**
5. **缺陷发现延迟**——每个 gap 任务的「缺陷引入时刻（git blame）→ 立案时刻」配对，
   给硬规则「频率 × 静默」一个定量版本。现无现成字段。
6. **谁先发现**（人 / 循环 / 套件）——`维度边界与结晶.md` §2.1 的 n=5 需要扩到几百例，
   要从任务体抽取发现路径。

**结构上做不了：** 08-11 之前无遥测；连续数学（Fisher / 本征维度 / ρ）这次没有任何一个
分析需要它，顺带又给 ADR-006 添一条负面证据。

## 附：可复跑锚点

- 落地数直接量：`git log develop --format='%ai|%s' | grep -E '翻.*done|→ *done'`（940）
- 套件时长：`.quay/verification-round.jsonl` 的 `startedAt`/`durationMs`/`laneCount`
- 熔融↔结晶：`git log develop --numstat`，按 `tasks/` / `adr/` / `*.md` / `*.{ts,js,mjs,sh,py}` 分类
- 返工：`.quay/worker-outcome.jsonl` 按 `task` 计数
- 验证税：`.quay/checker-cost.jsonl` 的 `name`/`ms`/`at`
- ⚠️ `fan-in-step-trace.jsonl` 的 `epoch` 字段单位是**秒**不是毫秒（初稿在此栽过一次）
