---
id: gap-arch-tsify-checker-mutation-check-sh
title: shell→TS（SPEC Phase 5.2）：checker-mutation-check.sh（490 行）改写为 TS，先做
  characterization；mutation-cases 目录的 sh 用例不在本任务范围
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-312
---
## Proposal

**把 `plugin/scripts/checker-mutation-check.sh`（490 有效行）改写为 `plugin/scripts/checker-mutation-check.ts`，`.sh` 留作薄入口一个发布周期。SPEC-architecture-consolidation §5 Phase 5.2；GOAL-B 的量来源之一。**

**这个脚本的特殊性（为什么 characterization 尤其要紧）**：它本身是「让检查器能取假」的**突变仪器**（AC-224 一族依赖它证明检查器不是恒绿）。改写时若悄悄改变它的突变判据，等于让整个「能取假」保证静默失效，而且**与「一切正常」同形**（硬规则 3b）。⇒ characterization 必须对**每个既有 mutation case**钉住「注入后检查器变红」的结果。

**范围界定（不要越界）**：`plugin/scripts/checker-mutation-cases/*.sh`（用例文件，按 basename 与被测检查器同名）是**数据/用例**，不是本脚本；本任务**不改写它们**。已知相邻任务 `gap-checker-mutation-parallel-case-loop`、`gap-checker-mutation-cases-4-checkers`、`gap-checker-mutation-check-has-no-change-tier-companion` 各管一块——实现前先读它们的状态，避免与在飞任务抢文件；有冲突写进 notes。

## AC

- [x] AC1（characterization 先于改写，取假）新测试 `plugin/test/checker-mutation-check-characterization.test.mjs` 在**未改动的旧 bash** 上先落盘并全绿；对旧 bash 注入一处判据改动（例如让「突变后仍绿」被判为通过），该测试必须红，撤销后绿。两次输出贴进 notes，且 characterization 提交早于 TS 改写提交。
- [x] AC2（逐用例等价，枚举非布尔）对 `checker-mutation-cases/` 下**每个**用例，旧 bash 与新 TS 对「突变前绿 / 突变后红」的判定与退出码一致；贴逐用例对照表，用例数与目录里的用例文件数相同（缺一即不合格）。
- [x] AC3（不许把「读不懂」伪装成合格，硬规则 3b）对一个格式错误的用例文件，新 TS 必须给出**独立的「未评估」取值**（非 0 退出或显式 `evaluated:false`），不得与「全部通过」同形；贴该输出，并对旧 bash 同输入的行为做对照。
- [x] AC4（内嵌解释器/行数读数）`sh-census-check.ts --json` 显示本脚本不再含内嵌解释器（或被 ≤25 行薄入口取代）；`plugin/sh-census-baseline.json` 只降不升地下调。**⚠️ 逐字偏离一处，见下方「AC4」节：立案前提为假（本脚本从未含内嵌解释器），「下调」在结构上不可能，读数只升了薄入口自身那 5 行，且已按机制记进 `_reanchorLog`。**
- [x] AC5（生产载体，硬规则 4 推论三）落地后时间窗内，一次**真实**运行该突变仪器对真实检查器给出读数（贴时间戳晚于落地提交的运行记录）；关掉 fixture 仍成立。
- [x] AC6（调用方与无新环）`axis-generator.ts`、`checked-in-write-check.ts` 及 `checker-mutation-cases/*.sh` 对它的引用不断，各自测试单独跑并贴结果；`capability-catalog.sh --summary` 声明数一致；`import-graph-check.ts --json` `verdict.ok=true`。
- [x] AC7（回归面）`scripts/test.sh --for-task gap-arch-tsify-checker-mutation-check-sh` 全绿。

## DoD

真实落地：突变仪器新实现对真实检查器跑出过读数（AC5），且每个既有用例的突变判定与旧实现逐项一致（AC2）。「读不懂输入」有独立取值（AC3）。

## 证据（AC 逐条）

**落地提交**：`1dc63c7ce`（characterization，先）→ `6aeb42704`（TS 改写）→ `06c22f5a3`（catalog 登记）→ `0d241f910`（merge develop，无冲突）。分支 `task/gap-arch-tsify-checker-mutation-check-sh`。

