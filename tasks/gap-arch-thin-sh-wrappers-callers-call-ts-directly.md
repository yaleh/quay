---
id: gap-arch-thin-sh-wrappers-callers-call-ts-directly
title: 架构清理：27 个「≤25 行且有 TS 孪生」的薄 .sh 包装——调用方改为直接调 TS，逐个核对后退役（SPEC Phase 1c）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**SPEC Phase 1c：`sh-census-check --json` 中 `tsTwin=true ∧ codeLines≤25` 的 .sh 现有 27 个（含 experiments 侧同名条目）——它们只是 `node --experimental-strip-types <x>.ts` 的壳。把调用方改为直调 `.ts`（或经一个统一 helper），壳退役。**

**⚠️ 范围要先收窄再动手**：这 27 条里有相当一部分是 `experiments/…/scripts/*.sh` → `plugin/scripts/*.sh` 的**符号链接**（Phase 1a 的产物，计数按路径不按 inode）。真实待处理的壳数 ≠ 27。**第一步用 `git ls-files -s | awk '$1==120000'` 区分符号链接与真文件，重算真实清单**，写进 notes；符号链接侧随其目标一起处理，不单独改。

**为什么不能一把梭**：这些壳被大量入口引用（例：`audit-independence-check.sh` 的 callers 计数 ts=1 sh=1 test=4 other=25；`task-schema-check.sh`、`capability-catalog.sh` 是 CLAUDE.md 与 skill 文案点名的入口——`capability-catalog.sh` 为「唯一清单」入口，SPEC Phase 4 已明确**入口不可断**）。⇒ **对外文案点名的入口一律保留**；只处理内部调用方可安全改直调的。分批提交，每批只动 Touches 不相交的一组，避免与在飞任务抢文件。

## AC

- [x] AC1（真实清单，枚举）贴出区分符号链接后的真实壳清单（路径 + 行数 + callers 四类计数），并给每个的处置：`保留（对外入口，理由）` / `调用方改直调后删` / `随目标处理（符号链接）`。
- [x] AC2（引用面核对，硬规则 5）每个拟删壳：`git grep -n <basename>` 全仓前 3 条命中内容 + 动态拼接引用检查；有对外文案/skill/hook/`settings` 引用者的不删。产出「被删壳 → 直调 TS 命令」落点映射贴进提交信息。
- [x] AC3（负控制）把一个仍被对外文案引用的壳临时列入删除集，引用面核对必须拦下；撤销后通过。两次输出贴进 notes。
- [x] AC4（等价，characterization）对每个改直调的调用点，旧壳与新直调对同一输入的退出码与关键输出一致（贴对照）；⛔ 不得只看「脚本能跑」。
- [x] AC5（读数下降）`sh-census-check.ts --json` 的 `totals.scripts` 下降且 `plugin/sh-census-baseline.json` 只降不升；`capability-catalog.sh --summary` 声明数与脚本数一致、`0 unclassified`。
- [x] AC6（回归面）`scripts/test.sh --for-task gap-arch-thin-sh-wrappers-callers-call-ts-directly` 全绿，且被改调用方各自的测试文件已单独跑并贴结果。

## DoD

真实落地：真实仓库上薄壳数按 AC1 清单下降，且被保留的每个壳都有写明的「对外入口」理由；没有任何被删壳仍有引用者（AC2 的枚举为证）。

## Touches

- experiments/quay-perpetual-stream/scripts/anti-drift-touches-check.sh (delete)
- experiments/quay-perpetual-stream/scripts/anti-drift-touches-selfcheck.sh
- experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.sh (delete)
- experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler-selfcheck.sh
- experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.sh (delete)
- experiments/quay-perpetual-stream/scripts/serial-fanin-absorb.sh (delete)
- experiments/quay-perpetual-stream/scripts/serial-fanin-absorb-selfcheck.sh
- experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.sh (delete)
- experiments/quay-perpetual-stream/scripts/touches-orthogonality-selfcheck.sh
- plugin/scripts/anti-drift-touches-check.ts
- plugin/scripts/workflow-baseline-metrics.ts
- plugin/scripts/capability-catalog-declarations.json
- plugin/sh-census-baseline.json
- plugin/test/sh-census-check.test.mjs
- tasks/gap-arch-thin-sh-wrappers-callers-call-ts-directly.md

