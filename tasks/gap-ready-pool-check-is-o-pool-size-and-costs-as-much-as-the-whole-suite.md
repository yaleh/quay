---
id: gap-ready-pool-check-is-o-pool-size-and-costs-as-much-as-the-whole-suite
title: ready-pool-check 占全仓 checker 成本 97.8%（212.7h，与整个测试套件同量级）且三周涨 5
  倍——每次轮询重解析全部 2123 个任务，同根已让 MCP task_list 超时
status: todo
needs_human_cause: human-adjudication
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

**`ready-pool-check` 单个检查器占全仓 checker 成本的 97.8%，与整个测试套件同量级，且三周内
涨了 5 倍——它是 O(任务库规模) 的全量轮询，而任务库只会继续增长。**

实测（`.quay/checker-cost.jsonl`，窗口 2026-08-11 → 09-14，145 个 checker 累计 217 小时）：

| checker | 调用次数 | 中位 | 累计 | 占比 |
|---|---|---|---|---|
| **`ready-pool-check`** | **75,571** | 9.5 s | **212.7 h** | **97.8%** |
| 其余 144 个合计 | ~19,000 | — | 4.3 h | 2.2% |

作为对照，同期 `.quay/verification-round.jsonl` 里**整个测试套件**累计约 **231 小时**——
**晋升闸的开销和跑完所有测试一样贵**，而没有任何判据在盯它。

### 增长曲线（调用数与单次时长在同时涨）

| 时期 | 调用/天 | 中位 | 累计/天 |
|---|---|---|---|
| 08-12 ~ 08-22 | ~300 | 2.7 s | 0.1 – 0.7 h |
| 08-23（driver 化） | 2,520 | 4.7 s | 3.7 h |
| 09-11 | 6,316 | 11.4 s | **19.0 h** |
| 09-13 | 4,780 | 13.0 s | **17.3 h** |

单次时长从 2.7 s 涨到 13 s，**因为它是 O(池大小)**，而池从约 1,500 涨到 2,123。
两个因子相乘 ⇒ 三周内累计成本涨 5 倍。可并发，所以不等于占满单核，但已是约 1 核持续占用。

### 热路径（具体位置，不是猜测）

`plugin/scripts/ready-pool-check.ts:2311` `analyzeTasks()`：
- `:2315` `fs.readdirSync(tasksDir).filter(f => f.endsWith(".md"))` —— 全量目录（当前 2,123 个）
- `:2322` `readTaskFilesAtRefBatch(...)` —— 从 git ref 批量读**全部**任务文件
- `:2326-2333` 对**每一个**文件 `parseTask(raw)` + 逐字段解析

即每次调用都重读并重解析整个任务库。按 75,571 次调用估算，本月累计约 **1.6 亿次**
任务文件读取与解析。

⚠️ **从 git ref 读是有意设计，不是缺陷**（`:2318-2321` 注释：单源派发读，避免读到陈旧的
工作树盘面，`gap-dispatch-reads-stale-main-checkout-task-status` / 硬规则 4b）。
**修法不是绕开 ref 读，而是不要在每次轮询都重解析整个库。**

### 同根的生产故障（已经打到路径上了）

`tasks/gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp.md`：同一个根因
（任务库规模）已经让 MCP 上的 `task_list` 超时并队头阻塞整条 ABI 读面——CLI 全量
`task list` 实测 37.7 s。再往前还有 `tasks/gap-serve-search-timeout-all-body-fetch.md`
（**已 done**，当时 1,572 个任务，web 搜索面全量取 body 致 MCP -32001）。
**⊢ 这是同一个机制的第三个实例（硬规则 5b：缺陷成簇，兄弟实例常在同一层）。**