**续做轮落地提交**（本节的由来见下方「续做轮」）：`4aba64e15`（merge develop，无冲突）→ `932f7ee9d`（修 suite 静态相位两根红线：JSON primitive + `.ts` 的 判据1 接线证据）。

**AC1 — characterization 先于改写，且可取假。✅**
`plugin/test/checker-mutation-check-characterization.test.mjs`（14 例）在**未改动的旧 bash** 上落盘并 **14/14** 全绿（`.quay/ac-char/baseline-run.txt`）；提交序 `git log --oneline --reverse develop..HEAD` 里 `1dc63c7ce test(checker-mutation): characterization BEFORE the TS rewrite` 早于 `6aeb42704 arch(checker-mutation): the program moves into TypeScript`。
取假（负控制）：把旧 bash 的**一个 token** 改掉——`3) res="stayed-green"` → `3) res="pass"`（其余一字不动，副本放在 `plugin/scripts/` 内以免 `_script_dir/../..` 解析错根）：
```
mutant  : ℹ tests 14 · pass 12 · fail 2 · rc=1   (.quay/ac-char/mutant-run.txt)
baseline: ℹ tests 14 · pass 14 · fail 0 · rc=0
```
两条红断言是 `exit 3 (defect present, checker still green) must be a FINDING, never a pass` 与 `MUTATION fake-stayed-green: stayed-green` 的正则。撤销（删除 mutate 副本）后回到 14/14。
**同一个测试文件在改写后仍 14/14 全绿**（跑的是薄入口 → .ts），所以它钉的是「迁移前后同一份输入同一份输出」，不是某一份实现的自画像。测试可用 `CMC_UNDER_TEST` / `CMC_RUNNER` 指向任一实现（AC2 的差分用的就是这个机制）。**续做轮复跑仍 14/14。**

**AC2 — 逐用例等价。✅**
差分夹具：`git show 1dc63c7ce:plugin/scripts/checker-mutation-check.sh` 取出**未改动的旧 bash**，与新实现（`bash plugin/scripts/checker-mutation-check.sh` → 薄入口 → `.ts`）对**同一棵树**各跑一次 `--run --json`：
```
用例文件数(=目录里 *.sh 数): 88     每实现执行用例数: 85 / 85
两实现 results 键集相同: True       逐用例判定不一致数: 0 / 88
旧实现总退出码 0     新实现总退出码 0
checkers_total 83 / checkers_with_mutation 83 / stayed_green 0 / always_red 0 / errors 0 / uncovered 0（两者逐字相同）
```
全表在 `.quay/ac-char/ac2-table.md`（88 行，每行一个用例文件：在 manifest 内 / 旧判定 / 新判定 / 一致）。其中 3 行是**目录里有、manifest 里没有**的用例（`manager-observation-runtime-check` / `no-manager-tick-doc-check` / `tmux-test-isolation-check`）——两实现都不跑它们，表里如实标「未注册」而不是省略，所以行数与目录文件数相等。
JSON 的**唯一**差异是新增两个键（`evaluated` / `not_evaluated`，AC3 的取值），旧实现的键序与值逐字保留在其之前。
**续做轮对等价性的再确认（硬规则 4c：改写后落笔的判据要取一次真实读数）**：本轮的 JSON primitive 改动**逐字节不改输出**——`--list --json` 新旧各 6974 字节、`diff` 空；`--run --json` 旧 vs 新在只归一化 `duration_ms` 后 `diff` 空。

**AC3 — 「读不懂」有独立取值。✅**
夹具根（`--repo-root` 指向一个临时根，注册一个 checker，其用例文件是语法坏掉的 `if` 未闭合）：

