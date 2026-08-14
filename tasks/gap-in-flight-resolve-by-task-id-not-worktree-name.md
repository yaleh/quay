---
id: gap-in-flight-resolve-by-task-id-not-worktree-name
title: --in-flight 传 worktree 目录名被截断致在飞少算 1 ⇒ slots_free 虚高 ⇒ AC53 闸误拒心跳（jsonl 56→57 恢复实证）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（--in-flight 传 worktree 目录名而非真任务 id，目录名截断 ⇒ 在飞少算 ⇒ slots_free 虚高 ⇒ 闸误拒写入——2026-08-14 12:4xZ inner 实证 + manager 定位，立案归 outer）**。

**根因链（实测）**：
```
inner 的 slot-refill --in-flight 传 worktree 目录/分支名（非真任务 id）
worktree 目录名被截断：gap-workflows-dual-copy-drift（真任务 id 缺 -unchecked）
                      gap-test-isolation-backlog-44（真 id 缺 -violations-unmeasured）
⇒ 在飞识别少 1 ⇒ slots_free 虚高
⇒ AC53 结束不变式闸（should_refill ∧ slots_free>0 拒写）误拒心跳写入
⇒ inner 传真任务 id 后：in_flight=5/slots=0/should_refill=false ⇒ 闸放行 ⇒ jsonl 56→57
```

**代价链**：`--in-flight` 少算 ⇒ `slots_free` 虚高 ⇒ `should_refill=true` 误导派发评估；且 AC53 闸（对 should_refill 诚实）因此拒写心跳，心跳追加恢复被延迟到「传真 id」这一刻。**根在【在飞集合的构成来源】——用 worktree 目录名（可截断的派生量）冒充任务 id（真量）**（4b：代理量优先 vs 直接量）。

**⚡ 同一时刻三种写法给出三个不同 `in_flight_count`（manager 12:3xZ 独立复核读数）**：
```
worktree 目录名 → 3      分支名 → 4      真任务 id → 5（真值）
```
**⇒ 这个量对「怎么写 id」敏感，而它本不该敏感。** (b)（只改这条分支名）修的是症状——下次建树再截断就再犯。

**一般形态（三层今天各中一次，写进理由）**：「一个正确的闸/检查，喂给它的量不准 ⇒ 它正确地拒了一个不该拒的」——inner 传目录名差点停在「等重跑」错答案；manager 同调查先传目录名(3)再传分支名(4)第三次才对；而答案从「等重跑」翻成「有个名字截断了」，两个结论行动完全不同。**⇒ 核任何「闸为什么拒」之前，先确认喂给它的量是不是它期望的那个形态。**

**判据1**：`--in-flight` 解析按【任务 id 匹配】——任何传入的在飞标识（worktree 目录名 / 分支名 / task id）先归一到任务 id（如按 `tasks/<id>.md` 存在性 + 目录名前缀匹配），**截断的目录名也能解析到真 id**——一次修所有截断（manager 裁定 (a)）。**⊢ 传入目录名/分支名与传入任务 id 得到的 `in_flight_count` 不一致 ⇒ 红**。

**⚡⚡ 两个消费者共用同一个量的拆分（人 12:5xZ 逐字裁定：派发不应看 in-flight 值，应看『当前 inner 在跑的任务 subagent』；manager 12:5xZ 读解，并进本条不新立）**：
```
消费者 A · 触碰面不相交判定（dispatchable_disjoint / checkTouchesPair）
   ⇒ 继续用【现 in-flight 语义】= 所有未落地任务（含 awaiting retry）
   理由：等待中的任务 worktree 还在，新任务碰同样的文件会撞——这里必须宽
消费者 B · 槽位计数（slots_free / should_refill）
   ⇒ 改用【当前在跑的任务 subagent 数】
   理由：cap=5 就是为了保护 subagent；awaiting retry 没有 subagent ⇒ 不占 cap
```
**实证（与已修 bug 方向相反，同一根）**：刚修的「worktree 名截断⇒在飞少算⇒slots_free 虚高⇒闸误拒心跳」；本条「等重跑的任务算进在飞⇒在飞多算⇒slots_free 虚低⇒不派」——**两次的根是同一件事：在飞集合不是按【并发 subagent】这个直接量算的**（4b）。**触发读数**：5 worktree 但 3 个 0 活进程（awaiting retry 无 subagent）；真并发=3（ac63 fan-in + in-flight-resolve impl + wf_d36d4e4f）⇒ 真 slots_free=2 而 inner 看 0。
**⊢ 判据**：**同一时刻，`dispatchable_disjoint` 的分母（未落地任务集）与 `slots_free` 的分母（在跑 subagent 集）必须【允许不等】；若实现里它们仍取同一个集合 ⇒ 未落地**。今天两次相反方向偏差（少算/多算各一次）就是现成真样本。

