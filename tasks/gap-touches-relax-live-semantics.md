---
id: gap-touches-relax-live-semantics
title: mode=live 的放宽放行语义不存在：谓词在 live 下与 shadow 行为相同（配置写了但不生效），阈值边界 / never_relax
  / 名额 / 不连锁 / 过宽通配 / shared_files 短路 / 等待读不到即阻塞 / 放行写账本 / 不绕过其它谓词 / 取假形态
  全未落地（GOAL-037 AC-366 生效面）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-touches-relax-off-parity-predicate
  - gap-relaxed-dispatch-ledger-and-merge-cost-report-absent
goal_ac: AC-366
---
**type:** execution

## Proposal

**缺口（GOAL-037 方案的 P2 生效面）**：`mode=live` 的**放宽放行语义在代码里不存在**。AC-365 的谓词 `touchesDisjointOrAged` 只覆盖 off（逐候选同形）与 shadow（只标 `wouldRelax`、不放行）两态，且 AC-365 的 Plan 第 1 条明写「`mode === "live"` ⇒ 本条**不实现**放行语义（AC-366 的活），行为与 shadow 相同（⛔ 不得在 live 下真的放行——那会让取假形态变绿）」。`plugin/scripts/driver-filters.ts` 里没有任何 live 放行分支，`.quay/relaxed-dispatch.jsonl` 也没有任何写入者接到派发路径上（AC-363 只建了**写入器**，不接线）。

**为什么这是缺口而不是「以后再说」**：没有它，人按 GOAL-037 的生效步骤在目标项目把 `mode` 设为 `live` 并重启 worker driver 之后，**行为与 off 逐字节相同**——配置写了但不生效，与「系统正常」同形（硬规则 3b 的形态）；同时 AC-367 的自动收紧要读放宽账本（「放宽的任务比不放宽的多花多少」），**没有真实放行 ⇒ 账本恒空 ⇒ 闭环无输入**。本条是 GOAL-037 从「人择机开启」到「真的会放宽」之间唯一缺失的那一步。

**机制现状（读代码得出，非推断）**：
- 谓词与组合点：`TASK_FILTERS`（`plugin/scripts/driver-filters.ts:1258-1264`）；唯一消费点 `applyTaskFilters`（:1266-1271，`candidateIds.filter((id) => preds.every((p) => p(id)))`）。两个调用位点：`worker-driver.ts:6639`（全五谓词）、`promotion-driver.ts:925-929`（**names 子集** `["retryCapNotExhausted","notNeedsHuman"]` ⇒ promotion 面**不含** touches 谓词，本条对 promotion 零影响）。
- 重叠面**已经算好**且可复用：`checkTouchesPair(parsedA, parsedB, expand)` 返回 `{disjoint, overlaps, reason}`（`touches-orthogonality-check.ts:201-219`，`overlaps` 已 `sort()`，由 `filesDisjoint` :191-196 产生）。
- **过宽通配的单一实现已存在**：`isOverbroadDeclaration(glob)`（`touches-orthogonality-check.ts:68`，语义 = 锚定深度：首个通配段之前须有 ≥2 个具体段；`**` / `*` / `**/*.js` / `packages/**` 皆过宽）——AC-366(e) 必须用它，⛔ 不写第二份判据。
- 等待时长的现成载体：`.quay/task-status-events.jsonl` 的 `to:"ready"` 事件。⛔ 本条**不新写第三个** ready 时刻解析器：复用 AC-362/365 落下来的那一处（AC-362 的 Plan 指定 kernel 的 `readTaskStatusTransitions`，`packages/quay/src/kernel/task-transition.ts:967`；另有一处既有实现 `duration-report.ts:294` 的 `readTaskStatuses()` 返回 `readyAtMs`，其 `at`/`recordedAt`/`ts` 三种方言处理见 :298-303）。**以 AC-362/365 实际落地的导出为准**（见适配条款）。
- 放宽账本的写入器与五键形状由 AC-363 落地（`plugin/scripts/relaxed-dispatch-ledger.ts`：`appendRelaxedDispatch(root, rec)`、`RELAXED_DISPATCH_REL`、`readRelaxedDispatchLedger(root) ⇒ {present, records, malformed}`）。
- 时钟：`FilterContext`（:42-49）**没有**时钟字段。本文件既有纪律是「backoff 按候选、在过滤那一刻取**新鲜**的 `Date.now()`，⛔ 不预算进轮起点快照」（:64-66）——本条的等待判定同理，并需要一个**可注入**的 now 才能测边界。

**放宽的判据（合取；实现与测试共用）**：候选在 live 下被**放行**当且仅当：① 等待达阈值（`waitedMinutes >= after_minutes`；读不到即**阻塞**）；② 重叠面不含 `never_relax`；③ 名额未满（当前被放宽派发的在飞任务数 `< max_relaxed_inflight`）；④ 挡住它的**每一个**在飞任务本身都不是被放宽派发的（**不连锁**）；⑤ 候选自身 Touches 不含过宽通配；⑥ 若重叠面**全部**落在 `shared_files` 内 ⇒ **视为不冲突，立即放行且不要求等待**（短路：不占名额、不写账本——它不是一次放宽派发）。**任何一项读不到 ⇒ 保持阻塞**（缺值 ≠ 0 ≠ ∞，硬规则 6 + 3b）。

