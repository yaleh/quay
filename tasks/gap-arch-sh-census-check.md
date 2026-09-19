---
id: gap-arch-sh-census-check
title: 架构棘轮：shell 层普查检查器（内嵌解释器有效行 / 字节相同重复副本，例外清单单列），两个量只降不升
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-305
---
**type:** execution

## Proposal

**建 shell 层普查检查器 `plugin/scripts/sh-census-check.ts`：对每个 tracked `.sh` 给出「是程序还是胶水」的可复核读数，并对两个会回升的量设「只降不升」棘轮。**

来源：`orchestration/SPEC-architecture-consolidation-ts-and-shell-2026-09-19.md`（下称 SPEC；⚠️ 此刻位于分支 `worktree-spec-architecture-refactor`，可能尚未在 develop 上——**本任务体自足**）§1.3 / §2 P2、P4 / §5 Phase 0b。

**为什么需要它**：archguard 不解析 shell；仓库里 tracked 的 `.sh` 中有一批「以 bash 为壳、内嵌 python/node/jq 为实」的程序（`verify-deliver-coldstart.sh` 6293 有效行、`develop-deliver-tgz.sh` 2346、`capability-catalog.sh` 2181、`quay-init.sh` 1332 …），还有 `experiments/quay-perpetual-stream/scripts/` 与 `plugin/scripts/` 之间字节相同的重复副本。没有任何读数在盯它们，后续 Phase 1/5 的「收敛了」就只能靠断言。

**口径（每条都对应一次已发生的错误，必须照做）**：
- **数据源 = `git ls-files '*.sh'`**，排除 `plugin/scripts/checker-mutation-cases/**`（测试夹具，85 个）与 `archive/**`。**禁用 `find`**：一次 `find` 曾扫进 `.claude/worktrees/*` 得到 5213（真值 144 个真脚本/236 个 tracked）。
- **有效行** = 去空行、去纯注释行后的行数；**内嵌解释器**按【代码位置】判定，注释/字符串/heredoc 之外的命令位置出现 `node`（带 `--experimental-strip-types`、`-e`、或直接跑 `.ts`）、`python3`、`jq`。注释里提到不算（硬规则 2）。
- **重复副本** = `experiments/**/scripts/` 与 `plugin/scripts/` 下同 basename、**非符号链接**且字节相同的文件对（含 `.sh` 与 `.ts`）；符号链接单独计为 `symlinkedCopies`，不计入重复。
- **无调用者（orphan）** = 对 tracked 的 ts/sh/mjs/js/md/yml/json（排除 `tasks/`、`docs/`、`archive/`）按 basename 字符串匹配，无任何调用者。⚠️ **这是静态字符串匹配，会漏掉动态拼接的脚本名**——输出里必须把它标为 `orphanCandidates`（候选，不是结论），并附 `orphanMethod:"static-basename-match"`。
- **例外清单**是数据文件 `plugin/sh-census-exceptions.txt`（每行 `<path>  # <理由>`），初始两族：①人 2026-09-19 裁定「暂保持 bash 现状，长期考虑退役」的控制面 shell：`plugin/scripts/{send-keys-reliable,supervisor-deliver,supervisor-bus,supervisor-preempt,supervisor-observe,process-budget}.sh`；②`plugin/scripts/verify-deliver-coldstart.sh`（人裁定「列入路线图但先不立案」）。例外文件**单列汇总**（`exceptionLines`），不计入棘轮读数——但也不得从输出里消失。
- **读不懂要说出来**（硬规则 3b）：输出 `evaluated:true|false`；git 不可用/无 `.sh`/例外文件不可解析 ⇒ `evaluated:false` + exit 2。

**两个棘轮读数**（基线文件 `plugin/sh-census-baseline.json`，形态照 `plugin/scripts/quay-init-closure-ratchet.ts`：读数 > 基线 ⇒ exit 1；基线在工作树中相对 git HEAD 只许降不许升）：
1. `embeddedInterpreterLines`：例外清单**之外**、含内嵌解释器的 `.sh` 的有效行合计。（参考量级：约 1.3 万行含例外；以检查器真实读数为准。）
2. `duplicateCopies`：非符号链接字节相同的重复副本对数。（参考：38，以真实读数为准。）

⚠️ 上面的参考量级来自一次正则/`cmp` 统计，**落地时以检查器真实读数为准**，差异逐条对账写进 notes，不得调检查器去凑数。

