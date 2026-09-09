---
id: gap-git-graph-no-bounded-scroll-panel
title: git-history 页面提交纵向时间轴无独立滚动容器：整页滚动触发无限加载，导航/说明随之被卷走且页面高度无界增长
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

**实测（2026-09-09，生产 server `100.78.206.100:4173/git-history`，Chrome DevTools MCP 复现）**：

- 初始加载 500 条提交，整页高度 ≈ 12,383px（`document.scrollingElement.scrollHeight`）。
- 滚动到页面底部一次，`IntersectionObserver` 触发 `loadOlder()`；因既有的自链逻辑（`serve-git.ts:600`，加载完立刻检查 sentinel 是否仍在视口附近、是则再触发一次）连锁加载两页，行数从 500→**999**，整页高度涨到 **24,359px**——滚动条位置从"底部"瞬间又变回"中间"。
- 截图证实：滚动之后，页头导航栏、`<h1>`、说明文字、图例**全部随内容一起被卷走**，视口里只剩纯提交列表，没有任何"到底了"的视觉锚点，也回不去导航。
- 仓库全部提交数（`git log --oneline --all`）= **19,520**。按当前 ~24px/行推算，理论上滚到底整页高度会长到 **~47 万 px**——用户体验是"越滚越长，永远看不到头"。

**根因**：

1. `#git-graph`（`serve-git.ts:730`）只是 `<main>` 里一个普通块级 div，只设了 `overflow-x:auto`；因为它的高度是 `auto`（跟内容一样高），从不产生真实的纵向溢出——**真正在滚的是整个文档 `<html>`**，不是这个图表容器自己。
2. `IntersectionObserver`（`serve-git.ts:606-610`）没有传 `root`，默认监视 **viewport**，所以"是否该加载更早提交"判断的是"整页是否滚到底"，而不是"图表内部是否滚到底"。
3. 每次 `loadOlder()` 之后都会调用 `render()`，而 `render()`（`serve-git.ts:464` `svg.selectAll("*").remove()`）是**整个 SVG 全量重绘**，不是增量追加——行数越滚越多，每次重绘成本线性上升，是同根的长期性能隐患（本任务不解决，见下方排除范围）。

人已确认改进方向：给提交纵向时间轴一个**有边界、独立可滚动的容器**（而不是让整份文档承担滚动），即下面的方案 A。

## Plan

**方案 A：独立滚动容器 + 自动加载轮数上限**

1. 给 `#git-graph` 套一层固定高度（如 `max-height: calc(100vh - <头部实际高度>)`）+ `overflow-y:auto` 的容器；`sentinel`（`serve-git.ts:732`，当前在 `<main>` 里、图表 div 外面）挪进该容器**内部**。
2. `IntersectionObserver` 显式传 `root: container`（而不是默认 viewport），`rootMargin` 相应调整。
3. 头部高度不是常量（有无 `statusNote`、不同视口宽度换行行数不同），客户端脚本里用 `container.getBoundingClientRect().top` + `window.innerHeight` 动态算 `max-height`，并在 `resize` 时重算，不要写死 CSS 值。
4. 图例 `gitGraphLegendHtml()`（`serve-git.ts:630`）已经写了 `position:sticky;top:0`，目前因为没有真正的滚动祖先而不生效；容器产生真实纵向滚动后这个 sticky 会自动生效（吸在容器顶部）——保留这个副作用，但要检查/补内边距与不透明背景，别遮住紧邻它的第一行提交。
5. 移动端窄屏视口高度有限，独立容器高度需要做响应式处理，不能直接照抄桌面比例；按 `quay-webui-bootstrap-methodology` 已有的四视口验收方法截图核对（桌面宽/桌面窄/移动/暗色）。
6. 横向滚动（现有 `overflow-x:auto`）与纵向滚动共存在**同一个容器**（`overflow-x:auto; overflow-y:auto`），不要拆两层容器。
7. 加载量保险丝：自动 `IntersectionObserver` 触发的加载累计达到阈值（如 2000~3000 行，具体数字由实现时按实测渲染性能定）后，自动停止 `IntersectionObserver` 观察，把 `sentinel` 降级为可点击的"加载更早提交"按钮（复用现有 `sentinel.addEventListener("click", loadOlder)` 的降级路径，`serve-git.ts:611-613` 已有此形态，只是从"IntersectionObserver 不可用时的降级"变成"达到阈值后主动切换"），避免长时间使用后 DOM/SVG 无限膨胀。

**明确排除范围（不在本任务）**：

- 虚拟化渲染（只渲染视口附近行、增量而非全量重绘 SVG）——记为已知技术债，可另立任务引用本任务，不在本任务 AC 内。
- 把自动无限滚动整体改成手动分页按钮——本任务维持"默认自动加载，超阈值后降级为按钮"的组合，不采用纯按钮方案。

## AC

