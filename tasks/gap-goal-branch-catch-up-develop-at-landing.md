---
id: gap-goal-branch-catch-up-develop-at-landing
title: goal 分支落地的追平：fan-in 落回 goal 分支前合入追平时刻的 develop（AC-322 承载）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-322
---
## Proposal

**为什么上一版没成立（AC-322 的既有认领已 done，判据仍非通过）**：AC-322 此前的承载任务 `gap-goal-branch-antidrift-two-line-base` 只修了追平的一个**前提**——anti-drift 的 diff 基准（`computeActualFiles` 的两线基准，见其 `plugin/scripts/anti-drift-touches-check.ts` 改动），它自己的 `## DoD` 就写明「生产读数由 GOAL-028 的 AC-322 在第一个试点 goal 上取得；本任务落地时该 AC 读 exit 3 是正确的」。该任务落地后（develop `a2c10e80`）实测 `node packages/quay/bin/quay.js goal gate AC-322 --dry-run` 仍读 `NOT-EVALUATED: no goal record carries branch: true yet`（exit 3）。**追平（把当时的 develop 合进 goal 分支的落地树）这一步本身从未被交付**，判据没有任何可核对的对象，故为**空转**而非通过——这正是「修得不彻底」的形态：前提修好了，本体没做。

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.4 裁定③）：机械 fan-in 的「合入 mergeTarget」一步，在 mergeTarget 是 `goal/<GOAL-NNN>` 时扩为**两次合并，都在任务自己的 worktree 里**：先 `git merge goal/<id>`，再 `git merge develop`（追平）。追平放在任务 worktree 而不是单独对 goal 分支做的理由（SPEC §4.4）：goal 分支没有自己的工作树可以做 merge 提交；放进任务 worktree 后，追平后的那棵树恰是被该任务全量 suite 验证过、随后被 ff 到 goal 分支的同一棵树——没有一棵未经验证的中间树。

**修法（方向，实现者可调）**：`plugin/scripts/worker-fan-in.ts` 的 fan-in 步骤 2（现为单个 `git merge <mergeTarget>`，约 `:1795`）在 `mergeTarget !== "develop"` 时改为：合并 `mergeTarget` 后**再合并 `develop`**（两次 `git merge --no-edit`）；`mergeTarget === "develop"` 路径逐步零行为变化。追平须留下**可核对的 merge 提交**：AC-322 的判据把「该次落地内合入 develop 的 merge 提交时间」当作追平时刻；若 develop 已在祖先里而被 fast-forward、不产生 merge 提交，判据退化为「该次落地最早提交时间」——实现须确认**两条路径**都使 develop 的当时 tip 成为落地提交的祖先，并在 Evidence 对两条各贴一次实跑读数。

**范围边界**：
<!-- dedup-ref -->
派发接线（`resolveTaskMergeTarget`、worktree 分叉点 `--base`、goal 分支锁）归既有任务 `gap-goal-branch-dispatch-wiring-and-task-fan-in`，本任务不重复那部分；本任务把「追平」这一步独立承载，给 AC-322 一个唯一、可验证的归属。两条任务都可能改 `plugin/scripts/worker-fan-in.ts`，由 Touches 重叠串行化，不并行。

## AC

