# 外层编排 loop tick 指令（通用模板）

> ## ⇒ 先读执行核：[`orchestration/orchestrator-tick-core.md`](orchestrator-tick-core.md)
>
> **本文件是理由档案,不是执行清单。** 每轮实际要跑的动作、必产出、硬约束、边界
> 都在执行核里;本文件提供每一条的实测与代价（与内层 fast-mode-loop-tick.md / manager-loop-tick.md 同构）。
> **这一行本身就是一条判据的产物**：凡是必须跨压缩存活的东西,必须落在锚所指向的文件里
> （三层统一架构 SPEC, AC30(b)）——cron 指向本文件,而本文件第一行转指执行核。

**角色**：本项目的**外层**——双层持续开发的上层。内层是开发会话（tmux `$TMUX_SESSION`），它执行任务；
外层观察它、消解它的停摆、必要时纠偏，并把真正需要人的事攒起来。

> **模板参数（gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them）**：本文件是随
> quay 插件包分发的外层 tick 文档（铺到目标项目时是 `orchestration/orchestrator-loop-tick.md`，内层铺到
> `docs/analysis/fast-mode-loop-tick.md`）。
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
> **工作分支模型（gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model）**：
> 工作分支名是**策略**（各项目自身 branch 模型现状），不是机制——本文件是下游项目经升级通道消费的
> 共享模板。`FORK_BASELINE`（已验证基线）与 `MERGE_TARGET`（待验证汇入点）**默认都是 `master`**
> （单线：从 master 分叉、合回 master——未做 branch cutover 的下游行为不变）；下游项目可在
> `.quay/config.yml` `loop:` 节覆盖 `fork_baseline` / `merge_target`（两线模型）。**本模板不写死任何
> 项目的具体分支取值**——quay 自身网络的两线取值（develop / integration）是本层实例状态，见 quay 仓库
> `orchestration/orchestrator-loop-tick.md` 的「本层状态」节。含分支操作的命令先读这两个值代入，不要字面写死。
>
> **切分声明（AC38，2026-08-12 执行切分）**：本文件是**产品行为正本**（随 `quay-init --loop` 原样铺到
> 目标项目 `orchestration/orchestrator-loop-tick.md`）。**切分边界**：**产品行为进 plugin / 本层实例状态
> 留 orchestration**——与 manager 层已按同判据切分（产品模板 vs quay 状态）同形。quay 自身网络的**本层
> 状态**（工作分支两线、integration 作 checkout、项目列表、tmux 布局、以及每一条判据的实测与代价）在
> quay 仓库的 `orchestration/orchestrator-loop-tick.md` 副本。冷启动 skill 与 tick 核引用同一批行为文件
> （AC3）。**机械判据（AC38 Contract）**：对「本文件」与「本层状态副本
> `orchestration/orchestrator-loop-tick.md`」跑 `comm -3 <(sort <本文件>) <(sort <orchestration 副本>) | wc -l`
> 即两份独有行数——切分后本文件（产品模板）独有 = 产品行为、orchestration 副本独有 = 本层实例状态，
> 各自主题单一。（`plugin/loop/` 是随包分发路径、不被 quay-init 铺出，故文档正文不写该字面量——铺到
> 目标项目后本文件即 `orchestration/orchestrator-loop-tick.md`，路径以落地为准。）

**网络特有值不是本文件的常量**：项目列表、仓库路径、tmux 窗口名、工作分支名是外层自己的运行上下文——
按本网络实际情况代入，**不要照抄任何示例**。目标项目的值集中在一个配置文件 `.quay/config.yml` 的 `loop:`
节里，脚本与本 tick 在**运行时读取**它们，不在落地时烘焙。

**目标项目值引用约定**：`REPO_ROOT` / `TEST_COMMAND` / `TMUX_SESSION` / `FORK_BASELINE` /
`MERGE_TARGET` 五个名字在本文件中指 `.quay/config.yml` `loop:` 节的对应值
（`repo_root` / `test_command` / `tmux_session` / `fork_baseline` / `merge_target`）。
执行含这些名字的命令前，先读该文件把值代入——不要凭记忆。工作分支名是**策略**（各项目自身 branch
模型现状），不是机制：`FORK_BASELINE`（已验证基线）与 `MERGE_TARGET`（待验证汇入点）默认都是 `master`
（单线）；下游项目可按自身 branch 模型覆盖成两线。含分支操作的命令先读这两个值代入，不要字面写死。

> **切分声明（AC38，2026-08-12 已执行）**：本文件是**产品行为正本**——外层这个角色该怎么做的通用机制，
> 随 `quay-init --loop` 原样铺到目标项目 `orchestration/orchestrator-loop-tick.md`。quay 自身网络的
> **本层实例状态**（工作分支两线、integration 作 checkout、项目列表、tmux 布局、本实验各 AC 的
> 进度与既有裁定）在 quay 仓库的 `orchestration/orchestrator-loop-tick.md` 副本。
> **产品行为进 plugin / 本层状态留 orchestration**——与 manager 层已按同判据切分（产品模板 322 行
> vs quay 状态 1647 行；本对切分后 1066/1269，共同 532 行——共享的是命令块与脚本名，各自独有可解释
> 为产品行为 / 本层实例状态）。冷启动 skill 与 tick 执行核引用同一批行为文件（AC3）。
>
> **这份文档存在的理由**：外层与内层的活节奏不同、需要的上下文不同，挤在一个会话里两件事会互相排挤。
> 分成本文件（产品模板）与 quay 仓库的实例副本（本层状态），是因为同一批行为规则要同时服务「任何
> 下游项目」（产品）与「quay 自身正在跑的这个外层」（实例）——两份主题不同，不应是同一份文档的两个副本。

---

## ⇒ 先读执行核

> **先读执行核：[`orchestration/orchestrator-tick-core.md`](orchestrator-tick-core.md)**。
>
> **本文件是理由档案，不是执行清单。** 每轮实际要跑的动作、必产出、硬约束、边界都在执行核里；
> 本文件提供每一条的实测与代价，只在需要某判据的 `src:` 行号时查。
>
> 冷启动（新会话 / `/clear` 后的空上下文）按下方 7 步操作；**循环驱动只有一个**：步骤 4 的
> `CronCreate`（20 分钟 cron）。Monitor 是事件监测，不是驱动。两个都做完再进 tick 步骤。
> 不要在这之外再起 `/loop`（固定间隔 `/loop` 底层就是同一个 cron，再起一个等于双触发，见 §4a）。

---

## 冷启动（新会话 / `/clear` 后的空上下文）

**按顺序做完这 7 步再进 tick 步骤。** 不要凭记忆——你没有记忆。

```bash
cd "$REPO_ROOT"    # REPO_ROOT 见 .quay/config.yml loop.repo_root（或 git rev-parse --show-toplevel）
```

**启动方式（F4，measured 2026-08-11）：** 本外层会话必须是用**铺下的
`bash plugin/scripts/quay-launch.sh outer`** 起的（带 `--settings`、窗口名 `quay-outer`），内层必须是用
`bash plugin/scripts/quay-launch.sh inner` 起的（窗口名 `quay-inner`）。**不是手敲一行 `claude`。** 冷启动检查的是
「铺下来的 launch 被用起来」——若你的窗口不是这么起的（无 `--settings`、或窗口名是 `inner` 而非 `quay-inner`），
先经 launcher 重起再继续；`quay-launch.sh --dry-run` 打印每个角色将得到的命令。launch 配置在
`<root>/.claude/launch.settings.json`（quay-init `--loop` 铺默认模板，按项目改 model/env）。窗口名
（`quay-outer` / `quay-inner`）是**本项目拓扑的实例值**，随 `quay-init --loop` 铺到目标项目时由
`loop.tmux_session` / 窗口约定代入——本模板不写死具体会话名。

**1. 读机制与目标**（顺序有意）

| 文件 | 得到什么 |
|---|---|
| `orchestration/orchestrator-tick-core.md`（**执行核**） | 外层的职责、授权边界、tick 步骤——**冷启动第一份读它**，不要先读本文件全量 |
| 本文件（**完整理由档案，只在需要某判据的 src: 行号时查**） | 每条判据的实测、理由、代价 |
| `orchestration/<阶段目标>.md`（本项目的阶段目标/AC 清单） | 目标、AC、DoD |
| `orchestration/tick-log.md` | **历史 tick 与动作类型累计分布**——退化判据的唯一来源 |
| `orchestration/escalations.md` | 已攒给人、尚未处理的非常规项 |
| `docs/analysis/batch2-queue-state.md`（文件名历史引用——batch2 是旧批次名） | 内层自报的队列状态（**可能是旧快照，以 git 为准**） |

**2. 建立实况**（以实测为准，不以上面任何文件的自述为准）

```bash
git log --oneline -10 && git status --short
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json
node --experimental-strip-types plugin/scripts/task-status-drift-check.ts
```

**3. 自检内层会话**——已退役（`gap-retire-outer-tmux-window-logic`）

内层会话已由 worker-driver 派发取代（`gap-retire-inner-session-references`），外层独立 tmux 会话角色也已撤销——本步的三态/四态 tmux 窗口自检（窗口按名寻址 / `/proc` 进程 / transcript user 消息）与两窗口拓扑工厂/检查一并退役。内层的存活与驱动不再经本层 tmux 窗口检查，改由 driver 机制承担。

**4. 重建 cron —— 唯一的循环驱动，这一步最容易漏**

**整个冷启动只有这一个循环驱动机制**：tick 靠它每 20 分钟触发一次。`CronCreate` 的任务是
**会话内的**——但**「会话内」指的是【进程】，不是【上下文】**。**因此这一步是「先列、再决定」，
不是「无条件重建」**：

```
CronList     # ← 必须先列。/clear 之后旧 cron 仍在，直接建就是双触发（§4a 明令禁止的那个）
# 恰好一个本层 tick 的 cron  ⇒ 什么都不做
# 多于一个                  ⇒ CronDelete 到只剩一个（哨兵清扫：按 prompt 内容找，绝不靠记住的 ID）
# 一个都没有                ⇒ 才建：
CronCreate(cron="*/20 * * * *", prompt="执行 orchestrator-loop-tick.md 中的 tick 指令", recurring=true)
CronList     # 建完再列一次确认——没列出的 cron 不是报警，是静默空转
mkdir -p <root>/.quay
# 写驱动注册表（与冷启动 skill 逐字同源）——loop-driver-check.sh 数的是这一行：
# 只建 cron 不写注册表 = 检查器看不见这个驱动，照文档冷启动会误报 STALLED
printf '%s\n' '{"mechanism":"cron","interval":"*/20 * * * *","source":"cold-start"}' >> <root>/.quay/loop-driver.jsonl
```

