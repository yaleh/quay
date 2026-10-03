---
id: gap-goal-branch-done-means-landed-on-merge-target
title: 落到 goal 分支的任务把 done 同时写到 develop——done 的语义改为「已落到它的 mergeTarget」，否则任务被反复派发（B2）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-branch-data-model-and-lifecycle
goal_ac: AC-323
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §5 B2，裁定⑪）：`plugin/scripts/worker-fan-in.ts` 的 `flipTaskDone`（`:1106` 起）在任务 worktree 提交 `status: done`，随 ff 进 mergeTarget；「已落地」读 mergeTarget 上的任务文件（`:1103-1106`、`:1131-1133`）。而派发与晋升读主检出盘上的 `tasks/*.md`，主检出跟随 develop。mergeTarget = goal 分支时，develop 上仍是 ready ⇒ worktree 回收后任务被重新派发。

**修法（已裁定⑪）**：代码照常进 `goal/<id>`；ff goal 分支成功后，经现有文档面写路径（主检出 author 上提交 + `propagateDocBranchToDevelop`）把同一个 done 翻转写到 develop。`done` 的语义改为「已落到它的 mergeTarget」。mergeTarget = develop 时行为逐字不变（不额外写文档面）。

**落地类读者分类**：`grep -rnE '\?\? *["'"'"']develop["'"'"']' plugin/scripts plugin/workflows packages/quay/src`（排除测试）在 2026-10-03 命中 20 处 / 17 个文件（前 3 条：`defect-latency-pair.ts:755`、`anti-drift-touches-check.ts:405`、`quay-init.sh:1927` 注释）。逐条分类：以 develop 判「是否已落地」的读者改为按任务解析 mergeTarget（在 Touches 内的就改）；统计/历史类保持 develop。

## AC

- [x] 新增 `plugin/test/worker-fan-in.test.mjs`（临时仓库，直接调用机械 fan-in 的落地段）：mergeTarget = `goal/GOAL-901` 时，测试里的机械 fan-in 跑完之后 `git show develop:tasks/<id>.md` 与主检出上的任务文件都是 `status: done`，代码只在 `goal/GOAL-901` 上；mergeTarget = develop 时不产生额外的文档面提交。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] Evidence 中给出上面 grep 的完整分类表（文件:行、类别、处理），命中数与 2026-10-03 的 20 处对账（不同则说明差异）；Touches 外需要改的点逐条写明，留给后续任务。
- [x] `bash scripts/test.sh --for-task gap-goal-branch-done-means-landed-on-merge-target` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：落到 goal 分支的任务此后不再被派发。生产读数由 GOAL-028 的 AC-323（落地后的派发起点数为 0，且该任务自己的派发起点能在 worker-round 载体里读到）在第一个试点 goal 上取得。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/driver-filters.ts
- plugin/test/worker-fan-in.test.mjs
- tasks/gap-goal-branch-done-means-landed-on-merge-target.md

## Evidence

### 实现（B2 状态双写）

- `plugin/scripts/worker-fan-in.ts`：
  - 新增模块级 `syncDoneToDocFace(root, task)`：读主检出（`root`）的 `tasks/<task>.md`，若 `ready` 则翻 `done` 并经 `commitTaskFile`（pathspec 限定，⛔ 不裸 commit 扫共享 index）提交，再调 `propagateDocBranchToDevelop(root)`（ff-only + 语义兜底）把 doc 分支推到 develop。主检出已是 `done`（上一轮残留）⇒ 只再同步一次、不重复提交。任一环失败返回 `{ok:false, reason}`（硬规则 3b，⛔ 不与「已同步」同形）。
  - `runMechanicalFanIn` 成功路径：ff 成功后、**仅当 `mergeTarget !== "develop"`** 时执行该步（per-run trace 步骤名 `doc-face-done-sync`），失败 ⇒ `failClean(...)` red（fail-closed；worktree 保留，下一轮 `flipTaskDone` 见 mergeTarget 已 done 而 skip、ff 幂等，只重试本步）。`mergeTarget === "develop"` 分支不进入 —— 逐字不变。
  - 新增 import：`commitTaskFile`（task-ops.ts，单一 parser 族）+ `propagateDocBranchToDevelop`（driver-filters.ts，现有文档面写路径）。
