---
id: gap-dashboard-grid-autofit-columns-vs-card-count
title: dashboard 用 auto-fit 由容器宽度派生列数、与卡片数无任何约束，870px 容器只开出 3 列而「工作进展」放了 4 张卡 ⇒
  第 4 张换行、右侧 2 格露出 divider 底色成大片深灰空洞
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
**type:** execution

## Proposal

**现象（2026-09-08 对生产实例 `/dashboard` 1440×900 实测截图 + computed style，非目测）**：
「工作进展」那一行的右侧有一大块**深灰色空洞**，占该行约 2/3 宽、高度与 fan-in 卡等高，看上去像渲染失败。

**取证（读 computed grid，不是从截图推断）**：页面上三个 grid 的实测 `gridTemplateColumns` 与子元素数——

- 第 1 行（循环脉搏/系统资源/Manager）：`287.3px 287.3px 287.3px`，**3 列 3 卡** ⇒ 正常
- 第 2 行（阶段目标/任务台账/测试/Fan-in）：`287.3px 287.3px 287.3px`，**3 列 4 卡** ⇒ 第 4 张换行独占一行，
  该行剩余 2 格没有子元素 ⇒ 露出容器自身的 `background: var(--color-divider)`（深灰）
- 第 3 行（最近提交/Git History）：`432px 432px 0px`，**3 列 2 卡**，尾随一个 0px 空列

**根因（精确到既有任务的一行）**：三行 grid 都写作
`repeat(auto-fit, minmax(240px, 1fr))`（`packages/quay/src/serve-dashboard.ts:864 / :866 / :868`）。
`auto-fit` 的列数由**容器宽度**派生：`<main>` 实测 870px，`floor(870 / 240) = 3` ⇒ 恒为 3 列，
**与放几张卡毫无关系**。而 `tasks/gap-dashboard-fanin-panel-and-timeline-bars.md:72` 在加入第 4 张卡时
逐字写的是「新卡片加入『工作进展』那一行网格（`repeat(auto-fit,minmax(240px,1fr))` **会自动重排，
不需要改网格结构**）」——**这个假设在 870px 容器下不成立**，而当时没有任何判据去验证它。

**机制归纳**：**列数由一个外生量（容器宽度）派生，卡片数由另一处代码决定，两者之间没有任何约束**；
加卡的人看不到它会不会整除，加了也不会有任何检查报出来。灰色空洞不是「配色问题」，
而是这个缺失约束的**可见投影**——divider 底色本来只该从卡片缝隙里透出 2px。

**修法方向（择一，都要能被 AC 取假）**：

1. 让列数与卡片数对齐——`minmax()` 下限按该行卡片数反推（4 卡时 200px 即可在 870px 下开 4 列），或直接
   `repeat(N, 1fr)` 由卡片数生成；
2. 或让最后一行的空槽不露底——把 divider 背景从容器移到卡片的 border/gap 上（`gap` + 卡片自带边框），
   这样列数与卡片数不整除时也只是留白而非深灰块。

无论选哪条，**都必须补一个「任何一行 grid 的空槽数 == 0，或空槽不呈现 divider 底色」的判据**，
否则下一次加卡会原样复发（硬规则 5b）。

## Acceptance Criteria

- [x] AC1 生产载体读数：加载 `/dashboard`（1440 宽），对每个 grid 容器算
      `列数 × 行数 − 子元素数` 得到空槽数，断言**每个 grid 的空槽数 == 0**。
      取假：改动前「工作进展」行实测 3 列 4 卡 ⇒ 空槽 2，第 3 行 3 列 2 卡 ⇒ 空槽 1。
      断言失败时打印每个 grid 的 `(列数, 卡片数, 空槽数)` 三元组，不只报布尔。
- [x] AC2 与卡片数绑定（能取假的结构判据）：单测对渲染函数传入 3 / 4 / 5 张卡三种输入，断言算出的
      `gridTemplateColumns` 列数分别 == 3 / 4 / 5。当前实现对三种输入都返回同一个模板串 ⇒ 必须报红。
- [x] AC3 多视口枚举而非单点：在 1440 / 1024 / 768 / 390 四个视口各测一次 AC1，断言四个视口下空槽数**全部** == 0；
      打印四个视口的三元组清单。
- [x] AC4 深灰不再作为空槽的呈现：断言 `/dashboard` 上不存在「面积 > 20000px² 且背景等于 `--color-divider`
      解析值」的可见矩形区域。取假：改动前该区域实测存在。
- [x] AC5 `bash scripts/test.sh --for-task gap-dashboard-grid-autofit-columns-vs-card-count` 退出码 0。

## Definition of Done

在**真实运行的实例**上截 `/dashboard` 全页图，四张卡在「工作进展」一行内齐平排布、右侧无深灰空洞；
改动前后截图并列 + AC1 的前后三元组对照贴进提交信息。**单测绿不算达成**——
`gap-dashboard-fanin-panel-and-timeline-bars` 当初正是在没有这类判据的情况下判 done 的。

## Touches

- `packages/quay/src/serve-dashboard.ts`
- `packages/quay/test/gap-dashboard-grid-autofit-columns-vs-card-count.test.mjs`
- `tasks/gap-dashboard-grid-autofit-columns-vs-card-count.md`