<!-- dedup-ref --> 追踪与去重结论（机制去重已做，非症状去重）：同 goal 已立案四条 —— `gap-worker-round-filter-trace-attribution`（AC-362，filter_trace 归因）、`gap-touches-relax-config-block-unread-unvalidated`（AC-364，配置读/校验）、`gap-relaxed-dispatch-ledger-and-merge-cost-report-absent`（AC-363，账本与报告）、`gap-touches-relax-off-parity-predicate`（AC-365，off/shadow 谓词），**没有任何一条声明 `goal_ac: AC-366`**（`task_list` 全量检索 + 四条逐条 `task_get` 核对）。四条的验收对象分别是观测面 / 配置面 / 账本面 / off-shadow 谓词面，**都不实现 live 放行语义**。合并候选检查用现成机件跑过：`node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --touches plugin/scripts/driver-filters.ts --touches plugin/scripts/worker-driver.ts --touches plugin/test/touches-relax-live-predicate.test.mjs --touches tasks/gap-touches-relax-live-semantics.md --json` ⇒ `peers: [gap-touches-relax-off-parity-predicate（共享 plugin/scripts/driver-filters.ts）、gap-worker-round-filter-trace-attribution（共享 plugin/scripts/driver-filters.ts + plugin/scripts/worker-driver.ts）]`、`mentions: [AC-363 条、AC-364 条]`。判定 **separate（独立立案）**：本条与两条 peer 共享的文件正是**同一条链上的先后环节**（365 建谓词 → 本条加 live 分支；362 建 trace → 本条复用其条目），共享不产生额外并行损失（调度器本就按 Touches 串行），而合并会把两条 AC 的判据面耦合成一个任务。

## Plan

1. **live 分支（`plugin/scripts/driver-filters.ts`）** —— 在 AC-365 的 `touchesDisjointOrAged` 内实现 `mode === "live"` 的放行：
   - **off / shadow 的既有行为一字不改**（AC-365 的同形测试必须继续绿）：只新增 live 分支，⛔ 不动 `applyTaskFilters` 的返回表达式（`preds.every` 一行不改）、⛔ 不改 `TASK_FILTERS` 的组成。
   - **每轮一次**读配置（AC-364 的 `loadTouchesRelaxConfig(root)`），⛔ 不逐候选重读盘；`mode !== "live"` ⇒ 直接走既有分支。
   - 逐候选（live）：
     a. 取候选与每个在飞对手的 `parseTouches` + `checkTouchesPair(...).overlaps`（**复用**，⛔ 不重写交集计算）；
     b. **结构性条件先判**（它们是其余条件的输入）：候选无/空 `## Touches` ⇒ 阻塞；候选任一声明命中 `isOverbroadDeclaration` ⇒ 阻塞（条件 id `no-overbroad-glob`，AC-366(e)）；
     c. 对手的 Touches 读不出 ⇒ 该对手**不可判定 ⇒ 阻塞**（fail-closed，⛔ 不当作无重叠、⛔ 不当作已算出的空集）；
     d. **`shared_files` 短路**：若存在重叠对手，且**每一个**重叠路径都在 `shared_files` 内、且无一命中 `never_relax` ⇒ **立即放行**（不等等待、不占名额、不写账本）——AC-366(f)；
     e. 否则按合取逐条判，**首个不满足者**记为该条目的 `relaxBlockedBy`（id 稳定、顺序 = AC 标题枚举：`waited-enough` → `not-never-relax` → `quota-available` → `blocker-not-relaxed` → `no-overbroad-glob`，结构性前置 `candidate-declares-touches` / `overlap-known` 先于它们）。
   - **等待判定**：`waitedMinutes` 来自 AC-362/365 落下来的同一处读数；为 `null`（该任务在 status-events 账本无 `to:"ready"`）⇒ **条件为假（阻塞）**，⛔ 不得 `?? 0`、⛔ 不得 `?? Infinity`。
   - **名额与「不连锁」的读数源 = 放宽账本**：`readRelaxedDispatchLedger(root)`（AC-363）⇒ `relaxedTaskIds`；`relaxedInFlight = ctx.inFlight ∩ relaxedTaskIds`；`quota-available` ⇔ `relaxedInFlight.length < max_relaxed_inflight`；`blocker-not-relaxed` ⇔ 候选的**每一个**重叠对手 ∉ `relaxedTaskIds`。账本**不存在** ⇒ 0 条（`present:false`，⚠️ 与 `records:[]` 不同形，但对计数同值）；账本出现 `malformed > 0` ⇒ **无法归因 ⇒ 阻塞**（fail-closed）。
   - ⛔ `after_minutes` / `max_relaxed_inflight` / `never_relax` / `shared_files` **全部来自 AC-364 读出的配置**，代码里**不写字面量阈值**；`mode` 非 live 时这些值一律不参与（AC-365 的同形纪律）。
2. **时钟注入**：`FilterContext` 增加**可选** `nowMs?: number`（缺省 `Date.now()`；`makeFilterContext` 两个既有构造点不传即行为不变）。⛔ 不改 `computeDispatchExclusion` 的快照语义（:64-66 的既有纪律）——now 在**判定那一刻**取一次。live 的等待判定与账本的 `dispatchedAt` 都用它。
3. **账本写入（复用 AC-363 的写入器，⛔ 不写第二份）**：新增导出 `recordRelaxedDispatch(root, entry, { nowMs })`（driver-filters.ts），把该候选的放宽事实映射成 AC-363 的 `RelaxedDispatchRecord` 五键后调 `appendRelaxedDispatch`：
   - `task` = 条目 task；`blockers` = **本条目记下的那个对手 id 的单元素数组**（⚠️ AC-362 的 trace 形状是**单 blocker**，⛔ 本条不得凭空把它扩成多对手）；`overlapFiles` = 实测交集（沿用 `checkTouchesPair().overlaps` 排序，即 AC-362 已排除候选自身任务文件后的那份）；`waitedMinutes` = 等待读数（**有限非负**；⚠️ 若实现走到这里而等待读数不合法，按 AC-363 的 fail-closed 拒写并留痕，⛔ 不折成 0）；`dispatchedAt` = `nowMs` 的 ISO（⛔ 不用裸 `Date.now()`——测试不可判）。
   - 路径字面量**只**经 AC-363 的 `RELAXED_DISPATCH_REL`（⛔ 不写第二个 `.quay/relaxed-dispatch.jsonl` 字面量，硬规则 1；也避免 `carrier-registry-completeness` 的双向契约漂移）。
   - **谓词保持纯**：⛔ 不在 `predicate(ctx)(id)` 内做 I/O；放行时只把事实写进 trace 条目（`relaxed: true` + 三键），写入由调用方调 `recordRelaxedDispatch`。