旧 bash：
```
/tmp/ac3fix/plugin/scripts/checker-mutation-cases/fake-malformed-check.sh: line 5: syntax error: unexpected end of file
MUTATION fake-malformed-check: error
errors: 1
RESULT: FAIL — a checker stayed green under a defect it should catch, or the manifest is incomplete/broken.
rc=1
```
新 TS：
```
MUTATION fake-malformed-check: not-evaluated
errors: 0
not_evaluated: 1
not-evaluated (the case file could not be read/evaluated at all — ⛔ not a pass):
  - fake-malformed-check  (bash -n rejected the case file (syntax error): …line 5: syntax error: unexpected end of file)
RESULT: NOT-EVALUATED — at least one case file could not be evaluated (see the list above); a case that cannot report a verdict is never a pass.
rc=2
```
`--json`：`"results":{"fake-malformed-check":"not-evaluated"}`、`"evaluated":false`、`"not_evaluated":["fake-malformed-check"]`、`"errors":0`（旧：`"error"` / 无 `evaluated` 键 / `errors:1`）。
⇒ 新取值**显式、可区分、非 0 退出**，与「全部通过」不同形（硬规则 3b）。**这是本任务唯一的行为新增**（改写前那个值是 `error`，它把「读不懂这个文件」与「这个文件跑起来报了基础设施错」混在一格；更糟的是**注释-only 的用例文件**旧实现判 `pass`——那正是 #6 的「不会失败的探针」形状，新实现判 `not-evaluated`）。
**续做轮复跑**：`plugin/test/checker-mutation-check.test.mjs` 的 `AC3: a malformed case file is never reported as a pass` 与 `AC3: a comment-only case file … never reported as a pass` 两例均绿（该文件本轮 **11/11**）。

**AC4 — 内嵌解释器/行数读数。⚠️ 满足第一肢；第二肢的前提为假，如实记录。**
`node --experimental-strip-types plugin/scripts/sh-census-check.ts --json`：
- 本脚本：`codeLines 490 → 5`、`tsTwin false → true`、`embedded [] → ["node"]`。
- ⇒ 第一肢的括号支成立：它**被 ≤25 行薄入口取代**（5 行）。
- `plugin/sh-census-baseline.json`：`embeddedInterpreterLines 8413 → 8418`。**⛔ 是升不是降，原因不是本任务偷懒，而是立案前提为假**：SPEC-architecture-consolidation §1.3 的表把本脚本与 `node` 配了对，但**实测**这个 `.sh` 从来不在该轴上（`embedded: []`，改写前后一致）——它全文的 `node` 只出现在**注释**与一条 `grep` 正则**字符串**里（按位置判定，硬规则 2），从来没有命令位置的解释器调用。所以「转换一个内嵌解释器 .sh ⇒ 轴按程序行数下降」在这里**无对象**，唯一可能的移动就是薄入口自己那 5 行（`exec node --no-warnings --experimental-strip-types`，census 的 `nodeQualifies` 按设计计入——与 capability-catalog.sh / quay-init.sh / develop-deliver-tgz.sh / cross-machine-verify.sh 同形：薄入口留在轴内，动的是行数）。
- 这 5 行已按 census 自己的机制写进 `_reanchorLog`（含 `why` 与 `attribution`：「+5 = 490→5，残差 0 由构造保证，因为本分支的 `.sh` delta 就是这一个文件」），**没有静默**。
- **为什么不用「让 detector 看不见那个调用」的写法把读数压平**：把入口写成直接 exec 那个 `.ts`（靠它自己的 shebang），读数确实不动，但那条路径**不在** `packages/quay/scripts/build-plugin-dist.mjs` 的 `rewriteShell` 已验证的改写规则上（`exec node --experimental-strip-types "$SCRIPT_DIR/X.ts" → exec node "$SCRIPT_DIR/dist/X.js"` 是唯一被生产产物证过的形态）——为了 5 行读数把一个**打包后可能跑不起来**的入口形态引进生产，比 5 行可复核的账更贵。⇒ 保留户形，把代价写进账本。
- 判据取假：census 自身的 `verdict.ok=true`（读数不超基线、基线相对 HEAD 未被调高）。
**续做轮复跑**：`sh-census-check.ts --json` ⇒ `verdict.ok=true`、`over:[]`、`baselineRaised:[]`（`headBaseline.embeddedInterpreterLines=7688`）、`.sh` 仍为 36 行薄入口。

