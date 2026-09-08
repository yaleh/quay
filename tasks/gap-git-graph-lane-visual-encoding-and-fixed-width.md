---
id: gap-git-graph-lane-visual-encoding-and-fixed-width
title: git-history 轴线视觉编码：全部 lane 共用一个 class（对比度 1.13:1、无分支区分色、三条直线拼直角），且 SVG
  宽度写死 720px 与内容无关 ⇒ 37/98 条文字被永久截断且滚不出来
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-git-graph-branch-name-fallback-to-trunk-ref
---
**type:** execution

## Proposal

**来源**：人 2026-09-08 对 `/git-history` 走查后逐条提出（原话）：「左部的轴线应再做一下检查和改进——
线的颜色应与背景有更大对比度，且应用有差异的颜色表现各分支的历史；分支合并时转角应用圆角代替直角，
这样可以更容易区别合并的分支和交叉的线；各分支的最近节点上，应在右侧的文字标注用更显著的形式
（如反色或加外框等）标注分支名称」。以下每条都配了实测读数，另补一条人未点名但同页实测出来的截断问题。

**A. 对比度（实测，非目测）**：`.git-svg-grid { stroke: var(--color-neutral-200) }`
（`packages/quay/src/serve-render.ts:256`）解析为 `#eae7e7`，画布 `.git-svg-surface` 为
`--color-neutral-100` = `#f8f4f4`。按 WCAG 相对亮度算 **对比度 = 1.13:1**（1.0 即完全不可见）。
2 倍放大的截图里一条轴线都看不出来。

**B. 分支无区分色（实测）**：SVG 内 64 条 `<line>` **全部共用同一个 `.git-svg-grid` class**，节点也全是
`--color-accent-600`。即「哪条线属于哪条分支」这一维信息**没有任何视觉通道承载**。

**C. 直角（实测，结构性）**：同一 SVG 内 `<line>` **64 个、`<path>` 0 个**。lane 的竖线、fork 横线、
merge 横线是三条互不相连的独立 `<line>`（`serve-git.ts:407 / :410 / :414`）⇒ **结构上只可能是直角**，
且与「两条无关的线恰好交叉」在视觉上完全同形——正是人指出的那个辨识困难。

**D. 分支名标注**：依赖前置任务 `gap-git-graph-branch-name-fallback-to-trunk-ref`。在它落地前，
28 条 lane 的名字实测 100% 都是 `develop`，标注出来无从分辨；故本任务 `depends_on` 它。

**E. 文字永久截断（人未点名，同页实测补充）**：`serve-git.ts:361` 是
`var width = textX + 460;` —— **写死 720px，与最长 subject 长度无关**。实测 98 个 `<text>` 里
**37 个（37.8%）** 的 `bbox.x + bbox.width` 越过 viewBox 右边界被裁掉；而挂载容器
`#git-graph` 宽 **868 > 720**，所以**连横向滚动条都不会出现**——被裁掉的文字在任何操作下都取不回来。
这属于 CLAUDE.md 硬规则 4 推论二同族：**一个恰好等于当前内容规模的字面量常量，换一批数据就变成真限制，且静默**。
宽度必须由内容派生（量最长文本或用 `getBBox()` 后回写），不能是字面值。

**为什么 A–E 合成一条而不拆五条**：五者全部落在 `serve-git.ts` 的 `gitGraphClientScript()` 同一个函数体
（外加 `serve-render.ts` 的两条 CSS token），Touches 完全重叠 ⇒ 拆开也只能串行执行，且每一条都要重写同一段
绘制代码，冲突成本高于收益（memory `dispatch-order-by-touches-overlap-direction`）。A/B/D 本就是同一个机制的
三个面：**lane 身份这一维在视觉上无编码**。C 与 E 作为同一次重绘顺带落实，各自带独立可取假判据。

**修法方向**：

- 三条 `<line>` 合成一条 `<path>`，用 `q`/`a` 段生成圆角（`M laneX,mergeY … q` 到 trunk），半径取
  `min(6, laneGap/2)`；
- lane 描边色改为按 `slot` 取一组**分类色板**（不是同色深浅），每色对背景对比度 **≥3:1**，
  且明暗两主题都成立；`--color-neutral-200` 只保留给真正的网格线；
- 各 lane 最近节点右侧的分支名用反色 chip（背景=该 lane 色、文字=对比色）绘制；
- `width` 改为由实测最长文本宽度派生。

## Acceptance Criteria

- [x] AC1 对比度可算：单测对 lane 描边色与画布色计算 WCAG 对比度，断言**每一条 lane 色 ≥ 3.0**。
      取假：当前 `#eae7e7` on `#f8f4f4` = **1.13**，跑同一函数必须报红。断言失败时打印全部不达标色值与条数。
- [x] AC2 分支可区分：生产载体读数——加载 `/git-history`，统计 lane 描边 `stroke` 的**去重色值个数**，
      断言 `>= min(6, lane 总数)`。取假：改动前实测去重色值 = **1**。
- [x] AC3 圆角为结构事实而非观感：断言同一 SVG 内 lane 连接线的 `<path>` 元素数 **> 0** 且 fork/merge 连接
      **不再由独立 `<line>` 承载**（`<line>` 中 x1≠x2 且 y1==y2 的横线条数 == 0）。取假：改动前
      `<path>`=0、横 `<line>`>0。
- [x] AC4 分支名标注存在且可读：断言每条 lane 的最近节点右侧存在一个带背景填充（非透明）的文字元素，
      其文字内容 == 该 lane 的 `ref`，且文字与其背景的对比度 ≥ 4.5。打印缺标注的 lane 清单与条数。
- [x] AC5 宽度由内容派生（回答硬规则 4 推论二）：断言 SVG 的 `width` 属性 **不是常量**——构造两个最长 subject
      长度相差 ≥200px 的 fixture，断言两者算出的 width **不相等**；并对生产页面断言
      `bbox.x + bbox.width > viewBox 宽度` 的 `<text>` 条数 == **0**。取假：改动前实测 37/98。
- [x] AC6 `bash scripts/test.sh --for-task gap-git-graph-lane-visual-encoding-and-fixed-width` 退出码 0。

## Definition of Done

在**真实运行的实例**上加载 `/git-history` 截图，图中：轴线肉眼可见、不同分支不同色、合并处为圆角、
每条分支最近节点旁有反色分支名 chip、没有任何一条 subject 被右边界切掉。改动前后截图并列 +
AC1/AC2/AC5 的前后数值对照（1.13→≥3.0、1→≥6、37→0）贴进提交信息。**单测绿不算达成。**

## Touches

- `packages/quay/src/serve-git.ts`
- `packages/quay/src/serve-render.ts`
- `packages/quay/test/gap-git-graph-lane-visual-encoding-and-fixed-width.test.mjs`
- `packages/quay/test/gap-git-history-lane-identity-and-row-layout-overlap.test.mjs`
- `tasks/gap-git-graph-lane-visual-encoding-and-fixed-width.md`