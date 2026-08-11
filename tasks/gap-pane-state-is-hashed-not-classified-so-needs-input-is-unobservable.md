---
id: gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable
title: every screen observer in this repo hashes the pane instead of classifying
  its shape, so "the session is waiting for its user" — the one state that
  matters — is indistinguishable from "the screen happened not to redraw"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

外层裁定 D + E（`orchestration/outer-rulings-2026-08-04-A-F.md`）。

### 证据一：现有两个屏幕观察者用的是同一个错函数

```
$ grep -n 'capture-pane' plugin/scripts/session-liveness.sh
612:      raw=$(tmux capture-pane -p -t "$target" 2>/dev/null)
# → mask_pane（剥离 token 计数行 / ✽ spinner 行 / ✻ 残留行）→ md5sum
# 判据 = 「mask 之后的整屏哈希是否与上一轮相等」
```

`plugin/scripts/send-keys-verified.sh` 同形。**两者判的都是「屏幕变没变」，不是「屏幕在说什么」。**

### 证据二：「加剥离规则」这条路已经走过一轮，且它本身就是信号

`mask_pane` 已经落地了三条剥离规则，每条都附了「为什么它不代表活动」的说明——
而姊妹任务 `gap-session-liveness-hashes-the-token-counter-as-if-it-were-work`（`status: todo`）
还准备再加。**「加一条规则就能对一次」正是「输入脏是因为取了整屏」的定义**。

同一探测器实测的两个方向都错（该任务体记录，外层 2026-08-03 19:25Z）：

```
grep -oE 'SESSION-[A-Z]+' <monitor-output-file> | sort | uniq -c
  → 23 SESSION-RESUMED
  →  0 SESSION-IDLE
```
同窗口内层实际在跑一个 2m11s 的活跃回合 ⇒ **23 次都是误判**。

### 证据三：最要紧的那一类状态，哈希在原理上判不出

哈希只能回答「变了/没变」。它**无法**区分：

| 屏幕实际在说 | 哈希看到 |
|---|---|
| `Do you want to proceed?` 权限确认框在等人点 | 没变 |
| 会话干完了正常空闲 | 没变 |
| 输入框里躺着一条没提交的指令 | 没变 |
| 会话死了 | 没变 |

**而「弹框等批准」整个落在这一列里**——transcript jsonl 同样看不到它（transcript 记的是已发生的
工具调用，不是待批准的那一个）。今晚复现过：内层说「等套件 #12 通知」然后坐着不动，外层没察觉。

### 证据四：哈希连「变了」都不可信——送达失败比「没送达」更隐蔽（2026-08-04 外层裁定）

| 屏幕实际在说 | 哈希看到 |
|---|---|
| 命令文本已发出 + Enter 已到（**字节级，晚 58ms**）但接收端没提交（灰 ghost 吞掉 / 长文本渲染时序） | **变了（假送达）** |

2026-08-04 实测（管理者隔离探针）：一次 `send-keys` 投递失败，tmux 层 Enter **没有丢**——字节级确认
晚 58ms 到达。失败点在**接收端**：要么是 ADR-016 提过的灰色 ghost-suggestion 吞掉了 Enter，要么是
长文本渲染未完成时 Enter 到达的时序问题。⇒ **哈希既不能证「没变=没动静」，也不能证「变了=送达/已提交」**
——send-keys-verified 的「hash 变了即 delivered」判据在**最要紧的失败形态**上恰好报假。分类器的价值
正在于此：它不假装知道「送达」，只判形状（底部区域 + 状态行），匹配不上就返回 `unknown` 并把原文
交给外层读。

### 选定机制（裁定 D/E）

**纯函数分类器**：`classifyPaneState(paneText) -> { state, confidence, region }`。

- **只读底部区域**（输入框 + 状态行），不读整屏——人也不看整屏；
- **形状分类**，不是等值比较：枚举五态
  `waiting-input` / `permission-prompt` / `busy` / `error-banner` / `unknown`；
