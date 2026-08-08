---
id: gap-reliable-send-crystallize-the-five-failure-modes-into-a-script
title: F closed send-keys-verified but D only covers the classify/wait half —
  the SENDING half (5 measured delivery-failure modes) has no owner; crystallize
  the reliable-send algorithm into a script
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者交办（人要求把今晚反复出现的手工修法结晶为脚本）。依据
`orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md`（记录 5 个独立送达故障模式，每条有实测证据，
并给出完整算法）。

**现状缺口**：`send-keys-verified.sh` 的哈希判据已被 F 判定 superseded；F 指向 D
（`gap-pane-state-is-hashed-not-classified-...`，已 done）。但 **D 的范围只是「分类器本体 + 接线」
（判断目标在不在等输入），不覆盖「发送」这一半**——5 个故障模式全部发生在发送侧，D/B 都不管。
**F 关掉后这块地是空的。**

### 5 个故障模式（每条今晚实测，非推断）

| # | 故障 | 关键证据 | 修法 |
|---|---|---|---|
| 1 | `C-u` 只清当前行（readline kill-line），多行残留清不掉 | 1554 字节长消息实测需**连续 30 次 C-u** | 循环 C-u + capture-pane 查空（上限 50，超限 fail loud） |
| 2 | 长文本后紧跟 Enter，接收端渲染未完成时回车不生效 | 隔离探针字节级：tmux/pty 投递正确（Enter 晚 58ms、顺序不乱），真实会话没提交 | 发文本后轮询 capture-pane 连续两次一致（渲染稳定）再发 Enter |
| 3 | 即使空闲 + 等稳定，Enter 仍可能不生效 | 空闲会话 C-u 清空 + sleep 0.8 后 Enter 未提交；补发独立 Enter 才落 transcript | **必须验证真实送达**，未达则补发一次独立 Enter，仍不达报失败 |
| 4 | 「已提交」与「落进 transcript」之间有排队延迟 | 发送时外层正忙，输入框立即清空但 transcript 30 秒后才出现 | 送达确认 = 有界轮询（60s 超时），不是单次检查 |
| 5 | 三种「看起来送达」的信号全不可靠；唯一可信 = 目标 transcript | 哈希 exit0 / 输入框为空 / SESSION-RESUMED 全被证明会误报 | 送达判据只认：目标 `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` 新增一条内容匹配的真实 user message |

### 选定机制

**新脚本 `plugin/scripts/send-keys-reliable.sh`**，实现文档 §5 的 5 步算法（清空→发送→稳定→提交→
验证）。**不重写 `send-keys-verified.sh`**（其名字承载哈希语义，已被 F 判死；新脚本零哈希）。

**关键设计：验证逻辑（步骤 5）是纯函数**——`checkTranscriptDelivered(transcriptFragment, sentText) ->
{delivered, matchedLine}`，无副作用、不调 tmux。于是脚本的 tmux 触碰面很薄（步骤 1–4），而最容易出
错的送达判据是纯函数，测试不需要假 TUI（与裁定 E 同一设计：危险测试面结构性不存在）。

**步骤 3 的「稳定判断」可复用 D 的 `classifyPaneState` 或简单连续两次 capture-pane 等值**——不重新
发明一套（文档 §5 明写）。

## Acceptance Criteria

- [x] AC1: `plugin/scripts/send-keys-reliable.sh` 实现步骤 1——循环 `C-u` + capture-pane 查空，
      上限 N=50，**超限 fail loud**（报失败退出非 0，不静默继续）
- [x] AC2: 实现步骤 3——发送文本后轮询 capture-pane 连续两次一致（渲染稳定），有界超时（如 10s）
- [x] AC3: 实现步骤 5——**有界轮询**目标 transcript jsonl 直到出现内容匹配的真实 user message
      （60s 超时）；单次超时 → 补发一次独立 Enter 重新计时；二次超时 → **fail loud**（needs-human，
      不假装成功）
- [x] AC4: **送达判据是纯函数**——`checkTranscriptDelivered` 无副作用、不调 tmux、不读文件以外
      的源；测试直接 import（不需要 tmux server / pty / 假 TUI）
- [x] AC5: **负控制**——给一份不含该消息的 transcript 片段 + 发送文本 ⇒ `checkTranscriptDelivered`
      必须报未送达；含但内容不匹配 ⇒ 报未送达（两次实跑贴任务体）
