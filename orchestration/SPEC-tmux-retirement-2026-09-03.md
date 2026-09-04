# SPEC：tmux 退役 —— 先退 tmux 机制本身，outer 会话留待之后
（**标题为 2026-09-03 首版历史留痕，已被 2026-09-04 裁定推翻**——outer 的 tmux 依赖不是
"留待之后"，是直接删除，见下方"人 2026-09-04 第三批裁定"与 §1.4）

**作者**：manager｜**日期**：2026-09-03（2026-09-04 大幅修订）｜**状态**：**执行中——任务 6
已 done；原任务 1-5 因架构方向调整（见下方"人 2026-09-04 第三批裁定"）已作废，§7 已按新方向
重新拆解为任务 1-4/6/7（新任务编号，与原编号不再对应）；任务 7 未开始**
**来源**：人 2026-09-03 明确裁定策略顺序——**先退役 tmux，再退役 outer**（推翻此前"outer 职能
subagent 化 → tmux 依赖自然消失"这一隐含顺序）；本 SPEC 是该裁定的具体展开。
**前置澄清（同日，已向人核实并更正两次误判）**：
1. 本 SPEC 与 `experiments/quay-perpetual-stream/OUTER-LOOP.md`（milestone/VT 驱动，已停摆 32 天
   的那套机制）**无关**——那是完全独立的另一套系统，处理方案见
   `experiments/quay-perpetual-stream/VT-MECHANISM-RETROSPECTIVE.md`（同日已归档）。
2. 本 SPEC 针对的是**三层架构（manager/orchestrator/fast-mode）里真正的 tmux 依赖**——
   `orchestrator-tick-core.md`（标题即"outer tick"）+ 全仓库实际调用 tmux 命令的生产脚本。

**人 2026-09-03 第二批裁定（五条，回答了当时 §5 全部开放问题,原文照录，部分已被下方第三批
裁定进一步修正——见各条标注）**：
1. manager 也应删除 tmux 依赖。实际上，虽然人现在的确在用 tmux 访问 Claude Code，但 manager
   已经是一个 Claude Code 后台会话，不依赖 tmux。
2. ~~outer 继续 CronCreate/ScheduleWakeup 持有自己的锚。~~ **已被第三批裁定推翻**——outer 不再
   需要独立会话/独立锚，见下方 §1.4。
3. ~~outer 长驻会话通常由手工退出。不要搞复杂，只要能稳定启动即可。~~ **原句仍然成立，但适用
   对象变了**——不再是"outer 长驻会话"（outer 不再独立存在），而是"manager 长驻会话/drivers
   进程"同样适用"手工退出、不要搞复杂"这条精神。
4. 取消 `session-liveness.sh`。（不变，已执行完成，见任务 6）
5. 不要碰当前的 tmux 会话。那是人工启动的。（不变）

**人 2026-09-04 第三批裁定（架构方向的根本调整,推翻本 SPEC §3 Layer 3 此前的技术路径）**：
人描述了期望的 quay 启用典型流程——① user scope 安装 quay ② 在目标项目**手动**启动 Claude
Code（用户自己决定用什么方式启动，quay 不管这一层）③ 在该会话**内**调用一个
skill/subagent/mcp/workflow 初始化 quay（建 `.quay`/`tasks`/git branches）④ 在会话内调用
skill/subagent/mcp/workflow 启动 drivers + web server ⑤ 在会话内调用 skill 启动 quay
manager（④⑤可合一）⑥ 可以在一个项目里启动多个 Claude Code 会话/多个 manager。

**这与本 SPEC 原 Layer 3 的技术路径（"让 `quay-topology.sh`/`manager-start.sh` 自动
`tmux new-session` 换成自动 `claude --bg`"）方向不同**——原方案仍然是"脚本自动创建新会话"
的思路，只是换了建会话的 API；人描述的模式核心是"用户手动开会话 + 会话内调用 skill 激活角色"，
根本不需要一个脚本去自动创建新会话。**本 SPEC 已按此调整**：
- **outer 作为独立会话角色被撤销**——人的 5 步流程里没有"启动 outer"这一步，与已确立的
  AC145-149 方向（outer 职能 subagent 化，并入 manager 直接驱动）吻合。原第二批裁定 #2/#3
  为 outer 保留的独立 CronCreate 锚、`claude --bg` 迁移设计**整体撤销**——outer 相关 tmux
  依赖（`quay-topology.sh` 的 outer 窗口建立、`outer-session-check.sh`、`topology-check.sh`）
  **直接删除，不是改造**。
- **manager/drivers 的启动机制方向调整**：从"外部 CLI 自动建 tmux 会话"改为"新增 skill，
  让用户手动启动的当前会话激活为对应角色"。详见下方 §1.4/§3 Layer 3（已重写）。

---

## 0. 一句话

**把"如何拥有一个 manager/drivers 在运行"这件事,从"外部脚本自动 `tmux new-session`/`new-window`
建一个新会话"改造成人实际在用的模式——人自己决定怎么启动 Claude Code 会话（tmux 也好、
`claude --bg` 也好，quay 不管这一层），然后在该会话【内】调用 skill 把当前会话激活为对应角色
（初始化 quay / 启动 drivers+web server / 变身为 manager）。outer 作为一个需要独立生命周期的
会话角色被撤销——它的职能已并入 manager 的直接 subagent 派发（AC145-149），其 tmux 依赖直接
删除，不再设计迁移路径。tmux 只保留在 ADR-016 已经圈定的、无替代路径的边界用途（控制面斜杠命令
/ 下游不支持原生通道的环境）+ 人工手动使用的会话（不属于本 SPEC 处理对象）。**

---

## 1. 为什么现在是可行窗口（ADR-016 从未讨论过的第三个选项）

### 1.1 ADR-016 只比较了两个选项，缺了一个

`adr/ADR-016-cross-workspace-autonomous-operation-via-tmux-remote-drive.md` 的"Alternatives
rejected"只讨论了两个候选：

| 候选 | 拒绝理由 |
|---|---|
| tmux remote-drive | （被选中，未拒绝） |
| `claude -p`（headless streaming） | 三条硬约束（2026-08-04 Amendment 修正版）：①`Monitor` 完全不可用 ②`CronCreate`/`CronList` 是会话作用域，会话退出即消失 ③后台进程在最终结果返回+stdin 关闭后 ~5 秒被杀（v2.1.163+） |

**ADR-016 成文（2026-07-22，修正 2026-08-04）时,"Claude Code background job session"这第三种运行
模式尚未被纳入讨论**——它既不是 tmux 交互式会话,也不是 `claude -p` 一次性/streaming headless 模式。

### 1.2 manager 自己就是这第三个选项的活证据,且三条硬约束都不成立

manager（本会话）以 background job 模式运行，实测：

| ADR-016 对 `-p` 的三条硬约束 | background job 模式下的实况 |
|---|---|
| ① `Monitor` 完全不可用 | **可用**——manager 系统提示列出 `Monitor` 为可调用工具 |
| ② `CronCreate`/`CronList` 会话作用域,退出即消失 | **不成立**——`~/.quay-global/manager/loop-registry.txt` 实测存在一条存活的 cron 记录（`cron:ebb2a312`，`verified:2026-08-29T15:02:10Z`），距今 5 天仍在，manager-tick-core.md A19 全套锚点验证机制都是针对这个真实存在的 cron 写的 |
| ③ 后台进程 ~5 秒后被杀 | **不成立**——manager 本会话已持续运行远超 5 秒,且有 `ScheduleWakeup` 工具支持的显式"下次唤醒"机制,不依赖后台进程存活 |