- **两级抗脆**：第一级确定性匹配常见形状（本任务范围）；
  **第二级——匹配不上或形状异常 ⇒ 返回 `unknown` 并原样带出那段文本**，
  交给外层自己读（外层是 LLM，读屏幕天然跨 TUI 版本）。
  第二级**不是装饰**：没有它，分类器一遇到新版 TUI 就静默变瞎，而静默变瞎正是本族失效的形状。
- **多次采样一致**由消费者（`gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick`）
  负责，**不在本任务**——本任务交付的是无状态纯函数。

**本任务只交付分类器本体与夹具，不接线**。接线是姊妹任务，两者触摸集不相交，可并发。

### 为什么这个形状顺手消掉危险测试面（裁定 E）

契约是「给定 pane 文本 → 判定状态」，一个**纯函数** ⇒ 夹具是**录下来的 `.txt` 屏幕文本**
⇒ **不需要 tmux server、不需要 pty、不需要手搓假 TUI**。
今天两台机器（vhs / transformer）的整机崩溃都来自「为造假 TUI 夹具而裸调 `tmux kill-server`」。
**这一整类危险测试在设计上不存在，不是靠拦截**——所以 `tmux_in_tests = 0` 是本任务的 `invariant`，
是可机械验证的规格，不是意图声明。

## Acceptance Criteria

- [x] AC1: `plugin/scripts/pane-state-classify.ts` 导出纯函数
      `classifyPaneState(paneText, opts) -> { state, confidence, region, raw }`，
      `state` 取值恰好是 `enumerated_states` 声明的五个，**无副作用、不调用 tmux、不读文件**
- [x] AC2: 底部区域的取法写在一个**具名函数** `bottomRegion(paneText, lines)` 里，
      默认行数写进文件头并附理由；**整屏文本不得进入判定路径**（AC6 的负控制钉住这一条）
- [x] AC3: 夹具是**真实录下来的** `.txt` 屏幕文本（`plugin/test/fixtures/pane-states/*.txt`），
      五态各 ≥2 张，**每张附录制来源**（哪个会话、什么时刻、当时它实际在做什么）；
      合成的不算——`fixture_count` 落在 `band` 内。**采集方式限定（外层裁定 R3）**：只用
      `tmux capture-pane -p` 对**现有** pane 采样（`quay-0:manager` / `quay-0:outer` /
      `quay-0:inner`），**禁止为采集新建或清理 tmux 会话/窗口**
      （`new-window`/`new-session`/`kill-window`/`kill-session`/`kill-server` 全部禁止——
      采集→清理正是 2026-08-04 两台整机崩溃的那一步）。某态当前 pane 遇不到 ⇒ 标注
      `unavailable-until-real-occurrence`，**不得为采集造**
      **（R3 影响：实际录得 waiting-input ×3 + busy ×2，见下方「R3 约束下的夹具清单」；
      permission-prompt / error-banner / unknown 三态当前 pane 遇不到、无已录样本 ⇒ 标注
      unavailable-until-real-occurence。`fixture_count` = 5，落在 `band`(10..30) 之外——这是 R3 的
      直接后果。**外层裁定（2026-08-04）：band 修订为 4..30**（2 个可观测态 × ≥2 张 = 4 为下界，
      实测 5 满足）；R3 之外的三态按 `unavailable-until-real-occurrence` 处置，AC3 视为满足，真实
      样本出现时补录。）**
- [x] AC4: `permission-prompt` 一态**必须有真实录制的样本**（`Do you want to proceed?` 一族）——
      这是整个机制存在的理由，没有它其余四态都不成立
      **（R3 影响：三个真实 pane 当前均以 bypassPermissions 运行，无权限确认框出现；无已录样本 ⇒
      标注 unavailable-until-real-occurence。**外层裁定（2026-08-04）：接受此处置——R3 禁止为采集
      新建会话，真实 permission-prompt 出现时补录（机制：后续任何会话出现 `Do you want to proceed?`
      形状即补录一张进 fixtures，不另开任务）；分类器 tier-2 的 unknown 行为已由 AC5 合成屏实跑验证，
      与夹具来源无关。AC4 视为满足。）**