4. **接线（`plugin/scripts/worker-driver.ts`）**：派发环在 `spawnSelected(sel)` 之前取该候选的 trace 条目，`relaxed === true` ⇒ 调 `recordRelaxedDispatch(rootDir, entry, { nowMs: Date.now() })`；off/shadow 下该条目永不 `relaxed` ⇒ 零写入（AC-365(c)「影子期不写账本」继续成立）。⛔ 不改派发决策的输入（候选列表 / ctx / names）、⛔ 不改 `filtered-empty` 的 stop_reason 判据。
5. **测试 `plugin/test/touches-relax-live-predicate.test.mjs`**（新，首行 `// @test-group engine`）：**真实** `applyTaskFilters` / `TASK_FILTERS` + 真实 fixture 任务目录（`tasks/*.md` 真写盘、真 `## Touches`）+ 真实 fixture `.quay/config.yml` + 真实 fixture `.quay/task-status-events.jsonl`（ready 事件）+ 真实 fixture `.quay/relaxed-dispatch.jsonl`，**注入时钟**（`FilterContext.nowMs`）。⛔ 不 mock 谓词、⛔ 不 spawn driver、⛔ 不跑 suite；断言读的是**从载体文件回读并 `JSON.parse`** 的内容（账本文件），不是内存对象。fixture root 用 `fs.mkdtempSync`、登记 `TMP_ROOTS`、顶层 `after()` 统一删（`tmp-leak-pairing-check` 要求）。
6. **可跑性与时限**：`expandDeclaredTouches` 走纯 fs 遍历、不 spawn git；fixture 根上的过滤是毫秒级 ⇒ 55s 上限应有余量（实测值写进 Evidence）。
7. **不越界**：⛔ 不改 AC-364 的 `touches-relax-config.ts`、⛔ 不在 quay 自己的 `.quay/config.yml` 写 `touches_relax`（GOAL-037「不在 quay 自身启用」）、⛔ 不改 `applyTaskFilters` 的返回表达式、⛔ 不动 `slot-refill.ts`。

⚠️ **适配条款**：若 AC-362/363/364/365 落地后的导出名 / 键名 / 条目形状 / 条件 id 与本节不同，**以其导出为准**并把差异写进 Evidence；⛔ 不得为了让测试变绿而发明新条件、改动配置语义或另起一份读数实现。（本段不含任务 id，故不构成依赖声明。）

## Acceptance Criteria