**AC5 — 生产载体：一次真实（非 fixture）运行。✅**
落地提交 `6aeb42704` 的提交时刻 = `2026-09-20T20:20:45+00:00`；运行窗口严格在其后：
```
run start: 2026-09-20T20:22:44Z      （.quay/ac-char/ac5-real-run.txt）
$ bash plugin/scripts/checker-mutation-check.sh --run --json
rc=0    stderr: []
checkers_total: 83  checkers_with_mutation: 83
mutations_that_stayed_green: 0  always_red: 0  errors: 0  uncovered: []
cases executed: 85  duration_ms: 17095  evaluated: True
run end:   2026-09-20T20:23:02Z
```
**关掉 fixture 仍成立**：`--root` 未给（用真树）、`--only` 未给、无 `--meta-inject`、用例目录是仓库里真实的 `plugin/scripts/checker-mutation-cases/`（88 个文件，其中 85 个被真实执行）——夹具关掉后它照样给读数。
另外，本任务自己的用例（`checker-mutation-cases/checker-mutation-check.sh` → `--selftest`）就在这 85 个里，判 `pass`：**突变仪器对自己的突变覆盖也是真的跑过的**。
**续做轮复跑（真树，非 fixture）**：`bash plugin/scripts/checker-mutation-check.sh --check` ⇒ `RESULT: PASS`、rc=0、`checkers_total 85 / checkers_with_mutation 85 / stayed_green 0 / always_red 0 / uncovered 0 / errors 0 / not_evaluated 0`（本轮真树比 AC5 时多 2 个 checker，是 develop 前进带来的，不是本任务改的）。

**AC6 — 调用方与无新环。✅**
- **引用不断**：`checked-in-write-check.ts:54/91` 与 `checker-mutation-cases/*.sh` 对本脚本的引用**未动**，且 `git diff --name-only develop...HEAD` 里 `checked-in-write-check.ts` 不出现。
- **一处必须说明的更正（续做轮）**：`axis-generator.ts` 的两条**注释叉引用**本轮被改（`checker-mutation-check.sh`'s awk → `checker-mutation-check.ts`'s extraction；`same mechanical source as checker-mutation-check.sh` → `…checker-mutation-check.ts's manifest parse`）。**理由不是「为了让某个检查器变绿」，而是那两条注释在改写后已经为假**：`.sh` 现在是 36 行薄入口，**它里面没有 awk、也没有 manifest parser**——继续写 `.sh` 就是指着一个不再持有该逻辑的文件（同「判据的对象随程序移动」，与下方 Touches 增补同一条理由）。**它同时是 `.ts` 的 判据1 接线证据**，此事在下方「续做轮」第 2 条如实记账。原立案时的「未触碰、零改动」说法因此**作废**，以本条为准。
- 各自测试单独跑：`axis-generator.test.mjs` **10/10**（续做轮改注释后**复跑仍 10/10**）、`checked-in-write-check.test.mjs` **12/12**。
- `checker-mutation-cases/*.sh` 的引用（用例文件用 `bash "${checker_dir}/checker-mutation-check.sh" --selftest` 调用）**不断**：该用例在 AC5 的真实运行里执行并判 `pass`；另跑三份按路径引用的测试：`scoped-static-checks.test.mjs` **14/14**、`select-static-checks-for-touches.test.mjs` **23/23**、`guard-lineage-check.test.mjs` **9/9**。
- `capability-catalog.sh --summary`：**351 scripts | 351 declared | 0 unclassified | 346 ship**（改前，在 `1dc63c7ce` 的 detached worktree 实测）→ **352 | 352 | 0 | 347**。差量恰为新增的这一个脚本且已声明，`unclassified` 两次都是 0（新增 `.ts` 原本会让它变 1 并使目录 exit 1——已按「新脚本六行登记」补齐 QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER，同 `cross-machine-verify.ts` 的先例）。
- `import-graph-check.ts --json`：`verdict.ok=true`、`reverseEdges=[]`、`valueSccs=[]`（无新环、无 packages→plugin 边）。
- 另跑与清单/交付面有关的两个检查器：`capability-manifest-check` rc=0、`scripts/delivery-manifest-check.ts` rc=0。

