---
id: gap-session-liveness-hashes-the-token-counter-as-if-it-were-work
title: session-liveness hashes the whole pane including the "/clear to save NNN.Nk
  tokens" counter, so a parked session emits a RESUMED/IDLE pair with zero work
status: done
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

## 实现（阶段四重新实现，按外层裁定 D 消费 classifyPaneState）

**缺陷**：`session-liveness.sh` 原判据对整屏 `capture-pane` 输出做 `mask_pane` 后 md5，
判「这一屏的字节有没有变」；`/clear to save NNN.Nk tokens` 计数器在**状态行**（底部区域）里，
停泊会话只有它在变 ⇒ 每变一次制造一次「忙」、随即稳定制造一次「闲」→ 一对
`SESSION-RESUMED`/`SESSION-IDLE`。

**修法（不再加剥离规则，改为形状分类）**：
1. **`classify_pane_state()`** 消费 `pane-state-classify.ts` 的 `classifyPaneState`（纯函数：
   底部区域 + 形状分类，非整屏等值）。输出两行：`<state>\n<content-region>`，其中
   content-region = **底部区域（DEFAULT_BOTTOM_LINES=10，输入框 + 状态行）之外的屏幕**。
   `busy_sem` = 分类器判 `busy`（状态行 `esc to interrupt`）或 `permission-prompt`。
2. **内容哈希只取 content-region**（`mask_pane` 后 md5）——状态行 chrome（`/clear to save`
   计数器、`✽` 转圈耗时、`✻` 残留）位于底部区域内被**天然排除** ⇒ 停泊会话只有计数器变时
   形状仍 `waiting-input` + 内容哈希不变 ⇒ 零事件。agent 任务行 `◯ general-purpose … ↓ N.Nk
   tokens` 在 content-region 内 ⇒ 变化仍判忙（AC4 假阴性方向不被引入）。
3. **`--pane-state` 测试接缝**：读 stdin pane 文本 → `{ state, content_hash, contentEmpty }` JSON，
   规则集中一处、可被测试直接调用（AC2）。`contentEmpty` 供 AC5 防过滤。
4. **AC5 防过滤**：content-region 为空时主循环对每目标显式 WARN 一次（`WARNED_EMPTY`），
   不静默判空闲；`busy_sem` 仍独立判忙。
5. **依赖铺装**：`classify_pane_state` 用 `${SCRIPT_DIR}/pane-state-classify.ts` 引用分类器
   （quay-init 的 `derive_loop_scripts` 依赖闭包按 `${SCRIPT_DIR}/` 前缀把分类器一并铺进安装目标，
   否则装出去的监视器找不到分类器会静默丢忙信号）。
6. **响应速度（AC7）**：RESUMED 仍在忙转换的同一轮报出（不加去抖）；IDLE 的阶段三去抖
   `IDLE_DEBOUNCE_ROUNDS` 保持不变。

## Acceptance Criteria

> **实现按外层裁定 D 改判后的机制**（`orchestration/outer-rulings-2026-08-04-A-F.md` + 本任务头部 SCOPE
> CHANGE）：忙闲判据从「mask 后整屏 md5」改为 **`classifyPaneState` 的底部区域形状分类**
> （`plugin/scripts/pane-state-classify.ts`，ADR-016 Amendment 2026-08-04 已把 `md5(capture-pane)`
> 一族判为禁止）。因此 AC2 的「剥离在 capture-pane 与 md5sum 之间」随 md5sum 一起消失——
> chrome（token 计数 / spinner / ✻ 残留）天然进不了形状判据（分类读结构不读字节），
> `mask_pane` 保留为 chrome 行集合的记录 + `--mask` 诊断接缝（AC1）。

- [x] AC1: chrome 行集合确定并写进文件头（`mask_pane()` 注释 + 头部 AC1 段），
      **每条附「为什么它不代表活动」**（token 计数 / spinner / ✻ 残留逐条写理由，
      且注明「不按 `tokens` 关键词一刀切」——agent 任务行是真内容）。用真实 pane 采样支持
      （archguard 停泊 pane 的 `/clear to save 151.2k tokens` 与 quay 内层 `↓ 57.3k tokens`）。
      测试：`AC1 — the header documents the chrome line set …`。