- [x] AC1 — 测试落地且通过（AC-366 判据面逐字）：`timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-live-predicate.test.mjs` **exit 0**，文件带 `// @test-group engine`。附实际命令、输出尾部与实测耗时（秒）。
- [x] AC2 — (a) 阈值边界（注入时钟）：`waitedMinutes` 恰等于 `after_minutes` ⇒ 候选**被保留**；恰少一分钟 ⇒ **被滤掉**。两次读数均从真实 `applyTaskFilters` 的返回数组逐字打印；并附两个 fixture 的 ready 事件时刻与注入的 `nowMs`。
- [x] AC3 — (b) `never_relax`：重叠文件命中 `never_relax` ⇒ **阻塞**（条目 `wouldRelax === false`、`relaxBlockedBy === "not-never-relax"`、账本零写入）；**负控制**：把该 fixture 的 `never_relax` 换成一条无关条目 ⇒ 同一候选**被保留**（证明判据真的读了配置，不是恒阻塞）。附两份配置与两次结果。
- [x] AC4 — (c) 名额：当前被放宽派发的**在飞**任务数 = `max_relaxed_inflight` ⇒ **阻塞**（`relaxBlockedBy === "quota-available"`）；改为「已放宽数 + 1」⇒ **放行**。⚠️ fixture 里这些已放宽的在飞任务**不得与候选重叠**（否则 (d) 先命中，测的就成了 (d)）。附账本行、两份配置与两次结果。
- [x] AC5 — (d) 不连锁：挡住候选的在飞任务本身有放宽账本记录 ⇒ **阻塞**（`relaxBlockedBy === "blocker-not-relaxed"`）；**负控制**：从 fixture 账本里删掉该在飞任务的记录（其余不动）⇒ 同一候选**被保留**（证明该条件真的读了账本，不是恒真/恒假）。附两次账本字节与结果。
- [x] AC6 — (e) 过宽通配：候选 `## Touches` 含 `isOverbroadDeclaration` 判为过宽的声明（如 `packages/**`）⇒ **阻塞**（`relaxBlockedBy === "no-overbroad-glob"`）；**负控制**：换成 ≥2 段锚定的精确 glob（如 `packages/quay/src/gate/*.js`）⇒ 其余条件都满足时**被保留**。附两条声明、判据输出与结果。
- [x] AC7 — (f) `shared_files` 短路：候选与在飞对手的重叠**全部**落在 `shared_files` 内，且注入的 `waitedMinutes` **远小于** `after_minutes`（测试内显式断言 `waitedMinutes < after_minutes`）⇒ **立即放行**（不被滤掉）；且该次放行**不写账本**（行数/文件存在性与基线相同）——它「视为不冲突」，不是一次放宽派发（该解释写进 Evidence）。附 fixture、等待读数与账本读数。
- [x] AC8 — (g) 等待读不到 ⇒ 阻塞且**不伪装**：候选在 fixture status-events 账本里**没有** `to:"ready"` 事件 ⇒ ①该候选**被滤掉**；②其 trace 条目 `waitedMinutes === null` 且**显式断言 `!== 0`**（硬规则 6/3b：缺值不得与「等 0 分钟」同形）；③**注入**：把 `null` 当 `Infinity`（如 `?? Infinity`）⇒ 该用例变红（证明 (g) 对「当作无穷」有判别力）。附条目 JSON 与红输出。
- [x] AC9 — (h) 放行时账本记一行、形状与内容逐字正确：构造一次**真实放宽放行**（全部条件满足、走等待路径而非 (f) 短路）⇒ 从 `.quay/relaxed-dispatch.jsonl` **回读**恰好一行，恰含 `task` / `blockers` / `overlapFiles` / `waitedMinutes` / `dispatchedAt` 五键，取值与 fixture 事实逐字一致（`blockers` 含该对手 id；`overlapFiles` 等于实测交集；`waitedMinutes` 等于注入时钟算出的等待；`dispatchedAt` 等于注入时钟）。**负控制**：(b)–(e) 四个阻塞用例各跑一遍后该账本**零写入**。附账本逐字行与两次读数。
- [x] AC10 — (i) 其它谓词不被绕过：为 `depsSatisfied` / `retryCapNotExhausted` / `notNeedsHuman` **各**造一个「touches 面本可放宽」但被该谓词挡住的候选 ⇒ 三个都**不在** `applyTaskFilters` 的返回集合内；且其中至少一个的 trace 条目 `wouldRelax === true`（证明放宽判据为真、是**组合**把它拦住的，不是放宽判据本身没通过）。附三条条目与返回集合。
- [x] AC11 — (j) 取假形态（真红并留痕，⛔ 注入不得留在落地代码里）：① 把 live 分支写成**恒放行** ⇒ 本测试变红；② **逐条**删除每个放宽条件各注入一次（至少 `waited-enough`、`not-never-relax`、`quota-available`、`blocker-not-relaxed`、`no-overbroad-glob`），每次**对应用例**变红。各附非零退出码 + 失败断言原文；恢复后 `git status --porcelain` 只含本条 Touches 内的预期改动、落地 diff 与该测试最终内容一致。附实际注入清单（做了哪几次、每次哪条用例红）。
- [x] AC12 — 静态面与不越界：① `bash plugin/scripts/capability-catalog.sh --summary` 报 `0 unclassified`（本条**不新增** `plugin/scripts/*.ts`，如实说明；若实现确需新脚本，则必须成组声明六表并把 `plugin/scripts/capability-catalog-declarations.json` 列进 Touches）；② `git diff` 证明 `applyTaskFilters` 的**返回表达式一行未改**（放宽只改 touches 谓词自身的返回值）；③ promotion 面零影响：附 `plugin/scripts/promotion-driver.ts:925-929` 的 names 子集代码与「不含 touches 谓词」的结论；④ `bash scripts/test.sh plugin/test/driver-filters.test.mjs plugin/test/driver-runtime-s01.test.mjs` **exit 0**（既有谓词列表 pin 与派发决策不回归；名字序列以 AC-365 的落地态为准）；⑤ `git diff -- .quay/config.yml` **空**（不在 quay 自身启用）。附五条命令、退出码与输出。
- [x] AC13 — 读数不新写第二份实现：① `grep -rn '\.quay/relaxed-dispatch\.jsonl' plugin/scripts/*.ts` 的**字面量**命中唯一在 AC-363 的模块内，其余引用（含本条的写入点）一律走其导出的 `RELAXED_DISPATCH_REL`；② `.quay/task-status-events.jsonl` 的 ready 时刻读取**复用** AC-362/365 那一处，`grep -c` 证明本条未新增第二个解析器。附两处 grep 与三处调用的逐字代码。

## Definition of Done

真实落地 = **同一个真实 `applyTaskFilters` 在 `mode: live` 的 fixture 上真的把候选放行、并真的把一行账本落进载体文件**，且 (a)–(g) 各条件的**判别读数**（边界双向、负控制、注入红）都真实取到 —— 不是「单测绿了」，也不是「内存对象里有这个字段」。

四条逐一对上：① 新测试文件落地并 `exit 0`（AC1）；② 从 fixture 的 `.quay/relaxed-dispatch.jsonl` **回读**出的那一行逐字贴出，五个键与 fixture 事实一致（AC9）；③ 每个条件至少一条「构造只缺它 ⇒ 阻塞、`relaxBlockedBy` 逐字等于该 id」的读数 + 至少两条**负控制**（(b) 换配置、(d) 删账本行）证明判据不是恒真/恒假（AC3/AC5/AC6）；④ 取假形态：恒放行 + 逐条删条件各真红一次（AC11，附红输出）。

**如实写明（⛔ 不作为省略的理由）**：本 AC 的判据面是**夹具读数** —— GOAL-037 立案文本的「已知缺口」已承认本 goal 的 AC 都不读生产载体（生产读数需人在目标项目启用 shadow/live 并重启 driver，是人工步骤），本条亦然。⛔ 同时：AC-366 的判据面（测试存在且 55s 内绿）**单独不具备判别力** —— 它区分不了「真放行」与「恒真断言」；判别力由 AC2–AC8 的双向边界/负控制与 AC11 的注入红提供，故这些不得省略、不得只在文字上声称跑过。全部新增测试在 `bash scripts/test.sh --for-task gap-touches-relax-live-semantics` 下绿。

⛔ **本条不启用生产**：`mode` 缺省为 off/absent ⇒ 行为与现状逐字节相同；生效需要人在目标项目的 `.quay/config.yml` 显式把 `mode` 设为 `live` 并重启 worker driver（GOAL-037 非目标节）。

## Touches

- plugin/scripts/driver-filters.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/duration-report.ts
- plugin/test/touches-relax-live-predicate.test.mjs (new)
- tasks/gap-touches-relax-live-semantics.md

## Evidence

### 落地形态（写面与 Plan 字面的差异，逐条给结构原因）

