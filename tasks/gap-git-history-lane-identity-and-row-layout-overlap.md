---
id: gap-git-history-lane-identity-and-row-layout-overlap
title: Git History 图：分支同名坍缩致展开重叠 + 全局行号未按可见态分配；改用 git log --graph 式左轨道/右文字两栏布局
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（2026-09-06 用 MCP 浏览器对 `/dashboard` 与 `/git-history` 实测截图发现，非推测）**：
在 `/git-history` 页点击任意一条已折叠分支摘要的「点击展开」，实际会同时展开十几条互不相关的分支
lane，展开后的提交文字在同一批 y 坐标附近大面积重叠成无法阅读的乱码（截图证据：所有同名 lane 一次
性铺开、行距 26px 内多行文字互相压住）。此外 `/dashboard` 的「最近提交」卡片对 git 读失败只显示裸
文案「读失败」三个字，看不到任何可诊断的原因。

**根因（已读代码定位，非猜测）**：

1. **分支标签坍缩 + 展开状态误绑定**——`observation.ts:2459-2465` 出于「不让已删除的历史任务分支在
   汇总表变成幽灵行」这个合理动机，把可从 mainline 追溯到的 commit 重新贴标为主干 ref（如
   `develop`）；但这个重标签同时喂给了 `serve-git.ts:151` 的 `branchNameOf()`，而本仓库惯例是任务
   分支合并后删除本地 ref（`history.heads` 里已无该 tip），于是几乎每一条历史 task 分支 lane 都被
   打上同一个字符串标签。客户端 `serve-git.ts:223/316/333` 的 `expanded[b.ref]` 状态**直接用这个坍
   缩后的字符串当 key**，导致点开其中一条,凡是同名的全部一起展开。
2. **行号按全部提交（含未展开分支）的全局时间序预先分配**——`serve-git.ts` 里
   `all = trunk.commits.concat(所有分支.commits)` 排序后一次性生成 `rowOf`，`y(row) = padY + row *
   rowH`。这个行号在渲染前就已经把所有历史提交（不管当前是否展开）都占了一个位置，展开状态只决定
   「画不画」，不影响「行号怎么分配」——于是一旦第 1 点导致多条 lane 同时展开，它们各自在时间轴上
   本来分散的提交，被迫塞进彼此紧邻、互相压线的行空间里同时渲染文字。
3. **文字起点与图形节点绑死在同一 x 坐标**——当前实现里每条 lane 的文字 (`lane.x + 8`) 紧贴该 lane
   自己的图形节点起写，不同 lane 的文字起点因此散落在整个宽度上，一旦多条 lane 同时展开（问题1的直
   接后果）文字互相穿插，没有任何"图形区/文字区"分离。`git log --graph`、`gitk`（有专门的
   "Maximum graph width" 设置，把图形限制在一个有界的左侧栏内）、以及 VS Code 扩展
   `mhutchie/vscode-git-graph`（图是表格的第一列，其余列——描述/日期/作者——固定在同一 x 起点，不
   随 lane 深度浮动）都采用同一个模型：**左侧一个有界宽度的"图形轨道栏"（只画点/线/菱形），右侧一
   个固定起点的"文字列"（一行一条，不管来自哪条 lane）**——这正是本任务要移植的布局模型。
4. **dashboard 吞掉具体错误原因**——`serve-dashboard.ts:66` 和 `:561` 把
   `live.status === "error"` / `d.history.status !== "ok"` 一律折叠成裸字符串「读失败」，同一个错误
   对象在 `/git-history` 页（`serve-git.ts:352`）却完整输出了 reason（如
   `git -C <已删除的 worktree 路径> for-each-ref ... fatal: cannot change to '...'`）。dashboard 卡
   片应该带上这段 reason 的摘要，而不是三个字了事——本仓库既有测试（`live-state.test.mjs` /
   `serve-board.test.mjs` / `serve.test.mjs`）已经把「读失败」这个字面量当成其它子系统
   （`/live`、board 列、landing）「不可读 vs 无数据可区分」判据的一部分，本任务**只在 dashboard 的
   git 卡片上追加 reason 摘要，不改动、不删除其它页面已固定的「读失败」字面量**，避免破坏那几个既
   有 AC。

参考实现（在线检索，见对话记录）：GitKraken/SourceTree 用直线而非曲线的 lane 提升可读性；
`gitgraph.js` 给每条 lane 分配独立于分支名字符串的 lane id，坐标系与命名解耦；
`git/graph.c`、`gitk` 对图形宽度设有上限并在超限时提示；`mhutchie/vscode-git-graph` 把图形渲染为
表格的一列，其余信息列固定对齐——这四点分别对应本任务要修的四个子问题。

## Plan

1. **Lane 身份解耦**：给每条 branch lane 生成一个结构性 id（`fork` commit hash + `merge` commit
   hash 的组合，`fork` 为空时退化为 lane 首个 commit 的 hash），仅用于 `expanded` 状态 key 与
   lane→x 映射；展示用的标签文字（如「develop（原分支已删除）」）与这个 id 完全解耦，坍缩成同名不
   再影响交互状态。
