---
id: gap-fan-in-flip-no-ac-completion-check
title: fan-in-execute.js flip 只查行形不查 AC 完成——workflow 翻 done 绕过 AC47 闸（52 条 done 零勾，gap-ac72 为样本）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（fan-in flip 无 AC 完成闸——manager 2026-08-14 11:4xZ 报 gap-ac72 done 而 6 AC 未勾；outer 实证根因）**。

**根因（outer 实测）**：`.claude/workflows/fan-in-execute.js` 持锁段 step 5 的 flip 是：
```bash
flip_count=$(grep -c '^status: ready$' tasks/${task}.md || true)
if [ "$flip_count" != "1" ]; then ... exit 2; fi
sed -i 's/^status: ready$/status: done/' tasks/${task}.md
```
**只查行形（恰 1 行 `^status: ready$`），不查 AC/DoD 完成**（`countCompletionCheckboxes` / AC47 谓词根本不进这条路径）⇒ **任何经 workflow fan-in 的任务，无论 AC 是否全勾都翻 done**——AC47 的翻 done 闸（gap-ac47 落的消费者）**只在 inner 自己的翻 done 路径上**，workflow 这条新路径绕过它。

**发生率（outer 实测 2026-08-14 11:4xZ）**：`status: done` 且 AC 段存在但零 `[x]` 的任务 **52 条**（含 gap-ac72-cert-mechanism-retire：2 个 AC 段、0 勾；样本 gap-ac67 / DIR-014 / gap-execute-milestone 同形）。其中 workflow 落地的是最近这批——历史 done 不是本任务要翻的（AC47 已定「历史 done 不得当证据」），**本任务只堵未来路径**。

**判据1**：fan-in flip 加 AC 完成闸——翻转前跑 `countCompletionCheckboxes`（或等价谓词），AC 未全勾 ⇒ **不翻 done**（报「AC 未全勾，未翻」，exit 非 0 或明确 NOT-EVALUATED）；与 gap-ac47 落地的 inner 翻 done 路径的谓词**同源**（不另造第二个计数函数）。
**判据2（能取假）**：回放「AC 未全勾的任务走 workflow fan-in」⇒ 必须不翻 done（现状 52 条 done-零勾即真样本，回放必须红）；AC 全勾 ⇒ 翻 done 绿。
**判据3**：与 AC78（fan-in-execute workflow）的 flip 承重点③（行形 fail-closed）**兼容**——③管「行形不对不静默绿」，本任务管「AC 未全勾不翻 done」，两个检查并列不互斥。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不翻历史 52 条 done-零勾（AC47「历史 done 不得当证据」）；不改 inner 自己的翻 done 路径（那里已有 AC47 闸）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 fan-in-execute.js step 5 flip 段 + gap-ac47 落的 `countCompletionCheckboxes` 谓词所在。
2. 判据1：flip 前加 AC 完成闸（复用同一谓词，不新造）。
3. 判据2 能取假：AC 未全勾回放不翻 done（真样本=gap-ac72 形态）+ 全勾绿。
4. 判据3：与承重点③ 行形检查并列（读现有 flip-block 测试）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：fan-in flip 前 AC 完成闸（复用 AC47 谓词），未全勾不翻 done。
- [ ] AC2 判据2 能取假：AC 未全勾回放不翻 done（gap-ac72 形态真样本红）；全勾绿。
- [ ] AC3 判据3：与承重点③ 行形 fail-closed 兼容并列。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] fan-in flip 堵住「AC 未全勾仍翻 done」：翻转前 AC 完成闸复用 AC47 谓词（同源不新造），AC 未全勾即报「未翻」且不写 done；「AC 未全勾走 workflow」回放必须不翻 done（gap-ac72 形态真样本红），AC 全勾必须绿；与承重点③ 行形 fail-closed 并列不互斥（两检查都过才翻）。既有测试全绿 + `--for-task` scoped 门绿。

## Touches

- .claude/workflows/fan-in-execute.js（step 5 flip 加 AC 完成闸）
- plugin/test/fan-in-execute-paths.test.mjs（补 flip-AC 闸测试，与③ 并列）
- tasks/gap-fan-in-flip-no-ac-completion-check.md（自身）

## Evidence

（落地后回填）
