---
id: gap-arch-retire-orphan-sh-and-dangling-symlinks
title: 架构清理：退役 3 个无调用者 .sh（两个 selfcheck + inner-stalled.sh）并删除 3
  个悬空符号链接（git-lens-l-*.ts）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**SPEC Phase 1b 的剩余量（SPEC 写作时是「11 个 selfcheck」，实测 `sh-census-check --json` 的 `orphanCandidates` 现在只剩 3 个）+ 3 个被跟踪的悬空符号链接。**

**实测清单（2026-09-20，`sh-census-check.ts --json` 中四类调用者计数全为 0 的 .sh）**：
```
orchestration/context-slimming/p2-archive-selfcheck.sh
orchestration/context-slimming/readings-selfcheck.sh
orchestration/watch/inner-stalled.sh
```
**悬空符号链接（`import-graph-check --json` 的 `dangling` 读数，目标 `plugin/scripts/git-lens-l-*.ts` 已不存在）**：
```
experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts
experiments/quay-perpetual-stream/scripts/git-lens-l-g-structural-drift.ts
experiments/quay-perpetual-stream/scripts/git-lens-l-s-behavior-variance.ts
```

**⛔ 删除前必做（硬规则 5，批量删除）**：`orphanCandidates` 的调用者计数只覆盖 ts/sh/test/other 四类静态引用，**不覆盖动态拼接的引用**。对每个待删文件 `git grep` 其 basename（`tasks/ docs/ archive/` 之外的一切）并读命中内容；`p2-archive-selfcheck.sh` 与 `readings-selfcheck.sh` 是 context-slimming 工作的产物，删前要核对 `orchestration/context-slimming/` 下的清单/SPEC 是否仍点名它们。产出「被删文件独有词条 → 新正本路径」的落点映射，贴进提交信息。任何一个有真实引用者的，**保留并从删除集移出**，写明原因，不算失败。

## AC

- [x] AC1（动态引用核对，枚举）对 3 个 .sh 与 3 个符号链接各贴出 `git grep -n <basename>` 的前 3 条命中内容（无命中写「0 条」并贴命令）；判定每个的处置（删 / 保留+理由）。
- [x] AC2（负控制，判据能取假）把一个**仍有调用者**的脚本临时列入删除集，落点核对必须拦下（exit 非 0 或报出引用者）；撤销后通过。两次输出贴进 notes。
- [x] AC3（读数下降）删除后 `sh-census-check.ts --json` 的 `totals.scripts` 与 `orphanCandidates` 长度按实际删除数下降，`import-graph-check.ts --json` 的 `dangling` 不再含上述 3 条；前后读数各贴一次。
- [x] AC4（棘轮同步）`plugin/sh-census-baseline.json` 若因删除而低于旧值，按「只降不升」同步下调并提交；`capability-catalog` 自报数与声明数一致（`bash plugin/scripts/capability-catalog.sh --summary`：`0 unclassified`）。
- [x] AC5（回归面）`scripts/test.sh --for-task gap-arch-retire-orphan-sh-and-dangling-symlinks` 全绿。

## DoD

真实落地：仓库里不再有上述被删对象，且 `sh-census-check` / `import-graph-check` 在真实树上给出下降后的读数。提交信息含落点映射。

## Touches

- orchestration/context-slimming/p2-archive-selfcheck.sh
- orchestration/context-slimming/readings-selfcheck.sh
- orchestration/watch/inner-stalled.sh
- experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts
- experiments/quay-perpetual-stream/scripts/git-lens-l-g-structural-drift.ts
- experiments/quay-perpetual-stream/scripts/git-lens-l-s-behavior-variance.ts
- plugin/sh-census-baseline.json
- plugin/scripts/capability-catalog-declarations.json
- plugin/test/sh-census-check.test.mjs
- tasks/gap-arch-retire-orphan-sh-and-dangling-symlinks.md

## Evidence

Landing commit: `556ad081c` (落地映射全文在该提交信息内)。删除 6 个对象，全部在删除**之前**过了 AC2 的落点核对。

