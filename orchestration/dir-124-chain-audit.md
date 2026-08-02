# DIR-124 全链状态复核（2026-08-02）

> ## ⚠ 更正（同日晚些，下一个 tick）
>
> **下面的核心结论是错的。A2 和 A5 的代码写了，而且通过了验收——它们躺在没有合并的 worktree
> 分支上。**
>
> - `milestone/M243/iteration-0`（DIR-124-A2）：`workflow-replay.ts` 361 行 + 12 个 fixture +
>   182 行测试，**+8,351 行**，含一个 acceptance-audit 提交
> - `milestone/M246/iteration-0`（DIR-124-A5）：`workflow-baseline-metrics.ts` 1,422 行 +
>   802 行测试，**+9,161 行**，同样含 acceptance-audit 提交
>
> **真实故障不是「标了 done 却没做」，是「做完并验收后，Land 从未合并」。** 两者的处置完全相反：
> 前者要重建，后者只要合并。
>
> **我为什么漏了**：复核脚本只在 **master 的工作树**上查文件是否存在，从不看分支。在一个 Land
> 走 worktree 分支的流水线里，「这件事做了没有」**不能只问 master**。这是本次复核方法论上的硬
> 缺陷，比它发现的任何一条都重要。
>
> 下面「必须报 A2、A5」的真值集因此也是错的——见 `orchestration/escalations.md` #2 的修正版。
> 保留原文不删，因为对 `it0` 检测器而言这仍是有效的输入：**检测器同样只看 master，所以它也会
> 把「滞留未合并」误判成「从未落地」**，那是它必须区分的第三类。


**触发**：`task-status-drift-check.ts` 报 `DIR-124-A2` 为 `reverse-drift-suspect`。人裁定
（escalations #1 选项 A）：先做全链复核再决定排期。

**方法**：机械脚本，22 个 `DIR-124*` 任务逐个取 `status`、AC 勾选比、`## Touches` 中**代码根**条目
的实际存在性。代码根 = `packages/` `plugin/` `experiments/**/scripts|test` `scripts/` `.claude/`；
簿记根 = `milestones/` `docs/plans/` `.quay/` `tasks/`，**不参与判定**（快速模式不产生它们，
计入会把每个快速模式任务变成假阳性——正是
[[gap-reverse-drift-check-buries-true-positives-in-noise]] 要修的缺陷）。

脚本的两个自身缺陷已在过程中发现并修正，记录在此以免下次重犯：反引号包裹的路径、以及
`` `path.ts (new)` `` 这种带空格后缀的条目会被当成散文丢弃——**A5 最关键的两个条目一开始就是这样
被漏掉的，第一版结果因此低估了问题**。

## 结果

| 任务 | 状态 | AC | 代码 Touches | 判定 |
|---|---|---|---|---|
| **A2** golden replay corpus | done → **todo** | **0/12** | **1/7** | **真实反向漂移** |
| **A5** baseline metrics emission | done → **todo** | **0/17** | **0/4** | **真实反向漂移** |
| A1a stage-event schema | done | 0/9 | 空 Touches | 勾选簿记未做（`workflow-event-schema.mjs` 两侧都在） |
| A3 invariant-ownership | done | 0/0（无 AC 段） | 7/7 | 同上 |
| A3a manifest + enforcement | done | 0/10 | 6/6 | 同上 |
| A3b DoD gate 集成 | done | 0/6 | 2/2 | 同上（`it0-dod-check.ts` 11 处引用，集成确已发生） |
| A1b · A4 · B1 · F-plancheck | done | 10/10 · 11/11 · 5/5 · 6/6 | 全落地 | 干净 |
| A · B · B2 · B3 · C · D · E · F · F-core · F-learn · DIR-124 | todo | — | — | 未开工，不适用 |

**两个真阳性的共同形态**：`done` + AC 一个没勾 + 代码零落地。这是一个**可机械判定**的形状，不需要
人读任务体——`status: done && 勾选数 == 0 && 代码根落地数 == 0`。

## 排期建议

**不排期，但把状态改对了。**

理由：A2/A5 不是「欠下的技术债」，是**尚未开工的工作的未满足前置**。DIR-124-A 的定位是
B/C/D/E 触碰控制平面之前的改动前基线（C0 层），而 B/C/D/E **全部是 `todo`**。因此：

- **没有东西被错误地证明过**。基线工具缺席，但它要保护的改动一次都没发生。这个洞是前瞻性的，
  不是回溯性的——这决定了它不紧急。
- **它会在 B/C/D/E 排期的那一刻变成阻塞项**，而那是控制平面的工作，正是快速模式当前绕开的部分。
- 因此正确的动作是**把状态改对**（已做），让它在真正需要时自然浮现为前置，而不是现在挤占
  exp6 阶段 1 的 12 小时。

### 已经拆掉的陷阱

A1 现在是 `todo`，所以 DIR-124-A 眼下闭不了。但 A1 的子任务 A1a/A1b 都已 `done`——**一旦 A1 闭合，
PARENT-DONE-IFF-CHILDREN 会让 A 在 A2/A5 仍是假 `done` 的情况下一起闭合**，于是 B/C/D/E 会在没有
基线的前提下开工。把 A2/A5 改回 `todo` 就是拆掉这个陷阱，不需要新机制。

## 不做：不补勾 A1a/A3/A3a/A3b 的 AC

这四个任务代码确实落地了，但 AC 一个没勾——意味着**当时没有逐条验收，现在也无从知道哪几条真的
满足了**。事后照着代码把勾补上是**制造证据**，正是 ADR-004「hard checks over prose」要防的那种
「散文被转述掉」。

正确处置：**保留未勾状态**，把本复核的结论作为权威记录——「代码已落地，验收未执行」。若将来
需要那份验收，重跑验收，不是补勾。

## 对检测器的输入

本次复核为 [[gap-reverse-drift-check-buries-true-positives-in-noise]] 提供了完整的真值集：

- **必须报**：A2、A5
- **必须不报**：B1（代码落地，只缺 milestones/M253 簿记）、A1b、A4、F-plancheck
- **边界情况**：A1a 与 A4 的 `## Touches` 段为空。检查器当前把「零条目」按 fail-closed 处理，
  但这两个的代码其实都在。空 Touches 的 `done` 任务应当报成**另一类**（「无法证明」），
  不要和「零落地」混为一谈——两者的处置完全不同。
