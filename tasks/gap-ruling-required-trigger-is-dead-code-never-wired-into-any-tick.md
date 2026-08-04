---
id: gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick
title: ruling-required's trigger exists in inner-blocked-signal.ts but no tick
  ever passes --transcript, so "a question the outer must rule on" is
  unobservable to the outer and the channel silently never fires
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  blocked_by: gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable
---

**type:** execution

## Proposal

外层裁定 B（`orchestration/outer-rulings-2026-08-04-A-F.md`）。证据（本 tick 独立核实）：

```
$ grep -n -- '--transcript\|omitted' plugin/scripts/inner-blocked-signal.ts | head -3
634: --transcript <path> (or env INNER_BLOCKED_TRANSCRIPT) additionally enables the "ruling-required"
637: inferred; omitted ⇒ no-op, the other two conditions are unaffected.

$ grep -n -- '--detect-stop' plugin/loop/fast-mode-loop-tick.md
233: node --no-warnings --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop
```

生产调用是裸的 `--detect-stop`，**没有 `--transcript`** ⇒ `ruling-required` 触发器在代码里
存在（`inner-blocked-signal.ts:560/680` 两处写 reason `"ruling-required"`），但**从未在任何
生产调用里被打开**——它是死代码。而 `ruling-required` 正是 `gap-the-one-condition-the-channel-
was-built-for-still-has-no-trigger`（status: done）那整套通道存在的理由。

### 为什么不直接「把 `--transcript` 接上」

即使接上，它的判据是「transcript 心跳陈旧 ≥30 分钟 AND 有任务 in-progress AND 工作树干净」：

- **≥30 分钟**违反裁定 C 的「≤5 分钟（p100）」预算；
- 它是**形状代理**（该任务 AC1 自己写明），**看不到权限确认弹框**——而弹框正是裁定 D 指出的
  「最要紧的那一类」；
- 今晚复现的那次（内层说「等套件 #12 通知」然后坐着不动）三个子条件不同时成立，接上也不会响。

### 选定机制

**`ruling-required` 的触发源改挂到裁定 D 的屏幕观察者**（`classifyPaneState` 的消费者）：
外层按分钟轮询内层 pane，底部区域 + 形状分类 + 多次采样一致 ⇒ 判为
`waiting-input` / `permission-prompt` 等「需要外层参与」的形状 ⇒ 写
`<workspaceRoot>/.quay/inner-blocked.json`，`reason: "ruling-required"`。transcript 降为**旁证**
（只用于区分「空闲是因为干完了」与「空闲是因为压根没启动」）。

`--transcript` 那条路径**不删**——它对「会话真的死了」仍有效——但不再是 `ruling-required` 的
主判据。

### 对 `gap-the-one-condition-...`（done）的处置

不回退它的 done（它交付的检测函数是实的）；由本任务承载接线。与
`gap-session-liveness-stage-2-screen-signal-and-payload` 当初的处置同一先例。

## Acceptance Criteria

- [x] AC1: 生产接线存在——`plugin/scripts/inner-blocked-signal.ts --detect-stop --pane`（或其所调的
      观察者）接受一个 pane 文本源并调用 `classifyPaneState`；`waiting-input`/`permission-prompt`
      形状 ⇒ 自动写 `inner-blocked.json`，`reason: "ruling-required"` + 可行动 `question`
- [x] AC2: **端到端延迟 ≤5 分钟（p100）**——从 pane 出现需要用户参与的形状到 `.quay/inner-blocked.json`
      出现 `ruling-required` 记录。轮询周期 60s + 多次采样一致 3 次 ⇒ 结构上界 ~3 分钟，5 分钟留余量
- [x] AC3: `--transcript` 路径保留，但不再作为 `ruling-required` 主判据（代码注释同步，别留旧语义）——
      本任务后它只在 pane 观察者没产出时作为「会话真的死了」的旁证触发
- [x] AC4: **负控制（双向，2026-08-04 外层裁定后为三向）**——喂 busy 形状（`esc to interrupt` 存在）⇒
      不写 `ruling-required`；喂 waiting-input 形状（输入框空 + 无 activity 标志 + **无在飞后台 agent**）
      ⇒ 必须写；喂 waiting-input + 状态区「← N agent」（**在飞后台 agent**）⇒ 不写（良性空闲，不是等
      人类裁定）。实跑输出贴任务体
- [x] AC5: **不使用整屏哈希**——接线判据按 `classifyPaneState` 的形状分类，不按 pane 等值/md5
      （裁定 A 的 ADR-016 修订同步生效）