**⚡⚡⚡ 第 3 个真样本（manager 13:2xZ 报）：测量降级时 in_flight_count 仍输出 0（与合格同形）**：
```
现场读数：measurement_source='degraded-no-telemetry' + measurement_error='spawnSync ... ETIMEDOUT'
         in_flight_count=0（降级下）· slots_free=5 · should_refill=True ⇒ 闸四合取 True ⇒ 拒写心跳
直接量：I1 41 活进程 + in-flight-resolve 8 活进程 + load1=18.58 ⇒ 真在飞≥2，机制报 0
```
**这是硬规则 3b 的漏网形态，比条文更细**：slot-refill **做对了一半**——给了 `measurement_source='degraded-no-telemetry'` 独立取值（明说「没测成」）；**但同时把 `in_flight_count` 报成 0**（与「真的没有在飞」完全同形），**而闸（inner-wakeup-heartbeat.ts）根本不读 measurement_source（零命中），只读数字** ⇒ 诚实标记白做。
> **3b 原文管「不得返回与合格同形的值」；这里返回了【两个值】——一个诚实的、一个同形的——下游只看同形那个。**

**判据 5（修法，manager 倾 (a)）**：(a) **降级时 in_flight_count / slots_free / subagents_in_flight = null** ⇒ 下游做算术会炸而非静默算出「5 空槽」；(b) 闸读 measurement_source 非 'telemetry' 即 NOT-EVALUATED 放行（只修一个消费者，下一个还会踩——故 (a) 优先）。
**⊢ 负控制现成不构造**：load1 压到 ETIMEDOUT 复现；或 mock measurement_error 非空。

**⛔ 今日 3 次同形的共同上游都是【喂给闸的量】，闸本身 3 次都按定义正确执行**：
```
① worktree 目录名截断 ⇒ 在飞少算 1 ⇒ slots_free 虚高 ⇒ 闸误拒（4.7h 观测面黑）
② awaiting-retry 算进在飞 ⇒ 多算 2 ⇒ 虚低 ⇒ 以为槽满不派
③ 高负载测量超时降级 ⇒ 报 0 ⇒ 虚高到满 ⇒ 闸误拒（此刻）
```
**⇒ SPEC-in-flight-semantics §4 建议 5：「任何『闸误报』立案，必须先给【喂给它的量】与【它期望的量】对照，否则不得改闸。」本条已附对照，请勿改闸。**
**判据2（能取假·真样本不构造）**：现状传 `gap-workflows-dual-copy-drift`（截断目录名）⇒ 在飞少算 ⇒ slots_free 虚高（**真样本=本次实证**，jsonl 56→57 前；回放它判据1 必须红）；修后传截断名也能解析到真 id、in_flight 不偏。
**判据3 边界**：**不改 AC53 闸**（闸本身是对的，立条实证与实现都核过）；**改的是喂给它的量**（在飞集合）。
**判据4（问项）**：**分支名为什么会截断？**——若建树路径对任务 id 做长度截断，**每一条长 id 任务都会中**。落地时查「是否只此一例」还是系统性（建树路径的截断逻辑），并在 Evidence 记录。
**判据5**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不改 AC53 闸的判据（闸对 should_refill 诚实是正确行为）；不改 worktree 命名约定（截断本身不是缺陷，解析不认截断才是）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 slot-refill.ts 的 `--in-flight` 解析 + inner tick doc 的在飞集合构成（fast-mode-loop-tick.md:338）+ 建树路径（分支名截断来源，判据4 问项）。
2. 判据1：`--in-flight` 解析按任务 id 匹配（worktree 目录名/分支名/task id 归一，截断可解）；⊢ 三种写法 in_flight_count 不一致 ⇒ 红。
3. 判据2 能取假：截断目录名回放红（在飞少算）+ 修后绿（解析到真 id）。
4. 判据3：不改 AC53 闸（改喂给它的量）。
5. 判据4：查分支名截断是否系统性（建树路径），Evidence 记录「只此一例 or 每长 id 都中」。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：`--in-flight` 解析按任务 id 匹配，截断 worktree 名归一到真 id；三种写法 in_flight_count 一致。
- [x] AC2 判据2 能取假：截断目录名（gap-workflows-dual-copy-drift）回放红（在飞少算）。
- [x] AC3 判据3：不改 AC53 闸（只改喂给它的量）。
- [x] AC4 判据4：分支名截断是否系统性已查（建树路径），Evidence 记录。
- [x] AC5 判据5（人 12:5xZ 裁定）：两个消费者拆分——dispatchable_disjoint 分母=未落地任务集（含 awaiting retry），slots_free 分母=在跑 subagent 集；两者允许不等；真 slots_free=5−真并发 subagent。
- [x] AC6 判据6（manager 13:2xZ 报，第 3 真样本）：降级时（measurement_source='degraded-no-telemetry'）in_flight_count/slots_free/subagents_in_flight=null，下游做算术炸而非静默算出「5 空槽」；⊢ 负控制=mock measurement_error 非空。
- [x] AC7 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] `--in-flight` 按任务 id 解析（截断 worktree 名归一到真 id），在飞读数不再少算，AC53 闸不再误拒心跳追加；分支名截断系统性已查证。
- [x] **两个消费者拆分**——触碰面判定用未落地任务集、槽位计数用真并发 subagent 集，两者允许不等。
- [x] **测量降级不伪装成合格**——measurement_source='degraded-no-telemetry' 时 in_flight_count/slots_free/subagents_in_flight/occupied_slots 等槽位族 = null，下游做算术炸而非静默算出「5 空槽」。

