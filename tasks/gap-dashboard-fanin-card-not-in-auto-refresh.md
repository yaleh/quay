---
id: gap-dashboard-fanin-card-not-in-auto-refresh
title: 人点名：Dashboard 的 Fan-in 卡不自动刷新 —— fanin-card 有 DOM 锚点却从未接进
  /dashboard/cards payload 与刷新脚本的 swap 名单
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

**来源**：人 2026-09-08 逐字提出：「Web Dashboard 页 fan-in 列表没有自动刷新。请检查。」

**现状取证（2026-09-08 对生产实例 `http://100.78.206.100:4173` 实测，不是读代码推断）**：

```
$ curl -s http://100.78.206.100:4173/dashboard | grep -o 'id="[a-z-]*card"' | sort -u
  id="fanin-card"  id="goal-card"  id="live-card"  id="mgr-card"
  id="sys-card"    id="task-card"  id="tests-card"          ← 页面渲染 7 张卡

$ curl -s http://100.78.206.100:4173/dashboard/cards -H 'Accept: application/json' | jq 'keys'
  ["goalCard","liveCard","mgrCard","sysCard","sysRaw","taskCard","testsCard"]   ← 只有 6 个卡片键，无 faninCard

$ curl -s http://100.78.206.100:4173/dashboard | grep -o 'getElementById("[a-z-]*")' | sort -u
  goal-card  live-card  mgr-card  sys-card  sys-sparkline  task-card  tests-card ← 刷新脚本只 swap 6 个节点，无 fanin-card
```

⇒ **Fan-in 卡（列表 + 锁持有区间时间轴条）只在整页 reload 时更新**；30s 轮询对它完全没有效果。
`fanin-card` 这个 id 存在于 DOM，所以从页面结构上看它像是"已接线"，实际两端都没有它——
**一个看起来覆盖了的锚点，比没有锚点更贵**（同硬规则 3b）。

**机制（三处代码，缺口在后两处）**：

- `packages/quay/src/serve-dashboard.ts:721 renderFanInCard()` / `:727 renderFanInCardFromRecords()`
  —— 渲染函数本身完好，输出 `<div id="fanin-card">`（`:800`）；
- 它的**唯一**调用点是 `:840`（`renderDashboardPage` 内）—— 即只在整页渲染路径上；
- `:1032 handleDashboardCards()` 的 payload 列出 6 个卡片键（`liveCard/testsCard/sysCard/mgrCard/taskCard/goalCard`），**没有 `faninCard`**；
- `:442 renderDashboardCardRefreshScript()` 的 swap 名单同样是那 6 个，**没有 `fanin-card`**。

**为什么会漏**：Fan-in 卡由 `gap-dashboard-fanin-panel-and-timeline-bars` 的 **H** 分支加入，
同一任务的 **G** 分支（测试卡的时间轴条）是接进刷新的；**H 只落实到了页面渲染那一处**。
这正是硬规则 5b「在某处修好 X ≠ X 只在那一处」的同形——原则已想明白，只落到被发现的那一处。
相关但不同机制的既有任务（均已 done，非重复）：`gap-dashboard-testscard-livecard-auto-refresh`
（建立刷新机制本身）、`gap-dashboard-fanin-panel-and-timeline-bars`（加卡）、
`gap-dashboard-visual-review-batch-fixes`（把 sys/mgr/task/goal 补进刷新名单——**同一个机制缺口的上一次补丁，
当时补了 4 张卡却没补 fanin**）。

**修法方向（两处接线 + 一条防复发的登记完备性判据）**：

1. `handleDashboardCards` 的 payload 增加 `faninCard: renderFanInCard(cfg.workspaceRoot, { hours })`
   —— 与页面渲染共用同一个 `hours`（该端点已有 `timelineHoursFromRequest(req)`），
   使 G/H 两条时间轴在轮询后仍共享同一窗口，不出现一条动一条不动。
2. 刷新脚本增加 `var fanin = document.getElementById("fanin-card"); if (fanin && typeof d.faninCard === "string") { fanin.innerHTML = d.faninCard; }`。
3. **防复发（本任务的真正价值，不止修这一张卡）**：加一条**登记完备性**判据——
   把「页面渲染出的每个 `id="*-card"` 节点」与「`/dashboard/cards` 的卡片键」「刷新脚本的 swap 名单」
   三者做集合比对，**任一方缺失即报红**。下一张新卡再漏接时由这条判据当场抓住，
   而不是等人在界面上看出某块不动。