> **⚠️ 实测更正**：`/clear` 清上下文、换 transcript session id，**但不杀 cron（进程没退）**——
> 照原文无条件 `CronCreate`，造出的正是 §4a 禁止的双触发。**真正杀掉 cron 的是进程退出**
> （崩溃 / OOM / 关窗），那时 `CronList` 返回空——**所以判据只有一个：先列，按结果决定建不建。**
>
> **同次实测暴露的第二个、更阴的失效**：`/clear` **保留驱动、更换 transcript session id**
> ⇒ **循环照跑，观测瞎掉**——任何把 transcript 路径写死的监视器从此静默读空。
> **「进程死了」有 `SESSION-GONE`，「id 换了」什么都不报。**
> ⇒ 监视器按 `customTitle`（如 `"<项目>-outer"`）解析当前 transcript，**不写死 session id**。

**最后一行是写驱动注册表**：`CronCreate` 建的 cron 是**会话内的**，对 `loop-driver-check.sh` 本身
不可见——检查器数的是**注册表** `.quay/loop-driver.jsonl`，一行 = 一个驱动。**建好却没写注册表的
cron，对检查器等于不存在**（这正是「照文档冷启动必然报 STALLED」的根因：检查器没错，是注册动作
不在文档里）。这一行与冷启动 skill（`plugin/skills/cold-start/SKILL.md` 步骤 5）**逐字同源**，
两处必须保持同一条命令。

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

**冷启动门 = DERIVED laydown set 绿，不是全量套件绿（铺什么验什么）**：冷启动只铺下 derived laydown set
（被铺下的 skill + loop 文档引用的 `plugin/scripts/*`），所以「套件失败且与该铺设集无关」不得阻塞冷启动；
「铺设集内部失败」必须阻塞。该 set 由 grep 铺下的文档机械导出（与 quay-init.sh 的 `derive_loop_scripts()`
同源，不手改）：grep 正则（`plugin/scripts/` 前缀的 token，不是字面路径）扫
`<root>/plugin/skills/*/SKILL.md` 与 loop tick 文档（铺到目标项目时是
`orchestration/orchestrator-loop-tick.md` 与 `docs/analysis/fast-mode-loop-tick.md`）导出。
跑门：

```bash
bash <root>/plugin/scripts/laydown-set-check.sh   # → `laydown_set_green: green|red`
```

`red`（成员缺失 / 非解析 / 成员自己的测试失败）阻塞冷启动；`green` = 本次冷启动要铺的确切脚本可验证可用。
检查**从不回退到全量套件**：0 个测试文件解析出来 ⇒ fail-closed 报 red——「什么都没查」的静默绿不是可接受的闸。

**确认恰好一个触发源**：照上面建好 cron 并**写完注册表**之后跑

```bash
bash plugin/scripts/loop-driver-check.sh
```

必须报 `LIVE`（退出码 0）。报 `DOUBLE-TRIGGER`（退出码 4）= 注册表多于一行——有人多装了一个驱动
（多半是照旧文档多起了一个 loop）——停下来处理，**不要再加装**。报 `STALLED`（退出码 3）= 注册表
一行都没有——**先查注册表是否写过，再谈重建 cron**：

1. `ls "$REPO_ROOT/.quay/loop-driver.jsonl"` 且 `wc -l` 有行——**注册表写过吗？**
2. **注册表从没写过**（文件不存在或为空）→ 说明步骤 4 的**写注册表**那一步漏做了——不是缺 cron，
   是缺记录。回步骤 4 补上 `printf … >> loop-driver.jsonl` 那一行，再跑检查必须转 `LIVE`。
3. **注册表确实写过**仍报 `STALLED` → `rm -f <root>/.quay/loop-driver.jsonl` 清掉陈旧注册，
   再回步骤 4 补写。

**直接重建 cron 而不先查注册表，会在每次冷启动都多加一行注册——正是本检查要抓的双触发。**

**4a. `/loop` 不是驱动器——不要在这里另起一个**

主推进信号是后台 agent 的完成通知；本文件（外层）的**循环驱动只有一个**：步骤 4 的 `CronCreate`。
`/loop` 不在这里充当驱动，**不要照旧习惯在步骤 4 之外再起一个**：

- **固定间隔 `/loop`（带数字间隔的形式）底层就是 `CronCreate`**——同一个机制、同一种列表。步骤 4
  已经建了 20 分钟 cron，再起一个就是**双触发**（两个 tick 同时跑，竞争共享检出）。
- **动态 `/loop`（不带间隔）走自排程**——没有任何列出工具，且每次 tick 结束都要记得排下一程，任何
  中断就静默断链。对一个专门用来在上下文丢失后兜底的机制，不可查验等于不可信——你无法在需要它之前
  知道它是否还活着。

**4b. 重挂 Monitor —— 和 cron 一样是会话内的**

`Monitor` 与 `CronCreate` 同样活不过会话。会话观测机制（Monitor 挂载 + SESSION-* 事件）2026-09-03
随 tmux 一并退役——无对象可挂、无可查。外层退回纯 20 分钟轮询；停摆检测由 driver 现读 ready 池 /
suite state 承接（SPEC §5.5）。

**4b2/4b3. 已退役：不再挂 `suite-state-trigger` / `slot-free-trigger` 两个 Monitor（`gap-retire-outer-monitors-after-reconciler`）**

「套件转红」与「空槽出现」的 Monitor 挂载已退役——宿主是会话（Monitor 随会话死，tmux server 重置即
静默消失，已被证伪）。协调循环（driver 定时器地板 + 每趟 pass 现读 ready 池 / suite state，
SPEC §5.5）落地后，两场景由 driver 现读接管，trigger 从正确性依赖降级为优化（SPEC §5.8 第 5 步）。
脚本本体 `plugin/scripts/suite-state-trigger.ts` 保留为共享库
（被 `full-suite-runner.ts` import——crash-watchdog / 起跑闸；空槽条件判定）；`slot-free-trigger.ts` 已删除
（gap-retired-mechanisms-cleanup-corpses-stale-refs，2026-08-30，零运行时消费者）。只是不再由外层
Monitor 挂载。

**4c. 重挂后验证 —— 已退役**（2026-09-03：monitor-mount-check 与观测者脚本随 tmux 一并删除，无对象可查）：
只查第一条会漏掉「进程活着、目标错」那次。

**5. 核对前置条件**

`.halt` 是否还在、套件是否绿（读 `.quay/full-suite-state.json` 的 `state`——`green` 绿、`red` 需按
步骤 1b「红窗分诊」处理、缺文件 = 外层还没跑）、内层 loop 是否已启动。

**6. 补记一次 tick**

冷启动本身算一次 tick，动作类型通常是 `no-action`（只是恢复）或 `unblock`（恢复时发现内层停摆）。
在 `orchestration/tick-log.md` 记一行，注明「冷启动恢复」。

**7. 进入正常 tick 步骤**

## 定位

双层持续开发的**外层**。内层是开发会话（tmux `$TMUX_SESSION`，见 `.quay/config.yml` `loop.tmux_session`），
它执行任务；外层观察它、消解它的停摆、必要时纠偏，并把真正需要人的事攒起来。

**外层存在的唯一理由：消费内层的停止条件。** 内层撞到「合并冲突 / 套件红 / 审查 2 轮后仍 REFUTED /
超 90 分钟 / needs-human 积压 ≥3」就停下等人——外层就是那个「人」的常规部分。内层仍然停，只是停的
时长从「到人回来」变成「到下一个 20 分钟 tick」。

## 授权边界（已与人约定，不可自行放宽）

| 外层可以 | 外层不可以 |
|---|---|
| 解阻塞（回退、bisect、判断发现真伪、分诊积压） | **直接改代码** |
| 重排队列、补建任务、纠正错误前提 | 改变方向或范围 |
| 写 `orchestration/`、队列状态文件、`tasks/*.md`（见下） | 写 `packages/` `plugin/` `experiments/` 下的**实现与测试** |
| 给内层下指令 | 替内层执行【任务】（**收窄**：禁令防【共享树】双写入者；外层可在**自己的 worktree** 里执行基础设施动作 suite/修红/merge，隔离已消除冲突——但替内层执行**任务**仍禁止，放开仅限基础设施动作且必须在自己的 worktree 内） |

**`tasks/` 的归属**：本表原先同时写着「可以补建任务」和「不可以写 `tasks/`」，自相矛盾。裁定：
**`tasks/*.md` 是队列，不是代码——外层可以写**（建任务、改状态、调优先级）。单一写入者纪律要保护
的是工作树里的实现代码，不是队列本身。

唯一约束：**写 `tasks/` 前先确认没有在飞任务把 `tasks/` 列进它的 `## Touches`**，否则会和内层撞车
（`grep -l '^## Touches' -A20` 查在飞任务，或直接看遥测 `inProgress`）。撞上就改为「记进队列状态
文件 + 指示内层建」。

**外层不直接改代码**（收窄：单一写入者/共享树）——它下指令，内层执行。理由：保持单一写入者。
人在，但不需要被打扰：**常规自行处理，非常规攒起来**等人有空看。

**对更上层的运行时约束（C3）**：本层对更上层（如 manager）的观测/检查动作必须为零——文档层检查只证明
「tick 文档没写越界步骤」，**不证明运行时没做越界动作**。本步补的是**运行时约束**：每 tick 扫描本层
会话 transcript，机械检出本层实际对更上层的观测/检查动作
（`plugin/scripts/manager-observation-runtime-check.ts`；四类判据——PANE=读更上层窗口 pane、
TICKLOG=读/动其 tick-log、TRANSCRIPT=读其 transcript、ANALYZE=分析其行为）。**每 tick 必跑一次本层
自审**，扫**自上次审计时刻起**的新窗口（`--since`）：

```bash
node --no-warnings --experimental-strip-types plugin/scripts/manager-observation-runtime-check.ts \
  --transcript "$HOME/.claude/projects/<root-slug>/<本层会话id>.jsonl" \
  --since <上次审计的 ISO 时刻> --json
```

