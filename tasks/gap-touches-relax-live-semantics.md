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

- [ ] AC1 — 测试落地且通过（AC-366 判据面逐字）：`timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-live-predicate.test.mjs` **exit 0**，文件带 `// @test-group engine`。附实际命令、输出尾部与实测耗时（秒）。
- [ ] AC2 — (a) 阈值边界（注入时钟）：`waitedMinutes` 恰等于 `after_minutes` ⇒ 候选**被保留**；恰少一分钟 ⇒ **被滤掉**。两次读数均从真实 `applyTaskFilters` 的返回数组逐字打印；并附两个 fixture 的 ready 事件时刻与注入的 `nowMs`。
- [ ] AC3 — (b) `never_relax`：重叠文件命中 `never_relax` ⇒ **阻塞**（条目 `wouldRelax === false`、`relaxBlockedBy === "not-never-relax"`、账本零写入）；**负控制**：把该 fixture 的 `never_relax` 换成一条无关条目 ⇒ 同一候选**被保留**（证明判据真的读了配置，不是恒阻塞）。附两份配置与两次结果。
- [ ] AC4 — (c) 名额：当前被放宽派发的**在飞**任务数 = `max_relaxed_inflight` ⇒ **阻塞**（`relaxBlockedBy === "quota-available"`）；改为「已放宽数 + 1」⇒ **放行**。⚠️ fixture 里这些已放宽的在飞任务**不得与候选重叠**（否则 (d) 先命中，测的就成了 (d)）。附账本行、两份配置与两次结果。
- [ ] AC5 — (d) 不连锁：挡住候选的在飞任务本身有放宽账本记录 ⇒ **阻塞**（`relaxBlockedBy === "blocker-not-relaxed"`）；**负控制**：从 fixture 账本里删掉该在飞任务的记录（其余不动）⇒ 同一候选**被保留**（证明该条件真的读了账本，不是恒真/恒假）。附两次账本字节与结果。
- [ ] AC6 — (e) 过宽通配：候选 `## Touches` 含 `isOverbroadDeclaration` 判为过宽的声明（如 `packages/**`）⇒ **阻塞**（`relaxBlockedBy === "no-overbroad-glob"`）；**负控制**：换成 ≥2 段锚定的精确 glob（如 `packages/quay/src/gate/*.js`）⇒ 其余条件都满足时**被保留**。附两条声明、判据输出与结果。
- [ ] AC7 — (f) `shared_files` 短路：候选与在飞对手的重叠**全部**落在 `shared_files` 内，且注入的 `waitedMinutes` **远小于** `after_minutes`（测试内显式断言 `waitedMinutes < after_minutes`）⇒ **立即放行**（不被滤掉）；且该次放行**不写账本**（行数/文件存在性与基线相同）——它「视为不冲突」，不是一次放宽派发（该解释写进 Evidence）。附 fixture、等待读数与账本读数。
- [ ] AC8 — (g) 等待读不到 ⇒ 阻塞且**不伪装**：候选在 fixture status-events 账本里**没有** `to:"ready"` 事件 ⇒ ①该候选**被滤掉**；②其 trace 条目 `waitedMinutes === null` 且**显式断言 `!== 0`**（硬规则 6/3b：缺值不得与「等 0 分钟」同形）；③**注入**：把 `null` 当 `Infinity`（如 `?? Infinity`）⇒ 该用例变红（证明 (g) 对「当作无穷」有判别力）。附条目 JSON 与红输出。
- [ ] AC9 — (h) 放行时账本记一行、形状与内容逐字正确：构造一次**真实放宽放行**（全部条件满足、走等待路径而非 (f) 短路）⇒ 从 `.quay/relaxed-dispatch.jsonl` **回读**恰好一行，恰含 `task` / `blockers` / `overlapFiles` / `waitedMinutes` / `dispatchedAt` 五键，取值与 fixture 事实逐字一致（`blockers` 含该对手 id；`overlapFiles` 等于实测交集；`waitedMinutes` 等于注入时钟算出的等待；`dispatchedAt` 等于注入时钟）。**负控制**：(b)–(e) 四个阻塞用例各跑一遍后该账本**零写入**。附账本逐字行与两次读数。
- [ ] AC10 — (i) 其它谓词不被绕过：为 `depsSatisfied` / `retryCapNotExhausted` / `notNeedsHuman` **各**造一个「touches 面本可放宽」但被该谓词挡住的候选 ⇒ 三个都**不在** `applyTaskFilters` 的返回集合内；且其中至少一个的 trace 条目 `wouldRelax === true`（证明放宽判据为真、是**组合**把它拦住的，不是放宽判据本身没通过）。附三条条目与返回集合。
- [ ] AC11 — (j) 取假形态（真红并留痕，⛔ 注入不得留在落地代码里）：① 把 live 分支写成**恒放行** ⇒ 本测试变红；② **逐条**删除每个放宽条件各注入一次（至少 `waited-enough`、`not-never-relax`、`quota-available`、`blocker-not-relaxed`、`no-overbroad-glob`），每次**对应用例**变红。各附非零退出码 + 失败断言原文；恢复后 `git status --porcelain` 只含本条 Touches 内的预期改动、落地 diff 与该测试最终内容一致。附实际注入清单（做了哪几次、每次哪条用例红）。
- [ ] AC12 — 静态面与不越界：① `bash plugin/scripts/capability-catalog.sh --summary` 报 `0 unclassified`（本条**不新增** `plugin/scripts/*.ts`，如实说明；若实现确需新脚本，则必须成组声明六表并把 `plugin/scripts/capability-catalog-declarations.json` 列进 Touches）；② `git diff` 证明 `applyTaskFilters` 的**返回表达式一行未改**（放宽只改 touches 谓词自身的返回值）；③ promotion 面零影响：附 `plugin/scripts/promotion-driver.ts:925-929` 的 names 子集代码与「不含 touches 谓词」的结论；④ `bash scripts/test.sh plugin/test/driver-filters.test.mjs plugin/test/driver-runtime-s01.test.mjs` **exit 0**（既有谓词列表 pin 与派发决策不回归；名字序列以 AC-365 的落地态为准）；⑤ `git diff -- .quay/config.yml` **空**（不在 quay 自身启用）。附五条命令、退出码与输出。
- [ ] AC13 — 读数不新写第二份实现：① `grep -rn '\.quay/relaxed-dispatch\.jsonl' plugin/scripts/*.ts` 的**字面量**命中唯一在 AC-363 的模块内，其余引用（含本条的写入点）一律走其导出的 `RELAXED_DISPATCH_REL`；② `.quay/task-status-events.jsonl` 的 ready 时刻读取**复用** AC-362/365 那一处，`grep -c` 证明本条未新增第二个解析器。附两处 grep 与三处调用的逐字代码。

