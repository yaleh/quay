---
id: gap-session-liveness-hashes-the-token-counter-as-if-it-were-work
title: session-liveness hashes the whole pane including the "/clear to save NNN.Nk
  tokens" counter, so a parked session emits a RESUMED/IDLE pair with zero work
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

> **SCOPE CHANGE (outer ruling D, 2026-08-04) — `orchestration/outer-rulings-2026-08-04-A-F.md`.**
> Do NOT implement as "add more strip rules" to `mask_pane` — accumulating strip rules for each
> new volatile row is the symptom of reading the wrong function (whole-pane hash). Re-implement
> to consume `classifyPaneState` from `gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable`
> (bottom-region + shape classification, not whole-pane equality). Touches change accordingly.

**type:** execution

## Proposal

管理者 2026-08-03 报了一个假阳性并**明确标注「一种可能成因，未确认」**：
archguard 处于停泊状态（无 cron、无 loop、无后台任务、`.halt` 在、树干净、pane 内容与一小时前逐字相同），
`session-liveness.sh` 仍报出了一对 `SESSION-RESUMED` / `SESSION-IDLE`。
它连采 5 次哈希（每 8 秒、共 40 秒）**完全稳定**，10 秒 diff 无变化 ⇒ **不是持续活动**；
**唯一变过的是状态行里 `/clear to save NNN.Nk tokens` 的数字（150.2k → 151.2k）**。

**外层把这条从「未确认」变成了已确认，并且确认的结果指向一个比去抖更好的修法。**

### 实测一：被哈希的是整个 pane

`plugin/scripts/session-liveness.sh:170`

```bash
h=$(tmux capture-pane -p -t "$target" 2>/dev/null | md5sum | cut -c1-16)
```

**整屏内容进哈希**，不区分「会话产出的内容」与「TUI 自己的边框/状态提示」。

### 实测二：那个计数器就在被哈希的区域里

```
$ tmux capture-pane -p -t archguard-2:outer | grep -n "to save"
111:                                    new task? /clear to save 151.2k tokens
```

**⇒ 成因确认：那个数字是被哈希内容的一部分。**
它每涨 0.1k，整屏哈希就变一次；下一轮又稳定 ⇒
**「变一次→稳定」正好被判成「恢复活动→转入空闲」，于是一个停泊会话产出一对事件。**
管理者观察到的 150.2k → 151.2k **正是那一次变化**——它的推测形状对，但机制不是「瞬时重绘」，
是**一个与工作无关的计数器长在了判据的输入里**。

**这属于本仓反复抓的那一族**：判据的名字说「会话是否在活动」，
实际测的是「这一屏的字节有没有变」——而那一屏里混着不代表活动的东西。

### 为什么「去抖」不是这里的答案

管理者提的方向是「连续 N 次哈希不同才算忙」，并正确指出它**牺牲响应速度**、N 要有数据支撑。
**成因确认后，这个取舍不必做**：计数器不是内容，是 chrome；
**把它排除出哈希区域，既消除这类假阳性，又不损失任何响应速度**。
去抖是在「判据输入脏」的前提下补偿，而输入可以直接洗干净。

**⇒ 本任务不做去抖。** 若排除 chrome 后仍有残留假阳性，再单独用数据讨论 N。

### 一个必须小心的边界（外层实测，容易改过头）

**不是所有含 `tokens` 的行都是 chrome。** 同一时刻的 quay 内层 pane：

```
53:  ◯ general-purpose  Reading session-liveness.test.mjs   1m 35s · ↓ 57.3k tokens
```

**这一行是真内容**——它随 subagent 真实工作而变，正是我们要检测的活动。
**排除规则必须精确到「状态提示行」，不能按关键词 `tokens` 一刀切**，否则会把真活动一起滤掉，
把假阳性换成假阴性——**后者更糟，因为它静默**。

### 外层追加实测（2026-08-03 14:51Z）：这条 chrome 只出现在停泊会话

新挂的 session-liveness 监视器首次发声 `SESSION-RESUMED inner`，按纪律先证伪：
内层 transcript mtime 距检查仅 6 秒、屏幕 12 秒内变化 ⇒ **真阳性**，
而且 **`tmux capture-pane -p -t quay-0:inner | grep -c "to save [0-9.]+k tokens"` = 0**。

**⇒ `/clear to save NNN.Nk tokens` 只在会话停泊时出现**（archguard 停泊 pane 有，忙碌的内层没有）。
**这把假阳性的形态收窄了**：它专挑**停泊会话**发生——
**而那正是最误导的场合**，因为停泊会话「看起来在工作」比忙碌会话多一对事件危险得多。
AC3 的负控制样本因此应当取**停泊态** pane 快照，不要用忙碌态构造。