**AC7 — scoped 门全绿。✅**
`bash scripts/test.sh --for-task gap-arch-tsify-checker-mutation-check-sh --allow-thin` ⇒ **rc=0（47 tests / 47 pass / 0 fail）**，其中包含本任务的两个测试文件（characterization 14 例 + 存量 checker-mutation-check 11 例，后者含改写后仍然有效的 parser 负控制——它现在通过 `plugin/scripts/` 的**符号链接影子目录**改坏实现本体，因此变异体仍能解析自己的 import，断言的失败原因是 `manifest is EMPTY` 而不是 import 错误：不会出现「因为别的原因红了所以算过」的假绿）。
scoped-gate 缓存已写。**续做轮重跑同一条命令 ⇒ 仍 rc=0（47/47/0）**，缓存重写为 `developSha=c0758b61e4fa34f5f30e1f6643080ea2c678cb34`（旧值 `0d241f910…` 作废；写前已 `git merge-base --is-ancestor` 复核该 sha 是 HEAD 的祖先）。

## 续做轮（2026-09-23，`step=suite: # fail 47` 的真因与修复）

### 真因：那不是 47 个测试失败，是**静态相位**红，且日志**已经点名了**
上一轮把 `step=suite` 记成「归因不出任何失败测试文件（基建/契约疑似）」。**该结论不成立**：suite 日志末行是 `# suite red static-check`，且第 40-51 行逐字写着原因——
```
STATIC_CHECK_FAILED: checker-mechanical-spine-check exit=1
STATIC_CHECK_FAILED: kernel-sibling-resolution-check exit=1
STATIC_CHECK_FAILED: rhythm-consumer-check exit=1
checker-mechanical-spine-check — 133 checker(s), 1 violation(s), 0 exempted
FAIL: 1 unexempted violation(s):
  - checker-mutation-check.ts (json): --json claimed but no JSON primitive
```
`# tests 0 / # pass 0 / # fail 47` 是静态相位短路后测试计数未填充的**合成读数**，不是 47 个红测试。⇒ 三根红线**全部可归因**，其中两根点名的就是本任务的文件。（develop 随后落了 `c8e62c8b1`「静态相位的红对归因器可见（不再报成 infra suspected）」，其注释里引用的正是本条日志行——该误诊的机制面已被独立修复，本任务不再重复处理。）

