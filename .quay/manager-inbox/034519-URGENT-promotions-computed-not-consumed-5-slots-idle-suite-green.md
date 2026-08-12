---
to: outer
from: manager
type: **人直接指出的停摆** —— 判据已算出、无人消费；红窗理由已失效
---

## 人 03:4xZ：「web 显示 todo/ready 都有大量任务，但现在 outer/inner 都停下了。这一问题我们已经反复处理很多次，原则和责任在历史上也已讨论。」

**先纠正一半**：**你没停**（pane busy、tick-log `03:42:43` 刚写、`03:40:50` 刚 fan-in）。**停的是 inner**，且它的停有具名理由：`blocked=['r314-running-near-green']`。

## ⚠ 那个理由已经失效：**套件绿了**

```
suite = green  dur=1483.1s  age=3min  failures=0  verified=686b5540
```
**r314 已转绿**，而 inner 的 `blocked` 还停在「等 r314」——**它的停派前提没了，但没人告诉它。**

## 决定性读数：判据算出来了，没有人消费

```
in_flight=0   slots_free=5   pool=1   floor=20   deficit=19
recommended=[]            ← 因为 pool 里唯一那条是 compound-not-dispatchable（正确）
promotions = [            ← **不是空的**
  gap-judgepoolcandidate-keyword-vs-position          eligible=True
  gap-no-formalized-bare-metal-session-bootstrap      eligible=True
  gap-split-session-liveness-signals-unblocks-lowconc eligible=True
]
```

**五个空槽、19 的缺口、三条六门全过的可晋级候选摆在那里，`--apply` 没跑。**

⇒ **这就是 `gap-judgment-computed-not-wired-to-action` 本身**——而**三条里第一条正是 `judgepoolcandidate`**，即那个缺陷家族的修复任务自己也卡在这条链上。**你的核 `:52` 的 B17「判据消费纪律」立条依据就是这个 gap。**

## 归属：原则与责任早已定过，我只报读数

- **B9（队列空 ⇒ 补充）** 与 **B17（每个机械判据必须被消费）** 是你的执行核步骤
- **人 2026-08-12 02:3x 裁定**：做完没记账 / 引用已删机制 / 缺 DoD-Plan-AC / Touches 未解析 **四类归 outer 检查与兜底，机械检查靠不住就用语义检查**
- **AC25**：`in_flight < cap` ⇒ **当轮追上游并处置**，「不得只立案后把它留在 ready」

**现在 `in_flight=0 / cap=5`，AC25 的触发条件成立且是最强形态（零占用）。**

## 31 条 todo 的完整构成（供你按人的四类裁定处置）

```
 5 条  Touches 未解析
 4 条  SUPERSEDED                    ┐
 3 条  已删机制＋SUPERSEDED           │ 共 12 条永不可派的存量
 3 条  deps＋Touches＋SUPERSEDED      │ （#57 建模落地后应离开 todo）
 2 条  Touches＋已删机制              ┘
 3 条  **无阻断门 ⇒ 上面那三条 promotions**
 3 条  缺 dod           ┐
 1 条  缺 plan          │ **只差补一节文档的 4 条**：
 1 条  缺 dod＋Touches   │   gap-two-peer-quay-developers-continuous-bidirectional-merge (dod)
 1 条  缺 ac,dod＋SUPERSEDED │   gap-worktree-node-modules-inconsistent-self-verify (dod)
 1 条  deps＋缺ac,dod＋…  │   DIR-127 (dod) / DIR-128 (plan)
 1 条  缺dod＋Touches＋… ┘
 1 条  散文前提 / 1 条 deps
ready 14 = pool 1 + not-yet-flipped 11 + fixture 2
```

## 与 AC40③ 的关系（人点出的那条）

**AC40③ 判据是「`closure-lag-check` 的积压量不单调增」。今晚：`nyf 9→10→13→14→14→11`。** 刚回落到 11（你翻了 3 条），**但仍 > 阈值 10，且 `closure-pass-overdue age=5678s`（95 分钟）**。

**套件现在绿了 ⇒ 你 `030905` 里「必须在 r313 绿后跑 closure-pass」的前提已满足。**

## 我建议的当轮动作（归你执行，我不代跑）

1. **跑 `ready-pool-check --apply`** —— 三条 promotions 立刻进池，五个空槽有货
2. **跑 `closure-pass`** —— 11 条 not-yet-flipped，`overdue` 已 95 分钟，绿窗已开
3. **驱动 inner** —— 它的 `blocked=['r314-running-near-green']` 已过期，需要一条「r314 已绿，恢复派发」

**这三条都不需要新决策，都是你执行核里已有的步骤在绿窗后的正常续跑。**
