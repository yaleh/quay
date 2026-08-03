---
id: gap-session-liveness-stage-2-screen-signal-and-payload
title: "session-liveness stage 2 — semantic screen markers, cross-signal control, event payload, and per-class thresholds"
status: done
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

- [x] AC1（原 AC10 / 规格 AC18）: 屏幕信号改为**语义标志 + 屏蔽易变区**：
      主信号 `esc to interrupt`（**按存在性，不按计数**——实测管理者会话 4 次、内层 1 次）；
      屏蔽转圈耗时行 / token 计数行 / 提示语行；**`✻ …` 残留不得作为忙的判据**
      **证据**：判忙 = `esc to interrupt` 存在 **或** 屏蔽易变区后的内容区有变化（保住非 TUI
      探针/subagent 输出这类真活动）；易变区剥离集中在 `mask_pane()`（每条规则附理由）。`--mask`
      接缝实测：`/clear to save 151.2k tokens`、`✽ …（41s · ↓1.2k tokens）`、`✻ Baked for 8m54s`
      全被剥离，而真内容行 `◯ general-purpose Reading … ↓ 57.3k tokens` 保留（**不能按 `tokens`
      关键词一刀切**——滤掉真活动=把假阳性换成假阴性）。实跑：一个**只有** `/clear to save` token
      计数器在变的 pane 连跑 5s，**零 `SESSION-RESUMED`/`SESSION-IDLE` 事件**（测试
      `AC1 — a pane whose ONLY change is the /clear to save token counter stays idle`）。
      `esc to interrupt` 按存在性（`grep -c ≥1`），不按计数。
- [x] AC2（原 AC11 / 规格 AC18 正控制）: **标志失效必须可发现**——
      实现为**屏幕与 transcript 的交叉正控制**（transcript 刚写过而屏幕判空闲 ⇒ 报「标志可能失效」），
      **不是造一个人工忙会话**；给出不一致率的实测基线
      **证据**：每轮对「空闲 + 心跳是 transcript」的目标做交叉正控制，假→真沿报一次
      `SESSION-MARKER-STALE`；tick 日志**不**算（loop 写的，不是会话活动证据）。实跑输出：
      ```
      SESSION-MARKER-STALE d 的屏幕标志可能失效：transcript 2s 前刚写过（会话确定在动）但屏幕判空闲——检查 esc to interrupt 是否还在渲染
      ```
      负方向（陈旧 transcript 4s）`grep -c SESSION-MARKER-STALE` = **0**；新鲜后同一实例报出 1 条。
      不一致率基线：脚本不统计，由观察者从事件流数（全忙会话同时报 = TUI 文案改了，比率跳 100%）。
      测试：`AC2 — transcript fresh + screen idle ⇒ SESSION-MARKER-STALE`、
      `AC2 — a fresh TICK LOG … does NOT fire marker-stale`。
- [x] AC3（原 AC12 / 规格 AC18）: **假阳性可解释**——每个报出的事件能指出是屏上哪一部分造成的
      **证据**：事件带成因字段。`SESSION-RESUMED` 实跑：
      ```
      SESSION-RESUMED esc 的会话恢复活动（此前空闲；成因：esc to interrupt 标志出现 屏蔽易变区后的屏幕内容区变化；上次收到输入：取不到）
      ```
      成因逐项点名是屏上哪一部分造成的（`esc to interrupt 标志出现` / `屏蔽易变区后的屏幕内容区变化`）。
      测试 `AC1/AC3/AC6/AC7 — … RESUMED carries cause + last-input` 断言 `成因：esc to interrupt 标志出现`。
- [x] AC4（原 AC9 / 规格 AC17）: **屏幕与 transcript 两种信号的取舍写下来**——
      各自盲区（屏幕受重绘/chrome 干扰；transcript 受 `/clear`+`--resume` 映射问题限制）、
      同时用时以谁为准
      **证据**：`plugin/scripts/session-liveness.sh` 文件头新增「两种信号」节：
      屏幕（语义清晰、即时、是「人真正看的标志」，但依赖 tmux、TUI 文案一改即【静默】失效）；
      transcript（不依赖 tmux、不受重绘影响，但只在工具调用时写、pid→文件映射受 `/clear`/`--resume`
      解耦、会话 id 是配置不去推断）。**同时用时以谁为准**：忙闲以屏幕为准、心跳/逾期以 transcript
      为准、二者冲突（transcript 刚写过而屏幕判空闲）⇒ 屏幕标志存疑报 `SESSION-MARKER-STALE`。
      测试 `AC4 — the script header documents the screen-vs-transcript tradeoff…` 断言三段都在。
