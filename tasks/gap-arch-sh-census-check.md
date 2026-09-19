---
id: gap-arch-sh-census-check
title: 架构棘轮：shell 层普查检查器（内嵌解释器有效行 / 字节相同重复副本，例外清单单列），两个量只降不升
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
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

- [ ] AC1（自检能取假）`node --experimental-strip-types plugin/scripts/sh-census-check.ts --selftest` exit 0，输出逐行枚举 ≥7 个具名注入用例：含 python3 heredoc 的 sh ⇒ 计入内嵌；纯 git/进程胶水 sh ⇒ **不**计入；注释里只提到 `python3` 的 sh ⇒ **不**计入；一对字节相同的非链接副本 ⇒ `duplicateCopies`+1；同一对里一个换成符号链接 ⇒ 不计入重复、`symlinkedCopies`+1；例外清单内文件 ⇒ 计入 `exceptionLines` 而不计入 `embeddedInterpreterLines`；无 `.sh`/非 git 目录 ⇒ `evaluated:false` 且 exit 2。
- [ ] AC2（口径不被污染）真实仓库根 `--json`：`evaluated===true`；`totals.scripts` 等于独立命令 `git ls-files '*.sh' | grep -v 'checker-mutation-cases/' | grep -v '^archive/' | wc -l` 的输出；`files[].path` 中 `.claude/worktrees/` 出现 0 次。
- [ ] AC3（真样本，含正反）同一次 `--json`：`plugin/scripts/develop-deliver-tgz.sh` 与 `plugin/scripts/capability-catalog.sh` 的 `embedded` 非空；`plugin/scripts/os-anchor-install.sh` 与 `plugin/scripts/dead-loop-check.sh` 的 `embedded` 为空数组（已知纯胶水）。**若 `embeddedInterpreterScripts` 读数为 0，视为检查器失效。**
- [ ] AC4（重复副本真样本）`--json` 的重复副本清单包含 `experiments/quay-perpetual-stream/scripts/gate-script-base.ts` ↔ `plugin/scripts/gate-script-base.ts`（字节相同、非符号链接）；且 `symlinkedCopies` ≥ 1。
- [ ] AC5（例外清单不消失）`--json` 的 `files` 中 `plugin/scripts/verify-deliver-coldstart.sh` 与 `plugin/scripts/supervisor-deliver.sh` 均 `exception:true` 且其行数计入 `exceptionLines`；`exceptionLines` > 0。
- [ ] AC6（棘轮）`plugin/sh-census-baseline.json` 存在，两个值等于 AC2–AC4 所在那次真实读数；`--selftest` 含一条用例：基线任一值相对「HEAD 基线」调高 ⇒ exit 1。
- [ ] AC7（四件套）`bash plugin/scripts/capability-catalog.sh --entry-surface` exit 0；`node --experimental-strip-types plugin/scripts/checker-count-drift-check.ts` exit 0；`bash plugin/scripts/checker-mutation-check.sh --check` exit 0；`grep -n "sh-census-check" plugin/scripts/runner-static-gate.ts` 命中 `run_static_checks` 内的调用行。
- [ ] AC8（生产载体，非 fixture）经套件静态层**真实执行**（用 `scripts/test.sh` 的 scoped/静态入口，见其头注释），产出里能看到 `sh-census-check` 被执行且 PASS；关掉 `--selftest` 注入 seam 后该结论仍成立。命令与输出关键行贴进 notes。

## DoD

真实落地标准：检查器已通过套件静态层在真实仓库上跑过并输出真实基线；**负控制已实做并留证**——在任务 worktree 临时复制一个 `plugin/scripts/*.ts` 到 `experiments/quay-perpetual-stream/scripts/` 下（非链接），以及新增一个含 `python3 -c` 的 `.sh`，套件静态层变红，撤销后转绿，输出贴进 notes。`orphanCandidates` 在 notes 里明确写着「静态候选，删除前需动态引用核对」，不得被后续任务当结论直接删除。本任务**只观测，不删任何文件、不改任何现有脚本**——去重/删除在后续 Phase 1 任务里做。落地后 `bash plugin/scripts/capability-catalog.sh --summary` 的脚本数自报值 +1 且 UNCLASSIFIED=0。
