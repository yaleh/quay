---
id: gap-design-evolution-meta-mechanism-readings
title: 设计演进元机制的外部直接量读数：分解后增量落回中心文件占比（serve 1% / worker 88%）与热点文件并发争用——评价「扩展点模板」本身是否有效
status: done
labels:
  - gap
  - architecture
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Finding

本条记录的对象是**元机制**，不是某一刀重构：DIR-133（人 2026-10-22 裁定）规定设计切片必须带扩展点判据，并要求元机制层优先、用外部可核的直接量观测。本条把这些读数定义清楚、给出历史基线和复跑命令，使「扩展点模板到底管不管用」成为一个可以回答的问题。GOAL-909（WorkerPool 聚合 + 结局处理扩展点）是这个模板的首次检验对象。

**为什么必须用外部直接量**：设计质量的退化不会让任何行为判据变红（237 条 AC 中行为类 169 条，对行为不变的重构天然恒真）；如果读数由被测的机制自己产生，在它失效时读数会一起停止更新，与「一切正常」同形（硬规则 4b）。下面的读数都只来自 git 历史、文件行数和合并输出，被测对象改不了它们。

### RM1 分解后子系统增量落回中心文件的占比（FACT，2026-10-22 实测，可复跑）

| 子系统 | 分解方式 | 基线提交 | 子系统增量 | 落回中心文件 | 占比 |
|---|---|---|---|---|---|
| serve | 按关注点拆 + 分发器（扩展点） | 295e771b0（gap-serve-handlers-split-by-concern） | +11797 | 分发器 +153 | **1%** |
| worker | 区域抽取（R15 → worker-fan-in.ts），无扩展点 | 2440b52d0（gap-arch-worker-fan-in-extract-from-worker-driver） | +5452 | worker-driver.ts +2813、worker-fan-in.ts +2007 | **88%** |

复跑命令（立案当轮实测输出与上表一致）：

```bash
# serve
sc=295e771b0; s0=$(for f in $(git ls-tree --name-only $sc packages/quay/src/ | grep -E 'src/(serve|server-state)'); do git show $sc:$f | wc -l; done | awk '{s+=$1}END{print s}'); s1=$(cat packages/quay/src/serve/*.ts | wc -l); h0=$(git show $sc:packages/quay/src/serve-handlers.ts | wc -l); h1=$(wc -l < packages/quay/src/serve/serve-handlers.ts); echo "serve: subsystem +$((s1-s0)), central +$((h1-h0)), central-share=$(( (h1-h0)*100/(s1-s0) ))%"
# worker
wc=2440b52d0; d0=$(git show $wc:plugin/scripts/worker-driver.ts | wc -l); f0=$(git show $wc:plugin/scripts/worker-fan-in.ts | wc -l); d1=$(wc -l < plugin/scripts/worker-driver.ts); f1=$(wc -l < plugin/scripts/worker-fan-in.ts); n=$(git log --diff-filter=A --format= --name-only $wc..HEAD -- 'plugin/scripts/*worker*.ts' 'plugin/scripts/*pool*.ts' 'plugin/scripts/*dispatch*.ts' 'plugin/scripts/*fan-in*.ts' | sort -u | while read f; do [ -f "$f" ] && cat "$f"; done | wc -l); c=$((d1-d0+f1-f0)); echo "worker: central +$c, new-modules +$n, central-share=$(( c*100/(c+n) ))%"
```

立案当轮输出：`serve: subsystem +11797, central +153, central-share=1%`；`worker: central +4820, new-modules +632, central-share=88%`。

**落地复跑（FACT，HEAD `2ca7d019ba2d1f3f4eb830b0e31ef60c198fa917`，2026-10-22）** —— 在落地 HEAD 上原样运行上面两条命令，输出：

```
serve: subsystem +11797, central +153, central-share=1%
worker: central +4820, new-modules +632, central-share=88%
```

原始行数（同一轮）：serve `s0=4043 s1=15840 h0=196 h1=349`；worker `d0=4453 d1=7266 f0=1772 f1=3779`。与立案当轮逐字一致，故表格不更新。两者相对关系仍成立：**serve（有扩展点）1%、worker（只有抽取）88%** —— 这是谓词能分辨两种分解的证据，不是对什么都读出同一个值。

