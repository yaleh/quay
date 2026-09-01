---
id: gap-suite-scheduler-main-lpt-missing
title: 统一调度器漏 main 组 LPT 排序——main 组长文件晚启动长尾（waterline-scheduler 落地后回归）
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

waterline-scheduler（`gap-suite-dynamic-waterline-scheduler`，done）统一调度器只对 serial/lowconc 组调 `lpt_reorder_files`，**漏了 main 组**：

- **full-suite 路径**（`scripts/test.sh:1086-1087`）：只 `lpt_reorder_files serial_files` + `lpt_reorder_files lowconc_files`，main 组（`${files[@]}`，调度循环 `for _schf in "${files[@]}"` :1105）未 LPT 排序；
- **bucket 路径**（`scripts/test.sh:1640-1641`）：只 `lpt_reorder_files bucket_serial_files` + `lpt_reorder_files bucket_lowconc_files`，main 组（`${bucket_main_files[@]}` :1646）未 LPT 排序；
- **legacy fallback**（:1163）原经 `lpt_reorder_files files` 对 main 排序——被调度器替换时丢失（该调用在 `MAIN_TAIL_OVERLAP>0` 分支内，调度器早退后不再执行）。
- **误导注释**（:1094）：「The group lists are LPT-ordered by the lpt_reorder_files calls above」——「group lists」含 main，但实际只排了 serial/lowconc，注释声称的范围比实现广。

**数据证据（driver development progress 实测）**：scheduler 落地后首轮，main 组最长文件 `checker-mutation-check.test.mjs` 实际启动 offset ≈ 240.2s，短文件 offset = 0s——长文件晚 240s 先跑短文件 ⇒ main 组 LPT 未生效，违反原任务 AC1「组预算队列相内 LPT」，主相长尾回归。

**根因**：调度器引入时只迁移了 serial/lowconc 两组的 LPT 调用，main 组的 LPT（legacy 的 `lpt_reorder_files files`）未迁移到调度器早退分支之前。

## Plan

1. full-suite 路径（:1087 后）加 `lpt_reorder_files files`（main 组 LPT，在调度器早退分支 `QUAY_SUITE_SCHEDULER=1` 之前）。
2. bucket 路径（:1641 后）加 `lpt_reorder_files bucket_main_files`。
3. 修 :1094 注释——「group lists」改为「serial/lowconc/main 三组」（或明确点名三组均已 LPT，不含混的「above」泛指）。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：full-suite 与 bucket 两路径均对 main 组 LPT 排序——grep `lpt_reorder_files files`（full-suite main）与 `lpt_reorder_files bucket_main_files`（bucket main）各出现且位于对应调度器 `QUAY_SUITE_SCHEDULER` 分支之前；（⛔ 缺 main 排序 ⇒ 假；⛔ 只排 serial/lowconc ⇒ 假）。
- [ ] AC2（能取假，生产载体，硬规则 4 推论三）：实现落地后时间窗内，全量轮 main 组最长文件启动 offset 回 0 附近（与短文件 offset 差消除，不再 240s 量级长尾），N 只计落地后轮次；（⛔ 用落地前轮冒充 ⇒ 假）。

## Definition of Done

main 组 LPT 补齐（full-suite + bucket 两路径）；注释修正；AC1-AC2 全勾；全量 suite 绿；main 组长文件 offset 回 0 附近实测（落地后轮）。

## Touches

- scripts/test.sh（main 组 LPT 补齐：`lpt_reorder_files files` + `lpt_reorder_files bucket_main_files`；注释修正）
- tasks/gap-suite-scheduler-main-lpt-missing.md（自身）
