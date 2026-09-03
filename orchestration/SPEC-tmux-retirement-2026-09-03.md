# SPEC：tmux 退役 —— 先退 tmux 机制本身，outer 会话留待之后

**作者**：manager｜**日期**：2026-09-03｜**状态**：proposal，待人裁定排期
**来源**：人 2026-09-03 明确裁定策略顺序——**先退役 tmux，再退役 outer**（推翻此前"outer 职能
subagent 化 → tmux 依赖自然消失"这一隐含顺序）；本 SPEC 是该裁定的具体展开。
**前置澄清（同日，已向人核实并更正两次误判）**：
1. 本 SPEC 与 `experiments/quay-perpetual-stream/OUTER-LOOP.md`（milestone/VT 驱动，已停摆 32 天
   的那套机制）**无关**——那是完全独立的另一套系统，处理方案见
   `experiments/quay-perpetual-stream/VT-MECHANISM-RETROSPECTIVE.md`（同日已归档）。
2. 本 SPEC 针对的是**三层架构（manager/orchestrator/fast-mode）里真正的 tmux 依赖**——
   `orchestrator-tick-core.md`（标题即"outer tick"）+ 全仓库实际调用 tmux 命令的生产脚本。

---

## 0. 一句话

**把"驱动/观测另一个 Claude Code 会话"这件事从 tmux（send-keys + capture-pane）迁移到已经被
manager 自身证明可行的 Claude Code background job session 模型（CronCreate + ScheduleWakeup +
SendMessage + Monitor），tmux 只保留在 ADR-016 已经圈定的、无替代路径的边界用途（控制面斜杠命令 /
下游不支持原生通道的环境）；不处理 outer 会话本身"真停"的判定（AC149），那是下一步。**

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

| 文件 | 分类 | 生产调用者 | 替代路径状态 | 退役难度 |
|---|---|---|---|---|
| `quay-topology.sh` | A（生命周期） | `manager-adopt.sh`、`manager-start.sh`（间接）、`quay-session.ts`、`session-topology` skill | 无 | 高 |
| `session-bootstrap.sh` | A | `orchestrator-loop-tick.md`、`cold-start`/`session-topology` skill | 无 | 高 |
| `manager-start.sh` | A | `packages/quay/src/cli/manager.ts`（`quay manager start`，**当前生产路径**） | **无——manager 仍真实 `tmux new-session`**（见 §2.3①，纠正此前对"manager 已退役 tmux"的误判） | 高 |
| `session-liveness.sh` | B(主)+D | 几乎全部 skill/loop 文档 + `quay-init`/`quay-topology`/`manager-start` | **部分已去 tmux 化**（见 §2.3②）：心跳/仓库停滞已用直接量；进程存在性/忙闲判定仍锁死 tmux pane | 高 |
| `outer-session-check.sh` | D | `manager-adopt.sh`、`orchestrator-loop-tick.md` | 无——`tmux list-windows` 是三态判定核心判据 | 中 |
| `topology-check.sh` | D | `outer-session-check.sh`、`quay-session.ts`、`supervisor-observe.sh` | 无 | 中 |
| `pane-state-classify.ts` | B | `send-keys-reliable.sh`、`supervisor-deliver.sh`、`inner-blocked-signal.ts`、`session-liveness.sh` | 是 C-fallback 链 + session-liveness 共用的分类核心 | 中（随两条主线一起动） |
| `tmux-leak-scan.sh` | E（清理） | `full-suite-runner.ts`、`execute-suite-fix.js`、`fan-in-execute.js` | 无——只要测试基础设施（`hermetic-tmux.mjs`）还会起真实 tmux，本脚本就是必需的兜底 | **高，且不属于本次退役范围**（见 §4 非目标） |
| `quay-init.sh` | D（片段） | 几乎全部 skill/loop 文档，安装期机制本体 | `--tmux-session` 支持显式传入（绕过 detect）；`detect_tmux_session` 仍用 `tmux list-sessions` | 高，但只是一次性冷启动探测，非常驻依赖 |

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

### Layer 3：生命周期管理（A 类）—— 用 `claude --bg` 取代 `tmux new-window`
（**范围：manager + outer 两个角色**——§1.3 已更正，manager 自身常规启动路径同样未退役 tmux）

**架构澄清（agent 逐行核实，§2.3①）**：tmux 窗口不是 `quay-launch.sh` 建的——`quay-launch.sh`
本身**零真实 tmux 调用**，它假设自己已经跑在调用方创建好的窗口里，`exec` 替换当前 shell。真正
建 tmux 窗口的是三个调用方,各自独立：`quay-topology.sh`（outer,"单窗口拓扑工厂"）、
`session-bootstrap.sh`（冷启动路径）、`manager-start.sh`（manager,`quay manager start`）：

