---
id: gap-doc-develop-sync-semantic-conflict-resolution
title: main/manager-doc↔develop 可靠同步 + 语义兜底（核心）——机械同步失败升级 Claude Code 语义同步，develop 权威
status: todo
labels:
  - gap
parent: null
children:
  - gap-main-manager-doc-doc-only-ff-only-tracking
extra: {}
---
**type:** execution

## Proposal

**人 2026-08-31 裁定反转，本任务升为核心**：写面保留 main/manager-doc，可接受分叉、可接受同步损失 main/manager-doc 的变更，但必须有持续同步机制且必须同步成功。本任务 = 同步的核心机制：**同步可靠化 + 语义兜底**（机械 ff-only 半边归子任务 gap-main-manager-doc）。

- **同步可靠化（硬规则 3b）**：`propagateDocBranchToDevelop` 返回 boolean（`: void` 改 boolean）+ 失败落痕（事件记录），消除静默失败。实证 2026-08-31 propagate `catch(_){}` 全吞 ⇒ 4 任务状态分叉 + 主检出落后 develop 53 提交无痕。
- **语义兜底（机械同步失败后）**：机械同步失败（ff 不成立）升级到 Claude Code 会话语义同步，第 1 层流程为模板：
  1. `git diff develop...main/manager-doc` 分叉清单。
  2. **develop 权威 wins**：tasks/*.md status 走确定性优先级 `done > needs-human > ready > todo`，**永不交 LLM**。
  3. code/docs 走 Claude Code 语义合并（base=develop + doc 侧变更叠加）+ guard（anti-drift / typecheck / scoped-gate 迭代，红则 needs-human）。
  4. merge + ref-level ff develop + 事件记录。
- **原则**：must-sync、develop-authority-wins（保留 2026-08-30 原裁定）。

## Plan

1. 同步可靠化：propagateDocBranchToDevelop 返回 boolean + 失败落痕（事件），⛔ 静默 catch。
2. 语义兜底落地：机械失败（ff 不成立）→ 升级 Claude Code 语义同步（tasks 确定性规则 + code/docs 语义合并 + guard + 事件记录）。
3. 接线：promotion-driver 与 worker-driver 的 sync 调用点走「机械 ff-only + 失败升级语义兜底」。
4. 负控制：① 造 tasks 状态分叉验证确定性规则（done>needs-human>ready>todo 且无 LLM）；② 造 docs 分叉验证语义合并 + guard；③ 造机械失败验证「失败落痕 + 升级语义」。

## Acceptance Criteria

- [ ] AC1（能取假，可靠化）：propagate 返回 boolean + 失败落痕——grep propagate 返回类型非 void、失败写事件；（⛔ 仍 void / 静默 ⇒ 假，硬规则 3b）。
- [ ] AC2（能取假，确定性规则）：tasks 状态分叉（develop done / doc todo）消解为 done，该路径无 LLM 调用；（⛔ 状态进 LLM / 取 todo ⇒ 假）。
- [ ] AC3（能取假，语义兜底）：机械 ff-only 失败后升级 Claude Code 语义同步（merge + ref-level ff develop + 事件记录）；（⛔ 仍静默 merge-fallback ⇒ 假）。
- [ ] AC4（能取假，develop 权威）：消解不丢失 develop 独有提交——develop-only 提交消解后仍在 `git log develop`；（⛔ doc 覆盖 develop 独有 ⇒ 假）。
- [ ] AC5（能取假，双驱动接线）：promotion-driver 与 worker-driver 的 sync 调用点都走「机械 ff-only + 语义兜底」（grep 两处）；（⛔ 任一处仍走旧 propagate ⇒ 假）。

## Definition of Done

同步可靠化（boolean + 失败落痕）+ 语义兜底（Claude Code 语义同步）落地；promotion/worker 双路径接线；AC1-AC5 全勾；tasks/docs 分叉负控制各一次、机械失败负控制一次。

## Touches

- plugin/scripts/driver-filters.ts（propagateDocBranchToDevelop 返回 boolean + 失败落痕 + 升级语义兜底）
- plugin/scripts/promotion-driver.ts（sync 调用点走机械 + 语义兜底）
- plugin/scripts/worker-driver.ts（sync 调用点走机械 + 语义兜底）
- tasks/gap-doc-develop-sync-semantic-conflict-resolution.md（自身）
