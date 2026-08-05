# 调研：Claude Code CLI 参数/配置里对 quay 有用的优化项

**日期**：2026-08-05（管理者，人要求全面调查）
**方法**：`claude --help` 全量选项 + `claude doctor` + 二进制内部环境变量表（`strings $(which claude)`）

---

## 高相关性——直接对应今晚踩过的坑

| 选项 | 作用 | 为什么和 quay 相关 |
|---|---|---|
| `--exclude-dynamic-system-prompt-sections` | 把 cwd/env/git status 这些「每台机器不同」的内容从系统提示词挪到第一条用户消息里，提升跨会话 prompt cache 复用率 | **今晚大量并发 worktree 隔离子代理**（每个 `quay-worktrees/<slug>` 的 cwd 都不同）——没有这个选项，每个子代理的系统提示词都不同，cache 基本打不中 |
| `--replay-user-messages`（stream-json 模式） | 把 stdin 收到的 user message 原样回显到 stdout 确认收到 | **这是结晶送达确认算法（send-keys-reliable.sh）的原生版本**——若以后迁移到 `-p` 流式（见 RESEARCH-claude-p-streaming-2026-08-04.md），这个选项直接替代大半个结晶算法 |
| `--max-budget-usd`（仅 print 模式） | 单次调用硬性美元上限 | 直接对冲 streaming 调研发现的「`-p` 模式只认 API key、订阅用户可能被导向 API 计费出大额账单」的风险 |
| `-n, --name <name>` | 会话显示名（prompt box / resume picker / 终端标题） | 给 outer/inner/manager 和各派发子代理一个可读身份，可能提升 `session-liveness.sh` 判断「这是谁的会话」的健壮性 |
| `--forward-subagent-text`（print+stream-json） | 子代理的文字/思考过程作为消息转发出来 | 减少手工读 `subagents/agent-<id>.jsonl` 才能看子代理在干什么的需要 |

## 中等相关性——值得调研

- `--effort <level>`（low/medium/high/xhigh/max）——按任务复杂度调会话强度，是个成本杠杆
- `--bare`——最小模式（跳过 hooks/LSP/plugin同步/自动记忆/预取），**一次性验证会话用会更安全更快**——今晚 AC3b 负控制事故如果在 `--bare` 隔离会话里做，波及面可能小很多
- `--tmux`（配 `-w/--worktree`）——内置的 worktree+tmux 配对，可能替代现在手搓的 `git worktree add` + 手动建 tmux 窗口，但要先查是否兼容 `quay-worktrees/<slug>` 命名约定
- `--settings <file-or-json>`——可以把「正确的启动命令」固化成一份检查进仓库的 settings 文件，而不是一条容易打错的 shell 一行命令（管理者今晚就把模型起错过一次）

## 明确不建议的

二进制里翻出几百个未文档化的内部 `CLAUDE_CODE_*` 环境变量（如 `AMBER_ASTROLABE`、`BISON_CAIRN` 这类明显的内部代号），**不推荐使用任何一个**——没有官方文档背书，随时可能变、可能有意料外的副作用，不应进产品。

## 附带信息

`claude doctor` 无异常。今天自动更新到 2.1.222（今晚大部分时间用的是 2.1.221）——不是要处理的问题，留个记录：万一之后出现新的怪现象，这是个可能的变量。

---

**这份文档只是调研，优先级判断与是否立案交给外层**——不阻塞当前批。
