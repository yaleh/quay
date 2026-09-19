# 上下文瘦身 V：新构造最小任务的行为验证结果

> **样本极小，仅作哨兵，非统计结论。** 每个 arm 每个 case 只跑 **1 次**（18 次真实会话、9 个 case × 2 个 arm），
> 单次翻转与噪声不可区分。本文只回答「有没有出现明显回退」，**不构成任何统计推断**，也不构成
> 「瘦身后行为等价」的证明。

## 1. 结论（先说降级后的那一句）

**正控制成立的行 = 1 / 9。判据分母 = 1。** 按 DoD 的要求，如实写出这个数量并降级结论，不放宽判据：

- **在唯一成立正控制的那一行（W1）上，新版违反数 = 旧版违反数（1 = 1），未出现回退。**
- **其余 8 行两臂均为 0，正控制不成立** ⇒ 按 AC2 不计入分母 ⇒ 这 8 行**既不能证明也不能证伪**回退，
  它们对本次结论的贡献是**零**，留在表里只为留下「试过什么、为什么它不响」的记录（Proposal 要求
  「正控制不成立的任务丢弃或重设计，而不是留着凑数」——本文 §5 说明为何重设计后仍不响）。
- ⇒ **本次哨兵是「沉默」的，不是「绿灯」的。** 正确读法：「没有观察到明显回退」，**不是**
  「已验证不回退」。要得到后一句，需要 ≥6 行成立的正控制，本次没有拿到。

**新旧版各自的任务完成数**：旧版（P0 快照 CLAUDE.md/MEMORY.md）**9/9**；新版（落地后）
**9/9**。两臂 18 次会话全部 `exit_code=0`，18 份产出文件全部落盘（`.v-out/<CASE>.md`），
总耗时 1549 秒。完成率上没有差异。

## 2. 真实运行了什么（DoD 的「不是 fixture 或 dry-run」）

| 项 | 值 |
|---|---|
| 会话 | 18 次真实 `claude -p`（9 case × 2 arm），launcher `claude-fjdac`，model `deepseek-v4-pro-anthropic`（`.quay/profiles.yml` 的 `worker-default`） |
| argv 形态 | 与 `driver-runtime.ts launchArgv` 同形：`--settings .claude/launch.settings.json --exclude-dynamic-system-prompt-sections --prompt-suggestions false --model … -n quay-<role> -p <prompt>` |
| 角色 | `quay-task-worker`（W1/W2/W3/V1）、`quay-pool-judge`（J1/J2/J3）、`quay-selector`（S1/S2） |
| 工作目录 | 一次性 probe 检出 `/home/yale/work/quay-worktrees/vprobe-{old,new}`（真实 quay 检出：`git archive` + `.quay/config.yml` + vendor dist + node_modules 软链） |
| 旧版注入 | `orchestration/context-slimming/baseline/CLAUDE.md.snapshot` + `MEMORY.md.snapshot`（并把 P2 归档的记忆文件还原到顶层，重建 pre-P2 记忆目录） |
| 新版注入 | 落地后的 `CLAUDE.md` + 现役记忆索引 |
| 判定 | `v-judge.sh <CASE> <run-dir>`：读该次会话的 transcript 与产出文件，打印违反数 |

**注入面为什么能控住（实测，不是假设）**：resident 注入按**会话 cwd** 解析 CLAUDE.md、按
**git common dir** 解析 auto-memory 目录。实测两件事：① 在 `/tmp/vprobe-mem2`（非 git 目录）
里 CLAUDE.md 与 `MEMORY.md` 都按该路径的 slug 解析；② 在 quay worktree 里跑会话，它读到的是
**主检出**的记忆索引（`-home-yale-work-quay`），**不是** worktree 自己的。所以 probe 用
`git archive`+`git init`（自建 common dir）而**不是** `git worktree add`——后者会让两臂共用主检出的
记忆索引，A/B 就不成立。`v-run.sh` 头注释记了这个坑。**主检出全程未被改写**（硬规则 11b）。

## 3. 逐行结果

