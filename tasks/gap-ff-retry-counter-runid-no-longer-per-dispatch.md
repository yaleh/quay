---
id: gap-ff-retry-counter-runid-no-longer-per-dispatch
title: ff 重试预算按 runId 计数，而 runId 已从「每次 dispatch 一个」变成「驱动进程生命期一个」⇒ 每周期只剩 1 次 ff
  机会而非 3 次；gap-fan-in-ff-retry-counter-scope 已 done 但其 AC2 此刻为假
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test plugin/test/fan-in-ff-merge.test.mjs
---
## Finding

**结论**：`ff-merge` 的重试预算按 `runId` 计数，而 `runId` 的语义在架构演进中**从「每次 dispatch 一个」变成了「worker-driver 进程生命期一个」**。计数器实现没变、测试全绿、任务 `done`，但它现在计的是完全不同的东西 ⇒ **一个任务在整个驱动生命期内累计失败次数，超过 2 次后每个后续派发周期只剩 1 次 ff 机会而不是 3 次**。

### 一、一条 done 任务的 AC 此刻为假（逐字，非转述）

`tasks/gap-fan-in-ff-retry-counter-scope.md`，`status: done`，AC 全勾：

> - [x] AC1（能取假，per-dispatch 隔离）：全新 dispatch 不继承历史失败次数（attempt 从 0 起）
> - [x] AC2（能取假，预算足额）：每个 dispatch 能跑满自己的 3 次预算（不被历史提前锁死）；**⛔ 历史失败 2 次的任务在新 dispatch 第 1 次就被锁 ⇒ 假**

**AC2 的取假条件此刻成立。** `gap-bypass-check-unclassifiable-exits-zero` 的升级记录（`.quay/fan-in-ff-escalations.jsonl`）：

```
attempt 5  ts=2026-09-06T23:29Z
attempt 6  ts=2026-09-07T02:14Z  developHead=0b2a6b4a…
attempt 7  ts=2026-09-07T03:07Z  developHead=968dce97…
attempt 8  ts=2026-09-07T03:32Z  developHead=dcaeb8e9…
```

四次相隔数小时的**独立派发周期**，`developHead` 每次都不同（是真实的新尝试），attempt 却单调累加到 8。闸是 `>= 3` ⇒ **每次的第一发就被判成第 8 次**。

### 二、为什么当年的修法是对的、现在失效了（前提变更，非实现退化）

计数实现 `packages/quay/src/fan-in/ff-merge.ts:406-419`：

```
// attempt counting (per-runId scope, gap-fan-in-ff-retry-counter-scope).
if (rec && rec.taskId === args.task && (rec.runId ?? null) === (args.runId ?? null)) prior++;
const attempt = prior + 1;
```

当年任务体里的实证 runId 是 `u5jgg9` / `22atfr`——**每次 dispatch 一个**，`runId` 与 `dispatch` 一一对应，故按 runId 隔离 ≡ 按 dispatch 隔离。

而现在 `plugin/scripts/driver-runtime.ts:1025`：

```
const runId = opts.runId || `${spec.runPrefix}-${Math.floor(Date.now() / 1000)}`;   // spec.runPrefix = "wk-prod"
```

⇒ `runId` 在 **driver 启动时生成一次**，此后**所有任务的所有派发周期共用**。

**量化证据（`.quay/fan-in-retries.jsonl`，242 条记录、137 个 runId）**：

| runId 形态 | 语义 | 单个 runId 最多记录数 |
|---|---|---|
| `fm-<task>-<epoch>-<rand>`（旧） | 每次 dispatch 一个 | ≤ 6（正好在 3 次预算内） |
| `wk-prod-<epoch>`（现行） | 每个驱动进程一个 | **31**（横跨 7 个任务） |

⇒ 不是计数写错了，是**它依赖的那个「runId 会变」的前提没了**。硬规则 4c 的形态：判据点名的量穿过中间层后不再是原来那个量；且这次的中间层是**时间**——前提在实现落地之后才改变，而没有任何机制会报出来。

### 二之二、⚠️ 常驻测试为什么恒绿——fixture 把那个前提钉死了（本条最可操作的一半）

`plugin/test/fan-in-ff-merge.test.mjs` 有覆盖 attempt 递增与 escalation 的用例（`:234` / `:315` / `:202`），它们**现在全绿**。原因是它们喂进去的 runId 是：

```
"--run-id", "fm-res-1786"        (:214)
assert.equal(rec.runId, "fm-gap-x-17866", …)   (:293)
```

**全是旧的 `fm-*` per-dispatch 形态**，而生产喂的是 `wk-prod-<epoch>`。⇒ 这些测试**结构上不可能**发现本缺陷：它们把「runId 每次 dispatch 都变」当作 fixture 常量钉住了，正是前提本身。

⊢ 硬规则④推论三（只能被 fixture 满足的判据不是测量）＋ 4c（判据的量须穿过中间层）的合体。**这也是为什么「测试全绿 + 任务 done」与「缺陷正在生产上流血」可以同时为真。**

### 三、闩锁范围（立案时实测，全量非采样）

当时的 `runId=wk-prod-1788717081` 下有 retry 记录的任务 **7** 条，其中 **5 条已闩锁**（prior ≥ 2 ⇒ 下一次 ff 当场升级）：

```
gap-bypass-check-unclassifiable-exits-zero                 prior=8
gap-meta-carrierstats                                      prior=6
gap-goal-driver-draft-ac-invisible-yet-blocking            prior=6
gap-goal-gate-timestamp-commit-flood                       prior=5
gap-meta-divergence-recommendation-recurrence-invisible    prior=4
```