## Contract

```
measure parked_events = `bash plugin/scripts/session-liveness.sh` 对一个停泊会话在一个观察窗口内输出的 SESSION-RESUMED/SESSION-IDLE 事件计数字段
measure busy_latency = `bash plugin/scripts/session-liveness.sh` 从会话真开始工作到报出 SESSION-RESUMED 的轮询轮数字段
band parked_events = 0
invariant 哈希区域只含会话产出的内容；排除项必须逐条列出理由；剥离后内容区不得为空
invoke `bash plugin/scripts/session-liveness.sh`
control 停泊会话只有 token 计数器在变 ⇒ 零事件；会话真开始工作 ⇒ 仍在一个轮询周期内报出 RESUMED
resume 先确定 chrome 行集合并写成断言，再改哈希输入；两步各自可验证
```

## Chosen mechanism

**把 chrome 排除出哈希输入，不改判据本身。**

1. **确定 chrome 行集合**（用真实 pane 采样，不靠猜）：至少含
   `/clear to save NNN.Nk tokens` 这类提示行；**逐条写明为什么它不是活动信号**。
   **`↓ NN.Nk tokens` 的 agent 任务行不是 chrome**（见上文边界）。
2. **`capture-pane` 之后、`md5sum` 之前做剥离**，剥离规则集中在一处并可被测试直接调用。
3. **加一条防过滤的断言**：剥离后**内容区不得为空**——
   若某次改动让剥离吃掉整屏，每个会话都会永远显示空闲，**而且不会报错**。
   这与本仓 `loop-shipping` AC1b「只断言 hits 为空、不断言语料非空」是同一族，
   **这次在设计时就把它堵上**。

**不做**：**不加去抖**（见上）；不改 `SESSION-IDLE`/`SESSION-RESUMED` 的语义；
不改轮询间隔（响应速度是人明确要过的）；
不因为这一次假阳性就把整个 pane-hash 判据换成别的信号——
**先洗干净输入，再谈换判据**。

## Acceptance Criteria

- [ ] AC1: chrome 行集合确定并写进文件头，**每条附「为什么它不代表活动」**（用真实 pane 采样支持）
- [ ] AC2: 剥离在 `capture-pane` 与 `md5sum` 之间完成，规则集中一处、可被测试直接调用
- [ ] AC3: **负控制（假阳性方向）**——构造一个只有 `/clear to save NNN.Nk tokens` 数字变化的 pane 快照对
      ⇒ 判为**空闲**、**零事件**（实跑输出贴任务体）
- [ ] AC4: **负控制（假阴性方向）**——构造一个只有 agent 任务行 `↓ NN.Nk tokens` 变化的快照对
      ⇒ 判为**活动**，`SESSION-RESUMED` 仍在**一个轮询周期内**报出（实跑输出贴任务体）
- [ ] AC5: **防过滤断言**——剥离后内容区为空时必须显式失败/告警，不得静默判空闲
- [ ] AC6: 用**真实停泊会话**（archguard 当前即是）观察 ≥3 个轮询周期 ⇒ 零 `SESSION-*` 事件；
      观察窗口与轮询间隔一并记录
- [ ] AC7: **响应速度未被牺牲**——记录改动前后 `busy_latency`（轮询轮数）相同；
      **若不同即视为失败**（这条是「不做去抖」的机械保证）
- [ ] AC8: 测试用 `node:test` 且带 `// @test-group governance`，扩进现有 `plugin/test/session-liveness.test.mjs`
- [ ] AC9: **同一窗口内 `RESUMED` 次数必须与真实空闲段数一致**——用下面「实测证据」那段的复现命令
      在一个**已知连续工作**的窗口上重跑 ⇒ `SESSION-RESUMED` 计数 **≤1**（实跑输出贴任务体）。
      **修法必须落在「空闲判定」那一侧，不得用去抖/静音 `RESUMED` 达标**——
      那会与 AC7 直接冲突，且是把一个吵闹的错换成一个安静的错

## 实测证据（外层，2026-08-03 19:25Z）——同一探测器的第二个方向

监视器自己的输出文件（`tasks/<id>.output`）在**内层连续工作**的窗口里累计：

```
grep -oE 'SESSION-[A-Z]+' <monitor-output-file> | sort | uniq -c
  → 23 SESSION-RESUMED
  →  0 SESSION-IDLE
```

