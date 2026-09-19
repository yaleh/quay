---
id: gap-arch-duplicate-copies-zero
title: 架构棘轮：重复副本清零 —— experiments 镜像 38 个非链接副本（+2 对同名不同内容）改符号链接，令 AC-310
  判据取真值，并修符号链接本身引入的两类静默失效（5 个 TS 直接调用判据 + 2 个 sh 的 ROOT 推导）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-arch-sh-census-check
goal_ac: AC-310
---
**type:** execution

## Proposal

**把 `experiments/quay-perpetual-stream/scripts/` 下 38 个与 `plugin/scripts/` 同名、非符号链接且字节相同的副本改成指向 plugin 侧对应文件的符号链接（不删除），连同 2 对同名但内容有差异者一并处置，使 AC-310 的判据在真实仓库根取到 `evaluated===true && totals.duplicateCopies===0`；同时修掉「改符号链接」这一步本身会引入的两类静默失效（5 个 TS 的直接调用判据、2 个 sh 的 ROOT 推导）。**

来源：`goals/AC-310-重复副本清零-….md`（判据正本，逐字引用其 `criterion`）+ GOAL-025「判据形态」第 1 条 + `orchestration/SPEC-architecture-consolidation-ts-and-shell-2026-09-19.md` §1.3 S2 / §8-③（人 2026-09-19 裁定：「先改成符号链接过渡,棘轮清零后再决定是否删除」）。

判据本体（逐字，从 `goals/AC-310-*.md` 的 `criterion` 提取）：
```sh
f=plugin/scripts/sh-census-check.ts
[ -f "$f" ] || { echo "CAUSE=checker-missing — $f 不存在，本量无法读取（不是 0）" >&2; exit 1; }
node --experimental-strip-types "$f" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.exit(j.evaluated===true&&j.totals&&j.totals.duplicateCopies===0?0:1)}catch(e){process.exit(1)}})' || { echo "CAUSE=duplicate-copies-nonzero-or-not-evaluated — experiments/ 与 plugin/ 仍有非符号链接的字节相同副本，或检查器未评估" >&2; exit 1; }
```

**今日实测（2026-09-19，真实仓库根，逐字跑该 criterion）**：`exit=1`，stderr = `CAUSE=checker-missing — plugin/scripts/sh-census-check.ts 不存在，本量无法读取（不是 0）`。⇒ ①检查器尚未落地，由 `gap-arch-sh-census-check`（AC-305）承担；②判据的 fail-closed 半边今天就是活的（检查器缺失判 1、⛔ 不判 0）。**这与「检查器未评估」是两个不同的缺口**：检查器明天落地也不改变 `duplicateCopies = 38` 这个事实 ⇒ 本任务的转换工作不因它落地而被满足。

<!-- dedup-ref -->
**与相邻任务的分工（仅追溯）**：`gap-arch-sh-census-check`（AC-305）建**仪器**并**只观测**——其 DoD 逐字写着「本任务**只观测，不删任何文件、不改任何现有脚本**——去重/删除在后续 Phase 1 任务里做」，本任务即那个后续；`gap-arch-reverse-edges-zero`（AC-307）、`gap-arch-import-cycles-zero`（AC-308）、`gap-arch-kernel-consumed-and-falsified`（AC-309）、`gap-arch-coverage-self-report`（AC-306）各管 GOAL-025 的另一条量，与本任务的 40 个路径无交集（已核：无任何 todo/ready/needs-human 任务的 Touches 段包含它们）。

**立案实测（机件独立读数，⛔ 不是抄 AC `origin` 里的数字）**——按 `experiments/**/scripts/` 逐目录遍历 + `os.path.islink` + `filecmp(shallow=False)` 逐个比对（非 fixture、非采样、非关键词匹配）：
- **38 对字节相同的非链接副本**（与 AC `origin` 记的 38 一致；逐条清单 = 本任务 Touches 的 experiments 段前 38 行；按扩展名 `.ts` 27 / `.sh` 8 / `.mjs` 3）；
- **22 个 git 符号链接**（`git ls-files -s experiments/quay-perpetual-stream/scripts/ | awk '$1=="120000"'` = 22），形态统一为**相对**链接 `../../../plugin/scripts/<basename>`；其中 **3 个是悬空链接**（`git-lens-l-{d-code-doc-ratio,g-structural-drift,s-behavior-variance}.ts` 的目标已随代理归档删除，见记忆条目 `git-lens-proxies-are-archived-with-dangling-symlinks`）；
- **2 对同名但内容不同**：`tree-hygiene-check.sh`、`worktree-branch-hygiene-check.sh`。git 日期判定权威：plugin 侧 `a93ab2d44 2026-08-09`（统一 `--help`）vs experiments 侧 `4a6088683 2026-07-31` / `800c2742f 2026-07-20` ⇒ **plugin 侧是权威版本**，experiments 侧是陈旧副本（这正是它们字节不同的原因）。

