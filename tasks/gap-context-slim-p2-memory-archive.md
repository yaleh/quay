---
id: gap-context-slim-p2-memory-archive
title: 上下文瘦身 P2：MEMORY.md 压成热点索引并归档从未被读的记忆文件
status: done
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
- [x] 文件守恒：归档后 `find ~/.claude/projects/-home-yale-work-quay/memory -type f -name '*.md' | wc -l`（含 archive/ 子目录、含 MEMORY.md）等于归档前该数（归档前数值记入 manifest 头部），无静默丢失；对归档前后各跑一次并把两个数贴进 Resolution。
- [x] `awk 'END{print NR}' ~/.claude/projects/-home-yale-work-quay/memory/MEMORY.md` ≤ 40，且 `awk '{ if (length($0)>150) c++ } END{print c+0}'` 为 0（先对旧快照 `orchestration/context-slimming/baseline/MEMORY.md.snapshot` 跑同一谓词应 >0，证明谓词能命中）。
- [x] `MEMORY.md` 中每个 `](path)` 链接目标文件都存在（断链数 0，逐条枚举而非布尔）。
- [x] `p2-archive-manifest.tsv` 每行的「归档前读取次数」经 P0 脚本重算均为 0（即归档的都是近 14 天从未被读的），抽查前 3 行核对。
- [x] 环境陷阱类文件未被归档：manifest 中不含 `claude-plugin-disable-keeps-the-key`、`remote-control-endpoint-is-anthropic-base-url` 两个已知样本（`/usr/bin/grep -c` 为 0；先对一个含它们的临时文件干跑确认谓词能命中）。
## DoD
真实落地：在真实记忆目录上完成，`MEMORY.md` 已为热点索引，`archive/` 存在且文件数与 manifest 行数一致；观察期起点（日期）写入 manifest 头部，观察期 14 天内若归档文件被找回则移回并记为「误归档」。
## Touches
- orchestration/context-slimming/p2-archive-manifest.tsv (new)
- orchestration/context-slimming/p2-archive-selfcheck.sh (new)
- tasks/gap-context-slim-p2-memory-archive.md
## Resolution
**权限**：`~/.claude/projects/-home-yale-work-quay/memory/` 可写（`touch` probe 通过）⇒ 不转 needs-human。
**窗口**：归档时 `find <memory-dir> -newermt '-6 hours'` 为空、`orchestration/manager-tick-log.md` 末次写 2026-08-31 ⇒ 无活跃 manager tick。归档于 2026-09-19T07:12Z。

**AC1 文件守恒**（同一条命令，归档前后各一次）：
- 归档前 `find ~/.claude/projects/-home-yale-work-quay/memory -type f -name '*.md' | wc -l` = **543**
- 归档后 同命令 = **543**（manifest 头部 `files_before=543` / `files_after=543`；`archive/*.md` = **352** = manifest 数据行数 352）
- 全部用 `mv`，未删任何文件。
- ⚠️ **检出时该命令返回 546 而非 543**：07:18Z 另一个会话往共享记忆目录新写了 3 条记忆（`backticked-path-anchor-…` / `doc-only-task-scoped-gate-needs-allow-thin` / `ifs-tab-read-collapses-…`），**是增长不是丢失**。AC1 的谓词是「归档前后各跑一次」，其两个读数就是 manifest 头部的 `files_before`/`files_after`（543/543，`--apply` 退出前自断言相等）；把「目录永远等于 543」当判据会让这条 AC 在它自己描述的多层共享环境里不可满足。`--check` 因此改为四段：①边界守恒（543==543）②`archive/` 与清单行数一致 ③352 行原路径全部已不在原位 ④`now >= files_after`，**增长只报尺寸不判红**。

**AC2 索引形状**：
- 新 `MEMORY.md`：`awk 'END{print NR}'` = **40**（≤40）；`awk '{ if (length($0)>150) c++ } END{print c+0}'` = **0**
- 旧版同谓词 = **58**（95 行 / 22334 B）⇒ 谓词能命中
- AC 指定的对照：`baseline/MEMORY.md.snapshot` 同谓词 = **56** > 0
- 结构：11 个 topic 簇入口 + `**热点直链**` + 热点直链。**40 行上限把 Proposal 的「最热 60 直链」压到 52**（26 行 × 2 链接）——这是行数上限的函数，已量出，不是漏做。
- ⚠️ **另一个会话在 07:18Z 追加了一行**（三个新记忆挤在一行，202 字符，超限）。三个长文件名单独就占 158 字符 ⇒ 任何三链接行都过不了 150，故拆成两行；同时**撤掉读数最低的一对**（`gap-task-required-headings` / `filing-four-artifacts-min-40-chars`，合计 7 次，两者都能从 `topic-filing` 到达）以守住 40 行。**该索引是多写者共享文件，40 行是每个写者都要守的预算**——追加前不核预算是本次唯一一次超限的成因，`--check` 的 AC2 就是抓它的仪器（它抓到了）。

**AC3 链接**：**64** 条 `](path)` 逐条枚举（`--check` 每条打印 OK），断链 **0**。

**AC4 归档前读取次数**：`p2-archive-selfcheck.sh --check` 以 readings.sh 的同一谓词逐文件重算，352 行全部 `reads_now=0` 且 `recorded=0`；前 3 行：
- `a22-heartbeat-must-pass-cap-5.md` reads_now=0 recorded=0
- `absence-assertion-keyed-on-a-value-literal-becomes-tautology.md` reads_now=0 recorded=0
- `ac-criterion-carrier-path-must-match-code-declared-name.md` reads_now=0 recorded=0
- **互校**：本脚本重算出的 distinct 读取集 148 == `readings.sh memory_files_read_14d` 148；不等则报 INSTRUMENT FAILURE，不单方面取信其一。

**AC5 环境陷阱**：manifest 上 `/usr/bin/grep -c` 两个样本均 **0**（exit 1）；对照——对含这两个样本的临时文件干跑同一谓词命中 **2/2** ⇒ 这个 0 是测出来的，不是谓词失灵。
未归档的 42 个陷阱类文件用**显式名单**（`p2-archive-selfcheck.sh` 的 `TRAP_EXCLUDE`）而非关键词匹配：关键词版首跑把 `page-census-counts-shared-chrome`（serve 页面外壳）、`quay-init-config-heredoc-is-unquoted`（本仓自己的 heredoc）、`dispatch-worktree-node-modules-symlink` 等 25 个本仓可推导文件误判为陷阱，逐个读过后剔除。另有 6 个 `topic-*.md` 分片按 clause ① 保留（它们就是新索引的簇入口，归档它们会让 ① 与 ③ 互斥）。

**④ 去重**：`quay-config-yml-is-gitignored`、`memory-directory-shared-across-layers`、`meta-cc-main-session-query-is-fresh-dont-handgrep` 三条已被 CLAUDE.md 覆盖且从未被读 ⇒ 随归档移入 `archive/`，reason 列写 `never-read-14d;covered-by-CLAUDE.md`（3 行，可 grep 审计）。

**结果**：`bash orchestration/context-slimming/p2-archive-selfcheck.sh --check` → **11 PASS / 0 FAIL / 0 NOT-EVALUATED，VERDICT GREEN**；`--apply` 幂等（重跑 moved=0 / already_in_place=352）。

**观察期**：起点 2026-09-19 写入 manifest 头部 `observation_start`；找回处置写在同一头部 `misarchive_policy`（移回 + 追加一行 reason 含 `misarchive`），不靠记忆。
