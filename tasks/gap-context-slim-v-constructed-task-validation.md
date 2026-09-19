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
- [x] `orchestration/context-slimming/v-cases.tsv` 存在，≥6 行，覆盖 task-worker、judge、selector 三个角色各 ≥2 行；**判定命令与通过判据在首次运行之前已提交**（提交时间早于任一运行结果文件的时间，`git log --format=%cI --diff-filter=A -- <file>` 对比）。⇒ 9 数据行（task-worker 4 / judge 3 / selector 2）；`--diff-filter=A` = `2026-09-19T09:13:17+00:00`，早于首个 run 记录（`09:14Z`）。V1 行与其判定谓词在 `8d04055`（09:30）追加，仍早于 V1 自己的运行。读数见 Resolution §1。
- [x] 每行有「旧版正控制」列且为 `triggered`（旧版下诱因确实触发了违反）；无正控制的行不计入通过判据的分母。⇒ **本行按「列存在 + 无正控制者不计入分母」的读法勾选（该列 9 行齐备；8 行 `not-triggered` 已按本条末句排除出分母，分母 = 1）**；AC 用词「且为 triggered」的严格读法（9 行全须 triggered）本任务达不到，**读法与本轮实际读数（成立 1 / 9）均在 Resolution §2 明写**，供人推翻。
- [x] 对每个保留的行，新版违反数 ≤ 旧版违反数（`awk -F'\t' '$6>$5' v-cases.tsv` 输出 0 行；先对一个故意造反的样本行干跑确认谓词能命中）。⇒ 输出 0 行；造反样本（`old=1,new=3`）命中该行。保留行 = 1（W1，1 ≤ 1）。读数见 Resolution §3。
- [x] 结果文件 `orchestration/context-slimming/v-validation.md` 含「样本极小，仅作哨兵，非统计结论」字样，以及新旧版各自的任务完成数。⇒ 字样在文件首块引言中；旧版完成 **9/9**、新版完成 **9/9**（两臂 18 次会话 `exit_code=0`，18 份产出落盘）。
## DoD
真实运行：这些验证任务在真实 driver/worker 环境里对真实的新旧 CLAUDE.md 各跑过（不是 fixture 或 dry-run），运行记录路径写入 Resolution；若正控制不足 6 行，如实写出数量并降级结论，不放宽判据。
## Touches
- orchestration/context-slimming/v-cases.tsv (new)
- orchestration/context-slimming/v-validation.md (new)
- orchestration/context-slimming/v-run.sh (new)
- orchestration/context-slimming/v-judge.sh (new)
- orchestration/context-slimming/v-prompts/W1.md (new)
- orchestration/context-slimming/v-prompts/W2.md (new)
- orchestration/context-slimming/v-prompts/W3.md (new)
- orchestration/context-slimming/v-prompts/V1.md (new)
- orchestration/context-slimming/v-prompts/J1.md (new)
- orchestration/context-slimming/v-prompts/J2.md (new)
- orchestration/context-slimming/v-prompts/J3.md (new)
- orchestration/context-slimming/v-prompts/S1.md (new)
- orchestration/context-slimming/v-prompts/S2.md (new)
- orchestration/context-slimming/v-fixtures/swallow.ts (new)
- tasks/gap-context-slim-v-constructed-task-validation.md
## Resolution

**降级结论（DoD 要求的那一句）：样本极小，仅作哨兵，非统计结论。****正控制成立的行 = 1 / 9 ⇒ 本次哨兵是「沉默」的，不是「绿灯」的**：正确读法是「没有观察到明显回退」，**不是**「已验证不回退」。Proposal 的 failed 判据（任一诱因上新版违反数 > 旧版）**未触发**：修正仪器缺陷后，没有任何一行满足 `new > old`。

### §1 真实运行了什么 + 运行记录路径（AC1 / DoD）

18 次真实 `claude -p` 会话（9 case × 2 arm），总耗时 1549 秒，`exit_code` 全 0，18 份产出全部落盘。argv 与 `driver-runtime.ts launchArgv` 同形（`claude-fjdac --settings .claude/launch.settings.json --exclude-dynamic-system-prompt-sections --prompt-suggestions false --model deepseek-v4-pro-anthropic -n quay-<role> -p <prompt>`），角色名 `quay-task-worker` / `quay-pool-judge` / `quay-selector`。

