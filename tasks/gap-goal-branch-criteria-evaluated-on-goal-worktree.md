---
id: gap-goal-branch-criteria-evaluated-on-goal-worktree
title: branch-mode goal 的判据在 detached 判据 worktree 上求值——否则 goal 代码只在 goal 分支上时永远判不过（B1）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-branch-gate-event-evaluation-root
  - gap-goal-branch-data-model-and-lifecycle
goal_ac: AC-324
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §5 B1，裁定⑩㉒）：AC 判据的 cwd 恒为主检出的 git root（`packages/quay/src/goal-store.ts:1789` 注释「Criterion cwd = the git root」，求值点 `:1799`、`:2069`、`:2450`）。主检出跟随 develop。goal 的代码只在 `goal/<id>` 上 ⇒ 判据看不到 ⇒ AC 永不 achieved ⇒ goal 永不并入——**死锁**。I5 复验（`:1789` 所在函数）同样在主检出上跑，会把 goal 分支上已达成的 AC 全报成失败并触发假 gap。

**修法（已裁定⑩）**：每个 branch-mode goal（active、分支存在、尚未并入）一个判据 worktree，路径取配置解析出的 worktree 基目录下的 `goal-<GOAL-NNN>`（⛔ 不在 /tmp；记录 realpath），**detached HEAD** 于 `goal/<id>` tip；每轮求值前 `git checkout --detach goal/<id>` 刷新，刷新与求值串行。该 goal 的 AC（含 I5 复验）以它为 cwd；**gate 事件仍追加到主 root 的账本**（evaluationRoot 记录 worktree）。goal-driver 负责创建、刷新、删除这个 worktree（裁定㉒）。并入后（分支不存在）回到主检出求值。

### 实现落点

- `packages/quay/src/goal-store.ts`：`goalCriterionWorktreeDir`（路径派生：`resolveWorktreeNamespace(root).dir` + `goal-<id>`）、`resolveCriterionRoot` / `buildCriterionRoots` / `criterionCwdFor`（按 AC 的 GOAL 选 cwd：branch-mode 且分支仍在 ⇒ worktree，否则主 root）。三个求值点接上：`gate` CLI（事件仍写主 root 账本，`payload.evaluationRoot` = 判据 cwd realpath）、I5 `checkAchievedFailing`、冻结域轮转 `sweepFrozen`。
- `plugin/scripts/goal-driver.ts`：`syncGoalCriterionWorktrees` 在 `runGoalRound` 的 pass 1 **之前**建/刷/删（刷新与求值串行）；处置读数进轮记录 `criterionWorktrees`（state ∈ created/refreshed/current/removed/no-branch/failed，⛔ 不折成布尔）。**detached，⛔ 不检出 `goal/<id>` 本身**。
- `plugin/scripts/driver-runtime.ts`：按 Layer 0 单一布局知识面再导出上述 Core 符号（goal-driver ⛔ 不写 Core 源码树字面量）。
- `plugin/test/goal-driver-criterion-worktree.test.mjs`（新增）：真 git 夹具 + 真 goal-store CLI 端到端。

## AC

- [x] 新增 `plugin/test/goal-driver-criterion-worktree.test.mjs`（临时仓库）：branch-mode goal 下一个判据为 `test -f only-on-goal-branch.txt` 的 AC，该文件只提交在 `goal/GOAL-901` 上 ⇒ 求值 pass，事件 `payload.evaluationRoot` = 判据 worktree 的 realpath，且事件写在主 root 的 `.quay/gate-events.jsonl` 而不是 worktree 里；同一判据挂在非 branch-mode goal 下 ⇒ 在主 root 求值并失败。
- [x] 同一测试文件覆盖 I5：branch-mode goal 并入前，一个已 achieved、依赖 goal 分支文件的 AC 不被报为 achieved-but-failing。
- [x] 同一测试文件覆盖刷新：goal 分支前进一个提交后，下一轮求值看到新提交（判据 worktree 的 HEAD 等于新 tip）。
- [x] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（goal-driver 不出现 task 写路径与本仓 fan-in 载体引用——DIR-131；注意注释里出现该类词也会被判红）。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 实测并记入 Evidence（§9.2 残留 5）：在临时仓库里把 `goal/GOAL-901` 检出到另一个 worktree 后执行 `git push . <sha>:refs/heads/goal/GOAL-901`，贴出是否被拒的输出——用以确认判据 worktree 必须 detached。
- [x] `bash scripts/test.sh --for-task gap-goal-branch-criteria-evaluated-on-goal-worktree` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## Evidence

### AC1 / AC2 / AC3 —— 新增用例三条全绿

```
$ node --test plugin/test/goal-driver-criterion-worktree.test.mjs
✔ AC1+AC2: branch-mode goal 的判据在判据 worktree（detached 于 goal/<id>）上求值并 pass，事件写在主 root 账本且 evaluationRoot=worktree realpath；同一判据挂在非 branch-mode goal 下在主 root 求值并失败；I5 不把 goal 分支上已达成的 AC 报成 achieved-but-failing (2253ms)
✔ AC3: goal 分支前进一个提交后，下一轮求值看到新提交（判据 worktree 的 HEAD == 新 tip，且只有新提交才满足的判据由 fail 转 pass） (3970ms)
✔ 判据 worktree 的路径由【配置解析出的】worktree 基目录派生：`loop.worktree_root` 缺失时回落到约定目录并留痕（⛔ 不静默） (96ms)
ℹ tests 3  ℹ pass 3  ℹ fail 0
```

夹具是**真 git 仓库**：`goal/GOAL-901` 上多一个 `only-on-goal-branch.txt` 提交；判据真假由「某个提交里有没有这个文件」直接决定（⛔ 不用 fixture 注入 seam 伪造读数）。判据 worktree 的 HEAD 另有**直接量**复核（`git -C <wt> rev-parse HEAD` == `git rev-parse goal/GOAL-901`），⛔ 不采信驱动自己的读数。

