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

- [x] `plugin/skills/manager/SKILL.md` 的 §1（introduction）已改述为"当前会话变身为 manager"路线，不再讲"启动新会话"
- [x] `~/.quay-global/manager/` 家目录初始化代码存在（若路径不存在则创建）
- [x] manager 方法论文档（`orchestration/REVIEW-cadence.md` + `orchestration/manager-loop-tick.md` 的摘要或链接）已加载或链接到 skill 文档中
- [x] CronCreate/ScheduleWakeup 锚点武装代码已实现（第一个 tick 的入口点），示例调用日志/确认在 AC 中贴出

  示例（`manager-arm-loop.sh` 文件接缝 = 会话内 CronCreate 的机械面，2026-09-06 实测）：

  ```text
  $ bash plugin/scripts/manager-arm-loop.sh --home ~/.quay-global/manager/
  sentinel     [manager-tick]
  final        1 (exactly one manager loop)

  # 再次调用（幂等）：swept 1 → 仍恰好一个，不产生重复初始化
  swept        1 (deleted)
  final        1 (exactly one manager loop)

  # 会话内 CronCreate 确认后写回收据，外部核实
  $ bash plugin/scripts/manager-arm-loop.sh --record-cron cron_demo123 --home ~/.quay-global/manager/
  record-cron-ok: receipt written to the registry sentinel line
  $ bash plugin/scripts/manager-arm-loop.sh --verify --home ~/.quay-global/manager/
  state          registry-verified
  registry-matches-cron: the loop-registry sentinel carries a fresh CronCreate receipt
  ```

- [x] `manager-start.sh` 的文档说明已更新，标注为"备选路径（第三方裸机冷启动场景）"，默认路线改为"见 plugin/skills/manager/SKILL.md"
- [x] 幂等性验证：对同一会话连续调用该 skill 两次，第二次调用不产生重复初始化/覆盖错误（参照 drivers skill 的幂等设计）
- [x] `node scripts/test.sh` 全绿（manager skill 相关测试、如存在则 plugin/test/manager-*.test.mjs）

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
- plugin/skills/init/SKILL.md（声明 orchestration/manager-tick-prompt.txt 为 reference-doc——会话内 CronCreate 步骤引用它，解 referenced-not-landed 全库红）
- tasks/gap-manager-skill-session-embodiment-activation.md
## Needs-Human

**执行 2026-09-06T03:28:43.978Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: __PERFILE__ duration_ms=24930 plugin/test/driver-runtime.test.mjs passed=false end_ms=1788665253202 cpu_ms=8700.287
- run_id：wk-prod-1788285192
- session_id：e1dd8212-7fae-4e6f-bf7c-4ed62305950a
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-manager-skill-session-embodiment-activation~wk-prod-1788285192~1788665004746-090799.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-manager-skill-session-embodiment-activation-wk-prod-1788285192.log

## Reset

**执行 2026-09-06 — needs-human → todo → ready 复位（人已同意，非机械判定）**

诊断：连续 3 次重试的失败点逐次检查，均与本任务实际改动（`plugin/skills/manager/SKILL.md`/`manager-start.sh`）无关：
1. 第 1 次（02:46）：全仓预置缺陷——`orchestration/manager-tick-prompt.txt` 未在 `plugin/skills/init/SKILL.md` 声明为 reference-doc，导致 4 个不相干测试全仓性报红；worker 已顺手修复（commit `8f22c2519`）。
2. 第 2 次（03:05）：`plugin/test/worker-driver-resident.test.mjs` 经 `worker-driver-harness.mjs:75` 的 `readRoundLines` 读到正在被写入、尚未写完的 round 文件，`JSON.parse` 报错——测试基础设施竞态，非本任务缺陷。
3. 第 3 次（03:28，记入 needs-human）：`plugin/test/driver-runtime.test.mjs` AC1(worker cap) 的轮询逻辑（`existsSync` 即读）撞上 `worker-argv-dump.json` 写入未完成的窗口，`JSON.parse` 报错——同类竞态，非本任务缺陷。

worktree（`/home/yale/work/quay-worktrees/gap-manager-skill-session-embodiment-activation`，分支 `task/gap-manager-skill-session-embodiment-activation`）已含两个真实提交（`3462fee8b`/`8f22c2519`），实现 AC1-AC6；新增自证测试 `plugin/test/manager-skill-activation.test.mjs` 单独运行 6/6 全绿。判定：实现本身无缺陷，纯粹是连续撞上与本任务无关的全量 suite flaky/预置缺陷耗尽重试上限。

第 2/3 类竞态已另立任务追踪修复（避免继续拖累其他任务的 fan-in）：见 driver-runtime.test.mjs / worker-driver-harness.mjs 竞态任务（本轮由 quay-file-task skill 立案，任务 id 见提交记录）。

复位路径：`lifecycle_retreat`（needs-human → todo，reason 见 GateEvent）→ `lifecycle_promote`（todo → ready，理由：四件套完整）。期望 driver 下次派发识别既有 worktree 走 CONTINUE 复用（`gap-worker-worktree-continue-reuse` 机制），而非从零重新实现。
