---
id: gap-session-liveness-stage-2-screen-signal-and-payload
title: "session-liveness stage 2 — semantic screen markers, cross-signal control, event payload, and per-class thresholds"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

**这是 [[gap-session-liveness-heartbeat-freezes-for-the-whole-task]] 的后继任务，承载它未完成的阶段二。**

那个任务按外层的分阶段指令落地了**阶段一**（transcript 心跳、`REPO-STALL` 改名、解除停机基线），
于 2026-08-03 17:0xZ 以 `status: done` 收尾、**16 条 AC 勾了 8 条**——
**其余 8 条是阶段二，收尾时没有承载者。**

**为什么必须补一个后继任务而不是就这样**：一个 `status: done` 且半数 AC 未勾的任务，
**正是本仓 `task-status-drift-check` 的 reverse-drift 类**，也是 escalations 里
DIR-124-A2「标记 done 但机制从未落地」那次的形态。**外层不让它以那种形状留在库里。**

**这个缺口是外层造成的**：我给的处置是「先 `--task-end` 关掉它，阶段二作为新的一次派发重新注册」，
**但「关掉」被自然地执行成了 `status: done`，而重新注册没有发生**——
指令的两半只有前一半有明确动作。**记在这里，因为下次分阶段派发时这句话要写得更死。**

## 承载的 AC（逐条来自前任务，未改动语义）

- [ ] AC1（原 AC10 / 规格 AC18）: 屏幕信号改为**语义标志 + 屏蔽易变区**：
      主信号 `esc to interrupt`（**按存在性，不按计数**——实测管理者会话 4 次、内层 1 次）；
      屏蔽转圈耗时行 / token 计数行 / 提示语行；**`✻ …` 残留不得作为忙的判据**
- [ ] AC2（原 AC11 / 规格 AC18 正控制）: **标志失效必须可发现**——
      实现为**屏幕与 transcript 的交叉正控制**（transcript 刚写过而屏幕判空闲 ⇒ 报「标志可能失效」），
      **不是造一个人工忙会话**；给出不一致率的实测基线
- [ ] AC3（原 AC12 / 规格 AC18）: **假阳性可解释**——每个报出的事件能指出是屏上哪一部分造成的
- [ ] AC4（原 AC9 / 规格 AC17）: **屏幕与 transcript 两种信号的取舍写下来**——
      各自盲区（屏幕受重绘/chrome 干扰；transcript 受 `/clear`+`--resume` 映射问题限制）、
      同时用时以谁为准
- [ ] AC5（原 AC13 / 损失函数结论一）: **两类漏报反向调参**——
      不可自愈类（`GONE`/`OVERDUE`）宁可误报、可自愈类（`IDLE`/`RESUMED`）从严；
      **当前实测是调反的**（IDLE 60 秒即报、OVERDUE 等 45 分钟），改后给出每个事件的类别与阈值理由
- [ ] AC6（原 AC14 / 损失函数结论二）: **`SESSION-RESUMED` 必须带成因 payload**（哪个标志/哪个区变了），
      判据是「收到事件后无需再采样即可判真假」；**外层今天收到 8 次，早期每次花 3–4 次调用**
- [ ] AC7（原 AC14b / 管理者建议）: 事件还应带**「会话最后一次收到输入的时刻」**——
      紧贴恢复时刻 ⇒ 外部唤醒；远早于 ⇒ 自身 loop。
      **取不到时必须明说取不到，不得省略该字段**（省略与「不是外部唤醒」同形）
- [ ] AC9（第 13 个盲点，2026-08-03 17:4xZ）: **区分「空闲因为没活干」与「空闲因为发不出请求」**。
      现场：archguard 两个会话都被配额拒绝（429，重置在 23 小时后），而监视器三个信号全报健康——
      进程存活、pane 哈希不变判空闲、心跳本就没接；管理者收到的是 `SESSION-IDLE 心跳 22 分钟前更新`，
      当作常规放过了。**两种空闲的处置完全相反**：没活干等下一个 tick，发不出请求要**立刻升级给人**。
      **判据必须是结构信号，不是文案**（管理者明确排除「grep 屏幕上有没有 429」——绑死供应商文案，换端点即失效）。
      **外层实测给出了那个结构信号**：被拒会话的 transcript **仍在增长**（archguard 最新写入 17:44:31，
      即 429 期间），而记录里带 **`isApiErrorMessage: true`** 这个**结构字段**：
      ```
      {'type': 'assistant', 'isApiErrorMessage': True} | API Error: Request rejected (429) · ...
      ```
      ⇒ 判据 = **最近若干条 transcript 记录里出现 `isApiErrorMessage`** ⇒ 报「空闲且发不出请求」，
      **按不可自愈类处理（AC5 的宁可误报一侧）**；无该标记的空闲仍走常规 IDLE。
      **顺带修正管理者提的方向**：它设想「发不出请求的会话 transcript 也不会增长」——**实测不成立**，
      429 本身会被写进 transcript，**所以 transcript 增长不能区分两者，而记录的类型可以**。