### AC4 —— DIR-131 边界检查

```
$ node --no-warnings --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts --json
{"ok":true,"notEvaluated":false,"target":"<worktree>/plugin/scripts/goal-driver.ts","violations":[]}
EXIT=0
```

### AC5 —— 取假（cp 备份 → 回退核心改动 → 红 → cp 恢复 → 绿）

备份：`cp packages/quay/src/goal-store.ts .quay/ac324-negative-control/goal-store.ts.bak`（⛔ 未用 `git checkout --`）。
回退：`resolveCriterionRoot` 的 `if (goal?.branch !== true || !isGoalId(id))` 临时改成 `if (true || …)`（即旧行为：cwd 恒为主检出）。

```
✖ AC1+AC2 … (2043ms)
  AssertionError: 实测={"id":"AC-901","goal":"GOAL-901","status":"active","verdict":"fail",
    "reason":"acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"}
✖ AC3: goal 分支前进一个提交后 … (3509ms)
  AssertionError: 第 2 轮：新提交带来了该文件 ⇒ 判据转绿（刷新真的对求值生效）
ℹ tests 3  ℹ pass 1  ℹ fail 2
```

（第三条——路径派生用例——不随这一处变异变红：它直接调 `goalCriterionWorktreeDir`，而该函数本次未被改动。如实记账，⛔ 不声称三条全红。）

恢复：`cp .quay/ac324-negative-control/goal-store.ts.bak packages/quay/src/goal-store.ts`

```
✔ AC1+AC2 … (2713ms)   ✔ AC3 … (5158ms)   ✔ 路径派生 … (147ms)
ℹ tests 3  ℹ pass 3  ℹ fail 0
```

### AC6 —— §9.2 残留 5：分支在别的 worktree 检出时 `git push .` 是否被拒（实测）

临时仓库：`main` 上 base，`goal/GOAL-901` 上 TIP，另造 TIP 的子提交 NEW。

```
TIP=b4001610271eed41fed35ac78e737e0821d5a548
NEW=bf490796f5839e14f6ab5e24ec31fb907d8400fe
config receive.denyCurrentBranch=(unset → 默认 refuse)
--- (a) goal/GOAL-901 【被另一个 worktree 检出】时：git push . NEW:refs/heads/goal/GOAL-901 ---
  | remote: error: refusing to update checked out branch: refs/heads/goal/GOAL-901
  |  ! [remote rejected] bf49079… -> goal/GOAL-901 (branch is currently checked out)
  | error: failed to push some refs to '.'
  exit=1
  goal/GOAL-901 现在是：b4001610271eed41fed35ac78e737e0821d5a548   ← 未被推进
--- (b) 同一分支，但 worktree 是 DETACHED 于 TIP（本设计采用的形态）---
  |    b400161..bf49079  bf49079… -> goal/GOAL-901
  exit=0
  goal/GOAL-901 现在是：bf490796f5839e14f6ab5e24ec31fb907d8400fe   ← 快进成功
```

**结论**：分支被检出在另一个 worktree 时 `git push .` **被拒**（`branch is currently checked out`，exit 1）⇒ 判据 worktree 必须 **detached**，否则 goal 分支自己的快进通道会被判据 worktree 堵死。这是设计选择的必要性实测，⛔ 不是风格偏好。

### AC7 —— scoped gate

```
$ bash scripts/test.sh --for-task gap-goal-branch-criteria-evaluated-on-goal-worktree
（selector exit 0 —— 非 thin）
ℹ tests 174  ℹ pass 174  ℹ fail 0     EXIT=0
```

被选中并执行的 9 个测试文件（`select-tests-for-touches.ts --paths-only`）：

```
packages/quay/test/adr-gate.test.mjs
packages/quay/test/adr-store.test.mjs
packages/quay/test/build-dist.test.mjs
packages/quay/test/cli-adr.test.mjs
packages/quay/test/goal-store.test.mjs
packages/quay/test/mcp-adr.test.mjs
packages/quay/test/npm-pack-e2e.test.mjs
plugin/test/goal-driver-criterion-worktree.test.mjs      ← 本任务新增
plugin/test/plugin-packaging.test.mjs
```

新增文件的 3 条用例在本次 scoped 运行中逐条出现（按**用例名**核对，⛔ 不按路径行）：

```
✔ AC1+AC2: branch-mode goal 的判据在判据 worktree（detached 于 goal/<id>）上求值并 pass … (1546ms)
✔ AC3: goal 分支前进一个提交后，下一轮求值看到新提交（判据 worktree 的 HEAD == 新 tip …） (2730ms)
✔ 判据 worktree 的路径由【配置解析出的】worktree 基目录派生 … (48ms)
```

scoped-gate cache 已写：`--write-scoped-gate-cache --task gap-goal-branch-criteria-evaluated-on-goal-worktree --develop-sha e6700da803ca121642dffe7194938f373a7957cf`
（`{"event":"scoped-gate-cache-written", …, "cacheFile":"/data/home/yale/work/quay/.quay/scoped-gate-cache.json"}`）。

## DoD

真实落地判据：goal 的代码只在 goal 分支上时，其 pre-merge AC 能在并入前被判为 pass，并在主账本留下带 worktree 求值根的事件。生产读数由 GOAL-028 的 AC-324 在第一个试点 goal 并入后取得。

## Touches

- packages/quay/src/goal-store.ts
- plugin/scripts/driver-runtime.ts
- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver-criterion-worktree.test.mjs
- tasks/gap-goal-branch-criteria-evaluated-on-goal-worktree.md