- [x] AC6: **正控制（真实对象）**——脚本对**真实 tmux 会话**完成一次发送，验证通过真实 transcript
      判定送达（非构造夹具）；实跑输出贴任务体
- [x] AC7: **零哈希**——脚本与测试文件里 `md5sum|sha1sum|cksum` 出现 0 次（F 判死的哈希判据不得
      借尸还魂）；`grep -c` 输出贴任务体
- [x] AC8: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [x] AC1–AC8 全部勾上；AC5/AC6/AC7 的实跑输出逐字贴进本任务体
- [x] 一次真实跨会话发送被真实 transcript 判定送达（AC6 的对象，DIR-026 real-object）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）
- [x] `orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md` 已跟踪（提交时）

### invoke 实跑证据（task-contract-check 消费者：done 任务必须展示 invoke 入口路径）

`scripts/test.sh plugin/test/send-keys-reliable.test.mjs` → ℹ tests 20 / pass 20 / fail 0 / cancelled 0 / skipped 0。
批量 fan-in 全量：tests 2298 / fail 0 / cancelled 0 / skipped 27。

## Touches

- plugin/scripts/send-keys-reliable.sh (new)
- plugin/scripts/transcript-delivery-check.ts (new，纯函数，可单测)
- plugin/test/send-keys-reliable.test.mjs (new)
- orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md（跟踪 + 结果回写）

## Contract

measure   delivered = `node --experimental-strip-types plugin/scripts/transcript-delivery-check.ts --check <jsonl> --text <text>` stdout 的 delivered 字段
band      delivered = true（内容匹配的真实 user message 出现）
invariant hash_uses = 0（脚本/测试里 md5sum|sha1sum|cksum 出现 0 次，F 判死的哈希不借尸还魂）
invoke    `scripts/test.sh plugin/test/send-keys-reliable.test.mjs`
control   负控制（不含消息/不匹配的 transcript ⇒ 未送达）；正控制（真实会话 + 真实 transcript ⇒ 送达）
resume    纯函数与脚本分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-04T16:1xZ
changed: 外层受管理者交办立案。四处收紧：
(1) **判断=新建任务而非并入**——D/B 已 done 且明写不覆盖发送侧；并入 R2 会变杂烩（R2 管通道内容
纪律，本任务管发送机制本身）；
(2) **送达判据抽成纯函数（AC4）**——最容易错、最需要测试的是验证逻辑，不是 tmux 触碰；纯函数使
测试不需要假 TUI（裁定 E 同款设计，危险测试面结构性不存在）；
(3) **零哈希是 invariant（AC7）**——F 判死的是哈希判据本身，任何把它带回来的实现都是倒退；
(4) **DoD 要求真实对象**——AC6 必须对真实会话+真实 transcript 判定送达，构造的夹具不够。
status: todo——不紧急（文档明写不阻塞当前批次），排当前批之后。

## Re-open 2026-08-05T07:40Z — 第六种送达失败模式（fresh welcome 屏 placeholder，冷启动卡死）

**触发**：archguard 外层独立实证（管理者转达）+ meta-cc 独立观测吻合。**专门打在冷启动上**——恰是
cold-start INNER-DRIVEN 判据第一次驱动新项目的时刻。

**证据（archguard）**：send-keys-reliable.sh 在全新 welcome 屏卡死——第 1 步 C-u 清屏循环**清不掉
TUI 的 ghost placeholder**（`Try "how do I log an error?"` 灰色占位），clear 循环跑满 N=50 后 fail
loud 退出，驱动发不出去。改用手动序列（`-l` → 等稳定 → Enter）成功，transcript `76bbb31e` 核实
1648 字节驱动文本作为 user 消息落地。**meta-cc 吻合**：长文本被 TUI 折叠成 paste 块（`paste again to
expand`）看起来像没送出去但实际送到了。

**根因**：全新会话的 TUI 处于 C-u 语义与已用会话不同的状态——**placeholder 不是 readline 缓冲内容，
C-u 对它无效**，清屏循环把「清不掉」当成失败。前五种模式全在已用会话上测出，第六种只在新会话出现，
此前测不到。

**与故障 6 的区分**：故障 6 = 已用会话的 gray ghost-suggestion（直接输入覆盖可解）；故障 7 = 全新
welcome 屏 placeholder（C-u 无效 + 覆盖后仍显示不清）。**结晶文档已补故障 7 段 + 算法步骤 0 分支。**

**外层裁定方向**：清屏终止条件从「输入框为空」改为「输入框不含用户输入的内容」；**更省事的分支**：
fresh session（transcript 不存在或零条 user 消息）⇒ **跳过清屏直接发**。

