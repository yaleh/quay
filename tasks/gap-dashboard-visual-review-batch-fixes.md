---
id: gap-dashboard-visual-review-batch-fixes
title: Dashboard 六项改进：Manager 卡假零 bug + 循环脉搏耗时 + 任务台账分组标题视觉权重 + 测试近期列表 + 自动刷新扩展
  + 系统资源前端折线（服务端零持久化）
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

背景：2026-09-05 人工走查 quay web dashboard（`http://<host>/dashboard`，浏览器截图 + 源码交叉核对
`packages/quay/src/serve-dashboard.ts`/`observation.ts`/`serve-system.ts`）产出六项改进，人已确认范围、
要求一起排进一个方案。逐条列出发现 + 证据（避免下游重新推导一遍）：

1. **【正确性 bug】Manager / Outer / Inner 卡片"N 会话 LIVE"是结构性假零**——`readManagerLight`/
   `readManager`（`observation.ts:2929`,`:2949`）自 2026-09-03 起把 `liveness` 恒定标注
   `status:"empty", reason:"liveness observer retired 2026-09-03", sessions:[]`；但
   `renderDashboardPage` 渲染 mgrCard 时（`serve-dashboard.ts:169`）
   `const mgrAlive = d.mgr.liveness.sessions.filter(s=>s.alive).length` 从不检查 `status`，把"这个
   指标已退役、从未测量"渲染成了和"当前真的 0 个会话存活"肉眼无法分辨的"0 会话 LIVE"。对照：同一字段
   在 `/manager` 详情页（`serve-system.ts:81,120`）通过 `obsNote(status, reason)` 正确地把 retired
   原因显示出来——只有 dashboard 摘要卡这一处漏了这层守卫，与本仓库 CLAUDE.md 硬规则 3b/4b（恒零的量
   不得和"一切正常"同形）直接冲突。
2. **循环脉搏卡缺在飞任务耗时**——`InFlightTask` 已带 `startedAtMs`，`renderTestsCard` 里已有可复用的
   `formatSuiteElapsed(startedAt, nowMs)` 纯函数格式化出"XmYs"耗时，但 `renderLiveCard`
   （`serve-dashboard.ts:40-63`）的 `liveMiniList` 只打印 taskId + 阶段标签，没有耗时列。
3. **任务台账速览分组标题不如任务 ID 醒目**——`miniList()`（`serve-dashboard.ts:196-214`）里状态分组
   标题（如"ready（最近 3 条）"）是 `font-size:0.7rem;color:var(--color-neutral-700)`（灰、无强调），
   任务 id 却是 `font-weight:600;color:var(--color-accent)`（粗、红）——视觉权重与信息层级（分组维度
   本应更显眼）刚好相反。注：本改动只动分组标题这一行的样式，不重新引入 `gap-dashboard-minilist-row-
   layout` 已裁定移除的行内 status 标签（人 2026-09-02 裁定省略行内 status，方案B）。
4. **测试卡缺近期已完成测试的可读列表**——`TestRunRecord`（`observation.ts`）本就带
   `round/state/pass/tests/durationMs`，`renderTestsCard`（`serve-dashboard.ts:74-108`）现有的
   "近 N 轮"只是一条 hover 才有 tooltip 的色块，没有默认可见、可读的"轮次+结果+耗时"列表。
5. **自动刷新只覆盖两张卡，其余卡片是请求时快照**——`renderDashboardCardRefreshScript` +
   `/dashboard/cards` 端点（`serve-dashboard.ts:110-147`,`:339-360`）只重渲染 `live-card`/
   `tests-card`；系统资源（sysCard）、Manager/Outer/Inner（mgrCard）、任务台账（taskCard）三张卡片没
   有走这条轮询链路，必须手工刷新整页才更新。commitsCard/Git History 卡片变更频率天然低（靠提交触发
   不靠时间），不计入本次扩展范围。