## Evidence

本批（SPEC Phase 1c 的第一批）删除 5 个「只是 `node $(dirname $0)/<x>.ts "$@"` 壳」的 experiments 侧 .sh，并把它们的活调用方改为直调 `.ts`。落地提交 `d9359caf4`（落点映射全文在该提交信息内）。经核对**不**删的 17 个真文件 + 7 个符号链接，处置与理由见 AC1 表。

### AC1 — 真实清单（枚举）与逐条处置

`node --experimental-strip-types plugin/scripts/sh-census-check.ts --json`（删除前树）筛 `tsTwin=true ∧ codeLines≤25` 得 **29** 条。用 `git ls-files -s | awk '$1==120000'` 交叉：

```
# REAL FILES (22) — 行数 / callers{ts,sh,test,other} / 处置
experiments/quay-perpetual-stream/scripts/anti-drift-touches-check.sh        5  {2,1,0,1}    删（本批）
experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.sh      7  {0,1,0,1}    删（本批）
experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.sh   11  {0,1,1,5}    删（本批，零活调用者）
experiments/quay-perpetual-stream/scripts/it0-dod-check.sh                   2  {1,1,1,198}  保留（CLAUDE.md 点名的 DoD meta-enforcer 入口）
experiments/quay-perpetual-stream/scripts/serial-fanin-absorb.sh             5  {2,1,0,1}    删（本批）
experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.sh    11  {0,1,0,1}    删（本批）
plugin/scripts/anti-gaming-guard.sh                                         16  {2,1,1,7}    保留（.quay/config.yml.example 的 gate script + plugin/test/plugin-packaging.test.mjs 固定）
plugin/scripts/audit-independence-check.sh                                  16  {1,1,4,25}   保留（plugin-packaging DIR-070-C 固定；catalog NOT_SHIPPED；experiments 侧 selfcheck 调用）
plugin/scripts/cap-from-gate.sh                                              8  {7,2,5,9}    保留（PUBLIC_ENTRYPOINTS；orchestration/plugin-loop 多份 tick 文档点名）
plugin/scripts/capability-catalog.sh                                        14  {10,7,11,24} 保留（PUBLIC_ENTRYPOINTS；CLAUDE.md「唯一清单」；SPEC Phase 4 明说入口不可断）
plugin/scripts/cross-machine-verify.sh                                       8  {2,2,2,6}    保留（自身头部声明 WRITTEN-DOWN interface；periodic-push-backup.sh 调用；characterization 测试钉住入口形态）
plugin/scripts/drivable-workspace-check.sh                                  16  {3,1,1,12}   保留（.quay/config.yml.example gate script + plugin-packaging 固定）
plugin/scripts/integration-batch-merge.sh                                    3  {6,2,5,16}   保留（PUBLIC_ENTRYPOINTS；分支模型文档）
plugin/scripts/it0-enforcement-with-design-check.sh                         17  {0,0,2,6}    保留（plugin-packaging DIR-070-C 固定；catalog NOT_SHIPPED）
plugin/scripts/it0-split-or-commit-check.sh                                 18  {1,1,2,8}    保留（runner-static-gate.ts 注册 x2；golden-legacy-prompts fixture 以命令行形式钉住）
plugin/scripts/loadbearing-test-gate.sh                                     16  {2,2,6,34}   保留（ADR-001 点名；plugin-packaging 固定）
plugin/scripts/slot-refill.sh                                                8  {0,1,0,4}    保留（PUBLIC_ENTRYPOINTS；ADR-032 + 多份 tick 文档）
plugin/scripts/task-schema-check.sh                                          7  {0,13,1,29}  保留（ADR-004 点名；13 个 .sh 调用者；plugin-packaging 固定）
plugin/scripts/test-framework-policy-check.sh                               17  {1,0,2,2}    保留（runner-static-gate.ts 注册）
plugin/scripts/test-isolation-check.sh                                      17  {1,0,1,1}    保留（runner-static-gate.ts 注册）
plugin/scripts/tmp-leak-pairing-check.sh                                    17  {1,0,3,2}    保留（runner-static-gate.ts 注册）
plugin/scripts/vmeta-lag-check.sh                                           16  {2,7,3,63}   保留（.quay/config.yml.example gate + plugin-packaging + experiments selfcheck + packages/quay/test/dir022-remaining-gates.test.mjs）

# SYMLINKS (7) — 随目标处理（目标全部保留，故不单独改）
experiments/quay-perpetual-stream/scripts/audit-independence-check.sh                -> ../../../plugin/scripts/audit-independence-check.sh
experiments/quay-perpetual-stream/scripts/drivable-workspace-check.sh                -> ../../../plugin/scripts/drivable-workspace-check.sh
experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.sh       -> ../../../plugin/scripts/it0-enforcement-with-design-check.sh
experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.sh               -> ../../../plugin/scripts/it0-split-or-commit-check.sh
experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh                   -> ../../../plugin/scripts/loadbearing-test-gate.sh
experiments/quay-perpetual-stream/scripts/task-schema-check.sh                       -> ../../../plugin/scripts/task-schema-check.sh
experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh                         -> ../../../plugin/scripts/vmeta-lag-check.sh
```