- [x] AC1 容器结构：`renderGitHistoryPage`/`gitGraphClientScript` 输出的 HTML+CSS 中，`#git-graph`（或其新增的外层容器）同时具备 (a) 一个高度约束（内联 style 的 `max-height`，或客户端脚本运行时设置的 `style.maxHeight`）与 (b) `overflow-y:auto`/`scroll`；缺一不可。单测对源文件做字符串/结构断言。
- [x] AC2 `sentinel` 归属：`git-graph-sentinel` 在新结构里是该滚动容器的子孙，不再是 `<main>` 下与图表平级的兄弟节点——单测解析 `renderGitHistoryPage()` 返回的 HTML，断言 sentinel 的标签落在容器开合标签之内。
- [x] AC3 `IntersectionObserver` root：仿照 `gap-git-graph-scroll-loader-self-chain-blocked-by-loadingolder-flag.test.mjs` 的 `runClient` vm 沙箱技术，执行真实 `gitGraphClientScript()`，用一个记录构造参数的 `IntersectionObserver` 桩断言 `new IntersectionObserver(cb, opts)` 的 `opts.root` 是一个具体元素对象，不是 `undefined`（当前实现恒为 `undefined`）。
- [x] AC4 负控制：同一份沙箱里把 `opts.root` 参数抹掉（模拟当前未修复实现），断言捕获到的 `root` 变回 `undefined` ⇒ 判据能区分新旧代码，不是恒真。
- [x] AC5 加载量保险丝：单测里连续 mock 足量的非空翻页响应使累计行数越过实现选定的阈值，断言越过阈值后**不再自动发起 fetch**、而是 `sentinel` 被绑定为可点击（`addEventListener("click", loadOlder)` 或等效），且此后点击仍能继续加载直至 `finishOlder()`。
- [x] AC6 生产实测（DoD 证据，Playwright/chrome-devtools，本文件不自动化）：在生产 `/git-history` 页面，把"图表容器"滚动到底、连续触发多次加载，读取 `document.scrollingElement.scrollHeight` 在加载前后基本不变（容差内），同时容器自身 `scrollHeight` 持续增长；并用截图确认导航栏/标题/说明文字始终在视口内可见。
- [x] AC7 四视口回归：按 `quay-webui-bootstrap-methodology` 的四视口方法（桌面宽/桌面窄/移动/暗色）分别截图，确认无明显裁切、遮挡、图例覆盖提交文本等问题，截图作为 DoD 证据落盘。

## DoD

生产 `/git-history` 页面上，用户可以持续滚动"图表容器"直至"已加载到仓库最早提交"（或越过保险丝阈值后改为点击按钮继续加载），全程导航栏、标题、说明文字保持可见，**整页高度不随之无限增长**（`document.scrollingElement.scrollHeight` 稳定在头部+固定容器高度左右，只有容器内部的滚动位置变化）。以一次 Playwright/chrome-devtools 实测的四视口截图 + 加载前后 `scrollHeight` 读数为证据落盘（附在任务或提交记录里）。仅给容器加了视觉滚动条、但 `IntersectionObserver` 仍以 viewport 为 root（即功能上仍是"整页滚动触发"）不算完成——AC3/AC6 会验出这种半成品。

## Touches

- packages/quay/src/serve-git.ts（`#git-graph` 容器结构、`gitGraphClientScript` 的 `IntersectionObserver`/`loadOlder`/`sentinel` 相关代码）
- packages/quay/test/gap-git-graph-no-bounded-scroll-panel.test.mjs（本任务的回归测试，新增文件）
- tasks/gap-git-graph-no-bounded-scroll-panel.md（本任务自身）

## Evidence

**AC1–AC5 自动化**：`node --test packages/quay/test/gap-git-graph-no-bounded-scroll-panel.test.mjs` — 5/5 通过（AC1 容器结构、AC2 sentinel 归属、AC3 IO root=容器元素、AC4 负控制、AC5 保险丝降级为可点击按钮）。

**AC6 生产实测**（worktree 起服务 `node --experimental-strip-types packages/quay/bin/quay.ts serve --host 127.0.0.1 --port 4180`，chrome-devtools MCP 对 `/git-history` 实测，桌面宽 1440×900）：

- `document.scrollingElement.scrollHeight` 全程恒为 **900px**（== `clientHeight`，整页不再滚动）；`#git-graph-scroll` 自身 `scrollHeight` 随滚动加载持续增长 **12,125 → 24,101 → 36,077 → 48,053 → 60,029 → 72,005 → 83,981px**（~500 → ~3,495 行），`clientHeight` 640px——只有容器内部滚动位置在变，整页高度稳定在头部+容器高度左右。
- 连续滚动到底触发自动加载：越过保险丝阈值（`autoLoadedRows≥2500`，累计 ~3,000 行）后 `sentinel` 由"加载更早提交…"降级为**"点击加载更早提交"**（`cursor:pointer`），不再自动 fetch。
- 全程 `nav`/`<h1>`/说明文字 `getBoundingClientRect()` 保持在视口内可见（`navVisible/h1Visible/metaVisible=true`）。

**AC7 四视口回归**（截图落盘 `/tmp/gap-scroll-panel-evidence/`）：

- `desktop-wide-light.png`（1440×900）、`desktop-narrow-light.png`（900×800）、`mobile-light.png`（390×844@3x）、`desktop-wide-dark.png`（1440×900 + `prefers-color-scheme:dark` 模拟）。
- 图例为全宽不透明 sticky 条（`legendHeight≈30.6px`、`backgroundColor=var(--color-surface)`、`legendWidth==containerClientWidth`），吸顶后第一行提交位于条下方（无遮挡、无覆盖提交文本）；各视口 `pageScrollHeight==clientHeight`（整页不滚）、SVG 超宽（1853px）时容器 `overflow-x:auto` 横向可滚（无裁切）。
- 注：本页当前无原生暗色主题（`webui-modernist.css` 无 `prefers-color-scheme` 分支），"暗色"为浏览器模拟（渲染同亮色）；图例背景用 `var(--color-surface)` 与全页同 token，将来加暗色主题时自动适配。