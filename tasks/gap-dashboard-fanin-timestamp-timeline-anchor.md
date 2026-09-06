---
id: gap-dashboard-fanin-timestamp-timeline-anchor
title: Dashboard Fan-in 卡补时间戳 + 测试/Fan-in 分段时间轴 bar 窗口终点锚定到最后一次事件结束时刻（而非
  wall-clock now）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`gap-dashboard-fanin-panel-and-timeline-bars`（已 done，commit `a75bafe00`）落地的 Fan-in 卡（H）与
测试/Fan-in 分段时间轴（G/H）在真实浏览器 + 真实生产数据核验中发现两处缺陷，均已定位到具体代码行：

**缺陷1：Fan-in 卡片没有时间戳。** `renderFanInCardFromRecords`（`packages/quay/src/serve-dashboard.ts:490`）
每一行只拼了任务链接 + `renderFanInCell(...)`（`packages/quay/src/serve-task.ts:508`）。`renderFanInCell`
是为 `/task/<id>` 页面的**表格单元格**设计的，从不渲染时间戳——那张表里时间戳是独立的一列
（`taskRunsBlock` 的 `r.started_at`），不属于 cell 本体。当初 H 的实现说明写的是"复用 renderFanInCell，
不二次拼字段"，但漏了 F 那次的先例：testsCard 的 F 修复是在复用的基础上，由**卡片自己**额外拼了
`startedAt`/`buckets` 两个子行，不是指望被复用的底层函数带出来。Fan-in 卡这次没照这个先例做，时间戳就丢了。
实测（真实 `curl` 到跑着的 dev server 拉取的 `/dashboard` HTML，`sed -n '683,720p'`）逐行核对，5 行记录
一个时间戳都没有——只有 `任务链接 + <strong>landed/red</strong> + lock Ns + suite done + sha + view/download`。

**缺陷2：分段时间轴 bar 的窗口终点固定为渲染时刻的 wall-clock now，导致循环一停就整条 bar 消失。**
`renderTimelineBarSvg`（`packages/quay/src/serve-dashboard.ts:139`）的窗口起点算法是
`windowStartMs = nowMs - windowHours*3_600_000`，右边界固定为调用时传入的 `nowMs` 参数；而两个调用点
（`renderTestsCard` 里的 `renderTimelineBarSvg(timelineSegments, hours, nowMs)`、
`renderFanInCardFromRecords` 里的 `renderTimelineBarSvg(segments, hours, nowMs)`）传的都是
**渲染请求那一刻的真实 wall-clock now**，不是"该卡自己最后一次事件的结束时刻"。

用生产真实数据量化过有多严重（非推测）：
```
最后一条 verification-round 记录：#1041，startedAt=2026-09-05T18:55:43.029Z，durationMs=164675（结束≈18:58:28Z）
最后一条 mechanical_fan_in 记录：gap-branch-rename-manager-doc-to-author，lockReleaseEpoch=1788634713（≈18:58:33Z）
核验当时的 now epoch：1788660380（≈ 7.1 小时之后）；同时 mgrCard 显示 loop-driver: DEAD（循环确实已停摆）
```
⇒ 默认 3h/6h/12h 三个窗口预设下，两条 bar **当前全部是空的**（`renderTimelineBarSvg` 因
`rows.length===0` 返回 `""`，连 `<svg>` 标签都没有）——这不是"数据恰好在窗口外"的正常空态（那种情况该
按 absent-field 契约什么都不画，是对的），而是**只要循环停顿时长超过所选窗口，这两条 bar 就必然失效**，
是设计缺陷：过去 N 小时的时间轴，理应以"最近一次真实发生的事情"为参照系去看"那次事情前后忙成什么样"，
而不是死抠"此刻往前 N 小时"这个和数据活动完全脱节的绝对区间。

## Plan

1. **修时间戳（缺陷1）**：在 `renderFanInCardFromRecords` 的行模板里，用已经算出来但目前被 `.map(({r}, i)
   => ...)` 丢弃掉的排序键（`mfi.lockAcquireEpoch` 兜底 `Date.parse(r.ts)/1000`）套 `relativeTime()`
   （`serve-render.ts` 已导出，F 修复已用过同一函数）新增一个子行，风格与 F 修复 testsCard 的
   `startedLine` 完全同构（独立 `<div>`，不是塞进 `renderFanInCell` 的返回值里）。不改 `renderFanInCell`
   本体——它在 `/task/<id>` 页面被复用且已有独立的时间戳列，不该为了这一处消费者改变它的契约。

2. **修 bar 终点锚定（缺陷2）**：把 `renderTimelineBarSvg` 的第三个参数从"调用方传入的 wall-clock now"
   改造为"该卡自己算出来的窗口终点"，两处调用点各自计算：
   - `renderTestsCard`：从 `tests.runs` 里找**最新一条同时有可解析 `startedAt` 与非 null `durationMs`**
     的记录，取其 `startedAt + durationMs`（即最近一次测试的真实结束时刻）作为窗口终点；一条可用记录都
     没有时退回 `opts.nowMs ?? Date.now()`（避免 NaN，绝不能没有兜底）。
   - `renderFanInCardFromRecords`：从 `fanIns` 里找**最新一条**（用现有排序键，即 `lockAcquireEpoch`
     兜底 `Date.parse(r.ts)/1000`），取其 `mfi.lockReleaseEpoch`（该条本身缺失则退回同一条的
     `lockAcquireEpoch`）作为窗口终点；一条都没有时同样退回 `opts.nowMs ?? Date.now()`。
   - `renderTimelineBarSvg` 自身的第三个形参从语义上容易误导的 `nowMs` 改名为 `windowEndMs`（纯改名 +
     doc comment，几何换算逻辑不变），防止以后维护者按字面意思以为它就是 `Date.now()`。
   - `opts.nowMs` 这个入参本身继续保留（給 `relativeTime` 一类"距今"展示、给"无可用记录时的兜底"使用），
     只是不再被直接假定等于 bar 的右边界。

