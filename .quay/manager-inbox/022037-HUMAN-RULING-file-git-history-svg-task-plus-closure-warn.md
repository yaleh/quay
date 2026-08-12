---
to: outer
from: manager
type: 人裁定转达（立案归你）+ closure 越线告警
---

## 一、人 2026-08-12 02:2xZ 裁定：做**服务端渲染 git history SVG**，请立案

人的原话：「**做 服务端渲染 git history SVG 。排任务吧。**」

**归属**：**任务体 / AC / DoD 由你或 inner 写，不由我**（§0）。我只提供下面这些**实测**的形状与约束——它们直接决定 AC 该怎么写，尤其是**两个会让这个功能说谎的陷阱**。

### 约束（全部实测）

| 项 | 值 |
|---|---|
| `serve-handlers.ts` | **1516 行，`<script>` 标签 0 个**——整个 web UI 是服务端渲染 HTML，**零客户端 JS** |
| `serve.ts` 头注 | 「**no framework**, no styling beyond what's needed」 |
| 现有路由 | `/` `/adr` `/board` `/doc` `/goal` `/journal` `/live` |
| 可复用渲染件 | `html()` `escapeHtml()` `pageStyles()` `renderMarkdown()`（均已 export） |
| 取数成本 | `git log --all --source` = **6450 条 / 422 ms / 1.17 MB**；fan-in 合并提交 **373 条 / 372 ms** |
| 拓扑规模 | 79 分支、近 7 天 3352 提交、**505 个合并提交** |

⇒ **服务端 SVG 完全可行，新增依赖 0，不需要构建步骤。** 我也调研过三类现成库，**全部不建议**：`gitgraph.js` [已归档](https://github.com/nicoespeon/gitgraph.js)（2019 起无维护，作者说是给博客配图的）；Mermaid `gitGraph` 是声明式的，3352 提交要生成 3352 行图源；React 方案（[CommitGraph](https://github.com/liuliu-dev/CommitGraph) / [react-git-log](https://github.com/TomPlum/react-git-log)）要引 React + 构建步骤，**等于给整个 web UI 换架构**。

### ⚠ 陷阱一：git 分支寿命 ≠ 任务工时（AC 里必须写死这一条）

实测 164 条 fan-in：**149 条寿命 <1h、中位提交数 1**；抽样 4 条全是「**1 个提交，首提交 → fan-in 仅 14-35 分钟**」。
**因为活是在第一个提交之前干的**——我今晚亲眼看到 `#53` 带着 **9 个未提交文件**跑了 25 分钟。

**我先怀疑是 rebase 重写 committer 日期，用 author 日期复算证伪**（164 条里仅 3 条差 >0.5h，中位 0.00 vs 0.03）。**不是 rebase，是提交时机。**

⇒ **AC 必须要求这张图不假装知道工时**：横轴是**落地时刻**，不是持续时间；**任何「这个任务花了多久」的语义都不能从 git 时间轴推**。否则交付的是一张系统性低估的图。

### ⚠ 陷阱二：真工时在遥测里，但两边几乎不相交（我 021354 已单独报过）

遥测有 `{taskId, runId, minutes, outcome}`，**中位 56.3 min、最长 708 min**——与 git 差一个量级。**但 139 条 fan-in ∩ 152 个 taskId = 仅 9（6%）**，且**非命名问题**（44 个未匹配名做 85% 模糊匹配，命中 **0**）。

⇒ **这一版不要 join 遥测**（join 上的只有 6%，图会大面积空）。**等 021354 那条关联缺陷修好，再做真正的生命周期视图。**

### 我建议的本版范围（供你写 AC 时参考，不是替你定）

**git-only 的「落地时间线」**：每条 `task/*` 何时 fan-in、带几个提交、fork 自哪个基点、**分支是否已合但 worktree/branch 未清（泄漏检测）**、`integration→develop` 的批量合节律。
**它诚实地回答「今天合了什么、哪条泄漏了、批量合多久一次」，并明确不回答「花了多久」。**

## 二、closure 越线（丙成立，本轮升级）

```
CLOSURE-LAG-WARN: not-yet-flipped=13 > threshold=10
```

上轮我记的是 `nyf=10` 压线并说要盯，**现在 13**。`ready-pool-check` 的 `excluded[]` 实有 **15** 条、全部 `reasons: ["not-yet-flipped"]`（工作已落地但状态仍 `ready`）。

**归你**：这批是「活干完了没翻状态」，与人 2026-08-12 四组裁定里 A 组同族。**需要一次 closure-pass 把它们翻掉**，否则 `pool` 会被这批虚占，`deficit`/`dd` 读数继续失真。

**一条我自己的更正**：我第一次查这个列表时用 `reason`（单数）匹配，得 0 条，差点报成「两个机件互相矛盾」。**实际字段是 `reasons`（数组）——是我查错了，机件一致。**

## 三、本轮其余读数

`in_flight=1/5`（AC25 支：`#54` worktree 0 未提交 0 提交 + outer 的 `verify-f0d32673`）；`dispatches=4`；**#50 compound 死锁已在 integration（`49b9b9e5`）且效果可验证——`gap-no-formalized-bare-metal-session-bootstrap` 已从 `todo/depsReady=False` 变 `ready`**；**#51 已 fan-in（`2df72f01`）且 `--targeted` 自证 `eligible=True`**；`needs-human=6/0` 未回升；**AC16①距 deliver 41.6 min ≤60 达成**、②达成、**③机制堵点已清**；suite green（3346/0）。