**⚠️ 陷阱一（TS 半边的静默失效，本任务必须先修，否则「转换」等于关掉一批门）**：Node ESM 默认把 `import.meta.url` 解析成 **realpath**（跟随符号链接），而 `process.argv[1]` 保持调用时写下的路径 ⇒ **任何「用 URL 相等判直接调用」的守卫，经镜像调用时恒假**，`main()` 不执行，进程**干净退出 0、零输出**（硬规则 3b：读不懂 ⇒ 与合格同形）。
**5 个副本带未修的原始内联形态**（逐字，均已核到行号）：
```
plugin/scripts/audit-independence-check.ts:259          const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
plugin/scripts/loadbearing-test-gate.ts:275              （同上一形态）
plugin/scripts/vmeta-lag-check.ts:252                    （同上一形态）
plugin/scripts/it0-enforcement-with-design-check.ts:332  … fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && path.basename(process.argv[1])… === "it0-enforcement-with-design-check"
plugin/scripts/it0-split-or-commit-check.ts:522           （同上，basename 期望值不同）
```
（另 16 个副本也出现 `process.argv[1]`，但逐行核对后**不是**身份比较——注释/参数检查——故不在本清单。⛔ 这是逐行看过的结论，不是正则计数。）
**⚠️ 落地实测补充（scoped gate 抓出，硬规则 5b「缺陷是成簇的」）**：上表的「另 16 个」结论**只对 `.ts` 成立**——同一缺陷还有一个 `.mjs` 兄弟实例：`plugin/scripts/workflow-metadata-conformance.mjs:793` 也是纯 URL 相等判据。已一并修复（见 Notes 的 AC4 节）。⇒ 教训：枚举缺陷实例时**先把载体枚举全（按扩展名）**，再逐行看；只按一个扩展名扫会把兄弟实例留在原地。

**已实做的对照（2026-09-19，本机 Node v24.19.0；`/tmp/vmprobe` 复刻真实相对深度：`plugin/scripts/` + `experiments/quay-perpetual-stream/scripts/`）**——同一文件、同一参数，仅差一个符号链接：
```
$ node --experimental-strip-types …/plugin/scripts/vmeta-lag-check.ts --help
  usage: node vmeta-lag-check.ts [--counter <N>] [--threshold <K>] <v-meta-ledger.md>      → exit 0
$ node --experimental-strip-types …/experiments/quay-perpetual-stream/scripts/vmeta-lag-check.ts --help
  （零输出）                                                                                → exit 0     # 该路径是符号链接
```
⇒ **一条门从「跑并说话」变成「什么都没做还说成功」**。**调用方证明这不是假想**：`experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh:34`、`loadbearing-test-gate.sh:37`、`audit-independence-check.sh:40` 全是 `node "$(dirname "$0")/<name>.ts" "$@"` ⇒ 从 experiments 树调用走的就是镜像路径。
**修法用仓库内既有原语，⛔ 不手搓**：同目录 `gate-script-base.ts:306` 已导出 **`isDirectEntry(importMeta, argv1, expectedBase)`，按 basename 判定（URL 完全不参与）**，其头注释 (:293) 写明「bare URL-based 形态已按设计移除」，被 125 个文件使用 ⇒ 这 5 个文件改成 `isDirectEntry(import.meta, process.argv[1], "<basename>")`（单一正本，且同时免疫打包内联与同名镜像两种形态）。**改在 plugin 侧**：experiments 侧转换后即符号链接，改它等于改 plugin。
**已否决的替代方案（写下理由，避免后人重走）**：`node --preserve-symlinks` —— ①是全局运行时开关，要改每一个调用点，漏一个就回到静默失效；②它会改变**全部**模块的相对 import 解析基准，而镜像今天能跑正是靠 realpath 使兄弟 import 落在 plugin 侧（实测证据：经符号链接调用时报 `Cannot find module '…/plugin/scripts/gate-script-base.ts'`——报的就是 plugin 侧路径）。

