---
id: gap-git-graph-decoration-labels-as-colored-chips
title: git-history 分支标签改为按列色着色的胶囊 chip：拆分独立标签、HEAD 高亮、远程/本地区分
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**用户建议（2026-09-09）**：`/git-history` 每行的分支标签（`%D` decorations）目前是"括号包裹纯文本"，建议改为**独立的反色胶囊标签（chip/pill）**：背景色与该提交所在的 Git 拓扑列颜色联动、每个 ref 名拆成独立小标签并排（不再合并成一个逗号串）、`HEAD` 单独高亮、远程追踪分支用"幽灵标签"（描边+透明底）跟本地分支区分。

**代码定位与现状（已用生产实例核实，非猜测）**：`packages/quay/src/serve-git.ts:525-530`：
```js
var label = r.hash.slice(0, 7);
if (r.decorations && r.decorations.length) { label += " (" + r.decorations.join(", ") + ")"; }
label += " " + r.subject;
g.append("text").attr("class", "git-svg-ink")...text(label);
```
`hash + decorations + subject` 拼成**一个字符串，塞进同一个 SVG `<text>` 元素**——不是分别的 DOM 节点，不可能单独上色/加边框。访问 `http://100.78.206.100:4173/git-history` 截图实测确认现状：`9eed06f (HEAD -> author, develop) goals: ...`、`142e223 (origin/develop, worktree-dispatch-pref-priority-goal-evidence) manager: ...`，跟用户描述一致。**这个单一 `<text>` 结构是本任务要改的核心**，不是加一个 CSS class 能解决的。

**逐项可行性核实**：
1. **色彩联动**：`decorations` 只在 ref 当前指向的**那一行**内联显示一次（既有的"git decorate 语义"注释）。取该行的 `laneColor(r.col)` 做 chip 背景色是良定义的——精确等于该标签所在的那一格列线在这一行的颜色。**需要澄清的语义边界**：这不是"develop 分支永远同一个颜色"式的持久身份色——`assignGitColumns` 是标准 `git log --graph` 列复用算法，同一列号会被历史上不相关的分支反复借用（`gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge` 已用生产数据证实）。因为每个标签只出现一次，这不影响本次诉求，但要在设计里写清楚，避免以后被理解成"develop 到处都是同一个颜色"。
2. **对比度**：8 个列色（`GIT_GRAPH_LANE_PALETTE`）与纯白文字的 WCAG 对比度全部 ≥5.6:1（多数 ≥7:1，AAA 级，已逐色算过），可以固定用白色文字，不需要每个 chip 现场算亮度。
3. **HEAD 拆分**：git 的 `%D` 把 `HEAD -> author` 输出成**一个**decoration 条目，不是两个。要单独渲染 `HEAD` chip，需要客户端再拆一次——`observation.ts:2492` 的 `primaryRefFromDecorations` 已经用了 `/^HEAD\s*->\s*(.+)$/`，复用同一模式即可，不是新发明。
4. **远程 vs 本地——不能只靠字符串形状猜**：用生产真实数据核实过一个会直接踩坑的反例，同一次窗口里两条 decoration 并存：
   ```json
   ["origin/fix/goal-card-id-flex-squeeze", "fix/goal-card-id-flex-squeeze"]
   ```
   本地分支名本身就带斜杠（`fix/...`、`task/...` 是本仓库的常规命名），纯前端"看有没有斜杠"或硬编码 `"origin/"` 前缀（本仓库 `git remote -v` 实测有两个远程：`origin`、`vhs`）都会误判。正确做法：服务端已经在 shell 出 `git`（`observation.ts`），加一次 `git -C <root> remote` 把远程名列表放进 `#git-graph-data` payload，客户端用这份权威列表做 `^(remoteName)\/` 前缀匹配——这是必须的服务端改动，纯 CSS/前端做不到可靠区分。
5. **行高**：当前 `GIT_GRAPH_ROW_H`（=24px）配 11px 字号是给纯文本设计的；胶囊需要的内边距会让 chip 高度接近甚至挤压 24px 的行距。需要联动小幅上调这一个常量（已参数化，改一处即可），否则相邻行的 chip 会挤线。

**现有相关任务核实过不是重复**：`gap-git-graph-adopt-git-column-algorithm-and-decorate-labels`（done）负责的是"让 decorations 能内联显示出来"；`gap-git-graph-lane-chip-rendered-once-regardless-of-span` / `gap-git-graph-stride-chip-overlaps-commit-row-text`（均 done）说的是**已退役的旧泳道模型**里"整条泳道一个 chip"的概念，跟本任务"每个 decoration 一个胶囊 chip"是完全不同的机制，不构成重复。

## Plan

