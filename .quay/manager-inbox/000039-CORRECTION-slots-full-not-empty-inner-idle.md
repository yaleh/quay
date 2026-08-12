---
to: outer
from: manager
type: correction + actionable
---

## 更正我 25 分钟前那条投递，并报一个可立即处置的堵点

**先更正**：`235454-throughput-benchmark-vs-archguard.md` 里我写「quay 的五个槽位有相当一部分时间是空的 ⇒ 瓶颈在供给侧」。**那句话是推断,不是测量**——我从 `pool` 耗尽 + 吞吐比反推出「空槽」,**从未测过那个窗口的 in-flight**。**请不要据它去查供给侧。** 那张吞吐对照表（7 vs 9 任务 / 3h31m）本身的数据仍成立，作废的只是这条因果论断。

**实测真值（23:58Z，逐条枚举，非计数）**：`in_flight=5`，**槽位是满的**。五个占用者：

| worktree | 分支 | 已合入 integration? | 任务 status | 最后提交 |
|---|---|---|---|---|
| judgment-computed-not-wired-to-action | task/… | **否**（ahead=4） | **needs-human** | 12:17:36Z（**11.7h 前**） |
| suite-blocking-self-lock-blocks-fix-family | task/… | **否**（ahead=6） | **needs-human** | 12:20:31Z（**11.6h 前**） |
| suite-floor-two-longest-files-bound | task/… | **否**（ahead=5） | **needs-human** | 12:21:54Z（**11.6h 前**） |
| loop-completion-path-produces-zero-gateevents | task/… | 否（ahead=7） | **ready** | 18:24:28Z（真实工作，AC5 证据） |
| provision-verify | feat/provision-verify-worktree | **是**（ahead=0） | — | 08-10 14:59（**已合未删 = 泄漏**） |

⇒ **inner idle 的成因不是「没货可派」，是「5 个槽全被无法自行推进的对象占住」**：3 条 needs-human 静止 11.6-11.7 小时、1 条已合泄漏。**inner 手上没有空槽，所以它 idle 是守规矩，不是故障。**

**两种机制状态给同一个可观测症状**（inner 不派发 + 吞吐低）：「空槽无货」与「满槽全堵」——`in_flight` 这个**计数**在两种相反真值下都报同一个数字，必须逐条枚举占用者才能分开。**我犯的正是这个错，已记台账 `OB-INFERRED-SLOTS-EMPTY-THEN-INFERRED-LEAK-BOTH-WRONG-IN-25-MINUTES`。**（我第一次写下的「是泄漏」同样是推断，实测 5 条里只有 1 条真泄漏——**25 分钟内两次把推断当发现，两次都错**。）

**归你处置的四件（我不越界，只报形状与依据）**：
1. **3 条 needs-human 静止 11.6h+ 待裁定** —— 它们各带 4-6 个提交，最后一次动作都是 `merge: catch up integration into task/…`，之后 11 小时无进展。裁定或退回都行，**只要它们还挂着，就等于 cap 从 5 变成 2**。
2. **`provision-verify` worktree 已合未删** —— 今晚第三次同形（04:5x / 07:4x 我都报过）。`git worktree remove` 仍不在 fan-in 的实际 prompt 序列里？
3. **`gap-loop-completion-path-produces-zero-gateevents` 是 ready 且有 7 个提交** —— **这条直接在我阶段目标 AC16③ 的关键路径上**（loop 路径零 GateEvent 正是 AC16③ 卡住的两个缺口之一）。若可 fan-in，优先它。
4. 顺带：`promotions=[]` 而 `deficit=19`，仍是「无合格 todo 可晋级」那一支（机制缺陷，非「有货没人取」）。

**读数**：`pool=1 floor=20 cap=5 deficit=19 dd=1`；closure ok（nyf=9 ≤ 10，fresh）；`develop..integration=2`；未合 task 分支 5 条。你的会话此刻 busy，故走收件箱。
