---
id: gap-task-status-parsing-reimplemented-13-sites
title: readTaskStatusAtRef 被逐字复制 3
  份（driver-filters/ready-pool-check/worker-driver），注释承认「是同一个判定」却从未统一——收敛为
  task-schema.ts 的单一导出
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  consolidates: 3
---
**type:** execution

## Proposal

**现场核实（2026-09-04 会话审计）**：`readTaskStatusAtRef(root, ref, taskId)` —— 同名、同体
（`git show <ref>:tasks/<id>.md` → `/^---\r?\n([\s\S]*?)\r?\n---/` → 取 `status:` 行）——
**被逐字复制 3 份，彼此零共享 import**：

- `plugin/scripts/driver-filters.ts:75-90`
- `plugin/scripts/ready-pool-check.ts:2016-2025`
- `plugin/scripts/worker-driver.ts:3018-3025`（async 变体）

`ready-pool-check.ts:1979` 的注释**自己写着**"worker-driver.ts's async readTaskStatusAtRef is the
same judgment"——**承认过，从未统一**。

**根因（不是疏忽，是接口缺口）**：`task-schema.ts` 的 `parseTask()` 其 doc 注释明写
"Limitation: parseTask projects only `{ labels, extra }`"——**故意不暴露 `status`**。于是每个需要
状态的消费者只能自己手搓；`task-contract-check.ts:367` 的注释甚至直接解释了为什么绕过
（"parseTask does not surface `status`"）。除上述 3 份逐字复制外，另有 ≥10 个文件各自手搓
`status:` 正则（`cap-counts-subagents-check.ts:338`、`needs-human-recheck.ts:173/182`、
`prod-data-audit.ts:324`、`touches-orthogonality-check.ts:447`、`task-ac-carryover-check.ts:184` 等
完全不 import task-schema.ts；`driver-filters.ts`、`ready-pool-check.ts`、`task-status-drift-check.ts`、
`task-contract-check.ts`、`worker-driver.ts` 则 import 了 task-schema.ts 做别的事、仍自己解析状态）。

**与既有 done 任务的关系（已查，非重复）**：`gap-driver-filters-readtaskstatus-stale-main-checkout`
（done）修的是**读哪个 ref**（陈旧主检出），把 `readTaskStatusAtRef` 当作可在文件间复制的**手法**处理，
**没有触及复制本身**。`gap-abi-status-lifecycle-vocab-scattered-no-named-type`（done）解决的是
**类型词汇**（`TaskStatus` 具名联合），不是**解析实现**的重复。

**修法方向**：给 `task-schema.ts` 补两个导出——`frontmatterStatus(fm)`（与既有
`frontmatterLabels`/`frontmatterExtra`/`frontmatterDependsOn` 同族的投影）与 `readTaskStatusAtRef`
（唯一实现，async 变体在同处提供），三个复制点改为 import。**本任务范围只收敛这 3 份逐字复制**；
另外 ≥10 个 ad-hoc 解析点作为后续批次（避免 Touches 宽到无法派发）。

## AC

- [ ] AC1（基线）：贴出三处复制的真实代码（`sed -n` 输出，含行号），证明它们确为同一判定的三份实现
- [ ] AC2：`task-schema.ts` 新增 `frontmatterStatus` 与 `readTaskStatusAtRef`（含 async 变体）导出；
      三个复制点改为 import，各自的私有实现删除
- [ ] AC3（收敛量可核验）：`grep -rn "function readTaskStatusAtRef\|const readTaskStatusAtRef"
      plugin/scripts/*.ts` 的定义处命中数从 **3 降到 1**（贴出改动前后两次命令的真实输出）
- [ ] AC4（行为不变）：三个调用方的既有测试全绿——`plugin/test/driver-filters*.test.mjs`、
      `plugin/test/ready-pool-check.test.mjs`、`plugin/test/worker-driver*.test.mjs`（贴通过输出）；
      特别核验 async 变体的调用点行为未变（worker-driver 常驻循环不得被同步化阻塞）
- [ ] AC5：`bash scripts/test.sh` 全量绿

## DoD

AC3 的改动前后 grep 输出（3→1）贴进任务体；三个调用方测试与全量套件绿。不是"加了个导出"就算——
必须证明三份私有实现**确实被删除**（定义处只剩 1 个），否则就是"加了第 4 份实现"。

## Touches

- plugin/scripts/task-schema.ts（新增两个导出）
- plugin/scripts/driver-filters.ts（删私有实现，改 import）
- plugin/scripts/ready-pool-check.ts（同上）
- plugin/scripts/worker-driver.ts（同上，async 变体）
- plugin/test/task-status-drift-check.test.mjs
- plugin/test/ready-pool-check.test.mjs
- tasks/gap-task-status-parsing-reimplemented-13-sites.md
