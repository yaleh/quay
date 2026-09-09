---
id: gap-dashboard-workprogress-row-paired-columns
title: dashboard 工作进展行改配对两列((阶段目标+任务台账速览)|(测试+FAN-IN))，替代原等宽四列
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-dashboard-fanin-card-hide-reason
---
## Proposal

**依赖**：本任务假定 `gap-dashboard-fanin-card-hide-reason`（FAN-IN 卡片去掉 `mfi.reason`）已经落地——本任务的高度测量与平衡结论都是在"已去 reason"的 FAN-IN 卡片基础上得出的，若先落地本任务而 FAN-IN 仍显示全文 reason，测量结论不成立。

**现状**：`packages/quay/src/serve-dashboard.ts` 的"工作进展"行（阶段目标 / 任务台账速览 / 测试 / FAN-IN）用通用的 `gridColumns(4)`（`repeat(4, minmax(0,1fr))`）渲染成等宽四列，CSS Grid 默认 `stretch` 把四张卡片强制拉到同一行高。

**实测**（chrome-devtools 连生产 dashboard 只读核实，同一时刻冻结快照测量，避免 30s 自动刷新跨请求污染对比）：四卡在 215px 宽度下的自然内容高度——阶段目标 ~263px，测试 ~624px，任务台账速览 ~1684px，FAN-IN（已去 reason）~912-1215px（因记录内容而波动）。行高被 stretch 到最高者，导致阶段目标卡约 88%、测试卡约 71% 的面积是纯空白。

**人最初提出的方向（已验证，不成立）**：任务台账速览单独占左 50%，阶段目标+测试+FAN-IN 堆叠占右 50%。用 433px 半宽重新测量：左列 966px，右列（三卡堆叠）1543px——右列反而比左列高 577px（60%），因为三张独立卡片各自的固定开销（标题行+底部链接+上下 32px padding）累加起来，比"精简一张卡片的折行"能省下的更多。已用浏览器把这个布局临时渲染出来做过视觉复核（客户端本地 DOM 实验，未改动生产实例），确认任务台账速览列下方确实留出明显空白。

**改用的配对（人裁定采纳，本任务的实现目标）**：对四卡自然高度做穷举配对后，"任务台账速览+阶段目标"一组、"测试+FAN-IN"一组，在 433px 半宽下测得左列 1232px、右列 1261px——差距仅 29px（2.3%），是四选一里最平衡的分组，且语义上也说得通（左列=进度看板，右列=验证流水线）。已用浏览器把该布局临时渲染出来做过视觉复核：两列几乎等高，左列只在底部留极小空白。**人指定左列内部顺序：阶段目标在上，任务台账速览在下**（纵向堆叠的总高度与顺序无关，此前测量用的是相反顺序，但求和结果不受影响，结论仍然成立）；右列顺序为测试在上、FAN-IN 在下（沿用当前从左到右的原有顺序：阶段目标→测试→FAN-IN，只是把测试挪到 FAN-IN 上方与其同列堆叠）。

**诚实的提醒（写进 AC 判断标准，不得回避）**：29px 的精确平衡是**这一刻数据快照下的结果**，不是结构性保证。任务台账速览的自然高度实测在 966px~1684px 之间随 ready/todo/needs-human 各状态的条目数与标题长度浮动，FAN-IN、测试卡的高度也会随记录数/CI 结果波动——四张卡全是无上限的动态列表，不像顶部行的系统资源/DRIVER 那样内容相对固定。**这个配对是四选一里最不容易失衡的分组，不是"从此不会再有留白"的保证**；验收与后续观察都要按这个真实预期判断，不能因为某个时刻两列不完全等高就判定改动无效。

## AC

- [x] `packages/quay/src/serve-dashboard.ts` 的"工作进展"行改为 2 列等宽网格（`grid-template-columns:1fr 1fr` 或等价写法），左列内部用 `display:flex;flex-direction:column;gap:2px` 纵向堆叠 `[goalCard, taskCard]`（阶段目标在上、任务台账速览在下），右列纵向堆叠 `[testsCard, fanCard]`（测试在上、FAN-IN 在下）——不得继续复用 `gridColumns(n)`/`renderCardGrid` 的"列数=卡片数"通用逻辑渲染这一行（该行现在是 2 个 grid item，不是 4 个），顶部行（循环脉搏/系统资源/DRIVER，见 `gap-dashboard-top-row-asymmetric-columns`）与其它仍用等宽网格的行不得被这次改动牵连。
- [x] `dashboardGridStyles` 的 `≤600px` 单列折叠规则对这一行改动后仍然生效：移动端两个 grid item（左列/右列）各自变成整宽一列，列内部纵向排列不受影响——用真实浏览器视口收窄到 ≤600px 的复核验证。
- [x] 一次真实浏览器测量复核（本地临时 `quay serve` 实例，不得连接/改动生产 100.78.206.100:4173 实例）：落地后实测左列（阶段目标+任务台账速览）与右列（测试+FAN-IN）各自的自然高度，把实际读数（不是预先设定的阈值——本任务的 Proposal 已经说明这两个数会随内容波动，不设固定像素差阈值，按硬规则"成本结构未知/会随数据波动前不设数值阈值"）写进提交记录，作为"这次改动是否达到预期平衡"的证据，而不是仅凭肉眼一次截图判断。
- [x] 现有 dashboard 相关测试（`packages/quay/test/gap-dashboard-grid-autofit-columns-vs-card-count.test.mjs` 等覆盖 `renderDashboardPage`/`gridColumns` 的用例）全部通过，且不得因为这次改动误伤顶部行或其它仍用等宽网格渲染的行的断言。

## DoD

改动落地 develop：dashboard"工作进展"行改为 2 列布局，左列自上而下为阶段目标→任务台账速览，右列自上而下为测试→FAN-IN；有一次对本地临时 serve 实例的真实浏览器渲染复核（桌面宽度 + ≤600px 移动宽度各一次）+ 落地后的真实高度读数作为落地证据。验收时按 Proposal 里"这是四选一里最平衡的分组，不是永久零留白保证"的真实预期判断。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-grid-autofit-columns-vs-card-count.test.mjs
- tasks/gap-dashboard-workprogress-row-paired-columns.md
