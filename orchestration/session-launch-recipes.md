# 三项目双层机制的会话启动配方

**日期**：2026-08-03
**来源**：人给出的实际启动命令 + 外层从运行中进程实测（`/proc/<pid>/environ`、`/proc/<pid>/cmdline`）
**用途**：冷启动交付的一部分——**这份配方此前不可从任何文件复现**（见 §4）

---

## 1. 三个角色，三条命令

人 2026-08-03 裁定的模型分配：

| 角色 | 模型 | 项目 |
|---|---|---|
| 管理者 + quay 外层 | **opus** | quay |
| 外层 | **deepseek-v4-pro** | archguard / meta-cc |
| 内层 | **deepseek-v4-flash** | 三个项目 |

### quay 管理者 / quay 外层（opus）

```bash
claude --permission-mode bypassPermissions
```

**关键：不带任何 `ANTHROPIC_*` 变量。** 实测本会话（pid 120373）的
`ANTHROPIC*`/`DEEPSEEK*` 变量数是 **0**，只有 `CLAUDE_CODE_DISABLE_MOUSE=1` 与
`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`，模型走账号默认。

### archguard / meta-cc 外层（deepseek-v4-pro）

```bash
CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000 \
CLAUDE_CODE_AUTO_COMPACT_WINDOW=917000 \
CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80 \
CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 \
CLAUDE_CODE_DISABLE_MOUSE=1 \
claude-deepseek --model deepseek-v4-pro --permission-mode bypassPermissions
```

### 内层（deepseek-v4-flash，三个项目通用）

```bash
CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000 \
CLAUDE_CODE_AUTO_COMPACT_WINDOW=917000 \
CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80 \
CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 \
CLAUDE_CODE_DISABLE_MOUSE=1 \
claude-deepseek --model deepseek-v4-flash --permission-mode bypassPermissions
```

**这条是人给出的原文，本仓内层（pid 270244）正在用它跑。**

---

## 2. `claude-deepseek` 包装脚本做了什么

`/home/yale/.local/bin/claude-deepseek`：

```bash
source ~/.local/etc/deepseek-api-key      # 密钥不硬编码在脚本里
export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
export ANTHROPIC_AUTH_TOKEN="$DEEPSEEK_API_KEY"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="deepseek-v4-flash"
export ANTHROPIC_DEFAULT_SONNET_MODEL="deepseek-v4-pro"
export ANTHROPIC_DEFAULT_OPUS_MODEL="deepseek-v4-pro"
exec claude "$@"
```

**实测确认**：

- `ANTHROPIC_AUTH_TOKEN` 与 `DEEPSEEK_API_KEY` 是**同一个值**（sha256 前 8 位一致，未打印明文）
- 端点**实际支持的模型恰好两个**——直接查 `https://api.deepseek.com/models` 得
  `deepseek-v4-flash`、`deepseek-v4-pro`
- 脚本用 `exec`，且调用方用**行内 env 前缀而非 `export`**，所以**变量不会污染调用它的 shell**

### 三个别名映射的后果（重要）

`ANTHROPIC_DEFAULT_{OPUS,SONNET}_MODEL=deepseek-v4-pro`、`HAIKU=deepseek-v4-flash` 意味着：
**Claude Code 内部按别名派生的 subagent 会落到对应的 deepseek 模型上**。
所以一个 deepseek 会话派出的 subagent 也在 deepseek 上，不会意外走回 Anthropic。

---

## 3. tmux 里怎么起

三个会话已存在，`claude` 未在后两个里启动：

| tmux | cwd | 状态 |
|---|---|---|
| `quay-0` | `/home/yale/work/quay` | 内层 + 外层运行中 |
| `archguard-2` | `/home/yale/work/archguard` | **bash，未启动** |
| `meta-cc-4` | `/home/yale/work/meta-cc` | **bash，未启动** |

发送方式按 `CLAUDE.md` 的 tmux 纪律：**`C-u` → 文本 → `Enter` 三次分开调用**
（合并会丢 Enter），发完 `capture-pane` 确认出现新的 `⏺` 输出——**未确认送达的指令等于没发**。

---

## 4. 这份配方此前不可复现——这本身是冷启动的缩影

外层实测：`claude-deepseek` 只设 **5 个** `ANTHROPIC_*` 变量，
而运行中的内层进程有 **10 个**相关变量。另外 5 个
（`MAX_CONTEXT_TOKENS`、`AUTO_COMPACT_WINDOW`、`AUTOCOMPACT_PCT_OVERRIDE`、两个 `DISABLE_*`）
**在 `~/.bashrc`、`~/.profile`、`~/.local/bin/*`、`~/.local/etc/` 里全部找不到**。

**⇒ 它们只存在于启动那一刻的命令行里。** 若内层会话死掉、有人只用 `claude-deepseek` 重启，
它会得到**不同的上下文窗口与压缩行为**，而且**不会有任何报错**——
这正是「配置只活在某个人的操作里」的典型形态。

**本文件的存在就是修复。** 冷启动交付必须包含它，或包含一个封装了全部 10 个变量的启动脚本。

---

## 5. pro 的上下文窗口：实测到哪一步为止

`CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000` 是人为 **flash** 使用的值。对 **pro** 的实测：

| 探针 | 结果 |
|---|---|
| `GET /models` | 只返回 `id,object,owned_by`——**拿不到窗口** |
| `max_tokens: 99000000` | **被照单全收并正常回答**——网关不校验它，此探针无效 |
| 输入 **200,012 tokens** | **接受** ⇒ 窗口 ≥ 200K，**128K 假说排除** |
| 输入 ~800K tokens（917000 的 80% 压缩触发点之上） | **未做——人 2026-08-03 裁定成本过高而停止** |

**⇒ 已知：pro 窗口 ≥ 200,012。未知：是否 ≥ 917K。**

### 处置：不测穷，出错再改

人的裁定：「你有能力在未来出错时修改环境变量/参数重新运行 Claude Code 即可。」

所以 pro 会话**按配方带 917000 启动**。若真实窗口小于 734K（= 917000×80%，Claude Code 的压缩触发点），
失败形态是**压缩太晚导致的 API 报错**，届时把 `CLAUDE_CODE_MAX_CONTEXT_TOKENS` 下调重启即可。

**这是一个有意的选择，不是疏漏**：把一个可恢复的失败留给运行时，比预付一次昂贵的穷举测量便宜。
记在这里，是为了让将来看到那个报错的人**知道原因、知道改哪个变量**，而不必重新诊断。