**清单本身的两条更正（写进 notes，见 Proposal 的「先收窄再动手」）**：①立案时的 27 ≠ 现状 29（Phase 1a/1b 的产品变动），**29 − 7 符号链接 = 22 个真文件**；②**29 条里没有一条是 `experiments → plugin/scripts/*.sh` 的符号链接**——7 条符号链接全部指向 `plugin/scripts/*.sh`，而本批删的 5 条全在 experiments 侧且是**真文件**（各有自己的 `.ts` 孪生：前 4 个是 symlink 到 plugin 的模块，`it0-backlog-projection-check.ts` 是 experiments 侧的真文件）。

**保留理由的三条机械依据**（不是印象）：①`PUBLIC_ENTRYPOINTS`（`plugin/scripts/capability-catalog-declarations.json`）——由 `packages/quay/scripts/package.sh` 的 `capability-catalog.sh --entry-surface` 门强制（下文 AC3 的负控制就是拿它做的）；②`plugin/test/plugin-packaging.test.mjs` 的 DIR-070-B/C 固定清单——它把 `.sh` 包装**明写为「gates runnable via their .sh wrappers」的交付形态**；③`plugin/scripts/runner-static-gate.ts` 的 `run_checker "…" bash "${repo_root}/plugin/scripts/<x>.sh"` 注册行——**打包形态下 `.sh` 由 `build-plugin-dist.mjs` 的 `rewriteInvokers` 改写成 `dist/<x>.js`，而该 rewriter 不处理 `runner-static-gate.ts`（它只走 `mdDirs` 的 `.md`/`.js` 与 `shDirs` 的 `.sh`）**，所以删掉 `.sh` 会让打包后的注册行指向一个已被 `package.sh` 删掉的 `.ts` ⇒ 交付物的静态门整层失效。这一条是「动态拼接引用检查」的产物，不是静态 basename 匹配能看到的。

### AC2 — 引用面核对（硬规则 5）与落点映射

删除前树 = `HEAD~1`。每个拟删壳 `git grep -n <basename>` 全仓前 3 条：

**`anti-drift-touches-check.sh`**（10 个文件命中）前 3 条：

    HEAD~1:docs/analysis/runtime-usage-inventory.json:579:      "relPath": "experiments/quay-perpetual-stream/scripts/anti-drift-touches-check.sh",
    HEAD~1:docs/analysis/runtime-usage-inventory.json:580:      "realPath": "experiments/quay-perpetual-stream/scripts/anti-drift-touches-check.sh",
    HEAD~1:docs/analysis/runtime-usage-inventory.json:581:      "basename": "anti-drift-touches-check.sh",

