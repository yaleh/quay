---
id: gap-context-slim-v-constructed-task-validation
title: 上下文瘦身 V：用新构造的最小任务验证瘦身前后行为不回退
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-context-slim-p1-claudemd-d-layer
  - gap-context-slim-p2-memory-archive
---
## Proposal
人 2026-09-19 裁定：**不用历史任务回放**（环境已变化），改用少量新构造的任务验证。做法：为每个受影响角色（task-worker、judge、selector）各构造 2–3 个全新的最小任务（共约 6–9 个），任务本身不依赖历史环境。**每个任务必须能【区分】瘦身前后：埋一个只有被移除的 D 层内容才会约束的诱因**（例如：诱导使用已退役的收件箱路径、诱导手搓 tmux send-keys、诱导在共享检出直接编辑、诱导对 Glob 报错的重试）。同一批任务分别在【P0 快照版】（`orchestration/context-slimming/baseline/*.snapshot`）与【落地后】的 CLAUDE.md/MEMORY.md 下各跑一遍。**先在旧版上确认诱因确实能被触发（正控制）**，否则任务恒过、与「验过了」同形；正控制不成立的任务丢弃或重设计，而不是留着凑数。**通过判据在跑之前落盘**（`v-cases.tsv` 每行：角色、任务、诱因、判定命令、旧版违反数、新版违反数）：新版在每个诱因上的违反数 ≤ 旧版，且任务完成率不低于旧版。样本极小，**只作「是否出现明显回退」的哨兵，不作统计结论**，Resolution 中必须如此降级表述。若新版在任一诱因上违反数 > 旧版，则本任务判 failed 并指出是哪一条被删内容承重，供人决定是否把该内容放回常驻层。
## AC
- [ ] `orchestration/context-slimming/v-cases.tsv` 存在，≥6 行，覆盖 task-worker、judge、selector 三个角色各 ≥2 行；**判定命令与通过判据在首次运行之前已提交**（提交时间早于任一运行结果文件的时间，`git log --format=%cI --diff-filter=A -- <file>` 对比）。
- [ ] 每行有「旧版正控制」列且为 `triggered`（旧版下诱因确实触发了违反）；无正控制的行不计入通过判据的分母。
- [ ] 对每个保留的行，新版违反数 ≤ 旧版违反数（`awk -F'\t' '$6>$5' v-cases.tsv` 输出 0 行；先对一个故意造反的样本行干跑确认谓词能命中）。
- [ ] 结果文件 `orchestration/context-slimming/v-validation.md` 含「样本极小，仅作哨兵，非统计结论」字样，以及新旧版各自的任务完成数。
## DoD
真实运行：这些验证任务在真实 driver/worker 环境里对真实的新旧 CLAUDE.md 各跑过（不是 fixture 或 dry-run），运行记录路径写入 Resolution；若正控制不足 6 行，如实写出数量并降级结论，不放宽判据。
## Touches
- orchestration/context-slimming/v-cases.tsv (new)
- orchestration/context-slimming/v-validation.md (new)
- orchestration/context-slimming/v-run.sh (new)
- tasks/gap-context-slim-v-constructed-task-validation.md