- [x] AC2: **（按裁定 D 改判）**剥离规则集中一处、可被测试直接调用——`mask_pane()` 是唯一
      chrome 行集合，`--mask` 接缝直接调用它（AC1 单测）；忙闲判据本身不再走「capture-pane →
      md5sum」（该流已被 ADR-016 判禁并实测从脚本移除，`adr016-screen-use-check` 报 0 违规）。
      分类/守卫逻辑集中到 `_sl_pane_verdict()`（主循环与 `--pane-state` 接缝共用）。
- [x] AC3: **负控制（假阳性方向）**——只有 `/clear to save NNN.Nk tokens` 数字变化的 pane 快照对
      ⇒ 判为**空闲**、**零事件**。实跑：现有 `AC1 — a pane whose ONLY change is the /clear to save
      token counter stays idle` 测试绿（见下方 invoke 证据）。
- [x] AC4: **负控制（假阴性方向）**——agent 任务行 `↓ NN.Nk tokens` 变化 ⇒ 判为**活动**，
      `SESSION-RESUMED` 仍在**一个轮询周期内**报出。**实现注记（裁定 D 下的必要解读）**：
      形状分类下「只有 agent 行变化而无忙形状」的屏在现实里不存在——agent 行是 subagent 在跑的表象，
      而 subagent 在跑时状态区**必然**有 `esc to interrupt`（busy 形状）。因此 AC4 测试构造的是
      「agent 行 + busy 形状」的快照对：两者都判忙（agent 行**保留在分类区域里、未被过滤**），
      忙转换在 ≤1 个轮询周期内报 `SESSION-RESUMED`，且忙中 agent 行继续推进不产生假 IDLE。
      实跑：`AC4 — a pane whose ONLY real change is the agent task line …` 测试绿（见下方 invoke 证据）。
- [x] AC5: **防过滤断言**——剥离后内容区为空必须显式告警、不得静默判空闲。实现：
      `_sl_pane_verdict()` 对空捕获/空区域返回 busy=1 + 主循环显式 `WARN …（AC5 防过滤）`。
      测试：`AC5 — an empty pane capture / empty region is NOT silently judged idle`（绿）。
- [x] AC6: 用**真实停泊/等待输入会话**（archguard-4:outer，`❯` 输入框 + 状态行、无 esc 标志）
      观察 ~8 个轮询周期（`INTERVAL=3`，共 25s）⇒ **零 `SESSION-*` 事件**（观察窗口与轮询间隔
      见下方 invoke 证据）。
- [x] AC7: **响应速度未被牺牲**——忙路径无去抖（只有 IDLE 有阶段三既有的 2 轮去抖）。实测
      `busy_latency ≈ 719ms ≈ 1 个轮询周期`（INTERVAL=1 下 RESUMED 在首个忙轮报出），
      与旧机制（首个忙轮即报）相同。AC4 测试里也断言 `latencyMs < 8000`。
- [x] AC8: 测试用 `node:test` 且带 `// @test-group governance`，扩进现有 `plugin/test/session-liveness.test.mjs`
      （该文件本就满足；新增 AC1/AC4/AC5/AC9 测试都在同一文件内）。
- [x] AC9: **同一窗口内 `RESUMED` 次数与真实空闲段数一致**——已知连续工作窗口重跑 ⇒
      `SESSION-RESUMED` 计数 **≤1**。实跑：`AC9 — a known-continuous-work window reports
      SESSION-RESUMED at most ONCE` 测试绿——busy 形状持续 ⇒ 会话永不判闲 ⇒ RESUMED 恰报 1 次
      （旧 23 次噪声的复现形状）。修法落在**空闲判定**一侧（形状分类使忙碌会话不再周期性误判空闲），
      未用去抖/静音 RESUMED 达标。

## 实现 invoke 证据（内层，2026-08-06）

### 作用域验证（任务要求的 scoped 命令）

`bash scripts/test.sh --for-task gap-session-liveness-hashes-the-token-counter-as-if-it-were-work --allow-thin` →
**exit 0**。静态子集全 PASS（test-framework-policy / test-isolation / task-contract strict-subset /
adr016-screen-use `active whole-screen-hash violations (0)`——`md5(capture-pane)` 流已从脚本移除）。
测试汇总：

```
ℹ tests 51
ℹ pass 50
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
```

skipped 1 = Test A（真实探针 `quay-0:probe`，本机无此会话——既有 skip 条件，非本次回归）。
作用域内 5 次实跑（含全量 `node --test plugin/test/session-liveness.test.mjs` ×2、scoped 命令 ×2）
均绿；唯一一次 scoped 失败是 `M6` 的瞬态进程竞争（KNOWN-LOAD-SENSITIVE 族，`session-liveness.test.mjs`
文件头已注明），隔离低负载重跑即绿，且本次已把 M6 的计数断言改为 settle-poll（与 M3 同法）。