**结论：ADR-016 拒绝 `-p` 模式的三条理由,在 background job 模式下全部不成立**——因为
background job 不是 `-p`（一次性/streaming print 模式），是运行时具备完整工具集（Monitor/
CronCreate/ScheduleWakeup/SendMessage）的另一种会话形态。ADR-016 的"tmux 是当时唯一可行选择"
这个结论,建立在一个当时确实成立、但现在已经不成立的前提上。

### 1.3 manager 本身尚未真正退役 tmux——§1.2 的"活证据"是本次对话的个例，不是系统性事实
（本节已按 subagent 核实结果更正，纠正本 SPEC 早期草稿的一处误判）

manager（本会话）确实以 background job 模式运行，§1.2 的三条实测（Monitor 可用/CronCreate 存活
5 天/无 5 秒杀进程限制）都真实成立——**但这只证明"background job 模式技术上可行"，不能反推出
"manager 这个角色已经完成了从 tmux 到 background job 的迁移"**。`plugin/scripts/manager-start.sh`
（`quay manager start` 的当前生产实现）逐行核实（agent 调查 §2.3③）显示它**仍然真实执行
`tmux new-session -d -s $SESSION -n manager "$LAUNCH_CMD"`**——即按常规路径启动的 manager 依然是
一个 tmux 会话。本会话大概率是被人用 `claude --bg` 或类似方式**单独启动、绕开了 manager-start.sh
常规路径**的一次个例，不代表 manager 角色的标准启动方式已经改变。

**旁证（实测,同日）**：`tmux list-panes -t quay-manager` 显示该 tmux 会话的 pane 内容是空白的，
其 `pane_start_command` 是一个测试 fixture 探针（`bash -c 'exec -a claude-probe sleep 10000 &
wait'`，cwd 指向一个具体 task worktree）——即当前那个按常规路径建出来的 tmux 会话，此刻被一个
**测试遗留的孤儿进程**占据（同族缺陷，见
`gap-suite-load-sampler-orphan-process-blocked-suite-interruption`）。这个旁证原先被误读为
"manager 已经不依赖这个 tmux 会话"，但更准确的解读是：**这个 tmux 会话本该运行真正的 manager，
现在却是空的——是常规启动路径的一次异常/未清理，不是该路径已被淘汰的证据。**

**这一节的更正意味着**：Layer 3 的改造范围不能只覆盖 outer,还需要覆盖 manager 自身的常规启动
路径（`manager-start.sh`）——manager 用 `claude --bg` 启动"技术上可行",与"`manager-start.sh`
已经支持这样做"是两回事,后者从未被改造。

**人 2026-09-03 裁定（第二批 #1）：manager 也应删除 tmux 依赖，确认纳入本 SPEC 范围。** 人明确
指出当前用 tmux **访问** Claude Code（人自己 attach 进某个 pane 查看/交互）与 manager **本身**
是否依赖 tmux 是两件事——manager 已经是一个 background job，不依赖 tmux 运行；`manager-start.sh`
仍建 tmux 会话是该脚本本身滞后于事实，需要改造以匹配已经成立的事实，而不是"要不要迁移"这个问题。
Layer 3 因此明确覆盖 manager + outer 两个角色（原 §5 开放问题 #1 已解决）。

### 1.4 第三轮（2026-09-04，本次更新）：真实使用流程 vs 当前实现的落差——推翻"outer 也要
`claude --bg` 迁移"这个此前的技术路径

**§1.3 与本节之前的全部分析,都建立在一个隐含假设上：manager/outer 各自需要一个"脚本自动创建
新会话"的启动路径,只是把建会话的手段从 `tmux new-session` 换成 `claude --bg`。** 人描述了
实际期望的启用流程后，这个假设被证明是错的——真实流程里**没有任何一步是"运行一个脚本、脚本
自动建出一个新的 Claude Code 会话"**：

```
① user scope 安装 quay（npm i -g，一次性，与会话无关）
② 人【手动】在目标项目启动一个 Claude Code 会话——用什么方式启动是人的自由
   （交互式 `claude`、`claude --bg`、tmux 里开、IDE 里开，quay 不管这一层）
③ 在该会话【内】调用一个 skill/subagent/mcp/workflow 初始化 quay
   （建 .quay / tasks 目录 / git branches）
④ 在该会话【内】调用一个 skill/subagent/mcp/workflow 启动 drivers + web server
⑤ 在该会话【内】调用一个 skill 启动 quay manager（④⑤可合一）
⑥ 按需在同一项目里手动开多个 Claude Code 会话/多个 manager
```

**关键差异**：③④⑤都是"当前会话内调用一个动作"，不是"启动一个新会话"。人从头到尾只手动
开过【一次】会话（②），后续全部动作都在这个会话内完成。**这与 Layer 3 原设计的"`quay-topology.sh`
自动 `tmux new-window` 建 outer 窗口 / `manager-start.sh` 自动 `tmux new-session` 建 manager
会话"完全是两种模式**：前者的会话生命周期属于人（人决定何时开、开几个、用什么方式开），quay
只负责"在已经存在的会话里，把它变成某个角色"；后者的会话生命周期属于脚本（脚本决定何时开新会话）。

**outer 在这个流程里不出现**——人的 5 步流程只提到"drivers + web server"和"manager"两个
需要启动的东西，没有第三个"outer"。这与已经确立的 AC145-149 方向（outer 职能已经 subagent
化、并入 manager 的直接派发）一致：**outer 不是"这次决定不做迁移，留到以后"，是它作为一个
独立会话角色的存在本身已经没有必要**——不需要给它设计任何启动机制（tmux 也好、`claude --bg`
也好），因为不会再有代码去"启动 outer"这个动作。

**因此，本 SPEC 原 Layer 3 item 2-4（`quay-topology.sh` 新增 outer 的 `claude --bg` 分支 /
outer 独立 CronCreate 锚武装 / outer 手工退出语义）整体撤销**，替换为：outer 相关 tmux 依赖
（`quay-topology.sh` 的 outer 窗口建立逻辑、`outer-session-check.sh`、`topology-check.sh`）
**直接删除**（不迁移、不改造），因为它们观测/驱动的对象（outer 会话）本身不再会被创建。

**manager/drivers 呢？** 同样不需要"脚本自动建新会话"——但 manager/drivers 与 outer 不同的
地方在于：它们的**职能**（① tick 循环 ② 派发子任务）仍然是必要的，只是"如何拥有一个正在运行
它们的会话"这件事的设计要改——不是脚本自动建会话，而是**新增一个 skill，让人已经手动启动的
当前会话，调用这个 skill 把自己"变成"该角色**。这是本 SPEC 剩余部分的核心设计对象，见下方
Layer 3（已按此方向重写）。

**这也解释了 §1.3 里"manager 本会话大概率是被人用 `claude --bg` 单独启动、绕开 manager-start.sh
常规路径"这个观察**——当时被当作"个例/异常"记录，现在看来它可能恰恰是人实际使用模式的真实
写照：人手动开一个会话，然后指望在会话内把它变成 manager，而不是靠一个外部脚本自动建会话。
`manager-start.sh` 的 `tmux new-session` 路径不是"滞后于事实需要追平"，而是**这套"脚本自动
建会话"的模式本身就不是人在用的模式**。

