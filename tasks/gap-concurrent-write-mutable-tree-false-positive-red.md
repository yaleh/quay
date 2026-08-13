---
id: gap-concurrent-write-mutable-tree-false-positive-red
title: 验证轮在可变工作树上跑——同轮提交到共享树 ⇒ 假阳性红（对照实验证实）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（2026-08-12，对照实验）**：round 53 红在 `quay-init-loop-core.test.mjs`（AC4 laid-down tick docs byte-identical），
窗口内三个写者提交改共享树（inner 类型修 6f4800dc / fan-in c19e70a1 / 外层协调 132210f4 / manager A4 改核 94a56054）。
round 54 干净窗口（19:23:39-19:30:16 零提交）**同一测试绿（67s PASS）**。

**⇒ 「并发写 tick 文档 ⇒ 假阳性红」假设被对照实验支持。**
任何一轮的红都可能是同轮提交造成的假阳性（套件跑的是会变的工作树，不是钉住的检出），
当前无任何机制表达这件事。

**推论**：round 53 作废的理由不是「verifiedCommit 缺修复」（manager 先前的解释，后自纠），
而是「并发写 FP」——整轮作废会丢掉「那棵树上 quay-init-loop-core 会红」的信息。

## Plan

1. 起跑前钉住验证目标：起跑时记录 HEAD，终态写入前比对，不一致 ⇒ 标 `reason=infra-error`/「树被移动」。
2. 或：验证轮从 git worktree 跑（钉住的检出），主检出不受影响（如 verify-worktree 模式）。
3. 判据：任何红在归因前先查「窗口内是否有提交落进树」。

## AC

- [x] AC1: 验证轮起跑/终态比对 HEAD，树被移动 ⇒ 明确标注（非红判据）
- [x] AC2: 红归因前查「窗口内提交」，并发写 ⇒ 标注假阳性候选
- [x] AC3: 负控制——round-53 类（同轮提交）被检出并标注
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 复现用例（同轮提交 ⇒ 标假阳性）贴出（见 Evidence）
- [ ] 全量套件绿

## Touches

- plugin/scripts/full-suite-runner.ts（起跑/终态 HEAD 比对）
- plugin/scripts/suite-state-trigger.ts（红归因前查窗口提交）
- tasks/gap-concurrent-write-mutable-tree-false-positive-red.md（自身）

## Evidence

**机制**（AC1/AC2/AC3，`--for-task gap-concurrent-write-mutable-tree-false-positive-red` 门绿，161 tests / 0 fail）：

1. **`full-suite-runner.ts`（起跑/终态 HEAD 比对，AC1）**：起跑已记 `verifiedCommit`（start HEAD）；
   终态写入前（suite child close 后、verdict write 前）再读一次 HEAD 得 `terminalCommit`，
   比较得 `treeMutatedMidRound = verifiedCommit !== undefined && terminalCommit !== undefined &&
   verifiedCommit !== terminalCommit`。两者一并写入 `full-suite-state.json`（red 与 green 都带，git root 上
   恒在；非 git hermetic root 两字段皆缺 → AC1 exact-shape 测试 byte-stable）与 `verification-round.jsonl`
   round record。**这是标注（非红判据）**——不改 verdict、不改 reason、不整轮作废。
   另加 `readTreeMutation()` 辅助 + 早期红写（failure line / static-check / pendingFailure 重写）的
   memoized 临时标注，使 SUITE-RED 事件在 common 路径（early-red test failure）上也能带 `concurrentWrite`。

2. **`suite-state-trigger.ts`（红归因前查窗口提交，AC2）**：`isConcurrentWriteFalsePositiveCandidate(state)` —
   `state?.state === "red" && state.treeMutatedMidRound === true` 时该红为并发写假阳性候选（round-53 类）。
   SUITE-RED 事件在 `recordTransition` 里对带 `treeMutatedMidRound` 的红加 `concurrentWrite: true`
   （factual projection，非派发决策）；`formatEventLine` 的 Monitor 流也打 `concurrentWrite=true`。

3. **负控制（AC3）**：`full-suite-runner.test.mjs` 复现「同轮提交 ⇒ 标假阳性」——fake suite 起跑后 `sleep 1`
   再 `git commit --allow-empty`（模拟 round-53 的并发写者），suite 红/绿都验证
   `state.treeMutatedMidRound === true` + round record 带 `terminalCommit`；干净窗口（零提交）⇒
   `treeMutatedMidRound === false`。`suite-state-trigger.test.mjs` 验证纯函数 + SUITE-RED 事件标注 +
   无标注负控制。

**scoped 输出**（`scripts/test.sh --for-task gap-concurrent-write-mutable-tree-false-positive-red`）：
`ℹ tests 161 / ℹ pass 161 / ℹ fail 0 / ℹ cancelled 0 / duration_ms 86694`。
