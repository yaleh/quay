# 调研：`claude -p` 流式模式能否承载双层循环

**日期**：2026-08-04（管理者调研，人指定方向）
**背景**：人提出未来增加一种启动模式——`claude -p` 流式输入输出，不用 tmux，更直接低输入输出开销。
Anthropic 不允许该模式用 Claude 订阅（这是尚未采用的原因之一），但可以用其它服务商（如 DeepSeek）的模型。

**为什么这件事对本项目重要**：今晚（2026-08-04）的失败几乎全部集中在 tmux/TUI 这一层——
投递确认假阳性 3 次、`tmux kill-server` 打死两台机器、C-u 只清一行导致残留拼接、
长文本后紧跟的 Enter 落在中间状态不提交。**这些在 `-p` 流式下不是被修好，是不存在。**

---

## 1. 硬事实（官方文档，非推断）

| 能力 | `-p` 流式下 | 出处 |
|---|---|---|
| **`Monitor` 工具** | ❌ **完全不可用** | `tools-reference.md` |
| **`CronCreate`/`CronList`/`CronDelete`** | ⚠️ 可用，但**会话作用域**，会话退出即消失 | `scheduled-tasks.md`：「Tasks are session-scoped」 |
| **`Agent(run_in_background: true)`** | ✅ 可用 | `headless.md` |
| 后台 subagent 的退出语义 | `-p` **等它跑完再退出**，默认上限 10 分钟（v2.1.182 起） | `headless.md` |
| 后台 Bash / 长驻进程 | ⚠️ final result 返回**且 stdin 关闭**后 **~5 秒被杀** | `headless.md`（v2.1.163 起） |
| 流式输入 | ✅ `--input-format stream-json`，每行一条 user message | `headless.md`, `cli-reference.md` |
| **会话存活条件** | **stdin 保持打开期间存活**；stdin 关闭即结束 | `headless.md` |
| MCP / hooks / skills / plugins | ✅ 与交互模式一致 | 2.1.221 刚修「MCP servers not connecting before first turn in print mode」 |
| `--resume` / `--continue` | ✅ 完整支持；会话文件持久化；未过期 cron 会恢复 | `sessions.md`, `scheduled-tasks.md` |

---

## 2. 关键反转：缺的两块正好该由驱动进程接管

文档明确会话**在 stdin 保持打开期间存活**。⇒ 一个长驻驱动进程握着 stdin 就是持久会话。于是：

- **不需要 `CronCreate`** —— 驱动进程按时往 stdin 写，**它就是调度器**
- **不需要 `Monitor`** —— 驱动进程自己观测存活/事件，作为 stdin 消息注入

**这不是「绕过限制」，这是更正确的形态**：调度与观测从「某个会话记得自己建过 cron」这种会话内状态，
搬进一个**可交付、可检查、可测试的脚本**。

**本仓已有的直接佐证**：今晚 `loop-driver-check.sh` 报 STALLED，根因是注册行只写在
`plugin/skills/cold-start/SKILL.md:117`、tick 文档步骤 4 里没有 ⇒ 照 tick 文档逐字执行必然 STALLED。
**这类「行为藏在会话状态里」的缺陷，在外部驱动形态下结构上不存在。**

---

## 3. 两个真正的未知 —— 文档回答不了，必须实测

### 未知 A（**gating，决定整个方向生死**）：DeepSeek 经 `ANTHROPIC_BASE_URL` 在 `-p` 下能否工作

官方文档**完全没有提及**第三方 Anthropic 兼容端点在 headless 模式下的支持——
`headless.md` / `cli-reference.md` 都没写；官方只文档化了 Bedrock / Vertex / Foundry 三个云集成。
**这是文档的空白，不是「已记载为不支持」**——两者要分清。

**⇒ 不能用则整个计划作废。这条必须先测。**

#### 实测结论（2026-08-05，`gap-measure-claude-p-headless-third-party-roundtrip-and-exit-semantics`）：**能往返，gating 过**

实测 `claude-deepseek -p '回复 OK 即可'` → exit 0，stdout 收到模型回复 `OK`（1 行）。
stderr 出现「claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is
set」警告——反向证明 auth 走 env key，非 claude.ai 订阅态。

负控制（证明 key 真被用上）：
- **Contract 字面行 `env -u ANTHROPIC_API_KEY -u DEEPSEEK_API_KEY claude-deepseek -p '回复 OK'`
  意外 SUCCESS**——`claude-deepseek` launcher 内部 `source ~/.local/etc/deepseek-api-key`
  **重新设置** key 并 `export ANTHROPIC_AUTH_TOKEN`，父环境 `env -u` 拦不住。**Contract 负控制行
  规格有误**，需忠实变体。
- **忠实负控制（key 文件不可达，HOME 指向空目录）→ exit 1**：
  `Error: DeepSeek API key file not found: <nohome>/.local/etc/deepseek-api-key` —— 证明 key 文件
  是往返的承载。