- **会话目标显式，不猜**（`--self` 只作多会话并存时的回退，打印被选会话、须人工核对；找不到/不唯一
  就显式传 `--transcript` 本层会话 jsonl——**绝不猜**）。manager 的会话 id 用 `--config`/环境变量
  `MANAGER_SESSION_ID` 给出，否则 `--self` 可能把 manager 当外层。
- **违规报出（AC2）**：任何 PANE/TICKLOG/TRANSCRIPT/ANALYZE 命中 ⇒ 退出码 1、打印违规行；本 tick
  停止后续动作，按「授权边界」升级给人（step 5）。**违反即停**——运行时约束不是建议。
- **负控制（AC3，不误报）**：指向 inner 的 capture-pane（`-t "$TMUX_SESSION:inner"`，窗口名由
  `loop.tmux_session` + `:inner` 约定代入——本网络实例见 orchestration 副本的「本层状态」节）
  不计数；**manager→outer 的发布不计数**（收件箱机制已退役——inbox 彻底删除，人 2026-08-20 裁定范围A）；基于转述的指控（本层
  transcript 里散文提到 manager）不被当作证据——**只数真实 tool 调用**。
- **独立审计（方向合法）**：manager 对本层跑同一检查器（manager→outer 观测是合法方向，不受 C3
  约束）——`node --no-warnings --experimental-strip-types <repo>/plugin/scripts/manager-observation-runtime-check.ts --root <repo> --session <本层会话id> --json`。
- **交叉标注（AC4）**：本步是 `gap-manager-productization-five-constraints` AC4 文档层检查的**补充，
  不是替换**——文档层管「tick 文档不得含创建/驱动/检查 manager 的步骤」，运行时约束管「运行时实际
  观测/检查动作为零」，两条正交、都要。

## Tick 步骤

### 0. 三个已经害过我们的失败模式

这三个都发生过，都表现为「内层看起来在工作」，都不会自己暴露：

**a) 内层输入框里的字大概率不是待提交的指令，是 ghost suggestion。** 那是 Claude Code 自动生成的
输入建议（CLAUDE.md 早已警告过 gray ghost-suggestions），内层其实是**问完问题正常结束了回合，在等
人答复**。

两个后果：

- **停摆分类不要靠输入框内容猜。** 内层结束回合等答复，就是外层存在的理由本身（步骤 3），不是故障。
  看最后一段 `⏺` 输出问了什么，直接答。
- **发指令前必须 `C-u`**，因为输入框里可能有 ghost 文本。可靠发法是 **`C-u` → 文本 → `Enter` 三次
  分开调用**（合并会丢 Enter）。发完 `capture-pane` 确认出现了新的 `⏺` 输出——未确认送达的指令等于没发。

**b) 判断内层是否停摆要看「底部区域状态行」，不是看最后一行。**

```bash
tmux capture-pane -p -t "$TMUX_SESSION" | tail -3 | grep -q 'esc to interrupt' && echo busy || echo idle
```

> ⚠️ **ADR-016 纪律**：上一版这里是整屏哈希（`capture-pane` 两次相同 = 空闲）——正是 ADR-016
> `## Amendment 2026-08-04` 明令禁止、`adr016-screen-use-check.ts` 机械拦截的形态，且它是【指令】
> 不是散文，外层照做即违规。**正确形态**只取 pane 底部 3 行、只判 busy/idle 两个枚举态（底部区域 +
> 枚举态，Amendment 允许）。注意别写成 `-S -3`——`-S` 是【起始行】不是行数，负值进历史缓冲，取的是
> 「历史往前 3 行 → 屏幕底部」一大段，取不到状态行。

**c) 外层的独立核实会和内层抢 CPU——这是机制不是散文。** 步骤 1 写着「只读」，但跑一次全量套件是
**数分钟的满载**，足以把内层那种 timeout 余量只有 8% 的测试压成 flaky。规则改为**机械执行**：跑
全量套件前调用资源闸 `bash plugin/scripts/resource-gate.sh --for full-suite`——退出码非 0 = WAIT，
**此时不要跑全量**，改为核实便宜的声称（文件存在、grep 计数、单文件测试）。内层在飞时只核实便宜的
声称；**全量只串行跑、跑完再叫醒内层**。

**d) cron 只在本会话空闲时触发。** 外层正在和人对话时，`*/20` 的 tick 不会 fire。人机对话期间外层
事实上是停的——所以**每次对话结束前手动补一次 tick**，不要假设 cron 会接上。

**e) 外层挂的 Monitor 可能没挂上、挂错目标、或属于上一个会话。** 两个反证都是「不报错的降级」，
而且都不是被信号发现的，是人问起来才发现的：外层**从来没挂上**（照着 tick 文档做，Monitor 那一步
没发生，没有任何东西报错）；更上层**挂了 18 小时挂在错的目标上**。**一个盯错东西的 monitor 和一个
正确的 monitor，从外面看一模一样。**

### 0b. 事件式监测（Monitor）——已退役（2026-09-03）

会话观测机制随 tmux 一并退役；tick 之间的停摆盲区由 driver 现读（ready 池 / suite state）承接。
历史事件表（供查阅，不再产生）：

| 事件 | 含义 |
|---|---|
| `SESSION-GONE` / `SESSION-BACK` | 会话进程消失 / 恢复 |
| `REPO-STALL` | 仓库 ≥`STALL_MIN` 分钟无新提交（未暂停的项目）——仓库信号，不是会话面 |
| `SESSION-OVERDUE` | 心跳源 mtime ≥`OVERDUE_MIN`（未暂停的项目）——会话可能已死 |
| `SESSION-IDLE` / `SESSION-RESUMED` | 相邻两轮 pane 状态相同=空闲；在转换后一个轮询周期内报出 |

**它买什么、不买什么**：

- **买的是死时间**。它把「内层停下等裁定」到「外层发现」的延迟从最多 20 分钟压到 ~1 分钟。
- **不买纠偏质量**。更快的监测不会让外层看得更准——纠偏受限于视角，见步骤 2 的「外层的价值来自视角」。

**遥测信号的两个方向**（`fast-mode-telemetry.ts` 实际定义，随 `--report` 铺出）：

| 信号 | 实际定义（代码为准） | 去向 |
|---|---|---|
| `ORPHAN` | **end without start**（只有 `--task-end`、没有对应的 `--task-start`） | 进 `orphaned[]`，报表可见，不进吞吐 |
| 有始无终 | **start without end** | 进 `inProgress[]`；**只在 90 分钟后以 `OVER90` 露头**，且与「一个真的很慢的任务」同形——信号上不可区分 |

**崩溃遗留（幽灵）**：执行者被杀死后，`--task-end` 永远不会来，任务永久停在 `inProgress`。先用
`node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --reconcile --json` 关闭
「执行者确实不存在」的记录（判据是可观测的：分支已合并 / worktree 不存在 / 进程不存在，**不是时龄**）。

**代理信号迟早会误报，能换成结构信号就换。** 一天里五个检测信号误报，五次的根因是同一个：
**测的东西和声称的东西不是一回事**。数进程用 `comm` 精确匹配（`node-MainThread`）或显式排除自身；
判停摆要两个独立判据同时成立（进程数为 0 **且** load1 < 1）；找一个监听中的服务按端口 `ss -ltnp`
不按命令行。

**核实「修好了没有」要看行为或读 diff，不要 grep 关键词。** 描述一个缺陷的词，必然出现在这个缺陷
自己的文档里——所以无论查「缺陷还在不在」还是「修复到位没有」，grep 关键词都会给出反向答案。
判据只能是**行为**或**读实际 diff**。

**新检测器的第一条事件，默认当作待验证，不当作发现。** 收到任何检测器的第一条事件时，先跑一次能
证伪它的检查，确认它测的确实是它声称的；确认之前不要据此行动，也不要写进 tick 记录当作发现。

**已知盲区**：`IDLE` 只是「无在飞任务」的代理，不是内层真的在等裁定。修复类工作跑在
`--task-start`/`--task-end` 之外，遥测看不见，此时内层在忙而信号显示 IDLE。**已部分闭合**：步骤 1
的 `--detect-stop --pane` 屏幕观察者现在能从 pane 形状直接看到 `waiting-input` / `permission-prompt`
（3 采样一致），不再只靠遥测缺席推断。

### 0b2. 会话存活监视——已退役（2026-09-03）

会话进程存活/忙闲/心跳观测随 tmux 一并退役，无对象可查。停摆检测改由直接量活性承接：
`git log -1 --format=%ci` 提交时刻 / `git worktree list` 活 worktree / worktree 内活进程 / 盘上任务
`status:` 枚举。工作产出信号直接读 `fast-mode-telemetry --report`，仓库告警直接看 `git log`。
**解除停机（删 `.halt`）那一刻重置陈旧度基线**。

**四个阈值（含义与默认值在这里，不只活在脚本注释里）：**

| 阈值 | 默认 | 含义 |
|---|---|---|
| `INTERVAL` | `60` | 轮询周期（秒）。每轮抓一次每个目标的状态；「转换后一个轮询周期内报出」的「及时」颗粒 |
| `STALL_MIN` | `45` | 未暂停的项目超过这么久（分钟）无新提交 = 停滞（`REPO-STALL`，仓库信号） |
| `LOOP_MIN` | `20` | **`SESSION-IDLE` 静默判据的边界**（抑制阈值）：空闲时心跳时距 `< LOOP_MIN` = 刚动过的正常收尾（静默）；`≥ LOOP_MIN` 或未知 = 「空闲了但没动」，报 |
| `OVERDUE_MIN` | `30` | 心跳源 mtime 超过这么久（分钟）未更新 = 会话逾期（`SESSION-OVERDUE`）。**不可自愈类宁可误报：默认 45→30**——漏报代价无界，误报只多一次廉价核查 |

### 0c. 派发闸口的清单与留痕：`## Contract` + `## Dispatch review`

外层对派发任务的审查此前是**惯例**——没有清单、没有留痕。现在变成任务创建时写下的、机器能消费的
声明，外层在**派发前**消费它：

**派发前对每个候选**，读它的 `## Contract` 块（六个键：`measure`/`band`/`invariant`/`invoke`/`control`/
`resume`；`n/a: <理由>` 合法、留白不是），并跑消费者检查器：

```bash
node --experimental-strip-types plugin/scripts/task-contract-check.ts --root <repo> --json
```

