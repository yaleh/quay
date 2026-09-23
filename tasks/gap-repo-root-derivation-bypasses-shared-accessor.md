---
id: gap-repo-root-derivation-bypasses-shared-accessor
title: repo-root 单一访问器被 24 个 plugin/scripts 用手搓「向上两级」常量绕过——迁移到 repoRoot() +
  加棘轮检查器（架构复核 P2-identity-repo-root.ts，round 2019）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

架构复核 round 2019 的 `P2-identity-repo-root.ts` 判为 `abstract` / actionable，建议「把局部 repo-root 推导换成共享 `repoRoot()` + 加一个检查器抓新的 `path.resolve(SCRIPT_DIR, "..", "..")` 常量」。**本任务立案时逐条复核了该建议，确认缺陷真实存在，但把范围与依据改写如下**（判词的数字不是依据，见下）。

### 一、缺陷：24 个 `plugin/scripts/*.ts` 用手搓「向上两级」常量重新推导仓根，一次也不 import 唯一访问器

`plugin/scripts/repo-root.ts` 的 `repoRoot()` 是这层唯一的根解析器（bundle → consumer → plain-git 三种标记向上走查 + `git rev-parse --show-toplevel` + `process.cwd()` 兜底），已被 66+ 文件 import。但仍有 **24 个 `plugin/scripts/*.ts` 各自重推同一件事**，一次都不引用它（立案实测 `grep -rn 'path\.resolve\((SCRIPT_DIR|__dirname), *"\.\.", *"\.\."\)' plugin/scripts/*.ts`，**排除注释行**后逐条核实）：

- **形态 A** `path.resolve(__dirname, "..", "..")` —— **18 个文件**（`DEFAULT_ROOT` / `REPO_ROOT` / `const repoRoot`）：
  `allowed-tools-plugin-prefix-check.ts:43`、`checked-in-write-check.ts:80`、`config-wiring-check.ts:69`、`fan-in-workflow-retirement-check.ts:49`、`inner-idle-log.ts:32`、`kernel-sibling-resolution-check.ts:78`、`loop-complete-task.ts:39`、`goal-driver-task-boundary-check.ts:48`、`l1-delivery-surface-check.ts:41`、`full-suite-runner.ts:218`、`measure-trend-check.ts:52`、`outer-retirement-precondition-check.ts:54`、`red-window-triage.ts:50`、`registry-bare-filename-scan.ts:51`、`suite-duration-exceed-check.ts:46`、`target-identity-literal-check.ts:60`、`suite-state-trigger.ts:90`、`spec-declaration-point-check.ts:46`
- **形态 B** `path.resolve(SCRIPT_DIR, "..", "..")` —— **6 个文件**：
  `accounting-emit.ts:283`、`cross-machine-verify.ts:825`、`fan-in-ts-typecheck-gate.ts:141`、`integration-batch-merge.ts:278`、`server-restart-inflight-verify.ts:450`、`server-partial-stop-verify.ts:445`

判词自己举的四个采样点（`server-partial-stop-verify.ts:445`、`server-restart-inflight-verify.ts:450`、`integration-batch-merge.ts:278`、`measure-trend-check.ts:268`）全部在列，已逐条核实这四者**确实零次引用 `repo-root.ts`**——「copy-instead-of-call」成立。

### 二、⛔ 判词里的 `9 code file(s)` 不是本任务的依据，且已知是假阳性——执行者不要拿它做验收

检测器的 `hardcoded=9` 计的是「文件里出现 `repo-root.ts` 这个 **basename 的字面量**」；立案实测那 9 处里绝大多数是**测试的 copy 清单 / laydown 清单 / 注释**，不是根推导：

```
plugin/test/driver-cli.test.mjs:58            "repo-root.ts",                    ← KERNEL_DEPS copy 清单
plugin/test/select-static-checks-for-touches.test.mjs:203  path.join(REPO_ROOT, …,"repo-root.ts")  ← 夹具 copy
plugin/scripts/quay-init.sh:669                # …repo-root.sh + repo-root.ts (gap-b2-…)  ← 注释
plugin/scripts/repo-root.sh:2                  # repo-root.sh — single bash counterpart of repo-root.ts  ← 注释
plugin/scripts/develop-deliver-tgz.sh:405       "${SCRIPT_DIR}/repo-root.ts" \      ← 打包清单（合法）
plugin/scripts/capability-catalog.sh:27         # …resolves its own root through the TS half (repo-root.ts)  ← 注释
plugin/scripts/core-src-import.ts:46             /** Max upward steps … (mirrors repo-root.ts's MAX_DEPTH). */  ← 注释
```

