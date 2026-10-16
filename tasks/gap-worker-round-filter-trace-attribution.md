---
id: gap-worker-round-filter-trace-attribution
title: worker-round 的 filtered-empty 轮不可归因：一个 stop_reason 字面量压掉「哪个谓词 / 哪个在飞对手 /
  重叠哪些文件 / 等待多久」五种成因（GOAL-037 AC-362 观测面）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-362
---
**type:** execution

## Proposal

**缺口（GOAL-037 的方案第 0 步：只加观测）**：worker-round 的 `filtered-empty` 轮**不可归因**。`.quay/worker-round.jsonl` 只写 `stop_reason: "filtered-empty (all dispatchable candidates filtered by predicates)"`，不写**哪个候选被哪个谓词挡住、被哪个在飞对手挡住、重叠哪些文件、已等待多久**（grep `touches-overlap` 在 `worker-round.jsonl` 零命中）。生产存量：quay 7010/49201 ≈ 14.2%、claudecodeui 4844/36578 ≈ 13.2% 的 stop 轮是 filtered-empty。

**为什么这是缺口，而不是「日志不够详细」**：一个 `filtered-empty` 字面量把五种互不相同的成因压成同形——候选分别被 `notInFlight` / `depsSatisfied` / `touchesDisjoint` / `retryCapNotExhausted` / `notNeedsHuman` 滤掉。GOAL-037 要判「touches 单独把某任务挡了超过配置阈值 ⇒ 允许放宽」时，**阈值、名额预算、自动收紧三者都无读数可依**：现有载体答不出「哪些候选是被 touches 挡的、被谁挡的、挡了多久」。这是硬规则 4 推论三的反面次序——先要有能穿过所有中间层、在验收那一刻仍取得到的量，才谈得上给它设阈值。

**机制现状（读代码得出，非推断）**：
- 五个谓词都在 `plugin/scripts/driver-filters.ts` 的 `TASK_FILTERS`（`notInFlight` :190 / `depsSatisfied` :202 / `touchesDisjoint` :218 / `retryCapNotExhausted` :240 / `notNeedsHuman` :1246）；唯一消费点 `applyTaskFilters`（:1269），实现是一行 `candidateIds.filter((id) => preds.every((p) => p(id)))` ⇒ **返回值里没有任何「谁挡的」信息**，且 `every` 短路之后连「是哪一个谓词」都无从知道。
- `touchesDisjoint`（:218-236）内部**已经算出重叠面**：`checkTouchesPair(...)` 返回 `{disjoint, overlaps, reason}`（`plugin/scripts/touches-orthogonality-check.ts:201-219`；`overlaps` 由 `filesDisjoint` :191-196 产生并已 `sort()`）——**这份清单在生产代码里已经算出来了，只是被丢掉**。
- 在飞对手就在谓词上下文里：`FilterContext.inFlight`（:42-49）。
- round 记录的装配面：`computeWorkerRoundRecord`（`plugin/scripts/worker-driver.ts:1852-1969`）+ `writeRound` 闭包（:6017-6063）；派发环的过滤步在 :6638-6653，`filtered-empty` 的判据是 `afterTaskFilters.length === 0`（:6650）。
- 等待时长有现成载体：`.quay/task-status-events.jsonl`（转移事件带 `to` 与 `at`），读取面是 kernel 的 `readTaskStatusTransitions`（`packages/quay/src/kernel/task-transition.ts:967`）——⛔ 不手搓 jsonl 解析（硬规则 1）。

**⛔ 本条只增观测**：`applyTaskFilters` 返回的候选集合与顺序必须逐个不变；trace 经**新增的可选**参数落地，两个 driver 既有调用位点的判定输入（候选列表 / ctx / names）不动。

## Plan

