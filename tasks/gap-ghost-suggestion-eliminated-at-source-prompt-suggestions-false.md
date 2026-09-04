---
id: gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false
title: ghost-suggestion (reliable-send fault 6) can be eliminated at source via
  --prompt-suggestions false / CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false — verify
  safely, then make it a required cold-start launch parameter
  --prompt-suggestions false / CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false —
  verify safely, then make it a required cold-start launch parameter
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者交办（2026-08-05，人裁定）。可靠发送结晶文档的**故障 6**（gray ghost-suggestion 无法硬清空——
C-u/C-a+C-k 循环 N 次 pane 内容逐字不变）**可以从源头消除**，不只是运行时判定绕过：

- `claude --help` 实测：`--prompt-suggestions [value]` ——「Enable prompt suggestions. In print/SDK
  mode, emits a prompt_suggestion message」。官方描述：**交互模式下渲染为输入框里的灰色占位建议文字**。
- 环境变量 `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` 等价关闭。
- 人已裁定：**验证成功后，这要作为冷启动要求之一**（不是可选项）。

**为何值得做**：ghost-suggestion 是今晚送端故障族的故障 6 的根——外层把框里的灰色占位文字读成
「内层已提交的行动」（R2 AC8 反向踩坑），是「两层都正确空闲 = 没人推进」形态的触发器。从源头关掉，
故障 6 不再出现。

**验证必须安全**：改动只在**下次启动**生效，不能动态加到已跑起来的会话上 ⇒ 用**一次性 throwaway
会话**（scratch 目录 + 独立 tmux 会话，**绝不动 quay-0 的运行循环**）验证。

## Acceptance Criteria

- [x] AC1: **安全验证**——一次性 throwaway 会话（scratch 目录、独立 tmux session、与 quay-0 运行
      循环隔离）以 `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` + `--prompt-suggestions false` 启动，
      空闲时输入框**不出现**灰色占位建议；验证后 kill 该会话，运行循环零接触
- [x] AC2: **负控制（对照）**——另一个 throwaway 会话**不带**该配置启动 ⇒ 输入框**出现**灰色占位建议
      （证明测试能检出该形态）；带配置 ⇒ 不出现。两个方向的实跑输出逐字贴任务体
- [x] AC3: **冷启动要求**——验证通过后，启动命令规范（`orchestration/restart-plan-*.md` 与
      `plugin/skills/cold-start/SKILL.md`）加入 **必带参数**：`--prompt-suggestions false` +
      `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`，标注 **REQUIRED 非可选**
- [x] AC4: **故障 6 标注**——`orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md` 故障 6 标注
      「已被环境配置从源头消除；运行时判定逻辑（直接输入覆盖）保留作历史兜底」
