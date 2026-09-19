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
- [x] `cmp orchestration/context-slimming/baseline/CLAUDE.md.snapshot <(git show develop:CLAUDE.md)` 与 MEMORY.md 快照对 `~/.claude/projects/-home-yale-work-quay/memory/MEMORY.md` 的 `cmp` 均退出 0（快照取自 P1/P2 落地之前）。
- [x] `bash orchestration/context-slimming/readings.sh` 退出 0，且输出含 `claude_md_lines=`、`claude_md_bytes=`、`memory_index_lines=`、`memory_files_total=`、`memory_files_read_14d=` 五个键，`claude_md_lines` 等于快照的 `wc -l`。
- [x] 零计数配套：`bash orchestration/context-slimming/readings-selfcheck.sh` 退出 0；它先对一个已知含 ≥1 次 Read 的真 transcript 样本断言 `memory_files_read` ≥1，再对不存在的记忆目录断言输出 `NOT-EVALUATED` 而非 0。
- [x] 脚本中不含裸 `grep ` 调用（`/usr/bin/grep -c '^[^#]*[^/]grep ' orchestration/context-slimming/readings.sh` 的命中前 3 条已人工核对为注释或路径内）。
## DoD
真实运行：在生产载体（真实 `~/.claude/projects/-home-yale-work-quay/` 记忆目录与 transcript）上跑 `readings.sh`，输出粘贴进本任务 Resolution，且 `memory_files_total` 与 `ls` 实数一致（不是 fixture 数据）。
## Touches
- orchestration/context-slimming/readings.sh (new)
- orchestration/context-slimming/readings-selfcheck.sh (new)
- orchestration/context-slimming/baseline/CLAUDE.md.snapshot (new)
- orchestration/context-slimming/baseline/MEMORY.md.snapshot (new)
- plugin/skills/init/SKILL.md (declaration-point fix, see ## Evidence)
- plugin/skills/manager/SKILL.md (declaration-point fix, see ## Evidence)
- tasks/gap-context-slim-p0-baseline-readings.md
## Resolution
落地分支 `task/gap-context-slim-p0-baseline-readings`（已合 develop）。scoped 门绿：`bash scripts/test.sh --for-task gap-context-slim-p0-baseline-readings --allow-thin` exit 0（选中 0 个测试文件，全部静态检查 PASS）。

### 产物
| 文件 | 说明 |
|---|---|
| `orchestration/context-slimming/baseline/CLAUDE.md.snapshot` | 382 行 / 57320 字节，逐字节等于 `git show develop:CLAUDE.md` |
| `orchestration/context-slimming/baseline/MEMORY.md.snapshot` | 93 行 / 21617 字节，逐字节等于生产记忆索引（见「基线重拍」） |
| `orchestration/context-slimming/readings.sh` | 读数：常驻注入体量 + 记忆目录 + 窗口内被 Read 工具打开过的记忆文件数 |
| `orchestration/context-slimming/readings-selfcheck.sh` | 三臂自检：真样本 / 缺失输入 / 空语料负控制 |

### DoD：生产载体真实运行
`--repo-root` 指向实际被注入的那份检出，`memory_dir` / `transcripts_dir` 取默认的生产路径：

```
$ bash orchestration/context-slimming/readings.sh --repo-root /home/yale/work/quay
repo_root=/home/yale/work/quay
memory_dir=/home/yale/.claude/projects/-home-yale-work-quay/memory
transcripts_dir=/home/yale/.claude/projects/-home-yale-work-quay
claude_md_lines=382
claude_md_bytes=57320
claude_md_longest_line=1533
memory_index_lines=93
memory_index_bytes=21617
memory_index_longest_line=590
memory_files_total=541
memory_files_read_14d=147
lookback_days=14
```

`memory_files_total` 与 `ls` 实数一致（同一时刻三个独立读法）：

```
readings.sh memory_files_total                      = 541
ls -1 ~/.claude/projects/-home-yale-work-quay/memory | wc -l = 541
find <同上目录> -type f -name '*.md' | wc -l        = 541
```

⇒ 541 是生产实数而非 fixture 数据。被 Read 的记录载体是 `~/.claude/projects/<hash>/**.jsonl`（含 `subagents/`），不是 `~/.claude/jobs/`。

### AC 逐条核实
1. `cmp baseline/CLAUDE.md.snapshot <(git show develop:CLAUDE.md)` → exit 0；`cmp baseline/MEMORY.md.snapshot <生产 MEMORY.md>` → exit 0。合并 develop 后重跑仍均 exit 0（develop 未动 `CLAUDE.md`）。
2. `bash readings.sh` exit 0；五个键各命中 1 次；`claude_md_lines=382` 等于快照 `wc -l` = 382。
3. `bash readings-selfcheck.sh` exit 0，三臂全 PASS：
```
PASS  arm 1 (true sample): memory_files_read_14d=1 >= 1
PASS  arm 2 (missing memory dir): all 5 memory_* keys read NOT-EVALUATED, none read 0
PASS  arm 3 (empty corpus): memory_files_read_14d=0 (genuine zero) while memory_files_total=541
```
arm 1 的样本是**生产语料里真实的 transcript**（`0007c7c9-….jsonl`，逐字节拷进临时语料，未伪造），窗口由样本自身最老记录推出（`--days 7`）而非钉死，故样本老化不会让它假红。arm 3 是额外负控制：语料真实存在但为空 ⇒ 必须给**真零**；它与 arm 2 合起来证明脚本能区分「查过没有」与「没查成」。
4. AC4 谓词命中 **0** 条。零计数配套（硬规则 2）：同一谓词对一个已知含裸 `grep ` 的样本干跑 ⇒ 命中 2 条（`x=$(grep foo bar)` 与 `#grep commented`）⇒ 谓词会响，故 0 是真零而非死谓词。脚本中每一处都写作 `/usr/bin/grep`。

### 自检的可证伪性（双向突变对照）
两个正臂各做一次突变，确认它们**不是恒绿**：
- `readings.sh` 抽取模式改成永不匹配 ⇒ arm 1 **FAIL** `memory_files_read_14d=0, expected >= 1`，exit 1。
- 删掉 `count_memory_files` 的「目录不存在」守卫（退化为静默 0）⇒ arm 2 **FAIL** `expected NOT-EVALUATED, got: memory_files_total=0`，exit 1。
- 未突变 ⇒ 3/3 PASS，exit 0。

### 基线读数释义（供 P1/P2 对照）
- 常驻注入体量：`CLAUDE.md` 382 行 / 57320 字节 / 最长行 1533 字节；`MEMORY.md` 93 行 / 21617 字节 / 最长行 590 字节。
- 记忆目录 541 个文件，近 14 天被 Read 工具打开过的 **147** 个（≈27%）。该值是**下限**：由 Bash 用变量拼路径发出的读取（`cat "$MEMDIR/x.md"`）不计入。
- 窗口比较器用**记录自身的 `timestamp`**，不是文件 mtime——只按 mtime 会多算 2 个（会话今天被追加，但那次读取发生在 14 天以前）；该差值已实测。

### 基线重拍（2026-09-19 本轮，只重拍 MEMORY.md）
AC1 第二半是对**活的生产索引**做 `cmp`。该索引由 auto-memory 机制按设计持续增长（每次会话记一条记忆即增一行），故快照的「cmp 相等」只在**拍摄那一刻**成立。本轮复核时快照已落后 3 行/737 字节，`cmp` exit 1。

**判定：这是判据的时间脆弱性，不是产物缺陷，也不是要用改判据来解决的问题。**
- 先证明产物**忠实**：`diff 快照 生产索引` = **3 处插入、0 处删除** ⇒ 快照的每一行都原样仍在生产索引中，只是生产索引又长了 3 条（第 10、18、93 行各插一条；非改、非删）。
- 因此按「改实现，不改 AC」（`ac-parenthetical-conflict-restore-ac-not-rewrite-it`）处理：**重拍** `baseline/MEMORY.md.snapshot` 为当前生产索引（逐字节 `cp`）。任务 Plan 的原文即「把**当前** `CLAUDE.md`、`MEMORY.md` 原样快照进仓库」，重拍正是该措辞的字面实现；且 P1/P2 **仍未落地**，重拍后的快照依然是合法的「P1/P2 之前」基线，冻结性质自本次拍摄起不变。`CLAUDE.md` 快照**未动**（它对齐 repo 内的 `develop:CLAUDE.md`，本就稳定且仍相等）。
- ⛔ 未改任何 AC 文本。

### 未覆盖
- P1/P2 未落地：本任务只冻结基线，未改动 `CLAUDE.md` / `MEMORY.md` 一个字节。
- `memory_files_read_14d` 键名按 AC2 固定为 `_14d`，即使 `--days` 取别的值；实际窗口始终由 `lookback_days=` 报告。
- **AC1 第二半的残留脆弱性（观察项，未阻塞）**：判据钉在一个按设计持续变化的活文件上，任何晚于拍摄时刻的复核都可能红。本轮用「重拍」满足它，但下一轮复核仍可能红。若要根治，应由**判据作者**改成时间稳定形（如「`diff 快照 索引` 无删除行」——本轮实测该形态为 0 删除行且可证伪：手改快照任一整行即红）。工作层无改判据授权，故只记录。
## Evidence
- **本轮续做未改一字节实现**：5 个 commit 与 4/4 AC 均为上一轮产物（`task_check` 复核 `ok:true, acTotal 4, acChecked 4`）。本轮只解决上一轮 `step=suite: # fail 45` 的真实根因。
- **根因是 develop 侧，不是本任务 delta**（一条命令可复现）：在**干净 develop 树**上跑同一 checker ⇒ exit 1。判定动作：`git archive develop | tar -x -C /tmp/devchk-spec && cd /tmp/devchk-spec && node --experimental-strip-types plugin/scripts/spec-declaration-point-check.ts` ⇒ `FAIL: 2 missing SPEC declaration(s) across 2 declaration points`。本分支 `git diff develop...HEAD --name-only` 只有声明的 4 个文件，**不含 `plugin/skills/**`**。
- **影响面是全局的**：该检查在静态面 fail-closed ⇒ 整轮 suite `# tests 0 / # fail 45`（一个测试都没跑），**每个**任务的 fan-in 都会被它中止，不只是本任务。
- **无 owner 可等**（这是选择就地修复而非等待的依据）：`tasks/` 中无任何任务引用该 SPEC；`git log --all -S 'context-injection-slimming' -- plugin/skills/` 命中 0 ⇒ 无在飞修复；同族 P1/P2/V 的 Touches 均不含 `plugin/skills/**`。
- **修复内容由 develop 既有事实唯一决定**（故登记 Touches 不是范围漂移）：init 侧列表按文件名字典序 ⇒ 唯一插入位置在 `SPEC-complete-delivery-surface-2026-08-05.md` 与 `SPEC-cut-the-waiting.md` 之间；manager 侧索引按落地顺序追加 ⇒ 追加到末尾，与上一条 SPEC 的先例提交 `cfb2664aa`（`declare SPEC-quay-init-reconcile at both SPEC declaration points`）同形；manager 侧描述取自 SPEC 自身的标题与裁定行。
- **修复后**：`node --experimental-strip-types plugin/scripts/spec-declaration-point-check.ts` ⇒ `PASS: all 45 orchestration/SPEC-*.md declared at each of 2 declaration points`，exit 0。

### 本轮（2026-09-19 第二次续做）：suite 红是新成因，且与本任务 delta 无关
- **上一轮记的 `# fail 45` 已消失**（静态面已由本分支修复）；本轮 suite 红是**另一条**：`plugin/test/fan-in-execute-paths-s12.test.mjs` 的 `⑧⑩ 锁等待负控制`，断言 `the suite must run to exit 0 after acquiring the freed slot, got: `（**got 为空串**）。
- **发生率（硬规则 12，查历史而非等下一轮）**：`.quay/fan-in-suite-*.log` 共 131 份，其中含该测试的 56 份，该断言失败**仅 1 次**（即本轮）⇒ ≈1.8%，属**罕见抖动**而非系统性断裂。
- **对照（可证伪，硬规则 4 推论四）**：单独跑该文件 ⇒ **PASS 2/2**（`node --test plugin/test/fan-in-execute-paths-s12.test.mjs`）⇒ 不依赖并发也不依赖本任务 delta 即通过。delta-relatedness 检查亦标 UNRELATED（该文件不在本任务 Touches，其直接 import 与本任务 delta 无一跳交集）。
- **机制已定位（读代码，非猜测）**：`plugin/test/helpers/fan-in-execute-paths-harness.mjs:514` 的等待原语以**文件存在**为准——`fs.watch(dir, () => { if (fs.existsSync(markerPath)) finish("marker"); })`；而写入方 `plugin/workflows/fan-in-execute.js` 的 `SUITE_LAUNCH` wrapper 用 `printf … > "$4"`，该重定向**先 O_TRUNC 建出空文件、后写入**。二者之间是一个真实窗口：`IN_CREATE` 触发 ⇒ 等待原语判「marker 到了」⇒ 测试 `readFileSync` 读到**空串**。宿主高载（当时 load 14–21）加宽该窗口。可证伪形态：`exists && size>0` 才算到。
- **⛔ 未就地修它，理由是范围与可验证性**：该文件不在本任务 Touches；且本任务的 scoped 门选中 **0 个测试文件**，改这个共享 harness 后**没有任何本任务能跑的门会验证它**（只有全量 suite 能验证，而 worker 不跑全量 suite）⇒ 那将是「落地一个未被验证的共享改动」，比不修更坏。故只记录，交判据作者/后续任务处理。