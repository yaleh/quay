---
id: gap-goal-merge-leaks-empty-mkdtemp-parent-dirs
title: goal 并入只删临时 worktree 的 wt 子目录、不删 mkdtemp 父目录——/tmp 里留下 584 个空的
  goal-merge-GOAL-* 目录（测试 575、真实 9）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-325
---
## Proposal

**机制**（2026-10-06 实测）：`plugin/scripts/worker-fan-in.ts:2554` 的 `runGoalMergeFanIn` 用 `path.join(fs.mkdtempSync(path.join(os.tmpdir(), \`goal-merge-${goalId}-\`)), "wt")` 建并入用的临时 worktree——也就是说 `mkdtemp` 建出的是**父目录**，worktree 在它的 `wt` 子目录里。`finally` 段（`:2620` 起）只做 `git worktree remove --force <tmp>/wt` 与 `fs.rmSync(<tmp>/wt)`，**从不删那个 mkdtemp 父目录**，于是每次并入（成功或失败）都留下一个空目录 `/tmp/goal-merge-GOAL-NNN-XXXXXX`。

**生产读数**（2026-10-06，`/tmp`）：`/tmp/goal-merge-GOAL-*` 共 584 个，**全部为空**（`find /tmp -maxdepth 1 -name 'goal-merge-GOAL-*' -empty` = 584）。其中 GOAL-901 575 个（单元测试夹具跑出来的），GOAL-905 6 个、GOAL-904 3 个（真实并入尝试，与本会话里 6+3 次并入请求一一对应）。每个 4 KB，占用空间可以忽略；但 `/tmp` 目录本身已有约 3.6 万个子目录（目录文件约 3.3 MB），这批空目录是其中的一部分，并且会把真正的泄漏淹没（同一天里根分区因 `/tmp` 写满而让并入红了两次，排查时要在一堆无害的空目录里找大头）。

**修法（方向，实现者可调）**：`finally` 里在 worktree 移除之后删掉 mkdtemp 父目录（`path.dirname(tmpWorktree)`，用 `fs.rmSync(..., { recursive: true, force: true })`，best-effort 同现有写法）；⛔ 不要去删 `os.tmpdir()` 本身或任何不是由本函数 mkdtemp 出来的路径——删之前先确认父目录的 basename 以 `goal-merge-` 开头。跑 `runGoalMergeFanIn` 的测试同样不得留下目录（给测试一个独占的 `TMPDIR`，结束时断言其中没有 `goal-merge-*`）。

**实际落地**：`tmpWorktreeParent` 记下 mkdtemp 的父目录（`worker-fan-in.ts:2558`），`finally` 在移除 worktree 之后再删它，删之前核两条——`path.basename(tmpWorktreeParent).startsWith("goal-merge-")` ∧ `path.dirname(tmpWorktree) === tmpWorktreeParent`。

## AC

- [x] `plugin/test/worker-driver.test.mjs` 的 goal 并入端到端用例改用独占的临时 `TMPDIR`，新增断言：成功并入之后、以及一次 suite 红的并入之后，该 `TMPDIR` 里都没有任何 `goal-merge-*` 条目。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 同一用例新增一条安全断言：函数不会删除不属于它的目录——在 `TMPDIR` 里预先放一个名为 `keep-me` 的目录，两次并入之后它仍在。
- [x] 5b 邻近扫描：`grep -rnE 'mkdtempSync' plugin/scripts/*.ts packages/quay/src/*.ts | grep -v test` 里凡是「mkdtemp 出父目录、只清理其子路径」的同形写法逐个列出（命中数与前 3 条贴进 Evidence），判断是否同样泄漏；在 Touches 内的一并修，其余在 Evidence 写明理由。
- [x] `node --test plugin/test/worker-driver.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，每次 goal 并入（无论成败）不再在 `/tmp` 留下 `goal-merge-GOAL-*` 目录；单元测试也不再留。现存的 584 个空目录是一次性清理，`/tmp` 是共享的，不属于本任务的 AC——需要时由人在确认后执行 `find /tmp -maxdepth 1 -name 'goal-merge-GOAL-*' -empty -delete`（只删空目录）。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-goal-merge-leaks-empty-mkdtemp-parent-dirs.md

## Evidence

分支 `task/gap-goal-merge-leaks-empty-mkdtemp-parent-dirs` @ `71469adf8`（+ merge develop `11309d8e9`）。

**AC1 / AC3（泄漏判据 + `keep-me` 安全断言）** — 新助手 `withExclusiveTmpdir()` / `goalMergeEntriesIn()`：`os.tmpdir()` 在 POSIX 每次调用重读 `process.env.TMPDIR`（本机 Node v24.21.0 实测 `before: /tmp` → `after: /tmp/exclusive-probe-xyz`），所以并入内部 mkdtemp 出的父目录落进独占 TMPDIR，可被直接数。绿臂（`goal-merge e2e — green suite…`）断言「成功并入后 TMPDIR 里不得残留任何 `goal-merge-*` 条目」；红臂（`goal-merge e2e — red suite…`，一红一绿两次并入）在 suite 红的并入之后、以及重试落地之后再断言一次，并预置 `keep-me` 断言两次并入后它仍在。

**AC2（取假）** — `cp` 备份 `plugin/scripts/worker-fan-in.ts`（md5 `68bca36f2339d60d47b0d5ce3d68efa1`）→ 删掉 `finally` 里那段删父目录的代码 → 实跑：

```
✖ goal-merge e2e — green suite: … (161.659284ms)
  AssertionError [ERR_ASSERTION]: 成功并入后独占 TMPDIR 里不得残留任何 goal-merge-* 条目
  + actual - expected
  + [ 'goal-merge-GOAL-901-szsbuv' ]
  - []
      at plugin/test/worker-driver.test.mjs:3896:14
