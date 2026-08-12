# 外层编排 loop tick 指令

> ## ⇒ 先读执行核：[`orchestration/orchestrator-tick-core.md`](orchestrator-tick-core.md)（79 行）
>
> **本文件是理由档案(1095 行),不是执行清单。** 每轮实际要跑的动作、必产出、硬约束、边界
> 都在执行核里;本文件提供每一条的实测与代价。
>
> **这一行本身就是一条判据的产物**(`ADR-009` 第二次修订 + `AC30(b)` 三层统一架构 SPEC,
> 2026-08-09):**凡是必须跨压缩存活的东西,必须落在锚所指向的文件里。** 执行核建于 05:5xZ,
> 但直到 06:5xZ 之前它**不在锚的可达范围内**——只靠「我记得它存在」维持,而那种存在形式的
> 寿命上界是下一次压缩(实证:workflow 实践死在 08-08 07:49:05 的压缩边界上,同一次压缩里
> cron 照常触发,差别只在于 cron 是锚指向文件;外层 1b 收尾例程 8.5h 停摆的窗口内也有一个
> 压缩边界 08-08 23:59:16)。**加这一行,是把执行核从记忆搬进锚的可达范围。**

> **模板参数（gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them）**：本文件是随
> quay 插件包分发的外层 tick 文档（模板在 `plugin/loop/orchestrator-loop-tick.md`，内层模板是
> `plugin/loop/fast-mode-loop-tick.md`）。
> `quay-init --loop` **原样铺出**（字节相同，不做文本替换）——目标项目的值（`repo_root` /
> `test_command` / `tmux_session`）集中在一个配置文件 `.quay/config.yml` 的 `loop:` 节里，
> 脚本与本 tick 在**运行时读取**它们，不在落地时烘焙。铺到目标项目时的位置：
> `orchestration/orchestrator-loop-tick.md`（外层）/ `docs/analysis/fast-mode-loop-tick.md`（内层）。
> 模板正文本体不含任何具体仓库路径、测试命令或 tmux 会话字面量。
>
> **目标项目值引用约定**：`REPO_ROOT` / `TEST_COMMAND` / `TMUX_SESSION` / `FORK_BASELINE` /
> `MERGE_TARGET` 五个名字在本文件中指 `.quay/config.yml` `loop:` 节的对应值
> （`repo_root` / `test_command` / `tmux_session` / `fork_baseline` / `merge_target`）。
> 执行含这些名字的命令前，先读该文件把值代入——不要凭记忆。
>
> **工作分支模型（branch cutover，2026-08-06）**：本副本是 quay 自身消费的外层 tick
> （`orchestration/orchestrator-loop-tick.md`），工作分支按外层裁定直接改为**字面量两线**：
> `FORK_BASELINE` = develop（已验证基线）、`MERGE_TARGET` = integration（待验证汇入点）——见
> `.quay/config.yml` `loop:` 节的 `fork_baseline` / `merge_target`。所有含分支操作的命令代入这两个值，
> 不要字面写死。共享模板 `plugin/loop/orchestrator-loop-tick.md` 的工作分支名**可配置**（默认单线，
> 供未做 cutover 的下游经升级通道消费），本副本是 quay 自己的两线落地——两者角色分工见任务体 AC5。
> **切分声明（AC38，2026-08-12 已执行）**：本文件是 quay 自身消费的**本层实例状态**（工作分支两线、
> integration 作 checkout、项目列表、tmux 布局、本实验各 AC 的进度与既有裁定）；**产品行为正本**在
> `plugin/loop/orchestrator-loop-tick.md`（外层这个角色该怎么做的通用机制，随 `quay-init --loop` 原样铺到
> 目标项目即本路径）。**产品行为进 plugin / 本层状态留 orchestration**——与 manager 层已按同判据切分
> （产品模板 322 行 vs quay 状态 1647 行；本对切分后 1066/1269，共同 532 行——共享的是命令块与脚本名，
> 各自独有可解释为产品行为 / 本层实例状态）。冷启动 skill 与 tick 核引用同一批行为文件（AC3）。
> **⚠️ 2026-08-09 结构性修正（外层的 WORKING CHECKOUT 切到 integration）**：此前的故障链是「立项/记账
> 提交落 develop ⇒ 不变式被破（develop-only 累积）⇒ ff 前需并回 integration ⇒ 验证期 tip 被记账推走 ⇒
> 绿过期」——冻结窗口只是手段不是机制。长效解法：**外层工作 checkout = integration**，develop 只经 ff
> （batch-merge）前进。`git checkout integration`（如需临时 worktree 已占用 integration，先 `git worktree
> remove` 它）。此后外层的一切提交（立项/记账/红窗修复）都落 integration；develop 保持 ff-only、无
> develop-only 提交、不变式（`is-ancestor develop integration`）持久成立；验证跑在 integration（= ff
> 目标），绿与 ff 树天然对齐。含分支操作的命令仍代入 `fork_baseline`/`merge_target` 两个值（develop /
> integration），只是「当前 checkout 是哪个」变了。

**启动方式**（在编排会话，即本会话或 `/clear` 后的新会话）：按下方「冷启动」步骤操作——**循环驱动
只有一个**：步骤 4 的 `CronCreate`（20 分钟 cron）。Monitor 是事件监测，不是驱动。两个都做完再进
tick 步骤。不要在这之外再起 `/loop`（固定间隔 `/loop` 底层就是同一个 cron，再起一个等于双触发，
见 §4a）。

---

## 冷启动（新会话 / `/clear` 后的空上下文）

**按顺序做完这 7 步再进 tick 步骤。** 不要凭记忆——你没有记忆。

```bash
cd "$REPO_ROOT"    # REPO_ROOT 见 .quay/config.yml loop.repo_root（或 git rev-parse --show-toplevel）
```

**1. 读机制与目标**（顺序有意）

| 文件 | 得到什么 |
|---|---|
| 本文件其余部分 | 外层的职责、授权边界、tick 步骤 |
| `orchestration/exp6-phase1-sustained-unattended-operation.md` | 目标、20 条 AC、DoD、四项已定决策 |
| `orchestration/tick-log.md` | **历史 tick 与动作类型累计分布**——退化判据的唯一来源 |
| `orchestration/escalations.md` | 已攒给人、尚未处理的非常规项 |
| `docs/analysis/batch2-queue-state.md` | 内层自报的队列状态（**可能是旧快照，以 git 为准**） |
| `adr/ADR-021-adaptive-budget-self-regulating-methodology.md` | 四项原则 |

**2. 建立实况**（以实测为准，不以上面任何文件的自述为准）

```bash
git log --oneline -10 && git status --short
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json
node --experimental-strip-types plugin/scripts/task-status-drift-check.ts
```

**3. 自检内层会话（三态处理，gap-outer-self-checks-and-creates-inner-session）——不是「找到」，是「确保」**

内层不再是「找到就行」——冷启动第 3 步改为**自检**：inner 窗口在不在、claude 进程活不活、
transcript 有没有真实 user 消息（被驱动过）。三态判定与处理（判据用可信的：窗口按名寻址、
进程看 `/proc` cmdline、user 消息看 transcript——不用 pane 哈希假阳、不用 heartbeat 冻结假警）：

| 状态 | 判定 | 处理 |
|---|---|---|
| **健康** | inner 窗口存在 **且** claude 进程存在 **且** transcript 有真实 user 消息 | **什么都不做**（权限边界——已存在的 inner 可能是 manager 建的，外层无权判断/重建/改参数），直接进入正常驱动流程 |
| **空壳** | inner 窗口存在 **且** claude 进程存在 **但** transcript 无真实 user 消息（被拉起但未驱动，11:40 watchdog 形态） | **驱动而非重建**——不丢可能已有的上下文，接手 manager 预建的会话 |
| **缺失** | inner 窗口不存在 **或** 无 claude 进程 | 调 `quay-topology.sh` 创建**两窗口**拓扑（outer+inner，manager 跨项目不属于项目拓扑）+ 起 inner claude（checked-in launch 命令），然后驱动 inner |

```bash
bash plugin/scripts/inner-session-check.sh --json   # 三态自检：{state: healthy|empty-shell|missing, window, process, transcript, transcriptFresh}
```

按 `state` 分派：

- **`healthy`** ⇒ 什么都不做——不重建、不重启、不改启动参数（权限边界，负控制：健康 inner 不被动）。
  继续步骤 4（重建 cron）。
- **`empty-shell`** ⇒ **驱动** inner（**默认原生 SendMessage：ListAgents 寻址 inner、busy 直投、身份平台标注**；原生不可用时回退 send-keys-reliable，transcript 验证送达，不假设成功）：
  ```bash
  bash plugin/scripts/send-keys-reliable.sh "$TMUX_SESSION:inner" "执行 $REPO_ROOT/docs/analysis/fast-mode-loop-tick.md 中的 tick 指令" <inner-transcript>
  ```
- **`missing`** ⇒ 调**两窗口**工厂创建拓扑，验证在位，然后同样驱动 inner：
  ```bash
  bash plugin/scripts/quay-topology.sh --session "$TMUX_SESSION"          # 两窗口工厂（outer+inner，幂等；manager 跨项目，不建）
  bash plugin/scripts/topology-check.sh --session "$TMUX_SESSION" --json   # 验证：ok:true = 两窗口各有 claude 进程
  ```
  创建后 **INNER-DRIVEN 验证送达**：原生 SendMessage 通道以 send 结果/回执确认；回退通道看
  transcript 出现真实 user 消息（send-keys-reliable 的 `transcript-delivery-check.ts` 判据），不假设成功。
  **工厂失败/验证不过 ⇒ 升级给人**（step 5），不静默继续——建不出来就进不了正常驱动流程。

**transcript 路径解析**（inner-session-check.sh）：`--transcript` 显式 > `SESSION_TRANSCRIPTS` 配置
> `orchestration/session-liveness.env` > 发现（`$HOME/.claude/projects/<root-slug>/` 里最晚修改、
且不是外层自己的 jsonl，标 `source=discovery`）。找不到 transcript = fresh = 空壳判据（驱动不重建）。
**发现路径是启发式**：`healthy` 判定若来自 `source=discovery`，先确认所选 transcript 确实是**当前**
inner 会话的（例如 inner claude 进程启动时刻之后的），否则按空壳驱动——驱动不重建，代价有界。

**4. 重建 cron —— 唯一的循环驱动，这一步最容易漏**

**整个冷启动只有这一个循环驱动机制**：tick 靠它每 20 分钟触发一次。`CronCreate` 的任务是
**会话内的**——但**「会话内」指的是【进程】，不是【上下文】**（2026-08-08 13:3xZ 实测更正，见下）。
**因此这一步是「先列、再决定」，不是「无条件重建」**：

```
CronList     # ← 必须先列。/clear 之后旧 cron 仍在，直接建就是双触发（§4a 明令禁止的那个）
# 恰好一个本层 tick 的 cron  ⇒ 什么都不做
# 多于一个                  ⇒ CronDelete 到只剩一个（哨兵清扫：按 prompt 内容找，绝不靠记住的 ID）
# 一个都没有                ⇒ 才建：
CronCreate(cron="*/20 * * * *", prompt="执行 orchestrator-loop-tick.md 中的 tick 指令", recurring=true)
CronList     # 建完再列一次确认——没列出的 cron 不是报警，是静默空转
```

> **⚠️ 2026-08-08 13:3xZ 实测更正：原文「会话一结束就没了。新会话必须重建」是错的，
> 且它与本文件 §4a 自相矛盾。** 本节标题覆盖的正是 `/clear`，而**实测对本层连发两次 `/clear`
> 后 `CronList` 仍返回 `c0ac1607 — Every 20 minutes (recurring)`** ⇒ **`/clear` 清上下文、
> 换 transcript session id，但不杀 cron（进程没退）。** 照原文无条件 `CronCreate`，
> 造出的正是 §4a 禁止的双触发。**真正杀掉 cron 的是进程退出**（崩溃 / OOM / 关窗），
> 那时 `CronList` 返回空——**所以判据只有一个：先列，按结果决定建不建。**
>
> **同次实测暴露的第二个、更阴的失效**：`/clear` **保留驱动、更换 transcript session id**
> ⇒ **循环照跑，观测瞎掉**——任何把 transcript 路径写死的监视器从此静默读空。
> **「进程死了」有 `SESSION-GONE`，「id 换了」什么都不报。**
> ⇒ 监视器按 `customTitle`（如 `"quay-outer"`）解析当前 transcript，**不写死 session id**。

**为什么选它（判据：无人值守时最不容易静默停摆）**：

- **可查验**：`CronList` 能列出它，装完能机械判定「恰好一个触发源在跑」——跑
  `bash plugin/scripts/loop-driver-check.sh`，必须报 `LIVE`。
- **固定间隔，无需每 tick 自排下一程**：建好就每 20 分钟自动触发，一次 tick 中断不会断掉整条链。
  自排程（动态 `/loop`，不带间隔）恰恰相反——每次 tick 结束都要记得排下一程，任何中断就静默断链，
  而且没有任何列出工具，无法在需要它之前知道它是否还活着。
- **全流程同一个拼写**：冷启动 skill（`plugin/skills/cold-start/SKILL.md`）用的也是 `CronCreate`，
  文档与 skill 之间没有第二种拼写。

**不要**在这之外再起 `/loop` 或任何别的驱动——固定间隔 `/loop` 底层就是同一个 cron 机制，再起一个
等于双触发（详见 §4a）。

**4a. `/loop` 不是驱动器——不要在这里另起一个**

