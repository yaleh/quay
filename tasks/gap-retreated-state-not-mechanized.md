---
id: gap-retreated-state-not-mechanized
title: "retreated 状态未机制化——slot-refill 推荐刚 retreat 的任务，靠手动跳过（AC53 心跳 REFUSED 根因）"
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

retreat（load-induced 红、等 fix-scope gate land 前不重派）只靠 TaskStop 释放槽 + 手动跳过，**状态未机制化**——retreat 后任务留 `ready`（可派），slot-refill 推荐它们，而「fix-scope gate land 前不重派」是手动理由未编码。实测 AC53 心跳 REFUSED（should_refill=true + no_refill_reason=null），根因即 3 retreated 任务被 ② 回退后留 ready、slot-refill 推荐而手动跳过。

## Acceptance Criteria

- [x] AC1: 加「retreated/搁置」状态（label 或 status），slot-refill 不推荐刚 retreat 的任务（直到解除搁置）。
- [x] AC2: 负控制——retreat 一个任务后，slot-refill 的 recommended 不含它（不靠手动跳过）。
- [x] AC3: AC53 心跳不再因「retreated 任务可派但手动跳过」REFUSED。

## Definition of Done

- [x] retreat 一个任务后 slot-refill 不推荐它（真实输出，非手动跳过），解除搁置后恢复可派。

## Touches

- tasks/gap-retreated-state-not-mechanized.md（自身）
- plugin/scripts/slot-refill.ts（retreated 状态排除）
- plugin/scripts/ready-pool-check.ts（retreated 状态识别）
- plugin/test/slot-refill.test.mjs（retreated 排除负控制）

## Evidence

（落地回填——实现 subagent 2026-08-19，runId fm-gap-retreated-state-not-mechanized-1787130019979-sszuwf）

**机制**：新增任务级 `**RETREATED`（搁置）marker —— 行首加粗 `**RETREATED`（可选 blockquote `>` 前缀），沿用 `SUPERSEDED_MARKER_RE` 的位置判定（硬规则②：行首 + 可选 `>` 锚；行内/散文提及 "retreated" 不命中）。

- `plugin/scripts/ready-pool-check.ts`（状态识别）：新增 `RETREATED_MARKER_RE = /^\s*(?:>\s*)?\*\*RETREATED\b/im` + `isRetreated(task)`（导出，供 slot-refill 复用，单一来源）。
- `plugin/scripts/slot-refill.ts`（状态排除）：import `RETREATED_MARKER_RE`，step-4 在 SUPERSEDED 过滤后新增 `if (RETREATED_MARKER_RE.test(text)) { defer(id, "retreated"); continue; }` —— 带 marker 的 ready 任务从 `recommended` 排除（deferred reason "retreated"），不再靠手动跳过；解除搁置 = 去掉 marker ⇒ 恢复可派。
- `plugin/test/slot-refill.test.mjs`（retreated 排除负控制）：4 条测试。

**AC1**：载体 = 行首加粗 `**RETREATED`（仓库既有任务级状态 marker 约定——PARKED / SUPERSEDED 同形；AC 的「label 或 status」由 body marker 承担，与 SUPERSEDED 的 `> **SUPERSEDED / 作废（…）**` 写法一致）。slot-refill 对带 marker 的 ready 任务 defer "retreated" 且不进 `recommended`。

**AC2（负控制）**：`RETREATED FILTER — a ready task carrying **RETREATED** is deferred and NOT recommended; removing the marker (解除搁置) restores dispatch` —— 带 marker 不进 recommended（deferred "retreated"），去掉 marker（解除搁置）后恢复进 recommended。

**AC3**：`RETREATED FILTER — a retreated-only pool ⇒ should_refill=false with a named reason` —— 仅剩 retreated 候选时 recommended 空、should_refill=false、no_refill_reason 非空，结束不变式 `should_refill ∧ slots_free>0 ∧ dispatchable_disjoint>0 ∧ no_reason` 不再命中 ⇒ AC53 心跳不再因「retreated 任务可派但手动跳过」REFUSED。

**负控制（位置判定）**：`RETREATED FILTER — position-based`（散文提及 "retreated" 不排除）+ `RETREATED MARKER — pure`（行首命中 / 行内与散文不命中）。

**测试**：`bash scripts/test.sh --for-task gap-retreated-state-not-mechanized` scoped 门绿（204 tests / 204 pass / 0 fail / exit 0，含 4 条 RETREATED 测试）；`--test-name-pattern RETREATED` 4/4 绿；`ready-pool-check.test.mjs + ready-pool-heartbeat.test.mjs` 116/116 绿（无回归）。

**未改动**：`isNotYetFlippedSkip` / `isLandedCodeComplete` 等既有 step-4 判定逻辑未动；`packages/quay/src/gate/lifecycle.ts`（retreat 写入侧）不在本任务 Touches，marker 由 retreat 施加方（outer）写入，本任务只交付识别 + 排除 + 负控制。