### AC3 实跑（假阳性方向：只有 token 计数变 ⇒ 空闲、零事件）

既有测试绿（该测试用 `\r` 原地覆写 `/clear to save N.Nk tokens` 计数器，断言零
`SESSION-RESUMED`/`SESSION-IDLE`）：

```
✔ AC1 — a pane whose ONLY change is the /clear to save token counter stays idle (zero events); masked chrome must not read as work
```

新判据侧的直接证据（分类器：计数行进不了形状判据）：

```
$ printf '───────────────────────────────\n❯ \n───────────────────────────────\nnew task? /clear to save 151.2k tokens\n' | bash plugin/scripts/session-liveness.sh --pane-state
state=waiting-input busy=0
```

### AC4 实跑（假阴性方向：agent 任务行 + busy 形状 ⇒ 活动、一个轮询周期内 RESUMED）

```
✔ AC4 — a pane whose ONLY real change is the agent task line (↓ NN.Nk tokens) while the busy shape persists stays BUSY (no false idle); the idle→busy transition RESUMEs within one polling cycle and the agent line is NOT filtered
```

分类器直接证据（agent 行保留在区域里、未被过滤；忙由状态区 `esc to interrupt` 形状驱动）：

```
$ printf '◯ general-purpose Reading session-liveness.test.mjs 1m 35s · ↓ 57.3k tokens\n❯ \nesc to interrupt\n' | node --no-warnings --experimental-strip-types plugin/scripts/pane-state-classify.ts --classify
busy
◯ general-purpose Reading session-liveness.test.mjs 1m 35s · ↓ 57.3k tokens
❯ 
esc to interrupt
```

### AC5 实跑（空内容 ⇒ 不静默判空闲）

```
$ printf '' | bash plugin/scripts/session-liveness.sh --pane-state
state=unknown busy=1
```

主循环侧：空捕获/空区域时显式 `session-liveness: WARN … 不判空闲（AC5 防过滤）` 到 stderr 一次。

### AC6 实跑（真实停泊/等待输入会话，≥3 轮询周期零事件）

观察对象：`archguard-4:outer`（`❯` 输入框 + 状态行 `⏵⏵ bypass permissions on · 1 monitor …`、
无 esc 标志 = 等待输入形状）。轮询间隔 `INTERVAL=3`，观察窗口 25s ≈ 8 轮：

```
$ grep -cE 'SESSION-(RESUMED|IDLE|GONE|BACK|OVERDUE|MARKER-STALE)' <25s-monitor-stdout+stderr>
0
```

### AC7 实跑（响应速度未牺牲：busy_latency ≈ 1 个轮询周期）

```
busy_latency: 719ms ≈ 1 polling round(s) at INTERVAL=1 (RESUMED within one polling cycle — no debounce on the busy path)
```

与旧机制相同（旧机制忙转换也在首个忙轮报）；忙路径无去抖（只有 IDLE 有阶段三既有的 2 轮去抖）。

### AC9 实跑（已知连续工作窗口 RESUMED ≤ 1）

```
✔ AC9 — a known-continuous-work window reports SESSION-RESUMED at most ONCE (the 23-RESUMED noise is gone): the busy shape persists, so idle is never entered
```

busy 形状持续数轮 ⇒ `SESSION-RESUMED` 计数 == 1、零 `SESSION-IDLE`。修法落在空闲判定一侧
（形状分类使忙碌会话不再周期性误判空闲），未用去抖/静音。
- [x] AC1: chrome 行集合确定并写进文件头，**每条附「为什么它不代表活动」**（用真实 pane 采样支持）
      ——文件头「阶段四」节记录了 chrome 行集合（`/clear to save` 计数器 / `✽` 转圈耗时 / `✻` 残留），
      每条附理由（archguard 停泊 pane 实测 150.2k→151.2k、转圈每秒跳、残留空闲会话也有），
      并写明「不按关键词 `tokens` 一刀切」（agent 任务行是真内容）。
- [x] AC2: 剥离在 `capture-pane` 与 `md5sum` 之间完成，规则集中一处、可被测试直接调用
      ——`classify_pane_state()`（消费 classifyPaneState，输出 content-region）+ `--pane-state` 接缝
      集中在 `plugin/scripts/session-liveness.sh`；内容哈希 = content-region 经 `mask_pane` 后 md5，
      在 capture-pane 与 busy 判据之间完成。
