# SPEC：常驻注入上下文瘦身 —— `CLAUDE.md` + auto-memory 的分层索引与渐进披露

**作者**：manager（由后台会话起草）｜**日期**：2026-09-19｜**状态**：**草案，待人裁定 §9 两个开放问题后立案**
**来源**：人 2026-09-19 指出"这些文件存在巨大冗余"并要求"基于近期会话历史分析实际高频/常驻信息，用索引做渐进披露，并评估影响"；本 SPEC 是该分析的落盘。
**数据窗口**：`~/.claude/projects/-home-yale-work-quay/` 近 14 天（至 2026-09-19），主会话 4425 + subagent transcript 324；记忆侧另含 18 个 worktree project 目录，共 5820 个 transcript。

---

## 0. 一句话

**每个会话现在都常驻注入约 78KB（`CLAUDE.md` 57KB + `MEMORY.md` 21KB），而历史显示绝大多数会话（无头 judge/selector/worker）几乎不消费它。目标：把常驻部分压到约 21KB（-73%），其余改为「索引 → 按需读」，并保证被删内容全部有家、被约束的行为不回退。**

## 1. 现状（实测，非估算，除标注处）

| 项 | 读数 |
|---|---|
| `CLAUDE.md` | 382 行 / 57,320 B；最长行 1491 字符；含日期或"实证/实例"叙事的行 67 条 |
| 其中「认识论硬规则」一节 | 188 行 = 49% |
| `MEMORY.md` | 90 行 / 20,880 B；索引行最长 561 字符（记忆规范上限约 150） |
| 记忆文件 | 537 个 / 2.5MB；目录仅约 17.6 天历史 |
| 每会话常驻注入合计 | ≈ 78KB（token 数为估算，未实测） |

**`CLAUDE.md` 的自相矛盾**：文件头声明"只放指针 + 不随代码过期的纪律，任何清单/命令块在此复制就是制造漂移"，而正文 49% 是带事故叙事的规则；SendMessage/tmux 的裁定链在「每轮必经」表、Tools 节、四条硬规则 #1、收件箱条目里出现 3–4 次；规则 3b/4/4b/4c 与推论一~四讲同一件事（恒真/自证/代理量取不了假）；已退役机制（收件箱、classic loop、outer 角色、`prepare-milestone`、`.halt`、`gap-ff-propagate`）带叙事留在正文，而归档里本已有正本。

## 2. 历史读数（决定分层的依据）

### 2.1 谁在吃这份注入

无头 `claude -p` 会话占绝大多数：judge 1322、selector 1191、task-worker 1190、meta-driver 236、gap-filing 226、fix-worker 53、workspace-agent 55；交互式仅 manager 46 + 真人 69。selector+judge 共 2513 个会话，平均 8–9 轮，却各背 57KB。

### 2.2 各角色开场靠什么（前 20 个工具调用）

不是 `CLAUDE.md`。selector：116/120 先读 `orchestration/dispatch-preference.md`；task-worker：`dispatch-worktree-setup.sh` / `task_get` / `git worktree add`；judge：`goals/*.md`；fix-worker：`touches-orthogonality-check.ts`。⇒ **各角色真正常驻的信息本就在各自 prompt / 专属文件里。**

### 2.3 规则被引用的形态（引用会话数）

- 高频、且以"标签 + 一句判据"形态出现：3b 884、4 743、推论三 539、5b 374、2 338、推论四 341、4b 267、12 219。抽样核对：**没有会话引用事故叙事本身**。
- 指针型内容最高频：`scripts/test.sh` 1699、worktree 约定 1679、`quay driver` 966、`quay:quay-task` 944。
- 近乎零引用：Split-decision 11；退役墓碑 13–54；C15 3、C30 4；推论一 33（推论间 16× 差距）。
- 规则在场 ≠ 有效：有 "Glob unavailable" 规则时该错误仍在 6 个文件出现；"String to replace not found" 在 49 个文件出现 ⇒ 这两类应改 hook/工具层，不靠文字。