口径注意：worker 那行把「新增的 worker/pool/dispatch/fan-in 模块」算作扩展落点，所以 GOAL-909 合并后新增的 worker-pool.ts 会被算进去。评价 GOAL-909 时，基线提交必须换成 GOAL-909 的合并提交，否则「把代码从 worker-driver.ts 搬进 worker-pool.ts」会被误读成「增量落在了扩展点」——搬家不是增长。

### RM2 热点文件的并发争用（FACT，与 serve 先例同口径）

只计两种形态，计数前先打印命中样本：
- 形态 1，派发器因该文件争用而改选/排序（`.quay/worker-outcome.jsonl` 的 `selector_reason` 同时含该文件名与 contention / avoid / 避开 / 争用 / 同样触及 / 先于 / 串行 / 都 touch 之一）：worker-driver.ts 5 次（2026-08-23、08-29、09-01、09-20、10-16）。
- 形态 2，该文件的真实合并冲突（记录中出现 `Merge conflict in plugin/scripts/worker-driver.ts`）：6 次。
- 不计：累计 Touches 声明数（178）、原始字符串命中数（153，大部分是合并日志正文和测试名，抽样已核实）。

**落地复跑（FACT，HEAD `2ca7d019b`，载体 `.quay/worker-outcome.jsonl`，3337 条记录，2026-10-22）** —— 先贴命中样本，再给计数：

worker-driver.ts 形态 1（5 条中的前 3 条）：
- [L18] `gap-bucket-scoped-worktree-skips-perfile-reporter` `2026-08-23T15:26:32.485Z` — "…touches only full-suite-runner.ts, avoiding the worker-driver.ts contention of the other three driver tasks."（命中词 `contention`）
- [L502] `gap-execution-loop-productization-p2-p4` `2026-08-29T01:26:25.038Z` — "…会删改 fan-in-ff-merge.sh/worker-driver.ts，须先于改名与 webui-log 两个同样触及这些文件的任务落地"（命中词 `先于`、`同样触及`）
- [L828] `gap-worker-ac-check-shortcircuit` `2026-09-01T10:29:52.430Z` — "…三候选皆无 delivery-critical 且都 touch worker-driver.ts，缺陷优先于两条性能优化。"（命中词 `都 touch`）

worker-driver.ts 形态 2（6 条中的前 3 条）：
- [L508] `gap-fan-in-flip-done-already-done-not-landed` `2026-08-29T05:22:33.998Z` — `mechanical_fan_in.reason`: `Auto-merging plugin/scripts/worker-driver.ts\nCONFLICT (content): Merge conflict in plugin/scripts/worker-driver.ts\n…`
- [L545] `gap-verification-round-static-fail-no-record` `2026-08-29T10:25:06.421Z` — 同上格式：`Auto-merging plugin/scripts/worker-driver.ts\nCONFLICT (content): Merge conflict in plugin/scripts/worker-driver.ts\n…`
- [L569] `gap-fan-in-ff-ref-update-detach-develop` `2026-08-29T14:16:23.228Z` — 同一段 git 合并输出中先命中 ready-pool-check.ts，其后 `Auto-merging plugin/scripts/worker-driver.ts\nCONFLICT (content): Merge conflict in plugin/scripts/worker-driver.ts`

worker-fan-in.ts 形态 1（1 条，全部）：
- [L2669] `gap-goal-active-ac-gap-classification-ignores-round-verdict` `2026-10-03T09:52:40.983Z` — "…且与 dispatch-wiring 任务在 worker-fan-in.ts 上串行。"（命中词 `串行`）