主推进信号是后台 agent 的完成通知；本文件（外层）的**循环驱动只有一个**：步骤 4 的 `CronCreate`。
`/loop` 不在这里充当驱动，**不要照旧习惯在步骤 4 之外再起一个**：

- **固定间隔 `/loop`（带数字间隔的形式）底层就是 `CronCreate`**——同一个机制、同一种列表。步骤 4
  已经建了 20 分钟 cron，再起一个就是**双触发**（两个 tick 同时跑，竞争共享检出）。
- **动态 `/loop`（不带间隔）走自排程**——没有任何列出工具，且每次 tick 结束都要记得排下一程，任何
  中断就静默断链。对一个专门用来在上下文丢失后兜底的机制，不可查验等于不可信——你无法在需要它之前
  知道它是否还活着。

**今天有现成的证据（缺的不是驱动，是冷启动没做）**：2026-08-02 16:14Z 内层被 `/clear`，新会话只有
5 行上下文，而它当时没有运行中的循环，恢复全靠外层手工简报。缺的是步骤 4 没做——cron 没重建——不是
缺第二个驱动。

**确认恰好一个触发源**：冷启动后跑

```bash
bash plugin/scripts/loop-driver-check.sh
```

必须报 `LIVE`。报 `DOUBLE-TRIGGER` = 有人多装了一个驱动（多半是照旧文档多起了一个 loop）——停下来
处理；报 `STALLED` = 一个都没有——循环不会 tick，回步骤 4 重建 cron。

**4b. 重挂 Monitor —— 和 cron 一样是会话内的**

`Monitor` 与 `CronCreate` 同样活不过会话。新会话必须重挂，否则外层退回纯 20 分钟轮询。
观测只有一个工具（SPEC-one-observer-two-surfaces.md）：`session-liveness.sh`（经
`session-liveness-mount.sh` 挂载入口挂上——2026-08-06 起无锁，谁挂的谁拥有自己的 stdout 事件流）：

```
Monitor({command: "$REPO_ROOT/plugin/scripts/session-liveness-mount.sh",   # REPO_ROOT 见 .quay/config.yml loop.repo_root
         description: "会话存活/活跃（SESSION-GONE/BACK/IDLE/RESUMED/REPO-STALL/OVERDUE/HEARTBEAT）",
         persistent: true, timeout_ms: 3600000})
```

**4b2. 重挂套件状态触发者（红窗自动执行者，`gap-red-window-has-no-automatic-executor`）——状态变化即触发，不等 cron**

红窗规则（`gap-full-suite-belongs-to-outer-background-above-3-min` AC4）的 ROUND 2 事故证明「存在≠
生效」：套件转红 30 分钟无人处置，因为 RED/GREEN-RUNNING 两个分支都只靠 `*/20` cron 或人驱动。本条
给它补**执行者层**——状态变化（state=red / state=running）即转成动作（通知外层 / 驱动 inner 派发）。
**它是事件监测（同 session-liveness），不是新调度源**——节奏仍唯一（步骤 4 的 cron）；它只把
「cron 才检查状态」改成「状态变化即触发」：

```
Monitor({command: "node --no-warnings --experimental-strip-types $REPO_ROOT/plugin/scripts/suite-state-trigger.ts --monitor",   # REPO_ROOT 见 .quay/config.yml loop.repo_root
         description: "套件状态自动触发（SUITE-RED → 立即 RED 处置；SUITE-RUNNING → 乐观派发执行者）",
         persistent: true, timeout_ms: 3600000})
```

事件流里出现 `SUITE-RED` ⇒ **立即**进入步骤 1b「红窗分诊」（不等下一次 cron——本轮的
「红着无人处置 30 分钟」场景即被消灭）；出现 `SUITE-RUNNING` ⇒ 按「RUNNING 乐观派发执行者」驱动
inner 照常派发。`SUITE-GREEN` / `SUITE-STATUS` 是平静基线，无需处置。挂载遗漏的代价同
session-liveness：退回纯 20 分钟轮询（正是本轮事故形态）——所以 4c 的验证纪律对两者同样成立：
跑 `bash plugin/scripts/monitor-mount-check.sh --json` 之外，还要确认套件触发者的 Monitor 已挂
（`pgrep -af 'suite-state-trigger.ts --monitor'`，有 node 活进程即可；按步骤 0 的自匹配纪律
排除 pgrep 自己那一行——发起查询的命令行里含同样字符串）。

**4c. 重挂后立即验证挂上了 —— 两判据自检**

重挂 Monitor 后立刻跑一次检查器，不靠「看起来挂上了」：

```bash
bash plugin/scripts/monitor-mount-check.sh --json
```

两判据缺一不可：`mounted=true`（挂上了）、`targetRoot` 等于本仓根（挂对了，`targetOk=true`）。
2026-08-06 起 `delivered`（AC9 的共享事件文件判据）随共享事件文件移除——事件送达由挂载方自己的
Monitor 事件流承担（谁挂的谁拥有），不是检查器能读的跨观察者文件。
任何一条不满足都按冷启动失败处理，不要直接进 tick。
`gap-nothing-checks-whether-the-monitor-is-mounted-or-aimed-right`：挂没挂/挂哪个仓库
两条判据是**一条不是一条**——只查第一条会漏掉「进程活着、目标错」那次（管理者 18 小时挂错目标）。

**5. 核对前置条件**

`.halt` 是否还在、套件是否绿（读 `.quay/full-suite-state.json` 的 `state`——`green` 绿、`red` 需按
步骤 1b「红窗分诊」处理、缺文件 = 外层还没跑）、内层 loop 是否已启动。见目标任务的 AC1–AC6。

**6. 补记一次 tick**

冷启动本身算一次 tick，动作类型通常是 `no-action`（只是恢复）或 `unblock`（恢复时发现内层停摆）。
在 `tick-log.md` 记一行，注明「冷启动恢复」。

**7. 进入正常 tick 步骤**

## 冷启动 skill 背景档案（AC41 判据 2 — 背景从 plugin/skills/cold-start/SKILL.md 搬入）

`plugin/skills/cold-start/SKILL.md` 只留动作(Steps)与可判定清单；本段是被它引用的背景/判据正文。
冷启动 skill 引用本文件(外层 tick)与内层 tick 文档作为**同一批行为文件**。tick 执行核同样引用这一批，
各自指向同层 loop-tick 文档：外层 `orchestration/orchestrator-loop-tick.md`、内层
`docs/analysis/fast-mode-loop-tick.md`、管理者 `orchestration/manager-loop-tick.md`。
（注：本文件是 quay 的 laid-down 副本——外层/内层 tick 的产品模板在 `plugin/loop/` 下。）

### nohup 为什么不行（Monitor tool 判据）

A `nohup bash …session-liveness.sh > log &` process and a Monitor-tool process look **identical in
`ps`** (same argv). The difference is where stdout goes: the nohup process writes to a file and
**nobody is notified**; a Monitor-tool process has every stdout line turned into a **session
notification**. The criterion for "the loop is up" is therefore **"an event was delivered to this
session"**, not "a process is running". A cold start whose monitor is nohup'd looks installed but is
silently dead — worse than not installed, because it looks installed. **⇒ Never use nohup.** If you
find yourself writing `nohup` or `&` to background a monitor, **STOP — that is the anti-pattern the
cold-start skill exists to prevent.**

### 铺什么验什么（gate 判据 — 冷启动门是 DERIVED laydown set 绿，不是全量套件绿）

**What gates a cold start.** The gate is: **all scripts in the DERIVED laydown set are green** — NOT
"the whole quay suite is green" (`scripts/test.sh` full-suite / 全量). A cold start only lays down the
derived laydown set (the `plugin/scripts/*` the shipped skill + loop docs reference), so a suite
failure UNRELATED to that set must NOT block it (与铺设集无关的失败不再无限期阻塞冷启动); a failure
INSIDE the set MUST block (铺什么验什么). The 2026-08-05 wait was correct: `session-liveness.sh` +
`session-liveness-mount.sh` are both derived members, so laying then would have shipped the M3
busy/idle regression into the target project.

**Mechanical derivation (no new mechanism).** The set is derived by grepping the shipped docs — the
same derivation quay-init.sh's `derive_loop_scripts()` step (a) uses. Never hand-edit the set; re-run
the grep:

```bash
grep -ohE 'plugin/scripts/[a-zA-Z0-9._-]+' <root>/plugin/skills/*/SKILL.md <root>/plugin/loop/*.md
```

**Run the gate:**

```bash
bash <root>/plugin/scripts/laydown-set-check.sh   # → `laydown_set_green: green|red`
```

`red` (a missing / non-parsing member, or a member's OWN test failing — the M3 class of logic
regression a syntax check cannot see) blocks the cold start; `green` means the exact scripts this cold
start will lay down are verifiably working. This is the full-suite gate's SCOPED-ED down cousin: it
runs exactly the laid-down set's tests, nothing else — an unrelated red in the whole suite does not
hold up the cold start. The check **never falls back to the whole suite**: if 0 test files resolve
from the derived set it fails closed (red) — a silent "nothing checked" green is not an acceptable gate.

### bare-metal 会话引导背景

**From bare metal to a session is ONE command (`gap-no-formalized-bare-metal-session-bootstrap`).**
The cold-start skill runs inside an already-existing outer session — the step BEFORE that (bare
metal → a tmux window layout with a Claude Code process live in each pane) is the formalized product
`plugin/scripts/session-bootstrap.sh <root> <layout>`:

```bash
bash <root>/plugin/scripts/session-bootstrap.sh <root> inner/outer        # project topology
bash <root>/plugin/scripts/session-bootstrap.sh <root> manager/inner/outer # full quay-0-shaped layout
```

It creates each named window (idempotent — re-runs leave live windows alone), launches each role's
Claude Code process via the checked-in launcher `quay-launch.sh` (the skill's internal
implementation, never a user-facing invocation), verifies each process is actually alive (the same
`/proc` process-detection `session-liveness.sh` uses), and exits non-zero naming the failing window
if any window cannot be confirmed live (fail-closed). After it returns, the cold-start skill's
"inner session reachable" precondition is already satisfied — the same command a cold start used to
follow ("hand-build the session, then one command") is now truly one command.

### launch config 与 ghost-suggestion 背景

**Launch config is checked-in, not remembered.** The correct per-role launch command lives in
`<root>/.claude/launch.settings.json` (settings-schema keys + `_launchSpec` for flag-only params) and
is materialized by the skill-internal launcher `quay-launch.sh`. If a session must be (re)started
during the cold-start skill, the skill handles the launch itself — the user/agent never names the
launcher script and never hand-types a shell one-liner from memory
(`gap-crystallize-launch-config-into-checked-in-settings-file`; `quay-launch.sh` is the skill's inner
implementation, not a user-facing deliverable). To verify the materialized command without starting
anything, the skill runs the launcher in dry-run mode (`--dry-run`); the `--bare` flag produces a
minimal one-shot verification session (not long-lived).

**Ghost-suggestion elimination is REQUIRED, not optional** (`gap-ghost-suggestion-eliminated-at-source-
prompt-suggestions-false`, 人 2026-08-05 裁定): the launch config MUST carry `--prompt-suggestions false`
(as `_launchSpec.promptSuggestions=false`, translated by `quay-launch.sh`) AND
`CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` (as the `env` key) — both routes, for every role. A fresh
session launched without it shows gray ghost-suggestion text in the input box that the reliable-send /
pane classifier can misread as a submitted action (fault 6/7). The cold-start skill MUST confirm the
materialized command contains the flag (the launcher's `--dry-run` output must include
`--prompt-suggestions false`).

### non-goals

- **Not a one-keypress button.** The command count is install (1–2) + init (1) + this skill (1);
  the inner start is INSIDE the cold-start skill, not a separate human step.
- **Not a shell script.** The monitor is mounted through the Monitor tool so its events reach a
  session; a script that backgrounds processes delivers to nobody.

## 定位

双层持续开发的**外层**。内层是开发会话（tmux `$TMUX_SESSION`，见 `.quay/config.yml` `loop.tmux_session`），它执行任务；外层观察它、消解它的停摆、
必要时纠偏，并把真正需要人的事攒起来。

**外层存在的唯一理由：消费内层的停止条件。** 内层撞到「合并冲突 / 套件红 / 审查 2 轮后仍 REFUTED /
超 90 分钟 / needs-human 积压 ≥3」就停下等人——外层就是那个「人」的常规部分。内层仍然停，只是停的
时长从「到人回来」变成「到下一个 20 分钟 tick」。

## 授权边界（已与人约定，不可自行放宽）

| 外层可以 | 外层不可以 |
|---|---|
| 解阻塞（回退、bisect、判断发现真伪、分诊积压） | **直接改代码** |
| 重排队列、补建任务、纠正错误前提 | 改变方向或范围 |
| 写 `orchestration/`、队列状态文件、`tasks/*.md`（见下） | 写 `packages/` `plugin/` `experiments/` 下的**实现与测试** |
| 给内层下指令 | 替内层执行【任务】（**2026-08-10 收窄，理由=单一写入者/共享树**：禁令防【共享树】双写入者；外层可在**自己的 worktree** 里执行基础设施动作 suite/修红/merge，隔离已消除冲突——但替内层执行**任务**仍禁止，放开仅限基础设施动作且必须在自己的 worktree 内） |

