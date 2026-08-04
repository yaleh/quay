# 外层裁定 — 2026-08-04 第三次重启简报 §1 的六条（A–F）

裁定人：外层（`quay-0:outer`）。输入：`orchestration/outer-brief-2026-08-04-third-restart.md`。
每条裁定后面附**外层自己独立跑出来的那条命令**——不采信简报的自述（简报是管理者写的，不是证据）。

---

## 裁定 A — 收紧 ADR-016 clause 1 的 carve-out（就地修订，不新开 ADR）

**核实**：`adr/ADR-016-...md` clause 1 原文确为
> `capture-pane` is only a coarse "idle / ready-for-input" check + a settle.

「coarse」没有定义边界：既不说**允许判哪些状态**，也不说**允许用屏幕的哪一部分**。
于是两处实现各自把它读成「整屏等值/哈希比较」：

```
$ grep -n 'capture-pane' plugin/scripts/session-liveness.sh
612:      raw=$(tmux capture-pane -p -t "$target" 2>/dev/null)      # → mask_pane → md5，整屏
```
`plugin/scripts/send-keys-verified.sh` 同形（整屏 md5 前后比对）。

**裁定**：**修订 ADR-016，不删除、不新开 ADR**——决定没变，只是把边界写死。修订必须写明三条：

1. 允许用屏幕判定的状态是**枚举的**（等待输入 / 权限确认框 / 忙 / 错误横幅 / 未知），不是开放集；
2. 允许取屏幕的**哪一部分**：底部区域（输入框 + 状态行），不是整屏；
3. **永远不含整屏等值/哈希比较**——`md5(capture-pane)` 这一族在 ADR 层被禁止，无论是否先做 mask。

**理由**：简报说得对——「哈希失败 ≠ 屏幕不行，是取错了屏幕的函数」。原 carve-out 的含糊**不是**
被违反了，而是**允许了**这两个实现；所以该修的是 ADR，不是只修实现。
`enforcement:` 字段同步：从 `N/A — 操作纪律` 改为指向第 3 条的机械检查（新 ADR 条款要有执行者）。

→ 立案 `gap-adr-016-carve-out-permits-the-whole-screen-hash-it-was-meant-to-forbid`

---

## 裁定 B — 缺口确认，且比简报说的更硬：触发器是**生产环境里的死代码**

简报说 `ruling-required` 「没有任何机械触发」。**外层核实后修正这句话**：触发器**已经写好了**，
但从未在任何生产调用里被打开。

```
$ grep -n 'ruling-required' plugin/scripts/inner-blocked-signal.ts | head -3
525: * Detect the composite "stopped waiting for a ruling" trace (reason "ruling-required", AC1/AC2):
560:    reason: "ruling-required",
680:        reason: "ruling-required",

$ grep -n -- '--transcript\|INNER_BLOCKED_TRANSCRIPT' plugin/loop/*.md plugin/skills/*/SKILL.md
（零命中）
```

`inner-blocked-signal.ts:634` 自己写着：`--transcript <path>` ... **omitted ⇒ no-op**。
而 `fast-mode-loop-tick.md:233` 的生产调用是裸的 `--detect-stop`，**没有 `--transcript`**。
本 tick 实跑复证：

```
$ node ... plugin/scripts/inner-blocked-signal.ts --detect-stop
detect-stop: STOP CONDITION — task-over-90m (auto-block written)
```
只有 `task-over-90m`，`ruling-required` 一条都没评估。

**裁定**：缺口成立，但**处置不是「把 `--transcript` 接上」**。理由是第二条核实——
即便接上，它的判据是「transcript 心跳陈旧 **≥30 分钟** AND 有任务 in-progress AND 工作树干净」：

- **≥30 分钟**违反裁定 C 的「几分钟」预算；
- 它是**形状代理**（该任务自己在 AC1 里如实写明了这一点），**看不到弹框**——
  而弹框正是裁定 D 指出的「最要紧的那一类」；
- 今晚复现的那次（内层说「等套件 #12 通知」然后坐着不动）**三个子条件不同时成立**，接上也不会响。