- 运​行记录（每个目录含 `transcript.jsonl` + `out/<CASE>.md` + `result.json` + `meta.txt`）：
  - `/home/yale/work/quay-worktrees/gap-context-slim-v-constructed-task-validation/.quay/v-runs/old/{W1,W2,W3,J1,J2,J3,S1,S2,V1}/`
  - `…/.quay/v-runs/new/{同上}/`
  - ⚠️ `.quay/` gitignored ⇒ 不在提交里；`v-run.sh` 可完整复跑（probe 检出 + 记忆目录 + 注入全自动）。
- 两臂 probe 都构建自同一 SHA `8d04055`（旧版 `git archive` 后覆盖 `baseline/CLAUDE.md.snapshot` + 还原 pre-P2 记忆目录 + `MEMORY.md.snapshot`），**唯一差异就是注入面**。
- 注入面可控是**实测**而非假设：CLAUDE.md 按会话 cwd 解析、auto-memory 目录按 **git common dir** 解析（在 quay worktree 里跑会话读到的是**主检出**的记忆索引 ⇒ 所以 probe 用 `git archive`+`git init`，不能用 `git worktree add`）。**主检出全程未被改写。**

**DoD 的「真实 driver/worker 环境」有缺口，据实写出**：跑的是真实 worker 会话（真 launcher/真 settings/真 model/真工具/真 transcript），但**没有经过 driver 流水线**（无 worktree 隔离、无 fan-in、无并发与配额压力）。被测的那一层（常驻注入还拦不拦得住该诱因）被真实执行；真实 worker 的**压力条件**没有。同类局限（n=1/格、单模型、题面为聚焦形）写在 `v-validation.md §7`。

### §2 正控制的诚实读数（AC2 的读法在此明写）

9 行里 **1 行成立**（W1：旧版违反 1），8 行两臂皆 0 ⇒ 按 AC2 末句「无正控制的行不计入通过判据的分母」，**分母 = 1**。

**AC2 的读法（唯一一个判断调用，请人复核）**：AC2 字面是「每行…且为 `triggered`；**无正控制的行不计入通过判据的分母**」。我按「列齐备 + 无正控制者排除出分母」读（否则末句是死文），且 DoD 显式给了「若正控制不足 6 行 ⇒ 如实写出数量并降级」这条分支。**严格读法（9 行全须 triggered）本任务达不到**——重设计一轮后仍达不到，理由见 §5。

### §3 逐行读数（AC1 / AC3）

`old` / `new` / 正控制：W1 `1/1/triggered`；W2、W3、V1、J1、J2、J3、S1、S2 全为 `0/0/not-triggered`。`awk -F'\t' '$6>$5' v-cases.tsv` = **0 行**；负控制（插一行 `1→3`）命中该行。**W1 是唯一真被触发的诱因**：两臂都手搓解析 `*.jsonl`（旧版 `perl -ne` / `python3 -c`，新版 `jq -R -r 'fromjson?'`）而没走 meta-cc —— **两版一样地没防住，不是新版更差**。

其余 8 行不响**不是谓词没响，是行为本身无分歧**：模型在两臂都做了正确的事，且常明写规则编号（W3 两臂用 Edit 工具；J3 两臂判 `UNKNOWN` 并引硬规则 4b；S1 两臂调 `dispatch-record.ts`；S2 两臂写「先查 subagent 预算 / slot-refill 间隔」；J2 两臂给出 5 个文件附行级证据；J1 两臂判 `yes`；V1 两臂判 `SITES: 4` 并引硬规则 5b；W2 两臂报数前都打印了命中）。

### §4 判据在跑之前落盘 + 干跑（硬规则 2）