**⚠️ 陷阱二（sh 半边的「安静地检查另一棵树」）**：2 对内容有差异者正是这一类。plugin 侧 `tree-hygiene-check.sh:23-24` 与 `worktree-branch-hygiene-check.sh:26-27` 写的是：
```
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
```
而 experiments 侧现存版本写的是 `$HERE/../../..`（两侧深度不同 ⇒ 各自算到仓库根）。**转换后从 experiments 路径调用 ⇒ `HERE` = `experiments/quay-perpetual-stream/scripts` ⇒ `ROOT` = `experiments/quay-perpetual-stream`（错的树）**；而这两个脚本是 it0 DoD 的 clause 10/11 门（`experiments/quay-perpetual-stream/scripts/it0-dod-check.ts:758` 以 `path.join(__dirname, "tree-hygiene-check.sh")` 调用，`__dirname` 即 experiments 侧）⇒ **门会安静地检查另一棵树并可能报 PASS**。修法：`HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"`（解析到 plugin 侧真身 ⇒ `../..` = 仓库根 ⇒ 两条调用路径同解）。

**陷阱三（悬空链接必须守卫）**：3 个 git-lens 符号链接的目标不存在 ⇒ 任何 `realpath`/`readlink -f` 遍历都要守卫失败（`|| true`、try/catch），否则普查器 `evaluated:false`，而 AC-310 判据对「未评估」**fail-closed** ⇒ 会把无关的归档残留变成拦路红。本任务**不动这 3 个链接**（不删除、不修其目标），只守卫。

**陷阱四（测试面，落地前先扫）**：镜像一致性测试用 `fs.readFileSync` 比两侧字节（如 `experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs:550`）⇒ 符号链接下仍读到相同字节、保持绿；但任何断言「镜像是非符号链接的实体文件」的测试（`lstatSync().isFile()`、`readlink` 为空、`git ls-files -s` 模式 `100644`）转换后必红 ⇒ 落地前 grep 出全部命中并逐条判定（命中数与处置写进 notes）。

**口径**：⛔ 不删除任何文件（人裁定「先过渡」）；符号链接一律用**相对**形态 `../../../plugin/scripts/<basename>`（与既有 22 个一致——绝对链接在 worktree/克隆下必断）。`plugin/sh-census-baseline.json` 的 `duplicateCopies` **只许降到 0**（棘轮「读数 > 基线 ⇒ exit 1」：基线停在 38 时，回归到 1 仍绿 ⇒ 增益不 durable；把基线降到 0 才是把这次增益钉住的动作）。

## Touches

- experiments/quay-perpetual-stream/scripts/anti-gaming-guard.ts
- experiments/quay-perpetual-stream/scripts/audit-independence-check.sh
- experiments/quay-perpetual-stream/scripts/audit-independence-check.ts
- experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts
- experiments/quay-perpetual-stream/scripts/build-evidence-gate.ts
- experiments/quay-perpetual-stream/scripts/build-evidence-manifest.ts
- experiments/quay-perpetual-stream/scripts/candidate-contracts.ts
- experiments/quay-perpetual-stream/scripts/candidate-synthesis.ts
- experiments/quay-perpetual-stream/scripts/coupling-graph.ts
- experiments/quay-perpetual-stream/scripts/execution-policy.ts
- experiments/quay-perpetual-stream/scripts/finding-backpropagate.ts
- experiments/quay-perpetual-stream/scripts/gate-script-base.ts
- experiments/quay-perpetual-stream/scripts/gate-script-lib.sh
- experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.sh
- experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.ts
- experiments/quay-perpetual-stream/scripts/it0-impl-row-check.sh
- experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.sh
- experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.ts
- experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.sh
- experiments/quay-perpetual-stream/scripts/loadbearing-test-gate.ts
- experiments/quay-perpetual-stream/scripts/portfolio-choice.ts
- experiments/quay-perpetual-stream/scripts/preparation-feedback.ts
- experiments/quay-perpetual-stream/scripts/prepare-admission-check.ts
- experiments/quay-perpetual-stream/scripts/proposal-convergence.ts
- experiments/quay-perpetual-stream/scripts/run-identity.ts
- experiments/quay-perpetual-stream/scripts/stage-receipt.ts
- experiments/quay-perpetual-stream/scripts/task-schema-check.sh
- experiments/quay-perpetual-stream/scripts/task-schema-check.ts
- experiments/quay-perpetual-stream/scripts/task-schema.ts
- experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts
- experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh
- experiments/quay-perpetual-stream/scripts/vmeta-lag-check.ts
- experiments/quay-perpetual-stream/scripts/workflow-baseline-metrics.ts
- experiments/quay-perpetual-stream/scripts/workflow-event-schema.mjs
- experiments/quay-perpetual-stream/scripts/workflow-invariant-ownership.mjs
- experiments/quay-perpetual-stream/scripts/workflow-journal.ts
- experiments/quay-perpetual-stream/scripts/workflow-metadata-conformance.mjs
- experiments/quay-perpetual-stream/scripts/write-json-atomic.ts
- experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh
- experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh
- plugin/scripts/audit-independence-check.ts
- plugin/scripts/loadbearing-test-gate.ts
- plugin/scripts/vmeta-lag-check.ts
- plugin/scripts/it0-enforcement-with-design-check.ts
- plugin/scripts/it0-split-or-commit-check.ts
- plugin/scripts/workflow-metadata-conformance.mjs
- plugin/scripts/tree-hygiene-check.sh
- plugin/scripts/worktree-branch-hygiene-check.sh
- plugin/sh-census-baseline.json
- tasks/gap-arch-duplicate-copies-zero.md

