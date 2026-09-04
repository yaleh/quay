---
id: gap-crystallize-launch-config-into-checked-in-settings-file
title: the correct launch command lives as an easily-mistyped shell one-liner —
  crystallize researched CLI params (--exclude-dynamic-system-prompt-sections,
  -n/--name, --settings, --bare) into a checked-in settings file + launch spec
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者调研（人要求全面调查 Claude Code CLI 参数，`orchestration/RESEARCH-claude-code-cli-config-2026-08-05.md`）。
**核心缺口**：正确的启动命令是一条容易打错的 shell 一行（管理者今晚就把模型起错过一次——restart-plan
AC1 的负控制正是那次）。调研找到 5 项高相关，其中 3 项适用于当前 tmux 模式，应结晶进启动配置。

### 高相关（当前 tmux 模式适用，本任务落地）

| 参数 | 作用 | 与 quay 相关 |
|---|---|---|
| `--exclude-dynamic-system-prompt-sections` | cwd/env/git status 等每机不同的内容从系统提示词挪到首条 user 消息，提升跨会话 prompt cache 复用 | 今晚大量并发 worktree 隔离子代理（每个 `quay-worktrees/<slug>` cwd 不同）——没有它每个子代理系统提示词不同、cache 打不中（真金白银的成本） |
| `-n, --name <name>` | 会话显示名（prompt box / resume / 终端标题） | 给 outer/inner/manager 与派发子代理可读身份，提升 session-liveness「这是谁的会话」判据健壮性 |
| `--settings <file-or-json>` | 把正确的启动参数固化成检查进仓库的文件 | 直接防「启动命令打错」（restart-plan AC1 的错）——不再靠记忆打一行 |
| `--bare`（一次性验证会话） | 最小模式（跳过 hooks/LSP/plugin 同步/自动记忆/预取） | 一次性验证会话更安全更快——今晚 AC3b 负控制事故若在 --bare 隔离会话里做，波及面小得多 |

### 高相关但 -p 条件性（本任务只标注，不实现）

- `--replay-user-messages`（stream-json）——结晶送达算法（send-keys-reliable.sh）的原生版本；
- `--max-budget-usd`（print 模式）——对冲 `-p` 只认 API key 的计费风险（见
  `RESEARCH-claude-p-streaming-2026-08-04.md` 实钱风险）；
- `--forward-subagent-text`（print+stream-json）——子代理文字转发，减少手工读 subagent jsonl。

⇒ **这三项延后到 -p 迁移决定后**（届时它们直接改写结晶算法与计费风险；先记在这里，不现在实现）。

### 明确不做

二进制里翻出的几百个未文档化 `CLAUDE_CODE_*` 内部环境变量——不推荐使用任何一个（无官方背书、
随时可变、可能有副作用），不进产品。

### 与既有任务的关系

- `gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false`（`--prompt-suggestions false`）
  与本任务的 settings 文件**落到同一个启动配置**——本任务落地时合并两者，启动规范一份。
- **交叉标注（gap-os-anchor-watchdog-launch-missing-prompt-suggestions，2026-08-06，AC3）**：
  os-anchor watchdog 的 launch-cmd 同样消费这份启动配置——`plugin/scripts/os-anchor-install.sh` 的
  launch 字符串现已**单源化**（`LAUNCH_CMD` 共享常量，含 REQUIRED 冷启动参数
  `--prompt-suggestions false` + `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`），
  与 settings 文件/`quay-launch.sh` 的启动配置**同源**，消除两处 launch 字符串的二次漂移。
  该任务 AC1/AC2 落地于 `plugin/test/os-anchor-watchdog.test.mjs`（机械断言生成 config 的
  launch-cmd 必带该参数）。
- 中等项 `--effort`（成本杠杆）与 `--tmux`（内置 worktree+tmux 配对，需先查兼容 `quay-worktrees/<slug>`
  命名）**记为本任务备注**，不立案。
- **消费方交叉标注（gap-outer-self-checks-and-creates-inner-session，2026-08-05）**：外层冷启动第 3 步
  自检 inner 缺失时调 `quay-topology.sh` 创建两窗口并起 inner claude——「起 inner claude」用的**正是**
  本任务固化的 checked-in 启动命令（`quay-topology.sh` → `quay-launch.sh <inner>` → `.claude/launch.settings.json`），
  不再手打一行 shell。同一次改动两面。
