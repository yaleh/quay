---
id: gap-continue-prompt-conflict-resolution-protocol
title: CONTINUE 轮 prompt 编码 merge 冲突消解协议——derived 文件（outline inventory）重算 + code
  文件语义并集 + git commit --no-edit
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

机械 fan-in 的 `merge develop` 步在 CONTINUE 轮撞冲突时，worker 拿到的 CONTINUE prompt（`buildContinueWorkerPrompt`）**只携带失败原因**（`the last round exited-not-landed because: <reason>`），**不含冲突消解指令**。实证：2026-08-29 批量重派 21 个 suite 任务时，4 个任务（gap-b0 / gap-b1 / gap-writestate / gap-fan-in-flip-done）在 `merge-develop` 步红，其中 3 个冲突在 `docs/proposals/quay-product-outline.md`（退休改的 scripts 计数 296→294 与任务自己的改动相撞），1 个在 `plugin/scripts/worker-driver.ts`（archguard 落地与任务改动相撞）。MEMORY 的 `continue-round-resolve-leftover-mid-merge` 记着「取并集 + commit --no-edit」的修法，但它是**事后结论，没被编码进 prompt**——worker 是否会消冲突靠运气。

## Plan

在 `buildContinueWorkerPrompt`（worker-driver.ts:1033）加一段冲突消解协议（按文件类型分派）：

1. 若 `git status` 有 unmerged paths（UU）或 `git merge develop` 报 CONFLICT：**先 resolve 再继续实现**，禁止带着 UU 退出。
2. **derived 文件**（`docs/proposals/quay-product-outline.md` 的 §6 DELIVERY-INVENTORY 计数等——由 `verify-delivery-surface.ts --write-inventory` 机械派生）：apply 自己的改动后**重跑 `node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --write-inventory` 重算**，不手并计数。
3. **code 文件**（如 worker-driver.ts）：读两边 diff，取**语义并集**。
4. `git add <resolved>` + `git commit --no-edit` 完成 merge。

## Acceptance Criteria

- [x] AC1（能取假，指令存在）：`buildContinueWorkerPrompt` 输出的 prompt 含冲突消解指令（grep 到 `unmerged` 或 `CONFLICT` 或 `resolve` 关键词）。
- [x] AC2（能取假，derived 重算）：prompt 明确「outline inventory 冲突 ⇒ 重跑 `verify-delivery-surface.ts --write-inventory`，非手并计数」。
- [x] AC3（能取假，code 并集 + commit）：prompt 明确「code 冲突 ⇒ 语义并集 + `git commit --no-edit` 完成 merge」。
- [x] AC4（能取假，单测）：`worker-driver.test.mjs` 有断言钉住 prompt 含这三类指令（改 prompt 删掉任一指令 ⇒ 测试红）。

## Definition of Done

CONTINUE prompt 编码了完整的冲突消解协议（derived 重算 / code 并集 / commit --no-edit），并有测试钉住；此后 CONTINUE 轮撞 merge 冲突时 worker 有明确的机械指令，不再靠运气。落地即解决批量重派中「shared 文件冲突消解靠 worker 自行发挥」这一失败模式。

## Touches

- plugin/scripts/worker-driver.ts（buildContinueWorkerPrompt）
- plugin/test/worker-driver.test.mjs（prompt 内容断言）
- tasks/gap-continue-prompt-conflict-resolution-protocol.md（自身）
