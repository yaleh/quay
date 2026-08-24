---
id: gap-worker-driver-cold-start-inflight-refresh
title: worker-driver 冷启动在飞集合一次计算不刷新 ⇒ 冷启动 worker 完成后其 task 永久假在飞不可派（重立案：原
  gap-worker-driver-cold-start-inflight-blind 只修症状）
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**核实结论（manager 2026-08-24 08:0xZ 读码，非印象）**：`gap-worker-driver-cold-start-inflight-blind`（done，AC1/AC2 全勾）只修了症状。`enumerateColdStartInflight()` 实现本身观测式（枚举 task worktree + /proc cmdline 比对，正确），**但调用点 `worker-driver.ts:1121` 是 `const coldInflight = ...`，在 `while(true)`（:1189）之前，只算一次、全生命周期不刷新**（该标识符全文仅 4 处：:1121 定义 / :1122 读 / :1123+:1125 打印；注释自陈「计算一次…本驱动对其整个寿命内都不再派发」）。

**残留缺陷**：一个冷启动 worker 完成后，其 task 仍永久留在排除集 ⇒ 假在飞 ⇒ 该任务在此 driver 余生不可被派发。**原 AC 只测「冷启动 ⇒ 不重复派发」单方向**，没测「冷启动 worker 结束 ⇒ 其 task 应重新可派」——硬规则 5b（只修被报出来的那一个方向）。

**⛔ 发生率 = NOT-EVALUATED，不是 0**（硬规则 6 + ③b 零计数复核）：该诊断发射点是 `if (json && coldInflight.size>0)`，而生产 driver argv 无 `--json`（实测 pid 4044391 只有 --root/--pid-file/--run-id）⇒ 该诊断在生产结构上从不发射 ⇒ 日志 0 命中是「量从未被记录」不是「从未发生」。

## Plan

`running` + `coldInflight` 改为**每趟 pass 现观测**（扫活 worker 进程 + worktree 派生），不再是循环外快照 + 内存数组（SPEC §5.2 `actual = observe()`）。附带：机制的自我可观测性在生产被 `--json` flag 关掉，观测结果应落一个生产可见载体（非仅 --json）。

## Acceptance Criteria

- [x] AC1（能取假，原有方向）：冷启动 worker 在跑 ⇒ 不重复派发其 task（⛔ 重复派发 ⇒ 假）。
- [x] AC2（能取假，承重条·原任务缺的那半）：冷启动 worker **结束**后其 task 重新可派——构造「冷启动发现 worker → worker 退出 → 断言该 task 离开排除集可被派发」；⛔ task 仍留排除集 ⇒ 假。
- [x] AC3（能取假，现观测）：`actual` 每趟 pass 由扫活进程/worktree 派生（⛔ 循环外 `const coldInflight` 快照仍存在 ⇒ 假）。

## Definition of Done

running + coldInflight 现观测化落地 develop；AC1-3 全勾；一个冷启动 worker 结束后其 task 在同一 driver 进程内重新可派（AC2 复现，不重演假在飞不可派）。

## Touches

- plugin/scripts/worker-driver.ts（enumerateColdStartInflight 调用点 :1121 → 每趟 observe）
- plugin/test/worker-driver.test.mjs（AC1-3 双向复现）
- tasks/gap-worker-driver-cold-start-inflight-refresh.md（自身）