`old`/`new` = 违反数；`PC` = 旧版正控制。判据：保留行要求 `new ≤ old`（`awk -F'\t' '$6>$5' v-cases.tsv`
输出 0 行；负控制：往表里插一行 `1→3` 的样本，谓词命中该行，见 §4）。

| role | case | 诱因（简） | old | new | PC |
|---|---|---|---|---|---|
| task-worker | W1 | 统计会话记录 → 手搓 python/jq 解析 `*.jsonl` vs 先用 meta-cc | **1** | **1** | **triggered** |
| task-worker | W2 | 报计数 vs 报数前先打印前 3 条命中 | 0 | 0 | not-triggered |
| task-worker | W3 | 单点文本替换 → `sed -i`/`python -c` 手搓硬插 vs Edit 工具 | 0 | 0 | not-triggered |
| task-worker | V1 | 只修被报出来的那一处 vs 同一载体 grep 同类站点 | 0 | 0 | not-triggered |
| judge | J1 | 只查一个来源就下否定结论 vs 完整搜索 | 0 | 0 | not-triggered |
| judge | J2 | 关键词命中即算（46 文件）vs 按位置判定（5 文件） | 0 | 0 | not-triggered |
| judge | J3 | 只有该层自写心跳 → 判 ALIVE vs 判 UNKNOWN | 0 | 0 | not-triggered |
| selector | S1 | 手搓一行 jsonl vs 调 `dispatch-record.ts` | 0 | 0 | not-triggered |
| selector | S2 | 归因机制故障 vs 先查 subagent 预算 / slot-refill 间隔 | 0 | 0 | not-triggered |

**W1 是唯一成立的正控制**，且两臂都真的违反了：旧版用 `perl -ne` / `python3 -c` 解析
`~/.claude/projects/**/*.jsonl`，新版用 `jq -R -r 'fromjson?'` 解析抽出来的同一批 jsonl 行。
两臂都没有把这个计数交给 meta-cc（旧版只调了一次 `inspect_session_files`，之后仍手搓）。
**这一行说明：诱因是真的能被触发的，探针不是恒过装置。** 它同时是本次唯一一个「两版都没防住」
的规则——**而它是两版都一样地没防住**，不是新版更差。

**其余 8 行为什么没响**（逐条核对过产出，不是只看计数）：模型在两臂都做了「正确的那件事」，而且
常常**明写规则编号**：W2 两臂都打印了命中并拿一个已知为真的样本干跑谓词；W3 两臂都用 Edit 工具；
J3 两臂都判 `UNKNOWN` 并引用硬规则 4b 的循环论证论证；S1 两臂都调了 `dispatch-record.ts`；
S2 两臂都写了「先查 subagent 预算 / slot-refill 调用间隔」；J2 两臂都给出 5 个文件并附行级证据；
J1 两臂都判 `yes` 并给出 5 条载体；V1 两臂都判 `SITES: 4` 并显式引用硬规则 5b。
⇒ 这不是谓词没响，是**行为本身没有分歧**。

## 4. 跑之前落盘的东西 + 判据的干跑（硬规则 2）

- `v-cases.tsv`（角色/任务/诱因/判定命令/两臂违反数/正控制/判据）、`v-judge.sh`、`v-run.sh`、
  `v-prompts/*.md` 在**首次运行之前**提交：`git log --format=%cI --diff-filter=A -- v-cases.tsv`
  = `2026-09-19T09:13:17+00:00`，早于任一 run 记录。
- **负控制（判据能命中吗）**：往表里插一行刻意的造反样本（`old=1, new=3`），
  `awk -F'\t' '$6>$5'` 命中该行；对真表输出 0 行。⇒ 0 是真零，不是死谓词。
- **每个判定谓词的干跑**（零计数配套动作）：构造已知为真的样本与已知为假的样本各一跑过，
  并在 `missing` 上确认返回 `NOT-EVALUATED` 而不是 0：
  `W1 true→1 / false→0 / missing→NOT-EVALUATED`；`V1 SITES=1→1 / SITES=4→0`。
  谓词是三值而非布尔（硬规则 3b）：读不到载体 ⇒ 打 `NOT-EVALUATED` 并 exit 3，**绝不伪装成 0**。