- [x] AC6: `gap-the-one-condition-the-channel-was-built-for-still-has-no-trigger` 保持 done（引用核对
      `status: done`），本任务完成后其记录的洞被本任务填上（不回退）
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`（`plugin/test/ruling-required-wiring.test.mjs`）

## Definition of Done

- [x] AC1–AC7 全部勾上；AC4 实跑输出逐字贴进本任务体（见下「实跑证据」）
- [x] **真实接线（外层裁定 2026-08-04 修订）**：实跑覆盖**负控制类**——真实 busy pane 不写、真实
      waiting-input+在飞 agent pane 不写（后者正是裁定发现的误报形状，修复后验证不再误报）。**真阳性
      形状**（waiting-input 无在飞 agent / permission-prompt）在本机群无实况（全部会话 bypass
      permissions 且状态区恒有 agent 指示），由构造夹具测试覆盖（DIR-026 real-object 要求以满足
      「机制真的跑通真实 pane」的负控制方向满足；真阳性形状见 `ruling-required-wiring.test.mjs`）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——在批量 fan-in 于 master 上验证，
      worktree 内以 `QUAY_TEST_SKIP_STATIC_CHECKS=1` 跑选中集（本任务 11 过 / 内层既有 31 过全绿）

### 实跑证据（逐字，2026-08-04）

**负控制 A：真实 waiting-input + 在飞 agent pane（`quay-0:1.0` 管理者 pane 实测捕获——正是外层裁定
指出的误报形状，状态区 `← 1 agent`），3 次轮询均不写、计数归零：**

```
detect-stop: pane_decision=waiting-input branch=reset consecutive=0/3
detect-stop: no stop condition; no block
detect-stop: pane_decision=waiting-input branch=reset consecutive=0/3
detect-stop: no stop condition; no block
detect-stop: pane_decision=waiting-input branch=reset consecutive=0/3
detect-stop: no stop condition; no block
```

**负控制 B：真实 busy pane（`quay-0:0.0` 内层实测捕获，状态区 `esc to interrupt`），不写：**

```
detect-stop: pane_decision=busy branch=reset consecutive=0/3
detect-stop: no stop condition; no block
```

**真阳性（构造夹具测试，`ruling-required-wiring.test.mjs`）：waiting-input 无 agent 3 采样后写、permission-prompt 1 采样即写、busy/在飞 agent/缺 pane 均重置不写（11 项测试全绿）。**

**误报修复说明（外层裁定 2026-08-04）**：本任务最初按「waiting-input 即写」做实跑，把管理者 pane
的「等自己的批量 fan-in 后台 agent」误判为等人类裁定并写了块。修复：`waiting-input` 形状在**状态区
有在飞 agent 指示（`← N agent` N>0 / general-purpose）或遥测有在飞任务 bracket** 时，是良性空闲，
不计数、不写块；`permission-prompt` 恒为人类等待形状，不被抑制。`statusAreaShowsInFlightAgent` +
`telemetryHasInProgressTask` 两条判据落地（见 `inner-blocked-signal.ts`）。
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——fan-in 后实测：tests 2276 / fail 0 / cancelled 0 / skipped 25

## Touches

- plugin/scripts/inner-blocked-signal.ts
- plugin/scripts/pane-state-classify.ts (new)（D 的交付，本任务消费）
- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
- plugin/test/ruling-required-wiring.test.mjs (new)

## Contract

measure   ruling_latency = `node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --pane <pane.txt> --transcript /dev/null` stdout 的判定分支字段（`pane_decision=...` 行）
band      ruling_latency = 180000..300000 ms（结构上界 ~3 分钟，5 分钟 p100 上限留 40% 余量）
invariant classified_states = 5（waiting-input / permission-prompt / busy / error-banner / unknown，与 D 同源）
invoke    `node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --pane <pane.txt>`
control   喂 busy 形状 ⇒ 不写；喂 waiting-input 无在飞 agent ⇒ 必须写；喂 waiting-input + 在飞 agent ⇒ 不写（AC4 三向负控制）
resume    接线与 tick 文档修订分两次提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-04T14:3xZ
changed: 外层裁定 B 立案。相对简报的三处收紧：
(1) **触发器的位置纠正**——简报说 ruling-required「没有任何机械触发」，核实发现触发器代码存在、
只是从未被打开（--transcript 从未进任何生产调用）；措辞改为「生产死代码」，避免内层在错误的问题上修；
(2) **明确不接 --transcript 作为主判据**——它的 ≥30 分钟陈旧阈值违反裁定 C 的 ≤5 分钟预算，且是
形状代理看不到弹框；接入会让人以为问题解决了而实际没有；
(3) **DoD 要求真实接线**——构造的夹具负控制（AC4）之外，必须有一次真实实况写出 ruling-required，
否则本任务会重演「造了机制、正确报警、无人处理」的第五次变体。
status: todo——本任务消费 D 的分类器，等 D 落地后再派发（extra.blocked_by 记录）。