### AC1 — 动态引用核对（`git grep -n <basename>`，删除前树 = `HEAD~1`）

**A. `orchestration/context-slimming/p2-archive-selfcheck.sh`** — 12 条命中，前 3 条：

    HEAD~1:orchestration/context-slimming/p2-archive-selfcheck.sh:3:# p2-archive-selfcheck.sh — context-slimming P2: plan / apply / check the memory archive.
    HEAD~1:orchestration/context-slimming/p2-archive-selfcheck.sh:30:# Usage: p2-archive-selfcheck.sh [--plan|--apply|--check] [--memory-dir DIR] [--days N]
    HEAD~1:orchestration/context-slimming/p2-archive-selfcheck.sh:35:: "${HOME:?p2-archive-selfcheck.sh: HOME is unset}"

余下命中全部落在 `tasks/`（本任务的 Touches/正文、`gap-arch-sh-census-check.md:95/125` 的候选清单、`gap-context-slim-p2-memory-archive.md` 的产物记录）。**判定：删。** 依据（枚举，非抽样）：`git grep -n p2-archive-selfcheck.sh -- . ':(exclude)tasks/**' ':(exclude)docs/**' ':(exclude)*archive/**' ':(exclude)<自身>'` 的退出码是 **1（0 条）** —— 即 `orchestration/context-slimming/` 下**没有任何** 清单/SPEC/脚本点名它（该目录的 `*.md` grep `selfcheck` 亦 0 条）。它的生产者与产出（`readings.sh`、`p2-archive-manifest.tsv`、`baseline/*.snapshot`）全部留在树上。

**B. `orchestration/context-slimming/readings-selfcheck.sh`** — 前 3 条：

    HEAD~1:orchestration/context-slimming/readings-selfcheck.sh:3:# readings-selfcheck.sh — dry-runs readings.sh against a known-true sample and known-missing
    HEAD~1:orchestration/context-slimming/readings-selfcheck.sh:32:# Usage: readings-selfcheck.sh [--transcripts-dir DIR] [--memory-dir DIR]
    HEAD~1:orchestration/context-slimming/readings-selfcheck.sh:39:: "${HOME:?readings-selfcheck.sh: HOME is unset}"

同样的 `':(exclude)tasks/**' ':(exclude)docs/**' ...` 干跑 → **exit 1（0 条）**。**判定：删。**

**C. `orchestration/watch/inner-stalled.sh`** — 前 3 条：

    HEAD~1:tasks/gap-arch-retire-orphan-sh-and-dangling-symlinks.md:3:title: 架构清理：退役 3 个无调用者 .sh（两个 selfcheck + inner-stalled.sh）并删除 3
    HEAD~1:tasks/gap-arch-retire-orphan-sh-and-dangling-symlinks.md:21:orchestration/watch/inner-stalled.sh
    HEAD~1:tasks/gap-arch-retire-orphan-sh-and-dangling-symlinks.md:48:- orchestration/watch/inner-stalled.sh

命中**只有**本任务自己的正文与另一个任务 `gap-telemetry-report-writes-and-deadlocks-readiness.md:83` 的一句历史叙述。排除 `tasks/`+`docs/`+`archive/` 后 **0 条**。**判定：删。** 它测的是 pane 忙闲代理量，CLAUDE.md 已把判层活性的正本改为直接量（git 提交时刻 / worktree 内活进程）；`plugin/scripts/inner-forensics.mjs` 头注释早已记「旧路径 orchestration/watch/ 已删」，本删除把该目录清空。