2. **按可见状态重算行号**：`render()` 每次执行时，只对「trunk 全部提交 + 已展开分支的逐条提交 + 每
   条折叠分支的 1 行摘要」这个当前实际要画的行集合重新生成顺序行号，而不是对`预先算好的、含未展开
   分支全部提交`的全局行号取子集。折叠→展开只改变这一行集合的构成,不改变已有行的相对顺序语义。
3. **图形轨道栏 / 文字列两栏布局**（对齐 `git log --graph`/`gitk`/`vscode-git-graph`）：
   - 图形轨道栏收窄到一个有界宽度：lane 的 x 坐标改用区间调度式的插槽复用（一条 lane 合入 trunk
     后释放的插槽可被之后新开的 lane 复用），不再是永远递增的 left/right 计数器；超过可配置的插槽
     上限时收窄/省略并给出「+N more」类提示（对齐 `git/graph.c` 里"超过列数上限时省略部分列"的做
     法）。
   - 所有提交/摘要文字（trunk 与全部 branch lane）统一从轨道栏右侧的**同一个固定 x 坐标**起写，一
     行一条，不再各自贴着自己的节点起写。
4. **常驻迷你图例**：在图区角落加一个不随滚动消失的图例（●=commit / ◆=merge / 竖线=trunk），与顶
   部大段说明文字解耦。
5. **dashboard 错误摘要**：`serve-dashboard.ts` 的两处折叠改为在「读失败」后追加 reason 的截断摘要
   （如「读失败 — cannot change to '.../gap-xxx': No such file or directory」），不改变「读失败」
   本身作为可识别前缀的既有语义。

## Acceptance Criteria

- [x] 单测：构造一个 fixture，其中两条不同 lane 的 merge-tip commit 被重标签成同一个显示字符串
      （模拟 mainline 重标签+分支已删除），断言 `layoutGitGraph`/lane-id 分配给它们的内部 id 不同。
- [x] 单测：对上述 fixture 生成的客户端数据模型，模拟"仅点击其中一条摘要"的展开动作，断言只有被点
      击的那条 lane 的 collapsed 状态翻转，另一条同名 lane 保持折叠。
- [x] 单测：构造一个含 N 条折叠分支（提交与 trunk 在时间上交错）的 fixture，断言渲染使用的总行数等
      于「trunk 行数 + 折叠分支数（每条 1 行摘要）」，而不是「trunk 行数 + 所有分支全部提交数」。
- [x] 单测：把 fixture 中每条分支都设为展开态，断言不存在两个不同的行被分配到同一个 y 坐标（重叠不
      变式在全展开态下也成立）。
- [x] 单测：对生成的 SVG，断言所有 `.git-svg-ink`/`.git-svg-muted` 文字元素的 `x` 属性等于同一个常
      量（与各自 lane 节点的 `cx` 不同），即文字统一从一个固定列起写。
- [x] 单测：构造一个含 ≥8 条并发展开分支的 fixture，断言图形轨道栏的最大并发深度不超过一个可配置上
      限（lane 插槽复用生效，超限给出提示而非无限加宽）。
- [x] 单测：给 `serve-dashboard.ts` 的渲染函数传入一个 `status:"error"` 的 `readGitHistory` 结果
      （带非空 `reason`），断言输出文本里出现该 reason 的子串，而不仅仅是字面量「读失败」。
- [x] 现场核验：对一个真实 `quay serve` 实例，把 workspaceRoot 指向一个不存在的路径，加载
      `/dashboard`，`curl`/grep 输出里能看到该缺失路径本身（不是裸「读失败」三个字）；命令与输出贴
      进提交信息或 PR 描述。
- [x] `node --test packages/quay/test/serve-handlers.test.mjs
      packages/quay/test/gap-git-history-lane-identity-and-row-layout-overlap.test.mjs` 全绿。
- [x] 既有 `live-state.test.mjs` / `serve-board.test.mjs` / `serve.test.mjs` 里固定「读失败」字面量
      的用例保持通过（本任务不改动那几处子系统的裸文案语义）。

## Definition of Done

- 在**本仓库自己的真实 git 历史**（已天然含有"多条任务分支被重标签为同一显示名"的条件，不需要伪
  造 fixture 才能复现）上加载 `/git-history`，把所有同名折叠分支一次性展开，截图确认不再出现文字
  互相压住的乱码——附上修复前/后的对比截图。
- 一个真实 `quay serve` 进程的 workspaceRoot 指向已删除的 worktree 路径时，`/dashboard` 的「最近提
  交」卡片显示可读的失败原因，而不是裸「读失败」——对一个真实进程验证，不只是单测。
- `scripts/test.sh` 全绿（含本任务新增/修改的用例）。

## Touches

- packages/quay/src/serve-git.ts
- packages/quay/src/serve-dashboard.ts
- packages/quay/test/serve-handlers.test.mjs
- packages/quay/test/gap-git-history-lane-identity-and-row-layout-overlap.test.mjs
- tasks/gap-git-history-lane-identity-and-row-layout-overlap.md
