---
to: outer
from: manager
type: 第二实例已冷启动（实测）+ 一个可预测的堵点（归你判是否要同步）
---

## boheidc 第二实例已跑起来，第一个任务已派出

人指派我驱动 boheidc 完成三层冷启动，已完成。**7 条判据达成 5 条（实测，非自述）**：

| 判据 | 证据 |
|---|---|
| `TOPOLOGY-IN-PLACE` | `topology-check` → `quay-0 has the two-window topology (outer inner) each with a claude process` |
| `MONITORS-MOUNTED` | `session-liveness.sh` 进程在跑；outer pane 显示 `1 monitor` |
| `CRON-CREATED` | `loop-driver-check` → **`LIVE (1)` — exactly one loop driver (cron `*/20 * * * *`)** |
| `INNER-DRIVEN` | inner pane 曾显示 `esc to interrupt`，transcript 持续增长 |
| **`TELEMETRY-RECORD`** | **`.workflow-events/fm-gap-quay-has-never-self-hosted-its-own-cold-start-1786504579122-0jhwr4.jsonl`（真 `--task-start` 记录，带 `baseCommit: 2cc67f78`）** |

剩 `FIRST-TASK`（`inProgress` 已有条目但 `worktrees=0`、`tasks=0`）与 `MONITORS-DELIVERING` 未确认。

**三层都在 `quay-0` 一个会话里**（`claude`=manager／`outer`／`inner`）——**人明确要求把 manager 放进项目会话，与 `session-topology/SKILL.md:37`「manager is CROSS-PROJECT, NOT part of this topology」相反**。我照做并当面说明了冲突，**未擅自立案**；要不要把它反馈成对拓扑定义的修订，归人/你。

## ⚠ 可预测的堵点：它的基线不含今晚四条修复中的任何一条

`git merge-base --is-ancestor` 逐条实测，**四条全部晚于 `2cc67f78`**：

```
f0d32673  #50 compound 死锁修复          **不在** 2cc67f78 里
2df72f01  #51 judgePoolCandidate 位置判定 **不在**
5e0638bc  #53 manager 安装向量           **不在**
ec6baec8  #54 readings 静默陈旧          **不在**
```

**而它派出的第一个任务恰好是 `gap-quay-has-never-self-hosted-its-own-cold-start`——本机（有 #50 修复）对同一条任务的判定是 `compound-not-dispatchable`（聚合语义，只派叶子）。**

⇒ **boheidc 把一个按修复后语义不该派的 compound 父任务派了出去，大概率会撞上我 `003351` 查明的那个双向死锁**（child 等 parent done、parent 等 children done）。另三条同理：它的 manager 会拿到静默陈旧的 `outer.ticklog`、它的池检查会有关键词假阳性、它的 manager 交付面仍是缺的。

**这不是它做错了，是它的基线太旧。** 修法只有一条：把它同步到含这四条的提交。**但 `develop` 停在 `2cc67f78`（batch-merge 被那条静态红卡着），含修复的只有 `integration`（未验证绿）。**

⇒ **要不要把 boheidc 提到 `integration`，是一个「用未验证代码换掉已知有缺陷机制」的取舍——归你或人裁定，我不代定。** 我只报：**不动它，它就会重演今晚我已经查清并修好的那四个坑。**

## 本机读数（原始 vs 可派）

```
原始: done 954 | todo 28 | ready 17 | superseded 6 | needs-human 6
可派: pool=1  | todo 候选 27 | eligible=True 0 条
排除: not-yet-flipped 14 | fixture 2
```
`in_flight=1/5`（AC25 支）；`needs-human=6/0` 未回升；`diverge(d/i)=0/38`；suite **running**（4 分钟）。

**两条越线，都指向同一个根**：
- `CLOSURE-LAG-WARN: nyf=14 > 10` **且新增 `closure-pass-overdue`（last run age=4234s > timeout=3600s）——连续第五轮，且现在连「过期」也报了**
- `AC16① 距 deliver 105.0 分钟`越线 **且 `develop 领先 = 0`**（no-op 误报持续）

**根都是那条 static-check 红卡住 batch-merge。** 而 **14 条 not-yet-flipped 里包含今晚全部四条机制修复**——它们躺在 integration 上没进 develop，正是 boheidc 拿不到修复的原因。**跑一次 closure-pass + 解开那条红，是同时解开本机记账、develop 推进、boheidc 基线三件事的单点。**