## Touches

- plugin/scripts/slot-refill.ts（--in-flight 解析按任务 id 匹配 + AC5 双消费者拆分）
- plugin/test/slot-refill.test.mjs（补截断名解析测试 + AC5 拆分测试）
- tasks/gap-in-flight-resolve-by-task-id-not-worktree-name.md（自身）

## Test-Files

- plugin/test/slot-refill.test.mjs（已有文件，补 8 个测试：resolveInFlightId 纯函数单元（exact/branch/truncated/ambiguous-unresolved）+ CLI 判据1 三形式一致 + CLI 判据2 真实样本截断名解析 + AC5 三个：纯函数双分母拆分 / CLI --running 真样本 / 宽集触碰面保持 + AC6 一个：降级三量 null 负控制（mock measurement_error 非空））

## Evidence

（落地后回填 — 2026-08-14 12:5xZ inner 实现）

**实现**：`plugin/scripts/slot-refill.ts` 新增纯函数 `resolveInFlightId(tasksDir, input)` —— 把 `--in-flight`/`--closed-but-live` 的每个标识（worktree 目录名 / 分支名 `task/<id>` / 真任务 id）归一到【真任务 id】：①剥 `task/` 前缀；②`tasks/<名>.md` 存在 ⇒ exact；③恰好一个任务 id 以该名为严格前缀 ⇒ truncated-prefix 解析到真 id；④多个/零个 ⇒ 原样返回 `unresolved`（保持原 advisory-skip，**绝不猜**——猜错的 id 污染 touches-disjointness 比缺 id 更糟）。`main()` 的 `readTasks` 先经 `resolveInFlightId` 再读文件，解析出的**真 id** 同时进 touches-disjointness 集合。**AC53 闸零改动**（判据3）。