（上 40 行 experiments/**/scripts/* 即本任务转换的 40 个路径——前 38 个为字节相同副本、末 2 个为同名不同内容者；下 8 行是与之互为镜像的 plugin 侧正本（6 个改身份判据：5 个 TS + 1 个 .mjs、2 个 sh 改 ROOT 推导）。⛔ 不新增 `plugin/scripts/*.ts`，故无 capability-catalog / outline 登记连带面。**清单修正记录**：`plugin/scripts/workflow-metadata-conformance.mjs` 不在立案时的清单里——它是 scoped gate 抓出的第 6 个身份判据兄弟实例（任务体「陷阱一」只扫了 `.ts`）；发现后**先补进本清单再改**。）

## AC

- [x] AC1（判据本体在真实仓库根取真值）逐字提取 `goals/AC-310-*.md` 的 `criterion` 并在真实仓库根执行 ⇒ `exit 0`；同一次 `node --experimental-strip-types plugin/scripts/sh-census-check.ts --json` 的 `evaluated===true` 且 `totals.duplicateCopies===0`。⛔ 不得用 `--selftest`、自造 JSON 或 fixture 代替这次真读数；命令与原始输出贴进 notes。
- [x] AC2（逐条枚举，不是布尔）40 个路径逐个断言：`readlink <path>` 非空、`git ls-files -s <path>` 模式为 `120000`、`readlink -f <path>` 落在 `plugin/scripts/<basename>` ⇒ 40 行逐条贴进 notes（缺一行即未完成）。
- [x] AC3（两支 CAUSE 分别取假，注入即当场撤销）①`CAUSE=checker-missing`：在任务 worktree 内把 `plugin/scripts/sh-census-check.ts` 临时改名 ⇒ 判据 `exit 1` 且 stderr 含 `CAUSE=checker-missing`；改回 ⇒ `exit 0`。②`CAUSE=duplicate-copies-nonzero-or-not-evaluated`：把任一已转换的符号链接临时替换为实体副本（`cp plugin/scripts/<f> experiments/.../<f>`）⇒ 判据 `exit 1` 且 stderr 含该 CAUSE；恢复符号链接 ⇒ `exit 0`。两次注入都在 worktree 内进行并**当场撤销**，收尾 `git status --porcelain` 干净（硬规则 11/11b：共享检出上不留未提交的生产输入变更）。
- [x] AC4（5 个 TS 经镜像调用不再静默 no-op）对 5 个文件各做一次对照，**改动前先跑一次作为负控制**：`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/<name>.ts <最小参数>` ⇒ 有非空输出（usage/verdict/错误行）且与经 `plugin/scripts/<name>.ts` 同参数调用的输出**逐字相同**；负控制须记录「零输出 + exit 0」。10 行（改动前 5 + 改动后 5）贴进 notes。（实测另有第 6 个同类文件 `.mjs`，按同一判据一并对照，共 12 行。）
- [x] AC5（2 个 sh 不错树）`bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` 与 `bash plugin/scripts/tree-hygiene-check.sh` 在被检树的根上一致（experiments 调用**不得**把 `experiments/quay-perpetual-stream` 当作被检根）；`worktree-branch-hygiene-check.sh` 同。两条改动前负控制（experiments 调用报出 experiments 根）一并记 notes。
- [x] AC6（不删除、不新增悬空）`git diff --name-status` 的 experiments 段只出现 `T`（typechange 100644→120000）与必要的 `M`，**无 `D`**；带守卫地枚举 `experiments/quay-perpetual-stream/scripts/` 下悬空链接数 = 3（与改动前一致）。
- [x] AC7（棘轮下降）`plugin/sh-census-baseline.json` 的 `duplicateCopies` = 0，且重跑 `sh-census-check --json` 仍 `duplicateCopies===0`（棘轮不红）；notes 写明「基线 38→0 是本任务的动作，不是 AC-305 的」，并附 `--baseline` 缺省重跑的输出。
- [x] AC8（陷阱四已扫）`grep -rn 'lstatSync\|isFile()\|readlink\|120000' experiments/quay-perpetual-stream/test/ plugin/test/` ⇒ 命中项逐条判定「是否断言镜像为非链接实体」，结论（命中数 + 每条处置）写进 notes；若命中真断言，先改该断言并把它补进 Touches。

## DoD

真实落地标准：**AC-310 的 `criterion` 在生产树（fan-in 后的 develop/主检出）上 `exit 0`**，且该次 `--json` 的 `duplicateCopies===0` 是**检查器在真实仓库根的真实读数**（⛔ 不是 fixture、不是手造 JSON、不是 `--selftest`，⛔ 不是拿 AC-305 的读数顶替）；AC3 两支 CAUSE 各有「注入 ⇒ 红、撤销 ⇒ 绿」的实做留痕；AC4 的 5 条对照含改动前的负控制（证明修的是真缺陷、不是「本来就绿」）；AC2 的 40 行逐条枚举与 AC8 的扫描结论都在 notes 里；worktree `git status --porcelain` 干净、无残留注入。**⛔ 不删除任何文件**——是否删除待本条清零后由人另行裁定（AC `origin` 逐字）。

## Notes

实现提交（均在本任务 worktree 的 `task/gap-arch-duplicate-copies-zero` 上）：
- `5abcd9791` — 转换 39 个路径 + 修 5 个 TS + 2 个 sh
- `73c67c81f` — 补齐第 6 个身份判据（`.mjs`）+ 修 DIR-070-B 注释
- `ff2990434` — merge develop（带入更新后的 Touches）

worktree = `/home/yale/work/quay-worktrees/gap-arch-duplicate-copies-zero`，fork 点 = develop `6b713f7ca`。

### 与任务体的三处实测偏差（读真值，不照抄立案时的数字/清单）

1. **`duplicateCopies` 立案时写 38，实测是 37。** 检查器自己在 land 时的 re-anchor 已把真读数从 38 移到 37（develop 那次把 `write-json-atomic.ts` 转成了符号链接，其 `_reanchorLog` 里记的 `-1` 就是它）。所以本任务实际转换 **37 对字节相同副本 + 2 对同名不同内容 = 39 个路径**；Touches 里那 40 行 experiments 段 = 这 39 个 + `write-json-atomic.ts`（develop 已转，无需再动）。**交叉核对（机件派生，非人工比对）**：由 checker 的 `duplicates ∪ differingSameName` 派生集合 = 39，与 Touches 的 40 行差集恰好只有 `write-json-atomic.ts` 一个，无其它缺口。
2. **sh 的错树 ROOT 实测是 `<repo>/experiments`**，不是任务体写的 `experiments/quay-perpetual-stream`。`HERE/../..` 从 `experiments/quay-perpetual-stream/scripts` 上溯两级落在 `experiments`（`scripts`→`quay-perpetual-stream`→`experiments`）。结论同（错的树），记的是实测值。
3. **身份判据缺陷是 6 个，不是 5 个**——任务体的「陷阱一」清单**只扫了 `.ts`**，漏了同缺陷的 `.mjs` 兄弟实例 `plugin/scripts/workflow-metadata-conformance.mjs:793`。**这是 scoped gate 抓出来的，不是我自己想到的**（见 AC4 与 AC8 节）。硬规则 5b 的原话正是「缺陷是成簇的、且兄弟实例常在同一文件甚至同一行」——这里的形态是**同一谓词、不同扩展名**。已补进 Touches（**先补清单再改**）。

### AC1 — 判据本体在真实仓库根取真值

判据逐字取自 `goals/AC-310-*.md` 的 `criterion`，落成 `/tmp/criterion-ac310.sh`，在 worktree 根执行：

```
$ bash /tmp/criterion-ac310.sh
exit=0
$ node --experimental-strip-types plugin/scripts/sh-census-check.ts --json
evaluated=true  duplicateCopies=0  symlinkedCopies=59  orphanCandidates=3  embeddedInterpreterLines=11690  scripts=150
```

`symlinkedCopies` 20 → 59 = 20 + 39 个转换，与 `duplicateCopies` 37 → 0 是一体两面（每对从前者移到后者；硬规则 4 的守恒核对：两个读数之和不变）。⛔ 未用 `--selftest`、未自造 JSON、未用 fixture。

### AC2 — 40 个路径逐条枚举（40/40 OK）

逐条断言三件事同时成立：`readlink <path>` 非空 **且** `git ls-files -s <path>` 模式 = `120000` **且** `readlink -f <path>` = `<worktree>/plugin/scripts/<basename>`。40 行全三取真（完整输出 = `/tmp/ac2-ac6-evidence.txt`；样例）：

```
anti-gaming-guard.ts   readlink=../../../plugin/scripts/anti-gaming-guard.ts  mode=120000  realpath=<worktree>/plugin/scripts/anti-gaming-guard.ts
audit-independence-check.sh  readlink=../../../plugin/scripts/audit-independence-check.sh  mode=120000  realpath=<worktree>/plugin/scripts/audit-independence-check.sh
…（40 行，FAILURES=0）…
write-json-atomic.ts   readlink=../../../plugin/scripts/write-json-atomic.ts  mode=120000  realpath=<worktree>/plugin/scripts/write-json-atomic.ts
```

形态统一为**相对**链接 `../../../plugin/scripts/<basename>`（与既有链接一致——绝对链接在 worktree/克隆下必断）。`git ls-tree -r develop` 实测该目录转换前 23 个 `120000`，转换后 62 个（23 + 39）。

### AC3 — 两支 CAUSE 分别取假（注入 ⇒ 红、撤销 ⇒ 绿，均在 worktree 内当场撤销）

```
① mv plugin/scripts/sh-census-check.ts /tmp/…bak
   $ bash /tmp/criterion-ac310.sh
   CAUSE=checker-missing — plugin/scripts/sh-census-check.ts 不存在，本量无法读取（不是 0）   exit=1  ✓
   撤销（mv 回）后 → exit=0  ✓

② rm <mirror> && cp plugin/scripts/task-status-drift-check.ts <mirror>
   ⚠️ 必须先 rm：cp 会跟随目标符号链接、把内容写穿到 plugin 侧正本上
   $ bash /tmp/criterion-ac310.sh
   CAUSE=duplicate-copies-nonzero-or-not-evaluated — …                                      exit=1  ✓
   同期 --json 读数 duplicateCopies=1
   恢复符号链接后 → exit=0  ✓
```

收尾 `git status --porcelain` 输出为空（无残留注入；硬规则 11/11b）。

### AC4 — 身份判据经镜像调用不再静默 no-op（**6 个文件**，含改动前负控制）

在**真实相对深度**复刻探针：`/tmp/vmprobe-pre`（plugin 侧取自 `git show HEAD`，即改动前）+ `/tmp/vmprobe-post`（改动后工作树），两处都把 experiments 侧做成指向 `../../../plugin/scripts/<name>` 的符号链接。比较时滤掉 Node 自带的 `MODULE_TYPELESS_PACKAGE_JSON` 提示行——它带绝对路径、两条调用路径本就不同，**不是脚本输出**。

```
文件                                 改动前(镜像调用)   改动后(镜像调用)         改动后 mirror vs plugin
audit-independence-check.ts          0B   exit 0   →   165B exit 0 (usage)      IDENTICAL
loadbearing-test-gate.ts             0B   exit 0   →    32B exit 2 (错误行)      IDENTICAL
vmeta-lag-check.ts                   0B   exit 0   →    84B exit 0 (usage)       IDENTICAL
it0-enforcement-with-design-check.ts 0B   exit 0   →   128B exit 0 (usage)       IDENTICAL
it0-split-or-commit-check.ts         0B   exit 0   →   142B exit 0 (usage)       IDENTICAL
workflow-metadata-conformance.mjs    0B   exit 0   →  1796B exit 0 (默认调用)    IDENTICAL   ← 第 6 个，立案清单未列
```

**负控制逐字证明了缺陷**：改动前 6 个经镜像调用一律「零输出 + exit 0」——一条门从「跑并说话」变成「什么都没做还说成功」（硬规则 3b：读不懂 ⇒ 与合格同形）。改动后用仓库既有原语 `isDirectEntry(import.meta, argv1, "<basename>")`（按 basename 判定、URL 完全不参与），两条调用路径输出逐字相同。

**第 6 个的发现过程（这条比结论更重要）**：它不是靠通读任务体发现的，是 scoped gate 转红后追根因追出来的——`plugin/test/workflow-metadata-conformance.test.mjs` 4 条红（AC2/GREEN、AC2/RED、C3、C6），其中 C6 报 `SyntaxError: Unexpected end of JSON input`，正是「空输出被当成 JSON 读」这一形态。**修完不是就完了**：按硬规则 5b 对**全部 39 个转换文件**重扫了一遍 `argv[1]` 与 `fileURLToPath(import.meta.url)`，确认只剩这 1 个纯 URL 相等；其余命中一律是 `.endsWith("<basename>.ts")`（符号链接免疫）或 `workflow-baseline-metrics.ts:1409` 那种「URL 相等 **OR** basename 兜底」的双形态。修法沿用同目录 `.mjs` 先例（`workflow-event-schema.mjs` 自己的 `isDirectEntry`）。

**真实调用方也验了**（这才是生产路径：wrapper 里 `node "$(dirname "$0")/<name>.ts"`）：`audit-independence-check.sh` / `loadbearing-test-gate.sh` / `vmeta-lag-check.sh` 三个 wrapper 经镜像调用的输出与经 plugin 调用**逐字相同**（1591B / 1484B / 1115B）。

已否决的替代方案（`node --preserve-symlinks`）未采用，理由同任务体。

### AC5 — 2 个 sh 不错树（含改动前负控制）

`bash -x` 取直接量（不是推演）：**改动前**镜像调用 `cd` 进 `<worktree>/experiments`（错的树），plugin 调用进仓库根；**改动后**两条路径都 `cd` 进同一处 `plugin/scripts/../..` = 仓库根。

```
$ bash plugin/scripts/tree-hygiene-check.sh                    → exit 0
$ bash experiments/…/tree-hygiene-check.sh                     → exit 0，输出与上行逐字 IDENTICAL
$ bash plugin/scripts/worktree-branch-hygiene-check.sh         → exit 0
$ bash experiments/…/worktree-branch-hygiene-check.sh          → exit 0，输出与上行逐字 IDENTICAL
```

修法 `readlink -f "${BASH_SOURCE[0]}"` + 守卫（解析失败回退字面路径）。**守卫是必要的**：镜像目录里有 3 个悬空链接，裸 `readlink -f` 在失败时返回空串，会把 ROOT 算成空 ⇒ 又是一种「读不懂却与合格同形」（硬规则 3b）。

### AC6 — 不删除、不新增悬空

`git diff --name-status develop...HEAD` = **39 个 `T`（100644→120000）+ 9 个 `M`，`D` 的条数 = 0**。带守卫枚举 `experiments/quay-perpetual-stream/scripts/` 下悬空链接 = **3**（`git-lens-l-{d-code-doc-ratio,g-structural-drift,s-behavior-variance}.ts`，与改动前一致；本任务不动它们的目标、不删除，只保证任何 realpath 遍历不对它们 fail-closed）。

### AC7 — 棘轮下降

`plugin/sh-census-baseline.json` 的 `duplicateCopies` **37 → 0**（按实测真值记，非任务体写的 38），`embeddedInterpreterLines` 未动（**delta=0 是断言，不是遗漏**）；缺省 `--baseline` 重跑读数仍 `duplicateCopies===0`，棘轮门 `exit=0`（不红）。基线文件里追加了一条 `_reanchorLog` 记录本次下调及其归属。

**「基线 37→0 是本任务的动作，不是 AC-305 的」**：AC-305（`gap-arch-sh-census-check`）只建仪器并只观测，其 DoD 逐字写着「只观测，不删任何文件、不改任何现有脚本」；把基线降到 0 是本转换任务的动作。⛔ 停在 37 会让未来回归到 37 仍绿 ⇒ 本次增益不 durable，故必须压到 0。

### AC8 — 陷阱四已扫（命中 57 条，逐条判定）

命令与 57 条原样命中：`grep -rn 'lstatSync\|isFile()\|readlink\|120000' experiments/quay-perpetual-stream/test/ plugin/test/`。

**结论：57 条中 0 条断言「本任务的镜像必须是非链接实体文件」。** 分布与处置：

| 类别 | 条数 | 处置 |
|---|---|---|
| `120000` 是 spawnSync 的**超时毫秒字面量**（与 git mode 同名不同义 —— 谓词的一个假阳性族） | 9 | 无关 |
| 断言的目标**本来就是符号链接**（`fast-mode-telemetry.ts` 再导出、`.agents/skills/quay-directive`、`node_modules`、既有 plugin-real+experiments-symlink 镜像对）——与本任务**同向** | 18 | 无关 |
| `plugin/`、`scripts/test.sh`、bin shim 必须是实体目录/文件（`__dirname/../..` 前提） | 4 | 无关 |
| 自有 fixture / 合成对象（`fs-walk`、`peer-identity-probe`、`quay-init-install-fixture`、`archive-exclusion-wiring` 把 plugin/scripts 复制进临时目录） | 14 | 无关 |
| `statSync().isFile()`（**跟随**符号链接）或 `readdirSync(withFileTypes)` 的 dirent 判定 | 12 | 无关（符号链接下语义不变） |

**扫描之外另查了两处「假绿」风险点**（AC8 谓词不覆盖，但去重可能改变其结论）：

- `plugin/test/plugin-packaging.test.mjs:184`「shipped schema-check modules are byte-identical to their exp5 canonical source, **modulo attribution-only sanitization**」：该测试把 **experiments 侧叫 canonical**、plugin 侧叫 bundled，断言 `stripAttribution(canonical) === bundled`。转换后 `canonical === bundled`，故该断言成立**当且仅当 `stripAttribution(bundled) === bundled`**（bundled 是 strip 的不动点）。**实测三个文件（`task-schema.ts` / `task-schema-check.ts` / `task-schema-check.sh`）都是不动点**（plugin 侧本就不含 `exp5` 标注，另一条 leak 测试在强制这一点）⇒ 保持绿。这是「把定义域两端接起来才出现的**新前置条件**」，不是原本显然的事。
- `experiments/.../test/concurrent-batch-scheduler.test.mjs` 用 `fs.readFileSync` 比两侧字节：符号链接下字节仍相同 ⇒ 保持绿。

**AC8 扫描抓出的一个真缺陷（已修，且 AC8 的谓词本身覆盖不到它）**：给 2 个 sh 加注释后，`plugin/test/plugin-packaging.test.mjs:427`（DIR-070-B，universal-gate 文件禁含本仓库实验布局引用）转红——`tree-hygiene-check.sh` 是 5 个 universal gate 之一（`worktree-branch-hygiene-check.sh` 被该测试**显式豁免**，因它需要实验常量作功能性常量）。处置：把该注释里的字面路径改写成通用形态 `experiments/**/scripts/`。**该修正与 `.mjs` 修复合并在 `73c67c81f` 提交**。⇒ 教训：AC8 给了一个谓词，但谓词不等于「该扫的都扫了」；DIR-070-B 是把 leak 测试**当补充扫描**才发现的。

### scoped gate

`bash scripts/test.sh --for-task gap-arch-duplicate-copies-zero --allow-thin`：

- **第一次（`5abcd9791` 时）= 红**：4 条失败全在 `plugin/test/workflow-metadata-conformance.test.mjs`（AC2/GREEN、AC2/RED、C3、C6）。根因 = 第 6 个身份判据（`.mjs` 兄弟实例）—— 属于「转换本身引入的静默失效」这一类，正是任务体要求先修的。⇒ 修 `73c67c81f`。
- **第二次（`ff2990434` 时，含 `.mjs` 修复 + 更新后的 Touches + merge develop）= 绿，`EXIT=0`，`✖` 计数 = 0。**

（该 gate 自身会 `build dist/quay.js` + `build dist/quay-native.js` + `sync-vendor.sh --sync-dist` 再跑，故 worktree 里原本缺失的 `packages/*/dist` 不构成阻塞。）