**`tasks/` 的归属（2026-08-02 消歧）**：本表原先同时写着「可以补建任务」和「不可以写 `tasks/`」，
自相矛盾。裁定：**`tasks/*.md` 是队列，不是代码——外层可以写**（建任务、改状态、调优先级）。
单一写入者纪律要保护的是工作树里的实现代码，不是队列本身。

唯一约束：**写 `tasks/` 前先确认没有在飞任务把 `tasks/` 列进它的 `## Touches`**，否则会和内层
撞车（`grep -l '^## Touches' -A20` 查在飞任务，或直接看遥测 `inProgress`）。撞上就改为「记进队列
状态文件 + 指示内层建」。

**外层不直接改代码**——它下指令，内层执行。理由：保持单一写入者。本会话 2026-08-02 有过一次
`git stash` 事故，正是外层动了内层正在工作的树。

人在，但不需要被打扰：**常规自行处理，非常规攒起来**等人有空看。

## Tick 步骤

### 0. 三个已经害过我们的失败模式

这三个都发生过，都表现为「内层看起来在工作」，都不会自己暴露：

**a) 内层输入框里的字大概率不是待提交的指令，是 ghost suggestion。** 2026-08-02，外层看到内层
`✻ Cogitated for 41m 47s` + 输入框里有一行字，判定为「指令掉了 Enter」——错的。那是 Claude Code
自动生成的输入建议（CLAUDE.md 早已警告过 gray ghost-suggestions），内层其实是**问完问题正常结束
了回合，在等人答复**。

两个后果：

- **停摆分类不要靠输入框内容猜。** 内层结束回合等答复，就是外层存在的理由本身（步骤 3），
  不是故障。看最后一段 `⏺` 输出问了什么，直接答。
- **发指令前必须 `C-u`**，因为输入框里可能有 ghost 文本。CLAUDE.md 的可靠发法是
  **`C-u` → 文本 → `Enter` 三次分开调用**（合并会丢 Enter）。发完 `capture-pane` 确认出现了新的
  `⏺` 输出——未确认送达的指令等于没发。

**b) 判断内层是否停摆要看「底部区域状态行」，不是看最后一行。**

```bash
tmux capture-pane -p -t "$TMUX_SESSION" | tail -3 | grep -q 'esc to interrupt' && echo busy || echo idle
```

> ⚠️ **2026-08-08 更正（gap-adr016-md5-ban-violated-in-shipped-md-and-checker-scope-gap）**：
> 上一版这里是整屏哈希 `md5(capture-pane)` 两次相同 = 空闲——正是 ADR-016
> `## Amendment 2026-08-04` 明令禁止、`adr016-screen-use-check.ts` 机械拦截的
> `md5(capture-pane)` 形态，且它是【指令】不是散文，外层照做即违规。**正确形态**只取
> pane 底部 3 行、只判 busy/idle 两个枚举态（底部区域 + 枚举态，Amendment 允许）。注意别写成
> `-S -3`——`-S` 是【起始行】不是行数，负值进历史缓冲，取的是「历史往前 3 行 → 屏幕底部」
> 一大段，取不到状态行。

**c) 外层的独立核实会和内层抢 CPU——这是机制不是散文。** 步骤 1 写着「只读」，但跑一次全量套件是
**数分钟的满载**，足以把内层 `select-preflight` 那种 timeout 余量只有 8% 的测试压成 flaky。
规则改为**机械执行**：跑全量套件前调用资源闸
`bash plugin/scripts/resource-gate.sh --for full-suite`（`gap-no-resource-awareness-heavy-ops-run-blind`）——
退出码非 0 = WAIT，**此时不要跑全量**，改为核实便宜的声称（文件存在、grep 计数、单文件测试）。
gate 读 `/proc/pressure/cpu` `some avg10`（结构信号，不是 load 代理）并输出数字与限值，把
「现在能不能跑」变成一个可核对的数字。内层在飞时只核实便宜的声称；**全量只串行跑、跑完再叫醒内层**。

**d) cron 只在本会话空闲时触发。** 外层正在和人对话时，`*/20` 的 tick 不会 fire。人机对话期间外层
事实上是停的——所以**每次对话结束前手动补一次 tick**，不要假设 cron 会接上。

**e) 外层挂的 Monitor 可能没挂上、挂错目标、或属于上一个会话。** 2026-08-03 两个反证都是
「不报错的降级」，而且都不是被信号发现的，是人问起来才发现的：archguard 外层**从来没挂上**
（照着 tick 文档做，Monitor 那一步没发生，没有任何东西报错）；管理者自己**挂了 18 小时挂在错的
目标上**（两个监视器都在看内层，而该看的是三个外层）。**一个盯错东西的 monitor 和一个正确的
monitor，从外面看一模一样。**

所以每个 tick 用一条命令自检，不靠人判断：

```bash
bash plugin/scripts/monitor-mount-check.sh --json
```

两判据：`mounted`（挂没挂）/ `targetRoot` 是否等于本仓根（挂的哪个仓库副本，`targetOk`）。
2026-08-06 起 `delivered` 随共享事件文件移除——事件送达由挂载方自己的 Monitor 流承担。
挂载判据是 argv 前两 token 精确等于 `bash <绝对路径>`，
**不是子串**——`pgrep -f` 会匹配到发起查询的命令自己（本节上文记的就是这个坑，检查器已绕开）。

### 0b. 事件式监测（Monitor）——补 tick 之间的盲区

20 分钟 tick 的盲区是**内层停摆后的等待时间**。观测只有一个工具：`session-liveness.sh`
（SPEC-one-observer-two-surfaces.md，gap-retire-inner-state-one-observer-targets-by-parameter）。
`inner-state.sh` 已退役——它不观测会话（`tmux` 命中 0），它的招牌信号 `.quay/inner-blocked.json`
在三个项目里从未产生，包括我们撞上过的唯一一次真实事故（那 68 分钟也没有它）。挂成
`persistent` Monitor，事件经观察者自己的 stdout 流送达挂载方（2026-08-06 起共享事件文件已移除；
详细事件表见 0b2）：

| 事件 | 含义 |
|---|---|
| `SESSION-GONE` / `SESSION-BACK` | 会话进程消失 / 恢复 |
| `REPO-STALL` | 仓库 ≥`STALL_MIN` 分钟无新提交（未暂停的项目）——仓库信号，不是会话面 |
| `SESSION-OVERDUE` | 心跳源 mtime ≥`OVERDUE_MIN`（未暂停的项目）——会话可能已死 |
| `SESSION-IDLE` / `SESSION-RESUMED` | 相邻两轮 pane 哈希相同=空闲；在转换后一个轮询周期内报出 |

**它买什么、不买什么**（2026-08-02 实测得出，别搞混）：

- **买的是死时间**。它把「内层停下等裁定」到「外层发现」的延迟从最多 20 分钟压到 ~1 分钟
- **不买纠偏质量**。同期四次 `correct` 没有一次是延迟受限的——它们受限于视角，见步骤 2 的
  「外层的价值来自视角」。**更快的监测不会让外层看得更准**

**遥测信号的两个方向（`fast-mode-telemetry.ts` 实际定义，随 `--report` 铺出；别写反——本仓曾把
`ORPHAN` 定义成「`--task-start` 已写而 `--task-end` 未写」的反方向，而代码从不这样做，靠这条文档差点判错两次）**：

| 信号 | 实际定义（代码为准） | 去向 |
|---|---|---|
| `ORPHAN` | **end without start**（只有 `--task-end`、没有对应的 `--task-start`） | 进 `orphaned[]`，报表可见，不进吞吐 |
| 有始无终 | **start without end** | 进 `inProgress[]`；**只在 90 分钟后以 `OVER90` 露头**，且与「一个真的很慢的任务」同形——信号上不可区分 |

**崩溃遗留（幽灵）**：执行者被杀死后，`--task-end` 永远不会来，任务永久停在 `inProgress`。先用
`node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --reconcile --json` 关闭
「执行者确实不存在」的记录（判据是可观测的：分支已合并 / worktree 不存在 / 进程不存在，**不是时龄**），
关闭后它才离开 `inProgress`、不再触发 `OVER90`。

**代理信号迟早会误报，能换成结构信号就换。** 2026-08-02 一天里五个检测信号误报，五次的根因是同一个：
**测的东西和声称的东西不是一回事**。

| 检测器 | 代理信号（错） | 结构信号（对） |
|---|---|---|
| `RISKY` | 提交消息里有 "revert" 字样 | body 里 git 自己写的 `This reverts commit` |
| `STALLED` | 遥测 `inProgress` 是否为空 | **正在运行的 `node --test` 进程数** |
| 全量套件分类 | 命令文本里提到 `test.sh` | `test.sh` 出现在命令位置（剥离引号内容后） |
| `--clean-stale` 安全性 | 提交数为 0 | 提交数 0 **且**两点 diff 为空 **且** worktree 无未提交改动 |
| 滞留分支告警（步骤 1 的 `--stranded`） | 没有任何检查 → 靠人偶然 `git worktree list` | 三闸（reclaim 已验证）：`merge-base --is-ancestor` → merge-added 文件是否仍在 develop → 分支领先计数；`has-commits`/`merged-then-reverted` 报出，`merged-clean` 不报 |
| `START` | 首次轮询就当作转变 | 首次标 `INIT`，只有真转变才 `START` |

`STALLED` 那条的具体教训：**合并与验证跑不在任务括号内**，遥测 `inProgress` 为空，于是两级判据
退化成 90 秒阈值直接误报——而当时内层正跑着 11 个 `node --test` 进程。数进程比问遥测更直接，
且不依赖内层是否记了计量。

**核实「修好了没有」要看行为或读 diff，不要 grep 关键词。** 2026-08-02 第三次：为核实
`flags-only` 修复是否落地，grep 了 `flags-only` 与 `selected .* files`，两处都命中——**但命中的是
缺陷本身**：`flags-only` 命中脚本头部那句错误的承诺（第 25 行），`selected N files` 命中 `--for-task`
的两条既有错误消息。修复其实根本还没合并。

**根因是结构性的：描述一个缺陷的词，必然出现在这个缺陷自己的文档里。**
**镜像同样成立**（2026-08-03 第六次实证）：核实 `relation-sync` 是否已把 `process.exit(1)` 改掉，
grep 得到 **4 处命中**——**全是注释**，内容正是「为什么 `process.exit(1)` 是错的、已改成
`process.exitCode`」。**修复的说明里必然写着缺陷的名字。** 所以无论查「缺陷还在不在」还是
「修复到位没有」，grep 关键词都会给出反向答案。 所以 grep 这些词找到的是
缺陷，不是修复。判据只能是**行为**（同一调用的测试数是否相等）或**读实际 diff**。

**这条规则也管外层自己的临时诊断，不只管检测器。** 2026-08-02 第六次踩同一个坑，就在 tick 观察里：
用 `pgrep -c -f "$TEST_COMMAND"` 数并发套件（`TEST_COMMAND` 见 `.quay/config.yml` `loop.test_command`），得到 3 且「在上涨」，几乎据此向人报告「内层没执行
串行指示」。实际是 **0 个真进程**——`pgrep -f` 匹配了任何命令行里含该字符串的进程，**包括外层自己
这条 tick 命令的 bash 包装**。同一分钟的 `node --test` 计数 4 也是同样的假象（`comm=node` 实为 0）。

真实情况是负载一路在回落：**16.62 → 12.26 → 7.28 → 4.33**，套件早就在陆续退出。

**Node 进程的 `comm` 是 `node-MainThread`，不是 `node`。** 2026-08-02 查明这是外层一整天进程计数
出错的总根因：`ps -e -o comm= | grep -cx node` **永远返回 0**，而我用它当作「没有东西在跑」的证据
判过停摆。一整天在两个坏方法之间摇摆——`pgrep -f` 匹配命令行散文（多计，把自己的 tick 命令算进去），
`comm=node` 永不匹配（少计到零）。**正确写法**：

```bash
ps -e -o comm= | grep -cx node-MainThread     # 或 pgrep -xc node
cut -d' ' -f1 /proc/loadavg                    # 负载是独立且不会说谎的第二判据
```

**判停摆要两个独立判据同时成立**（进程数为 0 **且** load1 < 1），单靠任一个都被骗过。

**找一个监听中的服务，要按端口不按命令行**（2026-08-03 实证）：
`pgrep -f 'quay.ts serve --host <ip>'` 会匹配到**发起查询的这条命令自己**，
`kill` 于是杀掉外层自己的 shell（exit 144）而目标进程毫发无伤。
正确写法 `ss -ltnp | grep <port>` 取 pid ——**端口不可能属于发起查询的进程**。

**数进程要么用 `comm` 精确匹配，要么显式排除自身**（`grep -v` 掉 `grep`/`ps`/`capture-pane`/
`claude`）。`pgrep -f` 的模糊匹配在一个「命令行里到处写着脚本名」的编排会话里是不可用的。

**新检测器的第一条事件，默认当作待验证，不当作发现。** 2026-08-02 挂了三个检测信号，
**三个的第一次发声都是误报**：

| 检测器 | 首次发声 | 真相 |
|---|---|---|
| `RISKY` | 外层自己一条提交 | 匹配的是提交消息里的 "reverting" 一词，不是提交做了什么 |
| `STALLED` | 内层「已静止」 | 它在等自己派的 subagent，不是在等裁定 |
| `START` | 「在飞任务变为…」 | 挂载时的基线读数，不是转变（已改标 `INIT`） |

三次都是同一个毛病：**信号看起来对，但它测的东西和它声称的东西不是一回事**。所以收到任何
检测器的第一条事件时，先跑一次能证伪它的检查，确认它测的确实是它声称的；确认之前不要据此行动，
也不要写进 tick 记录当作发现。