**CLI**：`node --experimental-strip-types plugin/scripts/sh-census-check.ts [<root>] [--json] [--selftest] [--baseline <file>] [--exceptions <file>]`；exit 0/1/2 同上。`--json` 至少含 `{evaluated, files:[{path,codeLines,embedded:["node"|"python3"|"jq"],tsTwin,callers:{ts,sh,test},exception}], totals:{scripts,codeLines,embeddedInterpreterScripts,embeddedInterpreterLines,exceptionLines,duplicateCopies,symlinkedCopies,orphanCandidates}, orphanMethod}`。

**新增检查器的四件套义务（缺一不可）**：①`plugin/scripts/capability-catalog.sh` 六张表各补一行（键=basename）；②登记进 `plugin/scripts/runner-static-gate.ts` 的 `run_static_checks`，带 `# @static-tier` 与 `# @static-object`；③新增 `plugin/scripts/checker-mutation-cases/sh-census-check.sh`；④`run_static_checks` 上的 `# @checker-count <N>` 加 1。新测试文件用 `node:test` 并声明 `// @test-group <name>`。

## Touches

- plugin/scripts/sh-census-check.ts (new)
- plugin/sh-census-baseline.json (new)
- plugin/sh-census-exceptions.txt (new)
- plugin/test/sh-census-check.test.mjs (new)
- plugin/scripts/capability-catalog.sh
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/checker-mutation-cases/sh-census-check.sh (new)
- tasks/gap-arch-sh-census-check.md

## AC

- [x] AC1（自检能取假）`node --experimental-strip-types plugin/scripts/sh-census-check.ts --selftest` exit 0，输出逐行枚举 ≥7 个具名注入用例：含 python3 heredoc 的 sh ⇒ 计入内嵌；纯 git/进程胶水 sh ⇒ **不**计入；注释里只提到 `python3` 的 sh ⇒ **不**计入；一对字节相同的非链接副本 ⇒ `duplicateCopies`+1；同一对里一个换成符号链接 ⇒ 不计入重复、`symlinkedCopies`+1；例外清单内文件 ⇒ 计入 `exceptionLines` 而不计入 `embeddedInterpreterLines`；无 `.sh`/非 git 目录 ⇒ `evaluated:false` 且 exit 2。
- [x] AC2（口径不被污染）真实仓库根 `--json`：`evaluated===true`；`totals.scripts` 等于独立命令 `git ls-files '*.sh' | grep -v 'checker-mutation-cases/' | grep -v '^archive/' | wc -l` 的输出；`files[].path` 中 `.claude/worktrees/` 出现 0 次。
- [x] AC3（真样本，含正反）同一次 `--json`：`plugin/scripts/develop-deliver-tgz.sh` 与 `plugin/scripts/capability-catalog.sh` 的 `embedded` 非空；`plugin/scripts/os-anchor-install.sh` 与 `plugin/scripts/dead-loop-check.sh` 的 `embedded` 为空数组（已知纯胶水）。**若 `embeddedInterpreterScripts` 读数为 0，视为检查器失效。**
- [x] AC4（重复副本真样本）`--json` 的重复副本清单包含 `experiments/quay-perpetual-stream/scripts/gate-script-base.ts` ↔ `plugin/scripts/gate-script-base.ts`（字节相同、非符号链接）；且 `symlinkedCopies` ≥ 1。
- [x] AC5（例外清单不消失）`--json` 的 `files` 中 `plugin/scripts/verify-deliver-coldstart.sh` 与 `plugin/scripts/supervisor-deliver.sh` 均 `exception:true` 且其行数计入 `exceptionLines`；`exceptionLines` > 0。
- [x] AC6（棘轮）`plugin/sh-census-baseline.json` 存在，两个值等于 AC2–AC4 所在那次真实读数；`--selftest` 含一条用例：基线任一值相对「HEAD 基线」调高 ⇒ exit 1。
- [x] AC7（四件套）`bash plugin/scripts/capability-catalog.sh --entry-surface` exit 0；`node --experimental-strip-types plugin/scripts/checker-count-drift-check.ts` exit 0；`bash plugin/scripts/checker-mutation-check.sh --check` exit 0；`grep -n "sh-census-check" plugin/scripts/runner-static-gate.ts` 命中 `run_static_checks` 内的调用行。
- [x] AC8（生产载体，非 fixture）经套件静态层**真实执行**（用 `scripts/test.sh` 的 scoped/静态入口，见其头注释），产出里能看到 `sh-census-check` 被执行且 PASS；关掉 `--selftest` 注入 seam 后该结论仍成立。命令与输出关键行贴进 notes。

