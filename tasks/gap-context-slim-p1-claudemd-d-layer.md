---
id: gap-context-slim-p1-claudemd-d-layer
title: 上下文瘦身 P1：CLAUDE.md 删 D 层并把事故叙事迁出常驻文件
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
近 14 天历史（主会话 4425 + subagent 324）：规则 ID 被当短标签引用（3b 884 会话、规则4 743、推论三 539、5b 374…），引用形式都是「标签 + 一句判据」，**没有会话引用事故叙事本身**；而 Split-decision（11 会话）、退役墓碑（13–54）、C15（3）、C30（4）近乎零引用；「Glob unavailable」规则在场时该错误仍在 6 个文件出现（规则在场≠有效）；Workflow-resume 的 `scriptPath` 规则已含在 `fan-in-execute` skill 中。本任务只做 D 层与叙事迁移：①删 Split-decision 节、Glob 节、Workflow-resume 节（先核实其 `scriptPath` 规则确在 fan-in-execute skill）、正文里的退役机制叙事（收件箱、classic loop、outer 角色、prepare-milestone、.halt、gap-ff-propagate），改为指向 `orchestration/archive/AC58-retired-clauses.md#R*` 的一行指针；②认识论硬规则里的事故叙事（日期、实例、代价、复盘）迁到新文件 `docs/epistemology-casebook.md`，正文每条规则保留：规则一行 + 一句 why + 产物/检查器路径 + `→ casebook#锚点`；③**规则编号一律保留不复用**，被压缩的编号在 casebook 里保留「→ 见 X」。**⛔ 不得改变任何人的裁定内容，只改位置与冗余表述。** 删除之前必须先产出落点映射 `orchestration/context-slimming/p1-landing-map.tsv`——旧 CLAUDE.md（取自 P0 快照）的**每一行** → {保留于新 CLAUDE.md / casebook 某锚点 / archive 某锚点 / 明确判定纯重复(列出重复位置)}；任一行无去向即不许合并。
## AC
- [x] `p1-landing-map.tsv` 覆盖 P0 快照 `CLAUDE.md.snapshot` 的全部行：`awk 'END{print NR}' snapshot` 等于映射表数据行数，且无空去向列（`awk -F'\t' '$3==""' p1-landing-map.tsv` 输出 0 行；先对一个故意留空的临时样本干跑确认该谓词能命中）。⇒ 382 == 382；空去向 0；负控制命中 1（读数见 Resolution）。
- [x] 新 `CLAUDE.md` 行数比快照至少少 100 行，`wc -l CLAUDE.md` 与快照对比命令输出贴进 Resolution；单行最长 ≤ 700 字符（`awk '{print length}' CLAUDE.md | sort -n | tail -1`）。⇒ 382 → 207（少 175）；最长行 632。
- [x] 不含已删节：`/usr/bin/grep -c '^## Split-decision routing policy\|^## Glob tool unavailable\|^## Workflow resume anti-pattern' CLAUDE.md` 为 0（先打印命中前 3 条核对；再对快照文件跑同一谓词应 ≥3，证明谓词能命中）。⇒ 新文件 0；快照 3（三条命中已打印）。
- [x] 规则编号守恒：快照中出现的每个「硬规则」编号标识（`/usr/bin/grep -o '^[0-9]\+[bc]\?\.' snapshot | sort -u`）在新 CLAUDE.md 或 casebook 中仍能找到（差集为空）。⇒ 15/15 在新 CLAUDE.md 命中（严格谓词），差集空。
- [x] `docs/epistemology-casebook.md` 存在，且新 CLAUDE.md 中每个 `casebook#` 锚点都在该文件里有对应标题。⇒ 16 个引用锚点，悬空 0，反向未引用 0。
- [x] `scripts/test.sh --for-task gap-context-slim-p1-claudemd-d-layer --allow-thin` 退出 0（scoped 静态检查绿）。**判据形修正：原形缺 `--allow-thin`，对本任务结构上不可满足（selector `coverage 0.00 (0/5 Touches resolved) < 0.5`）——理由、读数与先例见 Resolution「AC6 的判据形修正」。**
## DoD
真实落地：合入 develop 后 `git show develop:CLAUDE.md | wc -l` 已下降，且 `git show develop:docs/epistemology-casebook.md` 可见；落点映射已随提交贴入。不接受只在分支上满足。
## Touches
- CLAUDE.md
- docs/epistemology-casebook.md (new)
- orchestration/context-slimming/p1-landing-map.tsv (new)
- orchestration/context-slimming/landing-map-check.sh (new)
- docs/analysis/threshold-scope-violations.md
- plugin/test/threshold-scope-check.test.mjs
- tasks/gap-context-slim-p1-claudemd-d-layer.md
## Resolution
落地分支 `task/gap-context-slim-p1-claudemd-d-layer`：实现 commit `07407133e`，其后合 develop（`34c949269`）。产物 4 个：改写后的 `CLAUDE.md`、新增 `docs/epistemology-casebook.md`、落点映射 `orchestration/context-slimming/p1-landing-map.tsv`、映射检查器 `orchestration/context-slimming/landing-map-check.sh`。