**已知盲区**：`IDLE` 只是「无在飞任务」的代理，不是内层真的在等裁定。修复类工作（如 M243 抢救）
跑在 `--task-start`/`--task-end` 之外，遥测看不见，此时内层在忙而信号显示 IDLE。真正的信号要内层
主动写——见 [[gap-no-explicit-blocked-signal-from-inner-layer]]。**已部分闭合**（gap-ruling-required-
trigger-is-dead-code-never-wired-into-any-tick）：步骤 1 的 `--detect-stop --pane` 屏幕观察者现在能
从 pane 形状直接看到 `waiting-input` / `permission-prompt`（3 采样一致），不再只靠遥测缺席推断。

### 0b2. 会话存活监视（`session-liveness.sh`）——看会话本身还在不在

**看的是【会话】本身**（进程消失 / 恢复 / 活着但不推进 / 转入空闲），对**任何 Claude Code 会话**
成立，外层与内层通用（原 `outer-liveness.sh`，AC10 泛化改名——名字取窄了，这套逻辑与「外层」
无关）。随 `quay-init --loop` 铺下，会话名在安装时被替换；默认零配置看本项目自己的会话。

| 事件 | 触发 | 信号源 |
|---|---|---|
| `SESSION-GONE` / `SESSION-BACK` | 会话进程消失 / 恢复 | 会话面 |
| `REPO-STALL` | 活着但仓库 ≥`STALL_MIN` 分钟无新提交（未暂停的项目） | **仓库信号，不是会话面**（AC8，原 `SESSION-STALL`） |
| `SESSION-OVERDUE` | 心跳源 mtime ≥`OVERDUE_MIN`（未暂停的项目）——会话可能已死 | 会话面（心跳源=transcript） |
| `SESSION-IDLE` / `SESSION-RESUMED` | 相邻两轮 pane 哈希相同=空闲；**在转换后一个轮询周期内报出** | 会话面 |

**外层挂一个监视器（AC12 已随 inner-state.sh 退役而收口）——它答「会话还在不在」：**

`session-liveness.sh` 看【会话】本身：进程活/死、忙/闲、心跳逾期没有。**内层的心跳是它的会话
transcript**（AC1/AC16，2026-08-03 实测选定）——`.workflow-events/` 每任务只写 1-2 行、任务
进行中完全冻结，不是有效心跳源；transcript 每次工具调用都写（含 subagents 目录）。经
`SESSION_TRANSCRIPTS`（会话 id 或绝对路径）或 `SESSION_HEARTBEATS` 配置；外层心跳是 tick 日志。
**解除停机（删 `.halt`）那一刻重置陈旧度基线**，停泊期间的陈旧不计入解除停机后的
OVERDUE/REPO-STALL（协调方 2026-08-03 样本）。

**四个阈值（AC5，含义与默认值在这里，不只活在脚本注释里）：**

| 阈值 | 默认 | 含义 |
|---|---|---|
| `INTERVAL` | `60` | 轮询周期（秒）。每轮抓一次每个目标的状态；「转换后一个轮询周期内报出」的「及时」颗粒 |
| `STALL_MIN` | `45` | 未暂停的项目超过这么久（分钟）无新提交 = 停滞（`REPO-STALL`，仓库信号） |
| `LOOP_MIN` | `20` | **`SESSION-IDLE` 静默判据的边界**（抑制阈值）：空闲时心跳时距 `< LOOP_MIN` = 刚动过的正常收尾（静默）；`≥ LOOP_MIN` 或未知 = 「空闲了但没动」，报。OVERDUE 文案里的「预期周期」是固定常数 `EXPECTED_CYCLE_MIN`，与它拆开（LOOP_MIN 可设 0，文案不应打「预期周期 0 分钟」） |
| `OVERDUE_MIN` | `30` | 心跳源 mtime 超过这么久（分钟）未更新 = 会话逾期（`SESSION-OVERDUE`）。**AC5（原 AC13）不可自愈类宁可误报：默认 45→30**——阶段一实测 transcript 心跳在长任务中的最大间隙 20.5 分钟，30 分钟早报 15 分钟且仍留 ≥9 分钟余量（漏报代价无界，误报只多一次廉价核查） |

**噪声标定（2026-08-03，管理者 3 个完整周期实测）**：健康循环 = `SESSION-RESUMED`（按周期活动）
→ 干活 → `SESSION-IDLE`（心跳 1 分钟前更新），每 20 分钟一对事件、三项目满载 18 次/小时。
`SESSION-IDLE` 在心跳时距小于 `LOOP_MIN` 时静默——那是正常收尾；`SESSION-RESUMED`
**保留不静默**（它便宜，且是唯一能确认会话还在按期活动的正向信号）。

### 0b3. 层间 tick 间隔检查——量自驱心跳，不量最后活动（人 2026-08-08 10:5xZ 裁定，外层半）

**人的原话**：「manager 和 outer 的 tick 中应当检查【下一层】的最近 tick 记录，并在时间超长时报警。」
manager 查 outer（manager 侧已落地 b8d7746e）；**outer 查 inner（本条，外层半）**。

**为什么此前两层都没有**：读 inner 产出时只读【内容】不问【间隔】——内容在就判「在动」。
今晚代价：inner 自驱心跳 09:31 起零次响应，但外部事件（外层 send-keys / 子代理完成通知）恰好
填补空档，从 transcript 看「一直在动」；管理者与我都据此连判错两轮。

**判读关键：量【自驱心跳】的间隔，不量【最后活动】。**
- 最后活动会被外部事件填满（send-keys、`<task-notification>`）——看起来在动，自己的脉搏早停了。
- **有外部输入时，二者在 transcript 里无法区分**（外层 send 与 inner `/loop 25m` 触发都是
  「执行 fast-mode-loop-tick.md 中的 tick 指令」，字面同形）。
- ⇒ 可机械判的是 **transcript 心跳源 mtime 间隔的下界**：任何活动都没有（含外部事件）超过阈值 =
  **肯定**没自驱。这比「判自驱心跳」保守（宁松勿紧——人裁误报≈秒级、漏报≤20min 空转），
  但不把外部事件当自驱脉搏。

```bash
# 层间 tick 间隔检查（每轮必跑，成本≈0）：inner transcript 心跳源 mtime 间隔
# ⚠️ 目标解析必须验【pid 匹配 inner pane】，不是发现启发式（2026-08-08 11:4x 管理者上游定位：
#    默认目标解析看的是 outer 自己 2989418；发现启发式会挑到 b8dc91a6（manager 会话）——
#    两个都不是 inner 728a4610）。SESSION_TRANSCRIPTS 必须显式写 inner 的 transcript 路径。
INNER_TX=$(grep '^SESSION_TRANSCRIPTS' orchestration/session-liveness.env | head -1 | cut -d= -f2- | tr -d '"' | awk '{print $2}')
[ -z "$INNER_TX" ] && INNER_TX="/home/yale/.claude/projects/-home-yale-work-quay/728a4610-46b5-4c4a-84ea-6ed01667c433.jsonl"
# 取证必须含 pid 断言：该 transcript 的会话 == quay-0:inner 的 pane_pid（不是 alive=1 就算）
INNER_PANE=$(tmux list-panes -t "quay-0:inner" -F '#{pane_pid}' 2>/dev/null)
echo "  inner transcript=${INNER_TX} pane_pid=${INNER_PANE}（取证：查的是 inner 不是 outer/自己）"
age_min=$(( ($(date +%s) - $(stat -c%Y "$INNER_TX")) / 60 ))
echo "  inner 心跳源间隔=${age_min}min  阈值=30min（/loop 1200-1800s 上界）"
[ "$age_min" -gt 30 ] && echo "  ⚠️ ALARM: inner 无任何活动 >30min —— 需驱动它 / 重挂它的 /loop"
```

**阈值 = 该层申报周期的上界，不是 2 倍**（人已裁）：inner = `/loop 25m` 上界 30min
（fast-mode-loop-tick.md:262 的 1200–1800s）。报警后动作归外层机制决定（驱动它 / 重挂 /loop / 只记录）。

### 0c. 派发闸口的清单与留痕：`## Contract` + `## Dispatch review`（外层，gap-dispatch-gate-has-no-checklist-and-no-trace）

外层对派发任务的审查此前是**惯例**——四次介入里两次靠外层碰巧拥有的上下文（`=` 拼写、`duration_ms`
口径），没有清单、没有留痕。现在变成任务创建时写下的、机器能消费的声明，外层在**派发前**消费它：

**派发前对每个候选**，读它的 `## Contract` 块（六个键：`measure`/`band`/`invariant`/`invoke`/`control`/
`resume`；`n/a: <理由>` 合法、留白不是），并跑消费者检查器：

```bash
node --experimental-strip-types plugin/scripts/task-contract-check.ts --root <repo> --json
```

- 五条消费者判定（AC 阈值→measure/band 引用、measure 命令+字段、invoke 反引号命令+done 证据逐字、
  defect→control、键空值）；**读内容不只验存在**，按代码/字段位置匹配
- **报出而不阻断**；违规名单 `docs/analysis/contract-violations.md` 只能变短（新增违规检查器退出 1）
- 这里就是「审查问了什么」的机器承载——**留痕**由任务体的 `## Dispatch review` 段承载
  （`reviewer: outer|none` / `at: <ISO>` / `changed: <逐条|无>`），外层介入后把改了什么写进去；
  `reviewer: none` 合法，但「没过闸」必须是被记录的选择

**不做**：不引入审查 agent、不加轮次、不阻断派发、不恢复 prepare 管线。把「碰巧」变成
「写下来时就被问到」——如果 `## Contract` 没有真读它的消费者，三天后它就是第五段散文。

**外层自己写 `## Contract` 时最常犯的一条（2026-08-03 一小时内踩了三次）**：
第二个 `measure` 写成「**同上命令**输出的 X 字段」——人读得懂，检查器读不懂，
判据是「该行有没有自己的反引号命令」，于是每次都报 `measure-no-command`。
**每个 `measure` 行都要自带完整的反引号命令，哪怕与上一行逐字相同。**
同族的另外两条也一并记住：`control` 折行 ⇒ `contract-line-unknown`（一行一键不可折行）；
`invoke` 命令若含 `<ISO>`/`<file>` 占位符，`invoke-evidence-missing` **在构造上无法满足**
（见 [[gap-contract-ratchet-has-no-runner-and-grew-tenfold-unnoticed]]）——
写 invoke 时用一条能原样跑、也能原样贴回证据的命令。

### 0d. 跨项目暂停/恢复（人 2026-08-03 裁定：用 `.halt`，粗糙可接受）

三个项目（quay / archguard / meta-cc）各自的**唯一开关**就是仓库根的 `.halt`：

```bash
# 暂停
echo "<理由> | 解除条件: <条件> | 外层 <ISO>" > <repo>/.halt
# 恢复
rm <repo>/.halt
```

**为什么够用**（实测 `select-preflight.ts:113`）：

- 文件**内容会被当作暂停理由读出**——开关自带说明，不需要另一个地方记
- **除 ENOENT 外的任何读取失败都 fail-closed**（权限/是目录/I/O 错误 → 判为已暂停）——
  这个形状是从 `gap-halt-sentinel-path-mismatch` 那次真实事故学来的
- 空文件也算暂停

**已知且接受的粗糙之处**：`.halt` 使整个 tick 空转，**fan-in（步骤 2）也停**。
所以在飞任务会算完但不落地，直到解除。**人已裁定接受这一点。**
缓解只有一条纪律：**暂停不是终点，解除条件必须写在 `.halt` 内容里**。

**外层每个 tick 必须报三个项目的 `.halt` 状态**——这是「暂停后忘了」的唯一防线。**统一读法（SPEC
2.8，`gap-spec-p2-halt-three-layer-mechanical-enforcement`）**：`plugin/scripts/halt-check.sh`
是本层（及三层）共用的机械检查点——`--for outer --json` 给出 `halted`（fail-closed）+ 组合判据
`stall`（`无 .halt` **且** 最后提交 >24h ⇒ 未标记停摆）；`--projects <根清单>` 一次读三项目的
`.halt` + 最后提交时距，逐项目报 `stall`。`halted=true` ⇒ 本 tick 空转；`stall=true` ⇒ 升级报出。

```bash
# 每个目标项目的根见各自 .quay/config.yml loop.repo_root（quay 自己的清单：quay/archguard/meta-cc）
# --projects 接受目标项目根的绝对路径（label = basename）；相对名在 --root 下解析。
bash plugin/scripts/halt-check.sh --for outer --json \
  --projects <目标项目根1,目标项目根2,...>
# 人读 fallback（兼容旧式）：
for d in <目标项目根清单>; do
  printf "%-12s %s\n" "$(basename $d)" \
    "$([ -f "$d/.halt" ] && echo "暂停: $(head -c 80 $d/.halt)" || echo 运行中)"
done
```

**优先级（人已裁定）**：**quay 高于 archguard / meta-cc**。
必要时暂停后两者以保本仓推进。**优先级由暂停哪个项目执行，不进跨项目令牌**——
令牌只回答「现在谁能跑重型操作」，不回答「谁更重要」。

### 1. 观察（只读，不动手）