- [ ] AC8: 测试用 `node:test` 且带 `// @test-group governance`，扩进 `plugin/test/session-liveness.test.mjs`

## Carries

from: gap-session-liveness-heartbeat-freezes-for-the-whole-task
acs: AC9, AC10, AC11, AC12, AC13, AC14, AC14b

## Contract

```
measure parked_events = `bash plugin/scripts/session-liveness.sh --once` 对一个停泊会话输出的 SESSION-* 事件计数字段
measure busy_latency = `bash plugin/scripts/session-liveness.sh --once` 从会话开始工作到报出 RESUMED 的轮询轮数字段
band parked_events = 0
invariant 哈希区域只含会话产出的内容；剥离后内容区不得为空；响应速度不得下降
invoke `bash plugin/scripts/session-liveness.sh --once`
control 停泊会话只有 token 计数器变化 ⇒ 零事件；会话真开始工作 ⇒ 仍在一个轮询周期内报出 RESUMED
resume 屏幕标志 → 交叉正控制 → payload → 阈值，四步各自可验证
```

## Chosen mechanism

按前任务已写定的方向执行，此处不重述细节，只重申三条不可省的：

1. **屏蔽规则必须精确到状态提示行**，不能按关键词 `tokens` 一刀切——
   内层 pane 的 `↓ 57.3k tokens` 是**真内容**，滤掉它会把假阳性换成**假阴性**（静默）。
2. **剥离后内容区为空必须显式失败**——否则每个会话永远显示空闲且不报错。
3. **不加去抖**：成因已确认为「判据输入里混了 chrome」，洗输入不损失响应速度；
   去抖是在输入脏的前提下补偿，且要拿人明确要过的「及时知道」去换。

**不做**：不改 `SESSION-IDLE`/`SESSION-RESUMED` 的语义；不改轮询间隔；
不动阶段一已落地的 transcript 心跳与 `REPO-STALL` 改名。

## Definition of Done

- [ ] AC2 与 AC5 两个方向的实跑输出都贴进任务体——
      **只修假阳性而不证明假阴性没被引入，是把噪声换成静默**
- [ ] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明——本仓今天已有三次先例）
- [ ] 任务体记录：本任务是前任务阶段二的承载者，**前任务以 8/16 AC 收尾是外层指令的缺口**，
      不是内层漏做

## Touches

- plugin/scripts/session-liveness.sh
- plugin/test/session-liveness.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T17:06:00Z
changed: **外层建立本任务以修补自己造成的一个缺口**。前任务按我的分阶段指令落地阶段一后
以 `status: done` 收尾，**16 条 AC 只勾 8 条，阶段二无承载者**——
那正是 `task-status-drift-check` 的 reverse-drift 类、也是 DIR-124-A2「done 但机制从未落地」的形态。
**根因是我的指令只有前半有明确动作**：「先 `--task-end` 关掉它、阶段二作为新派发重新注册」，
「关掉」被自然执行成 `status: done`，而「重新注册」没有发生。
**处置选择**：不回退前任务的 `done`（阶段一确实落地且经 fan-in 验证，回退会让已证明的东西变得含糊），
**改为建后继任务承载剩余 8 条 AC**，逐条搬运不改语义。
**与 [[gap-session-liveness-hashes-the-token-counter-as-if-it-were-work]] 同改一个文件，必须串行**；
两者机制不同不合并（一个是哈希输入含 chrome、一个是阈值/payload/交叉控制）。
**派发时机**：在飞 1（冷启动，管理者指定队首），本任务排其后。