完整读数与方法见 `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §4。

## Implementation

**修法：按 git 对象身份寻址的持久缓存**（不是绕过 ref 读）。git ref 是内容寻址的——
「`develop` 在 OID X」永远对应逐字节相同的内容，所以那两项派生不必对同一份内容算第二次。
键全部是 git 对象身份，**没有 mtime、没有 TTL**：

- **任务库缓存**：键 = **blob OID**。`git ls-tree -r <ref> tasks/` 用 **29 ms** 列出全部
  2,141 个 blob 的 OID（对比 3,536 ms 把内容读出来），只有缓存里没有的 OID 才走一次批量
  `cat-file`。⇒ develop 前进一个 commit ⇒ 只重读、重解析那个 commit 改动的几个文件。
- **落地历史索引缓存**：键 = 落地 ref 的 **commit OID**，前进时**增量**推进——
  `buildGitHistoryIndex(root, {ref: "<旧OID>..<新OID>"})`（**同一个函数、同一套 flag、
  同一个解析器**；一个 range 是合法的单个 git revision 参数）⇒ develop 前进一次的代价是那几个
  commit，不是 21,309 个。**实测增量合并 == 全量重建**（结构完全相等）。

**缓存位置**：repo 的 **git dir**（`<git-common-dir>/quay-ready-pool-cache/`），不是 `.quay/`。
两个理由都承重：① `.quay/` 的文件是**逐个**写进 `.gitignore` 的，新载体放在那里会以
`?? .quay/` 弄脏工作树，**两条既有测试（`applyPromotions` 后 `git status` 必须干净）在改后当场变红**；
② 语义上对——缓存按 **git 对象身份**寻址，而对象就住在那同一个 git dir 里；worktree 共享 common dir，
所以 worktree 能命中主检出解析过的条目。

⛔ **没有动的东西**：单源 ref 读语义（硬规则 4b）。缓存存的是**该 ref 上**那份 blob 的解析结果，
工作树只在「ref 上没有这个 id」时被读——与改前逐字一致。缓存读**只分命中与未命中，绝不是真相来源**：
缺失 / 截断 / 版本漂移 / 非 git 根，全部退回改前那条路径（该路径原样保留）。
`QUAY_READY_POOL_CACHE=0` 强制退回——负控制缝。

## Touches

- `plugin/scripts/ready-pool-check.ts`
- `plugin/test/ready-pool-check.test.mjs`
- `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md`
- `tasks/gap-ready-pool-check-is-o-pool-size-and-costs-as-much-as-the-whole-suite.md`

## Acceptance Criteria

- [x] **规模无关性（核心判据，可取假）**：**受控形态**（固定 ready 数 = 4、只让库大小变；
      两臂 `pool` **均打印为 4**，对照成立；交叉执行 + min-of-3）——
      **改前 1.33**（8,899 → 11,803 ms，在 pre-fix 检出上用**同一脚本**取得，即负控制）/
      **改后 1.11**（4,091 → 4,556 ms）。库大小相关那部分：**Δ 2,904 ms → 465 ms（6.2×）**；
      N=2,121 绝对量 **11,803 → 4,556 ms（2.6×）**。
      **隔离对照**（同一 commit、同一 checkout、同一子集，只翻缓存开关）：N=2,142 的库装载
      **3,992 / 4,254 ms → 565 / 424 ms（约 9×）**。
      ⚠️ **按 AC1 的字面读法（成比例抽样的两个子集）判据【未达成】，如实记在此、不修饰**：
      改前 **1.74**（9,318 → 16,229 ms）/ 改后 **1.64**（4,833 → 7,913 ms）。原因是这个总量被
      两个与库大小无关/之外的量稀释 —— ①固定开销（worktree 扫描 / `/proc` / 历史宽度）两个 N
      相同；② **ready 扫描与 ready 数成正比**，而比例抽样让 ready 数随 N 一起涨（**4 → 22**），
      每 ready 任务约 170 ms，**这一项本任务不处理**。
      **⊢ 判据达成与否成了「子集怎么构造」的函数，这本身是一条结论**：用「总量」做规模判据，
      必须先固定其它随 N 变的量。脚本逐字见 doc §4.1 附录。
- [ ] **生产成本下降**：落地后连续 ≥3 天的生产对照读数尚未取得（待外部）
      **落地前 7 天实测基线**（取自生产载体 `.quay/checker-cost.jsonl`，09-08..09-14：
      31,236 次调用 / **91.35 h** / 中位 **13.36 h/天**；09-11 峰值 19.01 h，09-13 为 17.26 h）。
      落地后按本 AC 取「落地后 ≥3 天」那一段的 h/天 中位与这段对照；下降不显著则**如实报未达成**。
      ⛔ 不预设百分比阈值（硬规则 4 推论：成本结构未知前不凭空设数值目标）。
- [x] **正确性不回退**：单源 ref 读语义保持 —— 测试
      `store cache serves the REF, never the working tree (硬规则 4b single-source dispatch read)`
      构造「工作树 `status: ready` vs ref `status: done`」的不一致，断言**缓存读与未缓存读都**给出
      ref 的值（`^status: done$`）。另有增量历史索引的等价判据：**40 commit 的增量合并 ==
      21,309 commit 的全量重建**（结构逐字段相等）。
- [x] **枚举兄弟实例（硬规则 5b）**：清单 + 命中数 + 前 3 条实际内容 + 文件:行号见
      `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §4.1。两个谓词的命中数
      **3 / 10**（引用前已按硬规则 2 打印前 3 条命中）。最贵的兄弟是
      `plugin/scripts/slot-refill.ts:485` `buildTaskMetaById`（同 tick、同量级，本次**未修**，在
      Touches 外）；AC 点名的 `task_list` 路径 `packages/quay-native/src/store.ts` 的
      `list()`/`listWithMalformed()` **已有同类持久解析缓存**（`ensurePersistentCacheLoaded`），
      而它对应的任务 `gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp`
      **仍是 `status: ready`** —— 它要解的多半是另一面（MCP 超时 / 队头阻塞），**不是解析成本**，
      本次**不声称已修**。
