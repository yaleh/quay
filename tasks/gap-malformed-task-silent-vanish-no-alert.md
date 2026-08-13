---
id: gap-malformed-task-silent-vanish-no-alert
title: 坏 frontmatter 静默移除任务——唯一信号是 task list stdout 一行 Warning，无任何检查读它（不可见与不存在同形，硬规则④）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**活样本（2026-08-13，我自己的任务）**：`gap-touches-bare-dir-reject-outright.md` 的 `title: [封存] bare-dir …`
被 YAML 当 flow sequence（`[` 开 `]` 关，`]` 后正文成「意外标量」）⇒ 整个 frontmatter 解析失败：
```
$ quay task list → Warning: 1 task file(s) could not be parsed and were excluded:
  gap-touches-bare-dir-reject-outright.md: Unexpected scalar at node end at line 2, column 13
盘上 .md = 1075 · task list 列出 = 1074 · slot-refill 命中 = 0
$ quay task edit … --status needs-human → "task does not exist yet"
```
**根因（manager 逐字复现）**：`YAML.parse('title: [封存] X')` FAIL / `title: "[封存] X"` OK。

**后果 = 硬规则④ 形状**：一个坏 frontmatter 把任务从整个 store **静默移除**——ready-pool-check /
slot-refill / 池计数全都看不见它，也不报错。**它以「封存成功、不在池里」的样子待着，而真相是「它不存在」——
两者在所有读数上同形**。这次是 manager 恰好去改状态才撞见；没人去动它就一直藏着。

**仪器已经在，缺的是消费者**：store 已把 malformed 文件记进 `malformed` 字段
（`packages/quay/src/provider-client.ts:33 malformed: MalformedTask[]`；`task list` stdout 打一行 Warning；
crash 问题已被 `gap-one-unparseable-task-takes-down-the-whole-board` + `gap-serve-task-list-dies-on-one-malformed-task` 修掉）。**但没有任何检查读这个字段**——一个非空 `malformed` 不会让任何读数变红。

## Plan（最小机件——不新机制，接上已有信号）

1. 检查器读 `quay task list` 的 `malformed` 字段（或比对盘上 `.md` 数与列出数）：
   **非空 / 不相等 ⇒ 报错，并打印每个被排除文件与解析原因**。
2. 挂进 `run_static_checks`（scoped tier 同面）。
3. 负控制：本次活样本（title 带 `[封存]`）被检出。

## AC

- [ ] AC1: 检查器对非空 `malformed`（或盘上数≠列出数）报错 + 打印每个被排除文件与原因
- [ ] AC2: 挂进 run_static_checks（scoped tier 同面）
- [ ] AC3: 负控制——`title: [封存]` 形态被检出（本次活样本）
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 负控制样例贴出（`[封存]` 形态被检出）
- [ ] 全量套件绿

## Touches

- plugin/scripts/（新增检查器：malformed 非空 ⇒ 报错）
- packages/quay/src/provider-client.ts（如需暴露 malformed 给检查器）
- tasks/gap-malformed-task-silent-vanish-no-alert.md（自身）