**D–F. 三个悬空符号链接**（`git-lens-l-{d,g,s}-*.ts`）— 各贴前 3 条：

    HEAD~1:.quay/ac260-residual-after.txt:10:    probes/architecture-analysis.md | plugin/scripts/git-lens-l-d-code-doc-ratio.ts -> MISSING scripts/git-lens-l-d-code-doc-ratio.ts
    HEAD~1:.quay/ac260-sibling-scan.txt:56:    probes/architecture-analysis.md | plugin/scripts/git-lens-l-d-code-doc-ratio.ts -> MISSING scripts/git-lens-l-d-code-doc-ratio.ts
    HEAD~1:.quay/routine-findings.jsonl:208:{... "findingId":"identity-replication-check-broken-by-dangling-symlinks" ...}

    HEAD~1:.quay/ac260-residual-after.txt:11:    probes/architecture-analysis.md | plugin/scripts/git-lens-l-g-structural-drift.ts -> MISSING scripts/git-lens-l-g-structural-drift.ts
    HEAD~1:.quay/ac260-residual-after.txt:13:    probes/semantic-dedup-scan.md | plugin/scripts/git-lens-l-g-structural-drift.ts -> MISSING scripts/git-lens-l-g-structural-drift.ts
    HEAD~1:.quay/ac260-sibling-scan.txt:57:    probes/architecture-analysis.md | plugin/scripts/git-lens-l-g-structural-drift.ts -> MISSING scripts/git-lens-l-g-structural-drift.ts

    HEAD~1:.quay/ac260-residual-after.txt:12:    probes/architecture-analysis.md | plugin/scripts/git-lens-l-s-behavior-variance.ts -> MISSING scripts/git-lens-l-s-behavior-variance.ts
    HEAD~1:.quay/ac260-sibling-scan.txt:58:    probes/architecture-analysis.md | plugin/scripts/git-lens-l-s-behavior-variance.ts -> MISSING scripts/git-lens-l-s-behavior-variance.ts
    HEAD~1:archive/2026-09-07-zero-call-scripts/plugin/scripts/git-lens-l-s-behavior-variance.ts:2:// git-lens-l-s-behavior-variance.ts — L_S (stability) convergence proxy, ADR-007/exp5-M-CRYST-G1.

排除 `tasks/ docs/ .quay/ archive/` 后，剩下的**运行类**引用者只有三类，逐个读过内容后**判定：删**（理由各自写明）：

1. `experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh:27/52/74` **确实执行**这三条路径（`node scripts/git-lens-l-*.ts`）。但它本身在 `runtime-usage-inventory.ts` 的 `DORMANT_BY_DECISION` 封存清单上、**不在** `scripts/test.sh` 也不在 `.github/workflows`（两处 grep 均 0 条），且**删前就已经是坏的**：目标 2026-09-07 被 `git mv` 进 `archive/2026-09-07-zero-call-scripts/`，该 selfcheck 现在 exit 1（`tasks/gap-adr007-per-milestone-dark-axis-enforcement-gate.md` 明写「探针本身的修复是另一个任务的范围」）。**删符号链接不改变它的退出码**：`node` 对悬空链接与对不存在路径同样报 MODULE_NOT_FOUND → exit 1，前后一致。
2. `plugin/scripts/runtime-usage-inventory.ts:89-91` 把这三条路径写进 `DORMANT_BY_DECISION`（路径**清单**，不是消费者）：缺失成员在 markdown 报告里降级渲染为 `not-enumerated`（同文件 :983，有 `s` 为空的分支），而 `plugin/test/runtime-usage-inventory.test.mjs:222` 断言的是**字符串**、不读盘。**无测试 / 无生产路径读这三条路径的文件系统存在性。**
3. `plugin/probes/architecture-analysis.md:21-23`、`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md:507-508`、`milestones/M106/audits/iteration-0-acceptance-audit.md:25-27`、`plugin/scripts/phase-declare.ts:38-43`、`plugin/test/dark-axis-record-check.test.mjs:73` —— 散文/注释提及。其中 `phase-declare.ts` 那条是**过去时的实测记录**（2026-09-13 已记「这三条是悬空符号链接」），它的 L_D 规则是重实现、不依赖这些文件。

**硬规则 5b 扫尾**：6 个 basename 各在**全树**（含 `docs/`、`.github/`、`plugin/`、`experiments/`、`orchestration/`）以及**仓库外的记忆目录** `~/.claude/projects/-home-yale-work-quay/memory/` 重跑一次 grep —— 上面的命中集就是**完整集**，不是抽样（记忆目录 0 条）。

### AC2 — 负控制（判据能取假）