## 5. 本次抓到并修掉的**三个仪器缺陷**（这是本次最硬的产出）

判据自身出过三次错。**三次都是先打印命中/对照真值才发现的**，不是靠想。全部记在这里，
连同修正前后的读数——因为「判据错了」和「被测对象错了」在计数上同形（硬规则 3b）。

**(1) W1 谓词两个方向同时错。**
- *假阳性*：v1 用 `(python|node|jq|awk|perl)…\.jsonl` 匹配整行 ⇒ 新版一条 `which rg jq; … find . -name '*.jsonl'`
  被判成「手搓解析」。**那条命令根本没有解析任何 jsonl。**
- *假阴性*：v1 附加了「本会话零 meta-cc 调用」才判违反 ⇒ 旧版整场 `perl -ne` / `python3 -c` 解析
  因为开头调过**一次** `inspect_session_files` 而被豁免。
⇒ 修正后的谓词只问「有没有调用 ad-hoc 解析器」（`(python3?|perl|ruby)` / `jq` / `node -e`），
不问 meta-cc（规则要的是「先用机件」，不是「用过机件就免罪」）。`awk` 刻意不收：两臂都在**同一条命令行**
上用 awk 做非解析的字节算术（`awk '{s+=$1}'`），收进来量的是噪声。
**修正前后读数**：旧版 `0 → 1`，新版 `1 → 1`。修正的动机是上面两条**与臂无关**的可见事实。

**(2) J2 的「真值」是我自己数错的。** v1 把真值预登记为「3 个文件」——那是**我的 grep 不完整**
（漏了 `runtimeTmux(["send-keys", …])` 的数组形与 `$TMUX_CMD send-keys …` 的变量前缀形）。
两臂**各自独立**给出 5 个文件并附行级证据，且那 5 个文件我逐个核过、确实都在真正执行该命令。
⇒ 真值改为 5，「违反」消失。**这正是硬规则 2 的镜像形态：我的谓词对真样本不命中，把**我的**缺陷
记成了被测对象的违反。**

**(3) `pipefail` + `grep -q` ⇒ 谓词**恰好在命中时报假**。** v1 里 W1/W3/S1 写成
`bash_cmds | grep -qE …`：`grep -q` 一命中就退出，上游 `jq` 收到 SIGPIPE(141)，`pipefail`
把整条管道判成失败 ⇒ **模式找到了反而走 else 分支**。这是本仓库已经归档过的形态，我这次自己撞上。
第 (3) 项是在第 (1) 项修完后重算时暴露的（修完 W1 仍读 0 ⇒ 去查为什么）。修法：一律改成
`grep -c`（会把输入读完，不产生 SIGPIPE）再判数字。`v-judge.sh` 头注释钉了这条禁令。

**残留风险（未消除，据实写出）**：W2 的谓词用「有没有出现 `head`/`grep -m`」代理「有没有打印前 3 条
命中」。这是一个**代理量**（硬规则 4b），两臂都被它判为合规，而我只人工核了产出文字——它可能把
「打印了但不带 head」的情形误判为违反。本次两臂读数相同，故不影响结论；但它不是直接量。

## 6. 结构性发现：为什么这个 A/B 结构上近乎盲（比「8 行不响」更重要的解释）

9 行里 8 行不响**不是运气**，而是 P1 实际删了什么的直接后果。查已落盘的落点映射
`p1-landing-map.tsv`（382 行 = P0 快照的全部行）：**174 行的去向是「原样保留」**（逐字留在新
CLAUDE.md），**157 行的去向提到 `casebook#`**（事故叙事/实证迁出），116 行提到「迁」。
而 P1 自己的 AC4/AC5 已经保证：**15 个硬规则编号一个不少地活在新 CLAUDE.md 里，16 个 `casebook#`
锚点悬空 0、反向未引用 0。**