### 行数对照（AC2 要求把对比命令输出贴进 Resolution）

```
$ wc -l orchestration/context-slimming/baseline/CLAUDE.md.snapshot
382 orchestration/context-slimming/baseline/CLAUDE.md.snapshot
$ wc -l CLAUDE.md
207 CLAUDE.md
$ awk '{print length}' CLAUDE.md | sort -n | tail -1
632
```
⇒ 少 **175** 行（判据 ≥100）；最长单行 **632** 字符（判据 ≤700；快照最长行为 **1533**＝旧 `:270` 的 shape-aware 门段，本轮按句拆行）。casebook 473 行 / 31308 字节（**不被注入**，故不占常驻预算）。

### 逐条 AC（命令 + 读数）

**AC1** — `awk 'END{print NR}' snapshot` = **382**；映射表数据行 = **382**（无表头行 ⇒ 两个读法同值）。`awk -F'\t' '$3==""' p1-landing-map.tsv` = **0 行**。**零计数配套（硬规则 2）**：同一谓词对一份故意留空的临时样本（3 行，第 2 行第 3 列置空）干跑 ⇒ 命中 **1** 行 ⇒ 谓词会响，0 是真零而非死谓词。`landing-map-check.sh` 另加两条更强判据并全绿：行号恰为 `1..N`（缺口/重复 **0**）、第 2 列**逐字节等于**快照同号行（不匹配 **0**）——即映射表是对着快照写的，不是臆造的。

**AC2** — 见上「行数对照」。

**AC3** — 新 `CLAUDE.md` 同一谓词命中 **0**；快照命中 **3**（命中前 3 条已打印：`:339 ## Split-decision routing policy`、`:349 ## Workflow resume anti-pattern (M144, 2026-07-25)`、`:372 ## Glob tool unavailable in subagent sessions (M148, 2026-07-25)`）⇒ 谓词能命中，0 非恒零。

**AC4** — 快照 `^[0-9]+[bc]?\.` 唯一集合 = **15** 个（`1. 2. 3. 4. 4b. 4c. 5. 5b. 6. 7. 8. 9. 10. 11. 12.`）。用严格谓词 `^<N>[bc]?\. \*\*`（硬规则项的行首形）在新 CLAUDE.md 命中 **15/15** ⇒ 差集空。**刻意不用「casebook 里出现过也算」这条更松的兜底**：严格那一支已经是 15/15，加上兜底只会让判据变松（硬规则 2）。

**AC5** — `docs/epistemology-casebook.md` 存在（16 个 `## ` 标题）。新 CLAUDE.md 引用的 `casebook#<锚点>` 共 **16** 个（`grep -o 'casebook#[a-z0-9-]*' | sort -u`），逐个 `grep -qxF "## <锚点>"` ⇒ **悬空 0**；反向（casebook 有标题但无人引用）⇒ **0** ⇒ 1:1。

### AC6 的判据形修正（原形对本任务结构上不可满足）

原 AC 写 `scripts/test.sh --for-task gap-context-slim-p1-claudemd-d-layer`（无 `--allow-thin`）。实测 **exit 1**：

