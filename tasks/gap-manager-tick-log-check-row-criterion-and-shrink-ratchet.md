---
id: gap-manager-tick-log-check-row-criterion-and-shrink-ratchet
title: "manager-tick-log-check.sh 行判据只认旧格式 + 无缩水基线——最近 24 轮 tick 行没被数进，277→5 行缩水静默 PASS"
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

**AC5b 挂载点 `plugin/scripts/manager-tick-log-check.sh` 有两个机械缺口：行判据与近期写入脱钩、无缩水基线。触发是 manager 2026-08-09 00:22 一次自身操作失误（read-modify-write 单行式把 `orchestration/manager-tick-log.md` 截成 0 字节，全文丢失），已从 git 基线（46ba6360^，154 条）+ 会话转录（122 条）重建 277 行并留「重建边界」注释块。失误 manager 自认；下面两条是与失误分开的机制缺口（manager 实测，外层已复核）。**

1. **行判据只认旧格式**：`manager-tick-log-check.sh:72` `TICK_ROWS=$(grep -cE '^\| *20[0-9]{2}-' ...)` ——只数 `| 2026-…` 开头的行。但 manager 的 tick 行自 08-07 16:5x 起已是 `| HH:MMZ` 格式。**实测（外层 00:3x）**：旧格式 155 行、新格式 24 行 —— **最近 24 轮的 tick 行一条都没被数进**。判据①「至少一行 tick 行」当前 PASS 靠的是两天前的历史行 + mtime 新鲜度，已与近期实际写入脱钩。
2. **无缩水基线**：全文 grep `shrink/baseline/wc -c` **0 命中**。只有截到「一条旧格式行都不剩」才被判据①逮住；**277→5 行缩水（保留若干旧格式行）静默 PASS**。又因 manager tick log 是 untrack（人裁定 46ba6360，`git ls-files`=0，外层复核确认），**git 没有兜底**。

**后果**：manager tick log 被截（全截或部分截）时，检查器可能静默 PASS——「上一轮 tick 落没落行」的机械答案与真实状态脱钩；正是 00:22 那次事故的形态（虽然后来靠人发现）。

**修的方向（实现归内层，方向外层/manager 已定）**：
- 候选 A：**行判据认两种格式**——`TICK_ROWS` 同时数 `^\| *20[0-9]{2}-`（旧）与 `^\| *[0-9]{2}:[0-9]{2}Z`（新），新格式-only 的日志也能通过判据①。
- 候选 B：**缩水棘轮（只减不增即报红）**——照搬 test-framework-policy 豁免表那套 count-ceiling 形状：行数基线，低于基线报红。**约束**：基线必须放在**不受同一截断影响**的地方（manager tick log 本身是 untrack 且可能被截——基线若在 log 内则被同一截断带走，棘轮即被同一把刀击败；须 git-tracked sidecar 或检查器内常量，inner 定机制）。
- 候选 C：**挂载到外层 tick**——外层 tick step-1 观察每轮跑它（自动调用者；挂载点归属外层已定 2026-08-09，见 Dispatch review）。

**验证锚**：修后，(a) 新格式-only 的日志（构造）判据①通过；(b) 行数低于基线（构造缩水）报红；(c) 外层 tick 每轮实际跑它（`--json` 可读）。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 00:22 截断触发 + 两层实测（旧格式 155 / 新格式 24 / shrink grep 0 命中 / git ls-files=0）（本任务 Proposal 已含；内层补构造复现 fixture：旧格式-only、新格式-only、缩水日志三种输入）
- [ ] AC2: **行判据认两种格式**——`TICK_ROWS` 同时数新旧两格式，新格式-only 日志判据①通过（实跑验证）
- [ ] AC3: **缩水棘轮（只减不增即报红）**——行数低于基线报红；基线不受同一截断影响（git-tracked sidecar 或检查器常量，非 log 内）；277→5 缩水构造必报红
- [ ] AC4: **挂载到外层 tick**——外层 tick step-1 每轮跑 `manager-tick-log-check.sh --json`（自动调用者，不再手工）；fail 时外层按既有升级通道处置
- [ ] AC5: **不破坏既有语义**——stale-hours 判据（mtime 新鲜度）保留；既有通过路径（旧格式历史行 + 新鲜 mtime）不误报红

## Definition of Done

- [ ] AC1–AC5 全部勾上（按选定候选：A+B+C）
- [ ] 修后实跑：三种构造输入（旧-only/新-only/缩水）判据输出符合预期，贴任务体
- [ ] 既有 manager-tick-log-check 相关测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——批量合边界闸门，归外层验证轮

## Touches

- plugin/scripts/manager-tick-log-check.sh（行判据 + 缩水棘轮）
- plugin/test/（manager-tick-log-check 相关测试 + 新增三输入 fixture 测试）
- orchestration/orchestrator-loop-tick.md（候选 C：step-1 观察加一行跑它）
- orchestration/manager-tick-log.md（重建边界注释块——参考/回归锚，非主改面）
- tasks/gap-manager-tick-log-check-row-criterion-and-shrink-ratchet.md（自身：勾 AC + 贴证据）

## Contract

measure   both_formats_counted = `bash plugin/scripts/manager-tick-log-check.sh --json` 对新格式-only 日志（构造）的 tickRows
band      both_formats_counted = > 0（新格式行也被数进，判据①通过）
invariant shrink_only_reports_red = 1（行数低于基线 ⇒ ok:false，非静默 PASS）
invariant baseline_survives_truncation = 1（基线不在被截的 log 内，同一截断不带走基线）
invoke    `bash plugin/scripts/manager-tick-log-check.sh --json`（对三种构造输入实跑贴回）
control   新格式-only ⇒ 判据①通过；行数缩水 ⇒ 报红；stale-hours 照旧
resume    行判据 + 棘轮 + 挂载 + 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager 两条已核实机械缺口 + 挂载归属问我裁；外层复核三条全属实：行判据只认旧格式 / 无缩水基线 / 无自动调用者）
**挂载归属裁定（outer）**：挂到外层 tick step-1（每轮 `--json` 跑）。理由：(a) 外层 tick 已每轮读 manager-tick-log.md 消费 manager 产出，检查是顺路；(b) 外层是独立观察层——manager 自检有「写的人就是破坏的人」盲区（00:22 正是）；(c) 与 monitor-mount-check / loop-driver-check 同挂外层 tick 的模式一致。实现归内层（Touches 含 orchestrator-loop-tick.md），外层在派发前核对挂载行。