```bash
tmux capture-pane -p -t "$TMUX_SESSION" > .quay/last-pane.txt   # 内层在做什么（全量，喂给 --pane 观察者）
tmux capture-pane -p -t "$TMUX_SESSION" | tail -20              # 人读：底部 20 行
git -C "$REPO_ROOT" log --oneline -10               # 落地了什么
git -C "$REPO_ROOT" status --short                  # 树是否干净
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json
node --experimental-strip-types plugin/scripts/task-status-drift-check.ts
node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --stranded   # stranded worktree branches (gap-stranded-...: silent fail-closed alarm)
cat docs/analysis/batch2-queue-state.md             # 内层自报的队列状态
bash plugin/scripts/supervisor-bus-identity.sh inbox-summary   # 收件箱机械挂载点（gap-supervisor-message-bus-with-identity AC4）：unread 逐条进决策，delivered≠consumed
bash plugin/scripts/manager-tick-log-check.sh --json   # AC5b 行判据(新旧两格式)+缩水棘轮(基线sidecar <log>.baseline，pass 时自动上调)——自动调用者；fail(exit 非 0) 按既有升级通道处置（写 tick-log + 攒给人），不静默
```

**1a. 内层占用率（AC26，强制——量【占用率】不是【新鲜度】）**：每 tick 必须取两个读数并写进本行
tick-log，不是写进任务体：
```bash
# ① in-flight / effective_cap（占用率；cap 来自 cap-from-gate.sh，不用回退 3）
cap=$(bash plugin/scripts/cap-from-gate.sh 2>/dev/null | sed -n 's/^effective_cap=\([0-9]*\)$/\1/p')
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slots --cap "${cap:-5}" --root "$REPO_ROOT" --json
# ② inner 最近一次【自己的报告】（tick-log 里 inner 的最近一条，不是外层观察）
#    ——三个不算：mtime / "transcript is fresh" / "最后活动"（在 inner 有子代理或被上层唤醒时都会为真而占用率为空）
```
**判据（AC26）**：① 该编号步骤产出 `in-flight/effective_cap` 与「inner 最近一次自己的报告」两个读数；
② 每轮 tick-log 行能读到这两个读数的具体值；③ 取的是占用率——mtime/「transcript is fresh」/「最后
活动」一律不算。**槽未满（in-flight < cap）且上游已通 ⇒ 当轮驱动派发，不得记录后结束。**
（人 13:2x 原话：「outer 在处理 tick 时没有看 inner 槽位，也没有看 inner 的 transcript/屏幕，根本没
有了解 inner 的状态，当然也就不会响应 inner 关于任务的需求」——AC26 前置 AC25。）

**`ruling-required` 屏幕观察者（外层是主轮询方，`gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick`）**：
`--transcript` 从未进过任何生产调用，是死代码；现在 `ruling-required` 的主判据是**屏幕形状分类**。
外层按分钟（60s）轮询内层 pane，把捕获喂给 `--detect-stop --pane`。**通用化观测原语
（`gap-ruling-required-only-covers-outer-to-inner-not-manager-to-outer`）**：盯谁（`--target`）、
几个连续采样（`--samples`）、检测到后做什么（`--action` / `--action-command`）都由调用方配置——
内层/外层/管理者各是**一次调用**，不新写代码。`--target inner` 保持旧路径 `.quay/inner-blocked.json`；
其它 target 写 `.quay/blocked-signals/<target>.json`。

外层盯内层（主路径，显式 `--target inner`）：

```bash
tmux capture-pane -p -t "$TMUX_SESSION" > .quay/last-pane.txt && \
node --no-warnings --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --target inner --pane .quay/last-pane.txt
```

管理者盯外层（AC5，一次配置调用——外层等裁定 ⇒ 报出，busy ⇒ 不报）：

```bash
tmux capture-pane -p -t "$OUTER_SESSION" > .quay/last-outer-pane.txt && \
node --no-warnings --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --target outer --pane .quay/last-outer-pane.txt
```

`classifyPaneState` 只读**底部区域**（ADR-016 修订 boundary b——不做整屏哈希），连续 3 次
`waiting-input` / `permission-prompt` ⇒ 自动写 `.quay/inner-blocked.json`（`reason: "ruling-required"`
+ 可行动 `question` + 底部区域 `evidence`）；`busy` / 其它形状 / pane 缺失 / `--clear` 都重置计数
（AC4 双向负控制）。3 采样 × 60s ≈ 3 分钟 ≤ 5 分钟 p100 预算（裁定 C）。stdout 的
`pane_decision=...` 行是判定分支字段（Contract measure 读它）。`--transcript` 保留但只作「会话真的
死了」的旁证（AC3），不是主判据。**在飞 agent 消歧（外层裁定 2026-08-04）**：`waiting-input` 在状态区
有「← N agent」（N>0）/ `general-purpose`，或遥测有在飞任务 bracket 时是**良性空闲**（等自己的后台
agent），不写块——`permission-prompt` 恒为人类等待，不被抑制。

**以 git 和实测为准，不以内层的自述为准。** 内层报告过「AC9 满足」而实测 627s 超限；报告过任务
done 而 DoD 未勾。每个 tick 都要独立核实至少一项它声称完成的事。

**核实优先查 transcript，不要靠重跑。** 重跑一次全量套件是 8 分钟 + 8 路满载，还会把内层的
timeout 余量压成 flaky（步骤 0c）。查 transcript 是秒级、零干扰：

```bash
node plugin/scripts/inner-forensics.mjs verify 全量套件 --since <上次 tick 的 ISO 时刻>
node plugin/scripts/inner-forensics.mjs timecost --since <外层 loop 起点或本班次起点>
```

`verify` 接**类别**（`全量套件` / `范围化测试` / `其它 Bash`，与 `timecost` 同源，不会分歧）
或任意正则。它列出每次调用的时刻、真实耗时、命令——内层声称「跑了全量套件」是真是假，一眼可判。

**零命中不等于「内层没做过」**，它与「查询写错了」不可区分。工具会自己提示这一点：先用类别形式
复核，确认查询正确后零命中才是证据。这条是实测出来的——自检时手写正则得 0 命中，而同一份数据
`timecost` 报 8 次。

`timecost` 给出空转 / 全量套件 / 范围化测试 / 其它 / 生成的分解，是判断「该修延迟还是该修测试」
的唯一依据（见 `orchestration/throughput-decomposition.md`）。**注意窗口**：分析外层的影响必须
`--since` 外层 loop 起点，否则会把 loop 之前的空转算到外层头上。

**`/clear` 会切断历史。** 内层被 `/clear` 后会新建会话文件，工具的 auto-pick 只拿到最新那个。
请求窗口早于它首条记录时，工具会打印 `⚠ … 个更早的会话未被包含`，并给出 `--session <id>`。
**看到那条警告就说明本次输出不是完整窗口**——跨 `/clear` 的分析要逐个会话跑再合并。

### 1b. 异步收尾例程（verification-round closure pass，强制）

**批次边界的真源是记账同步，不是措辞**（`gap-closure-sync-is-the-true-batch-boundary-move-
bookkeeping-to-outer-async`，人 2026-08-05 设计裁定，决定不是建议）：「Close batch-N」三次在 inner
派发历史里、每次收尾后必跟 3 连发、收尾期间零新派发 ⇒ 记账曾是调度的同步点。**inner 只执行 + 派发 +
合并，永远不因记账停顿、也不知道收尾存在；收尾是本层（外层 20-min cron）的异步活。** 本步骤每个
tick 做一次收尾 pass。

**探测用 `taskWorkLanded`，不用 `status: done`**（技术安全已核，无隐藏依赖）：`ready-pool-check.ts`
的 `notYetFlipped` 走 `taskWorkLanded(task.body, repoRoot)`（`ready-pool-check.ts:128-130`），不依赖
`status: done` 字段——所以 inner 的就绪池计算不受收尾异步化影响，外层延迟翻 done 不会导致任务被重复
派发。

**1b 不随红窗停（AC4，`gap-closure-pass-has-no-lag-signal`）**：收尾 pass **不受套件状态门控**——
`state: red` / `reason: failed` 停的是派发与合并推进（见步骤 3/3b），**不停收尾**。红窗期间照常跑
收尾例程（探测 not-yet-flipped → 翻 done → 写轮次记录 → 写 closure-pass 留痕）；「dirty-tree 顾虑」
不构成延后收尾的理由（本层只写 `tasks/` + `.quay/`，不碰代码树）。

**每 tick 执行：**

1. **探测落地未翻任务**：
   ```bash
   node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$REPO_ROOT" --json
   ```
   读 stdout 的 `excluded[]`：`reasons` 含 `not-yet-flipped` 的条目 = 工作已落地（`taskWorkLanded`
   为真）但 `status` 仍 `ready` 的任务——正是 inner 合并完成、等待收尾的任务集。**复用现有实现，
   不新建探测脚本。**
2. **逐个收尾**，对每个 `not-yet-flipped` 任务：
   - **关遥测括号**：先 `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts
     --report --json` 拿 `inProgress[]` 里该 `taskId` 的 `runId`，再
     `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --task-end
     --taskId <id> --runId <r> --outcome done`。若 `inProgress[]` 里找不到该任务的 runId（无对应
     `--task-start`），跳过 `--task-end`，只翻 done。
   - **翻 done**：核对 AC/DoD 是否真实满足（与旧 inner fan-in 同一纪律：勾得上就勾、勾不上写理由
     或留 `ready`），然后写 `tasks/<id>.md` 的 `status: ready → done`（写 `tasks/` 是外层授权范围）。
   - 记进本轮 `closed` 清单。
   - `needs-human` 任务不在 `not-yet-flipped` 里（工作没落地）；其遥测括号由 `--reconcile`（执行者
     已消失）或本层手动 `--task-end --outcome needs-human` 闭合，别让它滞留 `inProgress` 触发 OVER90。
   - **留痕（AC3，`gap-closure-pass-has-no-lag-signal`）**：本轮收尾 pass 结束（含零收尾）后跑
     ```bash
     bash plugin/scripts/closure-lag-check.sh --record --flipped <N>
     ```
     `<N>` = 本轮翻转 done 的任务数（零收尾写 0）——每次执行把**时间戳 + 翻转数**写进
     `.quay/closure-pass-last-run.json`（gitignored 运行时态）。这是 Contract invariant
     `closure_pass_leaves_trace`：消费方（下面这条 lag 检查 / monitor）据它对比间隔——closure-pass
     每次执行都留痕，「执行可验证」不靠外层叙事。
   - **closure-lag 信号（AC2，`gap-closure-pass-has-no-lag-signal`）**：每个 tick 跑
     ```bash
     bash plugin/scripts/closure-lag-check.sh
     ```
     退出非 0（not-yet-flipped 超阈值 **或** closure-pass 超时未跑）⇒ 本 tick **报 WARN/事件**（写进
     tick-log + 本轮报告），不静默；退出 0 ⇒ 静默。信号是**报告不是门控**——不阻塞派发、不阻塞
     tick。「强制步骤静默停跑 8.5h 无机械信号」正是它要消灭的缺陷类（AC23 只验 tick 心跳、不验 tick
     内步骤）。
3. **全量 suite = 外层后台异步验证 gate（非 inner 同步点、非本 tick 阻塞点）**：
   - **后台跑**：全量 suite 由本层起 `plugin/scripts/full-suite-runner.ts`（后台 subagent /
     `run_in_background:true`，不阻塞本 tick、不堵 inner），runner 写 `.quay/full-suite-state.json`
     （`{state: running|green|red, reason?, runner: outer|inner, startedAt, finishedAt, durationMs,
     laneCount}`）并把套件输出 tee 到 `.quay/full-suite.log`。当 `--root` 是被测 worktree / integration
     checkout（如 `/tmp/quay-suite-int`）时**必须**同时传 `--state-dir "$REPO_ROOT/.quay"`（主 repo
     闸门位置）——runner 把 state / log / verification-round 写进主 repo，并镜像回 worktree 自身，使闸门
     （inner 停止条件 + suite-state-trigger，只读主 repo 的相对 `.quay/full-suite-state.json`）看到真实结果
     （`gap-suite-state-split-across-worktree-and-gate`；不传则 state 只落 worktree，闸门永远看不到绿）。
     `reason` 只在 red 时出现：
     `failed`（真实失败——stop-dispatch 信号）或 `aborted`（套件未完成、无正确性结论——**不触发
     停派**，`gap-full-suite-runner-concurrency-default-and-gate` AC5）。**起跑条件**：本轮收尾了 ≥1
     个任务（或自上次完成的全量 suite 起有新的 merge 落地）且当前没有在跑的 suite（`state !=
     running`）且资源闸放行（`bash plugin/scripts/resource-gate.sh --for full-suite`，退出非 0 =
     WAIT，下一 tick 再起）。
   - **早期 RED（AC2）**：runner **一检测到失败立即把 state 标成 red**（非等全套跑完）——缩「变红到
     发现」窗口。判红模式 = 结构化失败形态，**不匹配裸字形**（`gap-full-suite-runner-red-pattern-
     matches-bare-x-vitest-false-red`，archguard TASK-67 实证裸 `✖` 误伤 vitest 假红）：
     node:test/TAP 的 `not ok` / `# fail [1-9]` / `# cancelled [1-9]`、vitest 结构化行
     `❯ <file> (N tests | M failed)` / `Test Files <N> failed`、`FULL-SUITE-EXIT` 非 0，
     以及兜底退出码非 0。`state: red` + `reason: failed` 即 AC4 的 **stop-dispatch
     信号**（inner 读它停派发 + 暂缓 fan-in，见下「红窗分诊」）；`reason: aborted`（被信号杀/spawn
     失败）**不是** stop-dispatch 信号——inner 照常派发，本层按 aborted 语义处置（记录 + 重跑）。
   - **并发旋钮分叉（同一份文档服务两种测试框架）**：runner 的 `--lane-count` 拼接只对
     node:test/test.sh 项目生效（`--test-concurrency=N`，test.sh 的派生默认）；**vitest 项目
     真实文件级并行 flag 是 `--maxWorkers`**（archguard 用 `--maxWorkers=8` 跑通全量 4902 passed），
     **不是** `--test-concurrency`——文档/命令里指导 vitest 项目用 `--test-concurrency` 的地方一律
     改用 `--maxWorkers`（`.quay/config.yml` 的 `loop.test_command` 由各项目自己定，runner 对非
     test.sh 命令不拼接）。
   - **本轮的 suiteGreen**：读 `.quay/full-suite-state.json` 的 `state`——`green` ⇒ true；`running`
     ⇒ true（RUNNING 还没失败，proceed，这正是消除同步点的关键）；`red` ⇒ false；**缺文件 ⇒ true**
     （外层还没跑第一轮，不阻塞）。
