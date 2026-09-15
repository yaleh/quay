---
id: EXIST
title: repro title
status: ready
labels: []
parent: null
children: []
extra: {}
---
## Finding

本任务对象不是一个真实工作项，而是 2026-09-14 一次「已存在 id 的 create」复现留下的残留。

复现想在一次性目录里建这个 id，命令行上用 `--tasks-dir` 把 store 指到别处；`task create` 不认这个
参数，未知参数被静默忽略，store 于是按仓库根解析，把文件写进了本工作区的真实任务目录。
复现脚本随后删掉了工作树里的文件，但该对象已被 CLI 提交（b4c6e8b41，提交信息
`tasks: EXIST task_write by cli:1216183`）。

已核的三条读数（每条都能取假）：

1. 对该文件的 git log 只有 b4c6e8b41 一条 —— 无实现提交、无 fan-in 提交。
2. 全仓任务体里把它当 parent 或 depends_on 引用的命中数 = 0。
3. 本对象没有段落、没有验收判据、没有完成定义、没有 Touches —— 按现状不可能被当作可执行工作。

因此本任务的真实工作只有一件：把这个残留对象处置掉（或写明保留理由），让 todo 池里不再有
一个从不打算被执行的条目。

<!-- dedup-ref -->
相关但不同：`gap-quay-native-task-create-duplicate-id-prepends-frontmatter`（已 done）是那次复现所
验证的缺陷本身；本条处置的是复现留下的残留对象 —— 对象、判据、落点都不同，不重复立案。

## Acceptance Criteria

- [ ] AC1: **出处已核**——对该文件的 git log 只返回立案那一条提交（无实现提交 / 无 fan-in 提交），原始输出贴进体内。
- [ ] AC2: **无依赖者已核**——全仓对 parent / depends_on 指向本 id 的命中数为 0，并附谓词对照（计数为 0 时要拿一个已知为真的样本干跑同一个谓词）。
- [ ] AC3: **处置已落（读盘，非自述）**——本对象已从 store 移除，或保留理由在体内成段可见；处置后 todo 列表不再把本 id 列为工作。

## Definition of Done

- [ ] AC1–AC3 全部勾上，每条证据 = 命令 + 原始输出片段，贴在任务体内。
- [ ] 处置读数是盘上状态：本文件已不存在（或保留理由成段），且 ready-pool 的目标化判定不再把本 id 当候选。
- [ ] 本任务自始至终只动 Touches 里那一个文件，未触碰任何其他任务体或代码。

## Touches

- tasks/EXIST.md（本任务自身的对象：处置落点）
