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
| 外层 | ~~deepseek-v4-pro~~ → **deepseek-v4-flash**（人 2026-08-03 裁定：pro 偏贵） | archguard / meta-cc |
| 内层 | **deepseek-v4-flash** | 三个项目 |

### quay 管理者 / quay 外层（opus）

```bash
claude --permission-mode bypassPermissions
```

**关键：不带任何 `ANTHROPIC_*` 变量。** 实测本会话（pid 120373）的
`ANTHROPIC*`/`DEEPSEEK*` 变量数是 **0**，只有 `CLAUDE_CODE_DISABLE_MOUSE=1` 与
`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`，模型走账号默认。

### archguard / meta-cc 外层（deepseek-v4-flash）

**2026-08-03 变更**：原为 `deepseek-v4-pro`，人裁定改 `deepseek-v4-flash`——pro 偏贵。
⇒ **三个项目的内外层现在全部是 flash，只有 quay 的管理者与外层是 opus。**


```bash
CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000 \
CLAUDE_CODE_AUTO_COMPACT_WINDOW=917000 \
CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80 \
CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 \
CLAUDE_CODE_DISABLE_MOUSE=1 \
claude-deepseek --model deepseek-v4-flash --permission-mode bypassPermissions
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

## 3. tmux 里怎么起：**一个会话一个具名 window，不用 pane**

| tmux | window | 角色 | 模型（按 `/proc/<pid>/cmdline` 实测，不看会滚走的横幅） |
|---|---|---|---|
| `quay-0` | `0 inner` | 内层 | `deepseek-v4-flash` |
| | `1 outer` | 外层（管理者） | 默认（opus）——**不走 deepseek 端点**，已实测 |
| `archguard-2` | `0 inner` | 内层 | `deepseek-v4-flash` |
| | `1 outer` | 外层 | `deepseek-v4-flash`（2026-08-03 起，原 pro） |
| `meta-cc-4` | `0` | 未启动 | — |

### 为什么是 window 不是 pane（实测，不是偏好）

上下分屏后每个 pane 只有 **93×57**，独立 window 是 **93×116**。代价对外层很具体：

1. **一次 `capture-pane` 只剩一半上下文**——57 行装不下 TUI 加一段工具输出，
   长输出很快滚出可视区（`capture-pane -S -N` 能取回滚，那是补救不是默认）
2. **pane 索引会漂**——加/删/交换 pane 会重编号，`archguard-2:0.1` 这个目标不稳定；
   window 名不会漂。**所以一律按名字寻址**：`tmux capture-pane -t archguard-2:outer`
3. 93 列边界上的多字节截断两者一样，不构成差别

要同屏观察，另开一个专门的监视 window 拆 pane，**不要拆运行会话的 window**。

`allow-rename` / `automatic-rename` 都已关闭——否则窗口名会被程序改掉，寻址又漂回去。

### 一个真踩到的坑：`break-pane` 的 `-s` 和 `-t`

`tmux break-pane -d -s archguard-2:0.1 -n outer` 把新 window 建到了 **quay-0**，
因为 **`-s` 是源、`-t` 是目的地**，我只给了 `-s`，目的地就默认成了当前会话。
用 `tmux move-window -s quay-0:2 -t archguard-2:1` 移回。
**跨会话操作一律显式给 `-t`。**

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


## 成本上的一处隐患（2026-08-03，人裁定换 flash 之后发现）

`claude-deepseek` 包装脚本设的是：

```
ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro
ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro
```

**主会话用 `--model deepseek-v4-flash` 只约束主会话本身。**
Claude Code 内部按别名派生的 **subagent** 走的是上面这三条映射——
凡是解析到 `opus`/`sonnet` 别名的 subagent，**仍然落到 `deepseek-v4-pro`**。

⇒ **换 flash 未必省下 subagent 的钱。** 这条**未实测**，
要确认得看一次真实 subagent 调用落在哪个模型上。
若要彻底走 flash，需把 `ANTHROPIC_DEFAULT_{SONNET,OPUS}_MODEL` 也指向 flash——
但那会让「需要更强模型的 subagent」也降级，**是取舍不是纯优化**。


## 模型分配（2026-08-03 第二次变更）

| 角色 | 模型 | 启动器 |
|---|---|---|
| quay 管理者 + quay 外层 | **opus** | `claude`（不带任何 `ANTHROPIC_*`） |
| quay 内层 | `deepseek-v4-flash` | `claude-deepseek` |
| **archguard 内外层** | **`qwen3.8-max-preview`** | **`claude-aliyun`** |
| **meta-cc 内外层（冷启动时）** | **`qwen3.8-max-preview`** | **`claude-aliyun`** |

**人 2026-08-03 裁定**：改用阿里云是因为**现在是优惠时段**；该模型**可能慢些**，这是已知取舍。

```bash
CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000 \
CLAUDE_CODE_AUTO_COMPACT_WINDOW=917000 \
CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80 \
CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 \
CLAUDE_CODE_DISABLE_MOUSE=1 \
claude-aliyun --model qwen3.8-max-preview --permission-mode bypassPermissions
```

### 换之前实测过（不要跳过这一步）

**先探端点再杀会话**——否则杀完发现模型不存在，就白丢一个正在干活的会话：

```
POST https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic/v1/messages
{"model":"qwen3.8-max-preview","max_tokens":16,...}
⇒ ✓ 返回 "ok"，model=qwen3.8-max-preview，53 输入 / 23 输出 token
```

### `claude-aliyun` 与 `claude-deepseek` 的差别

`claude-aliyun` **不设任何 `ANTHROPIC_DEFAULT_*` 别名**——
所以不存在「主会话用便宜模型、subagent 却落到贵模型」那个隐患
（`claude-deepseek` 原本有，已于 2026-08-03 按人的指示删除三行）。

### 一个命名教训

交接文档原名 `handover-for-flash.md`——**绑死在模型名上，第二次换模型就过时了**。
已改为 `handover-for-successor.md`。
**给继任者的东西不要用当时那个继任者的名字命名。**

---

## 6. L0：tmux 隔离不依赖启动命令（2026-08-04）

`gap-tmux-isolation-cannot-depend-on-caller-remembering-to-unset-TMUX`（L0）落地后：

- **L0 落地前**：会话启动命令**不带** `env -u TMUX`（`restart-plan-2026-08-04-third.md` AC4 已定——
  重启不是引入未验证变量的地方；当前 outer/inner 的 `TMUX` 是设着的）。
- **L0 落地后**：启动命令**可以**加 `env -u TMUX`，但**隔离不再依赖它**——
  主防线是 `plugin/scripts/tmux-isolated.sh` 的**显式 `-S`**（`env -u TMUX tmux -S <私有 socket> "$@"`），
  结构性压过「调用方是否记得 unset TMUX」。

**给临时探索路径的安全模板**：任何子代理/临时的 tmux 操作，一律经
`plugin/scripts/tmux-isolated.sh <子命令>`——即使误发 `kill-server`，也只能杀掉该私有 socket，
**真实默认服务端（quay-0）不受影响**。需要访问真实默认服务端的仓库脚本
（`session-liveness.sh` 的只读 pane 探针、`quay-init.sh` 的会话探测）走等价显式形态
`env -u TMUX tmux -S "${TMPDIR:-/tmp}/tmux-$(id -u)/default" ...`，并在各自头部明示。

---

## 7. 启动配置已结晶：`.claude/launch.settings.json`（2026-08-05，gap-crystallize-launch-config）

本文件此前是「只活在某个人的操作里」的配方（§4）。现在**启动参数已结晶进检查进仓库的
`.claude/launch.settings.json`**，冷启动通过 `plugin/scripts/quay-launch.sh` 机械加载，不再手打一行。

- **settings-schema 键**（`--settings` 直接消费）：`permissions.defaultMode=bypassPermissions`、
  `env`（917000 上下文/压缩 + ADR-016 两个 `DISABLE_*` + `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION="false"`）。
  **角色级 env**：917k 上下文/压缩是 **deepseek 专用**——outer/inner 直接用文件全量 env；manager 跑
  Anthropic 默认模型，`_launchSpec.roles.manager.env` 把三个 917k 变量置空串（launcher 合并时删键，
  session-launch-recipes §5 的「压缩过晚 API 报错」形态不发生在 manager）。
- **flag-only 参数**（settings.json 没有对应键，存于 `_launchSpec`，由 launcher 翻译成 CLI 参数）：
  `--exclude-dynamic-system-prompt-sections`（`_launchSpec.excludeDynamicSystemPromptSections:true`）、
  `--prompt-suggestions false`（`_launchSpec.promptSuggestions:false`，**REQUIRED**——ghost-suggestion
  故障 6 从源头消除，人裁定冷启动必带；`gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false`）、
  `-n/--name`（`_launchSpec.roles.<role>.name`）、`--bare`（一次性验证，`quay-launch.sh <role> --bare`）、
  `--model`（`_launchSpec.roles.<role>.model`，仅 outer/inner 有；manager 用 claude 默认）。

**逐角色启动命令（launcher 生成，`--dry-run` 可校验）：**

```bash
bash plugin/scripts/quay-launch.sh outer --dry-run
# claude-deepseek --settings <root>/.claude/launch.settings.json --exclude-dynamic-system-prompt-sections --prompt-suggestions false --model deepseek-v4-flash -n quay-outer
bash plugin/scripts/quay-launch.sh inner --dry-run
# claude-deepseek --settings <root>/.claude/launch.settings.json --exclude-dynamic-system-prompt-sections --prompt-suggestions false --model deepseek-v4-flash -n quay-inner
bash plugin/scripts/quay-launch.sh manager --dry-run
# claude --settings <root>/.claude/launch.settings.json --exclude-dynamic-system-prompt-sections --prompt-suggestions false -n quay-manager
```

`--prompt-suggestions false` 是 **REQUIRED**（非可选）——每个角色命令都必须出现（launcher 从
`_launchSpec.promptSuggestions:false` 机械翻译；`plugin/test/launch-settings.test.mjs` 有机械断言）。

- **验命令**（AC4 正控）：`claude --settings .claude/launch.settings.json --version`。
- **负控**（防 restart-plan-AC1 那类「选错模型」）：刻意改 `_launchSpec.roles.<role>.model` ⇒
  launcher `--dry-run` 输出即变，`plugin/test/launch-settings.test.mjs` 有机械断言。
- **-p 条件性三项**（`--replay-user-messages` / `--max-budget-usd` / `--forward-subagent-text`）
  记在 `_launchSpec.deferredToPpMigration`，延后到 -p 迁移决定，不现在实现。

**CLAUDE_CODE_* 内部环境变量不推荐使用**（无官方背书、随时可变），不进 settings 文件。