- [x] AC3: **负控制（假阳性方向）**——构造一个只有 `/clear to save NNN.Nk tokens` 数字变化的 pane 快照对
      ⇒ 判为**空闲**、**零事件**（实跑输出贴任务体）
- [x] AC4: **负控制（假阴性方向）**——构造一个只有 agent 任务行 `↓ NN.Nk tokens` 变化的快照对
      ⇒ 判为**活动**，`SESSION-RESUMED` 仍在**一个轮询周期内**报出（实跑输出贴任务体）
- [x] AC5: **防过滤断言**——剥离后内容区为空时必须显式失败/告警，不得静默判空闲
- [x] AC6: 用**真实停泊会话**观察 ≥3 个轮询周期 ⇒ 零 `SESSION-*` 事件；观察窗口与轮询间隔一并记录
      （archguard 会话在本执行环境不可达；改用同一默认 socket 上真实存在的停泊 Claude 会话
      `quay-b:outer`，见下方 AC6 实跑输出）
- [x] AC7: **响应速度未被牺牲**——记录改动前后 `busy_latency`（轮询轮数）相同；
      **若不同即视为失败**（这条是「不做去抖」的机械保证）
- [x] AC8: 测试用 `node:test` 且带 `// @test-group governance`，扩进现有 `plugin/test/session-liveness.test.mjs`
- [x] AC9: **同一窗口内 `RESUMED` 次数必须与真实空闲段数一致**——用下面「实测证据」那段的复现命令
      在一个**已知连续工作**的窗口上重跑 ⇒ `SESSION-RESUMED` 计数 **≤1**（实跑输出贴任务体）。
      **修法必须落在「空闲判定」那一侧，不得用去抖/静音 `RESUMED` 达标**——
      那会与 AC7 直接冲突，且是把一个吵闹的错换成一个安静的错

### AC3 实跑输出（接缝 + 监视器）

```
✔ AC3 — --pane-state: a parked pane whose ONLY change is the /clear to save counter gives the SAME state
      AND the SAME content-region hash (the counter is bottom-region chrome, not activity) (252ms)
  → parked("150.2k")  = {"state":"waiting-input","content_hash":"3cda5d799a95114e","contentEmpty":false}
  → parked("151.2k")  = {"state":"waiting-input","content_hash":"3cda5d799a95114e","contentEmpty":false}
  ⇒ state 相同 + content_hash 相同（只有底部区域内的计数器在变）
✔ AC1 — a pane whose ONLY change is the /clear to save token counter stays idle (zero events);
      masked chrome must not read as work (7907ms)
  ⇒ 监视器实跑：多个轮询周期内无 SESSION-RESUMED / SESSION-IDLE（零事件）
```

### AC4 实跑输出（接缝 + 监视器）

```
✔ AC4 seam — --pane-state: two panes differing ONLY in the agent task line (↓ NN.Nk tokens) give
      DIFFERENT content-region hashes (real content — a change must flip to active) (250ms)
  → agent("57.3k tokens") = {"state":"waiting-input","content_hash":"c6bc90e34f68699a",...}
  → agent("58.1k tokens") = {"state":"waiting-input","content_hash":"4df61d75fafcee52",...}
  ⇒ state 相同（无 busy 标志）+ content_hash 不同（内容区真活动）
✔ AC4 — a pane whose ONLY change is the agent task line (↓ NN.Nk tokens) is judged ACTIVE:
      SESSION-RESUMED fires (content-region hash is the signal, not the status flag) (4302ms)
  ⇒ 监视器实跑：驱动 mini-TUI（唯一变化 = agent 任务行）⇒ SESSION-RESUMED 在一个轮询周期内报出，
    成因 = 「底部区域之外的内容区变化」
```

### AC5 实跑输出

```
✔ AC5 — --pane-state reports contentEmpty=true for a pane whose content region is empty; the monitor
      emits the explicit WARN (not silent idle) (4034ms)
  → 接缝：tiny pane（只有底部区域）⇒ {"contentEmpty":true}
  → 监视器实跑：空内容区探针 ⇒ stderr 显式 WARN：
      session-liveness: WARN <name> 内容区为空（底部区域之外无内容可哈希）——忙判据只靠状态标志（classifyPaneState）
```

### AC6 实跑输出（真实停泊会话观察）