## DoD

真实落地标准：检查器已通过套件静态层在真实仓库上跑过并输出真实基线；**负控制已实做并留证**——在任务 worktree 临时复制一个 `plugin/scripts/*.ts` 到 `experiments/quay-perpetual-stream/scripts/` 下（非链接），以及新增一个含 `python3 -c` 的 `.sh`，套件静态层变红，撤销后转绿，输出贴进 notes。`orphanCandidates` 在 notes 里明确写着「静态候选，删除前需动态引用核对」，不得被后续任务当结论直接删除。本任务**只观测，不删任何文件、不改任何现有脚本**——去重/删除在后续 Phase 1 任务里做。落地后 `bash plugin/scripts/capability-catalog.sh --summary` 的脚本数自报值 +1 且 UNCLASSIFIED=0。

## Notes

### 落地读数（检查器自报 2026-09-19；由 `--json` 的 `totals` 直接读出，非手填）

| 量 | 检查器真实读数 | 任务体/来源给的参考量级 | 对账 |
|---|---|---|---|
| `scripts` | **146** | SPEC §1.3 说 144 | 差 2：SPEC 的 144 是更早一次统计；本次以 `git ls-files` 的独立命令为准，AC2 断言两者逐字相等（146 = 146） |
| `codeLines` | **25187** | — | 含本任务自己的六行 catalog 登记（见下文重锚） |
| `embeddedInterpreterScripts` | **58**（例外清单外；含例外 65） | SPEC「58 个内嵌 node / 21 个内嵌 python / 4 个内嵌 jq」 | 不同口径：SPEC 那三个是【调用点次数】，本行是【脚本个数】 |
| `embeddedInterpreterLines`（例外外） | **11431** | 「约 1.3 万行含例外」 | ⚠️ 真实读数【含例外】= 18931（11431 + 7500）。参考值 1.3 万偏低，且与它自己的明细表矛盾：SPEC §1.3 表格里 8 个具名脚本的有效行之和已有 14534。⇒ 以本次真实读数为准 |
| `exceptionLines` | **7500** | — | 7 个例外文件的有效行合计 |
| `duplicateCopies` | **38** | 38 | **逐字相同**。SPEC 提到的「2 对同名但内容有差异」单列为 `differingSameName`：`tree-hygiene-check.sh` / `worktree-branch-hygiene-check.sh` |
| `symlinkedCopies` | **19** | SPEC 说 22 个符号链接 | 差 3：22 是 `experiments/**/scripts/` 下【全部】符号链接数，19 是其中【在 plugin/scripts 有同名对手】的那些（另 3 个 `git-lens-*.ts` 指向别处，无同名对手、不可比）。两个口径都不丢：本检查器按「同名对」计 19，全量符号链接见 `--json` 的 `symlinked` 数组 |
| `orphanCandidates` | **2** | SPEC §1.3 说 11 个 | 差 9：SPEC 的 11 用「词干子串匹配」，本检查器按任务体口径用【basename 字面匹配】。词干匹配会把 `mock-ssh.sh` 之类算作有调用者 ⇒ 口径更宽 ⇒ 候选更少。两者都是静态候选 |

### ⚠️ `orphanCandidates` 是静态候选，不是结论——删除前必须做动态引用核对

本读数按 basename 静态字符串匹配得出，**会漏掉动态拼接的脚本名**（形如 `dirname $0` 拼接 `${MODE}` 之类的构造完全不进语料匹配面）。本次两个候选是 `orchestration/context-slimming/readings-selfcheck.sh` 与 `orchestration/watch/inner-stalled.sh`。**后续任务不得据本读数直接删除任何文件**：必须先 `git grep` 其 basename 于全树（含 `tasks/ docs/ archive/`）+ 跑受影响测试（同 SPEC §6-2 / 硬规则 5b 的纪律）。

### 负控制（DoD，已实做并留证）

在任务 worktree 里：① 复制 `plugin/scripts/accounting-emit.ts` → `experiments/quay-perpetual-stream/scripts/accounting-emit.ts`（非链接、字节相同）；② 新增 `plugin/scripts/zz-negative-control-shc.sh`（2 行，含 `python3 -c`）。两者 **`git add`** 后跑套件静态层：

