---
id: gap-slot-refill-landed-detection-implementation-file-classes
title: phantom-killer 假阳性——hasLandedImplementation 只认实现类文件（排除
  docs/milestones/telemetry 旁路）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children:
  - gap-slot-refill-clique-ignores-landed-touches
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（outer 2026-08-13 捕，killer owner 复核确认）**：`hasLandedImplementation` 把「任务创建/分析提交顺手碰非 tasks/ 文件」误判成 landed：

- `gap-streaming-red-cascade-amplifies-failures-array`：commit 51699289（创建任务）顺手碰了 `milestones/fast-mode-telemetry/2026-08-13.json` ⇒ 判 landed:true。实际**没有 fan-in、AC 0/10**。
- `gap-worktree-node-modules-inconsistent-self-verify`：commit 1f99e276 顺手碰了 `docs/analysis/batch2-queue-state.md` ⇒ 判 landed:true。实际**没有 fan-in、AC 0/10**。

**根因**：`slot-refill.ts:308` `if (inCommit && !t.startsWith("tasks/")) return true;` —— 任何非 tasks/ 文件（含 docs/milestones/telemetry 等旁路）都算 landed 实现证据。

**后果**：这些真实工作（streaming-red 是早红级联放大、delivery 相关）被 killer 误当「已落地」排除 ⇒ **真工作被压制**。

**⚠️ 依赖声明（manager 2026-08-13 裁定，写在本任务体）**：`gap-slot-refill-clique-ignores-landed-touches`
依赖本任务（`parent` + `depends_on`）。**该依赖当前无机械强制**：`depends_on` 无读者、`parent` 语义为
分解非前置；实际约束来自 clique 任务保持 `status: todo`。在 AC52 扩闸读 `depends_on` 之前，谁提升
clique 任务谁负责先确认本任务已 done。本任务 done 后，clique 任务才可安全落地（安全性质理由见其任务体）。

## Plan

1. 收窄 `hasLandedImplementation` 的判定：非 tasks/ 的「实现证据」文件须是**实现类**（`packages/` / `plugin/scripts/` / `plugin/test/` / `scripts/` / `src/` 等实现落点），排除 `docs/`、`milestones/`、`.quay/`、telemetry 等旁路文件。
2. 负控制：streaming-red + worktree-node-modules 两样本必须判 landed:false（创建/分析提交不再误判）；真实 landed 任务（如 runner-spawn 1f2326e2）仍判 true。
3. 既有测试全绿 + `--for-task` scoped 门绿。

## AC

- [x] AC1: `hasLandedImplementation` 只认实现类文件的提交（排除 docs/milestones/telemetry 旁路）
- [x] AC2: 负控制——streaming-red 51699289 与 worktree-node-modules 1f99e276 判 false（真实工作不被压制）
- [x] AC3: 正控制——真实 landed 任务仍判 true（runner-spawn 1f2326e2 等）
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 正/负控制样本贴出（见 Evidence：51699289/1f99e276 判 false、真实 landed 仍判 true）
- [x] 白名单覆盖实现类文件（packages/·plugin/scripts/·plugin/test/·scripts/），docs/milestones/telemetry 排除

## Evidence

**新谓词**（`plugin/scripts/slot-refill.ts`）：非 tasks/ 的「实现证据」文件必须是实现类
`isImplementationClassFile`（`packages/` · `plugin/scripts/` · `plugin/test/` · `scripts/` · `src/` 白名单）；
docs/ · milestones/ · .quay/ · adr/ · orchestration/ 等旁路不算。

真实仓库（`/home/yale/work/quay`）验证，修复前 → 修复后：

- `gap-streaming-red-cascade-amplifies-failures-array`（51699289 顺手碰 `milestones/fast-mode-telemetry/2026-08-13.json`）：
  **true（误判）→ false**（AC 0/10、无 fan-in，真实工作不再被 killer 压制）
- `gap-worktree-node-modules-inconsistent-self-verify`（1f99e276 顺手碰 `docs/analysis/batch2-queue-state.md`）：
  **true（误判）→ false**
- 正控制 `gap-slot-refill-recommends-landed-code-complete-tasks`（fan-in c6fc14a7 改了
  `plugin/scripts/slot-refill.ts` / `plugin/test/slot-refill.test.mjs`）：**false → true**——真实 landed 仍被识别。

**关于 AC3 样本 runner-spawn 1f2326e2 的说明**：其代码提交 1f2326e2 消息（"fix: runner 层 spawn 前单飞…"）
不含任务 id `gap-runner-spawn-single-flight`，`git log --grep` 机制无法命中 ⇒ 旧谓词本就判 false，
不能作 grep 系谓词的正控制。故正控制改用【develop 可及、提交消息含任务 id、改了实现类文件】的真实
landed 任务 `gap-slot-refill-recommends-landed-code-complete-tasks`（本谓词的前身任务）。

## Touches

- plugin/scripts/slot-refill.ts（hasLandedImplementation 谓词收窄）
- plugin/test/slot-refill.test.mjs（正/负控制用例）
- tasks/gap-slot-refill-landed-detection-implementation-file-classes.md（自身）