3b. **批量合 integration→develop（两线模型 AC3，`gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point`）**：
   **suiteGreen 为 true 时**，跑 `plugin/scripts/integration-batch-merge.sh --root "$REPO_ROOT" --develop develop --integration integration` 把
   已验证的 integration 批量快进合回 develop——**integration 永远是 develop 后代 ⇒ fast-forward 无冲突**
   （develop 只被外层批量合推进，inner 任务只合 integration，见 `fast-mode-loop-tick.md` 步骤 2「两线
   分支模型」）。`integration-batch-merge.sh` 自带：
   - **pre-check**：`git merge-base --is-ancestor develop integration` 非 0（真分歧）⇒ 退出非 0、
     不移动任何 ref、needs-human——**绝不 blind --ours/--theirs**；
   - **measure**：`git merge-base --is-ancestor integration develop` 退出码（band = 0 = integration
     的提交已全部并入 develop）；
   - **invoke**：`git log --oneline develop..integration`（红窗期不空——integration 照常接收，直到本轮
     suiteGreen 才批量合）。
   suiteGreen 为 false（red/aborted/缺 state）⇒ **不跑批量合**——红窗期 integration 照常接收任务合并，
   只是 develop 不推进（结构性消除「红窗必须停派发」；develop 永不从未验证树推进）。**`--dry-run` 先跑**
   核对 pre-check 与 pending 面，再实跑。
4. **写轮次记录**：追加一行到 `.quay/verification-round.jsonl`：
   ```json
   {"round": <N>, "at": "<ISO 来自 date -u>", "suiteGreen": <bool>, "closed": ["<id>", ...]}
   ```
   `N` = 上一条记录 `round` + 1（空文件从 1 起）。`suiteGreen` = 步骤 3 读 `.quay/full-suite-state.json`
   的判绿结果。**inner 的停止条件现在直接读 suite-state**（`fast-mode-loop-tick.md` 步骤 3），本文件
   的轮次记录只是收尾记账，不再被 inner 读取：
   - 缺 suite-state ⇒ inner 不阻塞（外层还没跑第一轮）；
   - `state: red` ⇒ inner 停止派发 + 暂缓 fan-in，本层按「红窗分诊」处置（bisect 定位新引入还是既有；
     定位到本轮 merge 引入就回退该 merge + 回退对应翻 done）。
   **收尾记账的机械判据（AC1/AC2，`gap-verification-round-record-skipped-for-five-closures`——5 轮
   收尾未写 jsonl 的防再犯；`gap-closure-sync-is-the-true-batch-boundary` 落地后的记账完整性补强，
   非重开）**：本轮 `closed` 非空（≥1 收尾）⇒ **追加前**读 `.quay/verification-round.jsonl` 尾部
   round 得 `last`，断言 `N == last+1`；**追加后**再断言尾部 round == `N`（本轮必须前进 1）。任一
   断言失败（尾部 round 没前进）即**本轮 tick 异常**，不得静默跳过——补一行记录或按「红窗分诊」
   needs-human 处置，并把异常记进本轮报告。本轮 `closed` 为空（无收尾）⇒ **不要求写 jsonl**：
   round 不前进、不报警（负控制，AC2）——「无收尾」不是异常。
5. **落盘聚合**：本轮收尾后跑一次
   `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --snapshot`，
   否则被 git 跟踪的聚合文件不反映本批结果。

**每 tick 必报**补一条：本轮收尾几条、`.quay/full-suite-state.json` 最新 `state`（green/red/running）
与 `durationMs`、本轮全量 suite 是否在跑/绿/红。

**套件状态自动触发者（红窗执行者层，`gap-red-window-has-no-automatic-executor`——把 (a) 块的
机制从「被动响应驱动」变成「状态变化即执行」，AC1/AC2/AC4）**：

`suite-state-trigger.ts`（Monitor，冷启动 4b2 挂上）在 `.quay/full-suite-state.json` 的
`state` **变化**时立即发事件（5 秒轮询，≪ cron 的 20 分钟窗口）并记 `.quay/suite-state-events.jsonl`
（append-only；`SUITE-RED.at` 就是 `red_to_triage_ms` 的起点）：

| 状态变化 | 事件 | 本层动作（全部是既有逻辑的执行，不是新决策） |
|---|---|---|
| → `red` + `reason: failed`（或缺失） | `SUITE-RED`（`stopSignal:true`，即确认 stop-dispatch 信号在位） | **立即**进下面的「红窗分诊」（不等下一次 cron；信号 = state=red + failed，(a) 块 AC4 / AC5） |
| → `red` + `reason: aborted` | `SUITE-RED`（`stopSignal:false`——套件未完成、无正确性结论，**不触发停派**） | **记录 + 等重跑**：aborted-red 不是失败结论，外层按 `gap-full-suite-runner-concurrency-default-and-gate` AC5 语义处置（不挡 inner 派发；re-tick 时按起跑条件重起） |
| → `running` | `SUITE-RUNNING` | 「RUNNING 乐观派发执行者」：池有 `dispatchable_disjoint ≥ cap` 就按步骤 4 驱动 inner 照常派发（不待轮——(a) 块 AC4 的乐观行为被实际动用，AC3） |
| → `green` | `SUITE-GREEN` | 平静基线，无处置 |

**触发者是执行者，不是新调度源（AC2/AC4）**：它只做「状态变化 → 事件」的翻译与通知，不做任何分诊/
派发决策；分诊 = 本文件下方既有「红窗分诊」，派发 = inner 出厂文档既有 §4 规则。节奏仍唯一（步骤 4
的 `*/20` cron）；Monitor 是事件监测（同 session-liveness），不驱动任何 tick。事件日志只记事实，
处置逻辑在文档/既有实现里——触发者不引入第二条决策链。冷启动即红（外层 `/clear` 后套件仍红）也触发
`SUITE-RED`（第一眼即红），正是本轮「红着无人处置」形态的兜底。**触发链自检**（Contract invoke）：
`node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --fail-fast-check`
（构造失败 suite ⇒ state=red ⇒ SUITE-RED 事件 ⇒ stopSignal 在位，退出 0 = 链完好）。

**红窗分诊（外层独占，AC4——只停派发不停在飞合并会让红树继续累积，故 RED 失败时 fan-in 一并暂缓）**：
`.quay/full-suite-state.json` 的 `state: red` + `reason: failed`（或缺失）即 **stop-dispatch 信号**
（runner 一检测失败即写 `reason: failed`，AC2/AC5；套件触发者发 `SUITE-RED` 时确认它在位）。`reason:
aborted`（套件未完成、无正确性结论）**不触发停派**——记录 + 按起跑条件重跑，不挡 inner。state 为 red 时：
1. **本层独占分诊**，不把红树丢给 inner：对 red window 内新合并的 merge 二分定位（`git bisect` 或按
   merge 顺序回滚、逐个重跑 `--for-task` 选中集判断肇事者）。
2. **回滚/修复**：定位到某次 merge 引入 → 回退该 merge（+ 回退对应翻 done）；判定为既有失败 →
   建任务（`tasks/` 属本层授权范围）。**state: red 期间本层不自动重启套件**——先分诊，修好才重启。
3. **重启套件**：修复后重新起 `full-suite-runner.ts`（state → running）。
4. **重新 green**：runner 完成且绿 ⇒ state → green。
5. **撤信号**：state 回到 green/running 即撤——inner 恢复派发与 fan-in。信号是存在性状态，无需单独
   删文件。

**阈值决策规则（AC5，门槛机械化）**：测全量套件耗时 `suite_duration` = `.quay/full-suite-state.json`
的 `durationMs`（runner 每次跑完写入，即测量 hook）：
- `suite_duration ≥ 3 分钟` ⇒ **outer 集中后台跑**（当前形态，实测 11-12 分钟量级）；
- `suite_duration < 3 分钟` ⇒ **下放 inner 各任务自己跑**（批概念彻底消除）。
规则在内外层 loop 文档各写一份；每次全量 suite 的 `durationMs` 就是判定输入。

**三块消除批次（AC7）**：本条是 **(a) 套件块**；收尾/记账 **(b) 块** =
`gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async`（已落地）；AC/证据
**(c) 块** = `gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence`
（在队列）。三块合起来，inner 侧只剩「执行 → 合并」，没有任何批次同步点。

### 1c. 重锚转发（re-anchor，强制——机制不是散文）

**给 inner 一个独立于外层措辞的周期锚。** 背景（gap-inner-has-no-periodic-anchor-prose-only-drives-
drift，管理者实测 + 裁定）：inner 的 Cron 调用数 = 0、整晚 59 次驱动全来自外层 send-keys 散文，而
外层自己每 20 分钟被 cron 强制重读出厂文档——**锚点不对称是 inner 行为漂移的结构根**。R2（驱动散文
只带数据不带行为）管散文别越权；本步管「散文之外还有周期锚」。

**机制 = 用本层已有 cron 转发一条固定重锚 prompt，不是给 inner 另建 cron、不是每次现写散文：**

1. **判空闲才转发**：本 tick 已判 inner 空闲才转发（「空闲」按本层既有观察判据：pane 哈希两次相同、
   且遥测无在飞任务 bracket、且不是 `ruling-required` 等待人类裁定——忙时不打扰）。**重锚量上界 =
   空闲时长**，外层 cron（`*/20`）仍是唯一节奏源。
2. **转发固定常量，逐字原样**：转发的文本 = `plugin/scripts/reanchor-prompt.txt` 的内容，
   **逐字原样**（`cat plugin/scripts/reanchor-prompt.txt` 读出来发），**不是本层现写的新段落**。
   送达**默认走原生 SendMessage**（ListAgents 寻址、busy 直投、身份平台标注）;**原生不可用时回退
   既有 send-keys 信道**（`C-u` → 常量文本 → `Enter`，三次分开调用；发完 `capture-pane` 确认
   出现新的 `⏺` 输出——未确认送达的重锚等于没发）。**这不是新增唤醒源**：节奏仍是唯一 `*/20` cron，
   信道只是把固定文本从文件转发出去。
3. **唤醒契约 = 一致性核对，不是调度**（AC2）：重锚 prompt 是「重读出厂 `fast-mode-loop-tick.md` +
   按「状态自检清单」核对当前状态是否符合（在飞 / 就绪池 / 收尾 / 停止条件四查）+ 明确偏差向文档
   自我修正」。它**零派发指令**——机械保证是 grep 断言：
   `grep -n '派发\|排序\|batch\|批' plugin/scripts/reanchor-prompt.txt`（期望 0 命中；
   `plugin/test/reanchor-prompt.test.mjs` 固化）。
4. **偏差修正若需派发，逐字照搬出厂文档自己的派发规则**（文档是唯一规则源）：重锚 prompt 不做新决策
   ——inner 核对发现需补队/派发时，照 `fast-mode-loop-tick.md` 步骤 3.6/4 自己的规则执行，不是重锚
   prompt 给的新指令。
5. **每个 tick 必报**：本轮是否转发重锚、转发时 inner 的空闲判据（哪条观察判据成立）。
6. **重锚有效性 = 语义收敛（自述措辞审计，`gap-reanchor-must-converge-inner-self-reported-vocabulary`）**：
   重锚的有效性以**语义收敛**度量（`reanchor_effectiveness_is_convergence = 1`），不是「重锚发生了」
   ——锚点通道存在 ≠ 词汇收敛（inner 会把历史批措辞内化成自己的组织方式，doc 侧改不到）。每次重锚后
   对 inner 最近自述（commit subject / fan-in 注记 / 收尾汇报）跑
   `node --experimental-strip-types plugin/scripts/self-report-vocab-audit.ts --git-log 15
   --exclude-prefix outer: --window 3 --json`，读 stdout 的 `inner_self_report_vocab` 字段（连续 3 轮
   无 batch 式自述 = 收敛）与 `converged`。「Batch of N fully merged」式门控汇报 = 漂移（被审计标记）；
   verification-round-N / 滚动派发语义 = 合规。**每个 tick 必报**本轮 `inner_self_report_vocab` 与
   收敛状态。

**为什么「空闲才转发」**：重锚是「给 inner 一个周期读出厂文档的机会」，不是催活。inner 忙时
（在飞 agent / 有 bracket）读文档的机会会打断工作；空闲时转发才是在它回合结束时给下一次行为对齐
锚点。**与驱动散文的关系**：驱动散文带任务数据（R2 约束），重锚零数据、只指向文档——两者互补。

### 2. 分类本 tick 的动作

**必须**记录本 tick 属于哪一类——这是判断分层是否退化的唯一依据：

