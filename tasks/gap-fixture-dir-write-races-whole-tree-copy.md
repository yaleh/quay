---
id: gap-fixture-dir-write-races-whole-tree-copy
title: 测试往已签入的 fixtures 目录里建/删临时目录 —— 与任何整树拷贝并发即产生假红
status: ready
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

判据自身由 `plugin/test/checked-in-write-check.test.mjs` 钉住（6 臂：红 / 绿 / 绿-空操作 / 两项未评估 / 在本仓库上绿）：`ℹ tests 6 / ℹ pass 6 / ℹ fail 0`。

**一处必须记下的既有盲区（本判据补上的正是它）**：仓库已有的静态规则 `test-isolation-check` 的 R1（`path.join(__dirname, ... ".tmp…")`）**看不见本次的施害者**。证据三条：①`plugin/test/workflow-replay.test.mjs` 不在 `plugin/test-isolation-violations.txt` 的 123 行基线里（`grep workflow-replay` 零命中）；②同一规则在同一次扫描里对**直接字面量**形状报了 12 条 `fixed-path-write`（`packages/quay-native/test/*` 的 `.tmp-*`），说明 `plugin/test/**` 确在扫描面内、本文件确被扫过而未被判出；③原因是结构性的是：施害者写的是 `path.join(FIXTURES_DIR, "_tmp-bad-schema")`，`__dirname` 在**另一个表达式、另一行**（`:11` 定义 `FIXTURES_DIR`）里，且字面量是 `_tmp-`（下划线）而非 `.tmp`。这正是该文件自己已记录过两次的同型盲区（R7 的立条理由逐字如此）。**⇒ 结论：路径表达式形状的静态谓词看不见经由间接层构造的路径；运行时判据按构造看得见。**

### AC5 — 原语义不回退

```
ℹ tests 21
ℹ suites 16
ℹ pass 21
ℹ fail 0
```

### Plan 第 4 步 — 能力清单登记

`bash plugin/scripts/capability-catalog.sh --summary` ⇒ `capability-catalog: 305 scripts | 305 declared | 0 unclassified | 300 ship`；同命令在工作树 HEAD 之前为 **304**，本次 **+1** 已确认（`git ls-tree HEAD plugin/scripts/` 计 304）。`--json` 中本条的五个字段（question / cadence=按需 / invalidation / last_reaffirmed=2026-09-11 / matching=position）均已声明，入口闸通过。

### 落地与门

- 本分支 vs develop：6 个文件（`git diff --stat $(git merge-base HEAD develop)..HEAD`）——3 个新增判据半件 + 1 个新增测试 + `workflow-replay.test.mjs` + 能力清单。
- ⛔ `test/cold-start-oneliner-e2e.sh` 未被本任务改动：`git diff --name-only $(git merge-base HEAD develop)..HEAD -- test/cold-start-oneliner-e2e.sh` = **0 行**（DoD 第 3 条）。
- 不变式写进代码注释 5 处：guard 头、run 头、check 头、两个测试文件头。
- scoped 门：`bash scripts/test.sh --for-task gap-fixture-dir-write-races-whole-tree-copy --allow-thin` ⇒ `SCOPED_EXIT=0`（首轮曾红：`test-isolation-check` 报本任务新增测试文件 `mkdtemp-no-cleanup` —— 判据自己泄漏临时目录，即它自己所判的那条规则；已改为 `t.after` 注册清理，并让判据自身递归清理其 scratch 日志目录）。
- 面扫（硬规则 5b）**部分完成，不作完备性主张**：修复后的判据在 6 路并行下扫描 `plugin/test/**` 中的 **N/305**（读数随本轮实测填入下方；未扫完的部分**不**等于「无违例」）。首轮串行扫描（60/305）命中的唯一一条是 `createGoalStore() -> fs.mkdirSync(<repo>/goals, {recursive:true})` 的**空操作**误报（该目录已存在，`mkdirSync` 未创建任何条目），已由「判事件而非判调用」的修法排除，并新增一条绿臂钉住。

## Touches

- plugin/test/workflow-replay.test.mjs
- plugin/scripts/checked-in-write-check.ts
- plugin/scripts/checked-in-write-guard.cjs
- plugin/scripts/checked-in-write-run.cjs
- plugin/scripts/capability-catalog.sh
- plugin/test/checked-in-write-check.test.mjs
- tasks/gap-fixture-dir-write-races-whole-tree-copy.md