**`concurrent-batch-scheduler.sh`**（5 个）前 3 条：

    HEAD~1:docs/analysis/runtime-usage-inventory.json:1535:      "relPath": "experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.sh",
    HEAD~1:docs/analysis/runtime-usage-inventory.json:1536:      "realPath": "experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.sh",
    HEAD~1:docs/analysis/runtime-usage-inventory.json:1537:      "basename": "concurrent-batch-scheduler.sh",

**`it0-backlog-projection-check.sh`**（13 个）前 3 条：

    HEAD~1:docs/analysis/runtime-usage-inventory.json:2319:      "relPath": "experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.sh",
    HEAD~1:docs/analysis/runtime-usage-inventory.json:2320:      "realPath": "experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.sh",
    HEAD~1:docs/analysis/runtime-usage-inventory.json:2321:      "basename": "it0-backlog-projection-check.sh",

**`serial-fanin-absorb.sh`**（8 个）前 3 条：

    HEAD~1:docs/analysis/runtime-usage-inventory.json:3635:      "relPath": "experiments/quay-perpetual-stream/scripts/serial-fanin-absorb.sh",
    HEAD~1:docs/analysis/runtime-usage-inventory.json:3636:      "realPath": "experiments/quay-perpetual-stream/scripts/serial-fanin-absorb.sh",
    HEAD~1:docs/analysis/runtime-usage-inventory.json:3637:      "basename": "serial-fanin-absorb.sh",

**`touches-orthogonality-check.sh`**（7 个）前 3 条：

    HEAD~1:docs/analysis/runtime-usage-inventory.json:3909:      "relPath": "experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.sh",
    HEAD~1:docs/analysis/runtime-usage-inventory.json:3910:      "realPath": "experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.sh",
    HEAD~1:docs/analysis/runtime-usage-inventory.json:3911:      "basename": "touches-orthogonality-check.sh",

**命中集是完整集，不是抽样**（`git grep -l <basename>.sh HEAD~1 -- .` 的**全部**文件逐个读过内容），并按类归并——五个壳的命中集**只**落在下列五类里，**没有第六类**：

1. **`docs/analysis/runtime-usage-inventory.{json,md}`** —— 一份**带日期戳的生成报告**（头部自述 `Generated at: 2026-08-03T04:06:42.196Z` · repo root `/tmp/quay-wt-inventory`），不是门输入：全仓只有它自己的测试与 `archive-exclusion-wiring.test.mjs` 读它的模块，**没有任何 gate/测试读盘比对它的新鲜度**（`scripts/*.sh` 与 `.github/workflows/*.yml` grep `runtime-usage-inventory` 均 0 条）。它是 2026-08-03 那棵树的快照，故**故意留旧**——同一条先例：Phase 1b 删的 3 个 .sh 在它里面同样是 0 条（删除早于本任务）。
2. **历史记录**：`milestones/M109|M107/**`、`experiments/quay-perpetual-stream/{dashboard-archive,milestones}/**`、`docs/plans/M209-*.md` —— 过去轮次的审计/迭代/计划产物，记录「当时是什么」，不是调用指令。
3. **本任务自己的 `tasks/**` 命中**（4 个任务文件）—— 任务记录。
4. **同名但不同文件**：`plugin/gate-scripts/it0-backlog-projection-check.sh`（DIR-070 分层退休的冻结产物，由 `plugin/test/gate-scripts-retirement.test.mjs:64` **明写必须留在树上**）、以及 `plugin/gate-scripts/it0-dod-check.sh:3` 指向**那一个**的注释。它们与 experiments 侧被删文件无关。
5. **两处真代码引用，已在本批改掉**：`experiments/.../scripts/*-selfcheck.sh`（4 个，调用方）与 `plugin/scripts/workflow-baseline-metrics.ts:1074`（synthetic fixture 字符串）、`plugin/scripts/anti-drift-touches-check.ts:222`（历史注释）。

