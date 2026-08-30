---
id: gap-fan-in-continue-resolution-dual-copy-and-ff-not-fast-forward
title: fan-in CONTINUE 冲突消解协议缺口——dual-copy 文件冲突 + ff-not-fast-forward +
  modify/delete 三型，worker 反复 ENL 无解
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`continueConflictResolutionNote()`（worker-driver.ts:1109）只分派两型消解：outline 取 develop 版、code 文件取语义并集。但有三型冲突/失败它不覆盖，导致 worker 反复 exited-not-landed（ENL）无解：

1. **dual-copy 文件冲突**（实证 `gap-execution-loop-productization-p2-p4`，step=merge-develop 连续 ~4h 同冲突）：`.claude/workflows/fan-in-execute.js` 与 develop 侧冲突。该文件是 dual-copy 热文件（`.claude/workflows/* ↔ plugin/workflows/*` 必须字节一致），但 note 把它当「code 文件 → 语义并集」——dual-copy 的正确消解是「两副本同步为同一字节」，不是语义并集（并集会让两副本发散）。同理 `orchestration/fast-mode-tick-core.md`（tick doc，非 outline 非 code，note 无该型）。

2. **ff-not-fast-forward**（实证 `gap-retire-governance-group-merge-into-bucket`，step=ff 连续 ~2.3h）：suite 长跑期间 develop 又进新落地，任务分支落后 develop ⇒ ff 步「not fast-forward」。note 只教 merge-develop 冲突消解，没教「ff 不 ff 时先重 merge develop 再 ff」。

3. **modify/delete 冲突**（实证 `gap-execution-loop-productization-p2-p4` 当前实际冲突，step=merge-develop）：一侧删除、另一侧修改。该任务 P2 把 `plugin/scripts/fan-in-ff-merge.sh` 产品化删除（取代 = `packages/quay/src/fan-in/ff-merge.ts`，分支上存在），develop 却持续补丁该 shell 脚本 ⇒ `git merge develop` 报 `CONFLICT (modify/delete)`。note 的 outline/code/dual-copy 三型都不覆盖「删-改」——它会把被分支删掉的文件按「取 develop 版」复活，或不知该接受删除。

**根因**：conflict-resolution 协议（gap-continue-prompt-conflict-resolution-protocol，done）与 derived 冲突（gap-fan-in-merge-develop-derived-recompute-and-reason，done）都只覆盖了各自类型，三型新暴露（硬规则 5b：修好一个 ≠ 没有别的）。

## Plan

扩 `continueConflictResolutionNote()`（或对应机械步）覆盖：
1. dual-copy 文件（`.claude/workflows/*` 与其 `plugin/workflows/*` 镜像）：冲突时取 develop 版后**重新同步两副本字节一致**（不是语义并集）；非 outline 非 code 的 tick doc（`orchestration/*-tick-core.md` 类）取 develop 版。
2. ff 步「not fast-forward」：先 `git merge develop`（更新任务分支）再 ff（或 ff 步自动重 merge）。
3. modify/delete（一侧删一侧改）：先判删除侧——**分支删**（任务有意删除、分支上有替代实现，如被删脚本的 TS 化身）⇒ 接受删除（`git rm` 解冲突）；**develop 删** ⇒ 接受 develop 删除。⛔ 不得静默恢复被删文件（复活应废实现），也不得把分支有意删除当「取 develop 版」处理。

## Acceptance Criteria

- [x] AC1（能取假，dual-copy）：dual-copy 文件冲突时，note 教「两副本同步字节一致」而非「语义并集」；（⛔ 仍教语义并集 ⇒ 假）。
- [x] AC2（能取假，ff）：ff-not-fast-forward 时，note/机械教「先 merge develop 再 ff」；（⛔ 无此指令 ⇒ 假）。
- [x] AC3（能取假，单测）：worker-driver.test.mjs 断言 note 含 dual-copy 同步 + ff 重 merge + modify/delete 三型，改掉任一 ⇒ 红。
- [x] AC4（能取假，modify/delete）：modify/delete 冲突时，note 教「判删除侧：分支删且分支上有替代实现 ⇒ 接受删除（git rm）；develop 删 ⇒ 接受 develop 删除」；（⛔ 仍只教取 develop 版 / 语义并集 / 不教判删除侧 ⇒ 假）。

## Definition of Done

CONTINUE 消解协议覆盖 dual-copy 同步 + ff 重 merge + modify/delete 三型；AC1-AC4 全勾；p2-p4 / retire-governance 类任务不再反复 ENL。

## Touches

- plugin/scripts/worker-driver.ts（continueConflictResolutionNote 扩三型 + 必要时 ff 步机械重 merge）
- plugin/test/worker-driver.test.mjs（AC3 单测）
- tasks/gap-fan-in-continue-resolution-dual-copy-and-ff-not-fast-forward.md（自身）