### 2.4 记忆文件的读取（近 14 天，读数为**下限**）

- 537 个里 ≥226（42%）被读过，≥310（58%）从未被碰。**跨会话复用仅 195 个（36%）/ 795 次读**，91 个只被读 1 次；前 20 个占 46% 触达，前 40 个占 59%。
- 写入远超读取：每天新增 ≥35 个（2026-09-05 峰值 139），同期仅 195 个被复用。
- **索引是差的入口**：85 行里 33 行（6.3KB，30%）只指向从未被读的文件；312 个文件不在索引，其中 137 个照样被读到（靠 `grep`/`ls`/文件名）；11 个 `topic-*` 分片合计仅被读 20 次、5 个从未被读。
- 同名前缀聚类：43 个 ≥3 文件的簇共 278 个文件（task 23 / fan 18 / worker 17 / goal 15 / git 15…）。
- 抽样 10 个（仅指示性）：3 个代码行为描述（可从代码推出）、3 个环境陷阱（不可推出，须保留）、4 个事故教训/流程规则。
- 只保留热点直链的代价：直链 40 个覆盖 68% 跨会话读，60 个 77%，100 个 88%；其余多一跳，而该跳本就由 `grep`/`ls` 完成。

### 2.5 已知盲区（本 SPEC 的所有结论都要带着它们读）

「被引用」≠「被需要」，**无反事实对照**；规则 ID 常经任务正文传播，未必来自注入文本；泛词（`quay-worktrees`/`task_write`）抬高指针型行计数；角色靠首条 prompt 启发式判断，subagent 未分角色；hook/SendMessage 注入的读取在 transcript 不可见；变量/glob 拼出的记忆读取被低估；记忆布局在窗口内改过一次。

## 3. 目标与非目标

**目标**
- G1 常驻注入（`CLAUDE.md` + `MEMORY.md`）≤ 约 21KB（`CLAUDE.md` ≤ ~130 行 / 15KB；`MEMORY.md` ≤ 40 行 / 每行 ≤ 150 字符）。
- G2 被移出的内容**全部有家**（硬规则 5：验的是"全部有家"，不是抽查）。
- G3 行为不回退：无头角色的门禁通过率 / 规则违反数 / 轮数，不劣于旧版（见 §7 验证）。
- G4 增长机制被关掉：此后"每次事故加一段"无法静默回涨。

**非目标**
- 不改任何**裁定内容**（如 SendMessage 默认、tmux 仅作控制面）；只改表述位置与冗余。
- 不改三层执行核（`*-tick-core.md`）语义；不新增产品表层；不在共享检出里手改（走 `task_write` 立案 → worker）。
- 不追求最小字节：目标是「常驻的都是高频指针与不随代码过期的纪律」，不是压到极限。

## 4. 设计：三层 + 索引

### 4.1 `CLAUDE.md` 分层

| 层 | 放什么 | 载体 | 目标 |
|---|---|---|---|
| **A 常驻** | 规则 1、2、3b、4（含推论三、四）、4b、5b、10、12；4 条指针（`scripts/test.sh`、worktree 约定、`quay:quay-task`、`quay driver`）；Pre-Edit 一行 | `CLAUDE.md` 本体 | ~130 行 / 15KB |
| **B 按角色** | manager tick-core 与 SendMessage 表、规则 11 系列、4c、dispatch-record、分支同步（worker 也用 ⇒ A 留一行指针） | 对应 skill / 角色 prompt（manager 已有 `quay:manager-tick-core`） | 不常驻 |
| **C 仅索引** | 两节 Architecture、Reference、GIT checklist、`quay serve`、旧 tmux 机件、ADR-016 | `CLAUDE.md` 里每项一行「何时读 → 路径」 | 每项 1 行 |
| **D 删** | Split-decision、退役叙事与墓碑、Workflow-resume（`fan-in-execute` skill 已含 `scriptPath` 规则）、Glob 节 | 事故叙事 → `docs/epistemology-casebook.md`；退役 → `orchestration/archive/AC58-retired-clauses.md#R*` | 0 |

