---
id: gap-git-graph-stride-chip-overlaps-commit-row-text
title: git-history 的 stride chip 与提交行文字共用文本列 x、y 相差不足一行高 ⇒ 25 个 chip 逐个压住同行提交
  subject，与已修的折叠控件压字同源
status: ready
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-git-graph-ref-partition-collapses-all-topology-to-one-lane
---
## Proposal

**实测（2026-09-08，干净实例 `127.0.0.1:4180`，截图 `git-now-single-lane.png`）**：`gap-git-graph-lane-chip-rendered-once-regardless-of-span`（done）的 stride chip **功能达成但与提交文字重叠**。

- 功能侧达成：`develop` chip 每约 **519px** 重复一次，13022px 的图上共 **25 个**，任意滚动位置附近都能看到标签。✅
- 缺陷：chip 画在与提交行**相同的文本列 x**、且 y 只差个位像素 ⇒ **压住同行/邻行的提交文字**。实测样本：chip 位于 y≈481，其下 y≈490 的提交行 `2067dc3 tasks: 翻 gap-webui-a11y-focus-ring-and-token-contrast-unvalidated done（driver 机械 fan-in）` 前段被 chip 遮住，读不全。

**同源**：这与已 done 的 `gap-git-graph-fold-control-lands-offscreen-and-row-hit-zone-dead` 中修过的「折叠控件 chip 压住主干文字」**同类同源**——都是 chip 与文本列共用 x、y 相差不足一行高。区别只在这次由 stride 重复引入，**出现 25 次而非 1 次**，且会随 `gap-git-graph-ref-partition-collapses-all-topology-to-one-lane` 恢复多泳道后进一步增多。

**期望**（两条路线取一）：① chip 占据**自己的行**——在 stride 位置插入一个专用 label 行，提交行整体下移一行；② chip 与提交文字**水平错开**——chip 画在文本列左侧的独立轨道（如 laneX 与 textX 之间的留白带）。任一路线都必须使 chip 与提交 `<text>` 的 bbox 交集为空。

**依赖**：`gap-git-graph-ref-partition-collapses-all-topology-to-one-lane` 会恢复多条泳道、显著改变行与泳道的布局，本任务应在其之后实现，避免在即将重排的布局上返工。

## AC

- [ ] AC1 bbox 不相交：渲染后对每个 chip 与其邻近 ±1 行的提交 `<text>` 求 bbox 交集，**相交对数 = 0**：`node --test packages/quay/test/gap-git-graph-stride-chip-overlaps-commit-row-text.test.mjs` 退出码 0。
- [ ] AC2 负控制：测试内把 chip 的 x/y 摆回与提交文字同列同行，断言相交对数 **> 0** ⇒ 判据能取假，不是恒真。
- [ ] AC3 不许用「删掉 chip」来消除重叠：chip 数仍 = `ceil(该泳道行跨度 / strideRows)`，与 `gap-git-graph-lane-chip-rendered-once-regardless-of-span` 的既有 AC 一致（该任务的测试须继续通过）。
- [ ] AC4 提交文字未被截断：被 chip 相邻的提交行，其 `<text>` 的 `getComputedTextLength()` 与不相邻的同长度提交行一致（chip 不通过缩短文字来避让）。
- [ ] AC5 生产读数：`/git-history` 真实页面上，chip 与提交文字的相交对数 = 0（当前 > 0）。

## DoD

生产 `/git-history` 页面滚动到顶部/中部/底部任意位置，chip 都清晰可读且**不遮挡任何提交 subject**——以一次 Playwright bbox 求交读数（相交对数 = 0）加一张截图为证，不以单测通过替代。把 chip 摆回原位会让 AC1/AC5 变红。

## Touches

- packages/quay/src/serve-git.ts（stride chip 的 x/y 布局，或为其分配独立 label 行）
- packages/quay/test/gap-git-graph-stride-chip-overlaps-commit-row-text.test.mjs（本任务的回归测试）
- packages/quay/test/gap-git-graph-lane-chip-rendered-once-regardless-of-span.test.mjs（stride 计数用例，布局改动后需同步更新）
- tasks/gap-git-graph-stride-chip-overlaps-commit-row-text.md