1. **`recordRelaxedDispatch` 落在 `plugin/scripts/worker-driver.ts`，不在 Plan §3 点名的 `driver-filters.ts`。** 两条结构原因：
   ① `driver-filters.ts` **不可能** import AC-363 的账本模块 —— `relaxed-dispatch-ledger.ts` 已从它取 `WORKER_OUTCOME_REL`，
   反向 import 成**值环**，而 `import-graph-check` 的 shrink-only 棘轮把 `valueSccs` 钉在 0（本条落地后实测仍 `valueSccs=0 typeSccs=0`，见 AC12）；
   ② 谓词必须保持**纯**（不写盘）：放行决策在 `judgeLiveRelax` 内做，写入只发生在**派发那一刻**（`spawnSelected(sel)` 之前）。
   写入仍**复用** AC-363 的 `appendRelaxedDispatch`（⛔ 不写第二份），路径字面量仍只经其导出的 `RELAXED_DISPATCH_REL`（AC13①）。
2. **live 的判据词表是**第二个词表 `LIVE_RELAX_CONDITIONS`（8 条），**不是**往 `RELAX_CONDITIONS` 里追加条件。
   `RELAX_CONDITIONS` 是 shadow/off 的**标注**词表，被 AC-365 的 AC4 逐字 `deepEqual` 钉死（五条，⛔ 不得增删）——
   本条落地后该 pin 仍绿（AC12④）。AC-366 点名的两个新条件 id（`blocker-not-relaxed` / `no-overbroad-glob`）与四个结构前置
   （`candidate-declares-touches` / `no-overbroad-glob` / `overlap-known` / `relaxed-ledger-readable`）只存在于 live 词表。
3. **`not-never-relax` 在两态下读法不同（共用一个条件 id）**：live = **重叠文件**逐元素对 `never_relax` 的 glob 匹配
   （AC-364 的 `readStringList` 把该字段声明为「路径或 glob」；本条 Proposal 逐字「重叠面不含 `never_relax`」）；
   shadow 的**标注**路径沿用 AC-365 落地的「候选 id 在名单内」读法（那一处被其 AC4-④ 钉住，⛔ 未改动）。
4. `FilterContext` 新增三个**可选**字段：`relaxedTaskIds`（账本出现过的 task id，live 的 `quota-available` 与
   `blocker-not-relaxed` 的读数源）、`relaxedLedgerMalformed`、`nowMs`。账本由**调用方每轮读一次**后经 ctx 带入（同 ①，值环）；
   `nowMs` 缺省 `Date.now()`。**同一次** now 供判据与 trace 条目共用（`RelaxAttribution.roundNowMs`），
   否则会出现「判据按 30 分钟放行、条目报 29 分钟」这种自相矛盾的读数。
5. trace 契约**追加**了一种观测：live 下被 touches 谓词**放行**的候选会多出一条 `relaxed:true` 条目
   （它不在 `blocked` 里，否则**完全不产生条目**，AC-366(i) 与接线侧就都读不到）。`applyTaskFilters` 的**返回表达式一行未改**（AC12②）。
6. `shared_files` 短路记 `wouldRelax:true, relaxed:false` —— 它「视为不冲突」，**不是**一次放宽派发：
   不占名额、不写账本（AC-366(f)）。判别点正是 `relaxed` 这一个键。

**如实写明（⛔ 不作为省略的理由）**：本条的判据面是**夹具读数** —— GOAL-037 立案文本的「已知缺口」已承认本 goal 的 AC 都不读生产载体
（生产读数需要在目标项目启用 shadow/live 并重启 driver，是人工步骤），本条亦然。⛔ 同时：AC-366 的判据面（测试存在且 55s 内绿）
**单独不具备判别力** —— 它区分不了「真放行」与「恒真断言」；判别力由 AC2/AC3/AC5/AC6 的双向边界与负控制、AC8③/AC11 的注入真红提供。

**⛔ 本条不启用生产**：`mode` 缺省 off/absent ⇒ 行为与现状逐字节相同（负控制用例逐条取到该读数）；
生效需要人在目标项目的 `.quay/config.yml` 显式把 `loop.touches_relax.mode` 设为 `live` 并重启 worker driver。

### AC1 — 测试落地且通过

```
$ timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-live-predicate.test.mjs
EXIT=0    WALL_SECONDS=0.51
ℹ tests 10   ℹ pass 10   ℹ fail 0   ℹ duration_ms 489.2
```
文件首行 = `// @test-group engine`。文件落点 `plugin/test/touches-relax-live-predicate.test.mjs`（与任务 id 不同名 ⇒ 由 `## Touches` 显式选中，⛔ 未改名）。

### AC2 — (a) 阈值边界（双向）

注入 `nowMs = 2026-10-17T12:00:00.000Z`，`after_minutes = 30`，同一 fixture 只改 ready 事件时刻：

| fixture | ready 事件 | waitedMinutes | `applyTaskFilters` 返回 |
|---|---|---|---|
| A | `2026-10-17T11:30:00.000Z` | 30 | `["gap-live-cand"]`（**保留**） |
| B | `2026-10-17T11:31:00.000Z` | 29 | `[]`（**滤掉**，`relaxBlockedBy = "waited-enough"`） |

A 的条目同时自报 `relaxed: true`（证明走的是放行路径，不是「本来就没冲突」）；两次读数均从真实 `applyTaskFilters` 的返回数组逐字打印。

### AC3 — (b) `never_relax` + 负控制

- 正向：`never_relax: [plugin/scripts/shared.ts]`（= 实测重叠面 `["plugin/scripts/shared.ts"]`）⇒ `kept=[]`、
  `wouldRelax=false`、`relaxBlockedBy="not-never-relax"`、**账本载体不存在**（零写入）。
- 负控制：`never_relax: [plugin/scripts/unrelated.ts]` ⇒ 同一候选 `kept=["gap-live-cand"]`（判据真的读了配置，不是恒阻塞）。

### AC4 — (c) 名额 + 负控制

fixture 里 `inFlight = [BLOCKER, r1, r2]`，账本两行 `r1`/`r2`（**均不与候选重叠** —— 否则 (d) 先命中）。
账本载体回读：`{"task":"gap-live-r1",...}`、`{"task":"gap-live-r2",...}`。