1. **归因核（`driver-filters.ts`）**：给 `applyTaskFilters` 增加一个**可选**的 trace 汇（第 4 个参数之类，形状由实现定），逐候选 × 逐谓词判定，**被滤掉**的（候选 × 谓词）各产生一条
   `{ task, filter, blocker, overlapFiles, waitedMinutes }`：
   - `filter` = 该谓词自己的 `TaskFilter.name`（⛔ 不另抄一份字面量——新增谓词仍只是一行）；
   - `blocker` = **仅** `touchesDisjoint` 非 null：取 `ctx.inFlight` 中**第一个**与其重叠的在飞任务 id（顺序确定 ⇒ 读数可复现）；其余谓词恒 `null`。⚠️ 多对手时只记第一个——本条就做 AC 逐字要求的**单 blocker** 形状，多对手的完整枚举不在本条范围；
   - `overlapFiles` = 由**真实** `checkTouchesPair(...).overlaps` 得出的交集（沿用其排序），仅 touches 条目非空；**按 AC 逐字要求排除候选自身的任务文件 `tasks/<候选 id>.md`**（自 touch 会把该路径带进候选展开集，AC 明令不计入重叠面；排除后 blocker 仍被点名，可归因性不受损）；
   - `waitedMinutes` = 「现在」与 `.quay/task-status-events.jsonl` 中该任务**第一条 `to: "ready"`** 记录的 `at`（v0 行取 `ts`）之差（分钟）。**读不到 ⇒ `null`，⛔ 不得写 0**（缺值 = 未查，硬规则 6）。载体**每轮读一次**并建 task → 首个 ready 时刻 的映射，⛔ 不逐候选重读全量 jsonl。
   ⛔ 五个谓词的实现一处不改、`TASK_FILTERS` 列表不动。
2. **接线（`worker-driver.ts`）**：派发环的 apply-filters 步（:6638-6639）把本轮的 trace 汇交给 `writeRound`；`computeWorkerRoundRecord` 新增入参并输出 `filter_trace` 字段。三种轮必须可分（硬规则 3b，同族先例见 :1946-1967 的「跑过且无 / 没跑」约定）：
   - **跑过该步、无候选被滤**（含 `shuffled.length === 0` 的 pool-empty 轮）⇒ `filter_trace: []`；
   - **跑过该步、有候选被滤** ⇒ 逐条归因；
   - **本轮没跑该步**（cap 已满 / stopCondition 提前 break / 在 apply-filters 之前抛错的 error 轮）⇒ `null`。
   ⛔ 不跨轮累积（按 `retryExemptions` / `needsHuman` 等处同样的 splice/快照语义，:6036-6045），上一轮的条目不得漏进本轮记录。
3. **测试（新文件 `plugin/test/touches-relax-filter-trace.test.mjs`，首行 `// @test-group engine`）**：**真实** `applyTaskFilters` + **真实** `computeWorkerRoundRecord`/`appendRoundToFile` + fixture 任务目录（`tasks/*.md` 真写盘、真 `## Touches`），**不 mock 谓词**（照 `plugin/test/driver-filters.test.mjs:359-373` 的 `makeRoot` / `writeTask` / `ctx` 手法）。断言读的是**从 fixture 载体文件回读并 `JSON.parse` 出来的那一行**（`appendRoundToFile` 是生产写入器），⛔ 不是内存里的对象。
4. **可跑性与时限**：`expandDeclaredTouches` 走**纯 fs 遍历**（`walkFiles`，`touches-orthogonality-check.ts:181-189`）**不 spawn git**，fixture 根上的过滤是毫秒级；本测试**不 spawn driver、不跑 suite**，55s 上限应有余量（实测值写进 Evidence）。⚠️ 测试文件名是 AC 逐字钉死的 `touches-relax-filter-trace.test.mjs`，与本任务 id 不同名 ⇒ 靠 `## Touches` 显式声明被 scoped 门选中（⛔ 不改名）。

## Acceptance Criteria