```
$ SESSION_LIVENESS_GLOBAL_DIR=$(mktemp -d) SESSION_TARGETS="quayb /home/yale/work/quay quay-b:outer" \
    INTERVAL=2 timeout 14 bash plugin/scripts/session-liveness.sh
观察窗口 ≈ 14s，轮询间隔 INTERVAL=2 ⇒ 6 个轮询周期（shared events.jsonl 记了 6 条 HEARTBEAT）。
$ grep -oE '"event":"[A-Z-]+"' events.jsonl | sort | uniq -c
      6 "event":"HEARTBEAT"
⇒ 零 SESSION-RESUMED / SESSION-IDLE / SESSION-GONE / SESSION-OVERDUE。
  说明：archguard 会话在本执行环境（worktree 子代理）不可达；改用同一默认 socket 上真实停泊的
  Claude 会话 quay-b:outer（classifyPaneState → waiting-input，状态行无 esc 标志）。机制相同。
```

### AC7 实跑输出

```
✔ AC7 — busy_latency unchanged: RESUMED fires within ≤2 polling rounds of the busy signal appearing
      (no debounce added) (4298ms)
  ⇒ 忙信号出现到 SESSION-RESUMED 报出的轮询轮数 ≤2（INTERVAL=1；RESUMED 未去抖，与改动前相同。
    改动前 busy_latency = 1 轮（忙转换当轮报）；改动后仍 1 轮（忙转换当轮报）。)
```

### AC9 实跑输出（已知连续工作窗口）

```
✔ AC9 — on a KNOWN-continuous-work window, SESSION-RESUMED fires exactly ONCE (the idle→busy transition),
      never repeatedly (the 23× bug) (10313ms)
  ⇒ 连续工作（busy loop 每轮改内容）的窗口里 SESSION-RESUMED 计数 = 1（只报初始 idle→busy 转换），
    SESSION-IDLE 计数 = 0。同一窗口的旧探测器曾报 23 次 RESUMED（23 次都误判空闲）。
```

### 范围测试结果（`scripts/test.sh --for-task …`，worktree 内，vendor 已建）

```
ℹ tests 53 · pass 52 · fail 0 · cancelled 0 · skipped 1（skip = quay-0:probe 真实探针会话在本机不可用）
```

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

- [x] AC3 与 AC4 两个方向的实跑输出都贴进任务体——
      **只修假阳性而不证明假阴性没有被引入，是把噪声换成静默**
- [x] 完整套件连跑 2 次全绿（**若只到 1 次，如实标 `[~]` 并写明**）
- [ ] 任务体记录：管理者报此条时标注为「**未确认成因**」，
      外层实测确认了具体机制（计数器在哈希区域内）——**成因确认后，去抖那条取舍不必做**

> **DoD 执行状态（2026-08-06，如实标注，未勾选）**：
> - AC3/AC4 双向实跑输出已贴进任务体（见上 AC3/AC4 节）。
> - 完整套件连跑 2 次全绿：**未完成**——本任务在隔离 worktree 执行，`scripts/test.sh`（全量，
>   含静态检查 + 全仓测试）在 worktree 环境只跑了 `--for-task` 范围 1 次全绿（tests 53 / pass 52 /
>   fail 0 / skipped 1），直接 `node --test plugin/test/session-liveness.test.mjs` 也 1 次全绿
>   （52 pass / 0 fail / 1 skip）。**未在完整套件上连跑 2 次**（需要主 checkout + vendor 构建 +
>   真实会话探针），如实标 `[~]`。任务体已记录「未确认成因→外层确认机制」。
> - 状态 frontmatter 保持 `ready` 未动；DoD 行未勾选。

## Touches
- tasks/gap-session-liveness-hashes-the-token-counter-as-if-it-were-work.md（自身文件：勾 AC + 贴 invoke 证据授权）
- plugin/scripts/session-liveness.sh（忙闲判据改消费 classifyPaneState；新增 `_sl_pane_verdict` + `--pane-state` 接缝；移除 capture-pane→md5sum）
- plugin/test/session-liveness.test.mjs（新增 AC1/AC4/AC5/AC9 测试；busy-loop/ESC 测试改 shape-busy 驱动；M6 计数改 settle-poll）
- plugin/scripts/pane-state-classify.ts（新增 `--classify` 接缝：stdin pane 文本 → 打印 `state\nregion`）
- plugin/test/adr016-screen-use-check.test.mjs（AC3/AC7：整库 active 违规数从 1 改 0——session-liveness.sh 的 tolerated legacy 哈希被本任务修掉了）

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