6. **系统资源卡无可视化负载历史**——`readSystem`（`observation.ts:2669`）每次都是现查
   `resource-gate.sh --json` 的一次性快照，仓库里没有任何常驻的系统负载时间序列落盘（唯一采样器
   `plugin/scripts/suite-load-sampler.ts` 只在跑全量测试期间临时采样，不是本卡片可用的数据源）。人
   2026-09-05 裁定简化方案：**服务端不新增任何持久化历史**，只在 `/dashboard/cards` 轮询响应里带上
   当次的原始数值（`cpuStallAvg10`/`loadAvg`/时间戳）；前端 JS 在内存里维护一个有界数组，每次轮询
   push 一条、超出窗口丢最老的，并用这个数组重绘一段内联折线——刷新页面/关闭标签页历史即清零，这是
   简化方案的已知取舍，不是缺陷。

## Plan

1. `serve-dashboard.ts` `renderLiveCard`：在 `liveMiniList` 每行加一段耗时文本，复用
   `formatSuiteElapsed`（同文件内已导出的纯函数，直接调用，不重新实现一遍耗时格式化）。
2. `serve-dashboard.ts` mgrCard：渲染前先判 `d.mgr.liveness.status`——`"ok"` 时才计算并显示
   `${mgrAlive} 会话 LIVE`；非 `"ok"`（含当前恒定的 `"empty"`）时该分句改显示"会话数未接入"（不给
   数字），与 `loopDriver.verdict ?? "未接入"` 的既有 fail-honest 手法保持一致。
3. `serve-dashboard.ts` `miniList()`：分组标题（如"ready（最近 3 条）"）改用行内 style 做成带背景色
   的小 pill（沿用本文件其余卡片一律用行内 style、不新增全局 CSS class 的既有手法），`font-weight`
   提到 ≥600；同一行内任务 id 的 `font-weight` 从 600 降下来（如 500 或改用非 accent 的正文色），
   确保分组标题的视觉优先级严格高于任务 id。
4. `serve-dashboard.ts` `renderTestsCard`：在既有"近 N 轮"色块条下方新增一个可读列表（排版复用
   `miniList` 同款纵向多要素手法），对 `recentRuns` 中 `state` 非当前运行中的每一轮渲染
   `#轮次 state · pass X/Y · 耗时`。耗时格式化允许新增一个纯函数（如 `formatDurationMs(ms)`），但必须
   与 `formatSuiteElapsed` 共享同一段取模换算逻辑（h/m/s 拆分），不重复写一遍。
5. `/dashboard/cards` 端点（`handleDashboardCards`）+ 轮询脚本（`renderDashboardCardRefreshScript`）：
   端点新增 `sysCard`（复用第 2/6 步改过的 sysCard 渲染）、`mgrCard`（复用第 2 步改过的渲染）、
   `taskCard`（复用第 3 步改过的渲染）三个字段；`renderDashboardPage` 给这三张卡各自容器加
   `id="sys-card"`/`id="mgr-card"`/`id="task-card"`（仿照现有 `live-card`/`tests-card`）；轮询脚本对
   这三个新 id 做同样的 `innerHTML` 替换。
6. `serve-dashboard.ts` sysCard + 轮询脚本：`/dashboard/cards` 的 JSON 载荷里，sysCard 之外再带一组
   原始数值 `sysRaw:{cpuStallAvg10, loadAvg, ts}`（`ts` 用服务端 `Date.now()`，不是客户端本地时间）；
   sysCard 渲染里加一个空的 `<svg id="sys-sparkline">` 占位容器；轮询脚本收到 `sysRaw` 后把它 push 进
   一个模块级闭包数组、超过 60 条（约 30 分钟窗口，按 30s 一次轮询折算）丢最老的一条，再用这个数组重绘
   `#sys-sparkline` 内的两条 `<polyline>`（cpu_stall 与 loadavg，复用已有的 `.load-svg-line` 手法，不
   发明新样式）；数组不足 2 个点时渲染空态而非报错。本步骤不得在 `serve-dashboard.ts`/`observation.ts`
   里新增任何 `fs.writeFile`/`fs.appendFile` 调用或新的 `.quay/*.jsonl` 路径——服务端零持久化。