goal-driver.ts 形态 1（2 条，全部）：
- [L2669] `gap-goal-active-ac-gap-classification-ignores-round-verdict` `2026-10-03T09:52:40.983Z` — 同一条理由也含 goal-driver.ts（"修法自足（goal-driver.ts 加可选 verdicts 参数）"），但该理由里的争用词 `串行` 实际修饰的是 worker-fan-in.ts；按字面谓词计入，严格读法则不计（见下方口径说明）。
- [L2740] `gap-goal-branch-active-branch-mode-goal-without-branch-never-self-heals` `2026-10-05T15:03:41.010Z` — "两者同为 gap+defect 且都 touch goal-driver.ts（互斥只能选一）"（命中词 `都 touch`）

**零计数干跑（硬规则 2 后一半）**：worker-fan-in.ts 与 goal-driver.ts 的形态 2 读数均为 0；把同一个谓词对已知含该形态的样本 worker-driver.ts 干跑一次，读出 **6** —— 命中的就是上面那 6 条 `mechanical_fan_in.reason` 里的 git 原始合并输出。⇒ 两个 0 是真实零，不是谓词失灵。

| 文件 | 形态 1（争用改选/排序） | 形态 2（真实合并冲突） |
|---|---|---|
| worker-driver.ts | 5 | 6 |
| worker-fan-in.ts | 1 | 0 |
| goal-driver.ts | 2（严格读法 1） | 0 |

复跑命令（在仓库根运行；`.quay/worker-outcome.jsonl` 被 gitignore，但它是真实运行账本）：

```bash
python3 -I - <<'PY'
import json
TOKS=["contention","avoid","避开","争用","同样触及","先于","串行","都 touch"]
rows=[]
for ln,line in enumerate(open(".quay/worker-outcome.jsonl",encoding="utf-8"),1):
    line=line.strip()
    if line:
        try: rows.append((ln,json.loads(line)))
        except Exception: pass
def strings(o):
    if isinstance(o,dict):
        for v in o.values(): yield from strings(v)
    elif isinstance(o,list):
        for v in o: yield from strings(v)
    elif isinstance(o,str): yield o
for fn in ["worker-driver.ts","worker-fan-in.ts","goal-driver.ts"]:
    f1=[ln for ln,d in rows if fn in (d.get("selector_reason") or "") and any(t in (d.get("selector_reason") or "") for t in TOKS)]
    f2=[ln for ln,d in rows if any("Merge conflict in plugin/scripts/"+fn in s for s in strings(d))]
    print(fn,"form1=",len(f1),"form2=",len(f2),"lines:",f1,f2)
PY
```

该命令实测输出：`worker-driver.ts form1= 5 form2= 6`、`worker-fan-in.ts form1= 1 form2= 0`、`goal-driver.ts form1= 2 form2= 0`。

口径说明（如实）：
- 形态 1 依赖派发器在理由里写出文件名，只会少计、不会多计。goal-driver.ts 的 2 条按字面谓词（文件名 + 争用词同现）计入；其中 [L2669] 的争用词修饰的是 worker-fan-in.ts，严格读法应为 1。两个读数都保留，引用方须声明取哪一个。
- 形态 2 的载体是 worker 结局账本，但命中字段是 `mechanical_fan_in.reason`，写入的是 git 合并的原始输出，不是 worker 的自报结论 —— 满足「外部直接量」要求。

### JUDGMENT — 这些读数各能回答什么、不能回答什么

本段全部是 JUDGMENT；上两节的表格、输出与命中样本是 FACT，两者不混写。