- [x] AC1 — 测试文件落地且通过：`timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-filter-trace.test.mjs` **exit 0**，文件带 `// @test-group engine`。附实际命令、输出尾部与实测耗时（秒）。
- [x] AC2 — touches 归因（AC-362(a)）：fixture 里一个候选的 `## Touches` 与一个在飞对手重叠 ⇒ 从载体回读的记录中该候选的条目满足 `filter === "touchesDisjoint"`、`blocker` 逐字等于该对手的 task id、`overlapFiles` 非空且等于实测交集、`waitedMinutes` 由载体推出。附该条目逐字 JSON + 构造它的 fixture 事实（两个任务各自的 `## Touches`）。
- [x] AC3 — `overlapFiles` 是**交集**而非候选自身清单：断言其中每个路径**同时**在候选与对手的 `expandDeclaredTouches` 展开集内；并造一个对手确实声明 `tasks/<候选 id>.md` 的 fixture，断言该路径**被排除**在该条目的 `overlapFiles` 之外。附两边的展开集与该条目。
- [x] AC4 — 其它谓词各有其名且 `blocker === null`（AC-362(b)）：为 `depsSatisfied` / `retryCapNotExhausted` / `notNeedsHuman` **各**造一个只被它挡住的候选，断言其条目集合里存在自己 filter 名的条目、其 `blocker === null`，**且该候选没有任何 `filter === "touchesDisjoint"` 的条目**（不得被误归）。附四类候选各自的条目集合。
- [x] AC5 — 特征化：集合**与顺序**都不得变（AC-362(c)）：同一输入下带 trace 的 `applyTaskFilters(...)` 返回值与**基线**（测试内用真实谓词独立算出的 kept 序列，或改动前保存的同输入读数）**逐元素 deepEqual**；⛔ 不得只断言长度或先排序再比。附两边数组的逐字打印。
- [x] AC6 — 取假形态（AC-362(d)，必须变红，真跑一次并留痕）：① 把归因写死成恒 `touchesDisjoint`；② 恒空 `filter_trace` —— **两种注入各让本测试变红**。附每次的红输出（非零退出码 + 失败断言原文）。⛔ 注入不得留在落地代码里：落地 diff 与该测试的最终内容一致，`git status` 净。
- [x] AC7 — pool-empty 不写条目 + 三态可分（AC-362(e)）：`shuffled.length === 0` 的轮记录 `filter_trace === []`（⛔ 不是 `null`、⛔ 不带上一轮残留条目）；**没跑该步**的轮记录 `null`（`strictEqual` 两向各断言一次）。附两类轮从载体回读的真实记录行。
- [x] AC8 — `waitedMinutes` 取真值：两个 fixture 的 ready 事件时刻相差已知 Δ ⇒ 两条条目的 `waitedMinutes` 相差 ≈ Δ（杀死硬编码常量）；无 `to: "ready"` 记录的候选 ⇒ `strictEqual(waitedMinutes, null)` 且显式断言 `!== 0`。附实际数值与所用事件行。
- [x] AC9 — ⛔ 未改变派发决策：`bash scripts/test.sh plugin/test/driver-filters.test.mjs` **exit 0**（五个既有谓词的覆盖不回归），并附 `git diff` 证明 `applyTaskFilters` 的**返回表达式一行未改**、两个 driver 既有调用位点的判定输入未变（trace 只走新增可选参数）。附命令、退出码与该段 diff。

## Evidence

**落地面**：工作树 `/data/home/yale/work/quay-worktrees/gap-worker-round-filter-trace-attribution`，分支 `task/gap-worker-round-filter-trace-attribution`，实现提交 `b543cd5f1`。
- `plugin/scripts/driver-filters.ts` — `applyTaskFilters` 新增第 4 个**可选**参数 `trace?: FilterTraceSink`；新增 `FilterTraceEntry` / `FilterTraceSink` / `buildReadyAtMsMap`（读 kernel `readTaskStatusTransitions`）/ `makeTouchesAttributor`（复用真实 `parseTouches` / `checkTouchesPair` / `expandDeclaredTouches` / `normalizePath`）。五个谓词实现与 `TASK_FILTERS` 未动，返回表达式一行未改。
- `plugin/scripts/worker-driver.ts` — apply-filters 步建归因汇（轮首复位置 `null`、同轮多次进环追加）；`computeWorkerRoundRecord` 输出 `filter_trace`；`writeRound` / `writeErrorRound` 从闭包读，两处调用签名逐字不变。
- `plugin/test/touches-relax-filter-trace.test.mjs` — 新测试（6 条，首行 `// @test-group engine`）。

### AC1 — 测试落地且通过

命令：`timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-filter-trace.test.mjs`
输出尾部：
```
✔ AC2 — touches 归因：blocker / overlapFiles / waitedMinutes 三键同现，从【载体回读】的记录里取 (49.08ms)
✔ AC3 — overlapFiles 是【交集】… (44.06ms)
✔ AC4 — 其它谓词各有其名且 blocker === null… (33.95ms)
✔ AC5 — 特征化：… 逐元素 deepEqual（集合与顺序都不变） (44.06ms)
✔ AC7 — pool-empty ⇒ filter_trace === []；没跑该步 ⇒ null（两向各断言一次） (32.43ms)
✔ AC8 — waitedMinutes 取真值… (34.00ms)
ℹ tests 6   ℹ pass 6   ℹ fail 0   ℹ duration_ms 671.47
```
实测墙钟 `real 0m0.700s`（55s 上限余量充足）。`AC1_EXIT=0`。首行 `// @test-group engine`。

