---
id: gap-ghost-suggestion-eliminated-at-source-prompt-suggestions-false
title: ghost-suggestion (reliable-send fault 6) can be eliminated at source via
  --prompt-suggestions false / CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false — verify
  safely, then make it a required cold-start launch parameter
status: todo
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

- [ ] AC1: **安全验证**——一次性 throwaway 会话（scratch 目录、独立 tmux session、与 quay-0 运行
      循环隔离）以 `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` + `--prompt-suggestions false` 启动，
      空闲时输入框**不出现**灰色占位建议；验证后 kill 该会话，运行循环零接触
- [ ] AC2: **负控制（对照）**——另一个 throwaway 会话**不带**该配置启动 ⇒ 输入框**出现**灰色占位建议
      （证明测试能检出该形态）；带配置 ⇒ 不出现。两个方向的实跑输出逐字贴任务体
- [ ] AC3: **冷启动要求**——验证通过后，启动命令规范（`orchestration/restart-plan-*.md` 与
      `plugin/skills/cold-start/SKILL.md`）加入 **必带参数**：`--prompt-suggestions false` +
      `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`，标注 **REQUIRED 非可选**
- [ ] AC4: **故障 6 标注**——`orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md` 故障 6 标注
      「已被环境配置从源头消除；运行时判定逻辑（直接输入覆盖）保留作历史兜底」
- [ ] AC5: 一致性——`QUAY-OUTER-HANDOFF.md` / tick 文档若描述启动命令，同步该参数（grep 全仓核对；
      无则记「无其它实例」）
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group governance`（若验证逻辑可测试化）

## Definition of Done

- [ ] AC1–AC6 全部勾上；AC2 两个方向的实跑输出逐字贴进本任务体
- [ ] 一次真实冷启动路径验证：按更新后的启动规范起一个会话，输入框无 ghost-suggestion（非构造）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- orchestration/restart-plan-2026-08-04-third.md（或当前生效的启动计划）
- plugin/skills/cold-start/SKILL.md
- orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md（故障 6 标注）
- orchestration/QUAY-OUTER-HANDOFF.md（AC5 若需同步）

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
