---
id: gap-dashboard-top-row-asymmetric-columns
title: dashboard 顶部行改非对称分栏(3fr:2fr)：循环脉搏加宽，系统资源+DRIVER 堆叠减少留白
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现状**：`packages/quay/src/serve-dashboard.ts:999` 的顶部行 `renderCardGrid([liveCard, sysCard, mgrCard], {marginBottom:true})` 用通用的 `gridColumns(3)`（`repeat(3, minmax(0,1fr))`）渲染成等宽三列，CSS Grid 默认 `align-items:stretch` 把三张卡片强制拉到同一行高。

**实测**（chrome-devtools 连生产 dashboard `http://100.78.206.100:4173/dashboard` 只读核实；用同一时刻的冻结 HTML 快照 + 在真实 DOM 里插入等价宽度的克隆节点重新量高度，避免跨请求的 30s 自动刷新数据变化污染对比）：三卡在各自 287px 宽度下的自然内容高度——循环脉搏 ~541px，系统资源 ~295px，DRIVER ~279px。行高被 stretch 到循环脉搏的高度，导致系统资源约 45%（~246px）、DRIVER 约 48%（~262px）的卡片面积是纯空白。同时，循环脉搏在窄列下折行严重：实测一条任务描述在 287px 宽度下折成 8 行，是撑高该卡片的主因。

**人提出的改进方向（已用真实浏览器验证过，基本成立但有一处需要修正预期）**：把顶部行改成非对称两列——循环脉搏占宽列（约 60%/3fr），系统资源与 DRIVER 堆叠占窄列（约 40%/2fr）。用同一份冻结快照把两列的真实宽度（519px / 346px）代入重新测量：循环脉搏在 519px 下自然高度降到 ~442px；系统资源+DRIVER 堆叠在 346px 列里合计 ~557px——**右列反而比左列高约 115px（约 26%）**，不是「恰好匹配」，因为堆叠两张独立卡片各自的固定开销（标题行+底部链接+上下 32px padding）之和，天然比"精简一张卡片的折行"能省下的更多。已用浏览器把这个布局临时渲染出来做过视觉复核（客户端本地 DOM 实验，未改动生产实例）：循环脉搏的折行问题明显缓解（长描述基本收到 1-3 行），但循环脉搏卡片下方出现了一段新的空白（因为整行高度改由更高的右列决定，循环脉搏被拉伸补齐）。

**结论**：非对称分栏仍是净改善——两处分散的大留白（45%+48%）收敛成一处较小的留白（约 26%，且集中在一张卡而不是两张），循环脉搏的折行问题被实质缓解——但不要把它包装成"完全消除留白"，验收时按这个更真实的预期判断，不要因为仍有残留空白就判定改动无效。

## AC

- [x] `packages/quay/src/serve-dashboard.ts` 顶部行改为 2 列非对称网格（`grid-template-columns:minmax(0,3fr) minmax(0,2fr)` 或等价比例），第 2 列内部用 `display:flex;flex-direction:column;gap:2px` 把 `sysCard` 与 `mgrCard` 纵向堆叠成一个 grid item（不是继续复用 `gridColumns(n)`/`renderCardGrid` 的等宽通用逻辑，因为该行需要固定 3:2 比例，其余行——如 4 卡的「工作进展」行——仍应继续使用现有的等宽 `gridColumns`，不得被这次改动牵连）。
- [x] `dashboardGridStyles` 的 `≤600px` 单列折叠规则（`.dash-grid { grid-template-columns:minmax(0,1fr) !important; }`）在改动后仍然生效：移动端顶部行两个 grid item（循环脉搏 / 堆叠列）各自变成整宽一列，堆叠列内部纵向排列不受影响——用一次真实浏览器视口收窄到 ≤600px 的复核验证，不能只看桌面宽度。
- [x] 一次真实浏览器视觉复核（本地临时 `quay serve` 实例，不得连接/改动生产 100.78.206.100:4173 实例）：截图确认循环脉搏在新宽度下的长任务描述折行行数明显减少（对照修改前的截图或量宽读数）。
- [x] 现有 dashboard 相关测试（`packages/quay/test/gap-dashboard-*.test.mjs` 里覆盖 `renderDashboardPage`/`renderCardGrid`/`gridColumns` 的用例）全部通过，且不得因为这次改动误伤其它行（4 卡「工作进展」行）的等宽渲染——若现有测试对列数/`grid-template-columns` 有精确断言，需要确认这次改动只影响顶部行对应的断言，其余行的断言不变。

## DoD

改动落地 develop：dashboard 顶部行（循环脉搏 / 系统资源 / DRIVER）改为 3:2 非对称两列布局，系统资源与 DRIVER 纵向堆叠在右列；有一次对本地临时 serve 实例的真实浏览器渲染复核（桌面宽度 + ≤600px 移动宽度各一次）作为落地证据，而不是仅凭"测试绿"判定完成。验收时按 Proposal 里"净改善但仍有残留空白"的真实预期判断，不要求视觉上完全零留白。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-grid-autofit-columns-vs-card-count.test.mjs（既有 `gridColumns`/`renderCardGrid` 等宽不变式测试，须确认顶部行新增的非对称写法不与它冲突，或新增一条覆盖非对称行为的用例）
- tasks/gap-dashboard-top-row-asymmetric-columns.md
