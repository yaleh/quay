---
id: GOAL-037
title: touches 重叠的受控乐观派发：任务被 touches
  单独挡住超过配置阈值后允许放宽，合并成本有名额预算和自动收紧；先观测后影子再生效，默认关闭，只在 claudecodeui 启用（目标：缩短 goal
  从激活到完成的延迟）
status: active
kind: goal
origin: 用户 2026-10-16 在会话「ClaudeCodeUI 局部重构方案」中认可「等待超过阈值乐观派发」改动方案，并指示按方案创建
  goal/AC 并激活。依据：对 quay 与 claudecodeui 历史任务数据的分析与回放（worker-outcome /
  worker-round 台账、git 状态变更、goals 状态日志）。
activatedAt: 2026-10-16T15:19:53.808Z
---
## 背景

GOAL-045 一类「一次立很多有依赖、有文件重叠的任务」的 goal，延迟被两件事拖长：`depends_on` 等待，和 touches 重叠造成的串行。用 quay 与 claudecodeui 的历史数据（quay 2026-09-16 起 30.5 天，claudecodeui 2026-09-20 起 26.4 天）测得：

- worker 平均并发 0.62 / 0.71（上限 5）；就绪池为空的时间 75% / 65%，池里有货却因过滤没派发的时间约 23% / 34%。**供给是更大的瓶颈，本 goal 不处理供给。**
- touches 有预测力：落地相邻的重叠任务对重放三方合并，冲突率约 55–60%，无重叠对照 13–15%；但重叠对里仍有约 39% / 46% 文本上能干净合并。
- 事件级回放（只放宽 touches：等待 30 分钟乐观派发，冲突概率 0.5，返工取历史单次运行时长）：claudecodeui 的 AC 延迟中位数约 −17%（90% 区间 −29% 至 −4%），均值 −6%，p90 不变；quay 约 0。GOAL-045 事后重演总时长约 −25%（再加计数钉子不算冲突 −33%）。回放基线比真实偏悲观，收益可能被高估。
- 现状里 worker-round 的 filtered-empty 轮（quay 约 14%、claudecodeui 约 13% 的 stop 轮）不记录每个候选被谁挡住，无法归因。

## 范围

按方案分阶段：P0 只加观测（AC-362 filter_trace、AC-363 放宽账本与报告、AC-364 配置块）；P1 新谓词 touchesDisjointOrAged，mode=off 逐字节同现状、shadow 只标注不放行（AC-365）；live 语义（AC-366）；合并成本的自动收紧闭环（AC-367）。改动集中在 `plugin/scripts/driver-filters.ts`（谓词）、`plugin/scripts/worker-driver.ts`（round 记录、账本、控制状态）与配置读取校验。

## 非目标

- 不处理供给（任务进入就绪池的速度），不改 depends_on 的语义与分类，不改 fan-in 锁与 anti-drift 白名单，不动 `slot-refill.ts`。
- 不在本 goal 内启用生产：把目标项目的 `.quay/config.yml` 的 mode 设为 shadow 或 live、重启 worker driver，都由人决定时机。
- 不在 quay 自身启用（回放显示收益约 0）。
- 不预设 after_minutes、名额和自动收紧的阈值：这些要等 AC-362 与影子期的数据出来后由人在配置里给（缺失时判配置不合格，AC-364）。

## 退出条件

AC-362 到 AC-367 全部 achieved。先后提示（goal-driver 会独立立案，阶段先后须由任务层的 depends_on 或晋升把关承担）：AC-362、363、364 为第一批；AC-365 依赖 362 与 364；AC-366 依赖 365；AC-367 依赖 363 与 366。

## 已知缺口（如实写明，不作为 AC）

本 goal 的 AC 都是对测试夹具的读数，**没有一条读生产载体**（硬规则 4 推论三：只能被夹具满足的判据证明「能产出」，不证明「已产出」）。原因：生产读数需要人在目标项目启用影子或生效模式并重启 driver，这是人工步骤，写进 AC 会成为无法由 worker 满足的判据。因此以下阶段在本 goal 之外、由人推进：P1 影子期观察（在 claudecodeui 设 mode=shadow，读 filter_trace 的 wouldRelax 分布与等待分布）、P2 小名额生效（max_relaxed_inflight 为 1）、P3 按放宽账本报告决定是否放大名额、P4 与回放预测对照评估 AC 延迟中位数。建议这些阶段结束后另立 goal 或 AC 承载生产读数。

## 风险

- 等待时长取自就绪池进入时刻，是「被 touches 挡住多久」的保守替身：被并发上限或退避拖住的时间也会计入；只有该轮确实被 touches 单独挡住才允许放宽。
- 文本能合并不代表语义正确；fan-in 失败里 suite 红是主因（quay 约 33%，claudecodeui 约 34%），放宽的语义破坏会体现在这里，AC-367 要求分步统计。
- 状态事件账本起点较晚（quay 2026-10-08，claudecodeui 2026-10-10），更早的任务读不到就绪时刻，按设计保持阻塞（保守）。
- selector 在候选集变大后的选择偏好、放宽任务占用并发槽对别的任务的挤出，均未建模。

## 与其他 goal 的关系

与 GOAL-045（claudecodeui 的 delivery/turn 账本）无依赖：本 goal 改的是 quay 的派发器，GOAL-045 的任务是被派发的对象。本 goal 生效后会改变 GOAL-045 剩余任务的派发时机，生效须在其收尾之后或由人择机。