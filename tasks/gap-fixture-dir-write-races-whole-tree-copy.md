---
id: gap-fixture-dir-write-races-whole-tree-copy
title: 测试往已签入的 fixtures 目录里建/删临时目录 —— 与任何整树拷贝并发即产生假红
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/test/workflow-replay.test.mjs` 在**已签入的** `plugin/fixtures/workflow-replay/` 内用 `fs.mkdirSync` / `fs.rmSync` 建删三个临时目录（`_tmp-bad-schema` / `_tmp-missing-field` / `_tmp-bad-class`，自 `plugin/test/workflow-replay.test.mjs:181` 起）。任何在同期做整树拷贝的调用者，会在 `cp` 对该目录 readdir 之后、stat 之前撞上刚被删掉的条目。

**已实测的受害者**：`test/cold-start-oneliner-e2e.sh` 的 `cp -r "$PLUGIN_SRC" "$QUAY_DEV/plugin"`。**受害者一侧的一半已经修掉**（任务 `gap-promotion-admission-reads-goal-layer-field`，commit `fc67bfd06`：把 `--count-inputs` 的 mode 分派上移到任何文件系统动作之前，因为该 measure 只读一个静态数组、本就不需要文件系统动作）——但那只是让 `--count-inputs` 这一条路径不再做拷贝，**根因仍在**。

**实测读数（判别性对照）**：并发臂（e2e × 400 与 workflow-replay × 40 同时跑）失败 **2/400**，报错逐字节等于 suite 日志里的 `cp: cannot stat '<worktree>/plugin/fixtures/workflow-replay/_tmp-bad-schema': No such file or directory`；单跑臂（e2e × 25，无并发）失败 **0/25**。⇒ 失败依赖「并发」这个自变量，不是环境噪声。独立佐证：`.quay/worker-driver.log:48502` 记录了任务 `gap-goal-driver-gap-semantic-filing-ring` 的 worker 在同一形状上撞到同一失败、得出同一根因。

**为什么这是缺陷（而不是"测试写得随意"）**：一个测试**修改仓库树**，而仓库树同时是别的测试与工具的输入——共享可变状态。更贵的一点是：失败**落在受害者身上**（`cp` 报错、受害测试变红），不落在施害者身上 ⇒ 归因成本高，本仓库已因此烧掉至少两轮 fan-in（两次都被误判为"任务自己的 delta 有问题"，需实跑复现才能排除）。

**残留暴露面**：任何做整树拷贝的调用者——FULL 模式的 e2e（`--plugin-src` / `--from-build`）、未来的打包/发布步骤、任何"对检出做快照"的工具。

## Plan

1. **先取证再改**：读 `runWorkflowReplay` 的路径解析，判定它是否依赖「fixture 目录位于 `FIXTURES_DIR` 之内」。判定结果写进 Evidence，⛔ 不预设。
2. 把那三个临时目录从**已签入路径**移出，改用进程私有临时目录（如 `fs.mkdtempSync(path.join(os.tmpdir(), ...))`）。若第 1 步证明 `runWorkflowReplay` 依赖相对位置，则改为「把该用例需要的文件复制进私有临时目录」而不是移动它，并说明理由。
3. 加一条**能取假**的防回退判据：断言 `plugin/test/**` 不在已签入路径下创建条目。须为**位置判定**（硬规则 2，不看关键词），且「读不懂输入」必须有独立取值、不与合格同形（硬规则 3b）。
4. 若第 3 步落地为脚本，登记进 `plugin/scripts/capability-catalog.sh`（唯一清单），并读它自报的 `summary: N scripts` 确认 +1。

## Acceptance Criteria

- [x] AC1 **取证**：贴出 `runWorkflowReplay` 路径解析的实际代码片段与结论——它是否依赖 fixtures 根？两种结论都可接受，但必须由读码得出，⛔ 不得推测。
- [x] AC2 **位置判定**：三个临时目录不再创建于任何已签入路径下。判据 = 跑 `plugin/test/workflow-replay.test.mjs` 前后 `git status --porcelain` 均为空（**不是** grep `_tmp-` 关键词）。
- [x] AC3 **判别性对照**：以本任务 Proposal 记录的复现口径（与 `test/cold-start-oneliner-e2e.sh` 的整树拷贝并发跑）两臂各贴读数：修复后 0 失败；且须证明该口径**能**取假（修复前的同一复现读数，或把临时目录人为放回后在同样并发下可复现 ≥1 失败）。只给修复后的 0 不构成证据。
- [x] AC4 防回退判据存在且**能取假**：注入一个在 `plugin/fixtures/` 下 `mkdir` 的夹具 ⇒ 判据红；未注入 ⇒ 绿；输入读不懂 ⇒ 独立取值。三种取值各贴一条真实输出。
- [x] AC5 原语义不回退：`plugin/test/workflow-replay.test.mjs` 全绿（贴 tests/pass/fail 三行）。

## Definition of Done

- [x] AC1–AC5 全绿，Evidence 里每条都贴**真实读数**（退出码/计数/原文），⛔ 不贴"预期值"。
- [x] ⛔ **不得用「给 `cp` 加重试」或「让 `cp` 忽略错误」作为替代修法**——那会把一次真实的树变更静默吞掉（硬规则 3b：读不懂输入不得返回与合格同形的值）。
- [x] ⛔ **不得靠改 `test/cold-start-oneliner-e2e.sh` 去迁就**：受害者侧已经改过一次（见 Proposal），再改就是把责任继续留在受害者身上；修的是施害者（谁写了仓库树）。
- [x] 未来边界写进代码注释或判据文档（一条不变式）：**测试不得在已签入路径下创建或删除条目；一切临时产物落在进程私有临时目录。**

## Evidence

### AC1 — 取证：`runWorkflowReplay` 的路径解析是否依赖 fixtures 根

读码 `plugin/scripts/workflow-replay.ts`（基线 377f9a8e4，本任务未改动该文件）：

```
:291  export function runWorkflowReplay(casePath: string, opts: { strict?: boolean } = {}): ReplayResult {
:292    const caseName = path.basename(casePath);
:294    const { events, errors: le } = loadEvents(casePath); errs.push(...le);
:296    const { manifest, errors: xe } = loadExpectations(casePath); errs.push(...xe);
:262  function loadEvents(fixturePath: string): { events: StageEvent[] | null; errors: string[] } {
:264    const ep = path.join(fixturePath, "events.jsonl"), xp = path.join(fixturePath, "expectations.json");
:283  function loadExpectations(fixturePath: string): { manifest: ExpectationManifest | null; errors: string[] } {
:284    const xp = path.join(fixturePath, "expectations.json");
```

`grep -n FIXTURES_DIR plugin/scripts/workflow-replay.ts` 的全部命中：`:8`（定义）、`:342`（`main()` 的 `let fd = FIXTURES_DIR` 默认扫描目录）。**两处都不在 `runWorkflowReplay` 内。**

**结论：不依赖。** `casePath` 是调用方给出的任意绝对路径，函数只取 `path.basename(casePath)` 作为 caseName，并把两个固定文件名拼在其后；fixtures 根只是 `main()` 的默认值。⇒ Plan 第 2 步取「移动到进程私有临时目录」，不需要「复制文件进私有目录」那条退路。

### AC2 — 位置判定（`git status --porcelain` 前后）

```
=== AC2: git status --porcelain BEFORE ===
[end]
=== AC5: run the replay test ===
ℹ tests 21 / ℹ suites 16 / ℹ pass 21 / ℹ fail 0
=== AC2: git status --porcelain AFTER ===
[end]
```
前后均为空（判据是位置读数，不是 `grep _tmp-`）。

**⚠️ 诚实补充（一条实测的负读数）**：这条 git-status 读数对「建后即删」的瞬态**不能取假**。把 pre-fix 的测试文件放回工作树后重跑同一读数：

```
=== AC2 counterfactual: git status BEFORE run ===      === git status AFTER run ===
 M plugin/scripts/checked-in-write-check.ts             M plugin/scripts/checked-in-write-check.ts
 M plugin/scripts/checked-in-write-guard.cjs            M plugin/scripts/checked-in-write-guard.cjs
 M plugin/test/checked-in-write-check.test.mjs          M plugin/test/checked-in-write-check.test.mjs
 M plugin/test/workflow-replay.test.mjs                 M plugin/test/workflow-replay.test.mjs
```
两段逐字相同、无 `??` 新条目 —— 因为 `_tmp-*` 在 run 内建完即删。所以 AC2 的 git-status 读数是**必要不充分**：它证明「没有残留」，不证明「没有发生」。真正能取假的是 AC4 的运行时判据（同一次 pre-fix 读数 ⇒ exit 1 并点名三条 `_tmp-*`，见 AC4 末条）。

### AC3 — 判别性对照

口径 = `test/cold-start-oneliner-e2e.sh:82` 自己的命令形状 `cp -r "$PLUGIN_SRC" "$QUAY_DEV/plugin"`（受害者的整树拷贝，逐字取自该脚本），与 workflow-replay 测试文件并发跑，每臂 90s，同一 harness：

```
=== ARM C-PRE : pre-fix 测试文件，同口径，90s ===
plugin_src=/tmp/ac3-prefix/plugin  duration=90s copies=524 failures=2 test_runs=135
      1 cannot stat '/tmp/ac3-prefix/plugin/fixtures/workflow-replay/_tmp-missing-field': No such file or directory
      1 cannot stat '/tmp/ac3-prefix/plugin/fixtures/workflow-replay/_tmp-bad-schema': No such file or directory

=== ARM C-POST: 修复后测试文件，同口径，90s ===
plugin_src=.../gap-fixture-dir-write-races-whole-tree-copy/plugin  duration=90s copies=468 failures=0 test_runs=116
```
pre-fix 臂的两条报错**逐字等于** Proposal 记录的那两条路径。⇒ 该口径能取假，且修复后为 0。

**加密对照**（同一 harness、同为 30s，只有「写入者写哪里」这一个自变量；写入者 = pre-fix 的 mkdir/write/write/rm 序列跑满密度）：

```
arm=checked-in duration=30s copies=179 failures=95  writer_cycles=130597
     50 cannot access '.../plugin/fixtures/workflow-replay/_race-probe': No such file or directory
     27 cannot stat   '.../plugin/fixtures/workflow-replay/_race-probe/expectations.json': ...
     10 cannot stat   '.../plugin/fixtures/workflow-replay/_race-probe': ...
arm=private    duration=30s copies=188 failures=0   writer_cycles=139433
```
两臂拷贝吞吐相同（179 vs 188），写入者频率相同（130k vs 139k cycles），失败数 95 vs 0。

### AC4 — 防回退判据（`plugin/scripts/checked-in-write-check.ts`）

判据在**解析后的目标路径**上判定（硬规则 2），运行时半件 `checked-in-write-guard.cjs` 经 `node --require` 拦截 `node:fs` / `node:fs.promises` 的写动词；`checked-in-write-run.cjs` 逐个 import 输入并记录其模块求值是否完成。**这不是一个源码扫描器**：先做的源码扫描原型在真值为 0 的树上报出 605 条「违例」（几乎全是词法 bug——从字符串字面量里抓标识符），已弃用而非调参。

三态各一条真实输出（含退出码）：

```
1) 注入夹具（在 plugin/fixtures/ 下 mkdir）⇒ 红, exit 1
FAIL: 3 write(s) into the checked-in tree across 1 input(s): mkdirSync -> .../plugin/fixtures/workflow-replay/_injection-probe; writeFileSync -> .../_injection-probe/events.jsonl; rmSync -> .../_injection-probe
      at file:///tmp/injectarm/inject.test.mjs:6:4

2) 未注入（修复后的真文件）⇒ 绿, exit 0
PASS: no checked-in-tree writes: 16 write-verb call(s) across 1 executed input(s), 0 inside the tree

3a) 输入读不懂（扫描目录不存在）⇒ 独立取值, exit 3
NOT-EVALUATED: no input files matched under .../plugin/test/nope — nothing was judged

3b) 输入读不懂（模块求值未完成）⇒ 独立取值, exit 3
NOT-EVALUATED: 1/1 input(s) did not finish evaluation — a file that never loaded performs no writes, which is UNREAD, not clean: /tmp/neverload/broken.test.mjs (Cannot find module '/tmp/neverload/does-not-exist-xyz.mjs' imported from /tmp/neverload/broken.test.mjs)

4) 同判据跑修复前的真文件 ⇒ 红, exit 1（检测未被判定面修改削弱）
  mkdirSync(.../plugin/fixtures/workflow-replay/_tmp-bad-schema) -> .../_tmp-bad-schema
  writeFileSync(.../_tmp-bad-schema/events.jsonl) -> ...
  rmSync(.../_tmp-bad-schema) -> ...
```

判据自身由 `plugin/test/checked-in-write-check.test.mjs` 钉住（**8 臂**：红 / 绿 / 绿-空操作 / 绿-symlink 出树 / 红-symlink 进树 / 两项未评估 / 在本仓库上绿）：`ℹ tests 8 / ℹ pass 8 / ℹ fail 0`。

**判据自身被扫出并修掉的两类误报**（面扫的副产品；硬规则 5b 的「兄弟实例」这回长在判据自己身上）：

① **判「调用」而非判「事件」**：`createGoalStore() -> fs.mkdirSync(<repo>/goals, {recursive:true})` 是对**已存在**目录的空操作，却被报成在已签入树里建条目（一条名字叫正控制、实际只读的用例）。修法：读调用的**结果**——`mkdir/mkdirSync` 带 `recursive:true` 返回 `undefined` 即未创建（返回字符串＝创建了首个目录）；`rm/rmSync` 带 `force:true` 且调用前目标不存在即未删除（用 `lstatSync` 判在否，不用会跟随符号链接的 `existsSync`）；回调形态结果不可见 ⇒ 保守上报。新增一条绿臂钉住。

② **路径解析跟随了末段符号链接**：`symlinkSync(<tree>/plugin/scripts/f, <scratch>/plugin/scripts/f)`——在**临时工作区**里建一个指向仓库的链接、仓库本身分毫未动——被 `realpathSync` 解析成仓库路径而报红。实测**单个文件 121 条**（`plugin/test/fan-in-execute-paths.test.mjs`，它的正当模式就是把仓库的 plugin/scripts 链进临时 worktree）。修法：判定**「这个名字被放在哪里」**——从 `dirname(target)` 起解析**最近的存在祖先**、末段保持字面量；这样「链出去」不报，而「经由指向树内的父目录写进去」照样能抓。违反报告现在同时打印**落点**与**所命名路径**（二者不同时并排显示），因为落点才是可行动的事实。

**一处必须记下的既有盲区（本判据补上的正是它）**：仓库已有的静态规则 `test-isolation-check` 的 R1（`path.join(__dirname, ... ".tmp…")`）**看不见本次的施害者**。证据三条：①`plugin/test/workflow-replay.test.mjs` 不在 `plugin/test-isolation-violations.txt` 的 123 行基线里（`grep workflow-replay` 零命中）；②同一规则在同一次扫描里对**直接字面量**形状报了 12 条 `fixed-path-write`（`packages/quay-native/test/*` 的 `.tmp-*`），说明 `plugin/test/**` 确在扫描面内、本文件确被扫过而未被判出；③原因是结构性的：施害者写的是 `path.join(FIXTURES_DIR, "_tmp-bad-schema")`，`__dirname` 在**另一个表达式、另一行**（`:11` 定义 `FIXTURES_DIR`）里，且字面量是 `_tmp-`（下划线）而非 `.tmp`。这正是该文件自己已记录过两次的同型盲区（R7 的立条理由逐字如此）。**⇒ 结论：路径表达式形状的静态谓词看不见经由间接层构造的路径；运行时判据按构造看得见。**

### AC5 — 原语义不回退

```
ℹ tests 21
ℹ suites 16
ℹ pass 21
ℹ fail 0
```

### Plan 第 4 步 — 能力清单登记

`bash plugin/scripts/capability-catalog.sh --summary` ⇒ 落地时 **304 → 305**（+1 已确认；`git ls-tree HEAD plugin/scripts/` 计 304）；合并 develop 后为 **306**（develop 侧另 +1，非本任务产物，不认领）。`--json` 中本条的六个字段（question / cadence=按需 / invalidation / last_reaffirmed=2026-09-11 / matching=position / consumer）均已声明——**consumer 是被 scoped 门逼出来的**，见下。

### 落地与门

- 本分支 vs develop：**7 个文件**（3 个新增判据半件 + 1 个新增判据自测 + `workflow-replay.test.mjs` + 能力清单 + 任务体）。
- ⛔ `test/cold-start-oneliner-e2e.sh` 未被本任务改动：`git diff --name-only $(git merge-base HEAD develop)..HEAD -- test/cold-start-oneliner-e2e.sh` = **0 行**（DoD 第 3 条）。
- 不变式写进代码注释 **3 处**（`grep -l INVARIANT`）：`plugin/scripts/checked-in-write-guard.cjs`、`plugin/scripts/checked-in-write-check.ts`、`plugin/test/workflow-replay.test.mjs` —— 即「判据本体」「判据入口」「被修的那个测试」。另两个半件（`checked-in-write-run.cjs`、判据自测）不含该行；Evidence 不把它说成 5 处。
- anti-drift（fan-in 硬失败步）在本工作树实跑：`ANTI-DRIFT OK: task gap-fixture-dir-write-races-whole-tree-copy — 7 actual file(s), all within declared Touches (7 glob(s))`。
- scoped 门：`bash scripts/test.sh --for-task gap-fixture-dir-write-races-whole-tree-copy --allow-thin` ⇒ `SCOPED_EXIT=0`（`ℹ tests 45 / ℹ pass 45 / ℹ fail 0`）。**该门共红了两次，两次都是本任务自己的产物**：①`test-isolation-check` 报新增测试文件 `mkdtemp-no-cleanup`——判据自己泄漏临时目录，正是它自己所判的那条规则 ⇒ 改 `t.after` 注册清理，并让判据自身清理其 scratch 日志目录；②`rhythm-consumer-check` 判据2 报 `checked-in-write-check.ts: 按需 without a CONSUMER row — 「按需」=「无人」, no presser declared` ⇒ 补 CONSUMER 行声明谁按、什么条件按。**第 ② 条是能力清单自己的入口闸查不出来的**（它只要求 question/cadence/invalidation/last-reaffirmed/matching 五个字段）——「一个按需跑的检查若没人按，等于没有」这条只有 rhythm 检查看得见。
- 面扫（硬规则 5b）**部分完成，不作完备性主张**：修复后的判据在 6 路并行、840s 预算内实测覆盖 `plugin/test/**` 的 **67/320** 个 `*.test.mjs`（子进程 guard 日志计数：`evaluated=67`、`violations=0`、`evaluationFailed=0`）；预算到时未扫完的部分**不**等于「无违例」。面扫此前抓到的两条都是判据自身的误报（见 AC4 末段），修完复扫 0 条真违例——但复扫覆盖率同样只有 67/320。
- 一句题外观察（**未验证、不在本任务范围、不立前置**，硬规则 12）：同一「整树拷贝撞并发写者」形状在 `refresh-worktree-quay` 复制 `.quay/` 时也出现——scoped 门自己的输出里有 `cp: cannot stat '/home/yale/work/quay/.quay/fan-in-suite-*.log': No such file or directory`。写者是 driver 而非测试、载体是 gitignored 的运行时状态，危害未测 ⇒ 只记观察。

### 续做轮（2026-09-11）：阻断 fan-in 的套件红 —— 诊断并修复，随后发现 develop 已独立落地同一修法（合并取 develop 的超集）

本任务前两轮 fan-in 均以**同一条**套件红 exit-not-landed，而该红**不在本任务 delta 内**：

```
test at plugin/test/packaging-hygiene-check.test.mjs:148:1
✖ runPackagingHygiene drift ⇒ failed + gap-filing spawned (AC3)
  AssertionError [ERR_ASSERTION]: drift must trigger gap-filing
      at .../plugin/test/packaging-hygiene-check.test.mjs:161:10
```

**成因（判别性对照，不是解释）**：该用例调 `runPackagingHygiene` 时漏传 `resourceGateArgv` ⇒ 内部
`resourceGateCheck` 回落 `resolveResourceGateScript()`，跑**真实宿主**的 `plugin/scripts/resource-gate.sh
--for full-suite --json`。该闸自 `d640b8e1b` 起带 load 判据（`load >= nproc × LOAD_OVER_FACTOR`，默认 2
⇒ WAIT）⇒ 全量 suite 26 路并发把 load 推过阈值 ⇒ `gate.go=false` ⇒ `gapFiled` **按设计**为 false
（fail-closed 推迟 spawn，**产品代码没错，错的是单测没注入已有的测试缝**）⇒ 断言恒红。
失败因此是**宿主负载的函数**：隔离跑绿、套件内红。

复现（一条命令，把闸强制推进 WAIT 带；此臂为**修复前**）：

```
$ RESOURCE_GATE_LOAD_OVER_FACTOR=0.01 node --test plugin/test/packaging-hygiene-check.test.mjs
✖ runPackagingHygiene drift ⇒ failed + gap-filing spawned (AC3)
  AssertionError [ERR_ASSERTION]: drift must trigger gap-filing
      at .../plugin/test/packaging-hygiene-check.test.mjs:161:10   ← 与 suite 日志同一行、逐字同句
ℹ tests 9 / ℹ pass 8 / ℹ fail 1
```

⇒ 成因被**独立复现**（同一断言原文、同一行号），不是「大概是环境抖动」。修复前该文件**不在**
`known-load-sensitive` 注册表内（`grep packaging-hygiene plugin/scripts/known-load-sensitive.ts` 零命中）
——它是确定性问题，注册表绕过不是正解。

**5b 枚举**（先数同族，不只修被报出来的那一个）：

```
$ for f in $(grep -rln 'gapWorkerCmd|runPackagingHygiene' --include=*.mjs plugin/test packages/*/test); do
    echo "$f calls=$(grep -c gapWorkerCmd $f) seams=$(grep -c resourceGateArgv $f)"; done