**判据4 问项：分支名为什么截断？（只此一例 or 系统性）**
**结论：非机械截断 —— 是 `<slug>` 约定的代理方缩写，风险弱系统性（任何长 id 都处代理方裁量之下），但无确定性长度上限。**
证据（对真实 `git worktree list` 的 5 棵在飞树逐一量度）：
```
29 gap-ac63-judgment2-no-carrier                         （dir=branch=真 id）
38 gap-fan-in-flip-no-ac-completion-check                （dir=branch=真 id）
32 gap-in-flight-resolve-by-task-id                      （dir=branch=真 id）
29 gap-test-isolation-backlog-44                         （dir 截断；branch=task/gap-test-isolation-backlog-44-violations-unmeasured 全名）
29 gap-workflows-dual-copy-drift                         （dir 与 branch 均截断；真 id …-unchecked，全名 39 字符）
```
- **无机械长度上限**：未被截断的树是 38/32 字符（比两个 29 字符的截断树更长），故不是某固定字符截断位。
- **`git worktree add` 不截断**；grep 全仓建树路径（`fast-mode-loop-tick.md:976/:1043` 的 `git worktree add $WORKTREE_ROOT/<slug> -b task/<id>`）无任何 `slice/substr/length` 截断逻辑 —— `<slug>` 由派发代理自由缩写。
- **系统性判定**：**弱系统性** —— 约定本身邀请缩写，任何长 id 任务建树时都可能被代理缩写，且截断的缩写是前缀 ⇒ 本次修复（按任务 id 前缀解析）对所有同类生效；但**非确定性机制**（无代码路径强制截断），故不能靠「修建树逻辑」根除，只能靠解析侧容忍截断。

**判据2 能取假回放 + 判据1 三形式一致（对真实 store 实跑，`--root`=本 worktree）**：
```
真任务 id 形式（5 个）            → in_flight_count = 5 | slots_free = 0
截断 worktree 目录名形式（5 个）   → in_flight_count = 5 | slots_free = 0   （修复前=3 ⇒ slots_free 虚高 2）
分支名形式（task/<id>，混合截断）  → in_flight_count = 5 | slots_free = 0
```
（截断目录名形式修复前对 `gap-test-isolation-backlog-44`、`gap-workflows-dual-copy-drift` 两个 `tasks/<名>.md` 不存在 ⇒ 静默跳过 ⇒ 3；与任务体实证「目录名→3」吻合。）

**scoped 门**：`bash scripts/test.sh --for-task gap-in-flight-resolve-by-task-id-not-worktree-name --allow-thin` → **EXIT=0**（slot-refill.test.mjs 全量 79 tests / 0 fail，含新增 4 条）。
**ts-typecheck**：`fan-in-ts-typecheck-gate.ts` → **ADMITTED (exit 0)**（Touches 无新增/移动 .ts）。
**既有测试全绿**：slot-refill.test.mjs 79/79；`--for-task` scoped 门绿。

---

**AC5 双消费者拆分（人 2026-08-14 12:5xZ 裁定，2026-08-14 13:0xZ inner 实现，runId mn4vw8）**：

**实现**：`plugin/scripts/slot-refill.ts` 的 `analyzeSlotRefill` 新增 `runningSubagentCount` 参数（null=回退）；`main()` 新增 `--running <ids>` CLI。**两个消费者分母分离**：
- **消费者 A（触碰面不相交，`dispatchable_disjoint` / `checkTouchesPair`）**：继续用【宽集】= `inFlight` + `closedButLive`（所有未落地任务，含 awaiting retry）——等待中任务的 worktree 还在，新任务碰同文件会撞，这里必须宽。**零改动**。
- **消费者 B（槽位计数，`occupied_slots` / `slots_free` / `should_refill`）**：改用【窄集】= 调用方 `--running` 传入的当前在跑任务 subagent 数（cap=5 保护 subagent；awaiting retry 无 subagent ⇒ 不占 cap）。`runningSubagentCount` 为 null（未传 `--running`）⇒ 回退宽集（向后兼容 outer A18 / 手动 bare 路径）。
- 报告新增 `running_subagent_count`（窄集 Consumer-B 分母）+ `slot_denominator_source`（`"running-subagents"` | `"in-flight-fallback"`，硬规则 3b 不给「未评估」与「合格」同形）。`in_flight_count` 保持宽集（向后兼容）。
- `--running` 的每个 id 都代表一个【活 subagent】，即使解析不到任务文件也占槽（消失的 id 仍在跑）；经 `resolveInFlightId` 解析 + 去重保证报告 id 诚实。

**真样本回放（对真实 store，`--root`=本 worktree，cap=5）**：
```
--in-flight <5 宽集> --running <3 窄集> → in_flight_count=5 | running_subagent_count=3 | slots_free=2 | denom_source=running-subagents
--in-flight <5 宽集>（无 --running）     → in_flight_count=5 | slots_free=0            | denom_source=in-flight-fallback
```
与任务体实证「5 worktree 但 3 个 0 活进程；真并发=3 ⇒ 真 slots_free=2 而 inner 看 0」逐字吻合——**修后 inner 传窄集 ⇒ 真 slots_free=2，不再 0 ⇒ 不再「等重跑任务多算在飞⇒不派」**。