⇒ **`ruling-required` 的触发源改挂到裁定 D 的屏幕观察者**，transcript 降为旁证。
`--transcript` 那条路径**不删**（它对「会话真的死了」仍有效），但不再是 `ruling-required` 的主判据。

**附带裁定**：`gap-the-one-condition-the-channel-was-built-for-still-has-no-trigger` 是
`status: done` 而洞仍在——这是本仓记过四次的「造了检测机制 → 它正确报警 → 警报无人处理」的第五次
变体（这次是「机制造好了 → 没接线 → 任务照样 done」）。**不回退它的 done**（它交付的检测函数是实的，
回退会让已证明的东西变含糊），改为由新任务承载接线，与
`gap-session-liveness-stage-2-screen-signal-and-payload` 当初的处置同一先例。

→ 立案 `gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick`

---

## 裁定 C — 能力与判据（接受，并把「几分钟」写成数字）

能力：**一个 Claude Code 会话需要它的用户输入/参与时，它外层的那个会话能及时观察到。**

**判据（外层把「几分钟」定量化，否则不可判）**：从「屏幕上出现需要用户参与的形状」到
「共享事件文件里出现对应事件」的**端到端延迟 ≤ 5 分钟**（p100，不是均值）。
轮询周期 60s + 「多次采样一致」需 3 次 ⇒ 结构上界 ~3 分钟，5 分钟留 40% 余量。

**明确不在范围内**：送达确认（「我发出去的那条指令对方收到没有」）。它与本条**不是同一个问题**，
优先级更低（裁定 F），且被本条顺带覆盖——见 F。

---

## 裁定 D — 屏幕为主、transcript 为辅（采纳，两级抗脆）

采纳简报的机制，并钉死两点边界：

- **主判据 = 屏幕的底部区域 + 形状分类 + 多次采样一致**。不是整屏、不是哈希。
- **transcript 降为廉价旁证**，只用来区分「空闲是因为干完了」还是「空闲是因为压根没启动」。
- **两级抗脆**：第一级确定性匹配常见形状（纯函数，便宜）；**匹配不上或形状异常 ⇒ 把那段文本原样
  交给外层自己读**（外层是 LLM，读屏幕天然跨 TUI 版本）。第二级**不是兜底装饰，是规格的一部分**——
  没有它，分类器一遇到新版 TUI 就静默变瞎，而静默变瞎正是本族失效的形状。

**外层追加的一条（简报没写，本 tick 核实出来的）**：`session-liveness.sh` **已经有了 `mask_pane`**
（剥离 token 计数行 / spinner 行），但**判据仍是「mask 之后的整屏 md5」**。
所以那个姊妹任务 `gap-session-liveness-hashes-the-token-counter-as-if-it-were-work`（`status: todo`）
**不应再按「继续加剥离规则」实现**——那是在错误的函数上继续打补丁。它改为**消费本条的分类器**。
剥离规则做到「加规则就能对」的地步本身就是信号：**输入脏是因为取了整屏**。

→ 立案 `gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable`（纯函数分类器）

---

## 裁定 E — 不用 PreToolUse hook（采纳人的否决，并把它变成设计后果）

**采纳**：不引入 PreToolUse hook。理由人已给出——会弄脏使用 quay 的项目的环境。

**外层补一条它为什么不必要**：分类器的契约是「给定 pane 文本 → 判定状态」，**一个纯函数**。
于是它的夹具是**录下来的 `.txt` 屏幕文本** ⇒ 不需要 tmux server、不需要 pty、不需要手搓假 TUI
⇒ **今天两次整机崩溃的那一整类危险测试在设计上不存在，不是靠拦截**。

**因此这条是可机械验证的，不是意图声明**：分类器的测试文件里 **`tmux` 出现次数必须为 0**。
写进新任务的 `## Contract` 的 `invariant`。