- 追加：坏 key 值 → API 层 `Execution error`（挂起重试，不干净），进一步证明真实命中第三方端点。

**未知 A 判定：`ANTHROPIC_BASE_URL` → DeepSeek 在 `claude -p` headless 下可往返。整个方向可用。**

### 未知 B（决定「移植」还是「重新设计」）：stdin 保持打开时，退出语义是否改变

`headless.md` 的原文措辞是 final result 返回 **且 stdin 已关闭**之后才杀后台 —— **两个条件并列**。

- 若 **stdin 不关就不退出** ⇒ 现有并发派发模型（3 个在飞 subagent，跨小时）可以**原样保留**
- 若**照退** ⇒ 内层的并发必须改成「驱动进程起 N 个独立 `-p` 进程」，**这是重新设计，不是移植**

#### 实测结论（2026-08-05，`gap-measure-claude-p-headless-third-party-roundtrip-and-exit-semantics`）：**分形态——stream-json = 移植；plain 参数形态 = 照退**

判据全程是 `ps` 进程存活，不是日志文本。

- **plain `-p 'prompt'` 参数形态（stdin 用 `tail -f /dev/null` 保持打开）→ 照退。** 主回合 + 后台
  subagent 回合结束（~t+46s）即退出，stdin 打开**不**持有会话。
- **stream-json 形态（`--input-format stream-json --output-format stream-json --verbose`，
  driver 实际形态）→ 不关 stdin 就不退出。** writer 握 stdin 200s：后台 subagent 于 ~t+138s 完成
  （`task_notification` 事件，status completed），其后进程**仍存活**到 t+203s（writer `sleep 200`
  结束、fifo EOF）才退出。后台 subagent 的完成由事件流异步投递，进程本身存活。

**未知 B 判定：**「驱动进程握 stdin = 持久会话」只在 **stream-json 形态**成立；plain 参数形态照退。
现有并发派发模型（3 个在飞 subagent、跨小时）可**原样保留（移植）**，前提是驱动进程用 stream-json
形态持续握着 stdin——与调研 §2 的「驱动进程接管调度与观测」设计一致。plain 形态不可用于此目的。

---

## 4. ⚠️ 实钱风险（做任何实验前必读）

`-p` 模式**只认 API key，不认 Pro/Max 订阅**。调研查到有 **Max 订阅用户被无意导向 API 计费、
产生大额账单**的案例。

**⇒ 任何 `-p` 实验必须用 `claude-deepseek` 这类自带 key 的 launcher，
绝不能在 Anthropic 订阅态下裸跑 `claude -p`。**
（管理者会话在 Max 上，所以实验不在管理者这边做。）

---

## 5. 建议立案的两条

### 5.1 ADR-016 需要第二次 Amendment —— **改理由，不改结论**

ADR-016「Alternatives rejected」原文：

> **`claude -p` (headless/print mode):** one-shot — runs a prompt, returns, exits.
> Does not fit a *perpetual* loop with background agents + scheduled wakeups.

- 「one-shot」这个**事实判断是错的** —— `--input-format stream-json` 的流式输入不是 one-shot
- 但**结论碰巧是对的**，真实理由完全不同：Monitor 不可用 / cron 会话作用域 / 后台进程被杀

**为什么必须改**：**理由错了的正确结论，会被下一个人用同样的错误理由推翻。**
Amendment 应写明：结论维持、真实的三条硬约束、以及「驱动进程接管调度与观测」这个替代形态的存在。

**时机**：A（`gap-adr-016-carve-out-...`）刚落地 ADR-016 的第一次 Amendment（`d36bbaaf`），
但**没有触及** Alternatives 段 —— 现在改成本最低。

### 5.2 一条窄实测任务 —— **不是「查可用性」（已答完），是验两个未知**

- **AC1（gating）**：用 `claude-deepseek -p` 发一句话，确认第三方端点在 headless 下能否往返。
  **零风险**（不碰在跑的循环、用 deepseek 自己的 key）、几分钟可完成。
  **负控制**：同一条命令在**没有** key 的环境下必须失败 —— 否则证明不了 key 真的被用上了。
- **AC2**：stdin 保持打开 + 一个后台 subagent，观察 `-p` 是否在 subagent 完成后退出。
  判据是**进程是否仍存活**，不是日志里写了什么。
- **AC1 不过则 AC2 不必做** —— 依赖关系写进任务体。

---

## 6. 这份调研本身的限度（诚实标注）

- 结论来自官方文档检索，**未经本机实测**。第 3 节两条正是「文档答不了」的部分。
- 「Monitor 在 `-p` 下不可用」出自 `tools-reference.md`，属高置信度，但**下注前值得本机验一次**。
- 本文件不构成对是否迁移的裁定 —— 它只把「能不能」这个问题从推测变成了「还差两条实测」。
