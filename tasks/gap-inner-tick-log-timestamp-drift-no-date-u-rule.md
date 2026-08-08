---
id: gap-inner-tick-log-timestamp-drift-no-date-u-rule
title: "inner 层 tick-log 时刻漂移复现——fast-mode-loop-tick.md 缺「必须 date -u 读钟」规则（manager 层 08:04Z 已修同类，inner 层没有）"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**inner 层 tick-log 时间戳漂移（超前 ~6 小时）——与 manager 层 08:04Z 修过的同类缺陷，这次长在 inner 层。**

**现象（外层 2026-08-08 14:1xZ 实测，manager 指出）**：

| 证据 | 值 |
|---|---|
| inner tick-log 最新条目标签 | `20:5xZ`（tick-log 中 17:0x/17:4x/18:0x/18:4x/19:1x/19:5x/20:1x/20:5x 一系） |
| 实际 UTC | `14:12Z`（`date -u`） |
| 漂移 | **超前 ~6 小时** |
| inner 最新提交 c67a826d | 14:07Z（busy-mask-idle AC evidence） |
| 最近 inner 条目标签 | 20:5xZ，与实际 14:1x 不符 |

**同类先例**：manager 层 2026-08-08 08:04Z（commit `b0b2bbfd`）修复了 manager tick-log 的同一缺陷：
「tick-log 第一列时刻是估的不是读钟的，且单调漂移……以各行点名提交做锚，+128→+150→+165→+195→+192 分，
标签已跑进未来 3 小时以上。**已把「必须 date -u」写进 §3。**」manager 层已补规则，inner 层没有。

**根因（双层）**：
1. **inner 驱动文档缺规则**：`docs/analysis/fast-mode-loop-tick.md` 的「写回状态」章节（§5）只说「更新
   队列文件」，**零处 `date -u`**（grep 实测 = 0）——没有规定 tick-log 时间戳必须读钟。manager 层文档
   （orchestration 侧 §3）有「必须 date -u，不许估」，inner 层缺失。
2. **inner 实际估算时间**：无规则 → inner 用估算/累加方式写 tick 标签，单调漂移进未来。

**为什么是缺陷**：tick-log 是退化判据（累计动作分布）与时间序列的唯一来源；漂移的时间轴让
「age=NN 分钟」类判断全建在假时间轴上（manager 08:04Z 原文）。跨层复现说明「修一层补一层」的教训
没下沉——manager 修自己的文档，inner 文档缺同款规则，于是内层再犯。

**修的方向（实现归内层）**：
- inner 驱动文档 `fast-mode-loop-tick.md` §5「写回状态」补规则：**tick-log 时刻列必须 `date -u '+%H:%MZ'`
  读钟，不许估**（逐字对齐 manager 层 §3 的规则与反例锚定法）。
- 历史漂移条目：不改历史（tick-log 已 gitignore，允许丢失，人已接受），但写一条说明或就地纠正后续条目
  的时间源。
- 可选：把「tick-log 第一列必须读钟」做成机械检查（若外层/manager 已有检查器可复用，否则至少文档级）。

**验证锚**：修后 inner 写一条 tick 到 tick-log，标签与 `date -u` 实测偏差 <5 分钟（不再超前小时级）。

## Acceptance Criteria

- [ ] AC1: **文档补规则**——`docs/analysis/fast-mode-loop-tick.md` §5「写回状态」新增「时刻列必须
      `date -u` 读钟，不许估」，含反例锚定说明（对齐 manager 层 §3 同款规则），grep `date -u` 命中 >0
- [ ] AC2: **实测修后无漂移**——inner 写一条 tick 到 tick-log，标签与 `date -u '+%H:%MZ'` 偏差 <5 分钟
      （实跑贴任务体）
- [ ] AC3: **跨层对齐**——确认 manager 层规则（orchestration 侧 §3）与 inner 层规则在措辞上同源
      （「必须读钟 / 不许估 / 锚定提交」三要素都在）
- [ ] AC4: **历史漂移不再累积**——修后 inner 连续 ≥2 条 tick 标签单调且贴近真实 UTC（不再出现
      +1 小时级跳变，实跑或 tick-log 观察）

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] `fast-mode-loop-tick.md` §5 含「必须 date -u」规则（grep 可证）
- [ ] 修后 inner tick-log 至少 2 条新条目标签与真实 UTC 一致（<5min）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- docs/analysis/fast-mode-loop-tick.md（§5 写回状态：补「必须 date -u」规则）
- orchestration/tick-log.md（验证 AC2：写一条无漂移 tick；gitignore 允许）
- tasks/gap-inner-tick-log-timestamp-drift-no-date-u-rule.md（自身：勾 AC + 贴证据）

## Contract

measure   inner_tick_label_minus_utc = `date -u '+%H:%MZ'` 与 tick-log 最新 inner 条目标签的分钟差
band      inner_tick_label_minus_utc < 5（分钟，修后；不再超前小时级）
invariant tick_log_time_is_clock = 1（fast-mode-loop-tick.md 含「必须 date -u」规则）
invoke    `date -u '+%H:%MZ'`（实跑贴回）与 tick-log 比对
control   修前偏差 >60 分钟（复现）；修后 <5 分钟（AC2）；连续 2 条 tick 无漂移（AC4）
resume    文档补规则 + 实测验证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-08
changed: 建任务（manager 指出 + 外层核实漂移 ~6h；确认 inner 文档 0 处 date -u；确认 busy-mask 在飞任务 Touches
不撞 docs/analysis/fast-mode-loop-tick.md 与本任务文件）
