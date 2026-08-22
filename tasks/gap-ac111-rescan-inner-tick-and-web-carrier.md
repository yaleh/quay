---
id: gap-ac111-rescan-inner-tick-and-web-carrier
title: AC111 复扫 inner-tick 专属机件 + web 观测载体切换核查
status: todo
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

- [ ] AC1（能取假）：重扫后「仅 .md 文档提及」类 = 0（同一谓词，同 AC111 判据）。
- [ ] AC2：每条判定有记录（三选一 + 理由）。
- [ ] AC3：retired 条目不在本任务删除——退役按三选一结果单独立任务，每条带「它防的缺陷现在由什么防」。
- [ ] AC4：web 三点核查各有结论（切了 / 不需切+理由 / 需切但另立任务）。

## Definition of Done

- [ ] 复扫判定记录完整 + 「仅 .md」类归零 + web 三点结论齐；AC1-4 全勾；land 到 develop。

## Retires

- net-add：本任务是扫描 + 判定 + 核查，不直接退役；退役按三选一结果单独立任务。

## Touches

- .quay/no-code-caller-triage-rescan.jsonl (new)（复扫判定记录落点）
- tasks/gap-ac111-rescan-inner-tick-and-web-carrier.md（自身）

> **注意**：web 核查若只出结论不改码则**不 Touches 产品文件**（`observation.ts` / `serve-handlers.ts`）；若需改码（如 `readLive()` 切载体）则另立任务，不在本任务内改。
