---
id: gap-ac111-rescan-inner-tick-and-web-carrier
title: AC111 复扫 inner-tick 专属机件 + web 观测载体切换核查
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md`「AC115-117 全部落地后的复扫检查点」段，提交 `71965a26` + `cad6f9ae`，⛔ 不在此复制，读那一段）。

**缺口**：AC111（无代码调用者机件三选一判定）的扫描时点早于 AC115-117/AC129，**结构上扫不到 inner-tick 专属机件**——这批机件在扫描当时仍有调用者（inner 自己的 tick-core 读数/推理逻辑），只在 AC129 把决策层从 inner 的 LLM tick 会话移走之后才变成无调用者。

**触发条件已满足（机件直读）**：AC115 done · AC116 done · AC117 done · AC129 done（`f430fb5b`）。

## Plan

1. **inner-tick 专属机件复扫**：用 AC111 用过的**同一扫描谓词**（含排除 `packages/quay/plugin/` 镜像的那条修正，⛔ 不新造谓词）对 `orchestration/*-tick-core.md`（inner 专属部分）+ inner 相关机件脚本再扫一轮，逐条三选一判定（wired/retired/manual-by-design），与 AC111 同形。
2. **web 观测载体切换核查**（三点）：(a) `readLive()` 是否已切读 `.quay/worker-outcome.jsonl`；(b) `/live` 与 dashboard `liveCard` 展示的在飞语义是否与驱动直接量（fork 子进程数）一致；(c) 已 land 两条 web 任务（`live-implcomplete-state-render` / `cross-task-blocking-visibility`）基于旧模型撰写，其字段假设（`implCompletedAtMs` 等）在驱动模式下是否仍成立。
3. 结论落盘：判定记录 + web 三点结论。

## Acceptance Criteria

- [x] AC1（能取假）：重扫后「仅 .md 文档提及」类 = 0（同一谓词，同 AC111 判据）。
- [x] AC2：每条判定有记录（三选一 + 理由）。
- [x] AC3：retired 条目不在本任务删除——退役按三选一结果单独立任务，每条带「它防的缺陷现在由什么防」。
- [x] AC4：web 三点核查各有结论（切了 / 不需切+理由 / 需切但另立任务）。

## Evidence（复扫判定 + web 三点核查，本任务实测）

**复扫判定落点**：`.quay/no-code-caller-triage-rescan.jsonl`（new，header + 7 条 entry）。

**AC1 实测（grep 归位，硬规则②）**：同一谓词重扫（instrument_total 277，AC111 时 268 + 新增 9），
raw md-only 计数 = 42；join（AC111 记录 70 条 ∪ 本记录 7 条）后**无 disposition 的 raw md-only = 0**。
新增 7 条（AC111 漏扫/滞后 population）：`worker-driver.ts`（真滞后：AC111 时点早于其落地）+
`config-wiring-check.ts` / `it0-impl-row-check.sh` / `publish-dist-branch.sh` / `tree-hygiene-check.sh` /
`workflow-invariant-ownership.mjs` / `worktree-branch-hygiene-check.sh`（AC111 漏扫）。7 条全部
`manual-by-design`，0 retired（退役按 AC3 单独立任务）。

**AC4 web 三点核查（AC136 形态）——三点均「需切但另立任务」，本任务不改产品代码**：

- **(a) readLive() 是否已切读 `.quay/worker-outcome.jsonl`？——未切。**
  `packages/quay/src/observation.ts:518 readLive()` 仍读 `FAST_MODE_EVENTS_DIR = ".workflow-events"`（`:36` 常量定义）；
  `grep -c worker-outcome packages/quay/src/observation.ts` = **0**。驱动的真相源 `.quay/worker-outcome.jsonl`
  （`worker-driver.ts` `WORKER_OUTCOME_REL`）未被 readLive 读取。

- **(b) /live 与 dashboard liveCard 在飞语义 vs 驱动直接量（fork 子进程数）？——不一致。**
  readLive 在飞 = `pairInFlight(readEventsFromDir(...))`（start-without-end 遥测括号配对，observation.ts:541）；
  驱动在飞直接量 = 自己 fork 的活子进程数（worker-driver.ts 头注）。实测 `grep -c fast-mode-telemetry plugin/scripts/worker-driver.ts` = **0**
  （驱动不写 `--task-start`；worker prompt 只要求 create worktree/implement/suite/ff），仅
  `fan-in-execute.js:724` 写 `--impl-complete` backstop ⇒ 驱动模式下 `.workflow-events/` 无 start 事件
  ⇒ pairInFlight 配对破裂 ⇒ /live 在飞恒空，而驱动实际有活 worker。

- **(c) 已 land 两条 web 任务字段假设在驱动模式是否仍成立？——不成立。**
  ① `gap-webui-live-implcomplete-state-render`：`implCompletedAtMs`（observation.ts:93）源自遥测
  `impl-complete` 事件（`eventKind==="impl-complete"`，:208）；worker-outcome.jsonl 字段 =
  `{ts,task,selector_reason,exit_code,signal,wall_clock_ms,final_state,started_at}`（worker-driver.ts computeOutcome），
  **无 impl-complete 边界**、final_state ∈ {completed,failed,killed,timed-out,spawn-failed,not-dispatched}
  ⇒ 实现中/待落地分栏在驱动载体上无对应字段。② `gap-webui-cross-task-blocking-visibility`：
  blocks/blockedBy 关系逻辑读 `tasks/*.md`（载体无关，逻辑仍成立），但其输入「在飞列表」来自 readLive 读旧载体
  ⇒ 驱动模式下在飞列表为空 ⇒ 阻塞关系展示为空。

⇒ 三点均需切/重定口径，且均属**另立任务**（AC136 覆盖），本任务不改 `observation.ts` / `serve-handlers.ts`
（Touches 边界）。

## Definition of Done

- [x] 复扫判定记录完整 + 「仅 .md」类归零 + web 三点结论齐；AC1-4 全勾；land 到 develop。

## Retires

- net-add：本任务是扫描 + 判定 + 核查，不直接退役；退役按三选一结果单独立任务。

## Touches

- .quay/no-code-caller-triage-rescan.jsonl (new)（复扫判定记录落点）
- tasks/gap-ac111-rescan-inner-tick-and-web-carrier.md（自身）

> **注意**：web 核查若只出结论不改码则**不 Touches 产品文件**（`observation.ts` / `serve-handlers.ts`）；若需改码（如 `readLive()` 切载体）则另立任务，不在本任务内改。
