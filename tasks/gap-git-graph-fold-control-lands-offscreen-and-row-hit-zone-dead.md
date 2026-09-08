---
id: gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead
title: git-history 折叠控件画在泳道底部（合并行）⇒ 展开 25 提交的分支后落到视口外 195px 且压住同行主干文字；摘要行包围盒跨
  450px 而中间无命中元素 ⇒ 行内点击死区，用户体验上「展开后无法收缩」
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

**现象（2026-09-08 用 Playwright MCP 对生产实例 `/git-history` 真实交互实测，含负控制）**：

- 折叠**机制本身是好的**（负控制已做）：把 `▲ 折叠` 滚进视口后点击，SVG `<text>` 数 193→168、`折叠` 控件数 1→0，确实收缩回去了。所以问题不是「没有收缩功能」。
- 但它画在 `packages/quay/src/serve-git.ts:641` 的 `y(laneBot) - 6`，即分支**底部**（= 合并行）。实测展开一条 25 提交的分支后，控件出现在**视口下方 195px**（`inViewport: false`，viewport 高 720、控件 y=915），与刚才的点击点相距 **609px**，页面既不滚动跟随也无任何提示 ⇒ 用户体验上就是「展开后无法收缩」。
- 该控件的 x = `textX` = 737，与同一行主干提交文字的 y **仅差 9px**（控件 y=915，主干文字 y=924，字号 10/11），实测直接压在 `3f8b9aa Merge branch 'develop' into task/gap-plugin-root-resolution-remaining-callsites` 上。
- 摘要行的可点击面只有节点圆点 + chip + 文字**字形本身**：组包围盒从 x≈285 跨到 x≈737，**中间约 450px 是死区**。实测在死区点击（`document.elementFromPoint` 返回组外元素）行数 168→168，毫无反应——这是第一次尝试展开时真实踩到的。
- 移动端（390×844）：`#git-graph` 容器宽 366px 而 SVG 宽 2374px，需横滚 6.5 倍才能读到 subject。
- `/git` 返回 **404**（只有 `/git-history`），控制台留下一条 404 记录。

**期望**：① 展开态下收缩控件同时出现在分支**顶端**（原摘要行位置），或整行 chip 直接作为 toggle；② 每行加透明命中矩形，消灭 450px 死区；③ 折叠控件与同行主干文字不再重叠；④ 移动端提供「适应宽度」开关（只显 chip + 提交数，隐藏 subject）；⑤ `/git` 重定向到 `/git-history`。

**相关（机制不同，不重复）**：`gap-git-history-collapse-commits`（done）造的是折叠机制本身，不覆盖控件位置与命中面；`gap-webui-git-history-svg-unreadable`（done）修的是 viewBox 宽度被压扁，不涉及移动端适应宽度开关。

## AC

- [x] AC1 展开态下，被展开分支的**顶端行**（原摘要行 y）存在可点击的折叠控件：渲染后断言 `折叠` 控件的 y ∈ [laneTopY − 8, laneTopY + 8]，`node --test packages/quay/test/gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead.test.mjs` 退出码 0。
- [x] AC2 每个摘要行/折叠控件带一个透明命中矩形：断言渲染出的 `rect.git-svg-hit` 数 = 泳道数，且每个 `width` ≥ (textX − trunkX)。
- [x] AC3 负控制：测试内显式渲染一版不含命中矩形的输出，断言 AC2 的计数为 0 ⇒ 判据能取假。
- [x] AC4 折叠控件与同行主干文字 bbox 交集为空：复用 `gap-git-history-lane-identity-and-row-layout-overlap.test.mjs` 的 bbox 求交手法，断言相交对数 = 0。
- [x] AC5 `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' http://127.0.0.1:4174/git` 返回 301 或 302，且 redirect_url 以 `/git-history` 结尾。

## DoD

在生产实例上用真实浏览器完成一次「展开 → 就地收缩」闭环：展开一条 ≥20 提交的分支后，**无需滚动**即可看到并点击收缩控件，SVG 行数回到展开前的值；且在该行任意 x（含原来那段 450px 死区）点击都能触发展开/收缩。移动端 390px 宽下「适应宽度」开关生效后 `#git-graph` 的 `scrollWidth <= clientWidth * 1.2`。这三条以一次 Playwright 实测读数为证，不以单测通过替代。

## Touches

- packages/quay/src/serve-git.ts（折叠控件改画在泳道顶端；添加透明命中矩形；错开与主干文字的位置；移动端适应宽度开关）
- packages/quay/src/serve-handlers.ts（添加 `/git` → `/git-history` 重定向）
- packages/quay/test/gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead.test.mjs（本任务的回归测试）
- packages/quay/test/serve-nav-inconsistent-routes.test.mjs（路由重定向用例）
- packages/quay/test/gap-git-graph-lane-visual-encoding-and-fixed-width.test.mjs（折叠控件 chip 位置字符串断言随 y(laneBot)→y(foldRow) 更新）
- tasks/gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead.md