- 五条消费者判定（AC 阈值→measure/band 引用、measure 命令+字段、invoke 反引号命令+done 证据逐字、
  defect→control、键空值）；**读内容不只验存在**，按代码/字段位置匹配。
- **报出而不阻断**；违规名单 `docs/analysis/contract-violations.md` 只能变短。
- 这里就是「审查问了什么」的机器承载——**留痕**由任务体的 `## Dispatch review` 段承载
  （`reviewer: outer|none` / `at: <ISO>` / `changed: <逐条|无>`）。

**不做**：不引入审查 agent、不加轮次、不阻断派发、不恢复 prepare 管线。把「碰巧」变成「写下来时就
被问到」——如果 `## Contract` 没有真读它的消费者，三天后它就是第五段散文。

**外层自己写 `## Contract` 时最常犯的一条**：第二个 `measure` 写成「**同上命令**输出的 X 字段」——
人读得懂，检查器读不懂，判据是「该行有没有自己的反引号命令」，于是每次都报 `measure-no-command`。
**每个 `measure` 行都要自带完整的反引号命令，哪怕与上一行逐字相同。** `control` 折行 ⇒
`contract-line-unknown`（一行一键不可折行）；`invoke` 命令若含 `<ISO>`/`<file>` 占位符，
`invoke-evidence-missing` 在构造上无法满足——写 invoke 时用一条能原样跑、也能原样贴回证据的命令。

### 0d. 跨项目暂停/恢复：用 `.halt`

**目标项目清单**（本层观察/暂停/优先级面向的每个项目）各自的**唯一开关**就是仓库根的 `.halt`：
（目标项目清单是**本网络的实例值**——见 `orchestration/orchestrator-loop-tick.md` 本层状态节；本模板不写死）

```bash
# 暂停
echo "<理由> | 解除条件: <条件> | 外层 <ISO>" > <repo>/.halt
# 恢复
rm <repo>/.halt
```

**为什么够用**：文件**内容会被当作暂停理由读出**——开关自带说明；**除 ENOENT 外的任何读取失败都
fail-closed**（权限/是目录/I/O 错误 → 判为已暂停）；空文件也算暂停。

**已知且接受的粗糙之处**：`.halt` 使整个 tick 空转，**fan-in 也停**。所以在飞任务会算完但不落地，
直到解除。**人已裁定接受这一点。** 缓解只有一条纪律：**暂停不是终点，解除条件必须写在 `.halt` 内容里**。

**（退役）外层 `.halt` 暂停已死**（gap-retire-halt-file-driver-based，2026-08-29）：外层（outer-driver）已
注册未部署，晋升/执行暂停改由 driver control-state 承接（`.quay/worker-control.json` /
`.quay/promotion-control.json`，`driver-shared.ts` `isHalted`），driver 不再读 `.halt`。旧的三层统一检查点
`halt-check.sh` 已删除。本层不再「每 tick 报 `.halt` 状态」——跨项目 `.halt` 停泊态观察现归 **manager 层**
（`manager-tick-readings.ts` 跨项目读，manager 层活机制）。

**优先级（人已裁定，各网络自定）**：**本仓高于其它目标项目**（各网络的优先级取值见本层状态节）。
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
node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --stranded   # stranded worktree branches
cat docs/analysis/batch2-queue-state.md             # 内层自报的队列状态（文件名历史引用——batch2 是旧批次名）
# 收件箱机械挂载点已退役（inbox 机制彻底删除，人 2026-08-20 裁定范围A；见 tasks/gap-inbox-message-bus-teardown）
```

**`ruling-required` 屏幕观察者（外层是主轮询方）**：主判据是**屏幕形状分类**。外层按分钟（60s）轮询
内层 pane，把捕获喂给 `--detect-stop --pane`。**通用化观测原语**：盯谁（`--target`）、几个连续采样
（`--samples`）、检测到后做什么（`--action` / `--action-command`）都由调用方配置——内层/外层/更上层
各是**一次调用**，不新写代码。`--target inner` 保持旧路径 `.quay/inner-blocked.json`；其它 target 写
`.quay/blocked-signals/<target>.json`。

~~外层盯内层（主路径，显式 `--target inner`）~~（**已退役** 2026-09-01：喂 inner 自己 pane 死指令，`gap-retire-inner-hygiene-delete-session-face`；下段 `--target outer` 仍活）：

```bash
tmux capture-pane -p -t "$TMUX_SESSION" > .quay/last-pane.txt && \
node --no-warnings --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --target inner --pane .quay/last-pane.txt
```

`classifyPaneState` 只读**底部区域**（ADR-016 修订 boundary b——不做整屏哈希），连续 3 次
`waiting-input` / `permission-prompt` ⇒ 自动写 `.quay/inner-blocked.json`（`reason: "ruling-required"`
+ 可行动 `question` + 底部区域 `evidence`）；`busy` / 其它形状 / pane 缺失 / `--clear` 都重置计数。
**在飞 agent 消歧**：`waiting-input` 在状态区有「← N agent」（N>0），或遥测有在飞任务 bracket 时是
**良性空闲**（等自己的后台 agent），不写块——`permission-prompt` 恒为人类等待，不被抑制。

**以 git 和实测为准，不以内层的自述为准。** 内层报告过「AC9 满足」而实测超限；报告过任务 done 而 DoD
未勾。每个 tick 都要独立核实至少一项它声称完成的事。

**核实优先查 transcript，不要靠重跑。** 重跑一次全量套件是数分钟 + 满载，还会把内层的 timeout 余量
压成 flaky。查 transcript 是秒级、零干扰：

```bash
node plugin/scripts/inner-forensics.mjs verify 全量套件 --since <上次 tick 的 ISO 时刻>
node plugin/scripts/inner-forensics.mjs timecost --since <外层 loop 起点或本班次起点>
```

`verify` 接**类别**（`全量套件` / `范围化测试` / `其它 Bash`，与 `timecost` 同源）或任意正则。
**零命中不等于「内层没做过」**，它与「查询写错了」不可区分——先用类别形式复核，确认查询正确后
零命中才是证据。**注意窗口**：分析外层的影响必须 `--since` 外层 loop 起点。**`/clear` 会切断历史**
——跨 `/clear` 的分析要逐个会话跑再合并。

### 1a. Routine 检查（监督探针 standing track 不 dead）

**探针机制死过 15 天无人报警**（`routine-scheduler.ts` 存在但无生产调用）。外层是监督方，**每 tick
机械核实探针没死**——DUE 判定走与内层同一个 `routine-scheduler.ts` 与 `.quay/routine-last-run.json`：

```bash
# --plugin-root 用 $(pwd)/plugin 现取（与本行脚本的相对路径 plugin/scripts/ 同源——本 tick 先 cd "$REPO_ROOT"，
# 故 $(pwd) = REPO_ROOT；⛔ 不用宿主环境变量承载插件根：它在普通会话 Bash 里没有值，展开成空串后与「文件不存在」同形）
node --experimental-strip-types plugin/scripts/routine-scheduler.ts \
  --now "$(($(date +%s) * 1000))" \
  --last-run "$REPO_ROOT/.quay/routine-last-run.json" \
  --plugin-root "$(pwd)/plugin" \
  /tmp/routines-outer-<tick>.json