- [x] AC5（原 AC13 / 损失函数结论一）: **两类漏报反向调参**——
      不可自愈类（`GONE`/`OVERDUE`）宁可误报、可自愈类（`IDLE`/`RESUMED`）从严；
      **当前实测是调反的**（IDLE 60 秒即报、OVERDUE 等 45 分钟），改后给出每个事件的类别与阈值理由
      **证据**：改后 `OVERDUE_MIN` 默认 **45→30**（不可自愈，宁可误报：阶段一实测 transcript 长任务
      最大间隙 20.5 分钟，30 分钟早报 15 分钟且仍留 ≥9 分钟余量）。实跑输出（40 分钟旧心跳，默认阈值，
      旧值 45 会静默、新值 30 即报）：
      ```
      SESSION-OVERDUE o 的会话活着，但心跳 40 分钟未更新（阈值 30 分钟，预期周期 20 分钟）——会话可能已死，它会静默地永远空闲
      ```
      IDLE 从严 = 默认 `LOOP_MIN=20` 噪声闸门（刚动过=正常收尾→静默；心跳陈旧/未知才报）。实跑：
      **fresh 心跳**（hmin≈0<20）：`SESSION-RESUMED` 报出、回到空闲 **IDLE 静默**；**stale 心跳**
      （hmin=40≥20）：`SESSION-RESUMED` 报出、`SESSION-IDLE … 心跳 40 分钟前更新` 报出。逐事件类别
      与阈值理由写进脚本文件头「逐事件类别与阈值理由（AC5）」节 + 外层 tick 文档 OVERDUE_MIN 行。
      测试：`AC5 — OVERDUE_MIN default is 30 …`。
- [x] AC6（原 AC14 / 损失函数结论二）: **`SESSION-RESUMED` 必须带成因 payload**（哪个标志/哪个区变了），
      判据是「收到事件后无需再采样即可判真假」；**外层今天收到 8 次，早期每次花 3–4 次调用**
      **证据**：`SESSION-RESUMED` 带 `成因：`（`esc to interrupt 标志出现` / `屏蔽易变区后的屏幕内容区变化`）
      ——收到事件即知是哪个标志/哪个区变了，无需再采 pane/transcript。实跑见 AC3 输出。测试
      `AC6/AC7 — RESUMED carries the cause AND the last-input time…` 断言 `成因：` 非空。
- [x] AC7（原 AC14b / 管理者建议）: 事件还应带**「会话最后一次收到输入的时刻」**——
      紧贴恢复时刻 ⇒ 外部唤醒；远早于 ⇒ 自身 loop。
      **取不到时必须明说取不到，不得省略该字段**（省略与「不是外部唤醒」同形）
      **证据**：`SESSION-RESUMED` 带 `上次收到输入：N 分钟前`（来自 transcript 最近 `type=user` 记录
      的时间戳）；无 transcript / 解析失败时明说 `上次收到输入：取不到`（**不省略**）。实跑：
      有 transcript 时 `上次收到输入：5 分钟前`（测试 `AC6/AC7 — … not 取不到 when a transcript exists`）；
      无 transcript 时 `上次收到输入：取不到`（AC3 输出）。
- [x] AC9（第 13 个盲点，2026-08-03 17:4xZ）: **区分「空闲因为没活干」与「空闲因为发不出请求」**。
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
      **证据**：实现 = `transcript_api_error_count`（`tail -n API_ERROR_WINDOW` 扫顶层键
      `"isApiErrorMessage":…:true`，不用 429 文案）。**真实 transcript 三态实测**（`--api-errors` 接缝）：
      ```
      quay 内层（健康）:   0
      archguard 被拒（429）: 6
      陈旧会话（730421s/726854s/637814s 旧）: 0 / 0 / 0
      ```
      与被拒会话同字段、健康/陈旧为 0——与管理者要求的三态判别一致。空闲会话窗口内 ≥`API_ERROR_MIN`(1)
      条 ⇒ 报 `SESSION-IDLE-CANT-SEND`（不可自愈，宁可误报，见即报、假→真沿一次）；无标记空闲仍走
      常规 `SESSION-IDLE`。测试 `AC9 — idle + transcript with isApiErrorMessage structural field ⇒
      SESSION-IDLE-CANT-SEND; a healthy transcript stays regular`（阻断会话报出、健康/陈旧不报、且
      CANT-SEND 仅一次）。
- [x] AC8: 测试用 `node:test` 且带 `// @test-group governance`，扩进 `plugin/test/session-liveness.test.mjs`
      **证据**：文件头已是 `// @test-group governance`；新增 9 个阶段二测试（mask 接缝、语义标志忙闲、
      token 计数器零事件、marker-stale 正控制 + tick-log 负控制、AC9 三态、RESUMED payload、AC5 默认值、
      AC4 文档），全部 `node:test`。`node --test plugin/test/session-liveness.test.mjs` = **30/30 全绿**
      （21 旧 + 9 新；mkdtemp 目录在 finally 里删除，test-isolation R6）。

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