- [x] AC5: 一致性——`QUAY-OUTER-HANDOFF.md` / tick 文档若描述启动命令，同步该参数（grep 全仓核对；
      无则记「无其它实例」）
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`（若验证逻辑可测试化）

## Invoke Evidence（2026-08-06 实跑，throwaway 会话；quay-0 零接触）

**验证环境**：scratch 目录 `/tmp/ghost-verify-1785980028/`，独立 tmux session（`ghost-neg-*` / `ghost-pos-*`），
与 quay-0 运行循环隔离；验证后按名 `tmux kill-session`，`tmux ls` 无 ghost 残留，quay-0 manager/outer/inner 原样。

### AC2 负控制（不带配置 ⇒ 有建议）

会话命令（无 prompt-suggestion 配置）：
```
CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 CLAUDE_CODE_DISABLE_MOUSE=1 claude-deepseek --permission-mode bypassPermissions
```
`tmux capture-pane -p -t ghost-neg-1785980028`（空闲 35s 后）输入框行（逐字，hexdump 佐证）：
```
❯ Try "fix lint errors"
```
字节级：`e2 9d af c2 a0 54 72 79 20 22 66 69 78 20 6c 69 6e 74 20 65 72 72 6f 72 73 22 0a`
= `❯ <NBSP> Try "fix lint errors"\n` —— 灰色占位建议**出现**。

### AC1 / AC2 正控制（带配置 ⇒ 无建议）

会话命令（配置齐全，即启动规范要求的双路线）：
```
CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 CLAUDE_CODE_DISABLE_MOUSE=1 CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false claude-deepseek --prompt-suggestions false --permission-mode bypassPermissions
```
`tmux capture-pane -p -t ghost-pos-1785980085`（空闲 35s 后）输入框行（逐字，hexdump 佐证）：
```
❯ 
```
字节级：`e2 9d af c2 a0 0a` = `❯ <NBSP>\n` —— 输入框**无**灰色占位建议；整 pane grep `Try |fix lint|write a test|how do I` = **0 命中**。

### 启动规范真实路径验证（AC1 补强，走更新后的启动规范）

用 `plugin/scripts/quay-launch.sh inner --bare`（materialized 启动命令 = settings 文件 + launcher，
含 `--prompt-suggestions false` + env 变量）起 throwaway 会话，输入框行逐字：
```
❯ 
```
字节级：`e2 9d af c2 a0 0a` = `❯ <NBSP>\n` —— 无 ghost；整 pane grep 建议文本 = **0 命中**。
⇒ 更新后的启动规范（AC3 路径）实跑无 ghost-suggestion（非构造，真实冷启动路径的 one-shot 形态）。

### 启动规范落地（AC3）—— 机械可验

- `.claude/launch.settings.json`：`env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "false"` **且**
  `_launchSpec.promptSuggestions: false`（双路线 REQUIRED）。
- `plugin/scripts/quay-launch.sh`：`_launchSpec.promptSuggestions == false` ⇒ 逐角色 `--dry-run` 输出含
  `--prompt-suggestions false`（实测 manager/outer/inner 三角色均有）。
- `orchestration/restart-plan-2026-08-04-third.md` §8、`plugin/skills/cold-start/SKILL.md`：REQUIRED 标注。

### AC6 测试（node:test，`// @test-group governance`）

`plugin/test/launch-settings.test.mjs` 新增两条 AC6 断言（双路线 REQUIRED + 负控删键掉 flag）。
scoped 验证输出摘录：
```
node --test plugin/test/launch-settings.test.mjs
ℹ tests 13
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
```
`scripts/test.sh --for-task gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false --allow-thin`
→ **EXIT 0**，task-contract-check 0 violations，drive-contract-check 0 violations，stale-refs 无新增。

### AC5 一致性核对（grep 全仓）

- `orchestration/QUAY-OUTER-HANDOFF.md`：**不拼写启动命令**（仅提及模型裁定 `claude-deepseek`）⇒ 无需同步。
- `plugin/skills/session-topology/SKILL.md` / `plugin/scripts/quay-topology.sh`：启动命令**由 quay-launch.sh 单源生成**，
  无手打命令可漂移 ⇒ 无需同步。
- `plugin/scripts/os-anchor-install.sh` / `os-anchor-watchdog.sh`：硬编码 launch-cmd **缺** `--prompt-suggestions false`
  —— 但已由**独立任务** `gap-os-anchor-watchdog-launch-missing-prompt-suggestions`（todo）单独追踪，非本任务范围。
- `orchestration/RESEARCH-claude-code-cli-config-2026-08-05.md`：落地行已更新为双路线描述（本任务顺手订正）。
      **证据（2026-08-06，throwaway `ghost-ac1`，独立 socket `/tmp/ghost-ac1.sock`，scratch `/tmp/ghost-ac1`）**：
      命令 = `cd /tmp/ghost-ac1 && CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false claude-deepseek --prompt-suggestions false --permission-mode bypassPermissions -n ghost-ac1 --model deepseek-v4-flash`
      （与 quay-b 运行循环零接触——独立 socket，验证后 `kill-server` + kill 残留进程，quay-b 全程未动）。
      空闲输入框（`❯` 后）**无灰色占位建议**，实拍输出逐字：
      ```
      ╭─── Claude Code v2.1.222 ─────────────────────────────────────────────────────╮
      │                                           │ Tips for getting started         │
      │               Welcome back!               │ Ask Claude to create a new app … │
      ...
      ─────────────────────────────────────────────────────────────────── ghost-ac1 ──
      ❯ 
      ────────────────────────────────────────────────────────────────────────────────
        ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents
      ```
      字节级（`cat -A`）：输入框行为 `M-bM-^]M-/M-BM- $` = `❯` + NBSP（真空），无任何建议文本。