- 新增 `plugin/test/worker-fan-in.test.mjs`：真实 `runMechanicalFanIn` 端到端（临时 git 仓库，主检出在 doc 分支 `author`）。

### AC2 取假（cp 备份回退 → 红；cp 恢复 → 绿）

备份：`cp plugin/scripts/worker-fan-in.ts .quay/gap-doneface-evidence/worker-fan-in.ts.bak`（md5 `55b4a99d570946e015eb8b8bb9970bc6`）。

回退方式：把 post-ff 双写块的首行改成 `if (false && mergeTarget !== "develop")`（⛔ 未用 `git checkout --`）。实跑：

```
$ node --test plugin/test/worker-fan-in.test.mjs    # 回退态
✖ ① goal target — after landing on goal/GOAL-901, BOTH develop and the main checkout carry status: done; code stays on the goal branch (2402.900491ms)
✔ ② develop target — unchanged path: no doc-face commit, the main checkout stays ready, code lands on develop (2428.7547ms)
ℹ tests 2
ℹ pass 1
ℹ fail 1
  AssertionError [ERR_ASSERTION]: develop:tasks/<id>.md must be status: done (B2 dual-write)
  'ready' !== 'done'
```

恢复：`cp .quay/gap-doneface-evidence/worker-fan-in.ts.bak plugin/scripts/worker-fan-in.ts`（md5 复核对齐 `55b4a99d570946e015eb8b8bb9970bc6`）。实跑：

```
$ node --test plugin/test/worker-fan-in.test.mjs    # 恢复态
✔ ① goal target — after landing on goal/GOAL-901, BOTH develop and the main checkout carry status: done; code stays on the goal branch (2385.765569ms)
✔ ② develop target — unchanged path: no doc-face commit, the main checkout stays ready, code lands on develop (2353.576066ms)
ℹ tests 2 · pass 2 · fail 0
```

⇒ ① 随核心改动在/不在 变绿/变红（可证伪），② 两态恒绿（develop 路径逐字不变）。

### AC3 grep 分类表（2026-10-03 命中 20 处；本任务改后同一 grep 仍命中 20 处）

对账：**命中数相同（20）**。行号漂移两处：`anti-drift-touches-check.ts` `:405→:447`（其间其它任务落地所致）、`worker-fan-in.ts` `:1557→:1608`（**本任务自己新增 import/helper 所致**）；其余行号不变（`defect-latency-pair.ts:755`、`quay-init.sh:1927` 与 SPEC 前 3 条一致）。SPEC「前 3 条」的顺序按 grep 参数顺序（plugin/scripts 在前）而异，非集合差异。

| # | 文件:行（当前） | 类别 | 处理 |
|---|---|---|---|
| 1 | `anti-drift-touches-check.ts:447` | CLI 选项默认 `--merge-target`（调用者=机械 fan-in step 3/8 已按任务传） | 保持（已参数化） |
| 2 | `fork-baseline.ts:164` | CLI 选项默认 `--develop`；fork 点基线统计 | 保持（统计） |
| 3 | `defect-latency-pair.ts:755` | `opts.ref` 默认；defect 延迟统计 | 保持（统计） |
| 4 | `direct-to-develop-bypass-check.ts:1144` | CLI 选项默认 `--develop`；直落 develop 审计（审计对象本就是 develop 线） | 保持（审计） |
| 5 | `fan-in-ff-protocol-check.ts:358` | CLI 选项默认 `--develop`；ff 协议审计 | 保持（审计） |
| 6 | `fan-in-ts-typecheck-gate.ts:273` | CLI 选项默认 `--merge-target`（调用者传） | 保持（已参数化） |
| 7 | `freshness-producer-coverage-check.ts:440` | `q.tip` 默认；新鲜度距离测量 | 保持（测量） |
| 8 | `freshness-producer-coverage-check.ts:577` | 同函数的展示串 | 保持（测量） |
| 9 | `gate-event-coverage-check.ts:576` | CLI 选项默认 `--merge-target`（调用者传） | 保持（已参数化） |
| 10 | `quay-init.sh:1927` | 注释 | 保持 |
| 11 | `quay-init.sh:1928` | 注释 | 保持 |
| 12 | `select-static-checks-for-touches.ts:959` | CLI 选项默认 `--merge-target`（调用者=anti-drift step 传） | 保持（已参数化） |
| 13 | `worker-fan-in.ts:1608` | 机械 fan-in 自身选项默认 `opts.mergeTarget ?? "develop"`；真正落地读 `flipTaskDone(worktree, task, mergeTarget)` 已用该参数化值 | 本任务改动在其**下游**；本行不改 |
| 14 | `worker-driver.ts:4366` | `opts.pushBranch` 默认（push 滞后检查对象；resident-loop 级单值） | **Touches 外 → 见下 B（低优先）** |
| 15 | `fan-in-execute.js:132` | workflow 参数默认（语义兜底路径，调用者传 `A.mergeTarget`） | 保持（已参数化） |
| 16 | `branch-model.ts:8` | 注释 | 保持 |
| 17 | `verify-deliver-coldstart.sh:1713` | 注释 | 保持 |
| 18 | `ff-merge.ts:817` | 配置选项默认 `args.mergeTarget`（调用者传） | 保持（已参数化） |
| 19 | `init.ts:138` | 注释 | 保持 |
| 20 | `init.ts:893` | 注释 | 保持 |

