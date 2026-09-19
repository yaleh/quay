---
id: gap-context-slim-p0-baseline-readings
title: 上下文瘦身 P0：冻结基线快照并把常驻注入读数脚本化
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
背景：`CLAUDE.md`（382 行/57KB）与 auto-memory `MEMORY.md`（90 行/21KB，背后 537 个记忆文件）每会话常驻注入，近 14 天历史显示大多数无头会话几乎不消费它们。瘦身（后续任务 P1/P2）之前必须先冻结基线，否则无法证明「改后不劣于改前」，且历史读数会随 job 清理而丢失。本任务只做两件事：①把当前 `CLAUDE.md`、`MEMORY.md` 原样快照进仓库；②把「常驻注入体量」与「记忆文件被读取情况」的读数写成可重跑脚本。**所有 grep 必须用 `/usr/bin/grep`**——本环境 `grep` 被 ugrep 包装，对 `~/.claude/jobs/` 下文件静默返回空，会产出假零计数。脚本对无法读取的输入必须输出独立取值 `NOT-EVALUATED`，不得输出与合格同形的 0。
产物放 `orchestration/context-slimming/`：`baseline/CLAUDE.md.snapshot` 与 `baseline/MEMORY.md.snapshot`（快照当前内容，逐字节一致）；`readings.sh` 输出：CLAUDE.md 行数/字节/最长行、MEMORY.md 行数/字节/最长行、记忆目录文件总数（记忆目录 = `~/.claude/projects/-home-yale-work-quay/memory/`）、近 N 天（参数，默认 14）内被 Read 工具读过的记忆文件数（下限，注明不含 Bash 变量拼路径）；`readings-selfcheck.sh` 对已知真样本与已知缺失输入各干跑一次。
## AC
- [ ] `cmp orchestration/context-slimming/baseline/CLAUDE.md.snapshot <(git show develop:CLAUDE.md)` 与 MEMORY.md 快照对 `~/.claude/projects/-home-yale-work-quay/memory/MEMORY.md` 的 `cmp` 均退出 0（快照取自 P1/P2 落地之前）。
- [ ] `bash orchestration/context-slimming/readings.sh` 退出 0，且输出含 `claude_md_lines=`、`claude_md_bytes=`、`memory_index_lines=`、`memory_files_total=`、`memory_files_read_14d=` 五个键，`claude_md_lines` 等于快照的 `wc -l`。
- [ ] 零计数配套：`bash orchestration/context-slimming/readings-selfcheck.sh` 退出 0；它先对一个已知含 ≥1 次 Read 的真 transcript 样本断言 `memory_files_read` ≥1，再对不存在的记忆目录断言输出 `NOT-EVALUATED` 而非 0。
- [ ] 脚本中不含裸 `grep ` 调用（`/usr/bin/grep -c '^[^#]*[^/]grep ' orchestration/context-slimming/readings.sh` 的命中前 3 条已人工核对为注释或路径内）。
## DoD
真实运行：在生产载体（真实 `~/.claude/projects/-home-yale-work-quay/` 记忆目录与 transcript）上跑 `readings.sh`，输出粘贴进本任务 Resolution，且 `memory_files_total` 与 `ls` 实数一致（不是 fixture 数据）。
## Touches
- orchestration/context-slimming/readings.sh (new)
- orchestration/context-slimming/readings-selfcheck.sh (new)
- orchestration/context-slimming/baseline/CLAUDE.md.snapshot (new)
- orchestration/context-slimming/baseline/MEMORY.md.snapshot (new)
- tasks/gap-context-slim-p0-baseline-readings.md