✖ goal-merge e2e — red suite: … (117.653694ms)
  AssertionError [ERR_ASSERTION]: suite 红的并入之后独占 TMPDIR 里不得残留任何 goal-merge-* 条目
ℹ tests 5  ℹ pass 3  ℹ fail 2
```

`cp` 恢复（md5 与备份一致 `68bca36f2339d60d47b0d5ce3d68efa1`）后同一条命令：

```
✔ goal-merge e2e — green suite: …  ✔ goal-merge e2e — red suite: …
✔ goal-merge e2e — GOAL-028's AC-325 and AC-327 …  ✔ goal-merge e2e — 临时验证 worktree 被装配依赖…
✔ goal-merge e2e — 失败分类两臂…
ℹ tests 5  ℹ pass 5  ℹ fail 0
```

**AC4（5b 邻近扫描）** — 精确命令 `grep -rnE 'mkdtempSync' plugin/scripts/*.ts packages/quay/src/*.ts | grep -v test` 命中 **30** 条，前 3 条：

```
plugin/scripts/config-wiring-check.ts:634:  const vrGreenDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-wiring-verify-green-"));
plugin/scripts/config-wiring-check.ts:654:  const vrRedDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-wiring-verify-red-"));
plugin/scripts/checker-mutation-check.ts:487:      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "cmc-case-"));
```

把扫描面扩到全部 **83** 个 mkdtempSync 站点（不设上面那条 `grep -v test` 过滤——它会把大量含 `selftest` 的行滤掉），逐个判「mkdtemp 结果是容器、清理够不够得着父目录」：

- 「结果是容器（其下有 `path.join(<var>, …)` 子路径）」共 **32** 处：**30** 处把结果绑给变量并 `rmSync` 该变量本身（`checked-in-write-check.ts:279`→`rmSync(logDir)` @328；`config-wiring-check.ts:634/654`→@648/@679；`quay-init-closure-assertion.ts:119/220`→@154/@260；`quay-init-closure-ratchet.ts:190`→@217；`suite-fs-trace.ts:94`→@131；`checker-mutation-check.ts:487`→@505；`arch-coverage-report.ts:805`、`import-graph-check.ts:585/742`、`it0-split-or-commit-check.ts:497`、`malformed-task-check.ts:115`、`sh-census-check.ts:836`、`stage-receipt.ts:679`、`suite-slot-ssot-check.ts:295/329`、`tick-core-static-check.ts:662`、`test-group-downgrade-check.ts:392`、`test-impl-census-check.ts:169`、`workflow-baseline-metrics.ts:1043`、`workflow-journal.ts:477`）⇒ **不泄漏**；
- **1** 处 `run-identity.ts:451`（`driftDir = mkdtempSync(path.join(fixtureDir, "drift-"))`）自身没被 rm，但它是被递归删掉的祖先 `fixtureDir`（`:382` 建、`:468` `rmSync(fixtureDir, {recursive:true})`）的**子目录** ⇒ **不泄漏**（形态恰好相反：容器套容器，删的是最外层那个）；
- **1** 处是探测器在字符串字面量里的误命中（`test-isolation-check.ts:1245` 的 selftest 样本 `r7Workspace`），非真实站点。
- 其余站点 mkdtemp 结果**就是**被操作的对象本身、且 `rmSync` 它自己（`external-dogfooding-check.ts:247`、`profiles-role-coverage-check.ts:181`、`full-suite-runner.ts:3365/3430/3487`、`integration-batch-merge.ts:1054`（`git worktree remove --force tmpWt` + `rmSync(tmpWt)`）、`release-reading-sandbox.ts:131`（`rmSync(sb.dir)`））⇒ 不泄漏。

⇒ 该形状在扫描面内**只有 `worker-fan-in.ts:2554` 一处真泄漏**：mkdtemp 结果被**内联**进 `path.join(…, "wt")`，父目录从未绑给任何变量 ⇒ 任何清理都够不着它。已在 Touches 内一并修掉（修复后 `tmpWorktreeParent` 绑定 + `rmSync(tmpWorktreeParent)`）。其余同形站点不在 Touches 内且**经核实均不泄漏**，故未改动。

**AC5** — `node --test plugin/test/worker-driver.test.mjs`：`ℹ tests 121  ℹ pass 121  ℹ fail 0`，**exit 0**。

**生产载体读数（DoD 落地判据的直接量，不是夹具回声）** — 完整跑一遍 `worker-driver.test.mjs`（含 5 条真实调用生产 `runGoalMergeFanIn` 的 e2e，其中 3 条走**环境 `/tmp`**）前后数真实 `/tmp`：`find /tmp -maxdepth 1 -name 'goal-merge-GOAL-*' | wc -l` = **595 → 595（delta 0）**，全部为空。修前同一动作每次并会增加 1（单元测试每次跑 5 条并入，任务体记录的 575 个 GOAL-901 空目录就是这么来的）。

**scoped 门内既有仪器**：`tmp-leak-pairing-check — 936 file(s), 0 unpaired mkdtemp result(s). PASS.`、`test-isolation-check … mkdtemp-no-cleanup=0`。⚠️ 那个既有机件只扫**测试文件**，所以本类**生产侧**站点它结构上看不见——本任务的断言直接把「并入跑完后 TMPDIR 里还剩什么」当读数，补的正是这一段。