# exit 0 + DUE: 行 ⇒ 有 due；exit 3 = 无 due
```

- **有 DUE** ⇒ 内层应正在派发；核实内层在跑（遥测有在飞 / 最近有提交），若内层 idle/stuck，经
  run-routines skill 派发或驱动内层派发。
- **STALE 检测（dead-mechanism 报警）**：对每个 routine，`now - lastRun[name] > 2 × interval` 即
  **探针 dead**——升格（步骤 5），不再「没人报警」。

### 1b. 异步收尾例程（verification-round closure pass，强制）

**词汇规范**：本步骤就是全量验证 + 收尾节奏 **`verification-round-N`**——它只关于验证/收尾，**不是分派门控**；
**分派是滚动的**（`fast-mode-loop-tick.md` 步骤 4），验证轮不约束、不命名、不门控任何一次派发。
tick-log 与 commit message 沿用同一词汇：派发写「滚动派发」，本步骤的轮次写 `verification-round-N`。

**批次边界的真源是记账同步，不是措辞**：**历史引用**——旧的「Close batch」类收尾动作在 inner 派发
历史里出现多次、每次收尾后必跟 3 连发、收尾期间零新派发 ⇒ 记账曾是调度的同步点。**inner 只执行 +
派发 + 合并，永远不因记账停顿、也不知道收尾存在；收尾是本层（外层 20-min cron）的异步活。** 本步骤
每个 tick 做一次收尾 pass。

**探测用 `taskWorkLanded`，不用 `status: done`**：`ready-pool-check.ts` 的 `notYetFlipped` 走
`taskWorkLanded(task.body, repoRoot)`，不依赖 `status: done` 字段——所以 inner 的就绪池计算不受收尾
异步化影响，外层延迟翻 done 不会导致任务被重复派发。

**1b 不随红窗停**：收尾 pass **不受套件状态门控**——`state: red` / `reason: failed` 停的是派发与合并
推进，**不停收尾**。红窗期间照常跑收尾例程；「dirty-tree 顾虑」不构成延后收尾的理由（本层只写
`tasks/` + `.quay/`，不碰代码树）。

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
   - **翻 done（经 gate 引擎）**：先核对 AC/DoD 是否真实满足，勾完**不再手搓直接写文件**，而是调机件
     ```bash
     node --no-warnings --experimental-strip-types plugin/scripts/loop-complete-task.ts \
       --root "$REPO_ROOT" --task <id> --verified-by "verification-round-N 全量套件绿 + AC/DoD 核过"
     ```
     它经 gate 引擎写 `status: ready → done`，并追加 `complete` pass GateEvent 到
     `.quay/gate-events.jsonl`。exit 1（非 ready / acceptance meter 失败）⇒ 记进本轮报告、任务留
     `ready`，不硬翻。
   - 记进本轮 `closed` 清单。
   - `needs-human` 任务不在 `not-yet-flipped` 里（工作没落地）；其遥测括号由 `--reconcile`（执行者
     已消失）或本层手动 `--task-end --outcome needs-human` 闭合，别让它滞留 `inProgress` 触发 OVER90。
   - **括号对账**：收尾批次后跑
     `node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slot-status --cap "${effective_cap:-3}" --root "$REPO_ROOT" --json`
     对账——`brackets_reflect_subagents: false` 且 `stale_brackets > 0` ⇒ 还有 `--task-end` 没调齐的
     陈旧括号，跑 `--reconcile` 闭合。**反向维度（括号关 ≠ 进程退）**：`closed_but_live_agents > 0`
     ⇒ 有已关括号的 agent 进程仍存在（worktree 未清 / 进程未退）——这些槽不是真空闲，收尾时不把它们
     当空槽。
   - **关红窗遗留括号**：每次收尾 pass 无条件跑一次 `--reconcile`，用可观测证据（分支已 merge /
     worktree 已消失 / 进程已死）关掉 executor 已消失的未闭合括号：
     ```bash
     node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --reconcile --json
     ```
   - **阻塞信号超时自动升级**：没人消费的阻塞信号不无限冻结 inner——对超龄（默认 30 分钟）的 block
     自动归档（记遥测等待时长 + 写 `.quay/blocked-escalations.jsonl` + 移除 block 文件；底层条件若仍
     成立，下一 tick `--detect-stop` 会写新 block 重新验证）：
     ```bash
     node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --escalate-stale
     ```
   - **空槽信号**：读 `--slots --cap <effective_cap>` 的 real-in-flight / slots-remaining——「还剩几个
     并发槽」机械可见，不靠内层手写叙事 markdown；`dispatchable_disjoint − realInFlight` = 槽位级闲置。
   - **留痕**：本轮收尾 pass 结束（含零收尾）后跑
     ```bash
     bash plugin/scripts/closure-lag-check.sh --record --flipped <N>
     ```
     `<N>` = 本轮翻转 done 的任务数（零收尾写 0）。
   - **closure-lag 信号**：每个 tick 跑
     ```bash
     bash plugin/scripts/closure-lag-check.sh
     ```
     退出非 0（not-yet-flipped 超阈值 **或** closure-pass 超时未跑）⇒ 本 tick **报 WARN/事件**，不静默；
     退出 0 ⇒ 静默。信号是**报告不是门控**——不阻塞派发、不阻塞 tick。
3. **全量 suite = 外层后台异步验证 gate（非 inner 同步点、非本 tick 阻塞点）**【AC84 2026-08-15 退役：outer 不跑 suite，正文保留作理由档案，执行核已迁出 → `orchestration/archive/AC58-retired-clauses.md#R32`】：
   - **后台跑**：全量 suite 由本层起 `plugin/scripts/full-suite-runner.ts`（后台 subagent /
     `run_in_background:true`，不阻塞本 tick、不堵 inner），runner 写 `.quay/full-suite-state.json`
     （`{state: running|green|red, reason?, runner: outer|inner, startedAt, finishedAt, durationMs,
     laneCount}`）并把套件输出 tee 到 `.quay/full-suite.log`。当 `--root` 是被测 worktree 时**必须**
     同时传 `--state-dir "$REPO_ROOT/.quay"`（主 repo 闸门位置）。`reason` 只在 red 时出现：
     `failed`（真实失败——stop-dispatch 信号）或 `aborted`（套件未完成、无正确性结论——**不触发停派**）。
     **起跑条件**：本轮收尾了 ≥1 个任务（或自上次完成的全量 suite 起有新的 merge 落地）且当前没有在跑
     的 suite（`state != running`）且资源闸放行（`bash plugin/scripts/resource-gate.sh --for full-suite`，
     退出非 0 = WAIT，下一 tick 再起）。
   - **单文件耗时趋势落历史**：runner 套件跑完自动把**每文件 `{file, duration_ms}`** 追加到
     `.quay/measure-history.jsonl`（append-only，复用 measure-suite-reporter 已 tee 进
     `.quay/full-suite.log` 的 `__PERFILE__` 行）并对比上一轮——单文件耗时增长超基线（相对 ≥2× 或绝对
     >+30s）以 `measure-trend growth <file> <prev> -> <curr> ms (+<增幅>, <ratio>x)` 报出（**报告不
     阻断**）。手动重跑对比：
     `node --experimental-strip-types plugin/scripts/measure-trend-check.ts --history .quay/measure-history.jsonl --json`。
   - **早期 RED**：runner **一检测到失败立即把 state 标成 red**（非等全套跑完）——缩「变红到发现」窗口。
     判红模式 = 结构化失败形态，**不匹配裸字形**（裸 `✖` 会误伤 vitest 假红）：node:test/TAP 的
     `not ok` / `# fail [1-9]` / `# cancelled [1-9]`、vitest 结构化行 `❯ <file> (N tests | M failed)` /
     `Test Files <N> failed`、`FULL-SUITE-EXIT` 非 0，以及兜底退出码非 0。`state: red` + `reason: failed`
     即 **stop-dispatch 信号**（inner 读它停派发 + 暂缓 fan-in）；`reason: aborted` **不是**
     stop-dispatch 信号——inner 照常派发，本层按 aborted 语义处置（记录 + 重跑）。
   - **并发旋钮分叉（同一份文档服务两种测试框架）**：runner 的 `--lane-count` 拼接只对 node:test/test.sh
     项目生效（`--test-concurrency=N`）；**vitest 项目真实文件级并行 flag 是 `--maxWorkers`**，**不是**
     `--test-concurrency`——文档/命令里指导 vitest 项目用 `--test-concurrency` 的地方一律改用
     `--maxWorkers`（`loop.test_command` 由各项目自己定，runner 对非 test.sh 命令不拼接）。
   - **本轮的 suiteGreen**：读 `.quay/full-suite-state.json` 的 `state`——`green` ⇒ true；`running`
     ⇒ true（RUNNING 还没失败，proceed）；`red` ⇒ false；**缺文件 ⇒ true**（外层还没跑第一轮，不阻塞）。
   - **批量合的新鲜度**：批量合只在一个**有效新绿**下进行：`state == green` 且 `finishedAt` 距今 ≤ 窗口
     （默认 3600s）且 suite 开始晚于最近一次 `$MERGE_TARGET` fan-in。机械判定 = `integration-batch-merge.sh`
     自带的 **freshness gate**（默认开启，非自判）；缺 state / 非 green / 旧绿 ⇒ 「无有效绿」，不批量合。
3b. **批量合 `$MERGE_TARGET`→`$FORK_BASELINE`（两线模型）**：
   **suiteGreen 为 true 时**，跑 `plugin/scripts/integration-batch-merge.sh --root "$REPO_ROOT" --develop "$FORK_BASELINE" --integration "$MERGE_TARGET" --sync --reconcile` 把
   已验证的 `$MERGE_TARGET` 批量快进合回 `$FORK_BASELINE`——**`$MERGE_TARGET` 永远是 `$FORK_BASELINE`
   后代 ⇒ fast-forward 无冲突**（`$FORK_BASELINE` 只被外层批量合推进，inner 任务只合 `$MERGE_TARGET`；
   单线下两者同为 master ⇒ 无操作）。`integration-batch-merge.sh` 自带：
   - **pre-check**：`git merge-base --is-ancestor <$FORK_BASELINE> <$MERGE_TARGET>` 非 0（真分歧）⇒
     退出非 0、不移动任何 ref、needs-human——**绝不 blind --ours/--theirs**；
   - **measure**：`git merge-base --is-ancestor <$MERGE_TARGET> <$FORK_BASELINE>` 退出码（band = 0 =
     `$MERGE_TARGET` 的提交已全部并入 `$FORK_BASELINE`）；
   - **invoke**：`git log --oneline $FORK_BASELINE..$MERGE_TARGET`（红窗期不空——`$MERGE_TARGET` 照常接收，
     直到本轮 suiteGreen 才批量合）。
   - **对象闸门（`integration-batch-merge.sh` 自带，`gap-batch-merge-gate-validates-tip-not-merge-result`）**：
     批量合前校验**合并结果**，不是只验 tip——套件测的是 `$MERGE_TARGET` tip，批量合放行的是
     `$MERGE_TARGET` ⊕ `$FORK_BASELINE` 的合并结果，两者只在 `$FORK_BASELINE` 侧无新提交时才等价。
     three-dot 判定（`git diff --name-only <merge-base> <$FORK_BASELINE>` 即 `$FORK_BASELINE` 侧自分歧点
     起的变更）：含代码文件（.ts/.js/.mjs/.sh）⇒ **fail-closed 不移动任何 ref、报出文件清单**——该代码
     从未进过被测树，合并结果会带上未测代码；纯 .md/tasks 文件放行（2026-08-08 报告那 5 个文件）。与
     stale-green 不同轴：那是时间轴（绿旧/树旧），这是对象轴（被测对象 ≠ 被放行对象）。`$FORK_BASELINE`
     侧有代码提交需先 fan-in 到 `$MERGE_TARGET` 补测再批量合。
   - **新鲜度闸门（`integration-batch-merge.sh` 自带，`gap-batch-merge-gate-reads-stale-green`）**：
     批量合前校验绿是**新鲜绿**，不是只读 `state==green`——7b1ac3a1（2026-08-08 06:07:22）在前后零次
     suite 的情况下拿 02:50→03:02 的三小时前旧绿当通行证，测的是完全不同的一批提交。两维都要求：
     **age**（`finishedAt` 距今 ≤ `--freshness-window`，默认 3600s）且 **coverage**（suite 开始时间 ≥
     最近一次 integration fan-in 的 commit time——fan-in 在 suite 之后落地说明绿没测过当前待合 tip）。
     任一违反 / state 非 green / 缺 state 文件 ⇒ **fail-closed 不移动任何 ref**（「无有效绿」）。
     与对象闸门不同轴：本闸门是**时间轴**（绿旧/树旧），对象闸门是**对象轴**（被测对象 ≠ 被放行对象）。
   - **`integration-batch-merge.sh --reconcile`（主检出对账步骤由脚本提供，`gap-batch-merge-reconcile-destroys-uncommitted-work`）**：批量合是
     REF-LEVEL（update-ref CAS，「主检出从不被脚本触碰」）——当主检出正检出的分支就是被推进的
     `$FORK_BASELINE` 时，ref 被从底下换掉后 HEAD/index 变陈旧。**对账步骤由脚本自己提供，调用方不得各自发明**
     （inner 曾发明 `git reset --hard HEAD`，2026-08-08 08:08:24 销毁了 manager 未提交编辑，真实数据丢失一次）：
     ref 移动前先断言 `git status --porcelain` 为空，非空即失败退出并报出属主（不静默毁数据）；合后
     `git reset --mixed <新 tip>` 刷新 index，**绝不用 --hard**（`--mixed` 默认即刷新 index 不碰工作区；
     `--hard` 额外覆盖工作区 = 唯一有害那件，对账不需要它）。**Land 锁边界**：锁防交错不防销毁——
     「拿到锁≠能动工作区」；共享主检出对账不得覆盖共存会话的未提交内容。
   suiteGreen 为 false（red/aborted/缺 state）**或绿不新鲜（stale-green，见上 freshness gate）** ⇒ **不跑批量合**——
   红窗期 `$MERGE_TARGET` 照常接收任务合并，只是 `$FORK_BASELINE` 不推进（结构性消除「红窗必须停派发」；
   `$FORK_BASELINE` 永不从未验证树推进）。旧绿（7b1ac3a1 场景：3 小时前）同样不是有效绿——不批量合。
   **`--dry-run` 先跑**核对 pre-check 与 pending 面，再实跑。