**⚠️ 没有任何裁剪路径**：`fan-in-retries.jsonl` 纯追加（`:479` 唯一写点），成功落地写的是**另一个文件**的 `ff-escalation-resolved`（`:510`），**不碰计数器**。⇒ 闩锁一旦形成，在该驱动进程生命期内不可逆。

### 四、区分性对照（硬规则④推论四：解释不等于结论）

**对照一（正向）**：`gap-goal-gate-timestamp-commit-flood` prior=5（已闩锁）却成功落地——因为当时 goal+meta driver 被停掉，develop 静到**单发即中**。闩锁假说预测「只在 develop 足够安静时能落地」，与实测一致。

**对照二（反向，立案当轮实跑）**：`quay driver restart --kind worker` ⇒ 新 `runId=wk-prod-1788752418` ⇒ 同一份载体重算：旧 runId 闩锁 5 条，**新 runId 闩锁 0 条**，两条在飞 worker 存活不受影响。⇒ 若根因不是 runId 作用域，重启不应改变任何计数。

⛔ **但重启不是修法**：它需要人介入、且把所有任务的预算一并清零（包括真有问题该被拦的），只是本轮的止血。

### 五、这条是当前交付阻塞的主因

近 7 天 `→needs-human` 翻转 **71 次，其中 69 次（97.2%）**判词为「重试上限机械翻转」；本条是其中 ff 步那一支的机制成因。

**方向倾向（供执行者判断，非强制）**：把计数键换成**每次 dispatch 真正会变的量**——候选：worker 派发时生成的一次性 id、任务 worktree 的分支 tip、或显式的 dispatch 序号。⛔ **不接受**：①靠重启驱动清计数（需人介入、且清得过宽）；②把 `>= 3` 阈值调大（治标，且掩盖真实活锁）；③把 `runId` 改回每次 dispatch 一个（`wk-prod-*` 的进程级语义在遥测/归属侧有其它消费者，改它会波及别处——若执行者核实后认为可行，须逐个列出消费者并说明为何不受影响）。

**执行落点（DoD 3 关系）**：`gap-fan-in-ff-retry-counter-scope`（done）修的是「全文件累计 → 按 runId」——在「runId 每次 dispatch 一个」的当年前提下，按 runId 隔离 ≡ 按 dispatch 隔离，故其修法正确；本条修的是「runId 不再等于 dispatch」（runId 语义漂移为进程生命期 `wk-prod-*`）——**前提变更属新缺陷**，故新立而非重开。本条的修法是改**计数侧**（新增 per-dispatch `attemptKey`，机械 fan-in 传其 per-suite runId `mfi-<task>-<epoch>-<rand>`），⛔ 不改 `runId` 生成侧（`wk-prod-*` 在遥测/归属/日志命名侧仍有消费者）。

## AC

- [x] 计数键每次 dispatch 都变：断言同一任务在**两次独立派发**下 `attempt` 都从 1 起（⛔ 不得靠「重启驱动」制造这个效果——判据须在同一驱动进程/同一 `runId` 下成立，硬规则 4c：判据要穿过中间层）。
- [x] 能取假（预算足额）：构造一个已有 2 条历史失败记录的任务，在**新派发**下第 1 次 ff 失败**不**触发 escalation；把计数键改回 runId ⇒ 该断言立即变红。两个方向都断言。
- [x] **测试喂的是生产形态的 runId**：`plugin/test/fan-in-ff-merge.test.mjs` 中所有 attempt/escalation 相关用例改用 `wk-prod-<epoch>` 形态（生产实际形态），⛔ 不再用 `fm-*`；并断言「同一 `wk-prod-*` 下的两次独立派发互不累计」——**这一条在改动前必然为红**（它正是当年那些用例结构上测不到的东西）。
- [x] 真实活锁仍被拦：同一次派发内连续 3 次 ff 失败**仍**触发 escalation（⛔ 不得为了让上一条通过而废掉防活锁本身）。
- [x] 载体可核对：retry 记录里带上新计数键，使「这一条属于哪次派发」可由一条命令读出；⛔ 不得只在内存里算而载体上看不出来。
- [x] 立案时的 5 条闩锁任务在改动后不再处于「下一次即升级」状态，由一条读载体的命令给出前后对照读数（⛔ 不是断言，是读数）。

## DoD

- [x] 上述判据本轮实跑并贴出输出（⛔ 不是转述），双向负控制均实跑确认能取假。
- [ ] **生产载体证据（非 fixture）**：改动落地后，从 `.quay/fan-in-retries.jsonl` 读出至少一条真实新记录，其计数键与同任务上一次派发的键**不同**；⛔ 不得以 fixture 通过冒充生产已验（硬规则④推论三）。（待外部）
- [x] `gap-fan-in-ff-retry-counter-scope`（done）的关系写入任务体：那条修的是「全文件累计 → 按 runId」，本条修的是「runId 不再等于 dispatch」；说明为何**不是**把它重开而是新立（其修法在当年的前提下正确，前提变更属新缺陷）。
- [x] ⛔ 未把防活锁阈值调大；⛔ 未采用「靠重启驱动清计数」作为修法；⛔ 未新增 driver kind、未新增周期性检查器（SPEC §5.1）。
- [x] 若执行者判断应改 `runId` 生成侧而非计数侧，须先逐个列出 `wk-prod-*` 的现有消费者（遥测/归属/日志命名等）并说明各自为何不受影响——**列不出这个清单则不得走这条路**。（本执行者改的是计数侧，非生成侧——见上方「执行落点」）

## Touches

- `packages/quay/src/fan-in/ff-merge.ts`
- `plugin/scripts/worker-driver.ts`
- `plugin/test/fan-in-ff-merge.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-ff-retry-counter-runid-no-longer-per-dispatch.md`