```
… change 级静态检查全部 PASS …
scripts/test.sh: --for-task gap-context-slim-p1-claudemd-d-layer selected no test files (selector exit 1); add --allow-thin to force
```
selector（`select-tests-for-touches.ts`）自报根因：
```
task gap-context-slim-p1-claudemd-d-layer: 0 test file(s)
unresolved (5):
  CLAUDE.md                                  — no */test/CLAUDE.test.mjs found
  docs/epistemology-casebook.md              — no */test/epistemology-casebook.test.mjs found
  orchestration/context-slimming/landing-map-check.sh — no */test/landing-map-check.test.mjs found
  orchestration/context-slimming/p1-landing-map.tsv   — no */test/p1-landing-map.test.mjs found
  tasks/gap-context-slim-p1-claudemd-d-layer.md       — no */test/gap-context-slim-p1-claudemd-d-layer.test.mjs found
coverage: 0.00 (0/5 Touches resolved)
test-selection-thin: … (0.00) < 0.5; pass --allow-thin to run anyway
```
selector 把每个 Touches 条目解析为**同名 `*/test/<basename>.test.mjs`**；本任务 5 个条目全是文档 / TSV / 任务体，**结构上不可能有同名单测**，而要过 0.5 门槛需 5 中至少 3 个解析成功 ⇒ **不存在任何实现能让原形退 0**（正是 CLAUDE.md「task-shape-vs-gate 不匹配是机制缺陷，应在任务形状/闸门侧修」与硬规则 4c 的形态）。

**决定：改判据形，不刷数字。** 加 `--allow-thin` —— 这正是 **driver 的 fan-in 自己的调用形**（本任务派发 prompt 的 2b 步逐字如此），也是同族先例 P0（`gap-context-slim-p0-baseline-readings`）Resolution 记的形。带该 flag 实测：`exit 0`，`--grep -c "FAIL\|STATIC_CHECK_FAILED"` = **0**，选中 0 个测试文件（thin 被显式接受）。

### 本轮踩到并修掉的三处**自造**问题（记录；都不是工具误报，是硬规则 2 的实例）

**(1) `threshold-scope-check`（pre-commit 文档门）首轮拦下本提交：`new since baseline: 13`。** 其中 11 条来自我把锚点写成 `docs/epistemology-casebook.md#<锚点>`——该形被 stale-path 判为**不可解析路径**（anchors are not files；形成 path candidate 是因为它带 `/` 与扩展名）；另 2 条为 `unscoped-threshold`：

| # | 我做了什么 | 为何触红 | 修法 |
|---|---|---|---|
| ① | 把「需 Claude Code 2.1.224 或更新」改写为 `≥2.1.224` | 引入 `≥` ⇒ 命中 count-threshold 判据 | 改回原表述「2.1.224 或更新」 |
| ② | 把快照里跨两行的句子并成一行 | `≥2` 与本条判据落进同一行 ⇒ 命中同类判据 | 恢复原断行（**内容一字未改**） |
| ③ | 锚点写作 `docs/epistemology-casebook.md#x` | path candidate 带 `#x` 解析不到 ⇒ stale-path | 改为 `casebook#x`（不构成 path candidate），并在正文声明该写法 |

修后：`threshold-scope-check` ⇒ `violations 2`（均在 `plugin/loop/orchestrator-loop-tick.md`，与本次 delta 无关）、`stalePaths 0`、**`new since baseline 0`**、`resolved 1`（旧 CLAUDE.md 的 `.claude/workflows/execute-milestone.js` 随该节迁出而消失），`exit 0`。**当时决定不 `--write-ratchet` 收窄基线**（理由：该文件不在 Touches 内，改它即超范围）。**⚠️ 该决定只对了检查器半边、漏了测试半边——见下节，它正是本轮 fan-in suite 变红的根因。**

**(2) 自写的 `landing-map-check.sh` 里有一个真 bug（首跑险些产出「结构完整、数字合理」的错结果）。** 首跑报 **43 条 `UNKNOWN-FORM`**，且它们的第 3 列打印的是**注记文本**。根因：读取用了 `IFS=$'\t' read -r a b c d` —— **TAB 是 IFS 空白字符，bash 的 `read` 会把连续 TAB 折叠成一个** ⇒ 第 2 列为空的那些行（快照里大把空行）整体左移，第 4 列的注记被当成去向。改为 `IFS= read -r line` + `cut -fN` 后 **382/382** 解析成功。

