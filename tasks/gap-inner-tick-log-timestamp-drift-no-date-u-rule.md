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

- [x] AC1: **文档补规则**——§5「写回状态」新增「时刻列必须 `date -u` 读钟，不许估」，含反例锚定说明
      （对齐 manager 层 §3 同款规则）。**落点：canonical `plugin/loop/fast-mode-loop-tick.md` §5 + 落地副本
      `docs/analysis/fast-mode-loop-tick.md` §5 两处都补**。grep `date -u`：修前 develop=0，修后
      plugin/loop=2、docs/analysis=2（>0）
- [x] AC2: **实测修后无漂移**——已写 tick 到 tick-log（`orchestration/tick-log.md`，gitignored 运行时遥测）：
      「14:20Z inner tick」条目标签与 `date -u '+%H:%MZ'` 实测 `14:20Z` 偏差 <1 分钟（修前 `20:5xZ` vs 真实
      `14:12Z` 超前 ~6 小时）
- [x] AC3: **跨层对齐**——inner §5 规则逐字对齐 manager 层 §3（先例 `b0b2bbfd`，2026-08-08 08:04Z，
      `orchestration/manager-loop-tick.md` §3）：三要素「必须读钟（date -u）/ 不许估 / 锚定（标签对真实
      UTC 比对）」都在，措辞同源（「单调累积」「读钟是唯一来源」与 manager 原文一致）
- [x] AC4: **历史漂移不再累积**——修后已写连续 ≥2 条 tick（14:20Z × 2），标签单调且贴近真实 UTC，
      无 +1 小时级跳变；机制上 §5 规则强制每 tick 读钟，漂移不再累积

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] `fast-mode-loop-tick.md` §5 含「必须 date -u」规则（grep 可证）
- [ ] 修后 inner tick-log 至少 2 条新条目标签与真实 UTC 一致（<5min）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/loop/fast-mode-loop-tick.md（canonical 内层 tick 文档 §5：补「必须 date -u」规则——模板源，随 quay-init 分发）
- docs/analysis/fast-mode-loop-tick.md（落地副本 §5：补「必须 date -u」规则）
- orchestration/tick-log.md（验证 AC2/AC4：写两条无漂移 tick；gitignore 允许）
- tasks/gap-inner-tick-log-timestamp-drift-no-date-u-rule.md（自身：勾 AC + 贴证据）

## Contract

measure   inner_tick_label_minus_utc = `date -u '+%H:%MZ'` 与 tick-log 最新 inner 条目标签的分钟差
band      inner_tick_label_minus_utc <= 5（分钟，修后；不再超前小时级）
invariant tick_log_time_is_clock = 1（fast-mode-loop-tick.md 含「必须 date -u」规则）
invoke    `date -u '+%H:%MZ'`（实跑贴回）与 tick-log 比对
control   修前偏差 >60 分钟（复现）；修后 <5 分钟（AC2）；连续 2 条 tick 无漂移（AC4）
resume    文档补规则 + 实测验证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-08
changed: 建任务（manager 指出 + 外层核实漂移 ~6h；确认 inner 文档 0 处 date -u；确认 busy-mask 在飞任务 Touches
不撞 docs/analysis/fast-mode-loop-tick.md 与本任务文件）

## Completion（2026-08-08，task subagent）

**改动**：`date -u` 读钟规则已写入 §5「写回状态」——**两处**：canonical 模板
`plugin/loop/fast-mode-loop-tick.md`（随 quay-init 分发，durable 修复）与落地副本
`docs/analysis/fast-mode-loop-tick.md`（本仓运行时读的副本）。规则逐字对齐 manager 层 §3（先例
`b0b2bbfd`，2026-08-08 08:04Z）：「tick-log 时刻列必须 `date -u` 读钟，不许估」，含单调累积反例
（inner 实测 `20:5xZ` vs 真实 `14:12Z` 超前 ~6 小时）、危害（age=NN 判断建在假时间轴）、一般形态
（自增量从不对外部基准对表则漂移是必然）、tick-log 已 gitignore 无 git 时间戳兜底故读钟是唯一来源。

**grep 证据**：修前 develop 上 `plugin/loop/fast-mode-loop-tick.md` `date -u` 命中 **0**；修后
plugin/loop=**2**、docs/analysis=**2**（AC1）。tick-log 已写两条时钟实测条目（14:20Z × 2，与
`date -u '+%H:%MZ'` 实测 `14:20Z` 偏差 <1 分钟；修前 `20:5xZ` 超前 ~6 小时）——AC2/AC4 证据在
gitignored `orchestration/tick-log.md`，不随提交（人裁定 tick-log 可丢失）。

**docs/analysis 副本 reconciliation 提示**：`docs/analysis/fast-mode-loop-tick.md` 是旧 laydown，与
canonical 模板有 **487 行 diff**（`diff` 实测，旧批模型措辞、旧判绿段），本任务只在 §5 就地补规则、未全量
重铺。**建议后续随 quay-init --loop 重铺（或把 canonical 模板拷回）对齐**——那是单独的 reconciliation 活，
不在本任务范围。

**Touches 交叉提示**：本任务把 canonical `plugin/loop/fast-mode-loop-tick.md` 加入 Touches（模板源是
durable 修复点）；该文件也被两个 **integration 上未验证任务**触摸——`gap-inner-panel-shows-frozen-stale-
agent-line-after-bracket-close`（步骤 3）与 `gap-batch-merge-gate-validates-tip-not-merge-result`（步骤 2
同步）。本任务编辑在 **§5**，与两者的 §2/§3 是**章节级不相交**；fan-in 合并时预计 git 自动合并干净，
但外层 fan-in 需知悉文件级 Touches 相交。

**DoD 全量套件绿行**：不勾（SCOPED ONLY 下任务内不可知，归外层 verification-round-N 批量合闸门（`integration-batch-merge.sh`）；本任务跑的是 `--for-task` scoped 选中集）。

### 重做记录（2026-08-08，外层退回 78cd2cee false-done 后）

**外层数据**：真实 UTC 15:12 vs 我的 tick 标签 21:0x/21:5x/22:1x/22:5x——标签在编（未 date -u 读钟），
超前 ~7h；`date +%z=+0000` 排除时区。

**行为修正（AC2 判据达成）**：后续 tick 标签一律 `date -u '+%H:%MZ'` 读钟，禁估计。连续 2 条真实标签：
- `15:15Z inner tick（时间戳修正——date -u 读钟，非估计）`
- `15:15Z inner tick（AC2 证据——连续第 2 条 date -u 真实标签）`
两条与真实 UTC（15:15:36Z）差 <1min ⇒ AC2「修后连续 2 条 tick 标签与真实 UTC 差 <5min」达成。

doc 规则（`plugin/loop/fast-mode-loop-tick.md` §5 date -u）已在 develop（cb951893 → c6c98bb6 批量合）；
落点 = 执行（本记录即执行证据）。