小结：20 处里 **18 处保持 develop**（选项默认 6 / 统计测量 3 / 审计 2 / 注释 6 / 本任务自身的选项默认 1），**2 处是 Touches 外、需后续改**（下表）。

#### Touches 外需要改的点（逐条，留给后续任务）

- **A（优先级最高）：`worker-driver.ts:1293` `isShaAncestorOfBranch(root, sha, branch = "develop")` + `:1312` `computeLandingState`（调用点 `:1317`）。** 这是**真正的落地读者**：机械 fan-in 落地时 `computeLandingState(rootDir, taskId, mechResult.landedSha)` 用 `landedSha` 对 **develop** 做 `merge-base --is-ancestor`。goal 任务的 `landedSha` = goal 分支 tip ⇒ 非 develop 祖先 ⇒ `landing.state="failed"` ⇒ 本轮 worker-outcome 记 exited-not-landed。本任务的状态双写保证**下一轮**读主检出 `tasks/*.md`（`:3912` 的 status-based 路径）已是 done ⇒ 不再进入 ready 池；但要让「本轮即判 landed」成立，该处须按任务解析 mergeTarget（或对 status=done 短路）。⚠️ **它不在 SPEC §3 的 `?? "develop"` grep 命中里**（形如 `= "develop"`，非 `?? "develop"`），SPEC 的影响面因此**低估了这一处**——这是本分类表最重要的一条 Touches 外发现。
- **B（低优先）：`worker-driver.ts:4366` `opts.pushBranch ?? "develop"`。** resident-loop 级单值，供 push 滞后检查。branch-mode goal 的落地在 `goal/<id>`（本机、且不推 origin），该检查对象分支的语义待定；首个 branch-mode goal 跑起来后按实测再定，⛔ 不作为本任务前置。
- **C：SPEC §9.2 残留 4（「`?? "develop"` 的 20 处逐一分类」）** —— 本表即该条的分类结果；A/B 是仅有的两处需后续改动点。

### AC4 scoped 门（`bash scripts/test.sh --for-task gap-goal-branch-done-means-landed-on-merge-target`，**非 thin**）

退出 0；选中并执行了 42 个测试文件、71 个测试，其中**含本任务新增的** `plugin/test/worker-fan-in.test.mjs`（及其配对 `plugin/test/worker-fan-in-catch-up.test.mjs`）。选中清单（节选，`+` 为 test.sh 打印的选中项）：

```
  + plugin/test/worker-fan-in-catch-up.test.mjs
  + plugin/test/worker-fan-in.test.mjs
```

该门实跑末尾：

```
✔ ① goal target — after landing on goal/GOAL-901, BOTH develop and the main checkout carry status: done; code stays on the goal branch (1947.895192ms)
✔ ② develop target — unchanged path: no doc-face commit, the main checkout stays ready, code lands on develop (1849.828275ms)
ℹ tests 71 · pass 71 · fail 0
```

（完整输出见 `.quay/gap-doneface-evidence/scoped-gate-notthin.txt`。）同一轮的 scoped 静态检查（含 `import-graph-check`：valueSccs/typeSccs/reverseEdges 均 0，本任务新增的 `worker-fan-in → driver-filters` 值边未成环；`task-contract-check`、`anti-drift-touches-check` 等）全部通过。