3. **文案同步**：dashboard 页顶部"时间轴窗口（当前 Xh）"这行提示语，改为明确写出"以各自最近一次
   运行/fan-in **结束时刻**为终点的过去 Xh"，避免用户根据旧文案继续以为窗口锚定在此刻（该文案是本次问题
   被人发现的直接原因之一——旧文案暗示了错误的心智模型）。

4. **更新既有单测**：`gap-dashboard-fanin-panel-and-timeline-bars.test.mjs` 里依赖"bar 右边界==调用时刻
   nowMs"这个假设写的用例（AC3/AC5②/AC7 相关）在锚点改法后语义变了，需要同步改写断言依据（改成"围绕
   segments 里最新一条的结束时刻构造窗口边界"），不能靠"缩小 fixture 让新旧行为碰巧重合"这种方式蒙混过去
   ——即下面 AC2/AC3 明确要求的"反例判据"就是为了防止这种蒙混。

## Acceptance Criteria

- [ ] AC1（时间戳）：对 `renderFanInCardFromRecords` 传入一个固定 `records` fixture（含已知的
      `lockAcquireEpoch`）与固定 `opts.nowMs`，断言输出 HTML 里每一行都含一个由 `relativeTime()` 产生的、
      与该固定输入完全对应的时间描述子串（不是模糊 `/ago|前/` 子串匹配，而是与 `relativeTime(fixedEpoch*1000)`
      的真实返回值逐字比对）。
- [ ] AC2（bar 锚定・测试卡，反例判据）：构造 `tests.runs` fixture，全部记录的 `[startedAt, startedAt+
      durationMs]` 落在 `[nowMs-10h, nowMs-7h]` 区间（模拟"循环已停 7 小时"），调用 `renderTestsCard`
      时传 `hours=3`。① 用新实现（windowEndMs=最新记录结束时刻）渲染，断言输出含 `<rect`（非空）；
      ② 把同一份 segments 手工传给 `renderTimelineBarSvg` 并显式指定 `windowEndMs=nowMs`（即还原旧行为，
      关掉本次改动），断言此时 `<rect` 计数为 0 —— ②存在是为了证明 AC2①测的确实是"锚点从 now 换成了
      最新事件结束时刻"这件事本身，而不是别的巧合。
- [ ] AC3（bar 锚定・Fan-in 卡，同 AC2 结构）：同款 fixture/反例判据，数据源换成
      `mechanical_fan_in.lockAcquireEpoch/lockReleaseEpoch`，模拟"最后一次 fan-in 是 7 小时前"，① 新实现
      非空、② 显式传回 `windowEndMs=nowMs` 必须变回 0。
- [ ] AC4（命名/职责不漂移，静态可查）：`grep -n "windowEndMs" packages/quay/src/serve-dashboard.ts`
      命中 ≥3 处（1 处 `renderTimelineBarSvg` 签名 + 至少 2 处调用点的计算逻辑）；`renderTimelineBarSvg`
      的函数签名所在行不再出现形参名 `nowMs`（`grep -A2 "^function renderTimelineBarSvg"` 人工核对，或用
      一条 `grep` 断言该签名行 3 个形参名依次为 `segments, windowHours, windowEndMs`）。
- [ ] AC5（文案）：`grep -n "结束时刻为终点\|最近一次运行/fan-in" packages/quay/src/serve-dashboard.ts`
      命中 ≥1。
- [ ] AC6（既有测试不回归）：`node --experimental-strip-types --test
      packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs` exit 0——原 11 条用例
      （F/AC1、共用函数存在性、AC4 sort/filter、AC6 mount 等与本次改动无关的部分）继续全绿；只有依赖旧
      "窗口终点=now"假设的断言按 Plan 步骤4 同步改写。
- [ ] AC7（真实生产数据回归，非 fixture）：新增一条用真实 `.quay/worker-outcome.jsonl` /
      `.quay/verification-round.jsonl`（当前 workspace，不注入/不 mock）跑一次
      `renderFanInCard(root, {hours:3})` 与 `renderTestsCard(tests, suiteRun, {hours:3})` 的测试，
      `nowMs` 用真实 `Date.now()`，断言两者返回的 HTML 都含至少一个 `<rect`——本条必须直接读生产文件，
      关掉这条读取生产文件的路径（改喂 fixture）应该会让断言退化为不可信（即该测试不得有旁路开关能绕开
      读真实文件）。

## Definition of Done

- 代码改动已合入 `develop`（本仓库任务落地终点，非 doc-only author 分支）。
- `scripts/test.sh --for-task gap-dashboard-fanin-timestamp-timeline-anchor`（或等价 scoped 调用）绿。
- 手工用 MCP 浏览器刷新一次生产 dashboard 页（真实当前循环停摆时长下）确认：Fan-in 卡每一行都带时间戳；
  测试卡与 Fan-in 卡的分段 bar 均非空、且右边界标注的时刻与该卡最后一次真实事件的结束时刻一致（非当前
  wall-clock 时刻）。
- `quay task check gap-dashboard-fanin-timestamp-timeline-anchor --json` 的 `missing` 为 `[]`。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs
- tasks/gap-dashboard-fanin-timestamp-timeline-anchor.md