### AC2 — touches 归因三键同现（从载体回读）

fixture 事实（两个任务各自的 `## Touches`）：
```
gap-trace-cand : plugin/scripts/trace-shared.ts, plugin/scripts/cand-only.ts   （候选）
gap-trace-opp  : plugin/scripts/trace-shared.ts, plugin/scripts/opp-only.ts    （在飞对手）
```
从 `.quay/worker-round.jsonl` 回读的条目逐字：
```json
{"task":"gap-trace-cand","filter":"touchesDisjoint","blocker":"gap-trace-opp","overlapFiles":["plugin/scripts/trace-shared.ts"],"waitedMinutes":45}
```

### AC3 — overlapFiles 是交集，且候选自身任务文件被排除

```
gap-trace-cand  expand=["plugin/scripts/cand-only.ts","plugin/scripts/trace-shared.ts"]
                opp   =["plugin/scripts/opp-only.ts","plugin/scripts/trace-shared.ts"]
                → overlapFiles=["plugin/scripts/trace-shared.ts"]
gap-trace-self  expand=["plugin/scripts/self-shared.ts","tasks/gap-trace-self.md"]
                opp   =["plugin/scripts/self-shared.ts","tasks/gap-trace-self.md"]   （对手确实声明候选自身的任务文件）
                → overlapFiles=["plugin/scripts/self-shared.ts"]                    （tasks/gap-trace-self.md 被排除）
```

### AC4 — 其它谓词各有其名且 blocker === null

```
gap-trace-dep entries = [{"task":"gap-trace-dep","filter":"depsSatisfied","blocker":null,"overlapFiles":[],"waitedMinutes":null}]
gap-trace-exh entries = [{"task":"gap-trace-exh","filter":"retryCapNotExhausted","blocker":null,"overlapFiles":[],"waitedMinutes":null}]
gap-trace-nh  entries = [{"task":"gap-trace-nh","filter":"notNeedsHuman","blocker":null,"overlapFiles":[],"waitedMinutes":null}]
```
三者均断言「没有任何 `filter === "touchesDisjoint"` 的条目」。

### AC5 — 特征化（集合与顺序逐个不变）

```
[AC5] traced   = ["gap-trace-pass","gap-trace-pass2"]
[AC5] baseline = ["gap-trace-pass","gap-trace-pass2"]
```
`assert.deepEqual(kept, baseline)`（逐元素、保序）；基线由测试内**真实** `TASK_FILTERS` 谓词独立算出（非先排序再比、非只比长度）。

### AC6 — 两种取假注入各红一次

① 归因写死成恒 `touchesDisjoint`（`filter: touchesDisjoint.name`）⇒ `INJECTION1_EXIT=1`：
```
✖ AC4 — 其它谓词各有其名且 blocker === null；且不得被误归成 touchesDisjoint
  AssertionError [ERR_ASSERTION]: gap-trace-dep 只被 depsSatisfied 挡住（且自报其名）
    actual: [ 'touchesDisjoint' ]
    expected: [ 'depsSatisfied' ]
```
② 恒空 `filter_trace`（`if (false && trace)`）⇒ `INJECTION2_EXIT=1`，5 条红：
```
✖ AC2 … AssertionError: CAND **只**被 touchesDisjoint 挡住（一条）     actual: [], expected: [ 'touchesDisjoint' ]
✖ AC3 … AssertionError: 两条 touchesDisjoint 条目都在载体里          actual: undefined, expected: true
✖ AC4 … AssertionError: gap-trace-dep 只被 depsSatisfied 挡住…       actual: [], expected: [ 'depsSatisfied' ]
✖ AC7 … AssertionError: 前置：轮 1 确实有归因条目                    actual: false, expected: true
✖ AC8 … （同上：条目缺失）
ℹ fail 5
```
两次注入均已 `git checkout -- plugin/scripts/driver-filters.ts` 复原 ⇒ `git status --short` **空**、`git diff --stat` **空**：落地 diff 与该测试的最终内容一致。

### AC7 — 三态可分（从载体回读）