⇒ **本任务收口的是判词「classic copy-instead-of-call」那一段所指的语义缺陷（24 文件），不是 9 这个字面量计数。** 执行者⛔ 不得为了把 9 降下来去改动上表那些合法的字面量提及（那会让 `driver-cli.test.mjs`、`quay-init.sh` 的 laydown/打包清单失真）。检测器这一栏的假阳性本身**不在本任务范围**（同类读数问题已由 [[gap-identity-accessor-regex-source-computed-path]]（done）与 [[gap-arch-review-cluster-ignores-detector-flag-predicate]]（done）分别收口过，判词自己也在同一 round 的两次先判里以 `coincidental` 放过它）。

### 三、这不是纯洁癖：两种形态**实测不等价**（B2 立案时不掌握的事实）

`gap-b2-repo-root-unification` 当时把裸常量记为「非正确性缺陷，是可维护性问题」而留在原地。立案实测该判断只在**源码布局**下成立，在**落盘副本布局**下分叉：

```
$ node --experimental-strip-types -e '… import {repoRoot} from "./plugin/scripts/repo-root.ts" …'
bare constant from plugin/scripts                 : /home/yale/work/quay
repoRoot(plugin/scripts)                          : /home/yale/work/quay            ← 相同
bare constant from packages/quay/plugin/scripts/  : /home/yale/work/quay/packages/quay   ← 分叉
repoRoot(packages/quay/plugin/scripts)            : /home/yale/work/quay            ← 分叉
```

即：裸常量把「向上恰好两级」当成仓根的定义，而 `repoRoot()` 回答的是「这是不是仓根」。`packages/quay/plugin/` 与 `plugin/scripts/dist/` 都是 **gitignored 构建产物**（`git check-ignore` 实测两者均被忽略、`git ls-files` 计数 0），所以本任务**不需要**改产物，源码改完下次 build 自然带上。

### 四、一个已记录的观察（⛔ 不另立案、不是本任务的验收对象）

同一簇在**同一 round（2019）**里被判定三次且结论相反：`16:27` `coincidental`（actionable:false，"repo-root.ts IS the accessor — counting its consumers inverts the metric"）、`20:34` `coincidental`（"9 literal vs 85 importers — cleared by isFlagged"）、`21:32` `abstract`（actionable:true，即本任务来源）。且 `label` 写 "without a single accessor" 而 `21:32` 的判词写 "referenced by ~97 files"，同一记录内自相矛盾。这是**判据不稳定/判词与其 label 不同源**的证据，属于架构复核管线的观测项；本任务只做记录，不修改检测器或判词管线（⛔ 派发指令明确禁止碰检测器源）。

<!-- dedup-ref -->
（此段仅为可追溯性）机制不同但同域的历史任务：`gap-b2-repo-root-unification`（收口 `findRepoRoot`/`findWorkspaceRoot` **两个函数的 18 处重复实现**，AC1 只数 `function (findRepoRoot|findWorkspaceRoot)`，已 done，覆盖不到本任务的裸常量族）；`gap-identity-accessor-regex-source-computed-path`（收口检测器 accessor 正则的假读，已 done）；`gap-arch-review-cluster-ignores-detector-flag-predicate`（收口 cluster 阶段不读 `isFlagged`，已 done）。三者都不认领本任务的缺陷。

## Plan

三步，顺序固定（第 3 步的棘轮必须在第 1 步落完之后才可能绿）：