**判定：5 个全删。** 依据是**枚举**而非抽样：4 个 selfcheck 已改为直调 `.ts`（下 AC4），另两处字符串已同步；剩下的命中全部属上述第 1–4 类（生成报告 / 历史记录 / 任务记录 / 无关同名文件）。

**落点映射（已全文贴进提交信息 `d9359caf4`）**：

    anti-drift-touches-check.sh     -> node experiments/quay-perpetual-stream/scripts/anti-drift-touches-check.ts
    concurrent-batch-scheduler.sh   -> node experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.ts
    it0-backlog-projection-check.sh -> node experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.ts
    serial-fanin-absorb.sh          -> node experiments/quay-perpetual-stream/scripts/serial-fanin-absorb.ts
    touches-orthogonality-check.sh  -> node experiments/quay-perpetual-stream/scripts/touches-orthogonality-check.ts

**⛔ 存活检查的关键结论**：`git grep` 的全仓命中**不代表**有调用者。五个壳里唯一在「对外文案/skill/hook/settings」面出现过的是——**一次也没有**。反向的已知为真对照（下一节）证明这个谓词**能取假**。

### AC3 — 负控制（判据能取假）

**第一半：对【已知为真】的样本干跑谓词**（硬规则 2 的另一半——零计数不能自证）。

    $ git grep -c 'cap-from-gate\.sh' -- ':!tasks/' ':!milestones/' ':!docs/' ':!archive/' | head -5
    .quay/ac260-branch-content-spotchecks.txt:1
    .quay/config.yml.example:1
    orchestration/fast-mode-tick-core.md:1
    orchestration/manager-loop-tick.md:2
    orchestration/manager-obligation-ledger.jsonl:2

⇒ 谓词在一个**未被删的、确有调用者的**壳上**非空**，所以上面对 5 个被删壳得到的 0 条是「查过且无」而不是「谓词坏了」。

**第二半：把仍被对外文案引用的壳临时列入删除集**（用机制本体 `capability-catalog.sh --entry-surface`——它就是 `package.sh` 的交付形态门）。样本 = `cap-from-gate.sh`（`orchestration/fast-mode-tick-core.md` + 4 份 tick 文档点名；在 `PUBLIC_ENTRYPOINTS` 里）。

第一次（原样）：

    $ bash plugin/scripts/capability-catalog.sh --entry-surface
    delivery form (.sh): 75 shipped | 29 declared consumer-facing | 46 internal
    consumer-facing docs reference 21 distinct .sh
    AC3 gate: every consumer-doc-referenced .sh is a declared public entry point → PASS
    exit=0

第二次（把 `cap-from-gate.sh` 从 `PUBLIC_ENTRYPOINTS` 划掉 = 临时当作要删的内部壳）：

    $ bash plugin/scripts/capability-catalog.sh --entry-surface
    delivery form (.sh): 75 shipped | 28 declared consumer-facing | 47 internal
    consumer-facing docs reference 21 distinct .sh
    FAIL (AC3): 1 internal .sh script(s) are referenced by consumer-facing docs — the demotion is verbal, not real:
      cap-from-gate.sh
      Declare each in PUBLIC_ENTRYPOINTS (capability-catalog-declarations.json) OR remove the doc reference.
    exit=1

第三次（撤销后）：

    $ bash plugin/scripts/capability-catalog.sh --entry-surface
    delivery form (.sh): 75 shipped | 29 declared consumer-facing | 46 internal
    consumer-facing docs reference 21 distinct .sh
    AC3 gate: every consumer-doc-referenced .sh is a declared public entry point → PASS
    exit=0

⇒ 引用面核对**拦得下**（exit 1 且点名），撤销后回到 exit 0。同一谓词的 `git grep` 半边也在第一半里对真样本取到了非零 —— **两半都做了**，只做一半只防一个方向。

### AC4 — 等价（characterization），逐调用点对照