- **交叉标注（SPEC-complete-delivery-surface，2026-08-06）**：本条是六类交付面里**启动配置**（类别 3）
  的归属任务——`gap-complete-delivery-surface-spec-and-l1-verification` 的 L1 六类完整性检查
  （`verify-delivery-surface.ts`）把 `gap-crystallize-launch-config-into-checked-in-settings-file` 列为
  类别 3 的 `attribution`；交付物 = `.claude/launch.settings.json` + `plugin/scripts/quay-launch.sh`
  （AC4 归属无空洞）。
- **AC4 交叉标注（2026-08-06，`gap-complete-delivery-surface-spec-and-l1-verification`）**：六类交付面
  （`orchestration/SPEC-complete-delivery-surface-2026-08-05.md` §4/§6）把本条列为**启动配置类（第 3 类）**
  的归属任务——交付物 = `.claude/launch.settings.json` + `plugin/scripts/quay-launch.sh`。L1 检查
  （`plugin/scripts/l1-delivery-surface-check.ts --surface`）机械校验该交付物在位 + 归属任务已立案（无空洞）。

## Acceptance Criteria

- [x] AC1: 检查进仓库的 settings 文件（或等价固化形态）含当前模式必带参数：
      `--exclude-dynamic-system-prompt-sections` + `-n/--name`（outer/inner/manager 各自身份）+ 既有
      `--prompt-suggestions false`（ghost 任务）；启动规范（restart-plan + cold-start SKILL.md）引用它，
      **不再是一条手打 shell 一行**
      落地：`.claude/launch.settings.json`（schema 键 `permissions.defaultMode=bypassPermissions` +
      `env` 六项含 `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION="false"`；扩展 `_launchSpec` 含
      `excludeDynamicSystemPromptSections:true` + 三角色 `name`/`launcher`/`model`/`env`）。917k 上下文/
      压缩是 deepseek 专用——manager 角色 `env` 把三个 917k 变量置空串（launcher 合并时删键），避免
      Anthropic 默认模型「压缩过晚 API 报错」（session-launch-recipes §5）。launcher
      `plugin/scripts/quay-launch.sh` 把 `_launchSpec` 翻译成逐字 CLI 参数，其余 claude 参数透传
      （如 `-p`）。启动规范（session-launch-recipes §7、cold-start SKILL §Preconditions、restart-plan §7）
      均引用 settings 文件。
      全链路实跑：`bash plugin/scripts/quay-launch.sh inner --bare -p "reply with exactly: E2E-OK"`
      → `E2E-OK`（settings 文件 → launcher → claude-deepseek wrapper → 真实 claude 会话）。
- [x] AC2: 并发子代理 cache 收益可证——并发 worktree 子代理（如 batch-4 形态）启动带
      `--exclude-dynamic-system-prompt-sections` 后，prompt cache 命中率/token 量变化记录
      （cache 命中率上升或同负载 token 下降为判据）
      实测（两个不同 cwd，back-to-back `claude -p --output-format json --verbose`，同 prompt）：
      ```
      无 flag：cwd1 in=54936  |  cwd2 in=55418  → Δ=482 tokens（system prompt 含 cwd/env/git 段，跨 cwd 不同）
      带 flag：cwd1 in=54856  |  cwd2 in=54856  → Δ=0   （per-machine 段挪进首条 user 消息，system prompt 逐字节相同）
      ```
      Δ=0 即跨 worktree cwd 复用的**可观测前置条件**（相同 system prompt 前缀 ⇒ cache 可命中）。注：deepseek
      端点对 `cache_read_input_tokens`/`cache_creation_input_tokens` 一律报 0，故记 input_tokens 稳定性为判据；
      真 batch-4 的命中率绝对值待下次并发批实测。
- [x] AC3: `-n/--name` 落地——outer/inner/manager 会话有稳定可读名，session-liveness 的
      「这是谁的会话」判据能按名分辨（实跑输出贴任务体）
      实跑：`claude-deepseek --settings .claude/launch.settings.json --exclude-dynamic-system-prompt-sections
      --model deepseek-v4-flash -n quay-ac3-probe -p "reply with exactly: NAME-OK"` → `NAME-OK`；
      会话 transcript 记名：
      `{"type":"custom-title","customTitle":"quay-ac3-probe","sessionId":"61fed127-0f9b-4d30-99a1-9b2056508c36"}`
      launcher 三角色 `-n quay-manager / quay-outer / quay-inner` 互不相同（AC7 测试断言）。
