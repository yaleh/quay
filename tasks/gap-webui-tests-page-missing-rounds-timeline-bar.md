---
id: gap-webui-tests-page-missing-rounds-timeline-bar
title: 人点名：dashboard 的最近测试记录 bar chart 应在 /tests 页显示 —— renderTimelineBarSvg 已
  export 却只被 dashboard 消费，测试的正主页面反而看不到它
status: done
labels:
  - gap
  - webui
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-webui-tests-page-unpaginated-tables
---
**type:** execution

## Proposal

**来源**：人 2026-09-08 走查 quay web 界面后逐字提出：「dashboard 的最近测试记录 bar chart 也应在 tests 页显示」。

**现状取证（2026-09-08 对生产实例实测，非目测）**：

- `/dashboard` 的「测试」卡里有「近 5 轮（新→旧）」列表 + 其下一条**过去 N 小时的分段时间轴 bar**
  （红/绿分段，窗口按 `1h · 3h · 6h · 12h` 可切）；
- `/tests` 页的全部 H2 只有三个：`负载曲线`、`测试时间线`、`历史运行（新→旧）`；页面上的 `<svg>` 只有两个
  （`aria-label` 分别是 `Suite-run loadavg curve` 与 `Per-file test timeline (gantt)`）。
  **那条分段时间轴 bar 一个都没有。**

**机制（这是本条与相邻任务的区别）**：渲染这条 bar 的原语**早已是 export 的公共函数**——
`packages/quay/src/serve-dashboard.ts:155 renderTimelineBarSvg()`，以及包着它的
`:215 renderTestsCard()`。二者在同文件内被 `:291` / `:837` / `:1063` 消费，**消费者只有 dashboard 一处**。
即：**图件已经建好并公开，但只被概览页用了，专题页没接**——与
`gap-webui-tests-page-unpaginated-tables` 那条（机制建好只接了一个页面）同族，但那是分页原语、这是图件复用，
两者是不同的原语与不同的接线点，故分列；因二者同改 `serve-tests.ts`，本任务 `depends_on` 它以避免同文件并行冲突。

**为什么值得做而不只是「dashboard 上已经有了」**：`/dashboard` 的那张卡按设计只取**最近 5 轮**、
窗口最长 12h；而 `/tests` 是这批数据的正主页面（数据源同为 `.quay/verification-round.jsonl`），
在这里才有条件给出更长窗口与更多轮次的红绿分布。人的原话是「也应在 tests 页显示」——即两处都要有，
不是搬走。

**修法方向**：在 `/tests` 页顶部（现有 suite 状态摘要之下、负载曲线之上）复用
`renderTimelineBarSvg`，数据取 `verification-round.jsonl` 的 round 记录，分段颜色按 `state` red/green，
窗口档位与 dashboard 一致（`1h · 3h · 6h · 12h`）并允许更长档；
**直接 import 既有 export，不得复制一份渲染逻辑**（本仓库反复出现的双份实现漂移）。

## Acceptance Criteria

- [x] AC1 生产载体读数：加载 `/tests`，断言存在一个 `<svg>` 其 `aria-label` 与 dashboard 那条时间轴 bar
      **同名**，且其内部 `<rect>` 分段数 **> 0**。取假：改动前该页 `<svg>` 只有 2 个、均非此 label。
- [x] AC2 复用而非复制（防双份实现漂移）：断言 `packages/quay/src/serve-tests.ts` 里出现
      `import { renderTimelineBarSvg }`，且 `grep -c "function renderTimelineBarSvg" packages/quay/src/serve-tests.ts`
      == **0**。两个方向都断言。
- [x] AC3 分段确实由数据驱动（能取假）：单测对同一渲染函数分别喂入「全 green 的 N 轮」与「含 M 条 red 的 N 轮」，
      断言两次输出的 red 色分段数分别为 **0** 与 **M**。若两次输出相同则报红。
- [x] AC4 与 dashboard 同源同窗口：断言 `/tests` 与 `/dashboard` 在同一时刻、同一 `hours` 参数下，
      渲染出的分段**起止时间戳序列逐条相等**（同一份数据、同一套横轴换算，不是各算各的）。
      不相等时打印两侧序列的差异条数与前 3 条。
- [x] AC5 `bash scripts/test.sh --for-task gap-webui-tests-page-missing-rounds-timeline-bar` 退出码 0。

## Definition of Done

在**真实运行的实例**上把 `/tests` 与 `/dashboard` 的测试卡并排截图，两处的红绿分段带**目视一致**且
`/tests` 上的窗口档位可切换；AC4 的时间戳序列比对输出贴进提交信息。**「函数被 import 了 + 单测绿」不算达成**
——必须有这一次页面上真的画出了分段带的截图。

## Touches

- `packages/quay/src/serve-tests.ts`
- `packages/quay/test/gap-webui-tests-page-missing-rounds-timeline-bar.test.mjs`
- `tasks/gap-webui-tests-page-missing-rounds-timeline-bar.md`