- [x] `plugin/scripts/worker-fan-in.ts` 的 fan-in 在 `--merge-target <非 develop 分支>` 时先合入该分支、再合入 `develop`；`--merge-target develop` 的既有行为逐字不变（同一夹具断言该路径与改动前逐元素等价）。
- [x] 新增 `plugin/test/worker-fan-in-catch-up.test.mjs`（basename 与被测脚本成对）：临时 git 仓库构造 `develop`、`goal/GOAL-901` 与一个从 goal 分支分叉的任务分支，develop 在分叉后前进；跑 fan-in 落回 `goal/GOAL-901` ⇒ 断言**落地提交以追平时刻的 develop tip 为祖先**（`git merge-base --is-ancestor <devTip> <landing>`，devTip 取追平前的 `git rev-parse develop`），且落地历史里存在一个以 develop 侧提交为父的 merge 提交；退化路径（develop 已是祖先、无 merge 提交）单独一条用例断言同样成立。
- [x] 取假：用 `cp` 备份把核心改动临时回退（⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 回归：`node --test plugin/test/fan-in-execute-paths-s03.test.mjs plugin/test/fan-in-execute-paths-s04.test.mjs` 退出 0（非 goal 路径不受影响）。
- [x] 5b 邻近扫描：grep fan-in 路径上其它「假定只合入一次 mergeTarget」的点（至少含 `plugin/scripts/fan-in-ts-typecheck-gate.ts` 与 worker-fan-in 的 delta 基准），把命中数与前 3 条贴进 Evidence，逐条判断追平后是否仍正确；需要且在 Touches 内的就改，否则在 Evidence 写明理由。
- [x] `bash scripts/test.sh --for-task gap-goal-branch-catch-up-develop-at-landing` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：branch-mode goal 的一个任务落到 `goal/<id>` 后，该落地提交以**追平时刻的 develop tip** 为祖先——生产读数由 GOAL-028 的 AC-322（`quay goal gate AC-322`，exit 0）在第一个试点 goal 上取得。本任务落地使「追平」这一步存在并被合成夹具验证；在 branch-mode 派发接线与人的试点跑起来之前，AC-322 读 exit 3 是正确的——⛔ 不把合成夹具的绿当作 AC-322 的通过，也不把该 AC 的通过留给「下一个任务」。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/fan-in-ts-typecheck-gate.ts
- plugin/test/worker-fan-in-catch-up.test.mjs
- tasks/gap-goal-branch-catch-up-develop-at-landing.md

## Evidence

**改动**（`plugin/scripts/worker-fan-in.ts` step 2b；`--merge-target develop` 路径不进入本分支）：

```ts
if (mergeTarget !== "develop") {
  a = await step("catch-up-develop", ["git", "-C", worktree, "merge", "--no-edit", "develop"], 120_000);
  if (!a.ok) return fail("catch-up-develop", a);
}
```

**AC1 — 两线合并 + develop 路径逐元素等价。** 同一夹具、只换 `--merge-target`，实跑：

```
✔ ① goal target — the landing on goal/GOAL-901 carries a catch-up merge whose 2nd parent is the pre-fan-in develop tip, and devTip is an ancestor of the landing
✔ ③ develop target — element-wise equivalent to the pre-change path: merge-develop only, exactly one merge, no catch-up-develop step
```

夹具 ③（develop 目标）落地范围内的 merge 提交数 = **1**（第二父 = develop tip），trace 有 `merge-develop`、无 `catch-up-develop`；夹具 ①（goal 目标）落地范围内 merge 提交数 = **2**（第二父分别为 advanced goal tip 与 develop tip），且追平 merge 是 mergeTarget merge 的**后代**（SPEC §4.4 的 1→2 次序）。既有源码断言（`fan-in-driver-mechanical-orchestration.test.mjs` 对 `step("merge-develop", […mergeTarget], 120_000)` 的逐字匹配，以及「first failing step is merge-develop」的失败路径）在 AC4 段实测仍绿。

**AC2 — 新增用例（真实 temp git 仓库，端到端跑 `runMechanicalFanIn`）。**
`plugin/test/worker-fan-in-catch-up.test.mjs`，3 条：

- ① `goal/GOAL-901` 目标：任务分支从 goal 分叉；goal 在分叉后又被兄弟任务前进；develop 在分叉后前进 ⇒ `git merge-base --is-ancestor <devTip> <landing>` = 0，且落地范围内恰有一个以 devTip 为第二父的 merge 提交（⛔ 不是断言「有一个 merge 提交」，而是断言它的第二父就是追平时刻的 develop tip）。
- ② 退化路径（develop 未前进、已在祖先里）⇒ 同一 `--is-ancestor` 断言 = 0，且落地范围内**不存在**以 devTip 为父的 merge 提交（`git merge develop` 报 Already up to date，不产生提交——AC-322 的判据此时退化为「该次落地最早提交时间」）。
- ③ develop 目标 = 逐元素等价（见 AC1）。