```
quay-topology.sh:81   printf 'bash %s/plugin/scripts/quay-launch.sh %s\n' "$REPO_ROOT" "$role"
quay-topology.sh:173  tmux new-session -d -s "$SESSION" -n "$FIRST" "$CMD"     # $CMD = 上面那行
quay-topology.sh:212  tmux new-window -t "$SESSION" -n "$role" "$CMD"

manager-start.sh:~280 tmux new-session -d -s "$SESSION" -n manager "$LAUNCH_CMD"  # 同构，独立实现
```

即：两处独立代码都把 `bash quay-launch.sh <role>` 塞进一个新 tmux 窗口/会话里执行。**要去掉
tmux，需要把这两处"塞进新 tmux 窗口"都换成"塞进一个 background job"**，`quay-launch.sh` 生成
的启动参数本身不用大改（它本来就不碰 tmux）。

**已有现成参照实现，不是从零设计**（agent §2.3①）：`plugin/scripts/driver-runtime.ts` 的
`launchArgv()` 已经证明了"绕开 tmux、直接用 background job 机制启动一个 claude 进程"这条路径
可行——它独立于 `quay-launch.sh` 在 TS 里重新实现了一份 profile 解析逻辑，配合 `runAsync()`
（`node:child_process` 异步 spawn）拉起 `claude -p`。**但它只覆盖一次性 worker 派发**
（task-worker/selector/fix-worker），且用的是 `-p` 一次性模式而非 `--bg` 长驻模式——manager/
outer 需要的是后者（长驻、可持续接收后续指令），这部分需要新写，`launchArgv()` 的 profile 解析
逻辑可以复用，spawn 方式需要换成 `claude --bg`。

**核心技术发现（本次调查新增，此前的迁移提案均未发现）**：`claude` CLI **原生支持 background
job 启动**，完整生命周期命令齐全，不需要任何自建机制：

| 需求 | tmux 现状 | `claude` 原生替代 |
|---|---|---|
| 启动一个新会话，不占用当前终端 | `tmux new-window -n <role> "<cmd>"` | `claude --bg <参数...>`——**"Start the session in the background and return immediately. Prints the id"** |
| 恢复一个已停止的会话 | `tmux attach` + 手动 resume | `claude --bg --resume <session-id>`——**"continues that session in the background under the same ID"**（官方文档原文，同一 ID 续跑，而非另起一个） |
| 列出所有活跃 background 会话 | `tmux list-windows`（本项目的 D 类） | `claude agents [--json] [--all] [--cwd <path>]`——**比 tmux 更完整**：`--cwd` 可按项目目录过滤，`--json` 直接机器可读，`--all` 含已结束的 |
| 观察一个会话在做什么 | `tmux capture-pane`（受 ADR-016 五态+底部区域约束） | `claude logs <id>`——**"Print a background session's recent terminal output"**，不受 ADR-016 的整屏哈希/五态限制,本身就是官方 API,不是"绕过 TUI 抓屏" |
| 打开一个会话查看/交互 | `tmux attach-session -t <sess>` | `claude attach <id>`——**"Open a background session in this terminal"** |
| 停止一个会话（保留可恢复） | `tmux kill-window`（销毁，不可恢复对话） | `claude stop <id>` / `claude kill <id>`——**"Its conversation is kept: `claude attach <id>` opens it again"**（比 tmux kill-window 更好：会话历史不丢） |
| 彻底删除 | `tmux kill-window` + 手动清理 worktree | `claude rm <id>`——**"Delete a background session, and its worktree when that is safe"**（比手工清理更安全，官方判断 worktree 是否可删） |
| 升级 Claude Code 版本后重启 | 手动杀窗口重开 | `claude respawn [id\|--all]`——**"Restart a background session ... so it runs the current Claude Code version"** |

**这意味着 Layer 3 的改造范围比最初设想的小得多**：不需要新发明一套"outer background job 管理
机制"（我此前两轮提案里设计的 `outer-job-executor.js` + 自建状态机 + watchdog，很大程度上是在
重新发明 `claude agents`/`logs`/`respawn` 已经提供的能力——按硬规则①"用机件不手搓"，这是一个
应当避免的重复实现）。真正要做的是：

1. **`quay-topology.sh`（outer）与 `manager-start.sh`（manager）各自新增一个非 tmux 分支**：
   不再 `tmux new-session`/`new-window`，改为 `claude --bg <解析好的参数>`。参数解析可复用
   `quay-launch.sh` 已有的 profile 翻译逻辑（它本来就不碰 tmux，只是当前只会 `exec` 不会
   "打印参数后不 exec"——需要新增一个仅打印模式），或参照 `driver-runtime.ts` `launchArgv()`
   的独立解析实现（见上）。