- **RM1 回答「模板是否改变了新代码的落点」**。评价 GOAL-909 的口径：**以 GOAL-909 的合并提交为基线**，等 worker 子系统再积累一段真实增量后，看落回 worker-driver.ts 的占比是否明显低于历史的 88%。不预设数值阈值（硬规则 4 推论：成本结构未知前不设阈值），只与自身历史基线和 serve 的 1% 对照。**反事实**：如果 GOAL-909 合并后的增量仍然大部分落回 worker-driver.ts，那就说明扩展点模板没有起作用（或者 GOAL-909 建的注册面不是新代码真正需要的那个扩展点），结论是修模板，而不是再抽一刀。
- **RM2 回答「设计问题是否仍在产生运营代价」**。它既是立项触发器（DIR-133 裁定 1），也是事后检验：GOAL-909 合并后 worker-driver.ts 的争用是否下降（以本节的 5 / 6 为对照基线）。
- **两者都不能回答**：类的封装质量、命名、抽象是否恰当。这些仍然是语义判断，需要独立复核，不能用 RM1/RM2 代替。
- **对 DIR-133 讨论中暂缓的两项的取舍规则**：(a) 热点文件体量棘轮——等 RM1 拿到 GOAL-909 合并后的读数再定；如果扩展点已经让增量自然离开中心文件，棘轮只是保险；如果没有，棘轮也只能挡住增长、挡不住设计问题。(d) Planner 准入新增 concern_kind——RM2 目前还是一次性取数，要先变成可机械计算的读数（例如并入 arch-cycle-report 同族的 report-only 例程，零 LLM），才具备「可计算、可证伪 delta」这一准入要求。两项各自的发生率读数：抽取后回涨已实测 2 例（worker-driver +63%、worker-fan-in +113%）。

## Acceptance Criteria

- [x] AC1 RM1 可复跑：在落地时的 HEAD 上原样运行上面两条命令，贴出输出；serve 的占比仍为个位数百分比、worker 的占比仍远高于 serve（两者的相对关系就是谓词能分辨的证据）。若数字变化，按实测更新表格并注明 HEAD。
- [x] AC2 RM2 覆盖其它热点文件：对 worker-driver.ts、worker-fan-in.ts、goal-driver.ts 三个文件分别按两种形态计数，每个非零计数先贴出前 3 条命中样本（硬规则 2），零计数要对一个已知含该形态的样本干跑一次谓词。
- [x] AC3 JUDGMENT 段保持 FACT / JUDGMENT 分离，并写明 GOAL-909 的评价口径（基线换成其合并提交）与反事实对照。

## Definition of Done

- [x] 三条 AC 全绿；本条只记录读数和评价口径，不改任何代码、不开 goal。
- [x] 读数全部来自真实 git 历史与真实载体（`.quay/worker-outcome.jsonl`），附可复跑命令；不使用夹具或被测机制的自报计数。

## Touches

- tasks/gap-design-evolution-meta-mechanism-readings.md
## 口径更正（2026-10-22，立案者补记）

**RM1 的两条复跑命令分母不一致，由立案者造成，已作废、改用统一公式。** serve 那条的分母是「整个子系统的增量」；worker 那条的分母只算了「新增模块」，漏掉了基线时已存在的非中心文件（`*dispatch*` / `*fan-in*` 等 17 个匹配文件）的增长。worker 执行本条时按原命令复跑，所以复现出同样的 88%——命令本身的错误，复跑发现不了。

**统一公式**：`share = centralΔ / (centralΔ + nonCentralΔ)`。centralΔ = 中心文件在 HEAD 与基线的行数差之和（文件改过路径时，按两端各自的路径取）；nonCentralΔ = 子系统内全部非中心文件（基线或 HEAD 存在、且匹配子系统模块范围）的行数差之和，包括基线后新增的文件。

| 子系统 | 基线 → 读数提交 | centralΔ | nonCentralΔ | 统一公式占比 |
|---|---|---|---|---|
| serve | 295e771b0 → HEAD（中心文件 `serve-handlers.ts` → `serve/serve-handlers.ts`） | +153 | +11644 | **1%** |
| worker | 2440b52d0 → ff32d031d（GOAL-909 动手前一刻） | +4820 | +1025 | **82%** |

**worker 的历史基线以 82% 为准，88% 作废。** 两个子系统的相对关系不变（1% 对 82%），所以 RM1 区分两种分解方式的能力不受影响。

**搬家陷阱已在生产上实际出现。** GOAL-909 的两次提交（f19a95371 AC-914、024f9d7f2 AC-915）把 400 行从 worker-driver.ts 搬进 worker-pool.ts。同一个统一公式，从 2440b52d0 量到这两次提交之后，读数变成 69%——下降的部分全部来自搬家，不是新代码落到了扩展点。所以评价 GOAL-909 时必须以它的落地提交为基线，只计此后的真实增量；跨过搬家提交的区间读数不可用于评价。