**AC3 — 取假（`cp` 备份回退核心改动，⛔ 未用 `git checkout --`）。**

```
$ cp plugin/scripts/worker-fan-in.ts /tmp/worker-fan-in.ts.catchup-backup
  md5 2dcebb15694a7d8967c8eddd48f2b7e3（源与备份一致）
# 用 Edit 摘掉 step 2b 的 if 块（原地留一行 MUTATION-CONTROL 注释），再跑：
$ node --test plugin/test/worker-fan-in-catch-up.test.mjs
✖ ① goal target — … (2483ms)
  AssertionError [ERR_ASSERTION]: landing 3f0fd2f7189c056acc838d5fd1521250abe6f887 must have develop tip aee30d84af6352113590e37d27961f18e3c71160 as an ancestor
  1 !== 0
✔ ② degenerate — develop is already an ancestor: no catch-up merge commit is created, the ancestor property still holds
✔ ③ develop target — element-wise equivalent to the pre-change path: merge-develop only, exactly one merge, no catch-up-develop step
ℹ tests 3   ℹ pass 2   ℹ fail 1        (exit 1)

$ cp /tmp/worker-fan-in.ts.catchup-backup plugin/scripts/worker-fan-in.ts
  md5 2dcebb15694a7d8967c8eddd48f2b7e3（与备份一致）
$ node --test plugin/test/worker-fan-in-catch-up.test.mjs
✔ ① goal target …   ✔ ② degenerate …   ✔ ③ develop target …
ℹ tests 3   ℹ pass 3   ℹ fail 0        (exit 0)
```

②③ 在回退下仍绿是预期的：② 走的正是「无提交可造」的路径、③ 是未被改动的 develop 路径。

**AC4 — 回归（非 goal 路径不受影响）。**

```
$ node --test plugin/test/fan-in-execute-paths-s03.test.mjs plugin/test/fan-in-execute-paths-s04.test.mjs
ℹ tests 19   ℹ pass 19   ℹ fail 0     EXIT=0

$ node --test plugin/test/fan-in-driver-mechanical-orchestration.test.mjs plugin/test/worker-driver-fan-in-s06.test.mjs
ℹ tests 24   ℹ pass 24   ℹ fail 0     EXIT=0
```

（后者含对 `merge-develop` 那行 argv 的逐字源码匹配 + 「first failing step is merge-develop」的失败路径断言，以及 `runMechanicalFanIn` 每步 begin/end 的配对断言。）

**AC5 — 5b 邻近扫描**（fan-in 路径上「假定只合入一次 mergeTarget」的点）。命令与命中数：

```
$ grep -nE 'mergeTarget|merge-base|MERGE_TARGET' \
    plugin/scripts/worker-fan-in.ts plugin/scripts/fan-in-ts-typecheck-gate.ts \
    plugin/scripts/anti-drift-touches-check.ts plugin/scripts/fan-in-ac-completion-gate.ts \
    plugin/scripts/doc-check-cache.ts packages/quay/src/fan-in/ff-merge.ts \
  | grep -v ':\s*//' | wc -l
61
```

「diff/基准」类命中前三（即这一类在 fan-in 路径上的全部三处），逐条判断：

1. **`plugin/scripts/anti-drift-touches-check.ts:263-288`**（`computeActualFiles` / `computeTaskOwnedFiles`）——**已在兄弟任务的两线基准修复里做对（本任务无需改）**。实跑复核（goal 分支与 develop 都前进的夹具，`--merge-target goal/GOAL-901`）：
   `ANTI-DRIFT OK: task gap-probe — 1 actual file(s), all within declared Touches (2 glob(s))`
   ⇒ 追平引入的 `pkg/develop-only.ts` 与 goal 侧的 `pkg/goal-only.ts` 都被排除，只报任务自己的 `docs/feature.md`。
