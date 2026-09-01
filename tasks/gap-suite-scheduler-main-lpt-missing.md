---
id: gap-suite-scheduler-main-lpt-missing
title: suite LPT+dispatch 3 套复制粘贴重构成 1 套循环+组表——main 组漏 LPT 致长文件晚启动长尾
status: needs-human
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

waterline-scheduler（`gap-suite-dynamic-waterline-scheduler`，done）落地后，main 组长文件晚启动长尾回归。**根因不是「漏一行 main LPT」，是 LPT 排序 + 传 scheduler 两处各复制粘贴 3 套（serial/lowconc/main），3 套独立演化 ⇒ main 组有机会漏。**

**现状（逐行核实）**：
- **full-suite**：LPT 只排 serial/lowconc（`:1086-1087` `lpt_reorder_files serial_files` / `lowconc_files`），dispatch 3 套独立循环（`:1102-1104` `for _schf in "${serial_files[@]}"` / `lowconc_files` / `files`）——main 组既没 LPT、又靠第 3 套循环传参。
- **bucket**：同构，LPT 只排 `bucket_serial_files` / `bucket_lowconc_files`（`:1640-1641`），dispatch 3 套（`:1649-1651`）——`bucket_main_files` 漏 LPT。
- **legacy fallback**：`lpt_reorder_files files` 出现在 `:1163`（MAIN_TAIL_OVERLAP 分支）与 `:1254`（main phase）——两处都是「if 前该统一排却漏了」后打的补丁，重构统一后变冗余。

**数据证据（driver development progress 实测）**：落地后首轮 main 组最长文件 `checker-mutation-check.test.mjs` 启动 offset ≈ 240.2s、短文件 0s——长文件晚 240s 先跑短文件，违反原任务 AC1「组预算队列相内 LPT」。

**正确机制（人裁定）**：3 套复制粘贴重构成 1 套循环 + 组定义表——组表一次性声明 serial/lowconc/main 三组，LPT 与 dispatch 各一个循环遍历组表，main 组从此结构上不可能再漏。bash 先例已具备：`declare -A` @`:800`、`local -n` nameref @`:938`（`lpt_reorder_files` 本身就是 nameref），无新特性。

## Plan

full-suite 与 bucket 两路径各把 LPT + dispatch 3 套合并成 1 套：

```bash
declare -A _group_arr=([serial]=serial_files [lowconc]=lowconc_files [main]=files)
for _g in serial lowconc main; do
  declare -n _arr="${_group_arr[$_g]}"
  lpt_reorder_files _arr
  for _f in "${_arr[@]}"; do printf '%s\t%s\n' "$_g" "$_f"; done
  declare +n _arr
done
```

1. **full-suite**：替代 `:1086-1087`（LPT）+ `:1102-1104`（dispatch）。
2. **bucket**：替代 `:1640-1641`（LPT）+ `:1649-1651`（dispatch），组表用 `bucket_serial_files` / `bucket_lowconc_files` / `bucket_main_files`。
3. **关键约束**：LPT 排序保持「`if [ QUAY_SUITE_SCHEDULER ]` 之前」（legacy fallback 分支共享 serial/lowconc LPT 语义），dispatch 在 if 内。
4. **冗余清理**：重构后 main LPT 自动补齐，legacy `:1163`（MAIN_TAIL_OVERLAP 分支）+ `:1254`（main phase）的 `lpt_reorder_files files` 变冗余（if 前已统一）——删。
5. **不在范围**：`select_files`（收集）有时机差异（lowconc 提前 hoist 为 overlap 并行），非纯复制粘贴，不动。
6. **验证**：跑全量 suite——main 相长文件（checker-mutation-check 等）offset 回 0 附近；legacy `QUAY_SUITE_SCHEDULER=0` 路径行为不变（pass/fail-neutral）。

## Acceptance Criteria

- [ ] AC1（能取假，机制级）：full-suite 与 bucket 两路径 LPT+dispatch 各重构为 1 套循环 + 组定义表，组表覆盖 serial/lowconc/main 三组——grep 无 3 处独立 `for _*f in "${..._files[@]}" ... printf ... done` dispatch 块，而见 `declare -A _group_arr` 组表 + 单循环遍历；（⛔ 仍 3 处复制粘贴 ⇒ 假）。
- [ ] AC2（能取假，冗余清理）：legacy `:1163` + `:1254` 的 `lpt_reorder_files files` 删除（if 前已统一 LPT）；（⛔ 残留冗余调用 ⇒ 假）。
- [ ] AC3（能取假，生产载体，硬规则 4 推论三）：落地后时间窗内，全量轮 main 组最长文件启动 offset 回 0 附近（与短文件差消除，不再 240s 量级），N 只计落地后轮次；（⛔ 用落地前轮冒充 ⇒ 假）。
- [ ] AC4（能取假，无回归）：legacy `QUAY_SUITE_SCHEDULER=0` 路径同文件集同断言 pass/fail 结果一致（重构只改调度表达，不改测试集/断言）。

## Definition of Done

LPT+dispatch 3 套重构为 1 套循环+组表（full-suite + bucket 各一）；legacy 冗余 `lpt_reorder_files files` 清理；AC1-AC4 全勾；全量 suite 绿；main 长文件 offset 回 0 附近实测；legacy 路径 pass/fail-neutral。

## Touches

- scripts/test.sh（LPT+dispatch 重构 1 套循环+组表；legacy 冗余 `lpt_reorder_files files` 删除）
- tasks/gap-suite-scheduler-main-lpt-missing.md（自身）

## Needs-Human

**执行 2026-09-01T02:46:42.926Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: suite red