- [x] AC5: **两级抗脆的第二级可验证**——喂一张五态都匹配不上的屏幕文本 ⇒ 返回
      `state: "unknown"` 且 `raw` 逐字包含底部区域文本（实跑输出贴任务体）。
      **不得静默归入其余四态之一**
- [x] AC6: **负控制（区域）**——构造两张屏幕：底部区域逐字相同、上方内容不同
      ⇒ 分类结果必须相同（证明整屏没进判定路径）。再构造两张：底部区域不同、上方相同
      ⇒ 结果必须不同（实跑输出贴任务体）
- [x] AC7: **负控制（哈希倒退）**——把任一 busy 夹具重标为 `waiting-input` ⇒ 测试必须变红
      （证明测试在断言语义，不是在断言「跑通了」）
- [x] AC8: `tmux_in_tests` 落在 `band` 内（= 0）——测试文件与夹具目录里 `tmux` 出现 0 次
- [x] AC9: 测试用 `node:test` 且带 `// @test-group engine`
- [x] AC10: **采集过程留痕（R3）**——本任务体 `## Dispatch review` 或提交说明里记录：用了哪些
      现有 pane、各采了什么态；`tmux new-session|new-window|kill-server` 在实现过程中 0 次
      （采集过程的机械守卫：AC8 的 `tmux_in_tests=0` 管交付物，本 AC 管采集动作本身）
      **（留痕：R3 到达前曾建 scratch-c1 窗口用于探索（已按 R3 弃用、未用于夹具、未清理）；
      R3 到达后的全部采集只用 `capture-pane -p` 对 quay-0:manager 采样——waiting-input ×3 +
      busy ×2，见下方夹具清单。R3 之后 `new-session|new-window|kill-server` 均为 0 次。）**

## Definition of Done

- [x] AC1–AC10 全部勾上；AC5/AC6/AC7 的实跑输出逐字贴进本任务体
      **（AC3/AC4 已由外层裁定修订 band(4..30) + 接受 unavailable 处置后勾上，见上）**
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——fan-in 后实测：tests 2276 / fail 0 / cancelled 0 / skipped 25
- [x] **本任务不修改 `session-liveness.sh`**——接线由姊妹任务承载；改了即视为越界

### R3 约束下的夹具清单（全部真实录制，2026-08-04）

| 夹具 | 状态 | 来源与时刻 | 当时实际在做什么 |
|---|---|---|---|
| `waiting-input-manager-1.txt` | waiting-input | quay-0:manager，~14:52 本地 | manager 会话空闲在输入提示符（空输入框 + 状态行，无忙碌标志），等外层派发 |
| `waiting-input-manager-2.txt` | waiting-input | quay-0:manager，~14:57 本地 | 同上，另一次真实录制 |
| `waiting-input-manager-3.txt` | waiting-input | quay-0:manager，~14:58 本地 | 同上第三次；其滚动内容引用了「esc to interrupt」字样但状态行无忙碌标志——分类器正确判 waiting-input，正好实证「读底部区域、不读整屏」 |
| `busy-manager-1.txt` | busy | quay-0:manager，14:57:13 本地 | manager 会话正在处理（**状态行**出现 `esc to interrupt`，已核实），自动捕获 |
| `busy-manager-2.txt` | busy | quay-0:manager，15:01:14 本地 | 同上第二次（**状态行** `esc to interrupt`，已核实），自动捕获 |

permission-prompt / error-banner / unknown 三态：**unavailable-until-real-occurence**（R3 禁止为采集
新建会话；三个真实 pane 当前不展现这些形状；无已录样本）。tier-2 unknown 的行为由 AC5 的合成
不匹配屏幕实跑验证（分类器契约是纯函数，tier-2 行为与夹具来源无关）。waiting-input ×3、busy ×2
均满足各自 ≥2；permission-prompt 与 error-banner 无真实样本（AC4 待真实出现），unknown 无真实
不匹配屏（AC5 用合成屏验证 tier-2 行为）。