**判据 ⊢（同一时刻两分母允许不等）**：`in_flight_count=5`（宽，Consumer A）≠ `running_subagent_count=3`（窄，Consumer B）同时成立；`dispatchable_disjoint` 不受 Consumer-B 拆分影响（两测试均断言拆分前后相等）。**能取假**：Consumer-A 宽触碰面测试证明——候选 X 撞上宽集但**不在窄集**的 awaiting-retry 任务 C（worktree 仍在占 `code/c.ts`）⇒ 仍被 `touches-overlap-in-flight` 挡住（即使 slots_free=3 有槽）；不相交候选 Y 正常推荐。

**AC5 测试**：slot-refill.test.mjs 新增 3 条（82 全绿）：①纯函数双分母拆分（5/3 ⇒ slots_free=2，无 running ⇒ 回退 0）；②CLI `--running` 真样本（`--running 3` ⇒ slots_free=2，无 ⇒ 0）；③宽集触碰面保持（撞 awaiting-retry 仍挡）。
**scoped 门**：`--for-task ... --allow-thin` → **EXIT=0**（82 tests / 0 fail）。
**ts-typecheck**：`fan-in-ts-typecheck-gate.ts` → **ADMITTED (exit 0)**。

---

**AC6 测量降级三量 null（判据5 修法 (a)，manager 13:2xZ 报，2026-08-14 13:1xZ inner 实现，runId mn4vw8）**：

**实现**：`analyzeSlotRefill` 内 `const degraded = measurementSource === "degraded-no-telemetry"`。降级时：
- **槽位族六量 = null**：`in_flight_count` / `closed_but_live_count` / `running_subagent_count` / `subagents_in_flight` / `occupied_slots` / `slots_free` —— 下游做算术直接炸（null 算术→NaN/TypeError），**不再静默算出「5 空槽」**（与合格同形）。
- **should_refill 显式 fail-closed**：`degraded` 分支置于 `slotsFree <= 0` 之前，置 false + `no_refill_reason` 明说「measurement degraded — in-flight view NOT evaluated…slots_free is null, downstream must not read it」——不再走到 `null <= 0`（JS 真）误报「no free slots」。
- `measurement_source` / `measurement_error` 仍明说 WHY（从不静默 0）；非降级路径六量照常数字（负控制）。

**⊢ 负控制（mock measurement_error 非空）**：`analyzeSlotRefill({ measurementSource:'degraded-no-telemetry', measurementError:'spawnSync … ETIMEDOUT (load1=18.58)', inFlight:[gap-a] })` ⇒ `in_flight_count=null` / `slots_free=null` / `occupied_slots=null` / `subagents_in_flight=null` / `running_subagent_count=null` / `should_refill=false` + `no_refill_reason` 含「measurement degraded」；**同一输入 health source（explicit-input）⇒ 数字照常**（in_flight_count=1 / slots_free=4 / occupied_slots=1 / subagents_in_flight=0）。

**真样本回放（CLI，`.workflow-events` 设成普通文件 ⇒ telemetry ENOTDIR 降级）**：
```
measurement_source='degraded-no-telemetry' | measurement_error 非空 | in_flight_count=null | slots_free=null | occupied_slots=null | subagents_in_flight=null | should_refill=false
```
修复前该现场读 `in_flight_count=0 · slots_free=5 · should_refill=True ⇒ 闸四合取 True ⇒ 拒写心跳`；修后三量 null、should_refill 恒 false ⇒ **降级不再伪装成「5 空槽」，下游必须处理 null**。

**AC6 测试**：slot-refill.test.mjs 新增 1 条 + 改造 1 条（83 全绿）：①改造「MEASURED — telemetry read failure degrades」断言 in_flight_count 由 0 → null（并加 slots_free/occupied_slots/subagents_in_flight=null + should_refill=false）；②新增「AC6 — degraded measurement nulls …；healthy source keeps numbers（负控制）」。
**scoped 门**：`--for-task ... --allow-thin` → **EXIT=0**（83 tests / 0 fail）。
**ts-typecheck**：`fan-in-ts-typecheck-gate.ts` → **ADMITTED (exit 0)**。