- [x] AC4: **负控制（settings 文件防打错）**——按 settings 文件启动的会话，其启动参数与文件逐字一致
      （对照输出贴任务体）；刻意改错一个参数 ⇒ 启动参数与文件不一致（负控制）
      正控（launcher --dry-run 输出与 settings 文件逐字一致）：
      ```
      $ bash plugin/scripts/quay-launch.sh outer --dry-run
      claude-deepseek --settings /home/yale/work/quay-worktrees/launch-config/.claude/launch.settings.json --exclude-dynamic-system-prompt-sections --model deepseek-v4-flash -n quay-outer
      ```
      invoke 校验：`claude --settings .claude/launch.settings.json --version` → `2.1.222 (Claude Code)`（exit 0）。
      负控（AC7 测试）：把 `_launchSpec.roles.inner.model` 从 `deepseek-v4-flash` 改成 `deepseek-v4-pro` ⇒
      `quay-launch.sh inner --dry-run` 输出含 `--model deepseek-v4-pro`，与正控命令不一致。
- [x] AC5: `--bare` 用于一次性验证会话的规范落地（记录在启动规范；标注「一次性验证用」，不长驻）
      落地：`_launchSpec.bare`（enabled+purpose+usage）+ launcher `--bare` 参数（AC7 测试断言正常启动不含
      `--bare`、显式 `--bare` 才追加）；cold-start SKILL §Preconditions 记录一次性验证形态。
- [x] AC6: -p 条件性三项标注在启动规范/调研文档（replay/max-budget/forward-subagent-text 延后到 -p
      迁移决定），不现在实现
      落地：`_launchSpec.deferredToPpMigration` 三项（flag/why/when）+ RESEARCH 文档 §高相关但 -p 条件性
      标注「不现在实现」。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`（若 settings 校验可测试化）
      落地：`plugin/test/launch-settings.test.mjs`（`// @test-group governance`，11 用例全过）：
      `node --test plugin/test/launch-settings.test.mjs` → `pass 11 / fail 0 / cancelled 0`；
      `scripts/test.sh --for-task ... --allow-thin` 全绿（静态 tier + dist build + 11 用例，exit 0）。

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC2/AC3/AC4 实跑输出逐字贴任务体
- [ ] 启动规范从「手打一行」变成「引用 settings 文件」；restart-plan AC1 的负控制（模型选错）在
      settings 形态下机械可查
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-crystallize-launch-config-into-checked-in-settings-file.md（自身文件：勾 AC + 贴 invoke 证据授权）
- orchestration/RESEARCH-claude-code-cli-config-2026-08-05.md（结果回写）
- orchestration/restart-plan-2026-08-04-third.md（或当前启动计划）
- plugin/skills/cold-start/SKILL.md
- orchestration/session-launch-recipes.md
- `.claude/launch.settings.json` (new)（启动 settings 文件）
- `plugin/scripts/quay-launch.sh` (new)（launch spec 的机械加载器：settings → 逐字启动命令）
- `plugin/test/launch-settings.test.mjs` (new)（AC7 settings/launcher 校验测试）

## Test-Files

- plugin/test/launch-settings.test.mjs

## Contract

measure   cache_hit_delta = 并发子代理启动带/不带 `--exclude-dynamic-system-prompt-sections` 的 token 量或 cache 命中差字段
band      cache_hit_delta = 同负载下带选项 token 不升（cache 复用改善或持平）
invariant settings_is_authoritative = 1（启动参数与 settings 文件逐字一致，负控制可查）
invoke    `claude --settings .claude/launch.settings.json --version`（或等价校验）
control   settings 文件启动参数逐字一致；刻意改错 ⇒ 不一致（AC4）
resume    settings 文件与启动规范分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T00:5xZ
changed: 外层读调研全文后裁定。四处收紧：
(1) **合并成一个「启动配置结晶」任务**——3 项当前模式适用参数 + ghost 的 prompt-suggestions 落到
同一个 settings 文件，不散成多个任务（启动规范一份）；
(2) **AC4 负控制（settings 防打错）**——正控是逐字一致、负控是刻意改错必不一致，直接钉 restart-plan
AC1 那类错；
(3) **AC2 的 cache 收益要可证**——并发子代理是今晚最重的成本点，收益不是宣称是实测（token/命中变化）；
(4) **-p 条件性三项只标注不实现**——replay/max-budget/forward 是 -p 迁移后的改写，现在做是提前。
status: todo——不阻塞当前批（batch-4 在飞），排批后。