对**同一输入**跑「`HEAD~1` 的原壳」与「直调 `.ts`」，比对退出码 + stdout + stderr（stderr 逐字节比对前把 Node 告警横幅里的 PID `(node:N)` 归一为 `(node:PID)`）。原壳从 `git show HEAD~1:<path>` 取出后**放回原目录**执行（否则 `$(dirname "$0")` 解析不到孪生 `.ts`；这是本证据第一次跑失败的原因，已更正）。

    anti-drift-touches-check     fixtures/antidrift/green.json                                   old=0 new=0  stdout=IDENTICAL stderr(norm)=IDENTICAL
    anti-drift-touches-check     fixtures/antidrift/red-overlap.json                             old=1 new=1  stdout=IDENTICAL stderr(norm)=IDENTICAL
    anti-drift-touches-check     fixtures/antidrift/red-stray.json                               old=1 new=1  stdout=IDENTICAL stderr(norm)=IDENTICAL
    anti-drift-touches-check     fixtures/antidrift/red-overbroad.json                           old=1 new=1  stdout=IDENTICAL stderr(norm)=IDENTICAL
    concurrent-batch-scheduler   fixtures/scheduler/exec-a.md exec-b.md                          old=0 new=0  stdout=IDENTICAL stderr(norm)=IDENTICAL
    concurrent-batch-scheduler   …/exec-a.md exec-b.md exec-c-overlaps-a.md learning-d.md shared-state-e.md  old=0 new=0  stdout=IDENTICAL stderr(norm)=IDENTICAL
    concurrent-batch-scheduler   fixtures/scheduler/shared-state-e.md                            old=0 new=0  stdout=IDENTICAL stderr(norm)=IDENTICAL
    serial-fanin-absorb          --counter 73 fixtures/fanin/two-build-manifest.json             old=0 new=0  stdout=IDENTICAL stderr(norm)=IDENTICAL
    serial-fanin-absorb          fixtures/fanin/two-build-manifest.json  (缺 --counter)          old=2 new=2  stdout=IDENTICAL stderr(norm)=DIFF ↓
    touches-orthogonality-check  fixtures/touches/disjoint-a.md disjoint-b.md                    old=0 new=0  stdout=IDENTICAL stderr(norm)=IDENTICAL
    touches-orthogonality-check  fixtures/touches/overlap-a.md overlap-b.md                      old=1 new=1  stdout=IDENTICAL stderr(norm)=IDENTICAL
    touches-orthogonality-check  fixtures/touches/typo.md disjoint-b.md                          old=1 new=1  stdout=IDENTICAL stderr(norm)=IDENTICAL
    it0-backlog-projection-check .                                                               old=1 new=1  stdout=IDENTICAL stderr(norm)=IDENTICAL

**13/13 退出码相同、stdout 逐字节相同。** 唯一 `stderr=DIFF` 的一格已逐行读过，差异只有**程序名 token**：

    旧（壳自己的参数守卫，先于委派）：  Usage: scripts/.oldchar-serial-fanin-absorb.sh --counter <N> <builds-manifest.json>
    新（模块自己的同一守卫）：          Usage: serial-fanin-absorb.mjs --counter <N> <builds-manifest.json>

两者**同一文本、同一退出码 2**，只有 `$0` 换成模块名（模块里那个 `.mjs` 是既有的命名瑕疵，本批未改）。这正是本格需要「旧壳自带的 usage 守卫恰好等价于模块自带的守卫」这一事实——所以换成直调后**行为不变**。

**四个 selfcheck 调用点本身**（改动的直接对象）也对同一输入做了旧/新对照：把 `HEAD~1` 版 selfcheck 取出执行 vs 改后的版本，**4/4 退出码 0 且 stdout 逐字节相同**：

    anti-drift-touches-selfcheck        exit old=0 new=0  stdout=same
    concurrent-batch-scheduler-selfcheck exit old=0 new=0 stdout=same
    serial-fanin-absorb-selfcheck       exit old=0 new=0  stdout=same
    touches-orthogonality-selfcheck     exit old=0 new=0  stdout=same

⛔ 不是「脚本能跑」：上面每一格都是**同一输入下旧壳与新直调的退出码与关键输出逐字节对照**，且对照的「旧」是从 `HEAD~1` 反取的真原壳，不是我凭记忆重写的。