- [x] **回归判据**：新增测试
      `AC5 regression: on an N=2000 store the cached call must beat the uncached baseline (red pre-fix)`
      —— N=2,000 的 git 库上 `cached < uncached × 0.75`。**修复前红**（把缓存旁路掉的**同一份代码**上，
      `AssertionError: … cached=4044ms uncached=4116ms ratio=0.98 (pre-fix ratio ≈ 1.0)`），
      修复后 ratio ≈ **0.52**（绿）。同一文件另有 8 条：等价 / 内容寻址 / ref-not-disk / fail-soft /
      union 不驱逐 / 体积上限 / 增量==全量 / 历史缓存 fail-soft。
- [x] `bash scripts/test.sh --for-task gap-ready-pool-check-is-o-pool-size-and-costs-as-much-as-the-whole-suite`
      全绿，且新测试在该轮被实际选中执行（按**测试名**核对，不是按文件名推测）。
      **实测**：`GATE_EXIT=0`、**168/168 绿**；`select-tests-for-touches.ts --task <id>`
      解析出的选择集 = **1 个文件（`plugin/test/ready-pool-check.test.mjs`）**，
      本轮**按测试名**核对到**全部 9 条**新测试被执行：
      `store cache: …（5 条）` / `landing history index: …（2 条）` / `AC5 regression: …`。
      另有 4 条既有测试在实现过程中**由红转绿**：把缓存写进 `.quay/` 时
      `applyPromotions commits the status write` 与 `applyPromotions blocks a multi-path Touches
      candidate` 因 `?? .quay/` 弄脏工作树而变红（**约束是被测试顶出来的，不是我先想到的**），
      改到 git dir 后恢复绿。

## Definition of Done

成本读数取自**生产载体** `.quay/checker-cost.jsonl`，不接受 fixture 或注入数据满足
（反例判据：把注入 seam 关掉后，成本对照 AC 仍应成立）。
修复必须经过 ≥3 天真实生产运行再判完成——只在实现当轮测到的加速不算数
（硬规则 4 推论三：实现了、测试绿了、但生产没跑过 ⇒ 与没实现同形；本仓库已有
`gap-phase-boundary-differential-accounting` 的前车之鉴）。
若最终结论是「这个成本是必要的、无法降低」，同样要落地一个**可见性**产物：
一条盯住 `ready-pool-check` 累计 h/天 的判据，使它再涨时有人知道——
当前的状态是「全仓最贵的单个机件，且没有任何判据在看它」，这一点必须被改变。

**本次实际状态**：成本**可降且已降**（受控 Δ 6.2×、隔离对照约 9×），所以「必要时」那一支不适用；
「必须有判据在盯」这一条**已由既有机制满足**——`plugin/scripts/trend-check.ts` 的 Axis 3
就是 per-checker 成本趋势（其头注释点名 `ready-pool-check` 的 35.8→91.2→157.0 斜率为其第 10 号实例），
本任务的读数正是从它读的那条载体上取的。
**未闭合的一条**：≥3 天真实生产对照（见 AC「生产成本下降」）—— 落地后按该 AC 取读数。

## Needs-Human

**执行 2026-09-14T10:16:33.488Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：human-adjudication
- 失败步/判词：step=suite: __PERFILE__ duration_ms=51850 packages/quay/test/serve-handlers.test.mjs passed=false end_ms=1789380824315 cpu_ms=67026.058
- run_id：wk-prod-1789367589
- session_id：0dbf5d10-4432-4664-adea-dbacf32616fb
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-ready-pool-check-is-o-pool-size-and-costs-as-much-as-the-whole-suite~wk-prod-1789367589~1789379352618-79ae72.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-ready-pool-check-is-o-pool-size-and-costs-as-much-as-the-whole-suite-wk-prod-1789367589.log