## Definition of Done

真实落地 = **同一个真实 `applyTaskFilters` 在 `mode: live` 的 fixture 上真的把候选放行、并真的把一行账本落进载体文件**，且 (a)–(g) 各条件的**判别读数**（边界双向、负控制、注入红）都真实取到 —— 不是「单测绿了」，也不是「内存对象里有这个字段」。

四条逐一对上：① 新测试文件落地并 `exit 0`（AC1）；② 从 fixture 的 `.quay/relaxed-dispatch.jsonl` **回读**出的那一行逐字贴出，五个键与 fixture 事实一致（AC9）；③ 每个条件至少一条「构造只缺它 ⇒ 阻塞、`relaxBlockedBy` 逐字等于该 id」的读数 + 至少两条**负控制**（(b) 换配置、(d) 删账本行）证明判据不是恒真/恒假（AC3/AC5/AC6）；④ 取假形态：恒放行 + 逐条删条件各真红一次（AC11，附红输出）。

**如实写明（⛔ 不作为省略的理由）**：本 AC 的判据面是**夹具读数** —— GOAL-037 立案文本的「已知缺口」已承认本 goal 的 AC 都不读生产载体（生产读数需人在目标项目启用 shadow/live 并重启 driver，是人工步骤），本条亦然。⛔ 同时：AC-366 的判据面（测试存在且 55s 内绿）**单独不具备判别力** —— 它区分不了「真放行」与「恒真断言」；判别力由 AC2–AC8 的双向边界/负控制与 AC11 的注入红提供，故这些不得省略、不得只在文字上声称跑过。全部新增测试在 `bash scripts/test.sh --for-task gap-touches-relax-live-semantics` 下绿。

⛔ **本条不启用生产**：`mode` 缺省为 off/absent ⇒ 行为与现状逐字节相同；生效需要人在目标项目的 `.quay/config.yml` 显式把 `mode` 设为 `live` 并重启 worker driver（GOAL-037 非目标节）。

## Touches

- plugin/scripts/driver-filters.ts
- plugin/scripts/worker-driver.ts
- plugin/test/touches-relax-live-predicate.test.mjs (new)
- tasks/gap-touches-relax-live-semantics.md