**(3) 快照里 `## Commands` 段 driver 冷启动缺口的 7 行叙述被压成 3 行状态 + 负控制。** 被去掉的是三个机制名（`enumerateColdStartInflight` / `enumerateColdStartInflightAsync` / `coldInflight`）与「被 manager 对生产实时状态验证过」的措辞；**结论（两个方向都已修复、restart 不重派、孤儿自动收敛、核对 `ps aux | grep quay-task-worker` 是习惯性负控制）与两个任务 id（`gap-worker-driver-cold-start-inflight-blind` / `-refresh`）全部保留** —— 按本文件「只放指针」政策，细节经任务 id 可检索。

### 第二轮（本轮）：fan-in suite 红的归因与修复

上轮 exited-not-landed，`step=suite`，4 条红。**逐条归因（硬规则 4b：用直接量，不叠加未验证的过滤）**：先单跑每一条，**两条非本 delta 的**（`plugin/test/start-drivers.test.mjs` AC6 SIGTERM 时序、`plugin/test/fan-in-execute-paths-s12.test.mjs` 锁等待时序）**solo 各自全绿（17/17 与 2/2）** ⇒ 判定为负载敏感 flake，不是本任务引入。

**另 2 条是本任务真实造成、且同根**：`plugin/test/threshold-scope-check.test.mjs` 的 `AC9` 与 `AC6/default`。根因 = **上轮「不改基线」的决定**：

- `AC6/default:248` 断言 `ratchet.currentCount === ratchet.baselineCount`（**严格相等**）。上轮只核了检查器的 `exit 0`（`growth:false`），而**检查器在合法收缩时本来就退 0**（自报 `resolved: 1`）——**测试的不变式比检查器严，收缩未重录时测试红而检查器绿**。⇒ 3(基线) ≠ 2(实际)：正是上轮那条「已失效的条目只是不再被消费」的条目。
- `AC9:217` 断言 `--judge CLAUDE.md` **必须 exit 1**，因为 CLAUDE.md 载有那条陈旧路径。本任务把 D 层（含 `## Workflow resume anti-pattern` 节）删掉后，**该路径已不在 CLAUDE.md**（`stalePaths: []`）⇒ 前提消失，exit 0。

**修复（两项，均属本任务 delta 的必经收尾）**：

1. **重录棘轮**（ratchet 文件自述的正式动作：「Remove an entry only after the underlying doc is fixed (then run `--write-ratchet` to persist the shrunken list)」）：`--write-ratchet --reset-baseline` ⇒ `baseline-count: 3 → 2`，`CLAUDE.md: stale-path: .claude/workflows/execute-milestone.js` 行删除（该条目由检查器自报 `resolved`）。**先例**：`5969b096`（`outer: threshold-scope ratchet 4→3 — 重录 AC38 切分后的合法收缩`）在完全同形的场景下用了同一条命令、只改同一文件。**必须带 `--reset-baseline`**：`writeRatchet` 无它时 `ceiling` 保持旧值，会写出「2 条目 + baseline-count: 3」的自相矛盾文件，转而把 `AC5` 打红（负控制 C 实测命中）。
2. **`AC9` 改为非空转的对照**（⛔ 不是「把断言改松」）：CLAUDE.md 现在干净，故裸断言 `stalePaths.length === 0` **与恒真同形、什么都验不到**（硬规则 4），原 `for (const s of out.stalePaths)` 假阳性循环也退化为空转。改为**在同一语料上做阳性对照**：真实 CLAUDE.md 全文 + 注入**一条**确定不可解析的路径，用绝对临时路径 `--judge`（检查器按 `--root` 解析候选 ⇒ 那 ~18 条 basename 简写引用的解析行为与真实运行**逐字相同**）。断言 `stalePaths === [注入的那一条]`，**两个方向都可证伪**。

**双向负控制（硬规则 4c：判据落笔当轮取真实读数）**：

```
A. 真实语料、不注入        ⇒ stalePaths 0  flagged False   （⇒ 不注入时 AC9 的 ===1 必红：注入是承重的）
B. 真实语料 + 注入 1 条    ⇒ stalePaths ['plugin/scripts/this-path-does-not-exist-ac9-control.ts'] flagged True
C. 基线 ceiling 留 3（不重录）⇒ AC6/default 红，原文 `current violation set must match the shrink-only baseline`（复现上轮 suite 红）
   —— 同时 AC5 红：`entries (2) must equal baseline-count (3)`（两条判据各自独立命中同一缺陷）
D. 还原后                  ⇒ 10/10 绿，exit 0
```
⇒ C 证明 `AC6/default` **可证伪且复现了 fan-in 的原报错**；A/B 证明 `AC9` 新断言两个方向都能响。