**规则合并**：3b/4/4b/4c 与推论一~四合成"读数可信度"一条，保留判据一句 + 产物路径；叙事进 casebook。规则文本保留原编号（**编号不得复用**，硬规则 8），被合并的编号在 casebook 里留"→ 见 X"。

### 4.2 `MEMORY.md` 分层

- 索引 ≤ 40 行、每行 ≤ 150 字符：**热点（最热 60 个直链，覆盖 77% 跨会话读）+ 每簇一个入口**。
- 33 条只指向从未被读文件的索引行删除。
- 分片 `topic-*`：合并为"每簇一个文件"，不再单独维护两套索引。
- **58% 从未被碰的文件先移入 `memory/archive/`（不删）**；环境陷阱类（不可从仓库推出）一律保留在主目录。
- 与 `CLAUDE.md` 已覆盖的记忆（如 quay-config gitignored、memory 目录跨层共享、meta-cc 手搓 grep）删记忆、留 `CLAUDE.md`。

### 4.3 渐进披露的入口约定

索引行统一形态：`- [标题](path) — 触发条件（何时读）`。**触发条件必须是可观察的动作/症状**（"改 touches 前""fan-in 红"），不是主题词——否则会话无法判断该不该读。

## 5. 防回涨（G4，必须有产物）

新增一个静态检查（接入既有静态检查套件，按 `new-plugin-checker-three-obligations` 三义务登记）：

- `CLAUDE.md` 行数 ≤ 上限、最长行 ≤ 上限；
- `MEMORY.md` 每行 ≤ 150 字符、总行数 ≤ 上限；
- **判定输出必须有「未评估」取值**（硬规则 3b）：读不到文件 ⇒ `NOT-EVALUATED`，不得与 PASS 同形；
- 检查器带一个**对已知违规真样本干跑必红**的 fixture（硬规则 2 零计数配套动作）。

## 6. 落点映射（G2，删除前的硬前置）

任何 ≥50 行的删除，必须**先产出映射表并贴进提交**：被删内容的**每一个**独有词条 → 新正本路径。不接受抽查。映射由一次机械对比产出：旧 `CLAUDE.md` 的每行 → {保留于 A / 移至 B 某 skill 某节 / 索引指针 / casebook 某锚点 / archive 某锚点 / 明确判定为纯重复(需列出重复位置)}；**任一行无去向 ⇒ 不许合并**。

## 7. 验证与影响评估

**估计（未实测，来自 fork 报告）**：`CLAUDE.md` 每次注入 -42KB ≈ -2 万 token；记忆 20.9KB → ~6KB；合计 ~78KB → ~21KB。14 天累计约 6e9 cache-read + 1e8 冷写 token，**为上界**（assistant 记录数是 API 调用数上界）。

**反事实验证（唯一能取假的对照，硬规则 4 推论四）**
1. **A/B 回放**：从历史挑一批 task-worker / judge / selector 任务，分别在旧/新 `CLAUDE.md` 下重跑；比较门禁通过率、规则违反数、轮数。**通过判据须事先写死**（如"新版违反数不高于旧版 + 门禁通过率不低于旧版 −X"，X 由人裁定，见 §9-2），否则是事后合理化。
2. **D 层先行**：D 层（零引用、可逆）先落地并观察，再动 A/B 层。
3. **记忆归档观察期 14 天**：`archive/` 里的文件若被 `grep`/Read 找回 ⇒ 立即移回并记为「误归档」；误归档率作为归档批次是否继续的判据。
4. **落地后再测一次**：用同一套读数（§2）在落地后窗口重测，与本 SPEC §1/§2 对比；**读数只计落地之后的时间窗**（硬规则 4 推论三：只能被 fixture 满足的判据不算测量）。

## 8. 分阶段与验收