**成本注意（实现时须核实，不是阻塞项）**：`renderFanInCard` 走
`observation.ts:901 readWorkerOutcomeRecords()` —— 对 `.quay/worker-outcome.jsonl` 做**同步全量读 + 逐行 parse**，
该文件本机实测 **1.8 MB**（2026-09-08）。整页渲染路径已经在付这笔钱，但 30s 轮询会把它变成常态开销。
若实测单次 > 100ms，应只在该端点内复用/裁剪（卡片只用最近 5 条 + 窗口内分段），
**不得为省钱而把卡片排除在刷新之外**——那等于回到本缺陷。

## Acceptance Criteria

- [x] AC1 生产载体读数（端点侧，能取假）：对运行中的实例 `GET /dashboard/cards`，断言 JSON 顶层键**包含** `faninCard`
      且其值是长度 > 0 的字符串、内含 `id="fanin-card"`。取假：改动前该键不存在（上文实测 keys 列表可作负控制基线）。
- [x] AC2 生产载体读数（脚本侧，能取假）：`GET /dashboard` 的 HTML 中断言出现 `getElementById("fanin-card")`
      且其后的赋值读的是 `d.faninCard`。取假：改动前 `grep -c 'getElementById("fanin-card")'` == 0。
- [x] AC3 **登记完备性（防复发，这条才是源头修法）**：一条判据同时读三个集合——
      ① `renderDashboardPage()` 输出中所有 `id="([a-z-]+-card)"`；
      ② `handleDashboardCards` 返回 JSON 的卡片键（去掉 `sysRaw` 等非卡片键，按 `xxxCard` 命名映射回 `xxx-card`）；
      ③ 刷新脚本中所有 `getElementById("([a-z-]+-card)")`。
      断言三者**互相相等**；不相等时打印每一侧独有的元素名。
      **负控制（必须做，否则这条判据可能恒真）**：在测试内构造一个「页面多一张卡而 payload 没有」的输入，
      断言该判据**报红**——只有它能取假才算测量（硬规则 4）。
- [x] AC4 刷新后内容真的会变（不是只 swap 一次空壳）：单测对 `renderFanInCardFromRecords` 分别喂入
      「N 条 fan-in 记录」与「N+1 条（新增一条更晚的 landed）」，断言两次输出的列表行数分别为 `min(N,5)` 与 `min(N+1,5)`、
      且第一行的 task id 不同。两次输出相同则报红。
- [x] AC5 窗口一致性：同一 `?hours=` 下，`/dashboard` 页内的 fanin 时间轴与 `/dashboard/cards` 返回的 `faninCard`
      渲染出的分段**起止时间戳序列逐条相等**（同一份数据、同一套横轴换算）。不等时打印差异条数与前 3 条。
- [x] AC6 轮询开销未失控：测量 `handleDashboardCards` 在本仓库真实 `.quay/worker-outcome.jsonl`（≈1.8MB）下的
      单次耗时，记录**改动前/改动后**两个读数进提交信息。若增量 > 100ms，则在同一任务内实现裁剪并复测，
      **不得以「太贵」为由把 fanin 排除出刷新**。
- [x] AC7 `bash scripts/test.sh --for-task gap-dashboard-fanin-card-not-in-auto-refresh` 退出码 0。

## Definition of Done

在**真实运行的实例**上打开 `/dashboard` 并**不做整页 reload**，等待一次 30s 轮询周期跨过一条新的机械 fan-in 记录落盘，
Fan-in 卡的列表首行与时间轴分段**目视发生变化**——截图前后两帧贴进提交信息。
**「payload 里加了键 + 单测绿」不算达成**：必须有这一次页面在不 reload 的前提下自己更新了 Fan-in 卡的证据
（DIR-026 Reading A：产物是必要不充分条件，真实经由机制运转过一次才是达成）。
AC3 的负控制输出（构造缺口 ⇒ 判据报红）同样贴进提交信息——否则无法区分「三集合相等」与「判据没查成」。

## Touches

- `packages/quay/src/serve-dashboard.ts`
- `packages/quay/test/gap-dashboard-fanin-card-not-in-auto-refresh.test.mjs`
- `tasks/gap-dashboard-fanin-card-not-in-auto-refresh.md`
