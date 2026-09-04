---
id: gap-malformed-task-silent-vanish-no-alert
title: 坏 frontmatter 静默移除任务——唯一信号是 task list stdout 一行 Warning，无任何检查读它（不可见与不存在同形，硬规则④）
status: done
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

- [x] AC1: 检查器对非空 `malformed`（或盘上数≠列出数）报错 + 打印每个被排除文件与原因
- [x] AC2: 挂进 run_static_checks（scoped tier 同面）
- [x] AC3: 负控制——`title: [封存]` 形态被检出（本次活样本）
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 负控制样例贴出（`[封存]` 形态被检出）
- [x] 全量套件绿

## Evidence

**负控制（`title: [封存] …` 形态被检出，活样本同形）**——`node plugin/scripts/malformed-task-check.ts --root <tmp-with-bad-task>` 输出（exit 1）：

```
FAIL: 1 task file(s) could not be parsed and are SILENTLY excluded from the store:
  BAD-1.md: Unexpected scalar at node end at line 2, column 13:

title: [封存] bare-dir thing
            ^^^^^^^^^^^^^^

  tasks dir: /tmp/…/tasks
```

**mutation case（L_S 仪器）**：`checker-mutation-cases/malformed-task-check.sh` → `--selftest` → `SELFTEST PASS: clean task stays green; the [封存] malformed shape goes red.`；`checker-mutation-check.sh --check` 全绿（27/27 covered，`MUTATION malformed-task-check: pass`）。

**scoped 门**：`scripts/test.sh --for-task gap-malformed-task-silent-vanish-no-alert --allow-thin` → 100 tests / 0 fail / exit 0；scoped 静态检查含 `malformed-task-check`（`@static-tier always` + `subset-touched`）全 PASS。

**与 57c30fdf 互补**：57c30fdf（gap-serve-task-list-dies-on-one-malformed-task）让 server/`task list` 对单文件容忍——一个坏 frontmatter 不再 500 整列表，只毒害自身行并打 Warning 到 stderr；本检查器把**同一个** malformed 信号变成测试套件的失败闸（消费 `store.listWithMalformed()`，与 `task list` Warning 同一生产者），不重写解析（硬规则 1），直接读 store 的 malformed 数组（硬规则 4b）。

## Touches

- plugin/scripts/malformed-task-check.ts（新：读取 store.listWithMalformed()，非空 malformed ⇒ 报错，打印每个被排除文件与原因）
- plugin/scripts/checker-mutation-cases/malformed-task-check.sh（新：mutation case，跑 --selftest）
- plugin/test/malformed-task-check.test.mjs（新：@test-group governance 单测）
- scripts/test.sh（注册进 run_static_checks：@static-tier always + @static-scoped-mode subset-touched）
- plugin/scripts/capability-catalog.sh（AC1c 五表声明 + invalidation）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 再生成）
- packages/quay/src/provider-client.ts（如需暴露 malformed 给检查器——本次未改：它已暴露 TaskListResult.malformed；检查器走 store.listWithMalformed()，与 task list 同一信号，更直接）
- tasks/gap-malformed-task-silent-vanish-no-alert.md（自身）