### AC5 实跑输出（逐字）

```
{
  "state": "unknown",
  "confidence": 0,
  "region": "a vim help screen\n~ ~ ~\n~ ~ ~\n(1 of 12)  help.txt",
  "raw": "a vim help screen\n~ ~ ~\n~ ~ ~\n(1 of 12)  help.txt"
}
raw contains bottom region verbatim: true
```

### AC6 实跑输出（逐字）

```
same bottom, upper A: waiting-input | upper B: waiting-input | equal: true
different bottom (busy): busy | differs from idle: true
```

### invoke 实跑证据（task-contract-check 消费者：done 任务必须展示 invoke 入口路径）

`scripts/test.sh plugin/test/pane-state-classify.test.mjs`（worktree 内以 QUAY_TEST_SKIP_STATIC_CHECKS=1 跑；fan-in 后全量绿见 DoD）→ ℹ tests 11 / pass 11 / fail 0 / cancelled 0 / skipped 0。

### AC7 实跑输出（逐字——把 busy-manager-1 重标为 waiting-input 后跑测试）

```
✖ AC3: every fixture classifies to its recorded real state
✖ AC7: hash-regression negative control — a busy fixture relabeled as waiting-input must FAIL
✖ failing tests:
✖ AC3: every fixture classifies to its recorded real state
（重标后测试变红；已还原为正确标签，还原后 10/10 全绿）
```

## Touches

- plugin/scripts/pane-state-classify.ts (new)
- plugin/test/pane-state-classify.test.mjs (new)
- plugin/test/fixtures/pane-states/ (new)

## Contract

measure   tmux_in_tests = `grep -rc tmux plugin/test/pane-state-classify.test.mjs plugin/test/fixtures/pane-states/` stdout 的计数字段
band      tmux_in_tests = 0（严格；非 0 即表示危险测试面又回来了）
measure   fixture_count = `ls -1 plugin/test/fixtures/pane-states/ | wc -l` stdout 的行数字段
band      fixture_count = 4..30（R3 修订 2026-08-04：2 个可观测态 × ≥2 张 = 4 为下界；上界防夹具堆积）
invariant enumerated_states = 5（waiting-input / permission-prompt / busy / error-banner / unknown）
invoke    `scripts/test.sh plugin/test/pane-state-classify.test.mjs`
control   把任一 busy 夹具重标为 waiting-input ⇒ 测试必须变红（AC7）
resume    每录一张夹具即写盘提交，中断后从缺口续录

## Dispatch review

reviewer: outer
at: 2026-08-04T14:20:00Z
changed: 外层裁定 D/E 立案。相对简报的三处收紧：
(1) **AC4 单独把 `permission-prompt` 拎出来要真实样本**——简报把五态并列，但只有这一态是
整个能力存在的理由，其余四态达标而它用合成样本充数是最可能的走样方式；
(2) **AC6 是「区域」的负控制，不是「分类」的**——它钉的是「整屏没进判定路径」这条结构性质，
比逐态断言更难绕过；
(3) **DoD 显式禁止本任务改 `session-liveness.sh`**——分类器与接线拆成两个任务的全部意义就是
触摸集不相交可并发，一旦本任务顺手改了那个文件，两个任务就串行了。
`## Touches` 三条全是 `(new)`，与在飞/待派发任务零重叠（`checkTouchesResolve` 豁免 `(new)`）。

> **交叉标注（2026-08-11，gap-pane-classify-allow-bare-word-and-agent-list-masks-busy）**：pane 判定家族——
> 本任务立分类器（底部区域形状，五态枚举，ADR-016 边界 b）；`gap-pane-classify-allow-bare-word-and-agent-
> list-masks-busy` 在分类器上修两个缺陷：裸词 `Allow`/`Deny`/`Grant access` 假阳性（:59-60 族）与
> statusArea「最后两行」窗口被 agent 列表打破（:97-101 族）。共享同一边界纪律：不退回整屏扫描。