| `max_relaxed_inflight` | 已放宽在飞数 | 返回 |
|---|---|---|
| 2 | 2 | `[]`，`relaxBlockedBy = "quota-available"` |
| 3 | 2 | `["gap-live-cand"]`（**放行**） |

### AC5 — (d) 不连锁 + 负控制

- 正向：账本含 `{"task":"gap-live-blocker",...}`（在飞对手本身是被放宽派发的）⇒ `kept=[]`、`relaxBlockedBy = "blocker-not-relaxed"`。
- 负控制：账本里**删掉那一行**（其余不动）⇒ 同一候选 `kept=["gap-live-cand"]`（账本读数 `null`）。
  两次账本字节均在测试输出里逐字打印。

### AC6 — (e) 过宽通配 + 负控制

判据输出（读的是 `touches-orthogonality-check` 的实现，⛔ 未写第二份）：`isOverbroadDeclaration("packages/**") === true`、
`isOverbroadDeclaration("packages/quay/src/gate/*.js") === false`。

| 候选 `## Touches` | 返回 |
|---|---|
| `packages/**` | `[]`，`relaxBlockedBy = "no-overbroad-glob"` |
| `packages/quay/src/gate/*.js`（+ 重叠面，fixture 根下真建了匹配文件） | `["gap-live-cand"]`（**保留**） |

### AC7 — (f) `shared_files` 短路

fixture：`shared_files: [plugin/scripts/shared.ts]`，ready = `2026-10-17T11:59:00.000Z` ⇒ `waitedMinutes = 1`，
测试内**显式断言** `1 < after_minutes(30)`。结果：`kept=["gap-live-cand"]` ⇒ **立即放行**（若没有短路，`waited-enough` 会把它滤掉）。
该次放行**无 `relaxed:true` 条目**、跑过生产接线后账本载体仍**不存在**（零写入）。
**解释（AC 点名要求写进 Evidence）**：`shared_files` 内的重叠**视为不冲突**，不是一次放宽派发 —— 故它不占名额
（`relaxedInFlight` 不计它）、不写账本（AC-363 的账本记的是「放宽派发」这一件事）。

### AC8 — (g) 等待读不到 ⇒ 阻塞且不伪装

fixture 的 `task-status-events.jsonl` 里没有 `gap-live-cand` 的 `to:"ready"` 事件。条目逐字：
```json
{"task":"gap-live-cand","filter":"touchesDisjointOrAged","blocker":"gap-live-blocker","overlapFiles":["plugin/scripts/shared.ts"],"waitedMinutes":null,"wouldRelax":false,"relaxBlockedBy":"waited-enough","relaxed":false}
```
`kept=[]`；`waitedMinutes === null` 且测试**显式断言 `!== 0`**。③ 注入见 AC11 的 `null-as-infinity` 行（该用例变红）。

### AC9 — (h) 放行写账本，形状与内容逐字

从载体 `.quay/relaxed-dispatch.jsonl` **回读**恰好一行，逐字：
```
{"task":"gap-live-cand","blockers":["gap-live-blocker"],"overlapFiles":["plugin/scripts/shared.ts"],"waitedMinutes":45,"dispatchedAt":"2026-10-17T12:00:00.000Z"}
```
断言：键集恰为 `["blockers","dispatchedAt","overlapFiles","task","waitedMinutes"]`；`task` = 候选；
`blockers` = 单元素 `[在飞对手 id]`；`overlapFiles` = 实测交集；`waitedMinutes` = 注入时钟算出的等待（45）；
`dispatchedAt` = 注入时钟的 ISO（`2026-10-17T12:00:00.000Z`）。AC-363 的读取器回读同为 1 条、`malformed=0`。

**负控制**：(b)/(c)/(d)/(e) 四个阻塞用例各跑一遍生产接线后，账本与**各自的基线**逐字相同（(b)(c)(e) 基线 = 载体不存在；
(d) 基线 = fixture 预置的那一行对手记录，未被追加）。实测 `[["(b)",null],["(c)",null],["(d)",[<预置那一行>]],["(e)",null]]`。

### AC10 — (i) 其它谓词不被绕过

三个候选都与在飞对手重叠（touches 面本可放宽），分别被 `depsSatisfied` / `retryCapNotExhausted` / `notNeedsHuman` 挡住：
`kept = []`（三个都不在返回集合内）。三个的 touches 条目**都**是 `wouldRelax:true, relaxBlockedBy:null, relaxed:true`
（证明放宽判据本身为真，是**组合**把它拦住的），逐条条目见测试输出（每个候选两条：touches + 拦它的那个谓词）。

### AC11 — (j) 取假形态（7 次注入，每次真红 + 逐字节还原）

注入器 `/tmp/relax-inject/inject.mjs`：对 `plugin/scripts/driver-filters.ts` 做**精确字符串**替换 → 跑本测试 → `cp` 备份逐字节还原
（⛔ 不用 `git checkout`）。每次注入都断言 needle 在**原始**文件里存在（不存在即 FATAL，⛔ 不静默跑一个没生效的注入）。

| # | 注入 | EXIT | 变红的用例 | 失败断言原文（截断） |
|---|---|---|---|---|
| 1 | live 分支写成**恒放行**（`return ann.wouldRelax` → `return true`） | 1 | AC2/AC3/AC4/AC5/AC6/AC8/AC9 | `waited=29 < 30 ⇒ 滤掉（实得 kept=["gap-live-cand"]）`；`命中 never_relax ⇒ 被滤掉`；`已放宽在飞 2 = 名额 2 ⇒ 阻塞` |
| 2 | 删 `waited-enough` | 1 | AC2、AC8 | `waited=29 < 30 ⇒ 滤掉（实得 kept=["gap-live-cand"]）`；`等待读不到 ⇒ 阻塞` |
| 3 | 删 `not-never-relax` | 1 | AC3、AC9 | `命中 never_relax ⇒ 被滤掉`；`(b) 阻塞（前置）` |
| 4 | 删 `quota-available` | 1 | AC4、AC9 | `已放宽在飞 2 = 名额 2 ⇒ 阻塞`；`(c) 阻塞（前置）` |
| 5 | 删 `blocker-not-relaxed` | 1 | AC5、AC9 | `对手本身是放宽派发的 ⇒ 阻塞（不连锁）`；`(d) 阻塞（前置）` |
| 6 | 删 `no-overbroad-glob` | 1 | AC6 | `首个不满足者 = no-overbroad-glob（实得 overlap-known）` |
| 7 | 等待缺值当 `Infinity`（`waits ?? Infinity`） | 1 | AC8 | `等待读不到 ⇒ 阻塞` |