### 新增 Acceptance Criteria（re-open）

- [ ] AC9: **fresh-session 分支**——target transcript 不存在或零条 user 消息 ⇒ 跳过清屏循环直接进入
      发送（故障 7 分支；cold-start 场景不卡死）
- [ ] AC10: **终止条件修正**——清屏循环终止条件改为「输入框不含用户输入的内容」而非「逐字为空」
      （placeholder 是渲染提示非输入，C-u 无效时不再 fail-loud）
- [ ] AC11: **冷启动真实对象回归控制**——对全新会话（无 transcript）驱动成功，transcript 核实送达
      （AC6 同款真实对象纪律，冷启动形态）
- [ ] AC12: 测试用 `node:test` 且带 `// @test-group governance`（沿用既有声明）

### Re-open Touches 增补

- plugin/scripts/send-keys-reliable.sh（步骤 0 fresh-session 分支 + 步骤 1 终止条件）
- orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md（故障 7 已补；算法步骤 0 已加）
- plugin/test/send-keys-reliable.test.mjs（AC9/AC10 fixture）

### Re-open Contract

measure   fresh_branch_hits = `grep -c "fresh\|零条\|跳过清屏" plugin/scripts/send-keys-reliable.sh` stdout 的数字段
band      fresh_branch_hits >= 1（fresh-session 分支存在；步骤 0 跳过清屏）
invariant no_fail_loud_on_placeholder = 1（C-u 对 placeholder 无效不 fail-loud——先判 fresh 再清屏）
invoke    `grep -n "transcript\|零条\|user 消息" plugin/scripts/send-keys-reliable.sh`
control   构造零条 user 消息的 transcript ⇒ 跳过清屏直接发（AC9）；已用会话仍走清屏（AC10 负向）
resume    fresh 分支与终止条件分两步提交，任一步完成即写盘

reviewer: outer (re-open)
at: 2026-08-05T07:40Z
changed: done→ready——第六种送达失败模式（fresh welcome 屏 placeholder）未覆盖。AC9/AC10/AC11/AC12
  新增；结晶文档故障 7 段 + 算法步骤 0 分支已补。AC10 记账：post-friction（被 archguard 实证撞出），
  不计分。

## Cross-annotation 2026-08-05 — NBSP 判空缺陷（姊妹任务，已 ready/执行）

`gap-send-keys-reliable-nbsp-empty-check-is-broken-for-any-input-box`（2026-08-05 执行）修复了判空的
**NBSP 误判**：bash `[:space:]` 在 C locale 不含 NBSP（U+00A0，字节 c2 a0），真空输入框（`❯` 后仅 NBSP）
被永远判「非空」⇒ clear 循环跑满 CLEAR_MAX=50 后 fail-loud。这是对**任何**输入框都生效的根因缺陷，也是
本任务故障 7（welcome 屏 placeholder）的放大版——结晶文档已补「故障 8」段。修复：判空显式剥离 NBSP
（`nbsp=$'\302\240'; after="${after//$nbsp/}"`）+ 真端到端测试（fixture 渲染 `❯`+NBSP 的 tmux pane、
`RELIABLE_CLEAR_MAX=2` 证明 clear 快速退出、transcript 核实送达）。**本任务的 AC9（fresh-session 分支）
与 AC10（终止条件修正）仍独立待执行；NBSP 修复不替代它们**——fresh-session 分支是「跳过清屏直接发」，
NBSP 修复是「已用会话的清屏判空正确」，二者正交。

## Cross-annotation 2026-08-08 — supervisor 步骤⑤ 消息总线带身份（`gap-supervisor-step-5-message-bus-with-identity`）

本任务是 supervisor 基座层落地次序**步骤③**（投递实现），已 done；步骤⑤（消息总线带身份）在本任务之上
收编「跨会话投递」为一条带身份通道：`plugin/scripts/supervisor-bus.sh --send --from <layer> --to <target>
--payload <msg>`，投递实现**复用本任务的可靠五步**（send-keys-reliable.sh）+ `transcript-delivery-check.ts`
（唯一可信送达信号），ledger 记谁→谁→何时→是否送达。步骤⑤ 的 AC3 真 TUI e2e 的 fixture 渲染
`❯`+NBSP 空输入框——正是本任务判空修复的同一场景；步骤⑤ 是**消费者收编**（一处硬化接口），本任务是
**底层投递/判空机制**，二者分层。
