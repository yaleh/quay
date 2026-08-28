---
id: gap-loop-shipping-ac1b-walk-enoent-race
title: loop-shipping.test.mjs AC1b walkCorpus 并发修改竞态——并行测试删 tmp 文件致 readFileSync
  ENOENT 崩（suite 假红）
status: todo
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

`loop-shipping.test.mjs` AC1b（全仓扫「5 旧路径无 live 引用」）的 `walkCorpus` 遍历与 `fs.readFileSync` 之间存在**并发修改竞态**：并行测试（`run-identity-selftest-*`）在 worktree `tmp/` 下建临时目录（含 `.claude/workflows/execute-milestone.js`）又删掉，AC1b 遍历到该文件时 `readFileSync` 抛 ENOENT ⇒ 测试崩溃假红（非「命中旧路径」断言）。

**实证（2026-08-28）**：gap-adr034-fan-in-lock-holder-supervised 机械 fan-in suite 第 3 次 one-off，AC1b 失败错误为 `Error: ENOENT: no such file or directory, open '.../tmp/run-identity-selftest-AF4aE6/.claude/workflows/execute-milestone.js'` at `loop-shipping.test.mjs:132:20`。独立跑（单测 `--test-name-pattern AC1b` / 整文件）全绿，仅并行 suite 下触发 ⇒ 时序依赖竞态。

**非 adr034 缺陷**：adr034 实现未引用 5 旧路径（其改动 11 文件 grep 5 旧路径 0 命中），suite 3591/3592 通过；失败纯属 AC1b 扫描面未容忍「文件被并行测试删除」。此测试族已有 6 个预存任务（`gap-loop-shipping-*`），本任务为该族**又一新表现**（并发修改竞态，区别于既有：archive 排除/.quay 排除/worktree 排除/live 引用/threshold-scope/consumer-laid），不折叠进既有任务。

## Plan

1. `walkCorpus` 或 AC1b 遍历循环加 **ENOENT 容忍**：`readFileSync` 捕获 ENOENT 即跳过（文件已被并行测试删除 = 瞬时文件，非真实引用）——⛔ 只吞 ENOENT，其它错误仍上抛（硬规则 3b：不把「读不懂」伪装成「合格」）。
2. 或把 worktree `tmp/`（测试临时目录）从 corpus 排除——需核对是否影响必要扫描面（`tmp/` 不应含真实旧路径引用）。
3. 负控制：真「命中旧路径」仍被捕获（不因容忍 ENOENT 而放过真实引用）。

## Acceptance Criteria

- [ ] AC1（能取假，ENOENT 容忍）：并行删除文件场景下 AC1b 不再崩 ENOENT（⛔ 仍崩 ⇒ 假）。
- [ ] AC2（能取假，真实引用仍捕获）：构造真实旧路径引用仍被 AC1b 报红（⛔ 容忍致漏报 ⇒ 假）。
- [ ] AC3（能取假，不吞其它错误）：非 ENOENT 的 readFileSync 错误仍向上抛（⛔ 吞掉 ⇒ 假）。

## Definition of Done

AC1b 在并行 suite 下不再因 ENOENT 假红；真实旧路径引用仍被捕获；全量 suite 绿。

## Touches

- plugin/test/loop-shipping.test.mjs（walk 循环 ENOENT 容忍 / 或 tmp/ 排除）
- plugin/scripts/loop-shipping-exclusion-data.mjs（若走排除路径）
- tasks/gap-loop-shipping-ac1b-walk-enoent-race.md（自身）