**兜底（L0 —— A–F 之外的第七条，待落地，不是既成事实）**：`env -u TMUX` **没有**进入启动命令
（`restart-plan-2026-08-04-third.md` AC4：重启不是引入未验证变量的地方）。当前 outer/inner 的
`TMUX` 是**设着**的，符合该计划 §1。L0 由外层走正常流程落地（判据 + 测试 + 负控制）：
`tmux` 隔离不能依赖调用方记得 `unset TMUX`（实测 `$TMUX` 压过 `TMUX_TMPDIR`，`-S`/`-L` 压过 `$TMUX`）。
E 的纯函数分类器消掉测试里的危险面；L0 兜住临时探索那条路径。

---

## 裁定 F — 关掉 `gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted`

**裁定：`status: superseded`，不修。** 三条理由，第三条最硬：

1. 人已裁定输入确认本身重要性不高——输错了外层照样有机会观察到（裁定 C/D 的观察者覆盖）；
2. 它要防的「消息躺在输入框没发出去」**恰好是屏幕上看得见的形状**，被裁定 D 顺带覆盖，
   不需要单独造一套哈希启发式；
3. **它的 AC1 本身就是杀手命令的来源**——原文要求
   「a fixture reproduces this incident's shape … the CURRENT script is shown reporting a false
   delivered」。造这张夹具就要造一个假的 TUI，**两台机器（vhs / transformer）都死在这一条上**
   （子代理临时写的 shell 裸调 `tmux kill-server` 误杀真实默认服务端）。
   **不能把一个已知会杀掉整机的 AC 留在就绪队列里。**

**worktree 处置**：`quay-worktrees/sendkeys` 有 251 行未提交改动（`send-keys-verified.sh` +62、
测试 +211）。**先提交到它自己的分支保全，再移除 worktree**——不 discard（人可能想看那 211 行测试
里有没有可回收的东西），但**分支不合并**。

---

## 核实记录（2026-08-04 定稿 tick，外层独立复证，非简报自述）

| 声明 | 复证命令/位置 | 结果 |
|---|---|---|
| ADR-016 clause 1 原文 | `adr/ADR-016-...md:36`「`capture-pane` is only a coarse "idle / ready-for-input" check + a settle.」 | 逐字成立 |
| session-liveness.sh 判据 | `plugin/scripts/session-liveness.sh:612` `raw=$(tmux capture-pane -p -t "$target")` → `mask_pane` → `md5sum` | 成立（注：该文件已含 `esc to interrupt` 存在性判忙；哈希仍是 content_changed 一路的判据） |
| `--transcript` omitted ⇒ no-op | `plugin/scripts/inner-blocked-signal.ts:634-637` | 成立 |
| 生产调用不带 `--transcript` | `plugin/loop/fast-mode-loop-tick.md:233` 裸 `--detect-stop` | 成立 |
| `ruling-required` 写入点存在但从未被打开 | `inner-blocked-signal.ts:560/680` 两处 reason | 成立 |
| 90 分钟停止条件命中 | 本 tick `--detect-stop` 输出 `task-over-90m`（retirestate，204.6m） | 成立 |
| 简报 §2（已订正） | 本会话 TMUX 设着 ⇒ 订正后的「未用 env -u TMUX」成立 | 成立 |

## 本裁定对在飞状态的直接后果

| 对象 | 裁定 |
|---|---|
| `gap-send-keys-verified-hash-check-...` | `superseded`（F）。worktree 提交保全后移除，分支不合并 |
| `gap-retire-inner-state-one-observer-targets-by-parameter` | **暂缓（park）**，退回 `ready`。531 行未提交改动先提交到分支保全 |
| `gap-session-liveness-hashes-the-token-counter-...` | **改范围**：不再加剥离规则，改为消费 D 的分类器 |

**为什么 park retirestate（这是一条会被质疑的裁定，理由写在这里）**：它退役 `inner-state.sh` 的
依据是「内层主动申报卡住」这个信号从未响过——而**裁定 D 造的正是那个信号的替代品**。
清理应当跟在架构后面，不是前面。它的 worktree 已改 `session-liveness.test.mjs` 与两份 tick 文档，
与 D 的观察者任务**触摸重叠**，并发或任一顺序都要 rebase；那就按正确的顺序 rebase。
**531 行的沉没成本不构成理由**——外层的价值恰恰来自没有那份沉没成本。
