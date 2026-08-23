---
id: gap-ac140-llm-command-configurable
title: AC140 可配 wrapper + model + 按 role（单一真相源 + 覆盖语义统一）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac140-llm-invocation-set-judgment
---

**type:** execution

## Proposal

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md` `### AC140`，提交 `38dd3294`，⛔ 不在此复制，读那一段）。

**缺口（四处硬编码，无单一真相源）**：`worker-driver.ts:247/708`、`promotion-driver.ts:187/190` 四处独立 `["claude","-p",prompt]`；全仓 model/wrapper 配置项零命中。

**两个覆盖旋钮语义相反（真正的阻塞点）**：promotion-driver `--fix-worker-cmd` =【前缀】（wrapper 可用 ✅）；worker-driver `--worker-cmd` =【整体替换】（wrapper 不可用 ❌，`:847` 证实任务 id 不出现在 argv 任何位置）。

## Plan

1. **单一真相源**：一个构造函数（role 作参数：worker 长任务链 / selector 短决策 / fix-worker 短编辑），消除四处硬编码。
2. **可配**：驱动 LLM spawn 走 `quay-launch.sh <role> --bare -p <prompt>`（或等价复用同一组装器，`quay-launch.sh:97-115` 已存在、`:36` 已透传 `-p`）；按 role 配置落 `_launchSpec.roles` 新增 worker 角色（task-worker / selector / fix-worker），⛔ 不在 `.quay/config.yml` 另立 launcher/model（会造双真相源，manager 60b67e47 已撤销原「第四段」）。
3. **覆盖语义统一**：统一为「前缀 + prompt」（promotion 现行语义）；worker-driver 整体替换改名 `--worker-cmd-exact`（测试专用），⛔ 两种语义不共用一个 flag 名。
4. **`llm_invoked` 字段名收窄**：字段名比语义宽——它只是晋升路径的 `isLlmInvocation(argv)`（`promotion-driver.ts:210`），fix worker spawn 不进它（`fixes[].spawned=true` 才是）。要么改名路径限定（如 `promote_path_llm_invoked`），要么扩成全轮口径；⛔ 不得保留会让读者得出相反结论的名字（同 `perfile-timeout` gate 名误导前例）。

## Acceptance Criteria

- [ ] AC1（单一真相源）：`plugin/scripts/` 下不再有 ≥2 处独立 `["claude","-p",…]`（一个构造函数，role 参数）。
- [ ] AC2（可配）：驱动的 LLM spawn 复用 `quay-launch.sh`（`<role> --bare -p`），wrapper/model 由 `_launchSpec.roles` 承载；取假（用直接量 `ANTHROPIC_BASE_URL`，⛔ 非 argv0——`claude-fjdac` 末行 `exec claude "$@"` 使 argv0 恒为 claude、spawn argv 是 bash 也验不到）：spawn 出的 worker 进程 env 无 `ANTHROPIC_BASE_URL`（wrapper 不在链），或 `--model` 未出现在其命令行 ⇒ 假。
- [ ] AC3（覆盖语义统一）：统一「前缀 + prompt」；整体替换语义改名 `--worker-cmd-exact`，⛔ 不与前缀语义共用一个 flag。
- [ ] AC4（quay-launch.sh 回归，能取假）：改 `quay-launch.sh` 后实跑 `--dry-run` 对 `manager`/`outer`/`inner` 三既有角色各验一遍——**排除 `--settings` 载荷本身**，只比「启动语义」字段（`launcher` · `--exclude-dynamic-system-prompt-sections` · `--prompt-suggestions false` · `--model <m>` · `-n <name>`）逐字一致；`--settings` 只核【类型不变】（outer/inner 仍文件路径、manager 仍内联 JSON）且 manager 内联 JSON 的 `.env` 键集不变。取假：launcher/model/name/flag 变，或 manager 的 917k 三键剥离消失 ⇒ 假。

## Definition of Done

- [ ] 单一构造 + 可配 + 覆盖语义统一落地；AC1-4 全勾（含配置 wrapper 仍 spawn 裸 claude 取假 + quay-launch.sh 三角色 --dry-run 回归）；land 到 develop。

## Retires

- `--worker-cmd` 的整体替换语义（改名 `--worker-cmd-exact`，测试专用）

## Touches

- plugin/scripts/worker-driver.ts（defaultWorkerArgv / defaultSelectorArgv 单一构造）
- plugin/scripts/promotion-driver.ts（buildFixWorkerArgv 单一构造）
- .claude/launch.settings.json（_launchSpec.roles 新增 worker 角色）
- plugin/scripts/quay-launch.sh（复用组装器，透传 -p）
- plugin/test/worker-driver.test.mjs（覆盖语义取假）
- tasks/gap-ac140-llm-command-configurable.md（自身）

