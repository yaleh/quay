---
id: gap-the-tick-doc-ships-three-contradictory-loop-drivers
title: "The outer tick doc ships three contradictory loop drivers — following it literally gives you a double-triggering or non-triggering loop two times out of three"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

meta-cc 冷启动实测（管理者转达）。**产品侧缺陷。**

**同一份外层 tick 文档里，有三套互相矛盾的循环驱动机制**：

| 位置 | 机制 |
|---|---|
| 冷启动步骤 4 | `CronCreate` |
| 步骤 8 | `ScheduleWakeup 1200s` |
| §4a | `/loop 25m` |

**⇒ 照文档走的人有三分之二的概率装出一个双触发或不触发的循环。**

meta-cc 外层保留了 `CronCreate` 以避免双触发——**这个处理是对的**，
但它是**读者替文档做了文档自己该做的决定**：**下一个读者未必这么判**，
而且他不会知道自己在做一个决定。

### 为什么这不是「文档有点乱」

**循环驱动是这套方法论的心脏**：它决定 tick 会不会发生、发生几次。
三个机制并存的后果不是「有点混乱」，是：

- **双触发** ⇒ 两个 tick 同时跑，共享检出上的竞争（本仓今晚已有实例：并发套件与污染）；
- **不触发** ⇒ 循环静默停摆，而**从外面看装得好好的**——
  与 [[gap-init-guesses-the-tmux-session-and-writes-the-guess-into-the-monitor]] 同族的
  「看起来装好了」。

**⇒ 一份把最关键机制留给读者猜的文档，等于把失败概率写进了交付物。**

## Contract

```
measure driver_mechanisms = `grep -cE 'CronCreate|ScheduleWakeup|/loop [0-9]+m' <tick-doc>` 中出现的不同驱动机制数字段
band driver_mechanisms = 1
invariant 文档必须自己选定一个驱动；其余两个若保留，必须明写「不要用」及其理由
invoke `grep -nE 'CronCreate|ScheduleWakeup|/loop [0-9]+m' plugin/loop/orchestrator-loop-tick.md`
control 照文档从零装一次 ⇒ 恰好一个触发源在跑；人为再装一次 ⇒ 必须被检出为双触发
resume 先定选哪一个及理由，再删或降级另外两个
```

## Chosen mechanism

1. **选定一个，并写明为什么**——不是随便挑：三者的语义不同
   （`CronCreate` 固定间隔、`ScheduleWakeup` 自定步、`/loop` 会话内），
   **选择依据应当是「无人值守时哪个最不容易静默停摆」**，理由写进文档。
2. **另外两个的处置二选一**：删除，或**保留但明确标注「不要用，理由是 X」**。
   **不许沉默地并存**——沉默并存正是本条的立案理由。
3. **加一个双触发检测**：装完之后能机械判定「恰好一个触发源在跑」。
4. **参考已有实践**：meta-cc 外层选了 `CronCreate`，**这个选择本身是一份可用的输入**，
   但**要有理由，不能因为「别人这么做了」就抄**。

**不做**：不为三种机制各写一份文档分支（**那是把一个选择问题变成三份要同步维护的文档**，
与 [[gap-init-ships-a-skill-that-calls-files-it-does-not-lay-down]] 的手工清单漂移同族）。

## Acceptance Criteria

- [ ] AC1: **文档中的驱动机制数为 1**（`driver_mechanisms = 1`，实跑输出贴任务体）
- [ ] AC2: **选择有理由**——为什么是这一个，写进文档，判据是「无人值守时最不容易静默停摆」
- [ ] AC3: **另外两个显式处置**——删除，或保留并标注「不要用 + 理由」；**不得沉默并存**
- [ ] AC4: **端到端**——照文档从零装一次 ⇒ **恰好一个触发源在跑**（实跑输出贴任务体）
- [ ] AC5: **双触发负控制**——人为再装一个 ⇒ **必须被检出**（实跑输出贴任务体）。
      **这条不过，AC4 不算数**——只证明「装一次是对的」，不证明「装两次能被发现」，
      而现实中双触发正是靠「装了两次没人发现」发生的
- [ ] AC6: **不触发负控制**——把唯一的触发源移除 ⇒ **必须被检出为停摆**，
      不得表现为「一切正常只是没有 tick」
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC5 与 AC6 两个方向的实跑输出都贴进任务体——
      **双触发和不触发是同一枚硬币，只修一面等于把吵闹换成静默**
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录：**meta-cc 外层替文档做了文档自己该做的决定，且做对了**——
      **但下一个读者未必这么判，而且他不会知道自己在做一个决定**

## Touches

- plugin/loop/orchestrator-loop-tick.md
- plugin/skills/cold-start/SKILL.md
- plugin/test/quay-init-loop.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T23:40:00Z
changed: 管理者转 meta-cc 冷启动实测。**外层判定成任务并单独立条**——
它与 quay-init 那三条**不同文件、不同机制**（那三条是落地行为，本条是文档自身的自相矛盾），
合并会触发不必要的分裂。
**立案理由不是「文档有点乱」**：循环驱动是这套方法论的心脏，
三机制并存的后果是**双触发**（共享检出竞争，本仓今晚已有实例）
或**不触发**（循环静默停摆而从外面看装得好好的）。
**⇒ 一份把最关键机制留给读者猜的文档，等于把失败概率写进了交付物。**
**外层特别记下 meta-cc 外层的处理**：它保留 `CronCreate` 避免双触发，**这个处理是对的**——
**但它是读者替文档做了文档该做的决定，而下一个读者不会知道自己在做一个决定**。
**AC5/AC6 要求双向**：双触发与不触发是同一枚硬币，
**只修一面等于把吵闹换成静默**，而静默的那一面更贵。
**并预先堵死一条省事修法**：不许为三种机制各写一份文档分支——
**那是把一个选择问题变成三份要同步维护的文档**，与手工清单漂移同族。