goal-triage-fresh-draft-not-retire.test.mjs  calls=1  seams=1
goal-driver.test.mjs                         calls=10 seams=7   ← 3 处差：1 处 halted 短路 + 2 处断言消息字符串，均非调用
packaging-hygiene-check.test.mjs             calls=2  seams=0   ← 唯一例外（本处）
goal-sufficiency-gate.test.mjs               calls=1  seams=1
goal-sufficiency-not-evaluated.test.mjs      calls=1  seams=1
goal-triage.test.mjs                         calls=2  seams=2
goal-sufficiency-semantic-covered.test.mjs   calls=1  seams=1
goal-triage-activate-executed.test.mjs       calls=3  seams=3
goal-posture-blocks-activate.test.mjs        calls=1  seams=1
```

**全仓库恰一个文件漏缝**，即本文件；其另一处调用是 `halted: true` 短路（按设计不触闸）。
同位素入口 `runPoolQualityJudge`（`plugin/test/quality-gate-driver.test.mjs`）走**位置参数** `gateArgv`，
6 处可达闸的调用全部注入 fake GO 脚本 ⇒ **不同族**。

**我据此修了**（补缝 `resourceGateArgv: ['true']` + 一条 WAIT 负控制，提交 `627f3739d`），并做双向取假：
把两个缝各翻向反面 ⇒ 两条断言各自变红（`ℹ tests 10 / ℹ pass 8 / ℹ fail 2`）；还原后逐字节相同
（`diff` 空、打印 `RESTORED-IDENTICAL`），两臂全绿（含 `LOAD_OVER_FACTOR=0.01` 臂 `10/10`）。

**⚠️ 合并 develop 时发现 develop 已独立落地同一修法**（提交 `25f8cf6dd`
「test(packaging-hygiene): inject the resource-gate seam — the AC3 case ran the REAL gate」，落于 `10:49Z`，
早于本轮），且是**严格超集**：同样的缝、同形状的 WAIT 负控制，并多一条
`assert.equal(fact.value.gapExitCode, null)`，注释还点名了同族任务
`gap-resource-gate-psi-does-not-capture-load-flake-driver`。

⇒ 冲突按「代码文件取**语义并集**」解析，**而 develop 侧恰好就是该并集**，故取 develop 版本：

```
$ diff <(git show develop:plugin/test/packaging-hygiene-check.test.mjs) plugin/test/packaging-hygiene-check.test.mjs
[空]  ⇒ FILE-NOW-IDENTICAL-TO-DEVELOP
$ git diff --name-only develop...HEAD
plugin/scripts/capability-catalog.sh
plugin/scripts/checked-in-write-check.ts
plugin/scripts/checked-in-write-guard.cjs
plugin/scripts/checked-in-write-run.cjs
plugin/test/checked-in-write-check.test.mjs
plugin/test/workflow-replay.test.mjs
tasks/gap-fixture-dir-write-races-whole-tree-copy.md
```

⇒ **本任务 delta 仍是 7 个文件**（该测试文件**不再**在 delta 内），Touches **不**增列该路径
（本轮曾误列一次，已撤回；撤回后 anti-drift 实跑见上「落地与门」）。
**本续做轮未改动任何 AC 判据、未翻任何复选框**——它诊断并解除了阻断本任务两轮的套件红，
而最终生效的修法归 develop，不归本任务。

**一条同轮观察（不立前置，硬规则 12）**：`quay-native task edit` **没有** `--body-file`（只有 `--body`）——
该标志只有 `adr`/`doc` 子命令才有（`quay-native.ts:203` / `:239`）。我第一次用 `--body-file` 时它被**静默忽略**，
而 CLI 仍打印 `updated <id>` 并把**同名内容**重新写了一遍（mtime 变、`git diff` 空）⇒
**「成功」的外形与「什么都没做」同形**（硬规则 3b）。改用 argv 传正文并**回读核对**后才真正落地。
证据：`grep -n 'body-file' quay-native.ts` 的命中全在 `adr`/`doc` 分支内，`task edit` 分支（`:409-452`）只认 `--body`。

## Touches

- plugin/test/workflow-replay.test.mjs
- plugin/scripts/checked-in-write-check.ts
- plugin/scripts/checked-in-write-guard.cjs
- plugin/scripts/checked-in-write-run.cjs
- plugin/scripts/capability-catalog.sh
- plugin/test/checked-in-write-check.test.mjs
- tasks/gap-fixture-dir-write-races-whole-tree-copy.md