3c. **跨机同步心跳（`sync-lag-check.sh`，兜底必跑——`gap-cross-machine-sync-has-no-mechanism-only-manual-pushes` + `gap-two-peer-quay-developers-continuous-bidirectional-merge`）**：
   每个 tick（含轻触）**无条件**跑一次 `bash plugin/scripts/sync-lag-check.sh --push --branch "$FORK_BASELINE" --root "$REPO_ROOT"`——
   它问「本地 `$FORK_BASELINE` 是否领先 `origin/$FORK_BASELINE`」，领先即 push（复用非强推/幂等的
   `periodic-push-backup.sh` 本体），**不依赖任何完成事件**。这是兜底触发源：3b 的事件驱动路径负责「land
   收口同一轮内推送」的加速，本步负责「万一事件驱动漏了 / 跨机各自主检出悄悄积累」的必跑保底。
   **双向合并的 DOWNSYNC 半（两个对等 quay 开发者，人框架 2026-08-06「两台机器都持续应用最新并在最新上开发」）**：
   同一 tick 里接着跑 `bash plugin/scripts/sync-lag-check.sh --pull --branch "$FORK_BASELINE" --root "$REPO_ROOT"`——
   严格落后（origin 有本地缺的提交、本地无 origin 缺的）即把本地 `$FORK_BASELINE` fast-forward 到
   `origin/$FORK_BASELINE`（把对方最新应用到本地再开发）；真分歧 fail-closed（不盲 `--ours/--theirs`）。
   **同步落后量机械可读（AC3）**：`bash plugin/scripts/sync-lag-check.sh --json --branch "$FORK_BASELINE" --root "$REPO_ROOT"`
   输出 `unpushed` / `behind` / `leads` 字段——「本地领先 origin 几笔」与「落后 origin 几笔」从此有测量，不再靠人 `git log`。
   心跳读 `--json` 的 `leads` 或直接跑 `--push` 均等价（`--push` = 测 + 领先即推）。push 失败（非快进 =
   真分歧）只报告、不覆写、下一 tick 重试——正是 fail-closed 兜底。
3d. **观测者注册表心跳（`observer-registry.sh --audit`，兜底必跑——`gap-observer-registry-target-decommission-and-criterion-invalidation`）**：
   每个 tick（含轻触）**无条件**跑一次 `bash plugin/scripts/observer-registry.sh --audit --json`——
   它问「有没有被登记下线的目标，且所有观测者是否都正确报『已下线』」。被下线的目标写一次在
   `orchestration/observer-registry.conf`（人/管理者显式 `--register-offline`，观测者从不自行猜），
   所有观测者（os-anchor-watchdog）
   从同一处读。`--audit` 是 AC3 负控制：对每个 offline 目标重建消费者读面，任一仍报旧状态
   （REPO-STALL / NOT-WATCHED / GONE / watchdog 复活）即 `stale`、退出 1；
   **`stale_observer_reports` 必须恒为 0（band）**。无新系统 crontab：观测者保留各自既有触发，
   本表只是每次读取时先查；`--audit` 与 `sync-lag-check` 同款双触发源（tick 心跳 + land 后事件驱动）。
3.5 **批量合回 `$FORK_BASELINE`（两线模型的合并机制，`gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point` AC3）**：
    `$MERGE_TARGET` 只从 `$FORK_BASELINE` 长出、只往 `$FORK_BASELINE` 合回 ⇒ 永远是 `$FORK_BASELINE`
    后代 ⇒ **fast-forward 无冲突**。`suiteGreen` 为 true 时，把 `$MERGE_TARGET` 快进合到
    `$FORK_BASELINE`（本层共享检出保持在 `$MERGE_TARGET` 上，`$FORK_BASELINE` 不是检出分支；两线取值
    见 `.quay/config.yml` `loop:` 节，quay 实例 = `fork_baseline: develop` / `merge_target: integration`，
    机制详述见本层状态节引用的 branch-model SPEC）：
    ```bash
    # ff 安全判据：$FORK_BASELINE 是 $MERGE_TARGET 的祖先（$MERGE_TARGET 是 $FORK_BASELINE 后代）
    git merge-base --is-ancestor "$FORK_BASELINE" "$MERGE_TARGET" && git branch -f "$FORK_BASELINE" "$MERGE_TARGET"
    # 等价机械判据（helper CLI）：--is-ancestor <baseline> <merge-target> 输出 ancestor（exit 0）
    ```
    - **`--is-ancestor <$FORK_BASELINE> <$MERGE_TARGET>` 是硬前置**：`$FORK_BASELINE` 不是
      `$MERGE_TARGET` 祖先（两线不变量被破坏）⇒ `git branch -f` 不执行，标 needs-human、按「红窗分诊」
      处置，**绝不自动合**。
    - **红窗期（`state: red`）不做批量合回**——`$MERGE_TARGET` 照常接收 inner 的任务合并（结构性消除
      停派，`fast-mode-loop-tick.md` 步骤 2），`$FORK_BASELINE` 保持冻结，直到下一轮 verification-round 绿。
    - **pending 窗口**：`git log --oneline "$FORK_BASELINE".."$MERGE_TARGET"` 在红窗期应**非空**（Contract
      invoke）——那些正是下一轮批量 fast-forward 的待验证合并。
4. **写轮次记录**：追加一行到 `.quay/verification-round.jsonl`：
   ```json
   {"round": <N>, "at": "<ISO 来自 date -u>", "suiteGreen": <bool>, "closed": ["<id>", ...]}
   ```
   `N` = 上一条记录 `round` + 1（空文件从 1 起）。`suiteGreen` = 步骤 3 读 `.quay/full-suite-state.json`
   的判绿结果。**inner 的停止条件现在直接读 suite-state**（`fast-mode-loop-tick.md` 步骤 3），本文件的
   轮次记录只是收尾记账，不再被 inner 读取：
   - 缺 suite-state ⇒ inner 不阻塞（外层还没跑第一轮）；
   - `state: red` ⇒ inner 停止派发 + 暂缓 fan-in，本层按「红窗分诊」处置（bisect 定位新引入还是既有；
     定位到本轮 merge 引入就回退该 merge + 回退对应翻 done）。
   **收尾记账的机械判据**：本轮 `closed` 非空（≥1 收尾）⇒ **追加前**读 `.quay/verification-round.jsonl`
   尾部 round 得 `last`，断言 `N == last+1`；**追加后**再断言尾部 round == `N`。任一断言失败即**本轮
   tick 异常**，不得静默跳过。本轮 `closed` 为空（无收尾）⇒ **不要求写 jsonl**（负控制）。
5. **落盘聚合**：本轮收尾后跑一次
   `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --snapshot`，
   否则被 git 跟踪的聚合文件不反映本轮结果。
6. **真实下游安装/升级/冷启动验证（real-target verification，`gap-install-upgrade-verification-targets-real-downstream-workspaces`）**：
   安装/升级/冷启动验证不再只跑 mkdtemp 合成夹具（`install-config-driven-e2e.test.mjs` 是 **synthetic** 线）——
   每个验证轮对**真实下游**（真实目标清单 = 各工作区自己的策略，见 §1 的 `<目标项目根清单>` /
   `QUAY_REAL_TARGETS`）跑一次**只读**升级检查，报结论：
   ```bash
   for t in <目标项目根1> <目标项目根2>; do     # 目标项目根清单见 orchestration 副本「本层状态」节
     bash plugin/scripts/real-target-verify.sh --target "$t"
   done
   ```
   - **只读**：脚本对真实工作区跑 `quay init --loop --dry-run`（同一升级面，写全为 `would-*`），报
     `real_target_verified: verified|conflict|fail`；**synthetic 绿不再当作真实下游也绿的证据**。结论行
     前缀 `[real-target]`，与 synthetic 线分开标注。
   - **落盘**：每条结论追加一行到 `.quay/real-target-verification.jsonl`。
   - **结论不是闸门**：真实目标验证是**有机状态探测器**，结果进轮次记录与 tick 报告，不阻断派发/合并。

**套件状态自动触发者（红窗执行者层）**【已退役：Monitor 挂载移除（`gap-retire-outer-monitors-after-reconciler`），正文保留作理由档案——`suite-state-trigger.ts` 仍作共享库被 `full-suite-runner.ts` import】：`suite-state-trigger.ts`（Monitor，冷启动 4b2 挂上）在
`.quay/full-suite-state.json` 的 `state` **变化**时立即发事件（5 秒轮询，≪ cron 的 20 分钟窗口）并记
`.quay/suite-state-events.jsonl`（append-only）：

| 状态变化 | 事件 | 本层动作（全部是既有逻辑的执行，不是新决策） |
|---|---|---|
| → `red` + `reason: failed`（或缺失） | `SUITE-RED`（`stopSignal:true` 确认 stop-dispatch 信号在位；**携带失败位置** `failureLocation` = `state.failures` 的分类：共享闸门 vs 具体测试文件） | **立即**进下面的「红窗分诊」（不等下一次 cron；**派发停/续按失败位置条件化**——共享闸门（`run_static_checks`）⇒ 停；具体测试文件且与新任务触摸集无关 ⇒ 续） |
| → `red` + `reason: aborted` | `SUITE-RED`（`stopSignal:false`——套件未完成、无正确性结论，**不触发停派**） | **记录 + 等重跑**：不挡 inner 派发；re-tick 时按起跑条件重起 |
| → `running` | `SUITE-RUNNING` | 「RUNNING 乐观派发执行者」：池有 `dispatchable_disjoint ≥ cap` 就按步骤 4 驱动 inner 照常派发（不待轮——(a) 块 AC4 的乐观行为被实际动用，AC3） |
| → `green` | `SUITE-GREEN` | 平静基线，无处置 |

