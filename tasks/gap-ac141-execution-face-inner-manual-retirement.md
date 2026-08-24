---
id: gap-ac141-execution-face-inner-manual-retirement
title: AC141 执行面退役——ready 任务默认 worker-driver 捡，inner 手动介入仅限边界 + 记原因
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac138-worker-driver-production-enablement
---

**type:** execution

## Proposal

**来源**：manager 投立案（AC135 的另一半——执行面）。AC135 只退役了 outer 的手动【晋升】，inner 的手动【实现】这半没有对应退役动作。

**证据（实测）**：驱动上线后，3 个在飞任务里 1 个 worker-driver 真 dispatch、1 个驱动上线前遗留、**1 个是 inner 自己手动 `Agent` 直接实现的（`gap-git-history-vertical-graph-thirdparty-lib`）**。inner 如实承认：默认行为至今仍是手动 dispatch（fast-mode tick 的 A12/A15），从未把「ready 任务默认让 worker-driver 捡」内化进 tick 循环——两条机制并行跑 = AC135「晋升面两个真相源」在执行面的版本。

**规则（inner 提议、manager 认可）**：任务晋 ready 后默认让 worker-driver 捡；inner 只在 ①驱动因故没捡走（超 N 轮未 dispatch）或 ②明确时限压力（人直接裁定「立刻执行」）时才手动介入，且介入时必须记明原因。

## Plan

1. inner tick 循环（`fast-mode-tick-core.md` 的 A12/A15 手动 dispatch）退役默认行为，改为「ready 任务默认等 worker-driver 自主捡」。
2. 手动介入边界：①驱动超 N 轮未 dispatch 或 ②明确时限压力（人裁定「立刻执行」），介入时记明原因。

## Acceptance Criteria

- [ ] AC1（默认路径唯一化）：`develop` 新落地任务分支的首次实现提交，若晚于 worker-driver 当次 `run_id` 启动时刻，必须能在 `worker-round.jsonl` 找到对应 dispatch 记录；取假：找不到且不在 AC2 例外内 ⇒ 假。（待外部）
- [ ] AC2（例外仅两种 + 记原因）：inner 手动直接实现仅限 ①驱动超 N 轮未 dispatch 或 ②明确时限压力（人裁定「立刻执行」），且必须留「为什么手动」记录；取假：无记录手动介入 ⇒ 假。（待外部）
- [ ] AC3（测试与 merge 同样纳入）：worker-driver 起手的任务，若中途测试/修复红/最终 merge 被 inner 手动 `Workflow`/`Bash` 接管，同样需 AC2 例外记录；取假：起手合规收尾不合规 ⇒ 假。（待外部）

## Definition of Done

- [ ] 执行面退役（默认 worker-driver 捡 + 例外边界 + 原因记录 + 测试/merge 纳入）；AC1-3 全勾；land 到 develop。（待外部）

## Retires

- inner tick 循环手动 dispatch（A12/A15）的默认行为（改为 defer 到 worker-driver）

## Touches

- orchestration/fast-mode-tick-core.md（inner tick core 手动 dispatch 退役面，defer 到 worker-driver；正本）
- plugin/loop/fast-mode-tick-core.md（落地副本，随正本同步——AC90 drift-gate normalized-byte 要求行为体一致，⛔ 单边编辑正本会红 drift 闸）
- tasks/gap-ac141-execution-face-inner-manual-retirement.md（自身）

> **注意**：⛔ 非一刀切禁止手动——②（人裁定「立刻执行」这类紧急场景）是合理边界；本条要的是「默认 defer + 边界外介入记原因」，不是「禁止手动」。

> **land 时 AC 勾选说明（AC141 落地）**：AC1/AC2/AC3/DoD 均标「（待外部）」——四条都需**生产时间窗**（worker-driver 驱动【全部后继任务】的执行/测试/merge + 窗口内零无记录的手动介入）。已 land 并可证的部分：**执行面退役本身**——`orchestration/fast-mode-tick-core.md` A12/A15 已加退役标注（「ready→实现」默认 defer 到 worker-driver，手动介入仅限 ①驱动超 N 轮未捡 / ②人裁定「立刻执行」两种例外且必须记原因），与 outer 侧 B9 派发面退役标注（`9c0478d1`）同构。AC1-3 的「取假」判据是行为判据，不在此拍板（同 AC135/AC138 先例——inner 实现 agent ⛔ 不碰主检出、不代判生产行为）。