1. **迁移 24 处**：`import { repoRoot } from "./repo-root.ts";` + `const X = repoRoot();`。默认起点 = 本文件所在目录（`import.meta.url`），与裸常量同源 ⇒ 源码布局下行为不变；`--root <path>` 覆盖通道优先级更高、语义不变，⛔ 不要动各文件的 `--root` 解析。`checked-in-write-check.ts` / `registry-bare-filename-scan.ts` 的常量是 `export const`，迁移后仍保持导出（消费方不变）。
2. **等价性核对**（见 AC3）：对≥3 个被迁移文件取迁移前后同一输入的读数对照。
3. **加棘轮检查器** `plugin/scripts/repo-root-derivation-check.ts`：按**位置判定**（注释/字符串里拼写不报，复用本仓既有 `buildNonCodeMask` 手法）抓 `path.resolve(<脚本目录常量>, "..", "..")` 形态；修后源码树 exit 0。登记义务见 AC6（新 checkers 的**四件套**，缺一件分别在不同的门报红，且报错行只写检查器自己的 basename，读起来像无关红）。**已知陷阱**：该检查器自己就在 `plugin/scripts/` 扫描根下 ⇒ 它自己的源码与它的 mutation 夹具里都**不得出现它要抓的字面量**（用片段拼装 + 从真声明 `sed` 出名字）。

**执行前必须先知道的一个陷阱面（B2 连踩三轮的同一处）**：任何把 `plugin/scripts/*.ts` **copy 进临时树**后再运行的夹具，在新增 `./repo-root.ts` import 后会 `ERR_MODULE_NOT_FOUND`（B2 实证：`driver-cli.test.mjs` 的 `KERNEL_DEPS`、`precommit-guard.test.mjs` 的 copyGuardScripts、`select-static-checks-for-touches.test.mjs` 的 copy 清单）。**立案时已实测收窄**：24 个 basename 与 `driver-cli.test.mjs` 的 `KERNEL_DEPS`（19 项）**交集 = 0**；10 个带 `plugin/scripts/checker-mutation-cases/<name>.sh` 的检查器夹具都是**在真路径就地跑**（`node --experimental-strip-types "$checker_src" --root <伪造树>`），只 copy 被判的树 ⇒ 多数不需要补 `cp repo-root.ts`。⇒ 已知面比 B2 小，但**判定手段是跑全量 suite**，不是推理；发现漏项就补进 `## Touches` 与本任务自身（self-touch 允许）。

## AC