- [x] AC2: **负控制（对照）**——另一个 throwaway 会话**不带**该配置启动 ⇒ 输入框**出现**灰色占位建议
      （证明测试能检出该形态）；带配置 ⇒ 不出现。两个方向的实跑输出逐字贴任务体
      **方向一（带配置 ⇒ 无建议）**：即 AC1，输入框 `❯ ` 后无文本。
      **方向二（不带配置 ⇒ 有建议）**——throwaway `ghost-ac2`，独立 socket `/tmp/ghost-ac2.sock`，
      scratch `/tmp/ghost-ac2`，命令 = `cd /tmp/ghost-ac2 && claude-deepseek --permission-mode bypassPermissions -n ghost-ac2 --model deepseek-v4-flash`（无 flag、无 env）。
      空闲输入框（`❯` 后）**出现灰色占位建议**，实拍输出逐字：
      ```
      ╭─── Claude Code v2.1.222 ─────────────────────────────────────────────────────╮
      │                                           │ Tips for getting started         │
      │               Welcome back!               │ Ask Claude to create a new app … │
      ...
      ─────────────────────────────────────────────────────────────────── ghost-ac2 ──
      ❯ Try "edit <filepath> to..."
      ────────────────────────────────────────────────────────────────────────────────
        ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents
      ```
      字节级（`cat -A`）：输入框行为 `M-bM-^]M-/M-BM- Try "edit <filepath> to..."$` = `❯` + 空格 +
      `Try "edit <filepath> to..."`。两个方向唯一变量是配置本身（同一 claude 2.1.222、同一启动形状、
      同 welcome 屏），AC1 无建议 / AC2 有建议 —— 测试能检出该形态，且配置确实关掉它。
- [x] AC3: **冷启动要求**——验证通过后，启动命令规范（`orchestration/restart-plan-*.md` 与
      `plugin/skills/cold-start/SKILL.md`）加入 **必带参数**：`--prompt-suggestions false` +
      `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`，标注 **REQUIRED 非可选**
      **落地**：`orchestration/restart-plan-2026-08-04-third.md` §8（REQUIRED 两条 + 机械落实）；
      `plugin/skills/cold-start/SKILL.md`（REQUIRED launch params 段）。**机械执行**：
      `.claude/launch.settings.json` 顶层 `env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION="false"` +
      `_launchSpec.promptSuggestions:false`；`plugin/scripts/quay-launch.sh` 对每个角色命令追加
      `--prompt-suggestions false`（三个角色 `--dry-run` 均含，见下）；测试机械断言（AC6）。
      三个角色 dry-run 实拍：
      ```
      outer:  claude-deepseek --settings <root>/.claude/launch.settings.json --exclude-dynamic-system-prompt-sections --prompt-suggestions false --model deepseek-v4-flash -n quay-outer
      inner:  claude-deepseek --settings <root>/.claude/launch.settings.json --exclude-dynamic-system-prompt-sections --prompt-suggestions false --model deepseek-v4-flash -n quay-inner
      manager: claude --settings <root>/.claude/launch.settings.json --exclude-dynamic-system-prompt-sections --prompt-suggestions false -n quay-manager
      ```