| 阶段 | 内容 | 验收（每条为可运行判据） |
|---|---|---|
| P0 | 冻结基线：把 §1/§2 的读数脚本化落盘（可重跑），并快照旧 `CLAUDE.md`/`MEMORY.md` | 重跑得同一批读数（±窗口漂移）；脚本用 `/usr/bin/grep`（见 §10 陷阱） |
| P1 | **D 层**：删 Split-decision/退役叙事/Workflow-resume/Glob；事故叙事迁 casebook；产出并提交落点映射（§6） | 映射覆盖旧文件 100% 行；`wc -l CLAUDE.md` 下降；scoped 静态检查绿 |
| P2 | 记忆归档：删 33 条死索引行；58% 未触及文件移 `archive/`；同簇合并 | `MEMORY.md` ≤ 40 行 / 每行 ≤ 150 字符；`archive/` 与主目录文件数之和 = 537（无静默丢失） |
| P3 | **B 层**：manager 专属纪律迁 skill；A 层合并规则 | A/B 回放（§7-1）通过；manager 一轮 tick 读取集不缺项 |
| P4 | 防回涨检查（§5）接入静态套件 | 检查器对真违规样本必红、对合规样本绿、读不到输入 ⇒ `NOT-EVALUATED`；**其自身 AC 至少一条读生产载体**（硬规则 4 推论三），不得只靠 fixture |
| P5 | 落地后重测（§7-4） | 常驻注入 ≤ ~21KB；误归档率 / 违反数不劣于基线 |

## 9. 开放问题（需人裁定，立案前必须回答）

1. **范围**：先只做 P1 + P2（D 层 + 记忆归档，可逆、低风险），还是直接按完整方案 P0–P5？**起草者倾向前者**，P3–P5 视 P1/P2 观察期读数再立案。
2. **A/B 回放是否占用真实 worker 预算**，以及"不劣于旧版"的容差 X。若不做回放，则 P3（动 A/B 层）只能靠上线后监控——起草者认为**这不足以支撑改动规则本体**，建议 P3 以回放通过为前置。

## 10. 风险与陷阱

- **裁定内容被无意改写**：本 SPEC 只动位置与冗余；每条迁移都要能在 §6 映射里指出"原文 → 新位置"，人可逐条核对。
- **环境陷阱**：本环境 `grep` 被 ugrep 包装（带 `--ignore-files`），对 `~/.claude/jobs/` 下文件**静默返回空**；所有历史读数脚本一律 `/usr/bin/grep`，零计数先对已知真样本干跑（硬规则 2）。
- **写入路径**：`CLAUDE.md` 属 doc 分支写面，改动须走 worktree → 任务分支 → fan-in，并核 `git show develop:CLAUDE.md` 可见（分支同步纪律）；后台会话不得在共享检出里直接编辑。
- **记忆目录跨层共享**（见记忆 `memory-directory-shared-across-layers`）：P2 归档期间其他层可能同时读写，须在无活跃 manager tick 的窗口内做，并在归档后核对 537 守恒。
- **Claude Code 特性依赖**：按路径条件加载的 `.claude/rules/*.md`、`claudeMdExcludes` 等是否可用取决于版本，**未在本环境验证**；采用前先实测，不可用则退回 skill/指针方案，不因此阻塞 P1/P2。

## 11. 数据来源与复现

原始明细表（会话内产物，任务结束即随 job 清理，**立案时须落盘到仓库**）：`~/.claude/jobs/61f5f1f9/tmp/claudemd/`（`final-usage.tsv` 规则组×角色、`first20-agg.tsv` 各角色开场调用、`pattern-by-role.tsv`、`claude-sections.tsv`、`REPORT.md`）与 `~/.claude/jobs/61f5f1f9/tmp/memory/`（`file-usage.tsv`、`index-lines.tsv`、`foreign.json`）。P0 负责把生成这些表的脚本化并入库，使本 SPEC 的读数可重跑。
