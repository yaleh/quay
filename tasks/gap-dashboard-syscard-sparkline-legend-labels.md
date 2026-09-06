---
id: gap-dashboard-syscard-sparkline-legend-labels
title: Dashboard 系统资源卡 sparkline 补图例 + 端点/极值标注 + 时间跨度标签（不引入新依赖，复用已有手搓 SVG 手法）
status: ready
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

系统资源卡的折线图（`packages/quay/src/serve-dashboard.ts:298-380` 的 `renderDashboardCardRefreshScript`
内联客户端脚本，`renderSysCard` 里的 `#sys-sparkline` 容器）是纯客户端手搓的 min-max 归一化 sparkline：
两条 `<polyline>`（cpu_stall 用主题色、loadavg 用 `--color-positive-700`）画在一个裸
`viewBox="0 0 300 60"` 的 SVG 里。人用真实 MCP 浏览器核验后反馈"没有轴/刻度/标注，很难观察"。

在线调研（Sparklines.js / jQuery Sparkline / JSCharting Microcharts 等小型 sparkline 库，以及
Chart.js/uPlot/ApexCharts 等完整图表库、d3-axis）后确认：Edward Tufte 对 sparkline 的权威定义本身允许
"no axes, no labels"，但**要求搭配当前值和端点/极值标注**（"pair with the most recent numeric value"、
"endpoints often marked (min/max)"）——现在这版恰恰连这个最低要求都没做到：数值文字
（`renderSysCard` 里的 `cpu_stall X · loadavg Y`）和图形是分离的两行，图上完全看不出哪条线对应哪个指标、
看不出峰谷、也看不出采样跨度，这才是"很难观察"的真正原因。

方向选型（已排除的两条路，附理由）：
- **不引入任何新的 sparkline/图表库**：现有数据规模小（≤60 点、2 条线、纯客户端临时态，无持久化），
  够不上任何库的门槛；且真正专注小型 inline 图的库（Sparklines.js 等）设计哲学就是不画轴/不搭配标注，
  解决不了这次的核心诉求。
- **不复用项目里已有的 d3 依赖**（`/git-history` 页 `serve-git.ts:159-166` 自托管 `d3.min.js`，
  "零客户端 JS" 旧约束已因那次需求被人正式裁定推翻）：那次是为了一个需要缩放/折叠/多分支布局的交互式
  提交图，d3 的比例尺/力导向能力在那里才值回体积；给一个 60 点两条线的临时 sparkline 用 d3 纯属杀鸡用牛刀，
  且这张卡不需要 d3 真正擅长的能力。
- **采用的方向**：复用本文件里 `renderTimelineBarSvg`（G/H 分段时间轴）已经证明可行的手法——
  axis line + `<text>` 标签，纯手搓 SVG/DOM，零新依赖，和现有卡片视觉语言一致。

## Plan

1. **图例**：两条线各自加一个小色块 + 文字（`cpu_stall`/`loadavg`），解决"分不清哪条线是哪个指标"。
2. **端点/极值标注**：每条线标出最新值（右端 `<circle>` + `<text>`，取 `sysHistory` 最后一个非 null 值）
   和 min/max（Tufte 最低要求），而不是只归一化拉伸、什么数字都不露。
3. **时间跨度提示**：`sysHistory.push({cpu, load})` 目前完全不存时间戳，只有隐式的"第几次轮询"；
   改为 `sysHistory.push({cpu, load, ts: d.sysRaw.ts})`（`d.sysRaw.ts` 已经是 `/dashboard/cards`
   payload 里现成的字段，见 `handleDashboardCards`），仿照 `renderTimelineBarSvg` 左右两端 hh:mm
   标签的做法，在 sparkline 下方标出最早/最新采样点的实际时间。
4. **可选但价值更高的一项**：画一条淡色参考基线，用已经在读的 `sys.resourceGate.nproc`/
   `sys.resourceGate.loadThreshold` 标出"安全线在哪"——轴上的数字本身不会告诉你"多少算高"，
   阈值线会。若这两个字段在某次快照里为 null，参考线不画（absent-field 契约，不假设一个默认阈值）。
5. 保持"服务端零持久化"不变（`gap-dashboard-visual-review-batch-fixes` AC6 的既有约束）——本任务只改
   客户端渲染逻辑，不新增任何服务端写文件路径。

## Acceptance Criteria

- [ ] AC1（图例）：`renderDashboardCardRefreshScript()` 返回的脚本字符串里能 grep 到两条线各自的图例文案
      （`cpu_stall`、`loadavg`）与各自对应的颜色（复用 `renderSysCard` 里已定义的同一套颜色 token，
      不新起一套配色）。
- [ ] AC2（端点/极值标注）：构造一个固定 `sysHistory` 数组（已知的 min/max/最新值），驱动
      `redrawSparkline` 等价逻辑（脚本是纯字符串，测试用 jsdom-free 的方式验证生成的 SVG 片段模板/
      辅助函数的输出，或将标注计算逻辑抽成一个可被 Node 直接 `import` 的纯函数），断言输出含与固定输入
      精确对应的 min/max/最新值数字（不是模糊断言"有数字"）。
- [ ] AC3（时间跨度标签）：`sysHistory.push` 的调用点 grep 到 `ts:` 字段被写入；给定固定的
      `sysHistory`（含 ts），断言渲染出的时间跨度标签与最早/最新 ts 的格式化结果逐字对应。
- [ ] AC4（阈值参考线，若实现）：给定 `resourceGate.loadThreshold` 非 null 的 fixture，断言输出含一条
      对应位置的参考线元素；给定该字段为 null 的 fixture，断言不画（absent-field 契约，
      grep 不到虚构默认值）。
- [ ] AC5（零服务端持久化不回归）：`grep -n "fs\.\(write\|append\)FileSync\?" packages/quay/src/serve-dashboard.ts`
      在本次改动前后命中数一致（沿用 `gap-dashboard-visual-review-batch-fixes` AC6 同款判据）。
- [ ] AC6（真实回归）：`node --experimental-strip-types --test packages/quay/test/gap-dashboard-visual-review-batch-fixes.test.mjs`
      （或本任务新增的同名后续测试文件）exit 0，且用 MCP 浏览器截图核验一次：图例可辨认、min/max/最新值
      数字可见、时间跨度标签可见。

## Definition of Done

- 代码改动已合入 `develop`。
- `scripts/test.sh --for-task gap-dashboard-syscard-sparkline-legend-labels`（或等价 scoped 调用）绿。
- 手工用 MCP 浏览器刷新生产 dashboard 页确认：sysCard 折线图能看出哪条线是哪个指标、当前值/极值清晰、
  横轴时间跨度可辨认。
- `quay task check gap-dashboard-syscard-sparkline-legend-labels --json` 的 `missing` 为 `[]`。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-visual-review-batch-fixes.test.mjs
- tasks/gap-dashboard-syscard-sparkline-legend-labels.md