| 类型 | 含义 |
|---|---|
| `no-action` | 内层正常推进，无需介入 |
| `unblock` | 内层停摆，外层消解后恢复 |
| `correct` | 内层在推进但方向/做法有问题，纠偏 |
| `escalate` | 超出授权，攒给人 |

**退化判据**：若多数 tick 是 `correct`，说明内层自主性不足——**该修内层，不是加密外层频率**。
若多数是 `no-action`，分层是对的。

### 外层的价值来自视角，不是来自更聪明（2026-08-02 记录）

跑满一轮后（13 个 tick：`no-action` 4 / `unblock` 3 / `correct` 4 / `escalate` 2），四次 `correct`
的共同点**不是外层想得更深**，而是：

- **外层对「这个任务完成」没有利害关系**。内层在一件事上投入 1 小时后，倾向于接受让它变绿的解释；
  外层没有那个沉没成本
- **决定性的那一步都很便宜**。最大的一次纠偏（负控制也在失败 ⇒ 是 runner 单点故障，不是 14 个
  陈旧 fixture）只需要单独跑一个测试文件、读一遍测试名。**不是难的推理，是没人在赶工时会做的推理**

**因此不要把外层当成「更强的模型来兜底」。** 外层同期也犯了同一类错误：只查 develop 工作树就断定
A2/A5「从未落地」（实际在分支上）、分类器漏掉多行 import、`-E` 模式下写 `\|`。**更强的模型减少
不了这类错误，换个视角才能。**

**这条直接决定了两件事**：（a）`correct` 占比升高时该修内层的判据（上面那条），而不是给外层加
算力；（b）阶段 2 产品化时，双层机制的卖点应写成**独立视角 + 无沉没成本**，而不是「用更大的模型
监督小模型」——后者会把一个结构性优势误说成算力优势。

### 3. 按内层的停摆原因消解

| 内层停在 | 外层做什么 |
|---|---|
| 合并冲突 | 读两边意图，指示内层回退或修复。**不自己 merge** |
| 全量 suite 红（`.quay/full-suite-state.json` `state: red`） | 按步骤 1b「红窗分诊」独占处理：bisect 定位肇事 merge（新引入）或既有失败（建任务）→ 回滚/修复 → 重启套件 → 重新 green → 撤信号 |
| 审查 2 轮仍 REFUTED | 读审查发现，判断是否真实。真实 → 指示缩小范围重做；不实 → 指示记录理由后推进 |
| 任务超 90 分钟 | 判断是任务过大（指示拆分）还是卡住（指示放弃并建任务记录） |
| needs-human 积压 ≥3 | 分诊：真阻塞的攒给人，可继续的指示内层继续 |
| 就绪队列为空 | 从任务库补一批（见步骤 4） |

### 4. 队列补充

队列空时，从 `tasks/` 取下一批。**复用已有机制，不新建**：

- 候选：`status: todo` 或 `ready` 且带 `milestone-candidate` 标签
- 依赖就绪：父任务 done、无未满足前置（`it0-split-or-commit-check.ts` 的 PARENT-DONE-IFF-CHILDREN）
- 并发资格：`checkTouchesPair`（`plugin/scripts/touches-orthogonality-check.ts`）对**所有在飞任务
  和彼此**两两检查，重叠则不同批
- 优先级：阻塞其它任务的优先；`gap-*` 缺陷类优先于 `DIR-*` 新能力
- **跨机在飞（两机协作，`gap-two-machine-collaboration-git-branch-claiming`）**：两机协作时
  （`QUAY_CLAIM_REMOTE` 指向共享裸仓库），**另一台机器的在飞任务 = 共享仓库上存在的 `task/*` 分支**
  ——本层 telemetry 的 `inProgress` 只覆盖本机内层。候选与跨机在飞任务触摸相交（用内层同源
  `plugin/scripts/claim-task.ts` / `checkTouchesPair`）或已被对方认领 ⇒ **不补进队列**（候选的认领状态
  由内层派发前 `claim-task.sh` 机械判定；本层只需在**筛选候选**时把跨机在飞算进「所有在飞任务」）。
  单机（未设置 `QUAY_CLAIM_REMOTE`）⇒ 本条为 no-op，行为不变。

**就绪池维持分两个操作，职责切分**（`gap-targeted-promotion-operation-does-not-exist`，2026-08-08
人裁定：晋级 todo→ready（选择，需要阶段目标）= **外层**；派发 ready→in-flight（机械，只需
touches/cap/停止条件）= **内层**）：

| 操作 | 判据 | 职责 |
|---|---|---|
| **补充 refill**（维持数量） | `pool < floor`（=cap×4） | **内层** tick 步骤 3.6 的机械产品机制 |
| **定向晋级 targeted**（维持对齐） | 阶段目标要它 | **外层**选择（`ready-pool-check.ts --targeted <id>` 机械校验 + `quay promote <id>`） |

**内层不知道阶段目标，这是对的**——它只按机械判据运行（touches/cap/停止条件）。

- **补充 refill（内层机械，`gap-promotion-cadence-is-role-volition-not-product-mechanism`）**：
  晋级节奏与优先级是**产品机制**，由内层 tick `fast-mode-loop-tick.md` 步骤 3.6「就绪池维护」承载——
  内层跑 `plugin/scripts/ready-pool-check.ts`（读 stdout `pool` 字段；`pool < floor`（=cap×4，默认
  12）按脚本推荐的顺序补晋；**判据是 `dispatchable_disjoint ≥ cap`**，floor 只是手段）。本步骤的
  `gap-*` 优先顺序与内层 checker 的定义顺序同源，不再各写一份。把补充结果写进队列状态文件，指示
  内层派发。**外层不再独立维护候选集构造规则**（旧 `outer-phase-goal.md` AC-queue 已降级为引用）。
- **定向晋级 targeted（外层选择，`gap-targeted-promotion-operation-does-not-exist`）**：阶段目标要的
  任务在 todo 里，但 `pool < floor` 这道补充门把它挡在外面（实测 pool=24>floor=20，阶段目标第 2 位的
  任务永远停在 todo）。**定向晋级是独立操作，不受 `pool<floor` 约束**——外层按阶段目标挑出任务后，
  用机械承载校验并提升：
  ```bash
  node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$REPO_ROOT" --targeted <id>
  # 读 stdout `targeted_promotion`：eligible=true ⇒ 机械校验通过（四件套/依赖/触摸可解析），再
  quay promote <id>   # 不受 pool<floor 门约束（AC2 负控制：pool ≥ floor 时仍能发生）
  ```
  外层只决定【挑哪个任务】（阶段目标）；`--targeted` 入口是检查器贡献的机械部分，不含阶段目标输入。
  **2026-08-04 裁定「外层不得提供优先级输入」是超额执行**——`gap-promotion-cadence` 那条只要求「机制
  默认存在、不靠角色自愿」，不该连「外层提供优先级输入」职责一起砍；定向晋级就是这个职责的机制落位
  （交叉标注见 `tasks/gap-promotion-cadence-is-role-volition-not-product-mechanism.md`）。

### 4a. 驱动文本只携带数据，不复述行为（外层裁定 R2 — gap-drive-text-carries-data-not-behavior-outer-inner-handoff，AC2）

给内层下指令时，**驱动文本只携带数据，不复述行为**：

| 随文本过去（数据） | 不随文本过去（行为） |
|---|---|
| 任务 id、裁定结论、依赖事实（如「B 消费 D 的 classifyPaneState」） | 怎么派发（并发/串行）、worktree 位置、纪律清单、并发上限 |
| 需要裁定的问题 + 选项 | 出厂 `fast-mode-loop-tick.md` §4 已供给的一切 |

行为一律由出厂文档供给——出厂文档的行为错了就**改文档**，不用散文覆盖（2026-08-04 实锤：外层把
「按 A→D→B 顺序」写进驱动文本，内层忠实串行 A 6m11s，而出厂文档 §4 明确要求并发 `Agent(run_in_background)`——
常驻并发指令第二次静默丢弃）。

**自检清单（列任务时二选一，缺一即违规）**：

1. **不定顺序**——只给任务 id 与依赖事实，顺序由内层按出厂文档 §4 的并发规则自行决定；或
2. **要定顺序就附 `checkTouchesPair` 实际输出**，且顺序断言与 pair 输出必须在**同一条驱动文本**里
   （AC3 的位置判据）：
   ```text
   A-D: {"disjoint":true,"overlaps":[],"reason":"disjoint file-sets"}   # 机械证据
   ```

若上一 tick 的驱动文本被内层**标注了「与出厂派发契约矛盾」**（内层 fail-safe：以出厂文档为准并标注），
本 tick 先按标注修正文本再继续派发——读内层标注了什么，不无视它。

### 4b. 「在飞」词汇拆分 + 输入框纪律（AC7/AC8 — gap-drive-text-carries-data-not-behavior-outer-inner-handoff）

**「在飞」拆为两种含义，报告/队列状态里分别标注**（AC7，2026-08-04 第三次实锤后加）——混用会让并发
指令看起来已满足：

| 词 | 含义 | 用什么核实 |
|---|---|---|
| **遥测括号在飞** | `--task-start` 已写、`--task-end` 未写 | 遥测 `inProgress[]` / START 事件——START **只证括号在飞，不证 subagent 在飞** |
| **subagent 在飞** | 内层真的起了后台 `Agent(run_in_background)` | **读原始 Agent 工具调用的 `input.run_in_background` 字段**（meta-cc transcript 查询）——唯一可靠判据 |

**外层核实并发必须读原始字段，不得用 START 事件或 pane UI 文字。** 实例（本 tick）：内层唯一 Agent 调用
`run_in_background` 缺失，而 START 事件显示 A|D 双在飞——用错仪器导致静默满足，正是本条目要消灭的形态。
报告/队列状态里分别写「括号在飞 N」「subagent 在飞 M」，不合并成一个「在飞」。

**输入框是待提交缓冲区，不是笔记本（AC8）**：

- **不得把下一步备忘写进自己的输入框。** `*/20` cron 触发时入队的 prompt 会与框内残留文本拼接成乱码
  （2026-08-04 实锤：前一条截断、后一条接在断口上）。下一步备忘一律落队列状态文件或 tick-log。
- 输入框**用完即空**（`C-u`）。
- **每个驱动回合结束由外部观察者（或下次驱动前 `capture-pane` 核对）确认框空**，并接受「框内残留可能
  来自入站回显而非自写备忘」这一事实——**问责对象是「框里有文本」这一状态，不是「谁写的」**（自清/自证
  不可靠：框会被动接收文本，唯一可靠观察者是外部会话）。

### 5. 升级（攒起来，不打扰）

以下**不自行决定**，写进 `orchestration/escalations.md` 等人：

- 同一失败在外层消解后**再次出现**——循环不收敛，不是单点故障
- 需要改变**方向或范围**的决定（不只是解阻塞）
- 外层自己的停止条件触发（见步骤 7）

每条升级要写：现象、外层已尝试什么、为什么超出授权、建议的两个以上选项。

### 6. 学习：更新目标与方法的描述

**每个 tick 都要问**：这一轮看到的东西，是否改变了我们对目标或方法的理解？

若是，更新对应文件并提交：

- `orchestration/exp6-phase1-sustained-unattended-operation.md` —— 目标、AC、DoD 的修正
- `fast-mode-loop-tick.md` —— 内层机制的修正
- 本文件 —— 外层机制的修正

**这是机制的一部分，不是可选项。** 本会话已多次出现「前提错了才发现」（`extractMechanismClaims`
不在拆分决策路径上、416s 上限设在不知成本结构时、readiness check 不查套件）。不写下来，下一个
tick 或 `/clear` 后的会话会重犯。

修正时**必须写明是什么证据推翻了原判断**，不只是改结论。

### 7. 外层自己的停止条件

**连续 3 个 tick 没有推进任何任务状态** → 停止 loop，叫人，附上三次 tick 各自看到了什么。

「推进」的定义：有任务状态变化、有 commit 落地、或有升级项产生。三次都是 `no-action` 且内层无进展
= 系统卡住了，不是在正常工作。

### 8. 写回并重新排程

**时刻必须来自 `date -u`，不许估。** 2026-08-02 审计发现 tick-log 的时间列是手写猜测的，
早期几条偏了近 **4 小时**且是**未来时刻**（写 `~20:10Z` 而真实是 15:46Z），导致时间列非单调、
整列不可信——而它正是退化判据的依据。已按 git 提交时刻整体重建。

同一个错也让一次取证查询查了未来时刻（`--since 17:30Z` 而当时 UTC 是 17:24），得到「窗口内无数据」，
与「选错会话」不可区分。**写任何时刻前先跑 `date -u`。**

- 更新 `orchestration/tick-log.md`：时刻（`date -u '+%H:%MZ'`）、动作类型、做了什么、内层状态快照
- **tick-log 已 untrack + gitignore（人 2026-08-07 16:1x 裁定「outer 和 inner 也进 gitignore」）**：
  **「提交 tick-log」这一步作废**——文件已从索引移除、gitignored，`git add orchestration/tick-log.md`
  是空操作；本 tick 的 commit 只携带其它文件，tick-log 不再进 git。历史 490 个 commit 原样保留
  （不 rebase、不 filter-branch）。**tick-log 从此【允许丢失】**（人明确接受的代价）——不依赖 git
  层的跨机持久化。
