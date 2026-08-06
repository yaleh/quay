# RUNBOOK：会话拉起（cold-start 之前的那一步）

**日期**：2026-08-05（管理者，第四次全灭后写）
**性质**：**可执行的恢复手册**，不是提案。每条命令都在今晚被实际执行并验证过。
**AC/DoD 与是否并入 `plugin/skills/cold-start/` 由外层判断。**

---

## 0. 为什么需要这份文件（实测缺口，今晚收账两次）

`plugin/skills/cold-start/SKILL.md` 的**前提第 3 条**是：

> | inner session reachable | tmux session … exists (`tmux list-panes -t <session>`) |

⇒ **cold-start 假设会话已经存在，它做的是「在已有会话上把循环点着」。**

而今晚四次全灭杀掉的**正是会话本身**。实测该技能文件对以下关键词命中数**全部为 0**：
`917000` / `claude-deepseek` / `deepseek-v4-flash` / `tmux new-session` / `quay-0` /
`:outer` / `:inner` / `prompt-suggestions`。

**⇒ 交付面缺的不是 cold-start，是 cold-start 之前的那一步。**
两次崩溃恢复中，启动命令都是靠翻 `~/.bash_history` 和会话 transcript 的 `message.model`
字段重建的——**部落知识，不在任何交付物里**。

---

## 1. 会话拓扑（约定）

```
<project>-<N>          tmux session
  ├─ 窗口 manager      跨项目管理者（仅 quay 需要；network 级，非 per-project）
  ├─ 窗口 outer        本项目外层协调者
  └─ 窗口 inner        本项目内层执行者
```

今晚实跑的三个：`quay-0`、`meta-cc-3`、`archguard-4`。
**寻址一律用 `<session>:<window-name>`**（如 `quay-0:outer`），不用窗口序号——
序号会随窗口增删漂移，名字不会。

---

## 2. 启动命令（逐字，今晚经 `message.model` 实证）

**outer 与 inner 用同一条命令**（人 2026-08-04 裁定：两层都走 deepseek，不用 Anthropic）：

```bash
CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000 \
CLAUDE_CODE_AUTO_COMPACT_WINDOW=917000 \
CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80 \
CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 \
CLAUDE_CODE_DISABLE_MOUSE=1 \
claude-deepseek --model deepseek-v4-flash \
  --permission-mode bypassPermissions \
  --prompt-suggestions false
```

**每一项都不是可选的**：

| 项 | 为什么 |
|---|---|
| `claude-deepseek --model deepseek-v4-flash` | 服务商与模型。**起错会静默跑成 Anthropic 默认模型**——2026-08-04 管理者犯过一次，靠 transcript 的 `message.model` 字段才发现 |
| `917000` 三件套 | 上下文容量与压缩阈值。`~/.bash_history` 实测：这三个变量**只**与 deepseek 那条命令同行出现 |
| `DISABLE_ALTERNATE_SCREEN` / `DISABLE_MOUSE` | ADR-016 明列的「可被远程驱动的会话」前置条件，不是偏好 |
| `bypassPermissions` | 同上；无人值守下权限提示会静默卡死循环 |
| `--prompt-suggestions false` | 关闭灰色 ghost 建议——它会污染 `capture-pane` 判读 |

**manager 例外**：跑在 Anthropic 订阅上（模型不同、计费不同）。
manager 是 **network 级、非 per-project**——不要每个项目起一个。

---

## 3. 拉起步骤

```bash
# ① 会话与窗口（幂等：已存在则跳过）
tmux new-session -d -s quay-0 -n manager
tmux new-window  -t quay-0 -n outer
tmux new-window  -t quay-0 -n inner

# ② 进项目目录（每个窗口）
tmux send-keys -t quay-0:outer 'cd /home/yale/work/quay' Enter
tmux send-keys -t quay-0:inner 'cd /home/yale/work/quay' Enter

# ③ 起 claude（把 §2 那条命令逐字发进去）
```

**④ 验证（必须做，不可假设）**：

```bash
# 拓扑
tmux list-windows -t quay-0        # 期望看到 manager / outer / inner

# 模型 —— 唯一可信的验证方式，不看屏幕上的字
ls -t ~/.claude/projects/-home-yale-work-quay/*.jsonl | head -3 | \
  xargs -I{} sh -c 'echo "{}: $(grep -o "\"model\":\"[^\"]*\"" {} | tail -1)"'
# 期望：deepseek-v4-flash。若看到 claude-* ⇒ 起错了，杀掉重起
```

