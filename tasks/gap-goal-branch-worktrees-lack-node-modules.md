---
id: gap-goal-branch-worktrees-lack-node-modules
title: goal 分支的判据/预览 worktree 与并入临时 worktree 都是裸 git worktree add 建的、没有
  node_modules——预览 serve 起不来、并入时 pre-merge-commit 钩子找不到 yaml 而中止（GOAL-904 演练读到）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-criterion-worktree-registered-check-blind-to-symlinked-root
goal_ac: AC-325
---
## Proposal

**机制**（2026-10-04 在 GOAL-904 合并演练中读到，两处生产直接量，同一根因）：goal 分支的三类 worktree 都是裸 `git worktree add` 建的，没有任务 worktree 经 `plugin/scripts/dispatch-worktree-setup.sh` 得到的装配（把主检出的 `node_modules` 符号链接进去，零拷贝）。仓库根没有自己的依赖（`yaml` 等），任何在该 worktree 里跑 node 的东西都 `ERR_MODULE_NOT_FOUND`。

1. **判据 worktree / 预览 worktree**（`plugin/scripts/goal-driver.ts` `ensureGoalCriterionWorktree`，`goalCriterionWorktreeDir`）：`quay goal preview GOAL-904 start` 起的 serve 读 `quay-worktrees/goal-GOAL-904/.quay/preview-serve.log` 逐字：`Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'yaml' imported from …/goal-GOAL-904/packages/quay/src/config.ts`，`quay goal preview … start` 因此 30 秒超时失败。手工 `ln -s <主检出>/node_modules <worktree>/node_modules` 后预览立即起来。
2. **并入用的临时 worktree**（`plugin/scripts/worker-fan-in.ts` `runGoalMergeFanIn`，`mkdtemp` 下的 `wt`）：`goal-merge-result` 事件（GOAL-904，2026-10-03T17:52:40Z）逐字：`Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'yaml' imported from /tmp/goal-merge-GOAL-904-EMKfuu/wt/plugin/scripts/task-schema.ts … Not committing merge; use 'git commit' to complete the merge.`——`git merge --no-ff` 触发的 pre-merge-commit 钩子在没有依赖的 worktree 里崩了，合并被中止。

**修法（方向，实现者可调）**：三类 worktree 在创建（和刷新）时都经**同一处**装配依赖：主检出有 `node_modules` 就符号链接，没有则不建链并如实读出（⛔ 不抛、⛔ 不伪装成成功）。⚠️ 约束：`dispatch-worktree-setup.sh` 会拒绝非 `task/<id>` 分支（detached 的 goal worktree 会被拒），不能原样调用；sh-census 棘轮零余量，改该 .sh 须行数中性；goal-driver 受 DIR-131 约束（不得引用本仓落地载体，注释里出现 fan-in 字样也会被判红）。优先把「符号链接 node_modules」抽成一个被复用的小函数，⛔ 不要在 goal-driver 与 worker-fan-in 各抄一份。

**落地（本任务）**：单一实现 `ensureWorktreeNodeModules(mainRoot, worktreeRoot)` 落在 Core `packages/quay/src/goal-preview.ts`（该模块已是「预览/判据 worktree」的叶子），经 `driver-runtime.ts`（Layer 0 Core 导入面）再导出（goal-driver ⛔ 不直接拼 Core 源码树字面量）；读数是枚举 `linked | present | source-absent | failed`，⛔ 不抛、⛔ 不折成布尔。调用点：goal-driver 的判据/预览 worktree（建/刷/沿用 current 三态都处置），worker-fan-in 的 goal 并入临时 worktree。`CriterionWorktreeReading` 新增 `nodeModules` 读数（null = 本轮没走到处置，⛔ 与 source-absent 不同形，硬规则 3b）。

<!-- dedup-ref -->相关但机制不同：`gap-goal-branch-criteria-evaluated-on-goal-worktree`（done）与`gap-goal-branch-preview-instance`（done）建立了这些 worktree 与预览，本任务补它们的依赖装配；`gap-goal-criterion-worktree-registered-check-blind-to-symlinked-root` 修的是同一函数里的「已登记」判定，两者改同一个文件，故本任务排在它之后。

