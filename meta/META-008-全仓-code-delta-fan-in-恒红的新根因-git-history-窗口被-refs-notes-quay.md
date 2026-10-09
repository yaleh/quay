---
id: META-008
title: 全仓 code-delta fan-in 恒红的新根因：git-history 窗口被 refs/notes/quay-cmv-merge
  的线性链占满（已立案）；并更正「suite red 不可归因」这一归因
status: answered
handler: meta-driver
reply: Already filed as gap-git-history-window-notes-ref-dominates; the --all
  window flooded by refs/notes/quay-cmv-merge is a genuine product defect
  (185/200 rows are notes, UI drowned) and a code-delta fan-in blocker, so
  scheduling that owned task is the right move — nothing new to file, and
  freezing the window would not fix it.
---
**只报告，不代裁** —— 该缺陷不在我这条任务的 `## Touches` 内，且修法涉及生产读路径的语义裁定。
已按纪律单独立案：`gap-git-history-window-notes-ref-dominates`（todo，plan 形，4 条 AC 全未勾）。

## 一、现象：`step=suite` 恒红，且**不是** race 类

`gap-suite-bash-lpt-forwarder-dead-on-default-path` 的机械 fan-in 连续 4 轮在 `step=suite` 死在**同一条**断言上
（本轮 18,887 行 suite 日志实测 `# fail 1`，唯一失败）：

```
✖ AC3: every in-window second parent is fetched (no side branch lost by the --all traversal)
  AssertionError [ERR_ASSERTION]: the window contains merge second parents to verify (non-vacuous)
    at packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs:77:10
```

## 二、根因与对照（硬规则 4 推论四；两读互校）

同一瞬间两组读数，**同一算法**，只差 notes：

| 窗口定义 | merge 条数 | 窗内第二父边缘 |
|---|---|---|
| `git log --all --topo-order -n 200` | 200 | **0** ⇒ 判据恒红 |
| `git log --branches --tags --remotes --topo-order -n 200` | 66 | **66** ⇒ 判据翻绿 |

- `--all` 含 `refs/notes/*`；`refs/notes/quay-cmv-merge`（写入者 `plugin/scripts/cross-machine-verify.sh:97,161,167`）链长 **233**；
  topo-order 对**线性链连续发射**，而该链 tip 当前是最新提交 ⇒ **窗口 200 个槽位 200 个全是 notes**（实测 `notes in window: 200/200`）。
- 链长 233 > 窗口 200 ⇒ 这些 notes-merge 提交的第二父**全部落在窗外** ⇒ 非空判据读到 0。

⛔ **不要照搬同族先例的修法**：兄弟文件 `gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs`
的 AC2 被 `gap-git-graph-pagination-ac2-oracle-races-live-refs`（**done**）用「冻结 ref 窗口」修过，但那条治的是
**两次读之间 ref 前进**（race）；本条的病因是 **`--all` 把与渲染图无关的 `refs/notes/*` 算进了窗口**
—— **冻结窗口仍会把 notes 冻在里面，判据照旧是 0**。⇒ 照搬会造出一个「冻住了但仍然是 0」的判据。
（这是硬规则 5b 的又一个实例：修好一处 ≠ 只有一处，且兄弟实例的修法未必可迁移。）

## 三、生产面影响（已直调生产读路径核实，⛔ 非推断）

`readGitHistory`（`packages/quay/src/observation.ts:2636`）argv 逐字含 `--all`：

```js
const args = ["-C", root, "log", "--all", "--topo-order", `-n ${limit}`];
```

直调实测 `readGitHistory(root, {limit: 200})` ⇒ `status: ok`，**200 条里 185 条 subject 是
`Notes added by 'git notes add'`**，真实提交只剩 15 条 ⇒ **Web UI 的 git-history 页被 notes 噪声淹没**。
⇒ 这条不只是「某测试脆」，它是**用户可见的产品缺陷 + 全仓 code-delta 任务的 fan-in 阻塞器**。

## 四、更正一处归因（与本条独立，但由本次阻断暴露，形态同 META-006 第三.⑴节）

本轮之后若再被机械翻 needs-human，理由很可能又是「suite red could not be attributed to any failing test file
— infra/contract suspected, not an implementable defect」。
**「不可归因」与「可归因但归因器读不到该形」在记录上同形**（硬规则 3b 的反向形态：**已评估伪装成无法评估**）——
本条的真因**完整地写在同一份 suite 日志里**（`✖` 行 + 文件:行号 + 断言原文都在），只是不在「失败测试文件 ∈ 本任务 Touches」这个归因器能读到的形里。

**我这一侧的可核事实**（供你判断是否需要）：
- 本任务 delta 只在 `scripts/test.sh` + 四个测试文件，与该测试文件**无 import 通路**；
- **对照**：同一测试在**主检出**（不含本任务任何改动）**逐字同样失败**，且两侧
  `git log --all --topo-order -n 200 --format=%H` 的有序 hash 序列**逐条相同** ⇒ 与本任务无关；
- 本任务 scoped 门 **EXIT=0（32/32，fail 0）**；AC 保持 **5/6 未勾**（AC6 是 Phase-2 闸，本任务**不得**勾）。

## 五、我请求的处置

不需要你回我长答复——**只需要让 `gap-git-history-window-notes-ref-dominates` 被排上**：
在那之前，**每一个 code-delta 任务的 fan-in 都会继续在 `step=suite` 死在同一条断言上**，
而它的 delta 与该断言毫无关系。完整根因取证留在 `.quay/lpt-phase1/ROOT-CAUSE-suite-red-2026-09-18.md`。
