---
id: gap-goal-card-id-flex-squeeze-by-long-staleness-label
title: dashboard 阶段目标卡片：长三态标签(NOT-EVALUATED)把 GOAL id 挤压截断
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**根因**：`packages/quay/src/serve-dashboard.ts` 的 `renderGoalCard`（约第 776-788 行）里，每条 active GOAL 一行，行内 id 链接（如 `GOAL-011`）与三态陈旧标记（`fresh`/`stale`/`NOT-EVALUATED`）共享一个 `display:flex;justify-content:space-between` 的行。id 的 `<a>` 带了 `overflow:hidden;text-overflow:ellipsis;white-space:nowrap`；按 CSS flexbox 规范，`overflow` 设为非 `visible` 会把该 flex 子项的"自动最小宽度"归零，使它可以被同一行内 `flex:none`（永不收缩）的三态标记兄弟无限挤压。短标记（`fresh`，5 字符）从未挤出问题；但 `NOT-EVALUATED`（13 字符、粗体）会把 id 链接压缩到远小于其内容宽度，导致长 id 被省略号截断——例如 `GOAL-011` 视觉上只剩 `GOAL-0…`，用户读起来就是"这个 GOAL 的编号没有显示"。

**实测证据**（chrome-devtools 连生产 dashboard `http://100.78.206.100:4173/dashboard` 只读核实，未改动生产实例）：配 `fresh` 的行，id `<a>` 的 `clientWidth` 等于其 `scrollWidth`（63px，完整显示）；配 `NOT-EVALUATED` 的行，同一 id `<a>` 的 `clientWidth` 被压到 30px（`scrollWidth` 仍是 63px）——截图确认渲染结果确实是 `GOAL-0…`。

**这不是孤立事故**：repo 里同一个"`flex:none` 兄弟 + `overflow:hidden`/ellipsis 兄弟"反模式已经复现过三次——`gap-dashboard-minilist-row-layout`（taskCard miniList，改成纵向多要素布局修复）、`gap-dashboard-cards-layout-and-livecard-swimlane`（renderLiveCard 的 in-flight 行，改法是给 taskId `<a>` 补 `min-width:0`，该行现在是 `serve-dashboard.ts:85`）、以及本次 `renderGoalCard`（`serve-dashboard.ts:783`）。已用 grep 核实：全仓库只有 `serve-dashboard.ts` 同时出现 `flex:none` 与 ellipsis 截断组合共 3 处——`:85`（已被前一个任务修复，带 `min-width:0` 防护，安全）、`:786`（goal-card 的 title 行，是纵向 column 布局里的独立 block，不与 `flex:none` 兄弟共享一行，不构成本 bug）、`:783`（本任务要修的活 bug）。其余 `serve-*.ts` 文件里没有同时出现两者的文件；`serve-goal.ts:113` 的 ellipsis 用在 `table-layout:fixed` 的表格单元格上，走的是表格列宽机制而非 flex-shrink 竞争，不受影响。**结论：本次只需修 `:783` 这一处，不需要扩大 Touches 范围**，但下一个任务/评审者若再看到这个反模式复现（这将是第 4 次），应该考虑补一个 grep 型静态检查（本仓库其它同类反模式都是靠事后 grep 发现，从未有机械检测器）。

**修法**（已验证，来源：一次已撤回的 GitHub PR 里跑过测试+截图确认，因用户裁定改走任务体机制而撤回，非任务已完成的证据）：
```diff
-      <div style="display:flex;justify-content:space-between;gap:0.5rem">
-        <a href="/goal/${encodeURIComponent(gid)}" style="color:var(--color-text);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(gid)}</a>
+      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:0.5rem;flex-wrap:wrap">
+        <a href="/goal/${encodeURIComponent(gid)}" style="color:var(--color-text);text-decoration:none;flex:none">${escapeHtml(gid)}</a>
         <span style="flex:none;color:${stalenessColor(state)};font-weight:700">${escapeHtml(state)}</span>
       </div>
```
给 id 的 `<a>` 加 `flex:none`（永不收缩，去掉不再需要的 overflow:hidden/ellipsis/nowrap 三个属性），给外层行加 `flex-wrap:wrap`（放不下时三态标记自己换到下一行，不再挤占 id 的宽度）。

## AC

- [x] `packages/quay/src/serve-dashboard.ts` 里 `renderGoalCard` 的 id 行模板：id `<a>` 的 style 属性含 `flex:none` 且不含 `overflow:hidden`（`grep -n 'flex:none' packages/quay/src/serve-dashboard.ts` 命中的是 id 这一行，且该行不再出现 `overflow:hidden;text-overflow:ellipsis;white-space:nowrap`）；外层行的 style 属性含 `flex-wrap:wrap`。
- [x] `packages/quay/test/gap-dashboard-goal-card-provider-backed.test.mjs` 现有 7 个测试全部通过（`node --experimental-strip-types --test packages/quay/test/gap-dashboard-goal-card-provider-backed.test.mjs` exit 0）——这条必要但不充分，因为现有测试只做文本正则断言，测不出 flex 挤压问题，故需要下一条。
- [x] 在该测试文件里新增至少一条布局回归断言：构造一个 8 字符 GOAL id + 零 AC（触发 `NOT-EVALUATED`，13 字符的最长三态标签），断言 `renderGoalCard()` 输出里该 id 对应的 `<a>` 标签的 style 属性字符串含 `flex:none` 且不含 `overflow:hidden`（纯字符串/正则断言即可，不需要起浏览器）——这是本次要补的回归覆盖，不是重跑现有测试。
- [x] 一次真实浏览器视觉复核：起一个本地临时 `quay serve` 实例（不得连接/改动生产 100.78.206.100:4173 实例），用 chrome-devtools 或 playwright 截图/量宽验证一个 `NOT-EVALUATED` 状态、8 字符 id 的 GOAL 行，id 完整显示不被省略号截断。
- [x] 已用 grep 复核 `packages/quay/src/serve*.ts` 全部文件，确认除 `:783` 外没有其它"`flex:none` 兄弟 + `overflow:hidden`/ellipsis 兄弟"活跃反模式实例（把 grep 命令与命中结果贴进任务/提交记录，而不是只下结论）。

## DoD

改动落地 develop：`renderGoalCard` 的行模板按上述 diff（或等价修法）修改，`gap-dashboard-goal-card-provider-backed.test.mjs` 新增的布局断言与其余 6 条一并通过，dashboard 上任意 GOAL（含未来新建、零 AC、NOT-EVALUATED 状态的 GOAL）的 id 在配长三态标签时不再被截断——不是"测试绿"就算数，是有一次对本地临时 serve 实例的真实浏览器渲染复核作为落地证据（截图或量宽读数附在提交/任务记录里）。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-goal-card-provider-backed.test.mjs
- tasks/gap-goal-card-id-flex-squeeze-by-long-staleness-label.md