## AC

- [x] `plugin/test/goal-driver-criterion-worktree.test.mjs` 新增用例（临时仓库，主检出建一个 `node_modules` 目录）：判据 worktree 创建后与刷新后，`<worktree>/node_modules` 存在且 realpath 等于主检出 `node_modules` 的 realpath；已存在时再次处置不报错、不改动；主检出没有 `node_modules` 时不建链、处置读数如实说明、不抛。
- [x] `plugin/test/worker-driver.test.mjs` 的 goal-merge e2e 新增用例（临时仓库，主检出建 `node_modules` 目录，并给仓库装一个 `pre-merge-commit` 钩子：当前目录没有 `node_modules` 就非 0 退出）：并入执行的结果是 `landed`，develop 上出现 subject 形如 `merge: goal/GOAL-901 into develop (request …)` 的合并提交。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 5b 邻近扫描：在 `plugin/scripts/` 与 `packages/quay/src/` 内 grep 其它裸 `git worktree add` 的调用点（goal 分支以外的也列出），把命中数与前 3 条贴进 Evidence，逐条判断是否同样需要依赖装配；需要且在 Touches 内的一并改，其余在 Evidence 写明理由。
- [x] `node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts` 退出 0（DIR-131：goal-driver 不出现 task 写路径与本仓 fan-in 载体引用；⚠️ 注释里出现该类字样也会被判红）。
- [x] `node --test plugin/test/goal-driver-criterion-worktree.test.mjs` 与 `node --test plugin/test/worker-driver.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，对一个 branch-mode goal 执行 `quay goal preview <GOAL> start` 不再需要任何手工装配就能起来，且 `quay goal merge` 触发的并入不再因缺依赖被钩子中止。生产读数由 GOAL-028 的 AC-325/AC-328 在一次真实的 goal 并入与预览之后取得；本任务落地时 GOAL-904 的并入请求仍卡在上一次的红（见 `gap-goal-merge-infra-red-mislabelled-and-rerequest-never-retries`），需人再发一次请求。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/scripts/worker-fan-in.ts
- plugin/scripts/driver-runtime.ts
- packages/quay/src/goal-preview.ts
- plugin/test/goal-driver-criterion-worktree.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/gap-goal-branch-worktrees-lack-node-modules.md

## Evidence

### AC1/AC6a — `node --test plugin/test/goal-driver-criterion-worktree.test.mjs`（8 pass / 0 fail）

新增两条用例（`AC-nm`、`AC-nm-absent`）：

```
✔ AC-nm: 判据 worktree 建/刷时装配 node_modules（符号链接到主检出、realpath 相等；再次处置不改动） (4112ms)
✔ AC-nm-absent: 主检出没有 node_modules ⇒ 不建链、处置读数如实（source-absent）、不抛 (2114ms)
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

`AC-nm` 用磁盘直接量（⛔ 不采信处置读数自述）：`lstatSync(wt/node_modules).isSymbolicLink()` 为真、`realpathSync(wt/node_modules) === realpathSync(主检出/node_modules)`；再次处置前后 lstat 的 inode 与 mtime 逐项相等（不改动）；分支前进后 `refreshed` 且链接仍在。`AC-nm-absent` 断言 `<worktree>/node_modules` 不存在、读数 `source-absent`、直接调用 `ensureWorktreeNodeModules` 不抛且带可读 reason。

### AC2/AC6b — `node --test plugin/test/worker-driver.test.mjs`（119 pass / 0 fail）

新增用例给夹具装一个「cwd 没有 `node_modules` 就非 0 退出」的 `pre-merge-commit` 钩子（复刻 GOAL-904 中止的形态，读的是磁盘真实目录，⛔ 非注入 seam）：

```
✔ goal-merge e2e — 临时验证 worktree 被装配依赖：要求 node_modules 的 pre-merge-commit 钩子放行，合并落地 (192ms)
ℹ tests 119
ℹ pass 119
ℹ fail 0
```

