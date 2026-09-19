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

- [ ] AC1（判据本体在真实仓库根取真值）逐字提取 `goals/AC-310-*.md` 的 `criterion` 并在真实仓库根执行 ⇒ `exit 0`；同一次 `node --experimental-strip-types plugin/scripts/sh-census-check.ts --json` 的 `evaluated===true` 且 `totals.duplicateCopies===0`。⛔ 不得用 `--selftest`、自造 JSON 或 fixture 代替这次真读数；命令与原始输出贴进 notes。
- [ ] AC2（逐条枚举，不是布尔）40 个路径逐个断言：`readlink <path>` 非空、`git ls-files -s <path>` 模式为 `120000`、`readlink -f <path>` 落在 `plugin/scripts/<basename>` ⇒ 40 行逐条贴进 notes（缺一行即未完成）。
- [ ] AC3（两支 CAUSE 分别取假，注入即当场撤销）①`CAUSE=checker-missing`：在任务 worktree 内把 `plugin/scripts/sh-census-check.ts` 临时改名 ⇒ 判据 `exit 1` 且 stderr 含 `CAUSE=checker-missing`；改回 ⇒ `exit 0`。②`CAUSE=duplicate-copies-nonzero-or-not-evaluated`：把任一已转换的符号链接临时替换为实体副本（`cp plugin/scripts/<f> experiments/.../<f>`）⇒ 判据 `exit 1` 且 stderr 含该 CAUSE；恢复符号链接 ⇒ `exit 0`。两次注入都在 worktree 内进行并**当场撤销**，收尾 `git status --porcelain` 干净（硬规则 11/11b：共享检出上不留未提交的生产输入变更）。
- [ ] AC4（5 个 TS 经镜像调用不再静默 no-op）对 5 个文件各做一次对照，**改动前先跑一次作为负控制**：`node --experimental-strip-types experiments/quay-perpetual-stream/scripts/<name>.ts <最小参数>` ⇒ 有非空输出（usage/verdict/错误行）且与经 `plugin/scripts/<name>.ts` 同参数调用的输出**逐字相同**；负控制须记录「零输出 + exit 0」。10 行（改动前 5 + 改动后 5）贴进 notes。（实测另有第 6 个同类文件 `.mjs`，按同一判据一并对照，共 12 行。）
- [ ] AC5（2 个 sh 不错树）`bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh` 与 `bash plugin/scripts/tree-hygiene-check.sh` 在被检树的根上一致（experiments 调用**不得**把 `experiments/quay-perpetual-stream` 当作被检根）；`worktree-branch-hygiene-check.sh` 同。两条改动前负控制（experiments 调用报出 experiments 根）一并记 notes。
- [ ] AC6（不删除、不新增悬空）`git diff --name-status` 的 experiments 段只出现 `T`（typechange 100644→120000）与必要的 `M`，**无 `D`**；带守卫地枚举 `experiments/quay-perpetual-stream/scripts/` 下悬空链接数 = 3（与改动前一致）。
- [ ] AC7（棘轮下降）`plugin/sh-census-baseline.json` 的 `duplicateCopies` = 0，且重跑 `sh-census-check --json` 仍 `duplicateCopies===0`（棘轮不红）；notes 写明「基线 38→0 是本任务的动作，不是 AC-305 的」，并附 `--baseline` 缺省重跑的输出。
- [ ] AC8（陷阱四已扫）`grep -rn 'lstatSync\|isFile()\|readlink\|120000' experiments/quay-perpetual-stream/test/ plugin/test/` ⇒ 命中项逐条判定「是否断言镜像为非链接实体」，结论（命中数 + 每条处置）写进 notes；若命中真断言，先改该断言并把它补进 Touches。

## DoD

真实落地标准：**AC-310 的 `criterion` 在生产树（fan-in 后的 develop/主检出）上 `exit 0`**，且该次 `--json` 的 `duplicateCopies===0` 是**检查器在真实仓库根的真实读数**（⛔ 不是 fixture、不是手造 JSON、不是 `--selftest`，⛔ 不是拿 AC-305 的读数顶替）；AC3 两支 CAUSE 各有「注入 ⇒ 红、撤销 ⇒ 绿」的实做留痕；AC4 的 5 条对照含改动前的负控制（证明修的是真缺陷、不是「本来就绿」）；AC2 的 40 行逐条枚举与 AC8 的扫描结论都在 notes 里；worktree `git status --porcelain` 干净、无残留注入。**⛔ 不删除任何文件**——是否删除待本条清零后由人另行裁定（AC `origin` 逐字）。