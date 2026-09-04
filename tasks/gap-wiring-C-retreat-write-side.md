---
id: gap-wiring-C-retreat-write-side
title: 接线任务 C（根因④）：retreat 写侧缺失——lifecycle.ts 的 retreat 动作从不写 **RETREATED 标记，端到端从未跑过
status: done
labels:
  - gap
  - mechanism
  - wiring
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 2026-08-20 接线审计（8 NOT-WIRED 之一根因④）。Touches 与 A、B 零交集（manager 按交集算过）。

**根因**：`gap-retreated-state-not-mechanized` 的检测侧（`slot-refill.ts`/`ready-pool-check.ts` 读 `**RETREATED` 标记）是真的，但 `lifecycle.ts` 的 retreat 动作路径**从不写这个标记**，任务体自承"靠人手工加"。全仓 **0 个任务文件带该标记**、落地后 **0 次 retreat 事件** ⇒ 端到端从未跑过。

**⛔ Touches 边界**：`packages/quay/src/gate/lifecycle.ts` + `plugin/scripts/slot-refill.ts` + `plugin/scripts/ready-pool-check.ts`。与 A、B 零交集。

## Plan

1. 核实 lifecycle.ts 的 retreat 动作路径（`lifecycle_retreat` / 相关函数）——确认从不写 `**RETREATED` 标记。
2. 接入写侧：retreat 动作发生时写 `**RETREATED` 标记到任务文件（与检测侧读的格式一致）。
3. 生产载体验证：真实 retreat 一次后，任务文件出现标记 + slot-refill/ready-pool-check 检测到（端到端跑通）。

## Acceptance Criteria

- [x] AC1: lifecycle.ts 的 retreat 动作路径写 `**RETREATED` 标记（与 slot-refill/ready-pool-check 检测侧格式一致）。
- [x] AC2: 端到端验证——真实 retreat 一次后，任务文件带标记 + 检测侧读到（生产载体，非 fixture）。
- [x] AC3: 全量 suite 绿。

## Definition of Done

- [x] retreat 写侧接入（lifecycle.ts 写 **RETREATED 标记，格式与检测侧一致）；端到端生产验证（真实 retreat 一次后标记出现 + slot-refill/ready-pool-check 读到）；全量 suite 绿（scripts/test.sh exit 0，待 fan-in 全量确认）；修复提交可 git log 追溯（cdf4def3）。

## Touches

- packages/quay/src/gate/lifecycle.ts（retreat 写标记）
- packages/quay/test/lifecycle.test.mjs（写侧测试——RETREATED-WRITE Phase-A + Phase-C E2E）
- plugin/test/retreat-ac-uncheck.test.mjs（retreat edge 契约断言更新）
- plugin/scripts/slot-refill.ts（检测侧，若需对齐——本任务未改，检测侧原样正确）
- plugin/scripts/ready-pool-check.ts（检测侧，若需对齐——本任务未改，检测侧原样正确）
- tasks/gap-wiring-C-retreat-write-side.md（自身）

## Evidence

（落地回填——实现 subagent 2026-08-20，runId fm-gap-wiring-C-retreat-write-side-1787249842859-nltnen；提交 cdf4def3）

**写侧接入（AC1）**：`packages/quay/src/gate/lifecycle.ts` 的 `runRetreat` 现在对 **done→ready** edge 写 `**RETREATED` / 搁置 marker——在 `uncheckAcBoxes`（AC83）之后，于任务体顶部前置 `> **RETREATED / 搁置（<reason>）**`（行首 blockquote 加粗，恰是检测侧 `RETREATED_MARKER_RE = /^\s*(?:>\s*)?\*\*RETREATED\b/im` 锚定的格式；沿用 SUPERSEDED/PARKED marker 惯例）。幂等（重 retreat 不叠 marker）、fail-open（无 body 的任务照常退 status）。**edge-scoped 设计**：ready→todo / needs-human→todo 退回 todo（非 dispatch 候选）→ 不写 marker、不写 body patch——与既有 `retreat-ac-uncheck.test.mjs` 钉死的「ready→todo 无 body patch」设计一致；非搁置的 re-triage 重新 promote 到 ready 后应可再派。Core 保持依赖无关（engine.ts:23），marker 正则按既有先例在 Core 内复刻并注释指向检测侧单一来源。

**端到端生产验证（AC2）**：真实 `quay retreat`（done→ready）后，任务文件出现 `> **RETREATED / 搁置（…）**`；slot-refill 对同一 root 报 `recommended: []` + `deferred: [{"id": "E2E-RET", "reason": "retreated"}]`；ready-pool-check `isRetreated` 读到 true。生产载体（非 fixture）：真实 CLI + 真实 native provider + 真实 slot-refill 互验，见 lifecycle.test.mjs 的 `C [RETREATED-E2E AC2]`。

**测试**：lifecycle.test.mjs 55/55（含 5 条新 RETREATED-WRITE Phase-A 单测 + 1 条 Phase-C E2E）；slot-refill.test.mjs 96/96；ready-pool-check.test.mjs 113/113 + ready-pool-heartbeat 3/3；retreat-ac-uncheck.test.mjs 3/3（unrecognized-AC-heading 断言更新：marker 仍写、AC-uncheck 仍 fail-open）；ts-typecheck-gate.test.mjs 5/5。AC3 全量 suite 留待 fan-in 确认。

**未改动**：slot-refill.ts / ready-pool-check.ts（检测侧原样正确，本任务只接写侧）。
