---
id: gap-the-tick-doc-ships-three-contradictory-loop-drivers
title: "The outer tick doc ships three contradictory loop drivers — following it literally gives you a double-triggering or non-triggering loop two times out of three"
status: done
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

- [x] AC1: **文档中的驱动机制数为 1**（`driver_mechanisms = 1`，实跑输出贴任务体）
- [x] AC2: **选择有理由**——为什么是这一个，写进文档，判据是「无人值守时最不容易静默停摆」
- [x] AC3: **另外两个显式处置**——删除，或保留并标注「不要用 + 理由」；**不得沉默并存**
- [x] AC4: **端到端**——照文档从零装一次 ⇒ **恰好一个触发源在跑**（实跑输出贴任务体）
- [x] AC5: **双触发负控制**——人为再装一个 ⇒ **必须被检出**（实跑输出贴任务体）。
      **这条不过，AC4 不算数**——只证明「装一次是对的」，不证明「装两次能被发现」，
      而现实中双触发正是靠「装了两次没人发现」发生的
- [x] AC6: **不触发负控制**——把唯一的触发源移除 ⇒ **必须被检出为停摆**，
      不得表现为「一切正常只是没有 tick」
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [x] AC5 与 AC6 两个方向的实跑输出都贴进任务体——
      **双触发和不触发是同一枚硬币，只修一面等于把吵闹换成静默**
- [~] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）——
      **如实标注：scoped 连跑 2 次绿**（quay-init-loop 28/28 + cold-start-skill + loop-shipping，共
      47/47；协调方 merge 后 scoped 复验 47/47）。全量套件待 AC20 落地后批跑。
      **协调方已修 HEAD 上 `task-contract-check` 的基线外违规**（mkdtemp invoke `.sh`→`.ts`、
      task-list-route `/dev/null` 证据入正文，new since baseline 归零）——那两处是本任务执行时
      既有的，与本任务改动无关，已随批 3 关闭后的契约修复解决。
- [x] 任务体记录：**meta-cc 外层替文档做了文档自己该做的决定，且做对了**——
      **但下一个读者未必这么判，而且他不会知道自己在做一个决定**

## Execution evidence (2026-08-03)

**选定的唯一驱动：`CronCreate`**（20 分钟 cron）。判据「无人值守时最不容易静默停摆」，理由写进
tick 文档步骤 4：可查验（`CronList` 能列出，`loop-driver-check.sh` 能机械判定）、固定间隔无需每
tick 自排下一程（自排程任何中断就静默断链）、且全流程（tick 文档 + cold-start skill）同一个拼写。
另两个被处置：`ScheduleWakeup` 自排程——**删除**（文档不再出现该字面）；`/loop` 固定间隔——**保留
讨论但标注「不是驱动器、不要另起一个」**（固定间隔 `/loop` 底层就是同一 cron 机制，再起 = 双触发；
动态 `/loop` 走自排程，不可列出）。`loop-driver-check.sh` 是新加的机械双触发检测。

**AC1 measure / Contract invoke 实跑**（工作树内 `grep -nE 'CronCreate|ScheduleWakeup|/loop [0-9]+m'
plugin/loop/orchestrator-loop-tick.md`）：

```
16:只有一个**：步骤 4 的 `CronCreate`（20 分钟 cron）。Monitor 是事件监测，不是驱动。两个都做完再进
60:**整个冷启动只有这一个循环驱动机制**：tick 靠它每 20 分钟触发一次。`CronCreate` 的任务是
64:CronCreate(cron="*/20 * * * *", prompt="执行 plugin/loop/orchestrator-loop-tick.md 中的 tick 指令", recurring=true)
75:- **全流程同一个拼写**：冷启动 skill（`plugin/skills/cold-start/SKILL.md`）用的也是 `CronCreate`，
83:主推进信号是后台 agent 的完成通知；本文件（外层）的**循环驱动只有一个**：步骤 4 的 `CronCreate`。
86:- **固定间隔 `/loop`（带数字间隔的形式）底层就是 `CronCreate`**——同一个机制、同一种列表。步骤 4
107:`Monitor` 与 `CronCreate` 同样活不过会话。新会话必须重挂，否则外层退回纯 20 分钟轮询：
566:- **重新排程由步骤 4 的 `CronCreate` 接管**：它按 `*/20` 固定间隔自动触发，不需要每 tick 手动排

distinct mechanism tokens: CronCreate          # ← 只有 1 个（band = 1）
```

**AC4/AC5/AC6 实跑**（`loop-driver-check.sh`，临时项目，注册表模拟「照文档装 / 再装 / 移除」）：

```
# 1) AC6 不触发：零驱动（quay-init --loop 刚铺完、冷启动没做）
loop-driver: STALLED (0) — no loop driver registered; the loop will never tick
exit=3

# 2) AC4 端到端：恰好一个 cron 驱动（照步骤 4 装）
loop-driver: LIVE (1) — exactly one loop driver (cron */20 * * * *)
exit=0

# 3) AC5 双触发：第二个驱动（旧文档的 /loop 复发）
loop-driver: DOUBLE-TRIGGER (2) — 2 loop drivers registered; a literal reader double-installed
exit=4

# 4) AC3 处置：被废弃的自排程成了唯一驱动
loop-driver: BANNED-MECHANISM (1) — the only registered driver is 'wakeup', not 'cron' (the single sanctioned driver)
exit=5
```

**AC7 实跑**（`node:test` + `// @test-group governance`）——`scripts/test.sh` 静态检查直跑：
**2026-08-04 更正**——执行时 HEAD 上 `task-contract-check` 的两处基线外违规
（mkdtemp `.sh`、tasklist `/dev/null` 的 invoke-evidence）已由协调方修掉，`contract-check` exit=0、
new since baseline=0，**不再需要 `QUAY_TEST_SKIP_STATIC_CHECKS=1`**。该接缝在 scripts/test.sh:115 的
声明用途是**嵌套 0 匹配运行**，不是范围化运行绕开既有违规——用途漂移会把窄豁免变成通用跳过开关
（本仓反复栽的形态），本任务不沿用：

```
quay-init-loop.test.mjs（含 8 条新测试）第 1 次：  tests 28, pass 28, fail 0, cancelled 0
quay-init-loop.test.mjs（含 8 条新测试）第 2 次：  tests 28, pass 28, fail 0, cancelled 0
cold-start-skill.test.mjs + loop-shipping.test.mjs（编辑波及文件的既有测试）：tests 19, pass 19, fail 0, cancelled 0
```

**偏离 Touches**：新增 `plugin/scripts/loop-driver-check.sh`（AC4/AC5/AC6 的机械检测器，必须随
`quay-init --loop` 铺到目标项目，故 `plugin/scripts/quay-init.sh` 的 LOOP_SCRIPTS 也加了一行）。
其余三文件按 Touches 修改。

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