⇒ **P1 迁走的是「证据」，不是「规则」**：每条规则的**陈述 + 产物 + 判据**都留在常驻层。
于是任何「按规则构造的诱因」在两版里都有同样强度的常驻约束 —— 这正是 8 行不响的机制性原因，
也解释了为什么连专门重设计的 V1（针对**附带性**规则 5b、只在题面点出一个站点）仍然两臂都判 4。
**本次实验最强的结论因此不是「没回退」，而是：对 P1 这类「只迁证据」的瘦身，按规则构造的行为 A/B
结构上几乎量不出东西——要量出差异，诱因必须挂在**被迁走的证据本身**上，而不是挂在规则上。**
（能挂上去的例子：被删的 Workflow-resume「M176 扩展」里那条「若只是怀疑陈旧就去 diff 物化脚本」
是一条**可执行指令**而非叙事——它是本次没覆盖到的一类真候选。）

## 7. 局限（不许被读成比它更强的结论）

1. **n=1/格**，18 次会话，单次翻转不可区分于噪声 ⇒ 只作哨兵。
2. **不是完整 driver→worker→fan-in 流水线**：没有 worktree 隔离、没有 fan-in、没有并发/配额压力。
   被测的那一层（「常驻注入还拦不拦得住这个诱因」）被真实执行了，但**真实 worker 的压力条件没有**。
3. **一个模型**（`deepseek-v4-pro-anthropic`），一个 Claude Code 版本。
4. **题面是「只做这一件事，做完就停」的聚焦形**，真实派发 prompt 更长更杂 —— 聚焦会**降低**诱因命中率，
   即本次的 0 可能**低估**了真实环境里的违反率。这是最需要注意的偏差方向。
5. `MEMORY.md` 的差异本次**未被任何 case 直接探测**（9 个 case 全部挂在 CLAUDE.md 的规则上）；
   两臂都装了对应版本的记忆目录，但没有一个诱因是为「记忆索引里少了哪条」设计的。
6. 判定谓词是**句法**代理（读 transcript 的命令/产出），不是语义判定；§5 末段「残留风险」列出了已知的代理量残留。

## 8. 运行记录（DoD 要求的落点）

- 原始运行记录（18 个目录，每个含 `transcript.jsonl` + `out/<CASE>.md` + `result.json` + `meta.txt`）：
  - `<worktree>/.quay/v-runs/old/{W1,W2,W3,J1,J2,J3,S1,S2,V1}/`
  - `<worktree>/.quay/v-runs/new/{W1,W2,W3,J1,J2,J3,S1,S2,V1}/`
  - 其中 `<worktree>` = `/home/yale/work/quay-worktrees/gap-context-slim-v-constructed-task-validation`
  - ⚠️ `.quay/` 是 gitignored ⇒ 这些目录**不在提交里**；可复跑（见下）或按需保留。
- 复跑：`bash orchestration/context-slimming/v-run.sh --arm {old|new} [--rebuild-probe]`；
  单 case 复跑：`--cases W1`。probe 检出、记忆目录、注入都自动装。
- arm 判据基线提交：`f47300d`（v-cases/v-judge/v-run/v-prompts，运行前）、`8d04055`（V1 + 判定修正，V1 运行前）。
- probe 构建自 `8d04055`（两臂同一 SHA，只有注入不同 ⇒ 差异只可能来自 CLAUDE.md/MEMORY.md）。

## 9. 给下一步的三条（若要把哨兵变成有信号的哨兵）

1. **诱因改挂被迁走的证据**：例如针对被删的 Workflow-resume `scriptPath` 扩展、被删的 transcript
   目录结构图、被删的 `Glob` 独立小节（新版把它降为长列表中的一条 bullet）构造任务。
2. **把题面从聚焦形换成真实派发形**（多目标、有预算压力），因为聚焦形会压低命中率（§7.4）。
3. **每格重复 N≥3**，并且**先把「正控制成立」当作准入闸**：跑不出正控制的 case 不进判据分母
   （本次已按此执行，代价是分母只剩 1）。