**负控制已实测响过**：2026-08-04 错启动留下的会话 `27c03bf0` 的 `message.model`
是 `claude-opus-5`，与判据预言的失败形态逐字吻合。

---

## 4. 然后才是 cold-start

会话拉起并验证模型正确后，`plugin/skills/cold-start/SKILL.md` 的三条前提才成立，
此时执行它（挂监视器 / 建 cron / 驱动内层 / 派发首任务 / 六键 AC8c 验证）。

**次序不可颠倒**：cold-start 的第 3 条前提就是「会话可达」。

---

## 5. 驱动送达：只信目标会话自己的 transcript

驱动文本发出后，**唯一可信的送达信号是目标会话 transcript 里出现该文本的 user 消息**。

**不可信**（今晚均实测失效）：

| 信号 | 失效形态 |
|---|---|
| pane 哈希 | **3 次假阳性**（外层裁定 F，已判不可信） |
| heartbeat | **冻结 42 分钟**仍报 OVERDUE 假警（≥4 次） |
| `send-keys-reliable.sh` | 判空用 `[:space:]`，而空输入框是 `❯` + **NBSP(c2 a0)** ⇒ 恒判非空 ⇒ 清屏循环跑满 50 次 fail-loud。**对任何 Claude Code 输入框都不可用**（三个消费者全部静默绕过它自己手写序列） |

**当前可用的手工序列**（三次驱动实测成功）：

```bash
tmux send-keys -t <target> C-u ; sleep 0.4
tmux send-keys -t <target> -l "<文本>" ; sleep 1.2
tmux send-keys -t <target> Enter
# 然后核实：目标会话最新 .jsonl 里出现该文本的 user 消息
```

---

## 6. ⚠️ tmux 危险操作红线（第三、四次全灭的机制根）

**禁止 `tmux kill-server`。**

**为什么**：它的爆炸半径由**环境**决定，而环境可以**静默丢失**。丢失后失败模式不是报错，
是**清空整台机器的 tmux**。

**第四次全灭的完整机制（2026-08-05 09:2xZ，管理者自伤，实测）**：
把验证脚本拆成两次独立 Bash 调用 → `export ISO_TMPDIR=...` 在第二次调用里已丢失
（工具文档写明 shell 状态不跨调用保留）→ `sockDir=undefined` → `TMUX_TMPDIR` 这个 key
被 Node 丢弃 → 又主动 `delete env.TMUX` → **既无 `-S`/`-L`、无 `$TMUX`、也无 `TMUX_TMPDIR`**
→ `kill-server` 落到默认 socket → quay-0 / meta-cc-3 / archguard-4 全部会话死亡
（outer 2600919、inner 2600928、默认 server 2591128 实测确认全部死亡）。

**替代方案（按爆炸半径从小到大，优先用前者）**：

| 方案 | 爆炸半径 | 今晚实测 |
|---|---|---|
| `kill -TERM <pid>` + 显式校验默认 server pid 不在名单 | 单进程 | **两次成功清理 217 个 / 12 个泄漏 server，零误伤** |
| `tmux kill-session -t <具体会话名>` | 单会话 | `session-liveness.test.mjs` 已在用（3 处），从未出事 |
| `tmux kill-server` | **整个 socket** | **禁用** |

**socket 选择优先级（今晚实测确认）**：`-S`/`-L` > `$TMUX` > `TMUX_TMPDIR`。
⇒ 用 `-S <显式路径>`（参数，丢失会报错）优于 `TMUX_TMPDIR`（环境变量，丢失静默回退默认）。

---

## 7. 与已立案任务的关系

`gap-crystallize-launch-config-into-checked-in-settings-file`（`status: ready`）覆盖
**启动配置**，但实测它对 `new-session` / 窗口拓扑的命中数为 **0**。
⇒ 本 RUNBOOK 的 §1（拓扑）与 §3（拉起步骤）是该任务未覆盖的部分，建议并入其范围
或另立一条。**裁定权在外层。**

`gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause` 的 AC2 已于
2026-08-05 撤回重写（禁 `kill-server`、改 `kill-session`、新增 AC2b 消除
`quay-init-tmux-detection.test.mjs` 里已有的 4 处同类风险），与本文件 §6 一致。

---

**本文件不建 AC/DoD、不排优先级——那是外层的活。**