### AC5 — 读数下降（同一棵真实树，前后各一次）

    BEFORE  totals.scripts=147  embeddedInterpreterScripts=59  embeddedInterpreterLines=7719  symlinkedCopies=59  duplicateCopies=0
    AFTER   totals.scripts=142  embeddedInterpreterScripts=54  embeddedInterpreterLines=7680  symlinkedCopies=59  duplicateCopies=0
            (-5)                    (-5)                          (-39)                          (0)                  (0)

−39 = 5+7+11+5+11（五个壳的有效行，取删除**前** checker 自己的 `files[].codeLines`）。**Residual = 0 是构造性的**：本分支相对 develop 的 `*.sh` 增删**恰好**是这 5 个路径（`git diff --name-status develop HEAD -- '*.sh'` → 5 × `D`），四个 selfcheck 的编辑是 `"$CHK"` → `node "$CHK"` 与 `-x` → `-f`，**±0 有效行**且它们都不是 embedded。

棘轮：`plugin/sh-census-baseline.json` 已**下调** `embeddedInterpreterLines` **7719 → 7680**（`duplicateCopies` 不动，0），并追加了带归因的 `_reanchorLog` 条目。只降不升 ⇒ 合法方向；门读数 `embeddedInterpreterLines=7680 ≤ 7680` ✔。AC6 的 `plugin/test/sh-census-check.test.mjs` 要求 committed baseline **等于**实测读数（不只是不超），该断言在本轮 ✔。

`bash plugin/scripts/capability-catalog.sh --summary` → `353 scripts | 353 declared | 0 unclassified | 348 ship`（exit 0）。**计数不变是正确的**：`deriveScripts()` 只走 `plugin/scripts`（且 `capability-catalog-declarations.json` 的 `experiments/…` 字样全是散文，不是键）⇒ 被删的 5 个 experiments 侧 `.sh` 从未进过它的集合，故**该声明文件无需改动**（它本来就没有这 5 个 .sh 的声明）。

### AC6 — 回归面

被改调用方各自的测试文件（单独跑，逐个）：

    plugin/test/sh-census-check.test.mjs          exit=0  tests=20 pass=20 fail=0
    plugin/test/touches-orthogonality-check.test.mjs exit=0 tests=62 pass=62 fail=0
    plugin/test/workflow-baseline-metrics.test.mjs exit=0 tests=68 pass=68 fail=0
    plugin/test/mirror-pair-drift-check.test.mjs  exit=0  tests=8  pass=8  fail=0
    plugin/test/capability-catalog.test.mjs       exit=0  tests=17 pass=17 fail=0

四个 selfcheck 本体（被改的直接对象，无独立测试文件，它们**自己就是**外部验收谓词）：

    bash experiments/quay-perpetual-stream/scripts/anti-drift-touches-selfcheck.sh        exit=0  PASS: all anti-drift cases behaved as asserted (guardrail bites).
    bash experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler-selfcheck.sh exit=0  PASS: all concurrent-batch-scheduler cases behaved as asserted.
    bash experiments/quay-perpetual-stream/scripts/serial-fanin-absorb-selfcheck.sh       exit=0  PASS: all serial-fanin-absorb cases behaved as asserted.
    bash experiments/quay-perpetual-stream/scripts/touches-orthogonality-selfcheck.sh     exit=0  PASS: all 6 touches-orthogonality pairs behaved as asserted.

scoped 门：

    $ bash scripts/test.sh --for-task gap-arch-thin-sh-wrappers-callers-call-ts-directly --allow-thin
    EXIT 0 · fail 0 · 
    PASS — embeddedInterpreterLines=7680 ≤ 7680, duplicateCopies=0 ≤ 0 (headBaseline {"embeddedInterpreterLines":7680,"duplicateCopies":0})
    PASS — every declared landing target == forward branch 'develop' (0 violations)
    PASS: quay-init-closure-ratchet: laydown source fingerprint fresh — baseline in sync