```
[AC7] pool-empty row filter_trace = []; no-step row filter_trace = null
```
- pool-empty 轮（`applyTaskFilters([])` 仍跑该步）⇒ `filter_trace === []`（`deepEqual []` + `notStrictEqual null`）。
- 没跑该步的轮（未传 trace，等价轮首复位后从未赋值）⇒ `filter_trace === null`（`strictEqual null`）。
- 先往载体写了一条**非空**记录，再写 pool-empty 轮 ⇒ 证明**不带上一轮残留条目**。

### AC8 — waitedMinutes 取真值

```
[AC8] carrier events: CAND to=ready at 2026-10-16T15:25:55.329Z, SELF at 2026-10-16T14:55:55.329Z
[AC8] waitedMinutes: CAND=45, SELF=75, Δ=30; DEP(no ready record)=null
```
两条 `to:"ready"` 事件行相差恰好 30 分钟 ⇒ 两值 Δ=30（杀死硬编码常量；且断言 `Δ !== 0`）。无 ready 记录的 `gap-trace-dep` ⇒ `strictEqual(waitedMinutes, null)` 且显式 `!== 0`。

### AC9 — 未改变派发决策

`bash scripts/test.sh plugin/test/driver-filters.test.mjs` ⇒ `tests 90 / pass 90 / fail 0`，**exit 0**。

`applyTaskFilters` 返回表达式 diff（**空**——该行无 `-`/`+` 命中）：
```
$ git diff develop -- plugin/scripts/driver-filters.ts | grep -E '^[-+].*candidateIds\.filter'
（无输出）
```
`plugin/scripts/promotion-driver.ts`：`git diff develop --stat` **空**（整文件未动）。
`plugin/scripts/worker-driver.ts` 的既有调用位点：判定输入逐字未变，归因只走新增第 4 参：
```diff
-        const afterTaskFilters = applyTaskFilters(shuffled, makeFilterContext(rootDir, { inFlight: exclusion.inFlight, retryExhausted: exclusion.retryExhausted }));
+        const filterSink: FilterTraceEntry[] = [];
+        const afterTaskFilters = applyTaskFilters(shuffled, makeFilterContext(rootDir, { inFlight: exclusion.inFlight, retryExhausted: exclusion.retryExhausted }), undefined, (e) => filterSink.push(e));
```

### 落地门禁读数

- 反漂移 Touches 硬门（fan-in 同款）：`ANTI-DRIFT OK: task gap-worker-round-filter-trace-attribution — 3 actual file(s), all within declared Touches (4 glob(s))`，exit 0。
- scoped 门（fan-in 同款）：`bash scripts/test.sh --for-task gap-worker-round-filter-trace-attribution --allow-thin` ⇒ `tests 243 / pass 243 / fail 0`，**exit 0**，31.9s；选中列表含 `+ plugin/test/touches-relax-filter-trace.test.mjs`，本测试 6 条在其中全绿。
- scoped-gate 缓存已写（`--develop-sha` = 当时的 develop tip，且该 sha 是 HEAD 的祖先）。
- 工作树 `git status --short` 空。

## Definition of Done

真实落地 = **生产载体形态上真的出现可归因的 `filter_trace` 条目**，由**真实**过滤核 + **真实**记录装配器产生、从**载体文件回读**，不是「单测绿了」也不是「内存对象里有这个字段」。

四条逐一对上：① 新测试文件落地并 `exit 0`（AC1）；② 从 fixture 的 `.quay/worker-round.jsonl` **回读**出一行，其中一条是 `touchesDisjoint` 的完整归因（`blocker` 非 null + `overlapFiles` 非空 + `waitedMinutes` 为真值，三键同现，逐字贴出该行）；③ 取假形态两种注入各红一次（AC6，附红输出）；④ 前后对照证明派发决策未变（AC5 特征化 + AC9 的 `driver-filters.test.mjs` 绿 + 返回表达式 diff 为空）。

⛔ 只让单测变绿、或只在测试里手搓一个对象塞进断言，**不算**落地：AC-362 的判据面（`plugin/test/touches-relax-filter-trace.test.mjs` 存在且 55s 内通过）**单独不具备判别力**，它区分不了「真归因」与「恒真断言」——判别力由 AC6 的取假形态提供，故 AC6 不得省略、不得只在文字上声称跑过。

## Touches

- `plugin/scripts/driver-filters.ts`
- `plugin/scripts/worker-driver.ts`
- `plugin/test/touches-relax-filter-trace.test.mjs`
- `tasks/gap-worker-round-filter-trace-attribution.md`