**空槽状态自动触发者（空槽事件执行者层）**【已退役：Monitor 挂载移除（`gap-retire-outer-monitors-after-reconciler`），正文保留作理由档案——空槽现由 driver 每趟 pass 现读 ready 池接管】：`slot-free-trigger.ts`（Monitor，冷启动 4b3 挂上）在
`in_flight < cap ∧ dispatchable > 0` **成立时**立即发事件（5 秒轮询）并记 `.quay/slot-free-events.jsonl`
（append-only）：

| 条件 | 事件 | 本层动作（全部是既有逻辑的执行，不是新决策） |
|---|---|---|
| `in_flight < cap ∧ dispatchable > 0` | `SLOT-FREE`（携带 `slots_free` / `dispatchable_disjoint` / `in_flight_count` / `at`） | **立即**驱动 inner 回填（不等下一次 cron）：按步骤 4 从 `slot-refill.ts` 的 `recommended` 取 1-2 条派给 inner——同一空槽强制链 |
| 非 `in_flight<cap ∧ dispatchable>0` | 无 | 平静基线，无事件（负控制；`.halt` 在场同样不发） |

**触发者是执行者，不是新调度源**：它只做「状态变化 → 事件」的翻译与通知，不做任何分诊/派发决策；
分诊 = 本文件下方既有「红窗分诊」，派发 = inner 出厂文档既有 §4 规则。节奏仍唯一（步骤 4 的 `*/20`
cron）。**触发链自检**：
`node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --fail-fast-check`
（构造失败 suite ⇒ state=red ⇒ SUITE-RED 事件 ⇒ stopSignal 在位 + failureLocation 携带，退出 0 = 链完好）。

**红窗分诊（外层独占，AC4——只停派发不停在飞合并会让红树继续累积，故 RED 失败时 fan-in 一律暂缓）**【AC84 2026-08-15 退役：outer 不跑 suite、输入消失，正文保留作理由档案，执行核已迁出 → `orchestration/archive/AC58-retired-clauses.md#R33`】：
`.quay/full-suite-state.json` 的 `state: red` + `reason: failed`（或缺失）即 **stop-dispatch 信号在位**。
**派发停/续按失败位置条件化**（与 `fast-mode-loop-tick.md` 步骤 3 同一份规则，不是两份）：
- 失败落在**共享闸门（`run_static_checks`——每次 scoped 运行都跑的静态检查）** ⇒ **停新派发**；
- 失败落在**具体测试文件**且与新任务触摸集**无关** ⇒ **派发继续**；
- 失败文件与新任务触摸集**相交** ⇒ 该任务停派。
无法判定 ⇒ 保守停派发（fail-closed）。**fan-in 一律暂缓**。`reason: aborted` **不触发停派**。state 为
red 时：
1. **本层独占分诊**，不把红树丢给 inner：对 red window 内新合并的 merge 二分定位（`git bisect` 或按
   merge 顺序回滚、逐个重跑 `--for-task` 选中集判断肇事者）。
2. **回滚/修复**：定位到某次 merge 引入 → 回退该 merge（+ 回退对应翻 done）；判定为既有失败 → 建任务。
   **state: red 期间本层不自动重启套件**——先分诊，修好才重启。
3. **重启套件**：修复后重新起 `full-suite-runner.ts`（state → running）。
4. **重新 green**：runner 完成且绿 ⇒ state → green。
5. **撤信号**：state 回到 green/running 即撤——inner 恢复派发与 fan-in。

**阈值决策规则（门槛机械化）**：测全量套件耗时 `suite_duration` = `.quay/full-suite-state.json` 的
`durationMs`（runner 每次跑完写入，即测量 hook）：
- `suite_duration ≥ 3 分钟` ⇒ **outer 集中后台跑**（当前形态，实测 11-12 分钟量级）；
- `suite_duration < 3 分钟` ⇒ **下放 inner 各任务自己跑**（批概念彻底消除）。
规则在内外层 loop 文档各写一份；每次全量 suite 的 `durationMs` 就是判定输入。

**三块消除批次**：本条是 **(a) 套件块**；收尾/记账 **(b) 块** = `gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async`（已落地）；AC/证据 **(c) 块** = `gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence`（在队列）。三块合起来，inner
侧只剩「执行 → 合并」，没有任何批次同步点。

### 1c. 重锚转发（re-anchor，强制——机制不是散文）

**给 inner 一个独立于外层措辞的周期锚。** 背景：inner 的 Cron 调用数 = 0、整晚驱动全来自外层 send-keys
散文，而外层自己每 20 分钟被 cron 强制重读出厂文档——**锚点不对称是 inner 行为漂移的结构根**。R2（驱动
散文只带数据不带行为）管散文别越权；本步管「散文之外还有周期锚」。

**机制 = 用本层已有 cron 转发一条固定重锚 prompt，不是给 inner 另建 cron、不是每次现写散文：**

1. **判空闲才转发**：本 tick 已判 inner 空闲才转发（「空闲」按本层既有观察判据：pane 状态两次相同、
   且遥测无在飞任务 bracket、且不是 `ruling-required` 等待人类裁定——忙时不打扰）。**重锚量上界 =
   空闲时长**，外层 cron（`*/20`）仍是唯一节奏源。
2. **转发固定常量，逐字原样**：转发的文本 = `plugin/scripts/reanchor-prompt.txt` 的内容，
   **逐字原样**（`cat plugin/scripts/reanchor-prompt.txt` 读出来发），**不是本层现写的新段落**。
   送达**优先原生跨会话 SendMessage；不可用时回退既有 send-keys 信道**（`C-u` → 常量文本 → `Enter`，
   三次分开调用；发完 `capture-pane` 确认出现新的 `⏺` 输出——未确认送达的重锚等于没发）。
3. **唤醒契约 = 一致性核对，不是调度**：重锚 prompt 是「重读出厂 `fast-mode-loop-tick.md` + 按「状态
   自检清单」核对当前状态是否符合（在飞 / 就绪池 / 收尾 / 停止条件四查）+ 明确偏差向文档自我修正」。
   它**零派发指令**——机械保证是 grep 断言：
   `grep -n '派发\|排序\|batch\|批' plugin/scripts/reanchor-prompt.txt`（期望 0 命中）。
4. **偏差修正若需派发，逐字照搬出厂文档自己的派发规则**（文档是唯一规则源）：重锚 prompt 不做新决策。
5. **每个 tick 必报**：本轮是否转发重锚、转发时 inner 的空闲判据。

**重锚有效性 = 语义收敛（自述措辞审计）**：重锚的有效性以**语义收敛**度量（`reanchor_effectiveness_is_convergence = 1`），不是「重锚发生了」——
锚点通道存在 ≠ 词汇收敛。**doc-side 与 audit 双侧成对、缺一不可**：出厂措辞由词汇规范任务
（`gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round`）落到 doc-side，本步审计负责机械判据——
**单独做任一条都解决不了**：只改文档不跑 `self-report-vocab-audit` 审计，内部化的 batch 措辞不会收敛；只跑审计不订正措辞，每轮都报漂移。
每次重锚后对 inner 最近自述（commit subject / fan-in 注记 / 收尾汇报）跑
`node --experimental-strip-types plugin/scripts/self-report-vocab-audit.ts --git-log 15
--exclude-prefix outer: --window 3 --json`，读 stdout 的 `inner_self_report_vocab` 字段（连续 3 轮无
batch 式自述 = 收敛）与 `converged`。「Batch of N fully merged」式门控汇报 = 漂移（被审计标记）；
verification-round-N / 滚动派发语义 = 合规。**每个 tick 必报**本轮 `inner_self_report_vocab` 与收敛状态。
同一 tick 也跑 `plugin/scripts/self-report-vocab-check.ts --root "$REPO_ROOT" --json`（读 `count` 与
`converged`）——`count > 0` = inner 自述出现「Batch of N fully merged」/批次编号式汇报 = **门控语义漂移**，
记入本轮 tick 并驱动 inner 按出厂词汇（`fast-mode-loop-tick.md` 的词汇规范节）修正；`converged: true`
（连续默认 3 轮无 batch 式汇报）才算收敛，状态存 `.quay/self-report-vocab-state.json`（gitignored 运行时态）。

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

### 外层的价值来自视角，不是来自更聪明

跑满一轮后（13 个 tick：`no-action` 4 / `unblock` 3 / `correct` 4 / `escalate` 2），四次 `correct`
的共同点**不是外层想得更深**，而是：

- **外层对「这个任务完成」没有利害关系**。内层在一件事上投入 1 小时后，倾向于接受让它变绿的解释；
  外层没有那个沉没成本。
- **决定性的那一步都很便宜**。最大的一次纠偏只需要单独跑一个测试文件、读一遍测试名。**不是难的推理，
  是没人在赶工时会做的推理**。

**因此不要把外层当成「更强的模型来兜底」。** 外层同期也犯了同一类错误。**更强的模型减少不了这类错误，
换个视角才能。**

**这条直接决定了两件事**：（a）`correct` 占比升高时该修内层的判据（上面那条），而不是给外层加算力；
（b）阶段产品化时，双层机制的卖点应写成**独立视角 + 无沉没成本**，而不是「用更大的模型监督小模型」。

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

- 候选：`status: todo` 或 `ready` 且带 `milestone-candidate` 标签。
- 依赖就绪：父任务 done、无未满足前置。
- 并发资格：`checkTouchesPair`（`plugin/scripts/touches-orthogonality-check.ts`）对**所有在飞任务和彼此**
  两两检查，重叠则不同时派发（**分派是滚动的，不是攒批门控**）。
- 优先级：阻塞其它任务的优先；`gap-*` 缺陷类优先于 `DIR-*` 新能力。
- **跨机在飞（两机协作）**：两机协作时（`QUAY_CLAIM_REMOTE` 指向共享裸仓库），**另一台机器的在飞任务 =
  共享仓库上存在的 `task/*` 分支**——候选与跨机在飞任务触摸相交（用内层同源 `plugin/scripts/claim-task.ts` /
  `checkTouchesPair`）或已被对方认领 ⇒ **不补进队列**。单机（未设置 `QUAY_CLAIM_REMOTE`）⇒ 本条为
  no-op，行为不变。