---

## 2. 当前全部 tmux 依赖点盘点（subagent 逐一核实，42 个候选文件，方法：读文件头 + 按位置
判定真实 tmux 调用 vs 注释/字符串提及，硬规则②）

### 2.1 总体结论

- **约 1/3 的候选文件根本不发真实 tmux 命令**（`quay-launch.sh`、`capability-catalog.sh`、
  `observer-registry.sh`、`assert-clean-tree.sh`、`monitor-mount-check.sh`、
  `drivable-workspace-check.ts`、`over90-task-gate.ts`、`semantic-trigger.ts`、
  `supervisor-preempt-candidates.ts` 等）——**误收录**：grep 命中的是注释里的任务号子串
  （如 `gap-tmux-session-topology-...`）或对其它 tmux 脚本的引用/目录声明，不是本 SPEC 的
  处理对象。
- **C 类投递主线**（`send-keys-reliable.sh` → `supervisor-deliver.sh`/`supervisor-bus.sh`）
  **已被人裁定（2026-08-12）降级为 FALLBACK-ONLY**——默认路径是原生 SendMessage。
- **A/D 类会话生命周期主线**（`quay-topology.sh`/`session-bootstrap.sh`/`manager-start.sh`/
  `session-liveness.sh`）**仍是唯一/默认路径，尚无非 tmux 替代**——这是本 SPEC 真正要处理的核心。
- `tmux-session.ts`（"crystallized tmux 库"，设计意图是成为唯一 tmux 调用点）在生产代码中
  **零真实 import**，只被两个测试 helper 引用；`tmux-isolated.sh` 更彻底——**连自己的测试之外
  零消费者**，是本次盘点里最干净的孤儿，可直接删除。

### 2.2 核心分组（完整清单见调查 agent 原始报告，此处只列 A/D 类真正的退役对象）

| 文件 | 分类 | 生产调用者 | 处理方式（2026-09-04 更新） | 工作量 |
|---|---|---|---|---|
| `quay-topology.sh` | A（生命周期） | `manager-adopt.sh`、`manager-start.sh`（间接）、`quay-session.ts`、`session-topology` skill | **outer 窗口建立逻辑直接删除**（§1.4）——不迁移，代码里"单窗口拓扑"（`ROLES="outer"`）本身也要重新审视是否还需要存在，见 Layer 3a | 中（删除比改造小） |
| `session-bootstrap.sh` | A | `orchestrator-loop-tick.md`、`cold-start`/`session-topology` skill | 同上，随 outer 窗口逻辑一起删除/大幅简化 | 中 |
| `manager-start.sh` | A | `packages/quay/src/cli/manager.ts`（`quay manager start`，**当前生产路径**） | **不再"新增 claude --bg 分支"，改为设计一个 skill 让当前会话激活为 manager**（§1.4，见 Layer 3b）；`manager-start.sh` 的 tmux 路径去留待 Layer 3b 任务现场决定（可能保留作为 bare-metal 冷启动的一个可选便利入口，但不再是唯一/推荐路径） | 高（需要新设计,非简单替换） |
| `session-liveness.sh` | B(主)+D | 几乎全部 skill/loop 文档 + `quay-init`/`quay-topology`/`manager-start` | 取消（任务 6 已完成，与本轮方向调整无关） | 已完成 |
| `outer-session-check.sh` | D | `manager-adopt.sh`、`orchestrator-loop-tick.md` | **直接删除**（§1.4）——观测对象（outer 会话）本身不再会被创建 | 低（删除） |
| `topology-check.sh` | D | `outer-session-check.sh`、`quay-session.ts`、`supervisor-observe.sh` | **直接删除**（§1.4），同上 | 低（删除） |
| `pane-state-classify.ts` | B | `send-keys-reliable.sh`、`supervisor-deliver.sh`、`inner-blocked-signal.ts`、`session-liveness.sh` | 不删除——仍服务 C 类投递 fallback 链，§4 非目标未变 | 无变化 |
| `tmux-leak-scan.sh` | E（清理） | `full-suite-runner.ts`、`execute-suite-fix.js`、`fan-in-execute.js` | 无——只要测试基础设施（`hermetic-tmux.mjs`）还会起真实 tmux，本脚本就是必需的兜底 | **不属于本次退役范围**（见 §4 非目标） |
| `quay-init.sh` | D（片段） | 几乎全部 skill/loop 文档，安装期机制本体 | 不变——它已经是"会话内调用的 skill"这一模式的正例（见 Layer 3b），`--tmux-session`/`detect_tmux_session` 是一次性冷启动探测，非常驻依赖，本轮不改 | 无变化 |

### 2.3 三项特别核实的关键结论（纠正本 SPEC 早期草稿的两处误判）

**① `quay-launch.sh` 本身完全不含真实 tmux 调用**——它假设自己已经跑在调用方创建好的 tmux
窗口里，`exec` 替换当前 shell。真正决定"用 tmux 还是别的方式"的是调用方
（`session-bootstrap.sh`/`quay-topology.sh`/`manager-start.sh`）。

**已经存在的纯 background job 启动先例**：`plugin/scripts/driver-runtime.ts` 的 `launchArgv()`
——它把 profile 解析逻辑在 TS 里独立重新实现了一份（不经过 `quay-launch.sh`；其注释明确写道
"quay-launch.sh 保留给非驱动路径——manager/outer/inner 长驻会话"），配合 `runAsync()`
（`node:child_process` 异步 spawn）直接拉起 `claude -p` 进程，**零 tmux**——但这**只用于
task-worker/selector/fix-worker 这类一次性 worker 派发**，manager/outer 角色仍固定走 tmux
窗口内嵌路径,从未被这套机制覆盖。

**② `session-liveness.sh` 是三种信号源并存的混合体，非全依赖 tmux，但核心判定仍锁死 tmux**：
`REPO-STALL`（git log）、`SESSION-OVERDUE`（transcript mtime）已经是直接量,与 tmux 无关；但
`SESSION-GONE`/`SESSION-BACK`（进程存在性,靠 `tmux list-panes -F pane_pid` 拿 pid）与
`SESSION-IDLE`/`SESSION-RESUMED`（忙闲判定,靠 `tmux capture-pane` 喂 ADR-016 分类器）**仍然
100% 依赖 tmux pane 操作**,没有已知的非 tmux 替代能回答"这个 Claude 进程死没死/屏幕在忙没忙"。

**③（本 SPEC 早期草稿的误判，已纠正）`manager-start.sh` 并不是"已退役 tmux 的先例"**——
manager 目前仍然通过真实 tmux 会话被启动（`tmux new-session -d -s $SESSION -n manager
"$LAUNCH_CMD"`），且这是 `packages/quay/src/cli/manager.ts`（`quay manager start`）的**当前
生产实现**,不是待清理的死代码。**本 SPEC §1.3 此前把"manager 是 background job"的事实与
"manager-start.sh 已经支持 background job 启动"这个结论混为一谈——这是错的**：manager（本会话）
确实以 background job 模式运行,但这**不是通过 manager-start.sh 的常规路径达成的**（本会话大概率
是被人直接用 `claude --bg` 或类似方式单独启动的,绕开了 manager-start.sh）。`manager-start.sh`
本身从未被改造支持非 tmux 启动——**manager 要真正退役 tmux,同样需要走本 SPEC 设计的 Layer 3
改造，不是"已经做完了"**。