- **写完必须验证写进去了——验证读磁盘文件，不读 git。** 2026-08-02 发现 **9 条 tick 记录静默丢失**：
  用 `str.replace(锚点, 新行 + 锚点, 1)` 插入，锚点不匹配时**不报错也不改动**，而随后的
  `git commit` 因为有别的改动照样成功——于是每次都以为记上了。**规则（现在只适用于磁盘文件）**：
  插入前 `assert 锚点 in 文本`，插入后 `tail -3 orchestration/tick-log.md` 断言行数/新行在场；
  文件不存在或行数不足**不算违规**（可丢失，自审读可丢失的那个文件）。丢失的 9 条已按 git
  提交重建。
- **累计分布不要手工加减**——从行数重算。2026-08-02 发现手记的计数已漂到 33 而实际 24 行，
  而这张表正是退化判据的唯一依据。这与内层 tick 文件「全局量（文件数、测试数、组成员数）必须
  运行时计算，不得写成常量」是同一条规则，外层此前没有。重算命令写在该表上方。
- **重新排程由步骤 4 的 `CronCreate` 接管**：它按 `*/20` 固定间隔自动触发，不需要每 tick 手动排
  下一程。（不要用自排程——它没有任何列出工具，且每次 tick 都要自排下一程，任何中断就静默断链。）

## 每个 tick 必报

- 动作类型（`no-action` / `unblock` / `correct` / `escalate`）
- 独立核实了内层的哪一项声称，结果如何
- 内层在飞任务数与各自已运行时长
- 遥测当前：任务数、均耗时、`tasksPerHour`（吞吐 = 收尾数/墙钟窗口小时，带 `windowStart/End/Hours`；
  `serialEquivalentPerHour` = 旧 60/均耗时，与并发无关）
- 异步收尾例程（步骤 1b）：本轮收尾几条、`.quay/full-suite-state.json` 最新 `state`（green/red/running）
  与 `durationMs`、本轮全量 suite 是否在跑/绿/红
- 套件状态触发者（4b2/步骤 1b）：Monitor 是否挂上（`pgrep -af 'suite-state-trigger.ts --monitor'`，
  排除 pgrep 自己那一行）、最近一次 `SUITE-*` 事件（`.quay/suite-state-events.jsonl` 尾部）与时刻
- 累计动作类型分布（退化判据）
- Monitor 两判据（`bash plugin/scripts/monitor-mount-check.sh --json` 的 `mounted` /
  `targetRoot` 是否等于本仓根 / `targetOk`）——挂没挂、挂的哪个仓库
  （2026-08-06 起 `delivered` 随共享事件文件移除；事件送达由挂载方自己的 Monitor 流承担）
- **账本四元组（统一发射器，`gap-spec-p2-quad-tuple-unified-emitter`）**：用统一发射器吐本层
  SPEC §2.5 四元组，不再手工拼。外层声称机制 = 1b 收尾的 `closure-lag-check --record` /
  `verification-round` / `full-suite-runner`——发射器自动读 `.quay/closure-pass-last-run.json` /
  `.quay/verification-round.jsonl` / `.quay/full-suite-state.json` 的最近真实执行时刻；占用率用步骤 1a
  的 `cap-from-gate.sh` + `fast-mode-telemetry --slots`（`--in-flight` / `--cap` 显式覆盖）：
  ```bash
  node --experimental-strip-types plugin/scripts/accounting-emit.ts --layer outer --json
  ```
  输出 `complete:false` 且 `missing` 非空 ⇒ 对应机制未执行/未判定，本 tick 查明并写「已停用/已替代/是缺陷」
  ——缺值 = 未执行，机械报出，不靠自述（AC3/AC4）。

不要只说「内层在跑」——没有这些，分层是否有效无法判定。

## 相关文件

| 文件 | 作用 |
|---|---|
| `orchestration/exp6-phase1-sustained-unattended-operation.md` | 目标、AC、DoD |
| `fast-mode-loop-tick.md` | 内层 tick 指令 |
| `docs/analysis/batch2-queue-state.md` | 队列状态（内层写，外层读+补） |
| `orchestration/escalations.md` | 攒给人的非常规项 |
| `orchestration/tick-log.md` | 每 tick 记录 |
| `.quay/full-suite-state.json` | 外层后台全量 suite 的状态（`{state, reason?, runner, startedAt, finishedAt, durationMs, laneCount}`；**inner 停止条件读它**——`red` + `reason: failed` 即 stop-dispatch 信号，`reason: aborted` 不触发停派；gitignored 运行时态，步骤 1b 由 full-suite-runner 写） |
| `.quay/suite-state-events.jsonl` | 套件状态转变事件日志（append-only；`SUITE-RED/RUNNING/GREEN` + `at` + `stopSignal`；gitignored 运行时态，`suite-state-trigger.ts` 写） |
| `.quay/suite-state-last.json` | 套件状态触发者的记忆文件（上次观测的 state；gitignored 运行时态，`suite-state-trigger.ts` 写——跨重启保持转变检测，冷启动即红也能触发） |
| `.quay/verification-round.jsonl` | 外层异步收尾的轮次记录（`closed` 清单 + `suiteGreen`；gitignored 运行时态，步骤 1b 写） |
| `adr/ADR-021-*.md` | 四项原则 |
| `docs/proposals/exp6-queue-driven-concurrent-executor.md` §0 | 两阶段交付范围 |

## suite-health 三件套（A15/B15）——理由档案（2026-08-10 人裁定，执行核只留动作）

**分档依据**：`durationMs` 分布——1000s 打全部轮 30%，完整轮(>400s)里 49%（中位 734s / p75 1122s / p90 1838s / max 2480s；近 24h 29%）。**所以 1000s 不是异常告警（一半完整轮都超标），是分析触发器**；>1800s(p90) 才升级。

**假阳性方法论（人裁定）**：适当的假阳性可接受，只要有配套的语义分析去检查确认——机械触发要宽（宁多触发），语义判定交 schema agent，假阳性不是缺陷而是「被记录并被解释的」。

**为什么用 workflow（根因）**：执行核已有 closure-lag 三件套（A10 触发/A14 心跳/B2 record）完全可复用，workflow 缺的正是这套——每项必产出都可手写，调不调用纯凭意志。让 suite-health 判词成为**只有 workflow 能产生的必产出**（手写判词不被接受，检查读的是带时间戳的结构化产物是否新鲜），与 closure-lag `--record` 心跳同构。**任务不是机制**：立任务进池子=进队列（gap-pool-quality-semantic-gate AC3 即此，status=ready AC 0/5 卡住）——此条直接入执行核。

**触发分档（宽网，算术写死脚本——ADR-033）**：末轮 `durationMs>1000_000 ∨ state=red ∨ merge 被门拒 ∨ 距上次记录 >K 轮` ⇒ 必跑 suite-health-judge workflow。

**workflow 与 subagent 是互补两侧，不是二选一（manager 2026-08-10 补 A15 缺的另一半，人 2026-08-09T15:27 与 08-05 已分别裁定）**：

- **workflow = 把意志从环里拿掉**（控制流是代码，A 段读数被跑是因为脚本跑它，与该轮注意力无关）。人 2026-08-09T15:27 驳回过「workflow 的价值=扇出」——原话「你还在把 workflow 和扇出扯在一起」「看看你自己的 tick workflow，它的价值绝不止是扇出」。治的是**意志/注意力失效**：机制在场没被调用、读数在场没被判、no-action 零成本。
- **subagent = 独立上下文 + 后台并发**（不堵前台、不烧主会话上下文）。人 2026-08-05T02:28 是**量化门槛裁定**：「5-8 分钟这个量级应集中到 outer、用**后台 subagent** 跑，**不要堵着 inner 里各个任务**」；08-05T06:23「inner 为什么要等？套件应该在 outer 的后台 subagent 运行」。治的是**主线程串行做实现 / 前台被长任务堵死 / 上下文被烧到 100%**。
- **近 24h 三层实测（工具调用计数，manager 2026-08-10）**：outer 总 2728，**Agent=1 / Workflow=1**，Bash 2623（96%）；inner 总 1179，**Agent=63**，Workflow=0；manager 总 843，**Agent=2 / Workflow=0**，Bash 808（96%）。**真正在用 subagent 的是 inner；不用的是 outer 与 manager**——所以这不是 outer 一个人的纪律问题。manager 已先自改：建 `.claude/workflows/manager-tick-judge.js`（AC 状态词/A16 命中真伪/B3 判词三路 schema agent，算术全留普通 JS）+ 接成 B1 必产出（手写判词不被接受，判据=workflow 本轮有无结构化返回，与 closure-lag --record 心跳同构）。
- **分工**：suite/merge 的**长时观测与等待**（跑一轮 30 分钟量级、轮询状态、等绿）按人 08-05 量化门槛必须走**后台 subagent（`run_in_background: true`）**，不占 outer 前台；**workflow 只负责判定段**。subagent 解决「不堵前台/独立上下文」，workflow 解决「不依赖该轮注意力」。

## 熔融-结晶张力五方向（2026-08-10 人批准；②带人硬修正；①②③④归 outer 实现，⑤归 manager）

**背景（今晚证据分类，人 2026-08-10）**：不是单一现象，是四类：
- **A 结晶了但调用点熔融**：manager-tick-core.js 停调 19h ⇒ 466 行判准缺席 ⇒ 8 条违规；nyf-semantic-judge 跑一次即弃；supervisor-deliver 被绕过 332 次；182 已声明机件近 3 天零调用 89 个=49%。
- **B 条文还在但理由已失效**：四处「不要自己用 Agent 派发实现」理由=共享树单写入者，worktree 隔离后对隔离树不成立；CLAUDE.md:204；静态检查 @static-object 仍指 *-loop-tick.md 而 tick-core 出现 0 次。**B 没有触发器——今晚三个 B 类发现全是人问一个问题才翻出来的。**
- **C 判据形态错**：A16 关键词 3 次假阳性；capture-pane 自证结构上不可能失败；B3 借用判准编号使缺席伪装成在场。
- **D 可见不执行**：C8 读 7 次引用 7 次违反 9 次。

**五方向**：
1. **①结晶时写「失效前提」不只写理由，且必须可测**——禁令本可写成「失效前提：外层无隔离树可用；若外层获得 worktree 能力，本条对隔离树不再适用」，那样 suite-fix/01 一出现就能 grep 命中。机械化：每条硬约束带 `失效前提:` 字段且必须可 grep/可测，缺字段=入口闸拒绝（照 capability-catalog 已有做法）；写不出可测形式的明标「无可测前提，靠周期复核」。
2. **②把「零调用」从默认正常改成默认可疑——人有硬修正，必须照做**：人的原话「对这条的处理必须加时间/频率门限，且处理时应回顾更大时间尺度的记录。我们已经出现了很多『最近没有用』而被丢掉的有价值机制。」修正后四形态：
   - **(a) 门限按机件自己声明的周期定，不用统一天数**——catalog 增 `cadence:` 字段（每轮/每红窗/每里程碑/冷启动/按需），零调用 > 3× 声明周期才进「待表态」清单（统一天数会把一半仓库变噪声：3 天门限下 89/182=49% 命中）。
   - **(b) 表态必须回看全历史**——曾被调用总次数、最近一次产出了什么、有无替代者，用 meta-cc 全会话 + `git log --all`，不得只看近 N 天。
   - **(c) 禁止以「最近没用」为唯一退休理由**——退休必须给出「理由失效」或「已被取代」实证；先例：判准⑥「答案恒定⇒零信息」（可测）、send-keys-verified「ruling F 用 send-keys-reliable 取代」（有替代者），两者都不是「最近没用」。
   - **(d) 默认处置是「待观察」不是「退休」**。
   - **反例证据（人指的就是这类）**：nyf-semantic-judge 全历史只跑过一次，按「最近没用」必被判死，而它是今晚唯一被证明有价值的 workflow（24 分钟产出 4 个 done-flip）；manager-tick-core.js 零调用 19 小时，却是今晚最大的一笔回收（466 行判准正本）；连 manager 自己都犯过——把 84 次 workflow 调用的消失解释成「本就该是脚本、被正确取代、死掉没有损失」，半真所以更有说服力。
3. **③熔融也要付成本：`last-reaffirmed:` 时间戳**——超 N 天未被任何调用/检查/复核触及 ⇒ 进「待重新确认」，不要求判断对错，只要求有人看一眼盖章，把「沉默地继续有效」变成「周期性重新确认」。
4. **④C 类三条原则抽成公共库而非留作原则**——「按位置不按关键词」仓库已实现两次（drive-contract-check、test-framework-policy-check）却没抽库，所以写 A16 时又犯一次；抽 `checker-lib`（matchAtCommandPosition / 枚举式存在性），catalog 入口闸要求新检查器声明用了哪种匹配。
5. **⑤三层缺一个「审视者」职责**——没有一层的职责是「定期质疑现有条文的前提是否还成立」；manager 今晚做的正是这件事但被人问题触发，不在任何 tick 里。机械化：manager tick 加低频步骤（每 N 轮）随机抽 3 条硬约束/机件核其前提是否仍成立，输出被抽条目+核验结论作为产物——低频、抽样、但有产物，正是 workflow 形态（语义判断走 schema agent，算术留 JS）。**⑤ 归 manager 实现。**

**诚实的限度（manager 交底）**：抽样覆盖率低（182 个机件每 20 轮抽 3 条，全覆盖很久）——但从零机制到有限抽样是质变，从抽样到全覆盖只是量变；有些规则写不出可测失效前提，标出来别假装有；这五条本身也适用 C17，④ 最弱（「是否复用了库」靠声明，声明可造假）。