七次全部 `RESTORED=true`（还原后与备份逐字节相同）。全部注入跑完后 `git status --porcelain` **只有**本条 Touches 的三条：
```
 M plugin/scripts/driver-filters.ts
 M plugin/scripts/worker-driver.ts
?? plugin/test/touches-relax-live-predicate.test.mjs
```
注入器不落进任何提交（⛔ 注入不得留在落地代码里）。

### AC12 — 静态面与不越界（五条命令）

① `bash plugin/scripts/capability-catalog.sh --summary` ⇒ `386 scripts | 386 declared | 0 unclassified | 381 ship`。
   本条**不新增** `plugin/scripts/*.ts`（新增的只有 `plugin/test/touches-relax-live-predicate.test.mjs` 一个测试文件），故无需六表声明、`capability-catalog-declarations.json` 未进 Touches。
② `git diff -U0 -- plugin/scripts/driver-filters.ts | grep -E '^[+-].*preds\.every|^[+-].*candidateIds\.filter'` ⇒ **零命中**；
   当前返回行 `driver-filters.ts:1812: return candidateIds.filter((id) => preds.every((p) => p(id)));` 一字未改（放宽只改 touches 谓词**自身**的返回值）。
③ promotion 面零影响 —— `plugin/scripts/promotion-driver.ts:925-929`：
   ```ts
   const activeIds = new Set(applyTaskFilters(
     r.fixDecisions.map((d) => d.id),
     makeFilterContext(root, { inFlight: [], retryExhausted: retryState.needsHuman }),
     ["retryCapNotExhausted", "notNeedsHuman"],
   ));
   ```
   `names` 子集只含 `retryCapNotExhausted` / `notNeedsHuman` ⇒ `filters.indexOf(touchesDisjointOrAged)` 为 -1 ⇒
   该调用位点**不含 touches 谓词**，本条的 live 分支在 promotion 面不可达（且 `inFlight: []`）。结论：**零影响**。
④ `bash scripts/test.sh plugin/test/driver-filters.test.mjs plugin/test/driver-runtime-s01.test.mjs` ⇒ **EXIT=0**，95 条通过、
   含 `✔ AC1 — TASK_FILTERS is the single list of the five composable predicates`（谓词列表 pin 未回归）。
   另：AC-365/362/363/364 的四个文件一起跑 ⇒ 99 条全绿（`RELAX_CONDITIONS` 的逐字 deepEqual pin 仍绿）。
⑤ `git diff --stat -- .quay/config.yml` ⇒ **空**（⛔ 不在 quay 自身启用 `touches_relax`）。

### AC13 — 不新写第二份实现

① `grep -rn '\.quay/relaxed-dispatch\.jsonl' plugin/scripts/*.ts` ⇒ 命中**只在** AC-363 的模块内：
```
plugin/scripts/relaxed-dispatch-ledger.ts:8:  *   · **账本**（`.quay/relaxed-dispatch.jsonl`）：...
plugin/scripts/relaxed-dispatch-ledger.ts:64: export const RELAXED_DISPATCH_REL = ".quay/relaxed-dispatch.jsonl";
```
   本条的写入点走 `appendRelaxedDispatch`（其内部即 `RELAXED_DISPATCH_REL`），⛔ 未写第二个字面量。
② ready 时刻读数**复用** AC-362/365 落下来的那一处：本条新增的引用只有两行，都是**读既有映射**，⛔ 未新增解析器：
```
+  const readyAt = state.readyAtMs.get(id);          // live 判据，映射来自 buildReadyAtMsMap(ctx.root)
+      const readyAt = readyAtMs.get(id);            // trace 路径的同一映射
```
   `git diff -U0 -- plugin/scripts/driver-filters.ts | grep -cE '^\+.*(readTaskStatusTransitions\(|readTaskStatuses\(|JSON\.parse.*status-events)'` ⇒ **0**。
   `readTaskStatusTransitions`（kernel）在本文件仍**只有**第 33 行那一处 import，`buildReadyAtMsMap` 仍是唯一的 ready→ms 映射构造点。

### 阶段 2b / 2c 读数

- 预合并：`git merge --no-edit develop` ⇒ EXIT=0（快进可合，无冲突）。
- 同一把 scoped 门：`bash scripts/test.sh --for-task gap-touches-relax-live-semantics --allow-thin` ⇒ **EXIT=0**，
  `ℹ tests 248 · pass 248 · fail 0 · duration_ms 30324.7`（含本条新测试 10 条与 `import-graph-check` /
  `sh-census-check` 等 change-relevant 静态检查；`import-graph-check` 实测 `valueSccs=0 typeSccs=0 reverseEdges=0`）。
- 反漂移：`anti-drift-touches-check.ts --task … --worktree … --merge-target develop` ⇒
  **EXIT=0**，`ANTI-DRIFT OK: 3 actual file(s), all within declared Touches (4 glob(s))`。

### 2026-10-17 — 上一轮的 suite 红：真因是 `duration-report.ts` 的入口守卫，本轮已修

**症状（上一轮 exited-not-landed，两次同形）**：fan-in suite 红，真因日志
`.quay/fan-in-suite-gap-touches-relax-live-semantics~wk-prod-anchor~1792174458344-2ae0e6.log`：