---

## 3. 退役路径（分层，不是一刀切）

### Layer 1：投递/驱动（C 类）—— 已经完成，只差清理

SendMessage 已是默认路径（2026-08-12 人裁定）。**本层的剩余工作只是清理**：
- 确认 send-keys 系列脚本的调用点是否已经归零（除两个例外场景）
- 若归零，脚本本身保留（不删除，供例外场景回退用），但从"默认路径"文档里的位置移除

### Layer 2：观测（B 类）—— 依赖驱动对象是否还在 tmux 里

`capture-pane`/`pane-state-classify.ts`/`session-liveness.sh` 这类观测机制的退役,**结构性依赖
它们观测的对象是否还在 tmux 里**。当前观测对象主要是：
- outer 会话（若真的还在 tmux 里跑——需要现场核实，人已告知"当前没有 outer 在运行"）
- worker 会话（**已确认不需要**——worker 本身是 `claude -p` headless，压根不在 tmux 里，`ps aux`
  实测 worker 进程直接是 `claude --settings ... -p ...`）

**结论：worker 侧的 pane 观测机制可以直接判定为孤儿代码**（观测对象已经不存在）；outer 侧的观测
机制退役与否，取决于 outer 未来是否还会以 tmux 形式运行——这正是本 SPEC 要解决的（迁移 outer 的
未来运行形态，而非现在判定 outer 该不该停）。

### Layer 3：生命周期管理（A 类）—— 拆成两条不同的路（§1.4 方向调整后的重写）

**架构澄清（agent 逐行核实，§2.3①，仍然成立）**：tmux 窗口不是 `quay-launch.sh` 建的——
`quay-launch.sh` 本身**零真实 tmux 调用**，它假设自己已经跑在调用方创建好的窗口里，`exec`
替换当前 shell。真正建 tmux 窗口的是三个调用方,各自独立：`quay-topology.sh`（outer,"单窗口
拓扑工厂"）、`session-bootstrap.sh`（冷启动路径）、`manager-start.sh`（manager,`quay manager
start`）：

```
quay-topology.sh:81   printf 'bash %s/plugin/scripts/quay-launch.sh %s\n' "$REPO_ROOT" "$role"
quay-topology.sh:173  tmux new-session -d -s "$SESSION" -n "$FIRST" "$CMD"     # $CMD = 上面那行
quay-topology.sh:212  tmux new-window -t "$SESSION" -n "$role" "$CMD"