- [x] AC1（基线读数可复现·位置判定）：贴出立案基线命令 `grep -nE 'path\.resolve\((SCRIPT_DIR|__dirname), *"\.\.", *"\.\."\)' plugin/scripts/*.ts` 的**逐行命中**，并**逐条分类为代码/注释**；结论必须是**代码文件 24 个（形态 A 18 / 形态 B 6）**。⛔ 直接 `grep -c` 会数出 26 行——已知的 2 行注释（`kernel-sibling-resolution-check.ts:21`、`test-isolation-check.ts:516`）必须被排除并**点名**（硬规则 2：非零计数要查命中的是不是我要的）。
- [x] AC2（迁移完成·能取假）：修后同一条 grep（同样排除注释）在 `plugin/scripts/*.ts` 上**零命中**；且 `plugin/scripts/*.ts` 中 `from "./repo-root.ts"` 的 import 文件数 **≥ 24**（贴出命令与计数）。⛔ 只改名/换行/加空格仍会被同一 grep 命中 ⇒ 判为未完成。
- [x] AC3（等价性·能取假）：对**至少 3 个**被迁移文件（其中至少 1 个来自形态 B），用**同一输入**分别跑迁移前（`git show <base>:plugin/scripts/<f>.ts` 落到临时路径）与迁移后的版本，贴出两边 `exit code` 与 stdout/stderr **逐字对比，差值为 0**。⛔ 只跑迁移后一遍不算等价性证据。**并**贴出本任务 Proposal §三那条分叉命令的立案输出（证明两形态不等价、迁移把它消除）。
- [x] AC4（棘轮对真样本命中·零计数的配套动作）：把棘轮对**一个已知为真的样本**干跑——`git show <base>:plugin/scripts/measure-trend-check.ts`（含 `const REPO_ROOT = path.resolve(__dirname, "..", "..")`）写进临时树后运行棘轮，**必须命中并打印该 file:line**；对同一样本把该行改成 `import` 后运行，必须不再命中。⛔ 只贴「修后 exit 0」而无「对真样本命中」的读数 ⇒ 判据空转（与「我不存在的东西都通过」同形）。
- [x] AC5（棘轮假阳性方向 + 自指陷阱）：贴出棘轮源码中**不含**其要抓的字面量（它是自己的扫描面之一）；并对三处**合法字面量提及**干跑，均**不**被计入：`plugin/test/driver-cli.test.mjs:58`、`plugin/scripts/quay-init.sh:669`、`plugin/scripts/repo-root.sh:2`（贴出三者的分类结果）。
- [x] AC6（新检查器四件套义务，逐件给读数）：① 六表各一行（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/**CONSUMER**——按需 cadence 缺 CONSUMER 行会让 `rhythm-consumer-check` 判据2 红掉 scoped 门），`bash plugin/scripts/capability-catalog.sh --entry-surface; echo $?` = **0** 且 `--summary` 的 unclassified = 0；② 登记进 `plugin/scripts/runner-static-gate.ts` 的 `run_static_checks`（带 `# @static-tier` + `# @static-object`）并把该函数上的 `# @checker-count 65` 改为 66，`node --experimental-strip-types plugin/scripts/checker-count-drift-check.ts --root .; echo $?` = 0；③ 新增 `plugin/scripts/checker-mutation-cases/repo-root-derivation-check.sh`，`bash plugin/scripts/checker-mutation-check.sh --check; echo $?` = 0；④ `node --experimental-strip-types plugin/scripts/rhythm-consumer-check.ts --check; echo $?` = 0。（⛔ 别用 `cmd | tail; rc=$?` 取退出码，那是 `tail` 的 rc。）
- [x] AC7（单测）：`node --test plugin/test/repo-root-derivation-check.test.mjs; echo $?` = 0，且新增断言**双向非空**——至少一条 fixture 判命中、至少一条（注释/字符串/合法 pack 清单）判不命中。

## DoD

**生产载体读数（不是 fixture）**：在本仓真实 `plugin/scripts/*.ts` 上跑过一次修后读数——AC1 的 grep 零命中、`repoRoot` importer 计数 ≥ 24、棘轮对修前样本命中一次；贴出命令与输出。⛔ 不以「新增单测绿」代替生产读数（硬规则 4 推论三：fixture 证明「能产出」，不证明「已产出」）。

**全量 suite 绿**：机械 fan-in 的 step=suite 过关，尤其 `plugin/test/driver-cli.test.mjs`、`plugin/test/precommit-guard.test.mjs`、`plugin/test/select-static-checks-for-touches.test.mjs`、`bash plugin/scripts/checker-mutation-check.sh --check`——B2 三轮的红全部落在这四处。

**scoped 门绿**：`bash scripts/test.sh --for-task gap-repo-root-derivation-bypasses-shared-accessor` exit 0。

## 执行记录（worker，2026-09-21）

### 一、范围比立案清单大：实测 29 个文件，不是 24

按硬规则 5b（在某处修好 X ≠ X 只在那一处）在同一载体里枚举了全部适用点：立案清单的 24 个
（形态 A 18 / 形态 B 6）全数在列，另有 **5 个同族** —— 同样是「脚本目录常量向上两级」，只是常量名
不叫 `__dirname`/`SCRIPT_DIR`，故不在立案那条 grep 的两种形态里：

| 文件:行 | 常量 | 形态 |
|---|---|---|
| `plugin/scripts/manager-tick-readings.ts:314` | `here` | 形态 A |
| `plugin/scripts/profiles-role-coverage-check.ts:229` | `HERE` | 形态 A |
| `plugin/scripts/runtime-usage-inventory.ts:1185` | `here` | 形态 A |
| `plugin/scripts/suite-execution-form-counter.ts:372` | `scriptDir` | 形态 A |
| `plugin/scripts/external-dogfooding-check.ts:235` | `__dirname`（其后还有更多实参 ⇒ `<repo>/experiments/…`） | 形态 A' |

棘轮按【缺陷族】判而不是按【立案那条 grep 的两种常量名】判 —— 一份常量名白名单改个名字就绕开，
所以这 5 个不是被放宽掉的，是被同一条位置判据抓住的。这 5 个文件已补进 `## Touches`。

### 二、AC1 的基线读数与任务体写的不同（按实测记录，不按任务体写的数字）

任务体 AC1 写「直接 `grep -c` 会数出 26 行 —— 已知的 2 行注释必须被排除」。**实测是 27 行、3 行注释**：
除了任务体点名的 `kernel-sibling-resolution-check.ts:21` 与 `test-isolation-check.ts:516`，还有
`plugin/scripts/repo-root.ts:13`（访问器自己的文档注释）。排除 3 行注释后 = **24 行代码 / 24 个文件
（形态 A 18 / 形态 B 6）** —— 结论与任务体一致，差的是「26/2」这两个数字。数字按实测记录。

这 3 行注释在修后**依然存在**（它们正是「按位置不判」的活样本），所以修后同一条 grep 仍有 3 行命中；
AC2 的判据是【排除注释后零命中】，其机器化形态是棘轮的 exit 0（见下）。⛔ 没有为了让 grep 变 0 去改动
这 3 行注释 —— 那会让「拼写」与「这么做」重新不可区分。

### 三、一个不能机械替换的点：`fan-in-ts-typecheck-gate.ts:141` 是**安装位置**推导，不是仓根推导

它是 `<pkg|root>/plugin/scripts` → `<pkg|root>`，用来同时探
`<repo>/packages/quay/src/gate/config/loader.ts` 与 npm 安装态的 `<pkg>/src/gate/config/loader.ts`
（ad-arm1 的真实 0.7.0 安装是 `src/` 在包根、没有 `packages/`，该文件头注释里有实测记录）。
换成 `repoRoot()` 会在安装态下把 `source: "config"` 静默降级为 `source: "fallback"`
（探不到 loader ⇒ 读不到那个项目自己声明的 typecheck 命令，且只表现为「走了兜底」）——
正是**硬规则 3b** 的形态。改走本仓既有的布局无关走查：`core-src-import.ts` 的 `resolveCoreSrcFile`
（它的两个 shape 就是这里原先手写的那两个），删掉写死的两级与重复的 shape 表。
等价性已实测：`resolveConfigLoaderPath(null)` 与 `resolveTypecheckCommandDetailed(<repo>, null)`
迁移前后逐字相同。

### 四、棘轮的两条边界（记录成决定，不是默认）

1. **扫描面 = `plugin/scripts/`（跳过 `dist/` 与 `checker-mutation-cases/`）**。`dist/` 是 gitignored
   构建产物；`checker-mutation-cases/` 是夹具语料（别的检查器的 mutation 夹具里**故意**含有它们各自
   要抓的字面量，算进来就是让本棘轮替别人判夹具）。
2. **`plugin/test/` 不在面内**，实测 159 个测试文件用同一惯用法。这是**边界决定**：测试不随包发布，
   「换布局就换答案」的风险面不同于 `plugin/scripts`；把它们一并迁走远超本任务的范围。⛔ 本棘轮因此
   **不**声称测试侧的形态已收口 —— 它只声称自己扫的那一面是干净的。
   （附带发现：`plugin/test/driver-cli.test.mjs` 里既有真命中（:34 代码）也有合法提及（:58 裸字符串），
   两者在同一次干跑里被正确区分 —— 见 AC5。）

### 五、棘轮自身：判据形态与两个 O(n) 必要先验

判据是【本文件真声明出的脚本目录常量】+【紧邻的两级上溯】，两者都在**代码位置**判
（`checker-lib` 的 `buildNonCodeMask`，shell 文件额外涂 `#` 行注释）。跑满掩码构建对 354 个文件要
~10 s —— 那种棘轮会被推迟（`--static-tier full`），而推迟就是弱化。加了两个 O(n) 必要先验
（先验文本含 `path.resolve(`；且 `".."` 出现 ≥ 2 次 —— 两个实参都是它），把掩码构建挡在绝大多数文件
之外：实测 **0.34 s / 354 个文件**，故留在 change 层（任何落在 `plugin/scripts/` 的 delta 都会选中它）。
先验是**必要**不充分：判词仍来自位置判据，先验既不能制造也不能压掉一个命中（被先验跳过的文件可证零命中）。

### 六、DoD 要求的生产载体读数（不是 fixture）

- **AC1 grep**（排除 3 行注释后）：修前 27 行 → 修后 **0** 行。
- **`repoRoot` importer 计数**：`grep -lE 'from "\./repo-root\.ts"' plugin/scripts/*.ts | wc -l` = **94**（修前 66）。
- **棘轮对修前样本命中**：`git show <base>:plugin/scripts/measure-trend-check.ts` 落进临时树 ⇒
  exit 1 + `plugin/scripts/measure-trend-check.ts:52`；把该行换成 import 形态 ⇒ exit 0；空扫描面 ⇒ exit 3。
- **等价性**：5 个被迁移文件（`measure-trend-check` / `checked-in-write-check` /
  `external-dogfooding-check` 的 `selftest()` / `fan-in-ts-typecheck-gate` 的两个导出 /
  `runtime-usage-inventory` 的 `main(['--instruments-json'])`）× 迁移前后同一输入，exit code 与
  stdout/stderr **逐字相同**（`runtime-usage-inventory` 的 `generatedAt` 是时钟读数，归一化后比较）。
- **分叉命令**（Proposal §三）：从 `<repo>/plugin/scripts` 出发两形态同值；从
  `<repo>/packages/quay/plugin/scripts` 出发裸常量得 `<repo>/packages/quay`、`repoRoot()` 得 `<repo>`
  —— 不等价已复现。迁移把它消除的形态是：AC2 的 grep 零命中 ⇒ 没有任何站点还能产出那个值，
  而 `repoRoot()` 对两个起点给同一个答案。

### 七、登记面读数

`checker-count-drift-check` 66/66 · `capability-catalog --entry-surface` exit 0
（`--summary`：354 scripts | 354 declared | **0 unclassified**）· `checker-mutation-check --check`
RESULT: PASS（84/84 有 mutation case、stayed-green 0、always-red 0、uncovered 0）·
`rhythm-consumer-check --check` exit 0 · `node --test plugin/test/repo-root-derivation-check.test.mjs` 6/6
（双向非空：命中/不命中/未评估三个取值都有断言）。

## Touches

形态 A → `repoRoot()`（18）：
- plugin/scripts/allowed-tools-plugin-prefix-check.ts
- plugin/scripts/checked-in-write-check.ts（`export const DEFAULT_ROOT` 保持导出）
- plugin/scripts/config-wiring-check.ts
- plugin/scripts/fan-in-workflow-retirement-check.ts
- plugin/scripts/inner-idle-log.ts
- plugin/scripts/kernel-sibling-resolution-check.ts
- plugin/scripts/loop-complete-task.ts（标识符撞名 ⇒ `import { repoRoot as moduleRepoRoot }`）
- plugin/scripts/goal-driver-task-boundary-check.ts
- plugin/scripts/l1-delivery-surface-check.ts
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/measure-trend-check.ts
- plugin/scripts/outer-retirement-precondition-check.ts
- plugin/scripts/red-window-triage.ts
- plugin/scripts/registry-bare-filename-scan.ts（`export const DEFAULT_ROOT` 保持导出）
- plugin/scripts/suite-duration-exceed-check.ts
- plugin/scripts/target-identity-literal-check.ts
- plugin/scripts/suite-state-trigger.ts
- plugin/scripts/spec-declaration-point-check.ts

形态 B → `repoRoot()`（6）：
- plugin/scripts/accounting-emit.ts
- plugin/scripts/cross-machine-verify.ts
- plugin/scripts/fan-in-ts-typecheck-gate.ts（**走 `resolveCoreSrcFile` 而不是 `repoRoot()`** —— 它是安装位置推导，见执行记录 §三）
- plugin/scripts/integration-batch-merge.ts（标识符撞名 ⇒ 别名 import；:379 的 `--root` 覆盖不动）
- plugin/scripts/server-restart-inflight-verify.ts（别名 import）
- plugin/scripts/server-partial-stop-verify.ts（别名 import）

硬规则 5b 枚举出的同族 5 个（立案清单漏项）：
- plugin/scripts/manager-tick-readings.ts（别名 import）
- plugin/scripts/profiles-role-coverage-check.ts
- plugin/scripts/runtime-usage-inventory.ts
- plugin/scripts/suite-execution-form-counter.ts
- plugin/scripts/external-dogfooding-check.ts

新增与登记：
- plugin/scripts/repo-root-derivation-check.ts (new)（棘轮：位置判定抓「向上两级」常量）
- plugin/test/repo-root-derivation-check.test.mjs (new)（双向断言：命中 / 不命中 / NOT-EVALUATED）
- plugin/scripts/checker-mutation-cases/repo-root-derivation-check.sh (new)（checker-mutation-check 的 fail-closed 义务）
- plugin/scripts/capability-catalog-declarations.json（六表登记。`capability-catalog.sh` 的代码半**未改**——六表数据在 JSON 里，与立案清单的猜测不同）
- plugin/scripts/runner-static-gate.ts（登记进 run_static_checks + `@checker-count 65`→66）
- tasks/gap-repo-root-derivation-bypasses-shared-accessor.md（自身）
