---
id: gap-git-graph-scroll-panel-no-visual-affordance
title: git-history 滚动面板机制正确但零视觉存在感：贴视口边缘、无边框/背景/滚动条提示，用户误以为内容到此为止
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**用户报告（2026-09-10）**：`/git-history` 页面"提交纵向时间轴占满到页面底部的高度，且页面不可滚动。提交纵向时间轴下没有内容了吗？"

**已用生产实例核实：机制是对的，缺的是视觉可发现性（不是重复 `gap-git-graph-no-bounded-scroll-panel`）**。访问 `http://100.78.206.100:4173/git-history`（1440×900 视口）实测：

- `#git-graph-scroll`（`gap-git-graph-no-bounded-scroll-panel` 已落地的独立滚动容器）确实是可滚动的：`overflow-y:auto`、`max-height:calc(100vh - 240px)`；程序化滚动到底部，`scrollTop` 从 `0` 变为 `12483`，实测能滚，数据没有"到此为止"。
- 但整页级别（`document.body`/`document.documentElement`）**完全不滚动**：`scrollHeight === clientHeight === 900`（等于视口高度）——这跟用户描述的"页面不可滚动"完全吻合，用户的怀疑不是错觉。
- 根因：`#git-graph-scroll` 的内联样式是 `style="overflow-x:auto;overflow-y:auto;max-height:calc(100vh - 240px)"`（`serve-git.ts:896`），**没有任何边框/背景/阴影**。实测计算样式：`border: 0px none`、`box-shadow: none`、`background-color: rgba(0,0,0,0)`（透明）。容器底边贴着视口底部（`rect.bottom=876px` vs 视口 `900px`），跟页面背景融为一体——视觉上完全看不出"这是一个独立的、比内容矮的可滚动子面板"，看起来就是"页面到这里没有更多内容了"。
- 既有的 SVG 自身边框（`serve-git.ts` 里 `svg.attr("style", "border:1px solid var(--color-neutral-200);border-radius:6px;...")`）**不能顶替这个视觉提示**：那个边框画在**完整的 13000+px 高的 SVG 元素**周围，而不是这个 640px 高的可视窗口周围——用户能看到的只是这个大边框中间被截断的一小段，看不到边框本身（边框的上下两条边远在可视窗口之外）。

**跟 `gap-git-graph-no-bounded-scroll-panel`（done）的关系——核实过不是重复**：那个任务解决的是"滚动容器存不存在、`IntersectionObserver` 的 root 对不对、自动加载够不够、导航会不会被卷走"这类**机制**问题，其 AC/DoD 通篇没有一条涉及这个容器本身的边框/背景/可发现性——甚至其 DoD 原文写明"仅给容器加了视觉滚动条、但 `IntersectionObserver` 仍以 viewport 为 root……不算完成"，说的是反方向（有视觉无机制不算数），从未断言过"有机制就必须有视觉"。本任务是那个反方向缺口：**机制已经对了（已验证），純视觉上不可发现**——是一个独立缺陷，不是该任务的回归。

## AC

- [x] AC1 视觉边界存在：`#git-graph-scroll` 的计算样式（生产窗口渲染后）具备至少一种可辨识的面板边界（`border-width > 0` 或 `box-shadow !== "none"`），不满足数 = 0。
- [x] AC2 底部渐隐/更多内容提示：滚动容器未滚到底（`scrollTop + clientHeight < scrollHeight`）时，容器底部存在一个视觉提示元素/遮罩（如渐隐 mask 或固定的"↓ 更多提交"提示条），其可见性随 `scrollTop` 是否已触底而切换——用程序化滚动分别置于"未触底"和"已触底"两种状态，断言提示的可见性状态相应改变（不是恒定显示或恒定隐藏，判据能区分两种状态）。
- [x] AC3 与既有机制不冲突：复用 `gap-git-graph-no-bounded-scroll-panel.test.mjs` 的 vm 沙箱手法重跑其 AC1-AC5（容器结构、sentinel 归属、`IntersectionObserver` root、负控制、保险丝降级），全部保持通过——证明本任务只加视觉层，没有改动滚动/加载机制本身。
- [x] AC4 四视口回归（复用 `quay-webui-bootstrap-methodology` 的四视口法）：桌面宽/桌面窄/移动/暗色四张截图，确认新增的边框/渐隐样式在四种视口下都可见、不遮挡提交文本、不与既有的 sticky 图例样式冲突（图例仍然是不透明底、仍吸顶）。
- [x] AC5 负控制：把新增的边框/渐隐相关 CSS 显式还原为空（本任务改动前的状态），重跑 AC1/AC2 判据，断言不满足数 > 0——证明判据能取假，不是恒真断言。

## DoD

生产 `/git-history` 页面（`http://100.78.206.100:4173/git-history` 或等价 `quay serve` 实例）加载后，`#git-graph-scroll` 在视口内有清晰可辨的面板边界（边框/阴影其一即可），未滚到底时有明确的"下面还有内容"视觉线索，滚到底时该线索消失或变化；一个第一次打开这个页面、不看代码的用户能仅凭视觉判断出"这是一个独立的、比内容矮的可滚动区域，不是页面已经到底了"。`gap-git-graph-no-bounded-scroll-panel` 既有的滚动/加载机制（AC1-AC7）保持不变、不回归。

## Touches

- packages/quay/src/serve-git.ts（`#git-graph-scroll` 的内联样式加边框/背景；新增底部渐隐提示元素及其显隐逻辑，位于 `gitGraphClientScript()` 内）
- packages/quay/test/gap-git-graph-scroll-panel-no-visual-affordance.test.mjs（本任务的回归测试：AC1-AC5，复用 `gap-git-graph-no-bounded-scroll-panel.test.mjs` 的 vm 沙箱执行手法）
- tasks/gap-git-graph-scroll-panel-no-visual-affordance.md