**就绪池维持分两个操作，职责切分**：

| 操作 | 判据 | 职责 |
|---|---|---|
| **补充 refill**（维持数量） | `pool < floor`（=cap×4） | **内层** tick 步骤 3.6 的机械产品机制 |
| **定向晋级 targeted**（维持对齐） | 阶段目标要它 | **外层**选择（`ready-pool-check.ts --targeted <id>` 机械校验 + `quay promote <id>`） |

**内层不知道阶段目标，这是对的**——它只按机械判据运行。补充 refill 是内层机械产品机制；定向晋级
targeted 是外层选择（不受 `pool<floor` 门约束）。把补充结果写进队列状态文件，指示内层派发。

### 4a. 驱动文本只携带数据，不复述行为（外层裁定 R2）

给内层下指令时，**驱动文本只携带数据，不复述行为**：

| 随文本过去（数据） | 不随文本过去（行为） |
|---|---|
| 任务 id、裁定结论、依赖事实 | 怎么派发（并发/串行）、worktree 位置、纪律清单、并发上限 |
| 需要裁定的问题 + 选项 | 出厂 `fast-mode-loop-tick.md` §4 已供给的一切 |

行为一律由出厂文档供给——出厂文档的行为错了就**改文档**，不用散文覆盖。

**自检清单（列任务时二选一，缺一即违规）**：

1. **不定顺序**——只给任务 id 与依赖事实，顺序由内层按出厂文档 §4 的并发规则自行决定；或
2. **要定顺序就附 `checkTouchesPair` 实际输出**，且顺序断言与 pair 输出必须在**同一条驱动文本**里
   （位置判据）：
   ```text
   A-D: {"disjoint":true,"overlaps":[],"reason":"disjoint file-sets"}   # 机械证据
   ```

若上一 tick 的驱动文本被内层**标注了「与出厂派发契约矛盾」**，本 tick 先按标注修正文本再继续派发。

### 4b. 「在飞」词汇拆分 + 输入框纪律

**「在飞」拆为三种含义，报告/队列状态里分别标注**——混用会让并发指令看起来已满足：

| 词 | 含义 | 用什么核实 |
|---|---|---|
| **遥测括号在飞** | `--task-start` 已写、`--task-end` 未写 | 遥测 `inProgress[]` / START 事件——START **只证括号在飞，不证 subagent 在飞** |
| **真实在飞** | 括号里 executor **仍可观测存在**（进程/打开 worktree/分支未 merge）——扣掉红窗遗留 | 遥测 `--report --json` 的 `realInFlight` / `--slots` 的 real-in-flight（reconcile 感知） |
| **subagent 在飞** | 内层真的起了后台 `Agent(run_in_background)` | **读原始 Agent 工具调用的 `input.run_in_background` 字段**（transcript 查询）——唯一可靠判据 |

**外层核实并发必须读原始字段，不得用 START 事件或 pane UI 文字。** 报告/队列状态里分别写「括号在飞
N」「真实在飞 M」「subagent 在飞 K」，不合并成一个「在飞」。

**槽位视角**：外层不再依赖内层手写叙事 markdown 才知道「还剩几个并发槽」——纯读命令直接给：

```bash
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slot-status --cap "${effective_cap:-3}" --root "$REPO_ROOT" --json
# real_in_flight / stale_brackets / slots_free（= max(0, cap − real_in_flight)）；brackets_reflect_subagents
```

- **`slots_free` = 空槽数**。
- **`stale_brackets > 0` ⇒ 收尾没关括号**——跑 `--reconcile` 闭合。
- **`brackets_reflect_subagents: false` ⇒ `--task-start`/`--task-end` 对没调齐**。

**输入框是待提交缓冲区，不是笔记本**：

- **不得把下一步备忘写进自己的输入框。** 入队的 prompt 会与框内残留文本拼接成乱码。下一步备忘一律落
  队列状态文件或 tick-log。
- 输入框**用完即空**（`C-u`）。
- **每个驱动回合结束由外部观察者确认框空**——**问责对象是「框里有文本」这一状态，不是「谁写的」**。

### 4c. 外部自食例行观察（external-dogfooding routine，常驻发现通道）

**这是外层对常驻外部自食例行的观察位**——例行本身（调度 / 派发 / 闸门 / FILE-ONLY）由内层
`fast-mode-loop-tick.md` §3.7 承载；外层只确认契约没烂、发现还在流动。该例行是 loop 对外部真实目标
的 pre-friction 发现通道。

- **契约观察**（机械，fail-closed）：
  `node --experimental-strip-types plugin/scripts/external-dogfooding-check.ts --selftest`
  自检 + 契约四项（cadence / 外部目标可驱动 / remote-drive 表面 / 发现形状）。契约不满足 = 例行退化 →
  按本步必报上报并进升级路径，不静默跳过。
- **发现观察**：例行 DUE 时内层 §3.7 派发。外层看 `routine-file-gate` 是否放行了新 `label:directive`
  发现（队列里多出来的新任务文件）：有 = 通道在流动；长期零发现且契约绿 = 通道可能空转。
- **单驱动纪律**：外部工作区一次只有一个驱动者——先确认没有在飞例行在驱动它；否则只观察不驱动。

### 5. 升级（攒起来，不打扰）

以下**不自行决定**，写进 `orchestration/escalations.md` 等人：

- 同一失败在外层消解后**再次出现**——循环不收敛，不是单点故障。
- 需要改变**方向或范围**的决定（不只是解阻塞）。
- 外层自己的停止条件触发（见步骤 7）。

每条升级要写：现象、外层已尝试什么、为什么超出授权、建议的两个以上选项。

### 6. 学习：更新目标与方法的描述

**每个 tick 都要问**：这一轮看到的东西，是否改变了我们对目标或方法的理解？

若是，更新对应文件并提交：

- `orchestration/<阶段目标>.md` —— 目标、AC、DoD 的修正。
- `docs/analysis/fast-mode-loop-tick.md` —— 内层机制的修正。
- 本文件 —— 外层机制的修正。

**这是机制的一部分，不是可选项。** 不写下来，下一个 tick 或 `/clear` 后的会话会重犯。修正时**必须
写明是什么证据推翻了原判断**，不只是改结论。

### 7. 外层自己的停止条件

**连续 3 个 tick 没有推进任何任务状态** → 停止 loop，叫人，附上三次 tick 各自看到了什么。

「推进」的定义：有任务状态变化、有 commit 落地、或有升级项产生。三次都是 `no-action` 且内层无进展
= 系统卡住了，不是在正常工作。

### 8. 写回并重新排程

**时刻必须来自 `date -u`，不许估。** 早期审计发现 tick-log 的时间列是手写猜测的，偏了近 **4 小时**
且是**未来时刻**，导致时间列非单调、整列不可信——而它正是退化判据的依据。**写任何时刻前先跑 `date -u`。**

- 更新 `orchestration/tick-log.md`：时刻（`date -u '+%H:%MZ'`）、动作类型、做了什么、内层状态快照。
- **写完必须验证写进去了——验证读磁盘文件，不读 git。** 插入前 `assert 锚点 in 文本`，插入后
  `tail -3 orchestration/tick-log.md` 断言行数/新行在场。
- **累计分布不要手工加减**——从行数重算。这与内层 tick 文件「全局量必须运行时计算，不得写成常量」是
  同一条规则。
- **重新排程由步骤 4 的 `CronCreate` 接管**：它按 `*/20` 固定间隔自动触发，不需要每 tick 手动排下一程。

## 每个 tick 必报

- 动作类型（`no-action` / `unblock` / `correct` / `escalate`）。
- Routine 检查（步骤 1a）：DUE 名单 / 无 due；各 routine 距上次运行分针数；是否有 STALE（> 2×interval）。
- 独立核实了内层的哪一项声称，结果如何。
- 内层在飞任务数与各自已运行时长。
- 遥测当前：任务数、均耗时、`tasksPerHour`。
- 异步收尾例程（步骤 1b）：本轮收尾几条、`.quay/full-suite-state.json` 最新 `state`（green/red/running）
  与 `durationMs`、本轮全量 suite 是否在跑/绿/红。
- 累计动作类型分布（退化判据）。
- ~~Monitor 两判据~~（已退役 2026-09-03：monitor-mount-check 已删除）。
- 自述措辞审计（步骤 1c）：本轮 inner 自述 `count`（batch 式汇报数）与 `converged`（重锚收敛判据）。
- `external-dogfooding` 例行（4c）：契约四项是否绿、是否 DUE、本窗口是否产了新 `label:directive` 发现。

不要只说「内层在跑」——没有这些，分层是否有效无法判定。

## 相关文件

| 文件 | 作用 |
|---|---|
| `orchestration/orchestrator-tick-core.md` | 外层执行核（每轮实际动作清单） |
| `orchestration/<阶段目标>.md` | 目标、AC、DoD |
| `docs/analysis/fast-mode-loop-tick.md` | 内层 tick 指令（产品模板铺到本路径） |
| `docs/analysis/batch2-queue-state.md`（文件名历史引用——batch2 是旧批次名） | 队列状态（内层写，外层读+补） |
| `orchestration/escalations.md` | 攒给人的非常规项 |
| `orchestration/tick-log.md` | 每 tick 记录 |
| `.quay/full-suite-state.json` | 外层后台全量 suite 的状态（gitignored 运行时态，步骤 1b 由 full-suite-runner 写） |
| `.quay/suite-state-events.jsonl` | 套件状态转变事件日志（gitignored 运行时态，`suite-state-trigger.ts` 写） |
| `.quay/slot-free-events.jsonl` | 空槽事件日志（gitignored 运行时态，`slot-free-trigger.ts` 写） |
| `.quay/verification-round.jsonl` | 外层异步收尾的轮次记录（gitignored 运行时态，步骤 1b 写） |

> **本文件是产品模板**：具体项目（quay 自身网络）的实例状态、既有裁定、各 AC 进度，见该项目
> `orchestration/orchestrator-loop-tick.md` 副本（quay 自身即 `orchestration/orchestrator-loop-tick.md`）。