> **注意**：与 AC139（承载/入口）Touches 零重叠，可并行派；配置面复用 `_launchSpec.roles` + `quay-launch.sh`（⛔ 不另立 config.yml 段）。⛔ 不裁定具体 model——配置值由人/项目定，本条只要求可配且被真实使用。

> **落笔方须实测再定（⛔ 别猜，manager 60b67e47）**：① `quay-launch.sh:114` `-n <name>` 无条件追加——三个并发 worker 若都叫 `quay-inner` 会在 `ListAgents` 撞名；要么新角色各有其名，要么确认 `-p` 模式根本不注册会话。② `--bare` 定义（一次性验证会话：跳过 hooks/LSP/plugin 同步/自动记忆/预取，不长驻）对 selector/fix-worker 正好合用，但对 task-worker（长任务链）是否合适须实测，⛔ 不照搬到三种 role。

> **exitCode=1 假说（⛔ 仍是假说，别当结论）**：`buildFixWorkerArgv` spawn 裸 `claude -p`，相对 inner/outer 少 `--settings`（含 permissions.defaultMode=bypassPermissions ⇒ 裸 claude 非交互遇权限提示可能退）与 `claude-fjdac`（wrapper 靠 env 注入凭据 ⇒ 裸 claude 走另一套可能无效凭据）。**能区分的对照**：同一 prompt 分别跑 `quay-launch.sh inner --bare -p "<prompt>"` 与裸 `claude -p "<prompt>"`——前者成/后者败 ⇒ 成因在启动形态（本条一并修）；两者都败 ⇒ 成因在 prompt 本身。另：`claude-fjdac` 末行 `exec claude "$@"`（exec 替换自身）⇒ inner/outer 进程 argv[0] 就是 `claude`，wrapper 贡献全在 env、ps 看不见，⛔ 不能用「ps 里是 claude」推断「没用 wrapper」。

> **AC4 基线（改动前捕获，HEAD `a766e35d`，manager 提供——⛔ 验收时无物可比）**：
> ```
> outer   ⇒ claude-fjdac --settings /home/yale/work/quay/.claude/launch.settings.json \
>           --exclude-dynamic-system-prompt-sections --prompt-suggestions false \
>           --model deepseek-v4-pro -n quay-outer
> inner   ⇒ 同上，仅 -n quay-inner
> manager ⇒ claude --settings <内联 JSON，含完整 _launchSpec> \
>           --exclude-dynamic-system-prompt-sections --prompt-suggestions false -n quay-manager
>   ⊢ 关键可比量：launcher=claude · 无 --model · -n quay-manager ·
>     内联 JSON 的 .env 键集 = {CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN, CLAUDE_CODE_DISABLE_MOUSE,
>     CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION, QUAY_MAX_CONCURRENT_SUITES}
>     ——⛔ 917k 三键（MAX_CONTEXT_TOKENS/AUTO_COMPACT_WINDOW/AUTOCOMPACT_PCT_OVERRIDE）【不在】其中
> ```
> **⊢ AC4 为何排除 settings 载荷**：manager 的 `--settings` 是内联 JSON（`quay-launch.sh:92-96`，ROLE_ENV 非空 ⇒ jq -c 合并），完整含 `_launchSpec.roles`；AC140-2 往 roles 加 worker 角色 ⇒ 内联 JSON 必然变 ⇒ 若 AC4 比「逐字一致」对 manager 恒假（正确实现的假红，同 manager AC140-4 之错）。故只比「启动语义」字段 + settings 类型 + manager .env 键集。

> **⚠️ 照错样本抄的坑（manager 880f1d78，⛔ 写进任务体）**：`manager` 角色的 `launcher` 是裸 `"claude"`、`model` 是 `null`（跑 Anthropic 默认模型 + 剥 917k env）。**新增 `task-worker`/`selector`/`fix-worker` 若照 manager 抄 ⇒ 拿到裸 claude、不走 wrapper、无 model**。且 `quay-launch.sh:80` 只查 `launcher` 非空、不查取值 ⇒ 这个错**没有任何机件报错**，只在运行时表现「模型不对/凭据不对」——**与你那条 fix worker `exitCode=1` 的症状同形**（届时难辨新错旧错）。**⇒ 新 worker 角色必须照 `outer`/`inner` 抄：`launcher: "claude-fjdac"`、`model: "deepseek-v4-pro"`。**