- [x] AC4: **故障 6 标注**——`orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md` 故障 6 标注
      「已被环境配置从源头消除；运行时判定逻辑（直接输入覆盖）保留作历史兜底」
      **落地**：故障 6 修法段后新增 2026-08-06 标注——「故障 6 **已被环境配置从源头消除**——`
      --prompt-suggestions false` + `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`（冷启动 REQUIRED 参数）……
      **运行时判定逻辑（直接输入覆盖）保留作历史兜底**——防未来版本行为变化，不删」。
- [x] AC5: 一致性——`QUAY-OUTER-HANDOFF.md` / tick 文档若描述启动命令，同步该参数（grep 全仓核对；
      无则记「无其它实例」）
      **grep 全仓核对结果**：`QUAY-OUTER-HANDOFF.md` **无字面启动命令**（仅第 4 行散文提到
      `claude-deepseek`，非启动命令）→ 无其它实例需同步。字面启动命令在以下文件，均已同步：
      `orchestration/restart-plan-2026-08-04-third.md`（§8）、`plugin/skills/cold-start/SKILL.md`、
      `orchestration/session-launch-recipes.md`（§7 dry-run 示例）、`plugin/skills/manager/SKILL.md`、
      `plugin/scripts/os-anchor-install.sh`（两处 launch 字符串）。引用 `quay-launch.sh` 的
      （session-topology/init/quay-topology）经 launcher 自动带 flag，无需改。
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`（若验证逻辑可测试化）
      **落地**：扩展 `plugin/test/launch-settings.test.mjs`（既有 `// @test-group governance` +
      `import { test } from "node:test"`）——新增「AC1 _launchSpec.promptSuggestions 必须为 false」、
      「AC4 正控：每个角色 dry-run 命令都含 `--prompt-suggestions false`」、
      「AC4 负控：`promptSuggestions` 翻成 `true` ⇒ flag 消失」。实跑 `12 pass / 0 fail / 0 cancelled`。

## Definition of Done

- [x] AC1–AC6 全部勾上；AC2 两个方向的实跑输出逐字贴进本任务体
- [x] 一次真实冷启动路径验证：按更新后的启动规范起一个会话，输入框无 ghost-suggestion（非构造）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches
- tasks/gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false.md（自身文件：勾 AC + 贴 invoke 证据授权）
- .claude/launch.settings.json
- plugin/scripts/quay-launch.sh
- plugin/test/launch-settings.test.mjs
- orchestration/restart-plan-2026-08-04-third.md

- tasks/gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false.md
- orchestration/restart-plan-2026-08-04-third.md（或当前生效的启动计划）
- plugin/skills/cold-start/SKILL.md
- orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md（故障 6 标注）
- orchestration/RESEARCH-claude-code-cli-config-2026-08-05.md（双路线落地行订正）

## Contract

measure   ghost_suggestions = `tmux capture-pane -p -t <throwaway>` stdout 中 `❯ .*` 输入框行的建议文本字段
band      ghost_suggestions = 0（带配置后输入框无灰色占位建议）
invariant cold_start_launch_has_flag = 1（启动规范里 --prompt-suggestions false 为必带）
invoke    `claude-deepseek --prompt-suggestions false --permission-mode bypassPermissions`（throwaway）
control   不带配置 ⇒ 有建议；带配置 ⇒ 无建议（AC2 双向）
resume    验证与规范更新分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T00:0xZ
changed: 外层受人裁定立案。四处收紧：
(1) **验证用 throwaway 会话**——改动只下次启动生效，绝不动运行中的 quay-0 循环（安全边界写死）；
(2) **AC2 负控制**——必须先证明「不带配置会出现建议」（测试能检出），再证明「带配置不出现」，
防止「本来就看不到」被误当「关掉了」；
(3) **AC3 是 REQUIRED 不是可选**——人裁定这是冷启动要求，启动规范按必带参数写；
(4) **AC4 标注故障 6**——运行时判定逻辑保留作历史兜底，不删（防未来版本行为变化）。
status: todo——不紧急（overshoot 已修，不阻塞），排当前批之后。