manager-start.sh:~280 tmux new-session -d -s "$SESSION" -n manager "$LAUNCH_CMD"  # 同构，独立实现
```

**§1.4 的结论把这两处调用方的处理方式彻底分开了**——它们此前被当作同一类问题（"两处都要把
tmux 换成 claude --bg"），现在是两类不同的问题：

#### Layer 3a：outer 相关——直接删除，不迁移

`quay-topology.sh` 的 outer 窗口建立逻辑（`:81`/`:173`/`:212` 里涉及 `role=outer` 的分支）、
`session-bootstrap.sh` 里驱动 outer 冷启动的部分、`outer-session-check.sh`、`topology-check.sh`
——**这四个文件/代码路径直接删除**。理由已在 §1.4 讲清：观测/驱动的对象（一个独立运行的 outer
会话）本身不会再被创建，不存在"迁移到 claude --bg"这个中间态。

**删除前需要现场核实的边界（不是本 SPEC 断言，是留给任务执行时确认）**：
- `quay-topology.sh` 目前的 `ROLES="outer"`（单窗口）本身是否还有存在的理由——若 outer
  这个角色彻底不需要独立会话，这个脚本的"拓扑工厂"这个抽象层可能整个不再需要，也可能还有
  其它非 outer 的用途（需要 grep 实际调用者才能判断，不要凭这份 SPEC 的记忆判断）。
- `manager-adopt.sh`（`quay-topology.sh`/`outer-session-check.sh` 的已知生产调用者之一）
  依赖这些脚本的哪些具体行为——删除前要核实 `manager-adopt.sh` 自身是否也要跟着改，不能
  只删被依赖方、留下断链的调用方。

#### Layer 3b：manager/drivers 相关——新设计"skill 驱动的角色激活"模式

**这是本次更新新增的核心设计，替换原来"`manager-start.sh` 新增 claude --bg 分支"这个思路。**
人期望的模式是：人已经手动启动了一个 Claude Code 会话（用什么方式启动不是 quay 管的事），
然后在会话【内】调用一个 skill，把**当前这个已经存在的会话**变成 manager（或者变成"正在跑
drivers+web server"的宿主）——不是脚本去建一个新会话。

**现有 skill 生态盘点（本次调查新增，判断"已有什么、缺什么"）**：

| 需求（对应人流程的第③④⑤步） | 现状 |
|---|---|
| ③ 初始化 quay（建 `.quay`/`tasks`/git branches） | **已有** —— `plugin/skills/init/SKILL.md`（`quay-init.sh` 委托，会话内调用，幂等）。这正是"会话内调用 skill 激活能力"这个模式在本仓库唯一已经实现好的正例。 |
| ④ 启动 drivers + web server | **不存在** —— `find plugin/skills -iname "*driver*"` 只命中 `loop-driver`（inner tick 循环逻辑文档，不是"启动 driver 进程"的机制），没有任何 skill 会调 `quay driver start --kind <promotion\|worker>` / 启动 `quay serve`。目前唯一的入口是人手动敲 CLI 命令。 |
| ⑤ 启动/变身为 manager | **不存在,只有行为规范** —— `plugin/skills/manager/SKILL.md` 是 manager 这个角色【应该怎么干活】的行为文档（tick 结构、判准等），**不是**"把当前会话变成 manager"这个动作的入口。它目前唯一记载的启动路径是 §5"启动配置"里的 bare-metal 冷启动向量——`npm i -g <quay.tgz>` 后 `quay manager start`，这条路径**仍然走 `manager-start.sh` 的 `tmux new-session`**（§2.3③已实测），且是外部 CLI 命令，不是会话内 skill 调用。 |

**结论：④⑤都是缺口，不是"已有机制换个底层实现"这么简单——需要新增 skill。** 这也是为什么
本节标题从"用 claude --bg 取代 tmux new-window"改成"新设计 skill 驱动的角色激活"：原设计
默认④⑤的"启动"含义等价于"创建一个新会话运行它"，实际需要的是"让已经存在的会话获得这个
角色的能力/开始履行这个角色的职责"，两者对应的实现形态完全不同（后者不涉及任何进程/会话
创建 API，只是会话内的行为切换 + 起一些后台子进程如 driver/web server）。

**"变身为 manager"具体需要做什么（初步分解，供任务拆解阶段细化，不是最终设计）**：
- manager 的身份不来自一个特殊的启动命令，而来自会话在**做 manager 该做的事**（读
  `plugin/skills/manager/SKILL.md` 的行为规范、跑 tick、用 `CronCreate`/`ScheduleWakeup` 武装
  自己的循环锚点）——"变身" skill 的核心内容可能只是：初始化 `~/.quay-global/manager/` 家目录
  （若尚不存在）、把 manager 的方法论文档加载进当前会话的可见范围、武装第一个 tick 的锚点。
  这与"启动一个新会话跑 manager"完全不是一回事——**同一个会话本来就在跑，只是现在开始按
  manager 的行为规范行事**。
- **driver/web server 是需要独立后台进程的**（`quay driver start --kind promotion` /
  `--kind worker`、`quay serve`），这两者本身已经是`packages/quay/src/cli/driver.ts`
  `VERBS`/`serve` 命令覆盖的、不依赖 tmux 的普通后台进程（`quay driver` 的 spawn 机制本身
  与本 SPEC 无关，早已不用 tmux）——④缺的不是"进程本身怎么起"，是"缺一个 skill 把这几条
  CLI 命令包装成会话内一次调用"。这比③⑤都更接近纯粹的"缺一层薄封装"，工作量应该最小。
- `manager-start.sh` 的 tmux 路径去留：**不必须删除**——它记载在
  `plugin/skills/manager/SKILL.md` §5 作为"第三方裸机（无 quay 开发树）"场景的冷启动向量，
  这个场景（人完全不想手动开会话，想要一条命令直接拉起一个可用的 manager 会话）仍然可能有
  真实需求；但它不再是【推荐路径】，`plugin/skills/manager/SKILL.md` 需要更新，把"会话内调用
  skill 激活"标注为默认路径，`manager-start.sh` 降级为"若你就是想要一条外部命令自动建会话"
  的备选。

**一个已发现但不在本次 SPEC 处理范围内的关联缺陷（留给任务拆解阶段单独立案，不在本 SPEC
内直接处理）**：`plugin/skills/cold-start/SKILL.md` 与 `plugin/skills/session-topology/SKILL.md`
仍然描述着**两窗口 outer+inner 拓扑**（"outer 通过 send-keys 驱动 inner"）,而
`quay-topology.sh` 的代码本身**已经是单窗口**（`:73` `ROLES="outer"`，注释明确写"inner 层已由
*-driver 后台进程取代，不再是 tmux 窗口"）——**这是一处独立于本次架构调整、此前就已存在的
代码-文档漂移**，Layer 3a 删除 outer 相关逻辑后，这两份 skill 文档的过时程度会进一步加深
（连"单窗口 outer"这个中间态描述都跟不上了，因为 outer 窗口本身也要没了）。**建议单独立案
处理，不在本 SPEC 的任务列表里**——本 SPEC 的任务 7（文档更新）范围包含"清理提及 outer tmux
依赖的文档"，但 cold-start/session-topology 这两份文档需要的是更大的重写（整个拓扑模型都要
换成"会话内 skill 激活"），量级超出"顺手更新措辞"，值得独立追踪。

### Layer 2a：`session-liveness.sh` 的完整功能盘点 + 退役论证（回答"在 outer/inner 退役的大背景下
它是否确实不再需要"——不是重复裁定，是逐项核实）

**规模**：1858 行（`plugin/scripts/session-liveness.sh`），是本仓库里单一脚本承载最多边缘情况
处理的观测机制之一。头部注释自述"看【任意一个 Claude Code 会话】（外层或内层）活不活、闲不闲、
心跳逾期没有"——2026-08-03 从 `outer-liveness.sh` 泛化改名而来，设计上服务任意会话，不专属 outer
或 inner。

**它产生的事件（每个事件的信号源 + 是否依赖 tmux）**：

| 事件 | 信号源 | 依赖 tmux？ |
|---|---|---|
| `SESSION-GONE`/`SESSION-BACK` | tmux pane 里 claude 进程的存在性 | **是** |
| `SESSION-IDLE`/`SESSION-RESUMED` | `classifyPaneState`（pane 底部区域形状分类，五态：waiting-input/permission-prompt/busy/error-banner/unknown） | **是** |
| `SESSION-MARKER-STALE` | 屏幕判空闲但 transcript 刚写过的交叉正控制 | **是**（混合信号，一半靠 tmux） |
| `SESSION-IDLE-CANT-SEND` | transcript 结构字段 `isApiErrorMessage`（区分"没活干"与"API 被拒发不出请求"） | 否（读 transcript,但只在忙闲判定已依赖 tmux 的前提下才有意义） |
| `REPO-STALL` | 仓库 ≥N 分钟无新提交（`git log`） | **否** |
| `SESSION-OVERDUE` | 心跳源（transcript / tick-log 等）mtime 陈旧（多源 max，防红窗处置期间假阳性） | **否** |
| `SESSION-STATUS` | `--once` 汇总接缝，逐目标一行 | 依赖上述判据 |

**为什么这么复杂（这不是过度设计，是真实踩坑积累）**：文件内大量注释记录了具体的假阳性/假阴性
事故——token 计数被误判为活动、TUI chrome 抖动、权限提示与"在干活"需要区分（`intervention` vs
`busy`）、`.halt` 解除后的心跳基线重置、红窗处置期间外层不写 tick-log 但仍在干活的多源心跳修正
等。**这些复杂度几乎全部是为了在 tmux TUI 这个观测介质上可靠工作**——corpus 本身就是"如何在一个
为人类设计的终端界面上,让程序可靠地推断出会话状态"这个问题的解法。

**消费者与用途（实测，非猜测）**：
- `manager-tick-readings.ts` 的 `outer.liveness` 字段——**直接读 tmux pane_pid / window-missing**
  （`:547-596`），是 manager 每轮 A0 读数的一部分,判 outer 这个 tmux 窗口是否存在、进程是否在。
- `inner-blocked-signal.ts`——**不是调用这个脚本，是复用它的技术手法**（socket 解析、live
  capture-pane 读取），用于 inner 层报告"我卡住了"（AskUserQuestion 等 stop-and-wait 条件）,
  outer 的 Monitor 工具监视对应文件。
- `outer-session-check.sh`/`topology-check.sh`——用它的 tmux 判定逻辑做会话三态/在位检查。

**退役论证（分两部分，不是笼统地说"不需要了"）**：

**① Inner 一侧——已有正式判定，本 SPEC 只是延续，不是新发明。** `orchestration/AC148-inner-core-
itemized-attribution.md`（已完成的正式归属清单，非本次讨论产物）明确写道：
```
A7（tmux capture-pane → inner-blocked-signal --detect-stop）→ ②随会话消失：
  tmux pane 是会话卫生，无 inner 会话即无 pane。
B4（阻塞信号落盘 inner-blocked-signal）→ ②随会话消失：
  inner 阻塞态落盘随 inner 消失；needs-human 的显式承接面由 AC146（人机接口）承接。
