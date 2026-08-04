---
id: gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick
title: ruling-required's trigger exists in inner-blocked-signal.ts but no tick
  ever passes --transcript, so "a question the outer must rule on" is unobservable
  to the outer and the channel silently never fires
status: todo
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

- [ ] AC1: 生产接线存在——`plugin/scripts/inner-blocked-signal.ts --detect-stop`（或其所调的
      观察者）接受一个 pane 文本源并调用 `classifyPaneState`；`waiting-input`/`permission-prompt`
      形状 ⇒ 自动写 `inner-blocked.json`，`reason: "ruling-required"` + 可行动 `question`
- [ ] AC2: **端到端延迟 ≤5 分钟（p100）**——从 pane 出现需要用户参与的形状到 `.quay/inner-blocked.json`
      出现 `ruling-required` 记录。轮询周期 60s + 多次采样一致 3 次 ⇒ 结构上界 ~3 分钟，5 分钟留余量
- [ ] AC3: `--transcript` 路径保留，但不再作为 `ruling-required` 主判据（代码注释同步，别留旧语义）
- [ ] AC4: **负控制（双向）**——喂 busy 形状（`esc to interrupt` 存在）⇒ 不写 `ruling-required`；
      喂 waiting-input 形状（输入框空 + 无 activity 标志 + 会话活着）⇒ 必须写。两次实跑输出贴任务体
- [ ] AC5: **不使用整屏哈希**——接线判据按 `classifyPaneState` 的形状分类，不按 pane 等值/md5
      （裁定 A 的 ADR-016 修订同步生效）
- [ ] AC6: `gap-the-one-condition-the-channel-was-built-for-still-has-no-trigger` 保持 done，
      本任务完成后其记录的洞被本任务填上（引用核对，不回退）
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC4 两个方向的实跑输出逐字贴进本任务体
- [ ] 一次真实 `--detect-stop` 在「内层停在 waiting-input」实况下写出 `ruling-required`（真实接线，
      不是构造的夹具）——这条是 DIR-026 的 real-object 要求
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/scripts/inner-blocked-signal.ts
- plugin/scripts/pane-state-classify.ts (new)（D 的交付，本任务消费）
- plugin/loop/fast-mode-loop-tick.md
- plugin/loop/orchestrator-loop-tick.md
- plugin/test/ruling-required-wiring.test.mjs (new)

## Contract

measure   ruling_latency = `node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --transcript /dev/null` stdout 的判定分支字段
band      ruling_latency = 180000..300000 ms（结构上界 ~3 分钟，5 分钟 p100 上限留 40% 余量）
invariant classified_states = 5（waiting-input / permission-prompt / busy / error-banner / unknown，与 D 同源）
invoke    `node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop`
control   喂 busy 形状 ⇒ 不写 ruling-required；喂 waiting-input ⇒ 必须写（AC4 双向负控制）
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