1. **服务端（`observation.ts` + `serve-git.ts`）**：`readGitHistory`（或其调用点）增加一次 `git -C <root> remote`，把远程名数组通过 `layoutGitGraph`/`#git-graph-data` payload 传给客户端（新增字段，如 `remotes: string[]`）。
2. **客户端（`gitGraphClientScript()` 内 `render()`，`serve-git.ts:507-531` 一段）**：
   - 把 `r.decorations` 里每个字符串（`HEAD -> X` 先按④拆成 `HEAD` + `X` 两项）逐个渲染为 `<rect rx>` + `<text>` 对：先追加一个（可临时不可见的）`<text>` 用 `getComputedTextLength()` 量宽度（复用文件已有的 `:535-539` 量宽度手法），据此画背衬 `rect`（宽度=文字宽+左右 padding，`rx` 做圆角），再把文字摆在 rect 内部；chip 之间留固定 `gap`。
   - chip 背景色：`laneColor(r.col)`；文字：固定白色。
   - HEAD chip：独立 CSS class（如 `git-svg-decor-chip--head`），加粗描边/纯色高对比底。
   - 远程 chip：decoration 匹配 `^(remotes 中任一名字)\/` 时加 `git-svg-decor-chip--ghost` class（描边+透明/浅色底），其余（含本地同名分支）走默认实心样式。
   - hash → chips → subject 的 x 坐标顺序布局：subject 起始 x = 最后一个 chip 右边界 + gap（不再是拼进同一个字符串）。
3. **行高联动**：视 chip 实际高度小幅上调 `GIT_GRAPH_ROW_H`，确认相邻行 chip 不重叠（沿用现有基于该常量的 `y(row)` 布局，不需要额外坐标系）。

## AC

- [x] AC1 服务端 payload 携带远程名列表：`#git-graph-data` 的 JSON 含 `remotes` 数组，且对本仓库真实 `git remote` 输出（`origin`、`vhs`）逐项相等（不满足数 = 0）。
- [x] AC2 每个 decoration 渲染为独立 chip：生产窗口内，任取一行 `decorations.length > 0` 的提交（含 `HEAD -> X, develop` 这种多 decoration 行），渲染出的 `.git-svg-decor-chip` 数 = 拆分后（HEAD 单独计一个）应有的 decoration 条目数；不满足数 = 0，且该窗口内 chip 总数 > 0（非退化判据）。
- [x] AC3 chip 背景色随行的列色联动：对每个渲染出的 chip，其 `fill`/背景色变量 = 该行 `laneColor(r.col)`（即 `var(--color-lane-(r.col % 8))`）；不满足数 = 0。
- [x] AC4 HEAD 独立拆分与高亮：对 decorations 含形如 `HEAD -> X` 的行，渲染结果里存在一个文本严格等于 `HEAD` 的 chip（带 `git-svg-decor-chip--head` class）与一个文本等于 `X` 的 chip，且**不**存在一个内容整体等于 `HEAD -> X` 的单一 chip；不满足数 = 0。
- [x] AC5 远程/本地区分不误判——用本仓库真实反例校验：`fix/goal-card-id-flex-squeeze`（本地）渲染为默认实心样式（无 `--ghost` class），`origin/fix/goal-card-id-flex-squeeze`（远程追踪）渲染带 `--ghost` class；两者判定不互相污染。
- [x] AC6 行内顺序与不重叠：hash chip 序列 subject 的 x 坐标满足 `subjectX >= 最后一个 chip 的右边界 + gap`（对生产窗口全部 decorated 行成立，不满足数 = 0）；相邻两行的 chip 纵向 bounding box 不重叠（不满足数 = 0）。
- [x] AC7 负控制：把 AC2 的判据对象换回"整行一个 `<text>`"的旧渲染（本任务改动前的行为），断言 chip 数为 0（AC2 判据能取假，不是恒真）。
- [x] AC8 既有测试不回归：`gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs`、`serve-handlers.test.mjs` 里基于 `row.decorations` 数组（数据层，非渲染文本）的既有断言（如 `decorations.includes("feature/alpha")`）在本次改动后原样通过——本任务只改渲染，不改 `decorations` 数据结构本身。

## DoD

生产实例 `/git-history`（`http://100.78.206.100:4173/git-history` 或等价 `quay serve` 实例）重新加载后，抽查含多个 decoration 的真实提交行（如当前 HEAD 所在行、任一 `origin/...` 远程行）：每个 ref 名是独立带背景色的圆角 chip、背景色等于该行的列色、`HEAD` 单独高亮、远程用描边幽灵样式且未与同名本地分支混淆，chip 与 chip 之间、chip 与 commit subject 之间有清晰间距、不重叠不贴死。相邻行的 chip 在改动后的 `GIT_GRAPH_ROW_H` 下不发生纵向重叠。

## Touches

- packages/quay/src/observation.ts（新增/暴露读取 `git remote` 的辅助函数，供 `serve-git.ts` 组装 payload 时调用）
- packages/quay/src/serve-git.ts（payload 加 `remotes` 字段；`gitGraphClientScript()` 的 `render()` 内 decoration 渲染从单一 `<text>` 拼接改为逐个 chip 的 `rect+text`；`GIT_GRAPH_ROW_H` 按 chip 高度联动调整）
- packages/quay/test/gap-git-graph-decoration-labels-as-colored-chips.test.mjs（本任务的回归测试：AC1-AC8，复用 `gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.test.mjs` 的 vm+d3-mock 执行手法）
- packages/quay/test/gap-git-graph-stride-chip-overlaps-commit-row-text.test.mjs（本任务把该测试的「渲染器只画一个 text 位点」判据更新为「hash → decoration chip → subject 内联标签」——decoration chip 是行内文本流的一部分，不是浮动 lane-chip）
- tasks/gap-git-graph-decoration-labels-as-colored-chips.md
