---
id: META-009
title: follow-up（非本任务范围）：git-history 一族另有 5 个 oracle 文件各读两次实时 ref 集 ⇒ 装饰比较恒有
  race；已用人为 churn 对照证实，且改前改后暴露度相同
status: answered
handler: meta-driver
reply: "Distinct from the notes-window defect (that one is window composition;
  this one is two independent live-ref reads racing): the correct fix is 'one
  read, both sides share it' (snapshot), not freezing refs — the sibling gap-ac2
  frozen-ref fix is not transferable to the decoration axes, so this needs its
  own gap."
---
**只报告，不代裁** —— 这是 `gap-git-history-window-notes-ref-dominates` 实现过程中发现的**另一个**缺陷，
不在该任务的 `## Touches`/AC/DoD 内，按纪律未修、不扩范围。

## 一、现象（实测，非推断）

该任务的 scoped 门**第一次**运行时，`gap-git-graph-reconstructed-lanes-all-named-mainline-ref.test.mjs`
的 AC3 报 `mislabel 1`（`实际 1 !== 期望 0`，断言 `every rendered label matches git %D exactly`）；
**重跑即绿**，单文件连跑 **10/10 全绿** ⇒ 间歇性，不是确定性失败。

## 二、机制（已用【人为对照】证实，⛔ 不是假说 —— 硬规则 4 推论四）

该文件与另外 4 个兄弟文件一样，**独立地读两次实时 ref 集**：
`readGitHistory(REPO_ROOT,…)` 一次 + oracle `git log …` 一次（`REPO_ROOT` 是**活仓库**，
loop 每落一个提交就移动 `author`/`develop`）。两次读之间若有 ref 前进，同一个提交的 `%D` 就变了
⇒ 装饰计数失配。

**对照（能区分）**：我在自己的 worktree 里反复 `git update-ref` 翻转一个临时 ref，同一探针**立即复现**
该失配形态：

```
{"hash":"13a22683d","mine":["HEAD -> task/gap-git-history-…"],"git":["HEAD -> task/gap-git-history-…","zz-churn-probe"]}
{"hash":"9253728f5","mine":["zz-churn-probe"],"git":[]}
```

（临时 ref 已删除并核实：`git for-each-ref refs/heads/ | grep -c zz-churn` = 0。）

## 三、归因：⛔ 不是本任务引入的（有读数）

`--all` 窗口里**带装饰**的行数（`-n 500`）：**改前 = 10、改后 = 11** ⇒ notes 链**从未**把这些内容遮住，
**改前改后暴露度相同**。⇒ 该缺陷是**既有**的，与本任务的 notes 修法正交。

## 四、同族关系与建议

- 它和 `gap-git-graph-pagination-ac2-oracle-races-live-refs`（**done**）是**同一类**——那条用
  「冻结 ref 窗口 + `observation.ts` 的 `exec` 宿主读取缝隙」修了**一个**文件，
  **未推广到其余文件**（硬规则 5b：修好一处 ≠ 只有一处）。
- 仍有 race 的文件（均比较生产 rows vs 一次独立实时 `git log`）：
  `reconstructed-lanes-all-named-mainline-ref`（装饰，**已实测报红**）、
  `adopt-git-column-algorithm-and-decorate-labels`（列号/装饰/最新提交 4 处）、
  `ref-partition-collapses-all-topology-to-one-lane`（列号）、
  `stride-chip-overlaps-commit-row-text`（装饰计数）、
  `pagination-mainline-lane-empty-before-page`（`dropped` + 窗口大小相等）。
- ⚠️ **冻结 ref 只对「列号」这一类够用**：列号只依赖父拓扑（不可变）；而 `%D` 是**读时活量**，
  冻结 sha 列表**不冻结装饰** ⇒ 装饰类必须走「**一次读，两侧共用**」（同
  `gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs` 的 `snapshot()`/`snapshotExec()` 成例）。

**代价**：每次 suite 里这些比较都可能因 loop 落提交而假红，而 fan-in 的 `step=suite` 会把它读成
「本任务实现有问题」⇒ 烧掉 fan-in 轮次（与 META-006 第三.⑴节「已评估伪装成无法评估 / 可归因伪装成不可归因」同族）。

## 五、我这一侧的可核事实

- 本任务（notes 窗口）scoped 门 `EXIT=0`，`tests 169 / pass 169 / fail 0`；
- 我**没有**修这条 race：不同缺陷、有独立先例、修它要重写 5 个测试文件的读法拓扑，
  超出本任务实现前定稿的 `## Touches`；
- 本任务的 AC 正常臂与负控制臂**均不比较装饰**（AC3 只比较 hash 集合与父边），故不受它影响。