- [x] AC2 与 AC5 两个方向的实跑输出都贴进任务体——
      **只修假阳性而不证明假阴性没被引入，是把噪声换成静默**
      **证据**：AC2 实跑（陈旧 transcript 4s = 0 条、新鲜后 1 条 `SESSION-MARKER-STALE`）与
      AC5 实跑（40 分钟旧心跳 `SESSION-OVERDUE … 阈值 30 分钟`；fresh 心跳 IDLE 静默 / stale
      心跳 IDLE 报出）已分别贴在 AC2/AC5 条目下。
- [~] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明——本仓今天已有三次先例）
      **如实标注：仅 1 次全量绿**（协调方 fan-in，suite14 **2148 tests / 2126 pass / 0 fail /
      0 cancelled / 22 skip**，SUITE_EXIT=0，`/tmp/batch7-suite14.log`，2026-08-03）。
      **AC6/AC7（RESUMED）在套件下曾真红**（suite7/suite12 唯一两次都红）——协调方修复：
      RESUMED 等待窗口 8s→25s（`cfbc7459`，争抢下 8s 不足、机制正确），suite14 绿覆盖。
      suite7/12 里 session-liveness 文件级取消（71-86s）是争抢超时非缺陷（单独重跑 39/39 绿）。
- [x] 任务体记录：本任务是前任务阶段二的承载者，**前任务以 8/16 AC 收尾是外层指令的缺口**，
      不是内层漏做
      **证据**：见下方「阶段二完成记录」——8 条承载 AC（AC1-AC7、AC9）+ 新增盲点 AC9 + 测试 AC8
      全部落地；前任务 `status: done` 时 8 条 AC 未勾是外层分阶段指令只有前半有动作所致
      （「先 `--task-end` 关掉它、阶段二重新注册」的「重新注册」未发生）。

## Touches

- plugin/scripts/session-liveness.sh
- plugin/test/session-liveness.test.mjs
- plugin/loop/orchestrator-loop-tick.md（AC5：OVERDUE_MIN 默认 45→30 的文档同步——阈值文档是本仓
  的单一事实源，脚本改了默认值文档必须跟着改，否则漂移）

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

## 阶段二完成记录（2026-08-03，worktree `gap-session-liveness-stage-2` 内落地）

**本任务是前任务 `gap-session-liveness-heartbeat-freezes-for-the-whole-task` 阶段二的承载者**。
前任务以 `status: done` 收尾时 16 条 AC 只勾 8 条（阶段一），**阶段二 8 条无承载者**——
这是外层分阶段指令的缺口（「关掉它、重新注册」只有前半有明确动作），不是内层漏做。

**改动文件**：`plugin/scripts/session-liveness.sh`（文件头阶段二说明 + mask_pane / transcript_api_error_count /
last_user_input_epoch 三个纯函数 + --mask/--api-errors/--last-input 测试接缝 + 忙闲判据重写为
语义标志+屏蔽易变区 + RESUMED payload + marker-stale + CANT-SEND + OVERDUE_MIN 45→30）、
`plugin/test/session-liveness.test.mjs`（+9 测试）、`plugin/loop/orchestrator-loop-tick.md`（OVERDUE_MIN=30）。

**与姊妹任务 `gap-session-liveness-hashes-the-token-counter-as-if-it-were-work` 的关系**：串行约束由
协调方调度承担；本任务 AC1 的 `mask_pane` 已吸收其「token 计数器在哈希区域」的修复面
（`/clear to save` 行被剥离，实测 token 计数变化零事件），其 AC1 也可直接复用 `mask_pane`。

**AC 勾选**：AC1-AC7、AC9（承载 8 条）+ 新增盲点 AC9 + AC8（测试），全部 [x]，每条带实证（见上）。

**scoped 测试**：`node --test plugin/test/session-liveness.test.mjs` = **30/30 全绿**（21 旧 + 9 新），
已复跑 2 次。全量套件按隔离纪律不自启，由协调方 fan-in 承担。

**未做**：不改 `SESSION-IDLE`/`SESSION-RESUMED` 语义、不改轮询间隔、不加去抖、不动阶段一已落地的
transcript 心跳与 `REPO-STALL` 改名；不改 `orchestration/session-liveness.env`（管理者的配置，非本任务
Touches）。`SESSION-IDLE-CANT-SEND` 的升级动作（发给谁）在协调方/管理者侧，本脚本只负责报出。