```
test at packages/quay/test/build-plugin-dist.test.mjs:1075:1
✖ AC1 — product surface: each driver bundle runs its OWN main (routine kinds + controls)
  AssertionError [ERR_ASSERTION]: dist/worker-driver.js must run its OWN main — expected marker "SPEC §5 阶段 2+3+4" in its output
```

该测试文件**不在**本条的 `## Touches` 里，机械 delta 相关性判定也报 UNRELATED（它用 esbuild 以
**路径字符串**把 `plugin/scripts/worker-driver.ts` 当 entry 打包，没有任何静态 import 边指向它 ⇒
一跳相关性检查看不见 —— 与 `casebook`「delta 相关性对 harness 中介的 import 是盲的」同形）。
但它**确实是本条引入的**：先复现（`--test-name-pattern` ⇒ 同一断言红），再定位。

**真因（读代码得出，非推断）**：本条 Plan §3 要求复用 AC-363 的账本模块，于是
`worker-driver.ts → relaxed-dispatch-ledger.ts → duration-report.ts` 成了一条**新的值 import 边**；
而 `duration-report.ts` 的顶层入口守卫当时是**URL 相等**判定：

```js
// 修前（duration-report.ts 末尾）
const invokedDirectly = (() => { const entry = process.argv[1]; … return fs.realpathSync(entry) === fs.realpathSync(new URL(import.meta.url).pathname); })();
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
```

打包后**整个 inline 模块集共用 bundle 的 `import.meta.url`**，而 `process.argv[1]` 就是 bundle 自身
⇒ 该守卫在 `dist/worker-driver.js` 里恒为 **true**，`process.exit(main(...))` 先于 worker-driver 的
入口守卫执行 ⇒ 产物打印的是**时长报告**并 exit 0（实测逐字输出：`window: …` / `attempts (finished in window: 308)`）。
正是 `gate-script-base.ts` 里 `isDirectEntry` 上方那段注释记载的事故形态
（`gap-drivers-yml-interval-not-honored-for-routine-kinds`：三个 routine driver 全跑 pool-quality-judge 的 main）——
`duration-report.ts` 是当时**未随迁移扫到**的残留实例，只因此前**无人 import 它**故从未显形。

**为什么静态检查器没拦住（如实写明）**：`build-plugin-dist.test.mjs` 的
「ZERO inlined entry-guard hijacks」**本轮前后都绿** —— `activeFileIdentityGuards` 只扫**顶层 `if` 条件**
（`topLevelIfConditions`），而 duration-report 的 URL 判定被包在 IIFE 里赋给 `const invokedDirectly`，
真正的 `if` 条件里没有任何 `import.meta.url`/`process.argv[1]` token ⇒ **静态检查器对这一形态是盲的**，
抓住它的是**运行时**打包测试。机器/测试仪器故障形态已记入 memory，本条的修复不依赖那个检查器。

**修复（`plugin/scripts/duration-report.ts`，加入 `## Touches`）**：换成仓库**既有的、bundle-safe 的**
`isDirectEntry(import.meta, undefined, "duration-report")`（gate-script-base 导出；按**文件名**认身份，
源码布局与打包布局都成立，对 inline 进别的 bundle 的本模块恒 false）。⛔ 未新写第二份判定：
`gate-script-base.ts` 的 import 只含 node 内建 ⇒ 无新环（typecheck 与 import-graph 均绿，见下）。
修复落在 `duration-report.ts` 而非别处，因为**唯一的替代是取消那条 import 边**，而那会违反本条
Plan §3 / AC13 的「复用 AC-363 的账本模块，⛔ 不写第二份读数实现」——把上游模块的**陈旧守卫**修好，
比在调用侧绕开它更符合单一来源。

**读数（本轮实测）**：

| 命令 | 修前 | 修后 |
|---|---|---|
| `node --test --test-name-pattern="each driver bundle runs its OWN main" packages/quay/test/build-plugin-dist.test.mjs` | ✖ fail 1 | ✔ pass 1 |
| esbuild 打包 `worker-driver.ts` + `node <bundle> --help` 的 stdout | 时长报告（`attempts (finished in window: …)`） | `worker-driver — SPEC §5 阶段 2+3+4：spawn 多 worker…` |
| `node --test --test-name-pattern="ZERO inlined entry-guard hijacks|ZERO unnamed" …` | ✔（该检查器对该形态盲，见上） | ✔ pass 2 |
| `node --test plugin/test/duration-report.test.mjs plugin/test/touches-relax-ledger.test.mjs plugin/test/touches-relax-live-predicate.test.mjs` | — | ✔ `tests 26 · pass 26 · fail 0` |
| `bash scripts/test.sh plugin/test/driver-filters.test.mjs plugin/test/driver-runtime-s01.test.mjs`（AC12④） | — | ✔ `tests 95 · pass 95 · fail 0` |
| `bash plugin/scripts/capability-catalog.sh --summary`（AC12①） | — | `386 scripts | 386 declared | 0 unclassified | 381 ship` |
| typecheck（`.quay/config.yml` 声明的 `for d in packages/*/; do npx tsc --noEmit -p "$d"` ） | — | EXIT=0（无输出） |

**负控制（证明修复真的在起作用，不是「本来就好」）**：把 `duration-report.ts` 的守卫逐字改回 URL 形态
⇒ 打包读数立刻回到时长报告、上面的打包测试立刻变红；改回 `isDirectEntry` ⇒ 变绿。**同一棵树上、同一命令、
只差这一处**（两向各取一次读数）。

**本条的放宽语义未改动**：修复只动 `duration-report.ts` 的入口守卫一行（外加一行 import），
`driver-filters.ts` 的 live 判据、`## Acceptance Criteria` 的 13 条与上文各读数**逐条不变**；
AC2–AC11 的夹具读数本轮重跑仍为 `tests 26 · pass 26 · fail 0`。