### 修复 1（本任务缺陷）：`--json` 声称了但没有 JSON primitive
`checker-mechanical-spine-check` 的 C2 要求「claimed `--json` ⇒ 源码里有 JSON 输出原语（`JSON.stringify` 或 `emitVerdict/emitPass/emitFail/emitNotEvaluated`）」。新 `.ts` 的四个发射器（`listJson` / `joinJsonNames` / `csvToJsonArray` / `runJsonLine` 的 results 映射）都是**手搓引号** `"${n}"`，源码里没有原语 ⇒ 违例。
**修法**：四个发射器全部改走 `JSON.stringify`（各分隔符逐字保留）。这不只是为了让检查器满意——**手搓引号从不转义**，checker 名或 source 里出现 `"` / `\` 就会产出坏 JSON；`JSON.stringify` 修的是这个真实（潜在）缺陷。
**取假 + 等价（硬规则 4c）**：真树上新旧实现 `--list --json` 各 6974 字节、`diff` 空；`--run --json` 归一化 `duration_ms` 后 `diff` 空。⇒ 输出逐字节不变。

### 修复 2（本任务缺陷）：`.ts` 在 判据1 上是 unwired
`rhythm-consumer-check` 判据1 报 `checker-mutation-check.ts: no-call-site (non-按需 cadence declared, nothing runs it)`：catalog 给 `.ts` 声明的 `CADENCE` 是「每轮」（**诚实**——它每轮都经薄入口执行），但同名 strict/broad 面里没有任何文件提到它。
- 真因是**一条已过期的白名单 carve-out**：`broadSurfaceFiles()` 有 `if (e.startsWith("checker-mutation")) continue;`，其注释说它的目的是排除「**内嵌每一个机制 basename** 的 carrier」——历史上那个 carrier 就是 490 行的 `checker-mutation-check.sh`（它解析 `run_static_checks` 产出全部 checker 名的 manifest）。**本轮改写正是把那个 carrier 变成了 36 行薄入口**，而新 `.ts` 从注册表**文件**读 checker 名（`REGISTRY_REL_CANDIDATES`），**实测不再内嵌任何其它 checker 的 basename**（逐名扫描 109 个 `-check.ts`，命中 1 个且是无关的 `suite-bucket-drift-check`）。⇒ carve-out 的前提已被本任务删除，它对 `.ts` 的排除是**假阳**。
- **实测 blast radius**：临时停用该 carve-out 后跑 判据1，**全局 `ok` 不变（两种状态下都是 True）**，唯一变化是 `.ts` 的证据从「别人一句注释」变成「薄入口自己」。
- **本轮选择的修法（在 Touches 内，且不碰评审器）**：更正 `axis-generator.ts` 里两条**改写后已为假**的叉引用，使 `.ts` 的接线证据来自一个**在 Touches 内、且内容真实**的载体。⛔ **没有改 `rhythm-consumer-check.ts`**：它是评审器，由一个正被它判定的 worker 去放宽自己的判据是本仓库最忌的形状（`gate-gameability`），且 carve-out 的去除虽已证明无害，仍应由独立任务在其自身 AC/DoD 下完成。该 carve-out 的过期已如实记在本节（发生率仅 1 ⇒ 按硬规则 12 记为观察项，不作阻塞）。
- 结果：`.ts` 判据1 = `wired-broad`，证据 `['axis-generator.ts', 'worker-driver.ts']`（两处独立，故不因某一条注释被改写而单点失效），`rhythm-consumer-check` rc=0。

### 另两根红线：一根是分支滞后，一根是我的**测量方式**错（⛔ 不是代码问题）
- `kernel-sibling-resolution-check`：在本轮树上直接跑 ⇒ **PASS**（386 kernel file(s), 0 naive resolution）。09-20 那次红是分支落后 develop 造成的，merge develop 后自愈。
- `outer-tick-log-check`（不属本任务、本任务未触碰）：直接跑 mutation 门时出现 `always_red: 1`，看着像第三根红线。**实测是环境伪影**：它的 mutation case 用 `date -u +%H:%M` 造 fixture 标签，而 checker 按**本地时**读文件 mtime；本机为 UTC+8，于是 `future-label:17:04>mtime:01:04` ⇒ baseline 就红（本地 00:00–07:59 这 8 小时内恒红）。`scripts/test.sh:272-274` 已经 `export TZ="UTC"`，所以**在 suite 里它一直是绿的**（09-20 的 suite 日志亦为 `RESULT: PASS`）。按 suite 的 pinned 环境（`LC_ALL/LANG=C.UTF-8 TZ=UTC`）重跑 ⇒ `RESULT: PASS`、rc=0、`always_red: 0`。⇒ 教训（同硬规则 4b）：**复核要用生产路径的环境，否则会把仪器伪影记成产品缺陷。**

### 续做轮的判决读数（全部在 merge develop 之后的树上取）
```
checker-mechanical-spine-check   : 135 checker(s), 0 violation(s)        rc=0
rhythm-consumer-check            : 判据1 ok=True（.ts wired-broad）      rc=0
checker-mutation-check --check   : RESULT: PASS  always_red=0            rc=0   (TZ=UTC)
kernel-sibling-resolution-check  : PASS (386 files, 0 violation)         rc=0
scripts/test.sh --for-task … --allow-thin : 47 tests / 47 pass / 0 fail  rc=0
anti-drift-touches-check --task … : 7 actual file(s), all within declared Touches (9 glob(s))
```

## Notes

### 与相邻任务的关系（实现前已读三方状态）
`gap-checker-mutation-parallel-case-loop`、`gap-checker-mutation-cases-4-checkers`、`gap-checker-mutation-check-has-no-change-tier-companion` **均 done**，无在飞冲突。**唯一已知同文件风险**：`gap-arch-tsify-integration-batch-merge-sh`（ready，SPEC 5.2 的姊妹任务）也改 `plugin/sh-census-baseline.json`——两者都往 `_reanchorLog` 追加并各自设定顶层读数。本任务落地后若该任务再落，合并时**必须两边都保留日志条目并重新取一次真实读数**（不能只留一边的数字，那会让读数与基线脱钩而 census 报红）。

### 本任务范围内的行为差异（全部记在此，不静默）
1. **`not-evaluated`**（AC3）：新增取值，作用于「用例文件根本读不懂」这一类输入。旧实现在这一类上给 `error`（rc 1）；对**注释-only**的用例文件旧实现甚至给 `pass`。
2. **`--only` 指了未注册名字**：旧 bash 打出 ERROR 之后**继续**打完整报告，并在 `_run_duration_ms` 上撞 `set -u` → `unbound variable` 崩掉（实测 rc=1、报告半截）；新实现按源码本意**干净地 rc=2** 且不半打报告。
3. **`--help`**：契约（首参 `--help|-h` → 打印用法 → exit 0；用法正本在文件头部注释）不变；正文改为打印**实现文件**的头部注释（旧 bash 打印 `.sh` 自己的前 120 行注释，而 `.sh` 现在是 3 行入口）。无测试钉正文。
4. **实现层**：awk/grep/sed/sort 从热路径消失；并行用例池从「后台 subshell + 结果文件」改成真 async 池（同样的 `CHECKER_MUTATION_PARALLEL → STATIC_CHECK_CONCURRENCY → 宿主核数`，信号杀死的用例仍记 `error` 而不是 pass）。

### Touches 的一处增补（必须说明）
增补 `plugin/test/checker-mutation-check.test.mjs`：该文件里有一条**AC4 的代码级负控制**读的就是被改写的那份源码（`assert.ok(src.includes("(list_run_static_checks_checkers; list_ci_checkers) | sort -u"))`），改写后它必然红（实测 1 fail / 10 pass）。**判据的对象随程序移动**，所以把它指向 `.ts`（并加了「失败原因必须是 EMPTY-manifest」这条断言，防止 import 错误冒充负控制成功）。`plugin/scripts/checker-mutation-cases/*.sh` **零改动**（范围界定照原样遵守）。
**更正（续做轮）**：同一节的旧版还写了 `axis-generator.ts` / `checked-in-write-check.ts` **零改动**。`checked-in-write-check.ts` 至今确实零改动；`axis-generator.ts` 在本轮有**两行注释**改动（理由见 AC6 与「续做轮」第 2 条）——该文件**本就在 Touches 内**，故未扩表，anti-drift 复核为 7 actual / all declared。

## Touches

- plugin/scripts/checker-mutation-check.sh
- plugin/scripts/checker-mutation-check.ts (new)
- plugin/test/checker-mutation-check-characterization.test.mjs (new)
- plugin/test/checker-mutation-check.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- plugin/sh-census-baseline.json
- plugin/scripts/axis-generator.ts
- plugin/scripts/checked-in-write-check.ts
- tasks/gap-arch-tsify-checker-mutation-check-sh.md

## Needs-Human

**执行 2026-09-20T20:38:54.709Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 47
- run_id：wk-prod-anchor
- session_id：caa0b901-a3ab-492e-a470-15dacef54c0b
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-arch-tsify-checker-mutation-check-sh~wk-prod-anchor~1789936621276-793e6e.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-arch-tsify-checker-mutation-check-sh-wk-prod-anchor.log

**解除（2026-09-23，续做轮，不由本 worker 改 status）**：上条的两项判词均已被证否——(1)「日志里没有 worker 能修的东西」不成立：日志第 49-51 行点名了本任务的 `checker-mutation-check.ts`，本轮已修（见「续做轮」）；(2)「基建/契约疑似」中的 `kernel-sibling-resolution-check` 是分支滞后（merge 后 PASS），`outer-tick-log-check` 是未 pin TZ 的测量伪影（pinned 环境下 PASS）。本轮判决：spine 0 violation、rhythm rc=0、mutation `RESULT: PASS`、scoped 门 47/47 rc=0。