```
即：inner 已退役（worker-driver.ts headless 派发取代），`inner-blocked-signal.ts` 的 tmux 观测
半部分已经被判定为死代码，只是脚本本身还没物理清理。**这不是本 SPEC 的新论断,是与既有共识的
延续。**

**② Outer 一侧——观测对象随迁移消失,且残留价值不足以保留整个脚本。**
- `SESSION-GONE`/`BACK`/`IDLE`/`RESUMED`/`MARKER-STALE` 这五个事件的观测对象是 tmux pane——
  outer 改用 `claude --bg` 后,这个观测对象结构性不存在了,不是判据本身错了,是它问的问题
  （"这个 tmux 窗口的忙闲状态"）不再有意义,同 outer 硬约束 6/16 的退役理由完全同构。
- **`REPO-STALL`/`SESSION-OVERDUE` 这两个不依赖 tmux 的判据,理论上仍然回答着一个独立于 tmux
  的真实问题**（"这个会话/项目是否还在推进"）,**但有限的残留价值不构成保留整个脚本的理由**：
  1. 人 2026-09-03 裁定 #3（长驻会话手工退出,不要搞复杂）意味着"自动判断该不该重启/该不该报警"
     这类需求本身被裁定不做——人会主动监督,不需要一个自动化系统持续判断"心跳是否陈旧"。
  2. 即便未来需要判断"项目是否停滞",`git log`/文件 mtime 检查只需要几行代码,不需要为它保留
     一个 1858 行的、大部分逻辑专为 tmux TUI 噪声过滤而生的脚本——按硬规则①"用机件不手搓"的
     反面同样成立：不该为了两个简单判据背负一整套不再适配的复杂机制。
  3. `manager-tick-readings.ts` 的 `outer.liveness` 字段本身就要因为 outer 改用 `claude --bg`
     而重写（读 tmux pane_pid 这件事本身失去对象）,不管 `session-liveness.sh` 存废,这处调用点
     都要改——所以"保留脚本、只切掉 tmux 判据"并不能省下这处必须改动的工作量。

**结论：确认——在 outer 改用 `claude --bg`、inner 已被 worker-driver 取代的背景下,
`session-liveness.sh` 承载的核心能力（可靠推断 tmux TUI 会话状态）确实不再需要。** 两个不依赖
tmux 的判据（`REPO-STALL`/`SESSION-OVERDUE`）有真实但有限的独立价值,若未来需要,建议在具体调用点
用几行代码重新实现,不建议保留整个脚本"只为了这两个判据"——这也是人裁定 #4"取消"（而非"精简保留
非 tmux 部分"）在技术上站得住脚的理由。

---

### Layer 2b：取消 `session-liveness.sh`（人 2026-09-03 裁定，原 §5 开放问题 #4 已解决——
不是"改造它使其等价"，是直接废弃，本节是这条裁定的落实范围）

**这条裁定把本 SPEC 原设想的"验证 `claude agents`/`logs` 与现有分类器语义等价"这个开放问题
（原 §5 #4）直接消解了**——不需要验证等价性，因为不迁移语义，直接废弃这个脚本和它承载的整套
四态/五态活性推断逻辑（`SESSION-GONE`/`BACK`/`IDLE`/`RESUMED`/`OVERDUE`/`STALL` 等）。

**影响面盘点（2026-09-03 实测，按位置判定,非关键词）**：全仓库引用 `session-liveness.sh` 的
文件 **约 140+**，但绝大多数是 `tasks/gap-session-liveness-*.md`（约 25+ 个，**抽样确认全部
`status: done`**，历史修复归档，不需要处理）和 `.md` 文档提及（随对应代码调用点顺手更新措辞）。

#### 2b.1 确定删除的实现文件

```
plugin/scripts/session-liveness.sh              （+ packages/quay/plugin/scripts/ 镜像副本）
plugin/scripts/session-liveness-sweep.mjs
plugin/scripts/session-liveness-sweep-kill.mjs
plugin/scripts/session-liveness-mount.sh
orchestration/session-liveness.env               （配置文件）
```

#### 2b.2 确定删除的测试文件（21 个 + 1 个 helper——本仓库单一机制体量最大的一批测试资产）

```
session-liveness-scd-progress.test.mjs        session-liveness-decision-import.test.mjs
session-liveness-scd-fire.test.mjs            session-liveness-signals-thresholds-edge.test.mjs
session-liveness-restart.test.mjs             session-liveness-heartbeat.test.mjs
session-liveness-events.test.mjs              session-liveness-signals-integration.test.mjs
session-liveness-signals-kinds.test.mjs       session-liveness-scd-unsaturated.test.mjs
session-liveness-sweep.test.mjs               session-liveness-signals-thresholds-observers.test.mjs
session-liveness-scd-config-gates.test.mjs    session-liveness-scd-develop-active.test.mjs
session-liveness-target.test.mjs              session-liveness-hangguard.test.mjs
session-liveness-scd-inflight-changing.test.mjs   session-liveness-scd-multitask.test.mjs
session-liveness-scd-busy.test.mjs            session-liveness-signals-thresholds.test.mjs
session-liveness-helpers.mjs（测试 helper，非 .test.mjs，仅服务上述测试）
```
（全部在 `plugin/test/`，删除前逐一确认无其它测试文件 import 这个 helper）

#### 2b.3 待核实（SPEC 早期判定可能已过期，删除前需重新 grep）

```
plugin/scripts/tmux-isolated.sh   + plugin/test/tmux-isolated.test.mjs
plugin/scripts/tmux-session.ts    + plugin/test/tmux-session.test.mjs
```
本 SPEC §2.1 曾判定这两个"生产零消费者，可直接删除"，但已发现一个已完成任务
`gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe`（`status: done`，2026-08-06）
专门处理过"`tmux-isolated.sh` 零消费者"问题并落地了 STAGE 1-3——**删除前必须重新 grep 一次
确认当前真实消费者清单，不能直接沿用 2026-09-03 那次调查的结论**（即便只隔几天，这类"零消费者"
判定容易被后续任务悄悄改变，同硬规则⑤"来源完备性"）。

#### 2b.4 仅移除依赖，文件本身保留（容易被误解为"要删"的部分）

- **`pane-state-classify.ts`**（+ `pane-state-classify.test.mjs`）——**不删除**。同时服务 C 类
  投递链（`send-keys-reliable.sh`/`supervisor-deliver.sh`/`supervisor-health.sh`），SPEC §4
  非目标明确"不改 C 类投递链现状"，只移除 `session-liveness.sh` 对它的一处调用。
- **`outer-session-check.sh`**（318 行测试 `outer-session-check.test.mjs`）/`topology-check.sh`
  ——文件保留，内部 tmux 判定逻辑重写为 `claude agents --json`，测试内容要跟着重写（不是删测试，
  是换断言对象）。
- **`inner-blocked-signal.ts`**（+ 其测试）——不删除；只是它复用 `session-liveness.sh` 技术手法
  的那部分逻辑已经是死代码（见 Layer 2a① AC148 判定），随 inner 相关清理一并处理,不因本次裁定单独
  触发。
- **其余约 29 个生产调用者**（`manager-tick-readings.ts`/`quay-init.sh`/`observer-registry*.sh`
  等——完整清单见文档修订历史,不在此重复罗列）——同理，移除对 `session-liveness.sh` 的调用/
  fallback 分支，文件和各自的测试保留，具体改法留到各自任务拆解时现场核实。

**替代方案的方向（不是逐文件设计，供任务拆解时参照）**：
- 判断一个会话是否存活/在做什么 → `claude agents --json [--cwd <path>]` + `claude logs <id>`
- `REPO-STALL`/`SESSION-OVERDUE` 这两个不依赖 tmux 的判据 → Layer 2a② 已论证：有限独立价值，
  不建议保留脚本，需要时在具体调用点用几行代码重新实现（`git log`/文件 mtime）
- `SESSION-GONE`/`IDLE`/`RESUMED`/`MARKER-STALE` 这些依赖 tmux 的判据 → 不是被"等价替代"，
  是随人 2026-09-03 裁定 #3（长驻会话手工退出，不设计自动检测/恢复）一起变得不再需要：没有
  自动重启/自动恢复的需求，就不需要精细的忙闲/存活状态机，`claude agents --json` 里会话
  存不存在这个布尔值就够用

**一个测试覆盖缺口（不是删除,是新增需求）**：`quay-topology.sh` 目前**没有专属测试文件**——
Layer 3 给它新增 `claude --bg` 分支这个改动，落地时需要新写测试，不是"删测试"，是补一个此前
没有的覆盖。

### Layer 4：发现/枚举（D 类）—— 已有替代（`ListAgents`），无需额外工作

`ListAgents` 已经原生列出 background job/tmux/cloud/Remote Control 各种形态的会话，比手写
`tmux has-session`/`list-sessions` 更完整——已涵盖 Layer 3 迁移后的新形态，不需要单独改造。

### Layer 5：清理/泄漏检测（E 类）—— `tmux-leak-scan.sh` 不在本次退役范围内（见 §4 非目标）

agent 核实（§2.2）：只要测试基础设施（`hermetic-tmux.mjs`，供 ADR-016 相关测试构造隔离的真实
tmux server）还会起真实 tmux，`tmux-leak-scan.sh` 就是必需的兜底——**这是测试基础设施的需求，
与"生产路径是否还依赖 tmux"是两件事**，不随 Layer 1-3 完成而自动退役。`tmux-isolated.sh`
（连自己测试外零消费者）和 `tmux-session.ts`（生产零 import，只被两个测试 helper 用）可以直接
归档，与 Layer 1-3 进度无关。

---

## 4. 非目标（本次明确排除）

- **不处理 AC149**（outer/inner 会话"真正退役"的最终判定）——人已明确裁定"不处理"，其三条子判据
  （真停/24h 产能不塌/无双真相源）留待之后。本 SPEC 完成后，AC149 的验证会变得更简单（Layer 1-4
  完成后，"真停"这条判据不再需要判断 tmux 会话是否还在，而是判断 background job 是否还在被派发）
  ——但这不是本 SPEC 现在要做的事。
- **不判定 outer 该不该继续存在**——本 SPEC 只回答"如果/当 outer 需要运行时，用什么机制运行"，
  不回答"outer 现在该不该运行"。
- **不修 AC149 的机械 fan-in 假 done 缺陷**（本次调查发现的一个真实 bug：该任务 AC 全部未勾选
  仍被机械流程判定通过）——已记录在案，留待人决定是否单独立案。
- **不动测试基础设施的 tmux 用量**（`tmux-leak-scan.sh`/`hermetic-tmux.mjs`/`tmux-test-isolation-
  check.ts`）——agent 核实（§2.2/§2.3）这条线与"生产路径依赖 tmux"是两个独立问题；ADR-016 相关
  测试本来就需要构造真实 tmux server 来验证隔离性，这不随本 SPEC 的 Layer 1-4 完成而改变。
- **不改 C 类投递链的现状**（`send-keys-reliable.sh`/`supervisor-deliver.sh`/`supervisor-bus.sh`）
  ——已是 2026-08-12 裁定的 FALLBACK-ONLY，本 SPEC 不推进它们的进一步退役（那需要先确认"两个不可
  替代场景"——控制面斜杠命令、下游不支持原生通道的环境——是否已经消失，这超出本 SPEC 范围）。
- **不碰当前的 tmux 会话**（人 2026-09-03 裁定 #5）——当前活跃、人工正在使用的 tmux 会话
  （`quay-0` 等，人用它访问 Claude Code）与本 SPEC 处理的"生产驱动机制依赖 tmux"是两回事，
  不在退役/迁移范围内，Layer 3 的改造不影响已经在跑、人在用的会话。**区分一点**：§1.3 提到的
  `quay-manager` 会话被测试遗留孤儿进程（`claude-probe`）占据，那**不是**人工正在使用的会话，
  是一个独立的、无关本次裁定的泄漏缺陷（同族
  `gap-suite-load-sampler-orphan-process-blocked-suite-interruption`）——是否清理由人另行决定，
  不因"不碰当前 tmux 会话"这条裁定而自动排除。
- **不在本 SPEC 内重写 `cold-start`/`session-topology` 两份 skill 文档**（§1.4/Layer 3b 已发现
  的代码-文档漂移：两份文档仍描述两窗口 outer+inner 拓扑，`quay-topology.sh` 代码已是单窗口）
  ——量级超出"顺手更新措辞"（任务 7 的范围），建议单独立案处理。
- **本 SPEC 只设计"需要新增哪些 skill、各自大致做什么"，不在此文档内完成 skill 的详细实现
  规格**（如 `plugin/skills/manager/SKILL.md` 的"变身"章节具体怎么写、"启动 drivers+web
  server"skill 的确切参数）——这些留给 §7 对应任务落地时现场设计，本 SPEC 提供方向和已确认
  的缺口清单（Layer 3b），不是最终实现文档。

---

## 5. 原开放问题的解决记录（人 2026-09-03 第二批裁定，全部已解决）

全部 5 条已由人 2026-09-03 裁定解决（原文见文档顶部"第二批裁定"），逐条对应关系：

| 原开放问题 | 裁定 | 落实位置 |
|---|---|---|
| #1 manager 是否也要走 Layer 3 改造 | **是**——manager 已是 background job，`manager-start.sh` 需要匹配这个事实 | §1.3 |
| #2 outer 的 CronCreate 归属 | **outer 自己持有**，不由 manager 代持/派发 | Layer 3 item 3 |
| #3 长驻会话退出语义 | **手工退出，不设计自动检测/恢复** | Layer 3 item 4 |
| #4 `session-liveness.sh` 判据等价性 | **不迁移语义，直接取消**——问题本身消解 | Layer 2b |
| #5 `quay-manager` 空壳会话清理 | 与"不碰当前 tmux 会话"裁定分离处理（该空壳非人工使用） | §4 非目标 |

**人 2026-09-04 第三批裁定（追加一条，推翻上表 #2/#3 对应的 Layer 3 原设计）**：

| 新问题（本次调查发现,不是原 §5 的一部分） | 裁定 | 落实位置 |
|---|---|---|
| outer 是否也要 `claude --bg` 迁移（原 Layer 3 item 2/3/4） | **撤销——直接删除 outer 相关 tmux 依赖，不迁移**（人从 5 步流程里没提 outer 反推出的确认） | §1.4、Layer 3a |
| manager/drivers 启动机制该设计成什么样 | **不是"脚本自动建会话"，是新增 skill 让人手动开的当前会话激活为角色** | §1.4、Layer 3b |

**没有遗留的开放问题——SPEC 到此为止判据齐全，可以进入任务拆解阶段（见 §7）。**

---

## 6. 参考

- `adr/ADR-016-cross-workspace-autonomous-operation-via-tmux-remote-drive.md` — tmux 机制的
  正本决策记录 + `claude -p` 被拒绝的三条理由（本 SPEC §1 论证这三条在 background job 模式下
  不成立）；`claude --help`（本地 CLI，2026-09-03 实测）—— `--bg`/`agents`/`attach`/`logs`/
  `stop`/`kill`/`rm`/`respawn` 的完整原生生命周期命令集，ADR-016 成文时未纳入讨论的第三个选项
- `orchestration/manager-phase-goal.md` AC145-149 — outer 职能 subagent 化的既有规划（已完成
  AC145-148；AC149"真停"判定本 SPEC 明确不处理）
- `orchestration/manager-tick-core.md` A19 — manager 自己的 CronCreate 锚管理实践，是 outer
  未来若采用类似模式的现成参照
- `plugin/scripts/driver-runtime.ts` `launchArgv()`/`runAsync()` — 已存在的纯 background job
  启动先例（覆盖一次性 worker 派发，`-p` 模式）——供 Layer 3b 设计"启动 drivers"skill 时参照
  其 profile 解析手法，非直接复用（worker 是一次性派发，drivers 是长驻进程）
- `plugin/scripts/quay-topology.sh`/`outer-session-check.sh`/`topology-check.sh` — Layer 3a
  直接删除对象；`manager-start.sh` — Layer 3b 降级为非默认路径，不删除；`session-liveness.sh`
  及其 31 个生产调用者（Layer 2b 清单）—— 取消，不是改造（已完成，任务 6）
- `plugin/skills/init/SKILL.md` — "会话内调用 skill 激活能力"模式的既有正例（对应人流程③）；
  `plugin/skills/manager/SKILL.md` — manager 角色的行为规范文档，Layer 3b 讨论的"变身为
  manager"skill 的落点候选；`plugin/skills/cold-start/SKILL.md`/`session-topology/SKILL.md`
  — 已发现但本 SPEC 不处理的代码-文档漂移（两窗口 outer+inner 描述已过时，见 §4 非目标）
- `experiments/quay-perpetual-stream/VT-MECHANISM-RETROSPECTIVE.md` — 与本 SPEC 无关的另一套
  已停摆机制的归档（避免混淆，交叉引用仅供区分）
- `.quay/profiles.yml` — 当前 outer/worker 共用 `worker-default` profile、manager 用
  `manager-local` profile 的配置来源

---

## 7. 任务拆解计划（2026-09-04 按 §1.4 方向调整重写——原任务 1-5 作废）

**结论：可以开始。** 原任务 1-5 建立在"outer 也要 claude --bg 迁移"这个已撤销的技术路径上，
**全部作废，不是暂停**——不存在"把任务 1-5 改个描述接着做"这种延续关系，因为它们的产出物
（`quay-launch.sh` 仅打印模式、outer 的 `claude --bg` 分支、outer 专属 CronCreate 锚）在新方向
下根本不会被建造。以下是按 §1.4/Layer 3a/3b 重新拆出的任务，任务 6 保持不变（已完成，与本轮
调整无关）：

1. **删除 outer 相关 tmux 依赖（Layer 3a）**——`quay-topology.sh` 的 outer 窗口建立逻辑、
   `session-bootstrap.sh` 驱动 outer 冷启动的部分、`outer-session-check.sh`、
   `topology-check.sh`。删除前先现场核实：① `manager-adopt.sh`（已知生产调用者）依赖这些
   脚本的哪些具体行为，删除后是否需要跟着改；② `quay-topology.sh` 的"拓扑工厂"抽象是否还有
   非 outer 的用途（grep 实际调用者，不要凭这份 SPEC 判断）。**独立、无前置依赖，可以先做。**
2. **新增"启动 drivers + web server"skill**（对应人流程第④步，Layer 3b 判定为纯缺口）——
   包装 `quay driver start --kind promotion`、`quay driver start --kind worker`、`quay serve`
   这几条已经不依赖 tmux 的 CLI 命令为一次会话内调用。**Layer 3b 判断这是三个 skill 缺口里
   工作量最小的一个（不涉及"变身"这类身份切换语义，只是命令封装），建议作为下一个做，验证
   "skill 驱动角色激活"这个模式的最小可行版本。**
3. **新增"变身为 manager"skill / 改造 `plugin/skills/manager/SKILL.md`**（对应人流程第⑤步，
   可与④合并）——让已经存在的会话开始按 manager 行为规范行事：初始化
   `~/.quay-global/manager/` 家目录（若不存在）、加载 manager 方法论文档到当前会话、武装
   第一个 tick 的 CronCreate/ScheduleWakeup 锚点。`manager-start.sh` 的 tmux 路径**不删除**，
   降级为 §5"第三方裸机冷启动"场景的备选，`SKILL.md` 需要更新把"会话内 skill 激活"标注为
   默认路径。**依赖任务 2 验证过的封装模式，建议在任务 2 之后做。**
4. **重新评估 `manager-tick-readings.ts` 的 `outer.liveness` 字段**——该字段目前直接读 tmux
   pane_pid（`:547-596`），依赖任务 1 删除的 outer tmux 窗口。任务 1 落地后这处调用点结构上
   已经读不到任何东西，需要判断是直接删除字段还是替换成别的读数（如"是否存在通过 subagent
   派发的在飞代理"这类已经存在的量）。**依赖任务 1。**
5. **（观察项，不建任务，暂不处理）** `inner-blocked-signal.ts` 复用 `session-liveness.sh`
   技术手法的那部分逻辑——AC148 已判定为死代码，本 SPEC 不因本轮调整单独触发清理，留给
   inner 相关整体清理时一并处理（同原 Layer 2b4 的记录）。
6. ✅ **已完成，不受本轮方向调整影响**——`gap-retire-session-liveness`（`status: done`，
   2026-09-03）。实际范围比本 SPEC 原计划更完整：删除 `session-liveness.sh`/
   `session-liveness-mount.sh`/sweep 脚本/`monitor-mount-check.sh`（连带，无对象可查）/
   22 个测试文件（比 §2b.2 统计的 21 个多 1 个，实施时枚举更彻底）；清理了 147 个消费方
   文件里的活跃引用；**额外发现并一并退役了 idle-watch 机制**（`manager-start.sh` 的
   `--check-idle-watch`/`--ensure-mount-intent` 参数 + 冷启动 checklist 的
   `IDLE-WATCH-MOUNTED`/`MONITORS-DELIVERING` 两键）；全量 suite 绿（AC1-AC5 全部 `[x]`）。
7. **文档更新**（CLAUDE.md/README/相关 SPEC/ADR/skill 文档里对 tmux 依赖的描述，含
   `plugin/skills/manager/SKILL.md` §5 冷启动向量的降级措辞）——收尾工作，等 1-4 全部落地后
   再做，避免文档先于代码改导致新的漂移。**不包含** `cold-start`/`session-topology` 两份
   skill 文档的重写（§4 非目标——量级超出本任务，建议单独立案）。

**任务间依赖关系**：1 独立可先做；2 独立可与 1 并行；3 依赖 2（复用其封装模式）；4 依赖 1
（outer tmux 窗口删除后该字段才失去观测对象）；7 依赖 1-4 全部完成。

**不建议现在做的**：AC149 的验证/修复（§4 非目标）、C 类投递链的进一步退役（§4 非目标）、
测试基础设施 tmux 用量的任何改动（§4 非目标）、`cold-start`/`session-topology` skill 文档
重写（§4 非目标，建议单独立案）。

**当前状态（2026-09-04，本次更新）**：任务 6 done；任务 1-4、7 未开始（原任务 1-5 已作废，
不是这些新任务的前身）。**下一步建议：任务 1**（删除 outer 相关 tmux 依赖）或**任务 2**
（新增"启动 drivers+web server"skill）——两者互不依赖，可任选其一先做，也可并行立案。
