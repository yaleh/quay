---
id: gap-fake-suite-release-gate-sleep-zero
title: full-suite-runner.test.mjs 固定 sleep 换释放闸——fake suite 阻塞在「测试触碰释放文件」上，墙钟归零（Tier 1）
status: todo
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`full-suite-runner.test.mjs`（全套件最长文件 ~199s）里 ~15 处 fake suite 用固定 `sleep N`（3×`sleep 10`=30s + 一堆 1–5s）由 runner 活活等完，墙钟被硬等待顶高。改为 fake suite 阻塞在「测试触碰释放文件」上：in-flight / early-red 语义不变，硬等待墙钟归零。证据 :2651,:2679,:3374（sleep 10）及各 sleep 3/2/1 处（peer 两只读 subagent 逐行核）。

**⛔ 不可盲切 sleep 10→3**：那是 load-hardening 产物（注释明说 2s running window 在 16 路争用下 flake，特意加宽到 10s）。释放闸位法（释放文件信号）才安全等价。

## Plan

1. 逐个 fake suite 把固定 `sleep` 换成「轮询等待测试触碰的释放文件」（或等价信号），in-flight/early-red/terminal 三类语义不变。
2. ⛔ 不删测试换时间（每测一条 AC，flip-no-ac 闸守着）。

## Acceptance Criteria

- [ ] AC1（能取假）：fake suite 无固定 `sleep` 可归零 in-flight 窗口——grep 该文件无 `sleep 10` 等硬等待，改释放文件信号；（⛔ 仍硬 sleep ⇒ 假）。
- [ ] AC2（能取假）：early-red / in-flight / terminal 三类断言仍绿（scoped 跑该文件全绿）；（⛔ 任一类红 ⇒ 假）。
- [ ] AC3（能取假，墙钟）：scoped 该文件墙钟较基线显著下降（贴前后读数）；（⛔ 无下降 ⇒ 假）。

## Definition of Done

fake suite 释放闸替换落地；AC1-AC3 全勾；scoped 全绿 + 全量低conc 泳道 floor 较基线下降。

## Touches

- plugin/test/full-suite-runner.test.mjs（fake suite 固定 sleep → 释放闸）
- tasks/gap-fake-suite-release-gate-sleep-zero.md（自身）