### 门与自检

```
$ bash orchestration/context-slimming/landing-map-check.sh --root <worktree> --selfcheck
  A. snapshot lines      : 382
     map data lines      : 382
     line-no gaps/dups   : 0
     text mismatches     : 0
  B. empty-destination   : 0
  C. destinations OK     : 382
     destinations UNRESOLVED: 0
     destinations UNKNOWN   : 0
  selfcheck 1 PASS: blanked-col3 fixture caught (1 row)
  selfcheck 2 PASS: fabricated destination caught (UNRESOLVED)
  selfcheck 3 PASS: real destination on row 6 resolves (CLAUDE.md:标题)
PASS — every snapshot line has a destination and every destination resolves
exit 0
```
三条自检是**双向可证伪**：① 把某行第 3 列留空 ⇒ 必命中；② 把某行去向换成不存在的标题 ⇒ 必 `UNRESOLVED`；③ 未突变的真去向 ⇒ 必 `OK`（③ 同时证明 ①② 不是恒红、也不与合格同形——硬规则 3b）。

### 去向分布（382 行的落点）

`casebook#*` **107** 行、`archive#R35` **3** 行、`dup:每轮必经表` **11** 行（Tools「四条硬规则」的 item 1/item 3 是「每轮必经」表同名行的副本）、其余 **261** 行保留于新 CLAUDE.md 的各节（`Process` 38 / `Commands` 36 / `Architecture` 39 / 认识论硬规则各条 96 / `Reference docs` 13 / `Tools` 12 / 其余节 27）。完整逐行映射见 `orchestration/context-slimming/p1-landing-map.tsv`。

### 内容保真的三处判断（记录，供复核）

- **Glob / Workflow-resume 两节的处置是「删节 + 一行指针」，不是整节删光**：三个 `## ` 标题都已删除（AC3 两个方向都成立），但**仍在生效的规则**被压成 `## Process` 内 1–2 行（Glob：subagent 无 `Glob` 工具 ⇒ 用 Bash `find`；Workflow-resume：M144 外部状态修复不得 `resumeFromRunId` + M176 一律 `scriptPath`），全文另存 casebook。理由：Proposal 为 Workflow-resume 给出的删除依据只覆盖 **`scriptPath` 半边**（已核实该规则确在 `plugin/workflows/fan-in-execute.js` 的 `whenToUse:` 中），而 **M144 半边在当前 skill 里没有别的正本**（`grep resumeFromRunId plugin/skills/**` 零命中）。**⛔ 若复核认为应按 Proposal 字面整节删除，删掉 `## Process` 里那两行（及其 `casebook#` 锚点）即可，无其它耦合。**
- **Split-decision 节**压缩为 `## Reference docs` 内一行，**刻意保留 `STATUS: reference/manual，非生效机制` 这句**——原任务（`gap-checksplitrecommendation-…`）的 AC3 要求 CLAUDE.md 说明该状态，整行删掉会丢掉它的产物；全文存档 `casebook#moved-split-decision-status`。
- **收件箱条目**（Tools 第 2 条）压缩为 `orchestration/archive/AC58-retired-clauses.md#R35` 一行指针；其教训已由硬规则 5（来源完备性）覆盖。
- **⟂ 未改任何人的裁定**：只改位置与冗余度；规则编号 15/15 保留、不复用（硬规则 8）。

### DoD 状态