**`RESUMED` 的语义是「此前空闲」，所以它判了 23 次空闲**；而同一窗口里外层直接读过内层 pane，
看到的是一个 2m11s 的活跃回合在跑 fan-in（`quay-init-loop.test.mjs`）。**⇒ 23 次都是误判。**

**两个方向的门槛不对称**：`IDLE` 有停留门槛（一次没报），`RESUMED` 没有（每次微空闲都报）。

**真正的代价不是误报本身，是它把读者训练成忽略这个监视器**——
23 条噪声之后，那条真正要紧的事件（会话真的没了）不会有人看。
**这与本任务原有的假阳性方向是同一个探测器的两个方向**，而原任务只写了一个方向——
**规则名覆盖类、实现覆盖标本**，这是本仓今天记到的第五次同形。

**成因未确认**：内层活跃时旋转指示器（`✽ … (2m 11s · ↓ 4.2k tokens)`）是逐秒变化的，
按理哈希不该相同。**所以不要假设成因是「屏幕静止」**——先量出它在哪一轮判空闲，再改。

### 一个被提出并排除的混淆因素（2026-08-03 21:15Z）

管理者发现同时有 **8 个 `session-liveness` 进程**在跑（多层各挂各的），并提出那批 RESUMED 噪声
里有一部分是**多实例对同一次状态切换各报一遍**复制出来的，未必全是判据问题。
**这个混淆因素对管理者的通知量成立，但对本任务的证据不成立**，理由是读码得到的：

`plugin/scripts/session-liveness.sh:155` 的状态是**进程内的 bash 关联数组**
（`declare -A PREV_ALIVE PREV_STALL PREV_OVERDUE PREV_HASH PREV_IDLE …`），
**不是共享文件**——多实例之间**不会互相污染上一轮哈希**，各自独立判定。
而本任务那 23→28 次计数取自**单个 Monitor 任务的输出文件**，即**单个进程自己的 stdout**。

**⇒ 多实例解释的是「同一事件被送进多个通知通道」，不是「一个进程报了 28 次」。
本任务的 AC9 证据未被稀释，仍成立。**
（若日后把状态改成共享文件，这条排除即失效，需重测。）

## Definition of Done

- [ ] AC3 与 AC4 两个方向的实跑输出都贴进任务体——
      **只修假阳性而不证明假阴性没有被引入，是把噪声换成静默**
- [ ] 完整套件连跑 2 次全绿（**若只到 1 次，如实标 `[~]` 并写明**）
- [ ] 任务体记录：管理者报此条时标注为「**未确认成因**」，
      外层实测确认了具体机制（计数器在哈希区域内）——**成因确认后，去抖那条取舍不必做**

## Touches

- tasks/gap-session-liveness-hashes-the-token-counter-as-if-it-were-work.md
- plugin/scripts/session-liveness.sh
- plugin/test/session-liveness.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T14:35:00Z
changed: 管理者按纪律把它报成「一种可能成因，未确认」，并要求不要当定论去修。
**外层实测把它确认了**：`session-liveness.sh:170` 哈希的是**整屏** `capture-pane` 输出，
而 `tmux capture-pane -p -t archguard-2:outer` 的**第 111 行**就是
`new task? /clear to save 151.2k tokens` ⇒ **计数器在哈希区域内**，
它每变一次就制造一次「忙」，随即稳定制造一次「闲」。
管理者观察到的 150.2k→151.2k 正是那一次。**推测的形状对，机制不是「瞬时重绘」而是「脏输入」。**
**因此把范围从它提的方向改掉**：**不做去抖**——去抖是在输入脏的前提下补偿，
而输入可以直接洗干净，且**不损失响应速度**（人明确要过「及时知道」）。
**并预先堵一个改过头的口子**：外层实测到 quay 内层 pane 的
`◯ general-purpose … ↓ 57.3k tokens` **是真内容**，
所以排除规则必须精确到状态提示行，**不能按 `tokens` 关键词一刀切**——
否则把假阳性换成假阴性，而后者是静默的。AC4 与 AC7 就是为这两点设的。
**AC5 是本仓自己的教训前置**：剥离规则若吃掉整屏，每个会话都会永远显示空闲且不报错，
与 `loop-shipping` AC1b「不断言语料非空」同族，这次在设计时就堵上。
**派发时机**：与在飞的 `gap-quay-init-rewrites-an-executable-…` 在
`plugin/scripts/session-liveness.sh` 上**重叠**，**必须等它收尾后再派**。
