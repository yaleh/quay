---
id: gap-webui-goal-list-prune-low-signal-columns
title: /goal 列表去掉零信息列并压缩首屏：Criteria 页 criterion 列（服务端截 60 字符后又被 CSS 截到约 10
  字符）、recent verdict 被截掉有用的时间、first evidence 并入 last progress、可点链接不可辨认、决策横幅占首屏约
  200px
status: todo
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（人 2026-09-24 走查生产 `/goal`，1440px 截图）**：
1. Criteria 页签 `criterion` 列内容是 shell 命令：`serve-goal.ts:313` 先 `slice(0,60)` 再被 CSS 截，可见仅 `node -…` / `python…` 约 10 字符，零信息量，却占 11% 宽度。
2. `recent verdict` 单元格显示 `pass · 2026-…`——被截掉的恰是有用的时间部分，可见的年份前缀无用。
3. Goals 页签 `last progress`（`10s ago`）与 `first evidence`（`9d ago`）都是短文本，却合占约 31% 宽度。
4. `AC 达成`（`7/8`）与 `挂靠任务`（`18 (do…`）两列是链接，但与 id 链接同为红色无差别，点击目标不可辨认。
5. 页首「N GOAL / N AC awaiting a decision」两段横幅占首屏约 200px，表格被压到下方。

<!-- dedup-ref -->本任务只改列集合与单元格内容；列宽/换行/放宽 main 的机制归 `gap-webui-goal-list-full-id-status-title-and-real-width-ac`。两任务改同一文件里的同一表格渲染函数，Touches 有交集，由调度串行处理即可，内容上互不依赖。

**方案**：
a) Criteria 页签删 `criterion` 列；全文本来就在详情页 `/goal/<id>`，删列不丢信息（AC 里守住这一点）。
b) `recent verdict` 单元格改为「判定徽标 + 相对时间」，绝对时间放 `title` 属性；无 verdict 的行保持既有取值不变（硬规则 3b，不与「pass」同形）。
c) Goals 页签 `first evidence` 并入 `last progress` 单元格（形如 `10s ago · since 9d`，词条走 serve-i18n），两个绝对时间戳放 `title`；列数 7→6。缺值显示既有 not-recorded 文案，不显示空（硬规则 6）。
d) `AC 达成` 与 `挂靠任务` 两列用与 id 不同的链接样式（常显下划线 + 等宽数字），使其可辨为链接。
e) 决策横幅折叠成一行摘要（如 `2 GOAL · 7 AC awaiting a decision →`），两个跳转链接保留、href 逐字不变。

## AC

- [ ] `node --experimental-strip-types --test packages/quay/test/gap-webui-goal-list-prune-low-signal-columns.test.mjs` exit 0：`/goal?kind=criterion` 表头不含 `criterion`、列数 = 7；`/goal/<某 AC id>` 详情页仍含该 AC 的完整 criterion 全文（守住「信息没丢」）。
- [ ] 同一测试：Goals 页签表头不含 `first evidence`、列数 = 6；`last progress` 单元格可见文本同时含相对时间与首证据相对时间，`title` 属性含两个绝对时间戳；firstEvidenceAt 缺值的行显示 not-recorded 文案而非空单元格（先打印前 3 行实际内容再引用计数）。
- [ ] 同一测试：verdict 单元格可见文本不含 4 位年份前缀，绝对时间在 `title`；无 verdict 的行取值与改前逐字相同（未评估态仍与 pass 可区分）。
- [ ] 同一测试：GOAL 与 AC 两类待决同时存在时，横幅可见文本为单行摘要，仍含指向 drafts 与另一页签的两个链接，href 与改前逐字相同。
- [ ] 同一测试在 zh 与 en 两种语言下各跑一遍，新增文案全部走 serve-i18n 词条（不硬编码英文串）：`node --experimental-strip-types --test packages/quay/test/serve-goal-body-i18n.test.mjs packages/quay/test/serve-goal-zh-chrome.test.mjs packages/quay/test/gap-webui-goal-list-tab-split-goal-ac.test.mjs packages/quay/test/gap-webui-goal-list-sort-and-column-set.test.mjs` exit 0（旧测试里对列数 7/8 的钉死断言改为 6/7，不是删除）。

## DoD

在运行中的生产 serve 的 `/goal` 两个页签上真实读数：表头清单、列数、表格顶部 y 坐标改前/改后各一份（真浏览器，贴数值，不预设阈值——首屏节省量是成本结构未测前不设目标的量）。验收对象是「删掉的列在详情页仍可达、合并后的单元格两个时间都可读」。

## Touches

- packages/quay/src/serve-goal.ts
- packages/quay/src/serve-i18n.ts
- packages/quay/test/gap-webui-goal-list-prune-low-signal-columns.test.mjs
- packages/quay/test/gap-webui-goal-list-tab-split-goal-ac.test.mjs
- packages/quay/test/gap-webui-goal-list-sort-and-column-set.test.mjs
- packages/quay/test/serve-goal-body-i18n.test.mjs
- packages/quay/test/serve-goal-zh-chrome.test.mjs
- tasks/gap-webui-goal-list-prune-low-signal-columns.md
