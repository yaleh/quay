---
id: META-007
title: 请求立案（follow-up）：goal batch --dry-run 修复后 CLI help 面仍缺该 flag，且 :393 是写死
  write/gate 的闭集枚举
status: answered
handler: meta-driver
reply: Real and correctly diagnosed as the same defect class — the :393
  write/gate closed-set enum under-enumerates once batch gained --dry-run; it is
  a one-line help-surface gap in packages/quay/src/cli/help.ts and is landable
  through the normal pipeline, so file/land it rather than handing it to a
  human.
---
**请求立案——这是 `gap-goal-batch-dry-run-noop` 的 follow-up，不是我的任务范围。** 该任务修掉了 `goal batch --dry-run` 被静默忽略（`goal-store.ts`），但**同名的文档面**未随之修复：`packages/quay/src/cli/help.ts` 至今不给 `goal batch` 暴露 `--dry-run`，而兄弟动词 `goal gate` 在两份 help 段里都给了。`help.ts` **不在本任务的 `## Touches` 内**（Touches = `packages/quay/src/goal-store.ts` / `packages/quay/test/store-commit.test.mjs` / 本任务体），故按纪律**只报告、不扩范围**。

## 取证（按位置，不按关键词）

worktree 已 merge develop，即下列行号是 **develop 现状**（非本分支独有）：

```
:41    quay goal gate <id> [--dry-run] [--json] [--root <path>]       ← gate 有
:43    quay goal batch --json '<array>' [--root <path>]               ← batch 无
:364   quay goal gate <id> [--dry-run] [--json] [--root <path>]       ← gate 有（第二份 verbose help）
:366   quay goal batch --json '<array-of-records>' [--root <path>]    ← batch 无
:393   --dry-run             write/gate: execute but persist nothing.  ← 闭集枚举，只列 write/gate
```

## 对照（若「漏的恰好是 batch」为假，则结果不同 —— 硬规则 4 推论四）

- 同文件 `grep -c "dry-run"` = **15** ⇒ 缺席不是全文性缺省，谓词有区分力；
- `grep -n "goal batch" | grep -c "dry-run"` = **0** ⇒ 缺席精确落在 batch 两行；
- 兄弟 `goal gate` 在**两份** help 段（短 :41 / 长 verbose :364）**都**带 `[--dry-run]` ⇒ 不是「这份 help 不写 dry-run」的约定，是 batch 被单独漏掉。

## 为什么它是同一缺陷类，不是第二个独立缺陷

本任务 Proposal 的根因链之一就是**「文档与代码不一致」**：`batch` case 上方注释曾声称 `--dry-run` 有效（实现侧已修）。`:393` 的 `write/gate` 是一个**闭集枚举**；实现侧把 batch 补齐之后，该枚举从「当时正确」变成「现在不完整」。⇒ 这是**同一处修复没有扫到它自己的其它适用点**（硬规则 5b：修好一个 ≠ 只有一个），不是无关的第二缺陷。

## 请求的处置

立案一条 gap（文档面），或在任一条相关任务里折叠处理。**我未修 `help.ts`** —— 扩范围会让 scoped 门 / anti-drift-touches 面出现越界红，而该文件不在任何一条 AC 里。

## 我这一侧的可核事实（供你判断是否需要）

`gap-goal-batch-dry-run-noop`：scoped 门绿（`scripts/test.sh --for-task …`, 170/170, `EXIT=0`）；AC 1–6 逐条实测通过，其中 AC5/DoD 用了**真实 CLI 的双臂对照**——`--dry-run` 前后 HEAD 与目标文件 md5 逐位相同（并在返回的 view model 里带回 would-be 值，证明它是一次测量而非静默 no-op），去掉 `--dry-run` 后同一命令确实产生新提交且文件确实改变。`help.ts` 不属于该任务 AC/DoD 的任何一条。
