---
id: gap-git-graph-stride-chip-overlaps-commit-row-text
title: （已被 gap-git-graph-adopt-git-column-algorithm-and-decorate-labels
  取代）原范围「chip 挪开以免压字」作废——其 AC3 会把人明确否决的「每 strideRows 重复标签」锁进回归测试；改写为「确认 chip
  机件确已移除且标签仍在 ref tip」的独立闭合确认
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-git-graph-adopt-git-column-algorithm-and-decorate-labels
---
## Proposal

**本任务已被 `gap-git-graph-adopt-git-column-algorithm-and-decorate-labels` 取代，范围改写为「确认 chip 机件确已移除」。**

**原范围（2026-09-08 立案）**：stride chip 与提交行文字共用文本列 x、y 相差不足一行高，25 个 chip 逐个压住同行提交 subject；原方案是把 chip 挪开或给它独占一行。

**为何作废（2026-09-09 人明确）**：人的诉求是 **git decorate 语义——标签只出现在 ref 指向的那个提交上**，而不是每隔 `strideRows` 行重复一次。原 AC3 写的是「不许用『删掉 chip』来消除重叠：chip 数仍 = `ceil(该泳道行跨度 / strideRows)`」——**这条会把人明确不要的周期重复行为锁进回归测试**。继续按原范围派发，等于用测试固化一个已被否决的设计。

实测佐证（2026-09-09 生产实例）：页面上 `develop` 标签 **6 个**，y 坐标 410 / 929 / 1448 / 1968 / 2487 / 3006，等间距约 519px；而同窗口 `git log --pretty=format:%D` 里带 decoration 的提交**只有 3 个**。

**改写后的范围**：取代任务会删除全部浮动 chip 与 stride 逻辑（其 AC4 要求 `appendChip` 在 `serve-git.ts` 中 `grep -c` 为 0）。本任务退化为一条**独立确认**：chip 机件确已消失、且不可能再产生压字。保留它而不是删除，是为了让「压字」这个曾经真实存在的缺陷有一条可追溯的闭合记录。

**相关**：`gap-git-graph-lane-chip-rendered-once-regardless-of-span`（done）是 stride 行为的来源，其行为由取代任务反转。

## AC

- [x] AC1 chip 机件归零：`grep -c "appendChip" packages/quay/src/serve-git.ts` 输出为 0（当前 4）。
- [x] AC2 压字结构上不可能：渲染后的 SVG 中，不存在任何非提交文本元素与提交文本元素的 bbox 相交——相交对数 = 0，且该结论不依赖坐标微调（因为已无浮动标签元素）。
- [x] AC3 负控制：测试内显式还原一个浮动 chip 元素并置于提交行同一 y，断言 AC2 的相交对数 > 0 ⇒ 判据能取假，不是因为「页面上没东西」而恒真。
- [x] AC4 标签仍然存在（不许用「什么都不画」来满足 AC1/AC2）：`%D` 非空的提交行仍带内联标签，条数与 `git log --pretty=format:'%H%x01%D'` 中 `%D` 非空的提交数相等。

## DoD

生产 `/git-history` 上，`appendChip` 已不存在于源码、页面无任何浮动标签元素、bbox 相交对数 = 0，同时 ref tip 的内联标签仍在（AC4）——四项读数取自真实生产页面与源码，不接受仅 fixture 通过。本任务在取代任务落地后才可能满足，因此依赖它。

## Touches

- packages/quay/test/gap-git-graph-stride-chip-overlaps-commit-row-text.test.mjs（本任务的确认测试）
- tasks/gap-git-graph-stride-chip-overlaps-commit-row-text.md
