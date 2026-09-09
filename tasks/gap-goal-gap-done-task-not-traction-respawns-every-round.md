---
id: gap-goal-gap-done-task-not-traction-respawns-every-round
title: computeGoalGaps 牵引口径排除 done ⇒ 任务已 done 而 AC 判据仍红时每轮重复 spawn 立案（实测 AC-214
  烧 6 次、轮长 65s→204s 拖慢全环 3 倍）
status: done
labels:
  - gap
  - defect
  - goal-driver
parent: null
children: []
extra: {}
goal_ac: ""
---
**type:** execution

## Proposal

`computeGoalGaps` 的「牵引」口径只算 `todo/ready/needs-human`，**`done` 不算牵引**（`goal-driver.ts:421`）。后果：一条 AC 的关联任务翻 `done` 之后、而该 AC 的判据**仍 fail** 时，它每轮都被判成 `gap` 并 spawn 一次 gap-filing agent——**无限重复，直到判据转绿或有人干预**。

**实测（2026-09-09，非主张）**：

- AC-214 的任务 `gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207` 于 `13:53:17` 翻 done，而 AC-214 的判据仍 `fail`
- 此后连续三轮逐字如下：

```
14:15:34  gaps=[('AC-214','gap',taskCount=0)]  spawned=1  gap_spawns=[('AC-214',0,False)]
14:18:34  gaps=[('AC-214','gap',taskCount=0)]  spawned=1  gap_spawns=[('AC-214',0,False)]
14:21:58  gaps=[('AC-214','gap',taskCount=0)]  spawned=1  gap_spawns=[('AC-214',0,False)]
```

- 全账本 AC-214 的 gap spawn 累计 **6 次**（首 12:56:16、末 14:21:58）
- **轮长从 ~65s 涨到 179–204s** ⇒ 所有 active GOAL 的判据评估频率掉到约 **1/3**

**查重是有效的**（`grep -l "^goal_ac: AC-214$" tasks/*.md` 只有 1 条任务，没有造出重复立案）。所以损失**不是**重复任务，而是：**每轮白付一次 LLM spawn 的成本 + 整个 goal 环慢 3 倍**，且会一直持续。

**根因**：`computeGoalGaps` 把两种语义不同的状态压成同一个 `gap`：

| 实际情形 | 正确处置 | 当前处置 |
|---|---|---|
| 零关联任务（真缺口） | spawn 立案 ✅ | `gap` ⇒ spawn |
| 关联任务全部 done，而 AC 判据仍未达成 | **不该再立同样的任务**——工作做过了，缺的是复验或工作量不足，需人或下一轮判据自己转绿 | `gap` ⇒ **每轮重复 spawn** ⛔ |

⇒ 同硬规则 3（枚举，不布尔）：两种成因需要不同的输出与不同的处置。这与同族前作 `gap-goal-gap-needs-human-invisible-burns-spawn-slot`（done，当年把 `needs-human` 纳入牵引集以免空耗 spawn 名额）是**同一条纪律的另一半**——那次补的是 needs-human，这次补的是 done。

**⚠️ 必须两处同修**：牵引判定的字面量在两个地方各写了一份——

```
goal-driver.ts:421  computeGoalGaps  (t.status === "todo" || t.status === "ready" || t.status === "needs-human")
goal-driver.ts:531  triageDraftAc    (t.status === "todo" || t.status === "ready" || t.status === "needs-human")
```

只改一处就是「在某处修好 X ≠ X 只在那一处」。修法应把牵引判定收进**单一导出函数**，两处都调它。

## AC

- [x] AC1（不再每轮 spawn，双向）：构造「AC active + 其关联任务全部 `done` + AC 判据 fail」的记录集，`computeGoalGaps` 返回该条的 `state` **≠ `"gap"`**（当前为 `"gap"`）；反向负控制：**零**关联任务的 AC 仍返回 `"gap"`（真缺口不被误放）。
- [x] AC2（词表可区分，硬规则 3）：`GapState` 词表含一个独立取值，把「关联任务全部 done 而 AC 未达成」与「零关联任务」分开——`grep -n "GapState" plugin/scripts/goal-driver.ts` 可见该取值，且它**不与** `gap`/`in-progress` 共用。
- [x] AC3（两处同修，按位置判定）：牵引判定收进单一导出函数，`computeGoalGaps` 与 `triageDraftAc` 都调它——`grep -c 'status === "todo" || t.status === "ready"' plugin/scripts/goal-driver.ts` == **0**（字面量重复已消除），且该导出函数的调用点 ≥ 2。
- [ ] AC4（生产验证，读载体非 fixture）：修复落地后的轮记录里，不存在「同一 AC 连续 ≥3 轮被判 `gap` 且其关联任务已 `done`」的记录——`python3` 扫 `.quay/goal-round.jsonl` 只计落地提交之后的轮次。（待外部）
- [x] AC5（回归）：`node --no-warnings --experimental-strip-types --test plugin/test/goal-driver.test.mjs` 与 `plugin/test/goal-triage.test.mjs` 均 exit 0。

## DoD

- 在真实 `goals/` + `tasks/` 载体上，AC-214 这一具体实例**不再每轮触发 spawn**——以生产轮记录为准，⛔ 不是只在单测里成立。
- 轮长回到无 spawn 时的基线量级（~60–90s），不再因这类重复 spawn 被拖到 180s+。
- 牵引口径在全仓只有**一处**定义（AC3 的 grep 计数为 0 是它的机械证据）。
- 全量 `scripts/test.sh` 绿。

## Touches

- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-driver.test.mjs`
- `plugin/test/goal-triage.test.mjs`
- `tasks/gap-goal-gap-done-task-not-traction-respawns-every-round.md`