断言 `r.outcome === "landed"`，且 `git log develop --first-parent --merges` 恰一条、subject 匹配 `/^merge: goal\/GOAL-901 into develop \(request /`。

### AC3 — 取假（`cp` 备份回退，⛔ 不用 `git checkout --`）

**NC1（worker-fan-in 并入装配回退）**：`cp worker-fan-in.ts /tmp/wfi-nc.bak` → 注释掉 `ensureWorktreeNodeModules(root, tmpWorktree);` → 新用例变红，逐字复刻 GOAL-904 的中止：

```
✖ goal-merge e2e — 临时验证 worktree 被装配依赖：… (123ms)
  AssertionError [ERR_ASSERTION]: 依赖装配后钩子放行、合并落地
    （实测 step=merge-conflict reason=no node_modules in /tmp/goal-merge-GOAL-901-VsvMWJ/wt
  'red' !== 'landed'
```

**NC2（goal-driver 判据树装配回退）**：`cp goal-driver.ts /tmp/gd-nc.bak` → 把 5 处 `nodeModules: ensureWorktreeNodeModules(root, wtPath)` 改成 `nodeModules: null` → 两条新用例变红：

```
✖ AC-nm: … AssertionError: 处置读数应为 linked，实测=null
✖ AC-nm-absent: … AssertionError: 应如实读 source-absent，实测=null
```

两次都用 `cp` 备份恢复，`diff -q <backup> <file>` 逐字节确认恢复；恢复后重跑，AC6a = 8 pass / 0 fail、AC6b = 119 pass / 0 fail（上面的绿输出即恢复后）。

### AC4 — 5b 邻近扫描

命令：`grep -rn --include=*.ts -E '"worktree", *"add"' plugin/scripts packages/quay/src | grep -v /test/`

命中数 **6**（代码位置；注释里的提及不算——硬规则 2）。前 3 条：

```
plugin/scripts/full-suite-runner.ts:914:  execFileSync("git", ["worktree", "add", "--detach", wtPath, "HEAD"], {
plugin/scripts/integration-batch-merge.ts:1061:  if (git("worktree", "add", "-q", "--detach", tmpWt, developTip).status !== 0) {
plugin/scripts/goal-driver.ts:3166:    const add = gitIn(root, ["worktree", "add", "--detach", wtPath, tip]);
```

逐条判断：

| 调用点 | 是否需要装配 | 处置 |
|---|---|---|
| `goal-driver.ts:3166/3170/3187`（判据/预览 worktree，同一函数 3 处） | 需要 | 本任务已改（建/刷/current 三态都处置） |
| `worker-fan-in.ts:2555`（goal 并入临时 worktree） | 需要 | 本任务已改 |
| `full-suite-runner.ts:914`（`provisionOneShotWorktree`） | 不需要额外改 | 紧接着就调 `provision-verify-worktree.sh --worktree … --root …`，该脚本的 node_modules 符号链接正是它的第 2 步（全量 suite 要它）。已有装配；再加一层会与 `worktree-include` 的「EXPLICITLY EXCLUDES node_modules」契约冲突 |
| `integration-batch-merge.ts:1061`（`--merge` 真合并的临时 worktree） | 需要（同一根因），但**不在本任务 `## Touches`** | `git merge --no-ff --no-commit` 本身不触发钩子，但随后 `gitAt(tmpWt, "commit", …)`（:1149/:1156）触发共享的 `pre-commit` 钩子（`.git/hooks/pre-commit` → `node …/precommit-guard.ts`）——该临时 worktree 同样无 `node_modules` ⇒ 同一形态的 `ERR_MODULE_NOT_FOUND` 会让 commit 失败并回滚合并。**建议另立 gap**（本任务 Touches 不含该文件，fan-in 反漂移对越界写 hard-fail） |

### AC5 — 边界检查

```
$ node --experimental-strip-types plugin/scripts/goal-driver-task-boundary-check.ts
goal-driver-task-boundary-check: PASS — goal-driver.ts has no task-write call sites (task_write/lifecycle_*/fs.write-to-tasks) and no OWN-REPO fan-in carrier reads outside the target-probe exempt span
exit=0
```