核对谓词：删除集里每个路径都必须**是** `sh-census-check.ts --json` 的 `orphanCandidates` 成员（四类调用者计数全 0）。脚本 `/tmp/retire-landing-check.mjs`（读 census JSON，非子串匹配；`orphanCandidates` 之外出现在 `files[]` 里**不算**通过）。

**第一次（真删除集，3 条）→ exit 0：**

    OK       orchestration/context-slimming/p2-archive-selfcheck.sh  (orphanCandidates member, callers ts/sh/test/other = 0/0/0/0)
    OK       orchestration/context-slimming/readings-selfcheck.sh  (orphanCandidates member, callers ts/sh/test/other = 0/0/0/0)
    OK       orchestration/watch/inner-stalled.sh  (orphanCandidates member, callers ts/sh/test/other = 0/0/0/0)
    --- 3 path(s) checked, all clear
    EXIT=0

**第二次（真删除集 + `experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh`，一个**仍有调用者**的脚本）→ exit 1，报出引用者：**

    REFUSED  experiments/quay-perpetual-stream/scripts/git-lens-selfcheck.sh  (NOT an orphan candidate — live referencer)
             callers = {"ts":4,"sh":0,"test":0,"other":8}
             evidence = ts=4, other=8
    --- 4 path(s) checked, REFUSED
    EXIT=1

**第三次（撤销负控制样本）→ 回到 exit 0：**

    --- 3 path(s) checked, all clear
    EXIT=0

⇒ 谓词在**真取假**（不是恒绿）：它拦下了一个真实存在的、有 12 个静态调用者的脚本。

### AC3 — 读数下降（前后各一次，同一棵真实树）

删除前：

    sh-census-check.ts --json     totals.scripts = 150 ; orphanCandidates = ["orchestration/context-slimming/p2-archive-selfcheck.sh", "orchestration/context-slimming/readings-selfcheck.sh", "orchestration/watch/inner-stalled.sh"]
    import-graph-check.ts --json  dangling = ["experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts", "...-l-g-structural-drift.ts", "...-l-s-behavior-variance.ts"]

删除后（gate EXIT=0 两次）：

    sh-census-check.ts --json     totals.scripts = 147  (-3，= 实际删除的 3 个 .sh) ; orphanCandidates = []
    import-graph-check.ts --json  dangling = []
    （附带读数）totals.embeddedInterpreterLines 9183 -> 9133

### AC4 — 棘轮同步 + catalog 一致

`plugin/sh-census-baseline.json` 已**下调** `embeddedInterpreterLines` **9183 → 9133**（−50 = `inner-stalled.sh` 的 50 有效行；另两个 selfcheck 的 `embedded` 读数是 `[]`，它们的 529 行从来不在该轴内，提交信息与 `_reanchorLog` 新条目里都点名了这一点，而不是折进差值里），`duplicateCopies` 不动（0）。新 `_reanchorLog` 条目已追加。AC6（`plugin/test/sh-census-check.test.mjs`：committed baseline 必须**等于**实测读数，不只是不超）在 scoped gate 里 ✔。

`bash plugin/scripts/capability-catalog.sh --summary` → `349 scripts | 349 declared | 0 unclassified | 344 ship`（exit 0）。**计数不变是正确的**：`deriveScripts()` 只走 `plugin/scripts`，且 `if (!e.isFile()) continue` 把符号链接整类排除 ⇒ 被删的 3 个 `orchestration/` 下 .sh 与 3 条符号链接**从未**进过它的集合。故 `capability-catalog-declarations.json` **无需改动**（它本来就没有这 3 个 .sh 的声明）。

### AC5 — 回归面

`bash scripts/test.sh --for-task gap-arch-retire-orphan-sh-and-dangling-symlinks --allow-thin` → **EXIT 0**，`ℹ fail 0`；census 测试 **20/20 pass**（含 `AC6: the committed baseline EXISTS and equals the live reading on both ratchet axes` ✔）。scoped 静态检查层同轮全过（`import-graph-check` / `sh-census-check` 都在该层被调用），工作树在门后依然干净（`git status --short` 空）。