2. **`outer-session-check.sh`/`topology-check.sh` 改用 `claude agents --json --cwd <repo>`
   替代 `tmux list-windows` + `capture-pane` + transcript 发现启发式**——`claude agents --json`
   直接给出会话是否存活、id、cwd，比现有的四态判定（healthy/empty-shell/missing/degraded）里
   三态（window_exists/has_claude_child/transcript_fresh）的判定基础更直接可靠，可能只剩
   "是否已被真正驱动过（有真实 user 消息）"这一层判据需要保留
3. **`session-liveness.sh` 的 `SESSION-GONE`/`SESSION-BACK`（进程存在性）与 `SESSION-IDLE`/
   `SESSION-RESUMED`（忙闲判定）改用 `claude agents --json` 的存活状态字段 + `claude logs <id>`**
   ——这两组判据是 §2.3② 核实出的"仍 100% 依赖 tmux pane 操作"的部分，是 Layer 2（观测）与
   Layer 3（生命周期）真正的交汇点：一旦驱动对象改用 `claude --bg`，这里的 `tmux list-panes`/
   `capture-pane` 调用天然失去观测对象，必须同步换成 `claude agents`/`logs`。
4. **outer/manager 的 CronCreate/ScheduleWakeup 复用 manager 现有模式**——manager 自己的
   `~/.quay-global/manager/loop-registry.txt` + `manager-arm-loop.sh` 一套武装/验证机制，是
   现成的可直接复用的参照（不是全新设计，manager 自己已经实测跑了 5 天）。

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

---

## 5. 开放问题（需要人确认，Layer 3 落地前必须回答）

1. **manager 自己是否也要走 Layer 3 改造，还是维持现状（tmux + 本次个例用 `--bg` 手动启动）？**
   （本 SPEC §1.3 已更正：manager 常规启动路径 `manager-start.sh` 仍是 tmux，本会话是个例，不是
   已完成的迁移。若人认为"manager 已经用 `--bg` 跑得很好，不需要改脚本"，那么 Layer 3 的范围
   收窄回只覆盖 outer；若认为 manager-start.sh 也该正式支持 `--bg`，则范围不变，两个角色一起改）
2. **outer 是否需要 CronCreate 持有自己的锚，还是完全被 manager 按 tick 节奏派发？**
   （类比 manager 自己的 A19 模式 vs 之前提案里"outer 不需要独立锚"的设计——两种都可行，取决于
   人希望 outer 保留多少自主性）
3. **`claude --bg` 长驻会话的收尾/退出语义是什么？**（worker 用的是一次性 `-p` 调用，跑完即退出；
   outer/manager 若持续存在，退出条件、失败恢复、`claude logs`/transcript 落盘位置需要明确
   定义——`driver-runtime.ts` 的 `launchArgv()` 只提供了参数解析范本，不提供长驻会话的生命周期
   语义，这部分是真正的新设计，不是照抄现成代码）
4. **`session-liveness.sh` 的 `SESSION-GONE`/`SESSION-IDLE` 判据换成 `claude agents`/`logs`
   后，语义是否完全等价？**（`tmux capture-pane` 能看到的是终端渲染内容，`claude logs <id>` 给的
   是"recent terminal output"——字面上相似，但需要现场核实两者对同一会话状态的分类结果是否一致，
   不能假设官方 API 的输出格式与现有 `classifyPaneState` 分类器兼容，可能需要重写分类逻辑而不是
   直接接线）
5. **`quay-manager` tmux 会话本身（当前被测试遗留进程占据的那个空壳）是否可以直接清理？**
   这是一个独立于本 SPEC 主线的小清理项（真实缺陷，同族 `gap-suite-load-sampler-orphan-process-
   blocked-suite-interruption`），但顺手指出，供人决定是否单独立案。

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
  启动先例（覆盖一次性 worker 派发，`-p` 模式），Layer 3 的参数解析可复用其设计但需换成
  `--bg` 长驻语义
- `plugin/scripts/quay-topology.sh`/`manager-start.sh`/`session-liveness.sh`/
  `outer-session-check.sh` — 本 SPEC Layer 3 实际要改造的四个核心脚本（agent 逐行核实定位）
- `experiments/quay-perpetual-stream/VT-MECHANISM-RETROSPECTIVE.md` — 与本 SPEC 无关的另一套
  已停摆机制的归档（避免混淆，交叉引用仅供区分）
- `.quay/profiles.yml` — 当前 outer/worker 共用 `worker-default` profile、manager 用
  `manager-local` profile 的配置来源