## Acceptance Criteria

- [x] AC1（bug 修复）：`d.mgr.liveness.status !== "ok"` 时，mgrCard 渲染输出不包含形如
      `\d+\s*会话\s*LIVE` 的文本，而是一个明确的"未接入"式短语——单测对
      `liveness:{status:"empty",sessions:[],reason:...}` 断言渲染 HTML 不匹配该正则。
- [x] AC2（循环脉搏耗时）：`renderLiveCard` 对一个 `startedAtMs` 已知、`nowMs` 固定的
      `InFlightTask`，输出的 `liveMiniList` 行内包含耗时格式化函数产出的时长字符串（如
      `12m34s`）——单测用固定 `startedAtMs`/`nowMs` 断言字符串命中。
- [x] AC3（分组标题视觉权重）：`grep -n "font-weight" packages/quay/src/serve-dashboard.ts` 命中里，
      `miniList()` 函数体内分组标题所在 `<div>` 的 `font-weight` 取值 ≥600，且同一函数内任务 id 所在
      `<a>` 的 `font-weight` 取值严格小于分组标题的取值。
- [x] AC4（测试近期列表）：`renderTestsCard` 对至少 2 条 `recentRuns`（`state` 非 running）的固定输入，
      渲染 HTML 同时包含轮次号、`pass X/Y` 文本与一个耗时字符串——单测断言三类子串均出现且顺序与各自
      round 对应。
- [x] AC5（自动刷新扩展）：`handleDashboardCards` 返回 JSON 的 `Object.keys(...)` 同时包含
      `liveCard`/`testsCard`（既有）与新增的 `sysCard`/`mgrCard`/`taskCard` 五个键；
      `renderDashboardPage` 输出的 HTML 里 `grep` 能命中 `id="sys-card"`、`id="mgr-card"`、
      `id="task-card"` 三个新容器 id。
- [x] AC6（前端折线，服务端零持久化）：①`handleDashboardCards` 返回 JSON 含
      `sysRaw:{cpuStallAvg10,loadAvg,ts}` 三个字段；②`grep -n "sys-sparkline"
      packages/quay/src/serve-dashboard.ts` 命中渲染占位 + 轮询脚本里的数组 push/重绘逻辑两处（不是
      只有一处静态占位）；③`grep -n "fs\.\(write\|append\)File" packages/quay/src/serve-dashboard.ts`
      命中 0 处（本任务不得为折线功能引入任何服务端文件写入）。

## Definition of Done

六项改动全部落地 develop，`scripts/test.sh --for-task gap-dashboard-visual-review-batch-fixes` 绿（或
等价 scoped 跑法）。浏览器手工核验：①Manager 卡在 liveness 恒空的当前生产状态下不再显示裸数字；
②循环脉搏卡的在飞任务行有耗时；③任务台账速览的分组标题比任务 id 更醒目；④测试卡能看到近期几轮的
结果 + 耗时，不用 hover；⑤打开 dashboard 停留 ≥60s 不刷新整页，能观察到系统资源/Manager/任务台账三
张卡的数字随生产状态变化自动更新；⑥系统资源卡的折线随页面停留时间增长逐渐画出多个点，刷新页面后
折线清零（记录为已知取舍，不是缺陷）。AC1-6 全部勾选，`node packages/quay/bin/quay.ts task check
gap-dashboard-visual-review-batch-fixes --json` 的 `missing` 为空。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/src/serve-handlers.ts
- packages/quay/test/gap-dashboard-visual-review-batch-fixes.test.mjs
- tasks/gap-dashboard-visual-review-batch-fixes.md