2. **`plugin/scripts/fan-in-ts-typecheck-gate.ts:298`**（`${mergeTarget}...HEAD`）——追平后基准 = merge-base(goal, HEAD) = goal tip ⇒ 集合是**超集**（含追平带入的 develop .ts）。实跑：
   `"newMovedTsFiles": ["pkg/develop-only.ts"], "required": false`
   **追平后仍正确**：方向只会「多判」不会「少判」——任务自己的 .ts 必在集合内（它可达、且不在 goal/develop 任一侧），故不会漏判；多出来的文件只有在**恰落在 declared Touches 内**时才会把 `required` 抬成 true，那正是 fail-closed 的方向（多跑一次 typecheck，非漏放）。**不改**：改则要在此脚本里再造一份两线基准，与 anti-drift 的单一真相源重复。
3. **`plugin/scripts/worker-fan-in.ts` step 4 delta 基准**（`merge-base mergeTarget HEAD` → `git diff --name-only <fork> HEAD`）——同样超集。实跑 `git diff --name-only <fork> HEAD` = `docs/feature.md` + `pkg/develop-only.ts`。**不改，且这是必需的**：SPEC §4.4 的正当性论证正是「追平后的那棵树被本任务自己的全量 suite 验证」；把基准改精确会让 doc-only 任务**带着未验证的 develop 代码**落地时跳过 suite，恰好破坏该论证。已知副作用：goal 分支上的 doc-only 落地会因 develop 的 code 变更而跑全量 suite（方向 fail-closed，记为观察项而非缺陷）。

另两处一并核对（未命中同一缺陷）：

4. `packages/quay/src/fan-in/ff-merge.ts:817-1017` —— 已按 `mergeTarget` 参数化（`sourceRef` / `ffMode` / `landedSha` / 事件字段全取 mergeTarget），无「单次合并」假设；`ffMode` 由 root 当前分支是否 = mergeTarget 决定，goal 目标走 push 模式（本任务用例 ① 实跑即此路径）。
5. `plugin/scripts/worker-fan-in.ts:1970` `developSha = rev-parse mergeTarget` —— 字段名带 develop，但取值本就定义为「mergeTarget tip」，goal 目标下它是 goal tip，**语义未变**（同字段同含义），只是名字在 goal 目标下易误读。⛔ 不在本任务改字段名（波及 outcome 读面与 `.jsonl` 消费者），记为观察项。

**AC6 — scoped 门（非 thin）。**

```
$ bash scripts/test.sh --for-task gap-goal-branch-catch-up-develop-at-landing
ℹ tests 23   ℹ pass 23   ℹ fail 0     EXIT=0
```

**2 个可执行测试文件被真正跑**：`plugin/test/fan-in-ts-typecheck-gate.test.mjs`（Touches 里 `plugin/scripts/fan-in-ts-typecheck-gate.ts` 的 basename 配对，20 条）+ `plugin/test/worker-fan-in-catch-up.test.mjs`（Touches 里的直接 `*.test.mjs` 条目，3 条）；20 + 3 = 23，与 `ℹ tests 23` 一致。

**DoD 读数（⛔ 不把合成夹具的绿当作 AC-322 的通过）**：本任务使「追平」这一步存在并被合成夹具验证；branch-mode 派发接线与人的试点尚未跑起来，故 AC-322 的生产读数仍为未评估——这正是本任务 §DoD 声明的正确读数：

```
$ node packages/quay/bin/quay.js goal gate AC-322 --dry-run
"verdict": "not-evaluated",
"reason": "not-evaluated (declared): acceptance failed (exit 3) — NOT-EVALUATED: no goal record carries branch: true yet"
```

**scoped-gate 缓存**：worktree 已合入 develop 且在其 tip 上跑绿后写入
`--write-scoped-gate-cache --task gap-goal-branch-catch-up-develop-at-landing --develop-sha <合并时刻的 git rev-parse develop>`。