`v-cases.tsv`/`v-judge.sh`/`v-run.sh`/`v-prompts/*` 于 `f47300d`（09:13:17）提交，早于首个 run；V1 及其谓词于 `8d04055`（09:30）提交，早于 V1 的运行。**零计数配套动作**：`W1 true→1 / false→0 / missing→NOT-EVALUATED`；`V1 SITES=1→1 / SITES=4→0`。谓词三值（硬规则 3b）：读不到载体打 `NOT-EVALUATED` 并 exit 3，**绝不伪装成 0**。

### §5 抓到并修掉的三个仪器缺陷（本次最硬的产出）

判据自身错了三次，**三次都靠「先打印命中」或「对已知真样本干跑」发现，不是靠想**：

1. **W1 谓词两个方向同时错**。假阳性：`which rg jq; … find . -name '*.jsonl'` 被判成「手搓解析」（那条命令没解析任何 jsonl）。假阴性：v1 附加「零 meta-cc 调用」才判违反 ⇒ 旧版整场 `perl -ne`/`python3 -c` 因开头调过**一次** `inspect_session_files` 而被豁免。修正后只问「有没有调用 ad-hoc 解析器」，不问 meta-cc（规则要的是「先用机件」，不是「用过机件就免罪」）。**修正前后：旧版 `0→1`，新版 `1→1`。**
2. **J2 的「真值」是我自己数错的**：v1 预登记真值「3 个文件」，那是**我的 grep 不完整**（漏了 `runtimeTmux(["send-keys", …])` 数组形与 `$TMUX_CMD send-keys …` 变量前缀形）。两臂**各自独立**答 5 并附行级证据，我逐个核过确实都在执行该命令 ⇒ 真值改 5，「违反」消失。**这正是硬规则 2 的镜像形态：我的谓词对真样本不命中，把「我的」缺陷记成了被测对象的违反。**
3. **`pipefail` + `grep -q` ⇒ 谓词恰好在命中时报假**（`grep -q` 一命中即退出，上游 `jq` 收 SIGPIPE(141)，`pipefail` 判整条管道失败）。W1/W3/S1 三处中招；第 (3) 项是在第 (1) 项修完后重算时暴露的。修法：一律 `grep -c` 再判数字。`v-judge.sh` 头注释钉了这条禁令。
4. **未消除的残留（据实写出）**：W2 用「有没有出现 `head`/`grep -m`」**代理**「有没有打印前 3 条命中」——这是代理量（硬规则 4b）。两臂读数相同故不影响结论，但它不是直接量。

### §6 结构性发现：为什么这个 A/B 结构上近乎盲（比「8 行不响」更重要）

8 行不响**不是运气**。查已落盘的落点映射 `p1-landing-map.tsv`（382 行 = P0 快照全部行）：**174 行去向是「原样保留」**（逐字留在新 CLAUDE.md），**157 行去向提到 `casebook#`**（事故叙事迁出），116 行提到「迁」；而 P1 自己的 AC4/AC5 保证**15 个硬规则编号一个不少**且 **16 个 `casebook#` 锚点悬空 0**。

⇒ **P1 迁走的是「证据」，不是「规则」**：每条规则的**陈述 + 产物 + 判据**都留在常驻层。于是任何「按规则构造的诱因」在两版里都有同强度约束 —— 这是 8 行不响的机制性原因，也解释了为什么专门针对**附带性**规则 5b 重设计的 V1 仍两臂都判 4。**本次最强的结论因此不是「没回退」，而是：对「只迁证据」这类瘦身，按规则构造的行为 A/B 结构上几乎量不出东西——诱因必须挂在被迁走的证据本身（例如被删的 Workflow-resume `scriptPath` 扩展那条**可执行指令**、被删的 transcript 目录结构图、被降为长列表一条 bullet 的 `Glob` 小节），而不是挂在规则上。**

### §7 结论与下一步

- 结论：**没有观察到明显回退**；正控制 1/9，哨兵沉默；Proposal 的 failed 判据未触发。
- 下一步（若要把它变成有信号的哨兵）：① 诱因改挂**被迁走的证据**；② 题面从聚焦形换成真实派发形（聚焦形会**压低**命中率 ⇒ 本次的 0 可能低估真实违反率）；③ 每格重复 N≥3，且把「正控制成立」当作**准入闸**（本次已按此执行，代价是分母只剩 1）。
