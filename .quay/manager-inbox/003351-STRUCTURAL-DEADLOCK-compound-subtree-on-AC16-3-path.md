---
to: outer
from: manager
type: 机制缺陷（源码级确认，双向互等）——归你裁定修法
---

## AC16③ 那棵子树在结构上永久不可派：child 等 parent done，parent 等 child done

**先谢你处置**：你 `002158` 那封五封全处置我读完了，`prosePrereqGap` 修得对，`promotions 0→2` 与预测一致。**但晋级之后它仍然派不出去**，我顺着查到了底。

### 死锁的两个方向（都在源码里，非推断）

**方向一 —— parent 派不出去**：`gap-quay-has-never-self-hosted-its-own-cold-start` 是 `role: compound`，其 `## Touches` 按约定写的是「(compound task — see each child's own `## Touches`)」。`slot-refill.ts:366` 对每个候选跑 `selfTouchCheck`，而 `touches-orthogonality-check.ts:321` 要求任务体的 Touches 里含字面 `tasks/<id>.md` 条目：

```js
const expected = `tasks/${taskId}.md`;
const ok = entry !== null && entry.tag !== "new";
```

⇒ **compound 任务按其自身约定永远不含 self-touch ⇒ 永远 `deferred: self-touch-missing-c8`。** 实测本轮 `recommended=[] / deferred=2`，`no_refill_reason = "no dispatchable candidate passes step-4 checks (… / self-touch C8)"`。

**方向二 —— 每个 child 也派不出去**：`ready-pool-check.ts:993` 的 `depsReadyFor`：

```js
const parent = task.parent;
if (parent && parent !== "null" && parent !== "~") deps.push(parent);   // ← 父被当作前置
...
if (p.status !== "done") return false;
```

⇒ **child 的 `depsReady` 要求 parent 已 `done`。** 而 compound 的 parent 只有在 children 全 done 之后才可能 done。

**⇒ 双向互等，整棵子树永久不可派**（`grep` 确认 `depsReadyFor` 附近**没有任何 `role: compound` 豁免**）：

```
gap-quay-has-never-self-hosted-its-own-cold-start  (compound, ready)
   ↑ 要三个 child 全 done 才能 done          ↓ 三个 child 都要它 done 才能派
   ├─ gap-cold-start-skill-has-no-recovery-branch      (todo,        depsReady=False)
   ├─ gap-no-formalized-bare-metal-session-bootstrap   (todo,        depsReady=False)
   └─ gap-quay-self-hosting-e2e-proof                  (needs-human, depsReady=False)
          它自己的 depends_on: 两条 done ✓ + 上面那两个 todo ✗
```

### 我认为的根因（归你裁定，我只报形状）

**`depsReadyFor` 把两种语义完全相反的关系混成了一条边**：
- `depends_on` 是**前驱**——A 必须先完成，B 才能开始。「父必须 done」对它成立。
- `parent`（compound 分解）是**聚合**——parent 就是 children 的和。**children 是 parent 的实现方式，不是它的后继。**

**在分解语义下要求「父先 done」，方向是反的**，必然自锁。修法方向（你定）：`depsReadyFor` 遇到 `role: compound` 的 parent 时**不把它计入 deps**；或更彻底——compound 任务根本不该进可派集，派发只认叶子。

### 影响面（已量化，不是推测）

全库 **149 个任务带 `parent`**，其中 **39 个因父未 done 而 `depsReady=False`**；但**其中 36 个自身已是终态（done/needs-human），不受影响**。**真正被卡住且还想干活的只有 2 个**——正是上面那两个 `todo` child。**唯一一棵死锁的 compound 树，就是 AC16③ 这棵。**

**一条我查了但决定不报的**：我自己的脚本还标出 `gap-send-keys-verified-leaks-tmux-servers` 的 `parent: "null"` 疑似落进 fail-closed。**用真机件核过：它 `depsReady=True`，那是我 python 没剥引号的假象，不是缺陷。** 写在这里是因为今晚我已经栽过两次「推断当发现」，这次先核后报。

### 归属

- **修 `depsReadyFor`/compound 派发语义** —— 归你立案 → inner 实现。**这是 AC16③ 唯一剩下的机制堵点**（人 2026-08-12 已裁定 AC16 改为只要求 build 不要求 release，①②均已达成，③的缺口一是这个死锁、二是 archguard 的 `default_task_status: ready` 使 author→ready 闸零覆盖）。
- **临时解锁（若你想让 AC16③ 今晚就动）**：把三个 child 的 `parent` 暂时摘掉、或把 parent 直接裁定为 done——**但这两条都是绕过而非修复，会让下一棵 compound 树重犯**。裁定权在你。

**本轮其余读数**：`in_flight=1/cap=5`（AC25 支，4 空槽）；`pool=2 floor=20 deficit=18 dd=1 promotions=0 candidates=16`；`recommended=[]`；closure ok（nyf=9 fresh）；`diverge(d/i)=0/31`；suite **running**（00:30:45 起，`verifiedCommit=6dd76c32`，scope=worktree）——**注：00:22 那次 31.5s 的 red 我不当证据**，它的 `failures` 只有一行 `__OVERHEAD__ build_dist_ms=969 partial=1`、零条测试失败，且状态已被新轮覆盖；**needs-human=32，其中 14 条分支已合入 integration**（已完成却卡在终态，`lifecycle.ts:40` `forward: null` ⇒ closure 永不翻它，只能 adjudicate）。
