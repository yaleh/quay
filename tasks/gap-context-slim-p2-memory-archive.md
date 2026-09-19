---
id: gap-context-slim-p2-memory-archive
title: 上下文瘦身 P2：MEMORY.md 压成热点索引并归档从未被读的记忆文件
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-context-slim-p0-baseline-readings
---
## Proposal
近 14 天读取历史（下限读数，5820 个 transcript）：537 个记忆文件中至少 310 个（58%）从未被碰；跨会话复用仅 195 个（36%）；前 40 个占 59% 触达，最热 60 个直链可覆盖 77% 的跨会话读取；`MEMORY.md` 85 行索引里 33 行（6.3KB，30%）只指向从未被读的文件；312 个文件不在索引里，其中 137 个照样被读到（靠 grep/ls/文件名），说明多数读取不经过索引；11 个 topic-* 分片合计仅被读 20 次；写入速度每天新增 ≥35 个。本任务：①`MEMORY.md` 压成 ≤40 行、每行 ≤150 字符：最热 60 个文件直链 + 每个主题簇一个入口；索引行格式 `- [标题](path) — 触发条件`，触发条件必须是可观察的动作/症状（「改 touches 前」「fan-in 红」），不是主题词；②删掉 33 条只指向从未被读文件的索引行；③从未被触及且**不属于环境陷阱类**（无法由代码/仓库推出的，如 `claude plugin disable` 保留 key、Remote Control 端点）的文件，**移入 `memory/archive/`（只移动，绝不删除）**；④已被 CLAUDE.md 覆盖的记忆（quay-config gitignored、memory 目录跨层共享、meta-cc 手搓 grep）去重。**操作对象在仓库之外**（`~/.claude/projects/-home-yale-work-quay/memory/`），故所有移动必须在仓库内落一份清单 `orchestration/context-slimming/p2-archive-manifest.tsv`（原路径 → 新路径 → 原因 → 归档前读取次数）作为可审计记录，并写在无活跃 manager tick 的窗口（记忆目录被多层共享）。**若 worker 无权限写该目录外路径，则本任务转 needs-human，不要绕过。** 明细数据源：P0 的读数脚本；原始分析表在会话临时目录、会随会话清理，故以 P0 脚本重算为准，不依赖它们。
## AC
- [ ] 文件守恒：归档后 `find ~/.claude/projects/-home-yale-work-quay/memory -type f -name '*.md' | wc -l`（含 archive/ 子目录、含 MEMORY.md）等于归档前该数（归档前数值记入 manifest 头部），无静默丢失；对归档前后各跑一次并把两个数贴进 Resolution。
- [ ] `awk 'END{print NR}' ~/.claude/projects/-home-yale-work-quay/memory/MEMORY.md` ≤ 40，且 `awk '{ if (length($0)>150) c++ } END{print c+0}'` 为 0（先对旧快照 `orchestration/context-slimming/baseline/MEMORY.md.snapshot` 跑同一谓词应 >0，证明谓词能命中）。
- [ ] `MEMORY.md` 中每个 `](path)` 链接目标文件都存在（断链数 0，逐条枚举而非布尔）。
- [ ] `p2-archive-manifest.tsv` 每行的「归档前读取次数」经 P0 脚本重算均为 0（即归档的都是近 14 天从未被读的），抽查前 3 行核对。
- [ ] 环境陷阱类文件未被归档：manifest 中不含 `claude-plugin-disable-keeps-the-key`、`remote-control-endpoint-is-anthropic-base-url` 两个已知样本（`/usr/bin/grep -c` 为 0；先对一个含它们的临时文本干跑确认谓词能命中）。
## DoD
真实落地：在真实记忆目录上完成，`MEMORY.md` 已为热点索引，`archive/` 存在且文件数与 manifest 行数一致；观察期起点（日期）写入 manifest 头部，观察期 14 天内若归档文件被找回则移回并记为「误归档」。
## Touches
- orchestration/context-slimming/p2-archive-manifest.tsv
- orchestration/context-slimming/p2-archive-selfcheck.sh
- tasks/gap-context-slim-p2-memory-archive.md
