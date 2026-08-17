---
id: gap-webui-manager-page-session-targets
title: WebUI /manager「三层状态」只显示一层——readManager 的 session-liveness --once 未传 env override，源的是单目标 SESSION_TARGETS
status: ready
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**人类指出（2026-08-17，manager 已核实）**：「三层状态」（/manager）页未分层显示 Outer/Inner/Manager，只有一行。

**设计正本** `Quay改进版WebUI.dc.html:502-504`：三张卡片 Outer / Inner / Manager，各自 cron/status。

**实现根因**（manager 实读）：
- `renderManagerPage`（serve-handlers.ts:1932 起）**结构上是数据驱动的**（对 `mgr.liveness.sessions` 逐条渲染卡片，:1977），没写死单层。
- 真根因在数据源：`readManager`（observation.ts:943）调 `session-liveness.sh --once` **不传任何 env override** ⇒ 脚本 source 仓库配置 `orchestration/session-liveness.env`；该文件 `SESSION_TARGETS="quay /home/yale/work/quay quay-0:inner"` 是**单一目标**，且只指向 `quay-0:inner`（注释写明：管理者自己的三目标配置已于 2026-08-04 移到 `~/.quay-global/manager-session-liveness.env`，本仓这份从没打算装 outer+inner 两层）。
- 实测：`bash plugin/scripts/session-liveness.sh --once` 现场只出 1 行 `SESSION-STATUS quay alive=1 pid=3266379 halted=0`。

**方向（manager 供参考，非裁定）**：给 `readManager()` 的 session-liveness 调用传显式 env override（或扩展 `session-liveness.env`）同时注册两个具名目标 `outer→quay-0:outer` / `inner→quay-0:inner`，使 `--once` 吐 2 行；Manager 自身按设计走「推断中/靠 tick-log mtime 间接心跳」的另一路径，不经 session-liveness。

**能取假（⊢ 对照）**：修复后 `bash plugin/scripts/session-liveness.sh --once`（经 readManager 路径）出 ≥2 行（outer+inner）；/manager 页渲染 ≥2 张层卡片。

## Plan

1. 读设计正本 `Quay改进版WebUI.dc.html`（:502-504 三层卡片）。
2. 改 `observation.ts readManager`：session-liveness 调用传显式 `SESSION_TARGETS`（outer→quay-0:outer / inner→quay-0:inner），或扩展 `orchestration/session-liveness.env` 注册两个具名目标。
3. 确认 `--once` 吐 2 行；`renderManagerPage` 数据驱动逐条渲染自然出 2 卡。
4. ⚠️ 注意 `orchestration/session-liveness.env` 的消费面：session-liveness.sh 默认 source 它，改它会影响默认观测目标——需确认不破坏内层/外层既有 liveness 挂载（manager 挂载显式传 env，不受影响）。
5. scoped 门 + 全量验证，fan-in。

## Acceptance Criteria

- [ ] AC1: readManager 的 session-liveness 调用注册 outer+inner 两个具名目标（显式 env 或扩展 env 文件），`--once` 出 ≥2 行。
- [ ] AC2: /manager 页渲染 ≥2 张层卡片（Outer / Inner 各一）。
- [ ] AC3: 既有 session-liveness 挂载（内层/外层 liveness 观测）不被破坏。
- [ ] AC4: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [ ] /manager 页按层显示 Outer/Inner，session-liveness 目标显式化且不破坏既有观测，scoped + 全量绿。

## Touches

- packages/quay/src/observation.ts（readManager 的 session-liveness 目标显式化）
- orchestration/session-liveness.env（目标注册；⚠️ 若改此文件，外层/内层 liveness 挂载消费它——先核消费面）
- packages/quay/test/（页面渲染测试）
- tasks/gap-webui-manager-page-session-targets.md（自身）
