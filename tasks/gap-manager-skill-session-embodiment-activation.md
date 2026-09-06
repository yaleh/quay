---
id: gap-manager-skill-session-embodiment-activation
title: 改造 plugin/skills/manager/SKILL.md——支持会话内"变身为 manager"激活路线（替代外部启动新会话）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-skill-start-drivers-webserver
---
## Proposal

**人描述的 quay 典型启用流程** — 手动 Claude Code 会话 → 会话内调用 init skill → 会话内调用 drivers skill → 会话内调用 manager skill（当前会话自我变身为 manager）。

现有 `plugin/skills/manager/SKILL.md`（第 136 行 `## How the manager itself starts`）仍讲述旧路线：启动一个**新的独立会话**做 manager（通过 `quay manager start`）。该 skill 文档需要改造以支持**新路线**：当前会话通过 skill 调用，初始化本地 manager 家目录、加载方法论文档、武装定时锚点，之后按 manager 角色行事。

**关键改造点**：
1. **改文档的叙述重点**：从"如何启动新会话"→"当前会话如何变身为 manager"
2. **初始化 manager 本地家目录**（如不存在）：`~/.quay-global/manager/`
3. **加载 manager 方法论文档**到当前会话（包含日审机制、planning/prioritization/trend 函数、观测机制）
4. **武装定时锚点**：第一个 tick 的 CronCreate/ScheduleWakeup 入口，让 manager 开始定期运行（参照 `orchestration/REVIEW-cadence.md` 的日审机制）
5. **降级 `manager-start.sh` 角色**：不删除它，标注为"第三方裸机冷启动"的备选路径；将"会话内 skill 激活"标注为**默认/推荐路线**

**复用前一个 skill 验证过的模式**：gap-skill-start-drivers-webserver 的设计已验证了"命令封装 + 幂等性 + 错误透传" pattern，Task 3 复用该模式（虽然 manager skill 的初始化更复杂，不仅涉及 CLI 命令包装）。

## AC

- [ ] `plugin/skills/manager/SKILL.md` 的 §1（introduction）已改述为"当前会话变身为 manager"路线，不再讲"启动新会话"
- [ ] `~/.quay-global/manager/` 家目录初始化代码存在（若路径不存在则创建）
- [ ] manager 方法论文档（`orchestration/REVIEW-cadence.md` + `orchestration/manager-loop-tick.md` 的摘要或链接）已加载或链接到 skill 文档中
- [ ] CronCreate/ScheduleWakeup 锚点武装代码已实现（第一个 tick 的入口点），示例调用日志/确认在 AC 中贴出
- [ ] `manager-start.sh` 的文档说明已更新，标注为"备选路径（第三方裸机冷启动场景）"，默认路线改为"见 plugin/skills/manager/SKILL.md"
- [ ] 幂等性验证：对同一会话连续调用该 skill 两次，第二次调用不产生重复初始化/覆盖错误（参照 drivers skill 的幂等设计）
- [ ] `node scripts/test.sh` 全绿（manager skill 相关测试、如存在则 plugin/test/manager-*.test.mjs）

## DoD

执行后：
- 人在已跑过 init + drivers skill 的 Claude Code 会话里，只需调用 manager skill，当前会话即进入 manager 运行模式（初始化家目录、加载文档、启动定时循环）
- 不需要人另外手动敲 tmux/CLI 命令启动"新的 manager 会话"
- manager 的两套启动路线同时可用：①默认路线 = skill 激活（会话内），②备选路线 = `manager-start.sh`（机器冷启动）
- skill 本身对已初始化的 manager 状态是安全的（幂等），对初始化失败的路径（如无权限创建家目录）给出可操作的错误信息

## Touches

- plugin/skills/manager/SKILL.md
- plugin/scripts/manager-start.sh（更新文档说明其角色）
- orchestration/REVIEW-cadence.md（参考，不修改）
- orchestration/manager-loop-tick.md（参考，不修改）
- plugin/test/manager-*.test.mjs（如有，验证 skill 的幂等性/初始化）
- tasks/gap-manager-skill-session-embodiment-activation.md
## Needs-Human

**执行 2026-09-06T03:28:43.978Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: __PERFILE__ duration_ms=24930 plugin/test/driver-runtime.test.mjs passed=false end_ms=1788665253202 cpu_ms=8700.287
- run_id：wk-prod-1788285192
- session_id：e1dd8212-7fae-4e6f-bf7c-4ed62305950a
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-manager-skill-session-embodiment-activation~wk-prod-1788285192~1788665004746-090799.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-manager-skill-session-embodiment-activation-wk-prod-1788285192.log