- 落点映射**已随提交落地**：`orchestration/context-slimming/p1-landing-map.tsv`（382 行 / 95407 字节）在 `07407133e` 中。
- `git show develop:CLAUDE.md | wc -l` 的下降与 `git show develop:docs/epistemology-casebook.md` 的可见性**要等 driver 的 fan-in ff 之后**才成立（DoD 明确「不接受只在分支上满足」）；分支上已可取：`git show HEAD:CLAUDE.md | wc -l` = 207、`git show HEAD:docs/epistemology-casebook.md` 可见。
## Evidence
### 产物清单
| 文件 | 变化 | 读数 |
|---|---|---|
| `CLAUDE.md` | 改写 | 382 → **207** 行（-175）；最长行 1533 → **632** 字符 |
| `docs/epistemology-casebook.md` | 新增 | 473 行 / 31308 字节 / **16** 个 `## ` 锚点，与 CLAUDE.md 引用 **1:1** |
| `orchestration/context-slimming/p1-landing-map.tsv` | 新增 | **382** 数据行（== 快照行数）/ 95407 字节；列 = `行号 \t 快照原文 \t 去向 \t 注记` |
| `orchestration/context-slimming/landing-map-check.sh` | 新增 | 检查 A（覆盖/行号连续/原文逐字节）、B（空去向）、C（去向可解析，含递归 `dup:`）；三值输出 OK/UNRESOLVED/UNKNOWN，缺输入报 `NOT-EVALUATED` 且 exit 2（**不与 0 同形**）；`--selfcheck` 三臂 |
| `docs/analysis/threshold-scope-violations.md` | 重录（本轮） | `baseline-count: 3 → 2`；删 `CLAUDE.md: stale-path: .claude/workflows/execute-milestone.js`（被检查器自报 `resolved`）；`--write-ratchet --reset-baseline` |
| `plugin/test/threshold-scope-check.test.mjs` | 改 AC9 + 覆盖图注释（本轮） | AC9 由「真实 CLAUDE.md 必须带陈旧路径」改为「真实 doc 干净 + 同语料注入一条阳性对照」；`AC6/default` **未改一字**（由重录基线满足） |

### 删节 → 去向（AC3 的三节 + 退役叙事）
| 删掉的 `## ` 标题 | 去向 |
|---|---|
| `## Split-decision routing policy`（快照 `:339-344`） | `## Reference docs` 一行 STATUS + `casebook#moved-split-decision-status` 全文 |
| `## Workflow resume anti-pattern (M144, 2026-07-25)`（`:349-370`） | `## Process` 2 行 + `casebook#moved-workflow-resume` 全文；`scriptPath` 半边另有正本 `plugin/workflows/fan-in-execute.js` |
| `## Glob tool unavailable in subagent sessions (M148, 2026-07-25)`（`:372-376`） | `## Process` 1 行 + `casebook#moved-glob-tool-rule` 全文 |
| 收件箱机制叙事（Tools 第 2 条，`:322-324`） | `orchestration/archive/AC58-retired-clauses.md#R35` 一行指针 |
| classic loop / prepare-milestone / R19 / R20 叙事 | 保留为 `…AC58-retired-clauses.md#R18/#R19/#R20` 行内指针（`retired-clause-check` 复跑：`OK — 33 entries migrated`） |
| outer 角色退役叙事 | 压为一行状态 + `orchestration/SPEC-tmux-retirement-2026-09-03.md §8` |

### 复跑的既有门（未新增失败）
- `retired-clause-check.ts --root <wt>` ⇒ `OK — 33 entries migrated (55 unique tokens: all gone from source, all present in archive)`，exit 0（R17–R20 的 CLAUDE.md 侧独有词条在本轮改写后仍**全部不在**源文件里）。
- `threshold-scope-check.ts --root <wt>` ⇒ 重录后 `baselineCount 2 / currentCount 2 / growth false / newSinceBaseline 0`，exit 0。
- `plugin/test/threshold-scope-check.test.mjs` ⇒ **10/10 绿**，exit 0（本轮修复后；双向负控制见 Resolution）。
- `scripts/test.sh --for-task … --allow-thin` ⇒ exit 0，0 条 FAIL（change 级静态检查全绿）。

### 未覆盖
- **未跑全量 suite**（worker 不跑；由 driver 的 fan-in 承担）。本轮已单跑归因 4 条红中的 2 条时序 flake（solo 全绿）与 2 条同根真红（已修并负控制）。
- `docs/epistemology-casebook.md` **不被自动注入**，也不被任何检查器扫描——它的正确性由 `landing-map-check.sh`（锚点可解析）与本任务体的逐行映射保证，不由运行时门保证。
- the casebook 的叙事是**搬迁**不是**重写**：除拆行/加标题外未改写内容；若复核发现某条叙事在搬迁中被压缩，以 P0 快照为准（`orchestration/context-slimming/baseline/CLAUDE.md.snapshot` 是逐字节基线）。