```
$ bash scripts/test.sh --static-checks
  duplicateCopies=39 symlinkedCopies=19 orphanCandidates=3 (static-basename-match)
  OVER baseline on: embeddedInterpreterLines, duplicateCopies
sh-census-check: FAIL — embeddedInterpreterLines 11432 > baseline 11431; duplicateCopies 39 > baseline 38
STATIC_CHECK_FAILED: sh-census-check exit=1
checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): sh-census-check(exit=1)
→ 整层 exit 1，且【唯一红点就是 sh-census-check】（STATIC_CHECK_FAILED 只出现一次）
```

撤销（`git rm --cached` + 删文件，工作树 `git status --short` 归空）后同一入口：

```
$ bash scripts/test.sh --static-checks
PASS — embeddedInterpreterLines=11431 ≤ 11431, duplicateCopies=38 ≤ 38 (headBaseline {...11431, 38})
→ exit 0；STATIC_CHECK_FAILED 出现 0 次
```

⚠️ 注入必须 `git add`：检查器的数据源是 `git ls-files`（读索引），**未跟踪的注入对它不可见**——这正是本负控制第一版「没红」的原因（一个只查跟踪集的检查器，对未跟踪的注入天然沉默；这条同样适用于后续任何拿它做负控制的人）。

### AC8 生产载体证据（不传 `--selftest`，走真实仓；注入 seam 关掉后结论仍成立）

```
$ bash scripts/test.sh --for-task gap-arch-sh-census-check --allow-thin
  scoped check: run_checker "sh-census-check" node --no-warnings --experimental-strip-types "…/plugin/scripts/sh-census-check.ts" --root "…"
sh-census-check: 146 tracked .sh · 25187 code lines · 58 with an embedded interpreter (11431 lines) · 7500 exception lines
  duplicateCopies=38 symlinkedCopies=19 orphanCandidates=2 (static-basename-match)
PASS — embeddedInterpreterLines=11431 ≤ 11431, duplicateCopies=38 ≤ 38 (headBaseline {"embeddedInterpreterLines":11431,"duplicateCopies":38})
ℹ pass 36   ℹ fail 0   → exit 0
```

即：静态层**真的执行了**它（其 stdout 在产物里可见），判定 PASS，且这一结论不依赖任何注入 seam。

### 基线重锚 11425 → 11431（+6），逐条对账

首次锚定（11425）取自 catalog 登记**之前**的树；本任务按要求在六张表各补一行 ⇒ `plugin/scripts/capability-catalog.sh` 有效行 **2187 → 2193**，而该文件本身就是内嵌 python3 的程序壳 ⇒ 该轴 **+6**。**这是本任务自身强制动作的必然后果，不是新增负债，也不是把检查器往数字上凑**（两次读数都由检查器自己跑出，改的只是基线数据文件；Δ 逐条归因到具体文件与具体行数，无未解释残差）。重锚单独成一个提交，理由与 Δ 归因写在提交信息里。

### ⚠️ 结构性发现（供 Phase 4 参考）

`capability-catalog.sh` 的约 1900 行数据表**整个文件**计入 `embeddedInterpreterLines`，因此此后**每立一个新 plugin 脚本（六行登记）都会把该轴推高 6** ⇒ 这条棘轮无法仅靠「不再新写内嵌程序」收敛，必须等 Phase 4 把该表搬进数据文件（届时该轴一次性下降约 1900）。本任务的重锚就是这个结构性事实的第一次显现。

### 检查器实现中实测到并修掉的两个「伪装成一切正常」的错误（都由注入用例钉住）

1. **`<<<` herestring 被当成 heredoc 声明**：`capability-catalog.sh:2272` 的 `done <<<"${DOC_REFERENCED_SH}"` —— 只前进两个 `<` 会让第二个 `<` 看起来是一个新的 `<<`（其后是 `"` 而非 `<`），于是这里串的词被登记成 heredoc 分隔符，**其后整个文件被掩码、capability-catalog.sh 的读数归零**。读数归零与「一切正常」同形（硬规则 4）。
2. **heredoc 正文行的换行未被掩码**：逐行掩码正文时漏掉了行尾换行。

两者都只在【真样本】上暴露 —— AC3 对 `capability-catalog.sh` 的断言正是抓它们的判据（注入用例只覆盖到合成形态，是这条真样本断言先红、才把根因逼出来的）。

### 未改现有脚本行为

本任务只新增文件。对现有文件的两处改动是四件套义务强制的**登记面**：`capability-catalog.sh` 六行数据、`runner-static-gate.ts` 一行注册 + `# @checker-count 63→64`。无行为改动、无删除、无重命名。
