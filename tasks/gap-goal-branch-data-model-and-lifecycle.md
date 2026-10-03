---
id: gap-goal-branch-data-model-and-lifecycle
title: goal 的 branch 字段、goal 分支生命周期（懒创建 / 废弃时记 tip 后删除）与身份检查认可 goal/GOAL-NNN
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-326
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.1、§4.2、§4.8，裁定④⑦⑨㉑）：

1. **数据模型**：goal frontmatter 新增 `branch: true`（opt-in，缺省 false）。分支名是派生量 `goal/<GOAL-NNN>`，⛔ 不存储、⛔ 不允许人填任意名字。改动约束：只在 draft，或 active 且分支尚未创建时可改；分支创建后锁定，并入后仍锁定（不得重开）。`quay goal write` 增加对应参数。
2. **分支生命周期**（`packages/quay/src/branch-model.ts` 新增 goal 角色，今天只有 develop 一个落地基线角色 `:67`）：goal 处于 active 且 `branch: true` 时从当时的 develop tip 懒创建 `goal/<id>`（⛔ 不在建档时创建）；goal 转 retired / superseded 时，先把分支 tip SHA 写进进入该状态的 statusLog 条目 reason，再删除分支——这是人工救援的唯一留痕。创建与删除只能各有一个调用点。
3. **身份检查**（`plugin/scripts/target-identity-literal-check.ts:67` `LEGAL_IDENTITY_VALUES`）：保留现有 5 个字面量；token 匹配 `^goal/GOAL-\d{3,}$` 且对应 GOAL 存在、`branch: true`、状态不是 superseded/retired ⇒ 合法；读不到 goal store ⇒ exit 3（NOT-EVALUATED），⛔ 不当作合法。

<!-- dedup-ref -->相关但机制不同：`gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing`（done）处理的是第三方项目的落地基线怎么确定；本任务新增的是同一仓库内按 goal 划分的临时分支。

## AC

- [x] `packages/quay/test/goal-store.test.mjs` 新增用例断言：draft goal 可写 `branch: true`；active 且分支已存在时改 `branch` 被拒；未声明时读出为 false（或缺省）。
- [x] `packages/quay/test/branch-model.test.mjs` 新增用例（临时仓库）：goal 角色的创建函数在 develop tip 上建出 `goal/GOAL-901`，重复调用幂等；删除函数移除它。
- [x] 新增用例：一个已有分支的 branch-mode goal 写为 retired 后，分支不存在，且 statusLog 中进入 retired 的条目 reason 含原 tip 的 40 位 SHA。
- [x] `plugin/test/target-identity-literal-check.test.mjs` 新增用例：`goal/GOAL-901` 在记录为 active + branch:true 时合法、retired 时非法、goal store 不可读时退出 3；突变用例 `plugin/scripts/checker-mutation-cases/target-identity-literal-check.sh` 同步更新后仍能把检查器打红。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] 对真实仓库跑 GOAL-028 的 AC-326 判据（`node packages/quay/bin/quay.js goal gate AC-326 --dry-run --json`），verdict 为 not-evaluated（此时尚无被放弃的 branch-mode goal）——证明判据与本实现的识别规则（frontmatter 独立一行 `branch: true`）一致；输出贴进 Evidence。
- [x] `bash scripts/test.sh --for-task gap-goal-branch-data-model-and-lifecycle` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：人能对一个 goal 设 `branch: true`，激活后 `goal/<id>` 出现，放弃后分支消失且 tip SHA 可从 statusLog 取回。生产读数由 GOAL-028 的 AC-326 在一次真实的废弃演练后取得。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/src/branch-model.ts
- packages/quay/src/cli/goal.ts
- packages/quay/src/cli/help.ts
- packages/quay/src/abi.ts
- plugin/scripts/target-identity-literal-check.ts
- plugin/scripts/checker-mutation-cases/target-identity-literal-check.sh
- packages/quay/test/goal-store.test.mjs
- packages/quay/test/branch-model.test.mjs
- plugin/test/target-identity-literal-check.test.mjs
- tasks/gap-goal-branch-data-model-and-lifecycle.md

## Evidence

**改变的位置**：`branch-model.ts` 新增 goal-branch 角色（`goalBranchName` / `ensureGoalBranch` / `discardGoalBranch` / `goalBranchTip` / `goalBranchRefExists` / `goalIdFromBranchToken`）；`goal-store.write()` 是唯一的创建与删除调用点（`ensureGoalBranch` 在 active 转换、`discardGoalBranchNow` 在 retired/superseded 及 `flipGoal` 的 supersedes 路径）；`abi.ts` 的 `GoalRecord` 加 `branch?: boolean`；`cli/goal.ts` 把 `branch` 列为 store-only flag、`help.ts` 记录 `--branch true|false`。

⚠️ 本 worker 的 shell 泄漏了 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1`（goal-acceptance 守卫），它会让 goal-store.test.mjs 里既有的 I5 / AC-242 用例**假红**（与本改动无关）。下面的读数都在 `env -u QUAY_GOAL_ACCEPTANCE_ACTIVE` 下取得。

### AC1 / AC3 — goal-store.test.mjs（新增 3 条，全绿）

```
node --no-warnings --experimental-strip-types --test packages/quay/test/goal-store.test.mjs
ℹ tests 80 · pass 80 · fail 0
✔ goal branch — draft opt-in reads true, is NOT created at birth, created lazily on activation, then locked
✔ goal branch — an UNDECLARED `branch` reads as false and no branch is ever created for it
✔ goal branch — retiring a branch-mode goal deletes the branch and leaves the tip SHA in the retired statusLog entry
```
（AC1 的三半都在第一条用例里：draft 可写；激活后分支已存在 ⇒ `branch: false` 抛 "locked once the branch is created"；第二条断言未声明读出为 `false`。）

### AC2 — branch-model.test.mjs（新增 3 条，全绿）

```
ℹ tests 54 · pass 54 · fail 0
✔ goal branch — name is DERIVED (goal/<id>) and the token parser accepts only GOAL-<3+digits>
✔ goal branch — create forks the CURRENT develop tip, is idempotent, and discard removes it
✔ goal branch — a repo with no resolvable develop withholds the verdict, never forks from HEAD
```

### AC4 — 身份检查 + 突变用例

```
plugin/test/target-identity-literal-check.test.mjs
✔ goal-branch token: LEGAL while the GOAL is a live branch-mode goal (exit 0)
✔ goal-branch token: ILLEGAL once the GOAL is retired or superseded (its branch must be gone)
✔ goal-branch token: ILLEGAL when the GOAL is absent (readable store, no record) or not branch-mode
✔ goal-branch token: an UNREADABLE goal store withholds the verdict (exit 3, never 'legal')

bash plugin/scripts/checker-mutation-cases/target-identity-literal-check.sh <tmpdir>  →  exit 0
# 新增三段：goal 分支 live ⇒ GREEN；GOAL retired ⇒ RED(1)；goals/ 移除 ⇒ exit 3；最后 restore ⇒ GREEN
```

### AC5 — 取假（cp 备份 → 中和唯一的创建调用点 → cp 恢复）

```
# 备份：cp packages/quay/src/goal-store.ts /tmp/ac5/gs.bak
# 突变：把 write() 里唯一的创建调用点改成 `if (false && isGoalRecord && …`（grep 命中 1 处）
=== AC5 mutated（预期 RED）===
✔ goal branch — an UNDECLARED `branch` reads as false and no branch is ever created for it
✖ goal branch — draft opt-in reads true, is NOT created at birth, created lazily on activation, then locked
✖ goal branch — retiring a branch-mode goal deletes the branch and leaves the tip SHA in the retired statusLog entry
=== AC5 restored（预期 GREEN）===
✔ goal branch — draft opt-in reads true, is NOT created at birth, created lazily on activation, then locked
✔ goal branch — an UNDECLARED `branch` reads as false and no branch is ever created for it
✔ goal branch — retiring a branch-mode goal deletes the branch and leaves the tip SHA in the retired statusLog entry
restore check: 0 mutations left  （grep 'if (false && isGoalRecord' = 0）
```

### AC6 — 真实仓库 AC-326 判据

```
$ node packages/quay/bin/quay.js goal gate AC-326 --dry-run --json
{
  "id": "AC-326",
  "verdict": "not-evaluated",
  "cause": "declared",
  "reason": "not-evaluated (declared): acceptance failed (exit 3) — NOT-EVALUATED: no branch-mode goal has been retired or superseded yet",
  "timeoutMs": 60000,
  "timestamp": "2026-10-03T08:07:01.208Z",
  "dryRun": true
}
```
判据自己的 `bm_goals` 读的就是 frontmatter 里独立一行的 `branch: true`（`sed -n '2,/^---$/p' | grep -qx 'branch: true'`）；本实现的序列化正好产出该行（见下）。

端到端佐证（临时仓库里用本实现的 store 造一条 active→retired 的 branch-mode goal，再跑同一条判据）：
```
verdict = pass
reason  = acceptance passed (exit 0)
```
即判据认可的形态正是本实现产出的形态（分支已删 + 进入 retired 的 statusLog 条目带 40 位 tip SHA）。真实产出该读数的 store 序列化片段：
```
statusLog:
  - at: ...            to: active   ...
  - at: 2026-10-03T07:55:52.873Z
    from: active
    to: retired
    actor: probe
    reason: give up（discarded branch goal/GOAL-901 tip
      111f9b2772e4337c3f840db4b406031c414501f4）
branch: true
```

### AC7 — scoped gate

```
$ bash scripts/test.sh --for-task gap-goal-branch-data-model-and-lifecycle --allow-thin
SCOPED_GATE_EXIT=0
ℹ tests 255 · pass 255 · fail 0        # 非 thin：本任务 3 个测试文件都真跑了，例：
✔ goal branch — name is DERIVED (goal/<id>) and the token parser accepts only GOAL-<3+digits>
✔ goal branch — draft opt-in reads true, is NOT created at birth, created lazily on activation, then locked
✔ goal-branch token: LEGAL while the GOAL is a live branch-mode goal (exit 0)
```
并已写 scoped-gate-cache（第 2 轮重写，见下）：`developSha fe56d7c8e3ba36e1de04bf76870d4e1ec0491715`（`git merge-base --is-ancestor` HEAD ⇒ OK）。

CLI 面端到端（临时仓库）：`quay goal write GOAL-901 … --branch true` ⇒ `branch: true` 落到 frontmatter；`--status active` 后 `git branch --list 'goal/GOAL-901'` 出现；`--branch yes` ⇒ exit 2（严格 true|false）。

### 第 2 轮 — 收上一次 fan-in 的 ts-typecheck 红

上一轮 fan-in 在 suite 步失败（`step=suite: AssertionError`）。真实成因不是 flake，而是**本任务新增的代码本身**：
`ensureGoalBranch` / `discardGoalBranch` 用 `if (!x.ok)` 去取 `.err`，而本仓库根 tsconfig 是 `strict: false`
—— 布尔判别联合的**否定分支不被收窄**，`npx tsc --noEmit` 报 TS2339（`branch-model.ts(1150,107)` / `(1186,111)`）。
同一文件 `:430` 的注释早已记下这条约束并给出正确写法（`r.ok === true`），新代码没有照它写。

**修法**：两处改为 `created.ok === false` / `del.ok === false`（沿用该文件既有写法）。纯类型层修复，运行时行为不变。

这一条同时解释了 4 条 suite 红里的 3 条：三份 `ts-typecheck-gate-*` 测试正是「对本仓库真跑 tsc」，因此全红。
第 4 条 `packages/quay-native/test/relation-sync.test.mjs` 是 `@load-sensitive` 的负载型 flake，与本次改动无关：
隔离跑 10/10 全 PASS。

第 2 轮读数（合并 develop 后、写入本 Evidence 之前）：

```
$ npx tsc --noEmit
exit 0（0 错误）

$ node --test packages/quay/test/ts-typecheck-gate-{config-wiring,pass,cli-event}.test.mjs
ℹ tests 3 · pass 3 · fail 0
✔ M63 D1: ts-typecheck gate PASSes against THIS repo's own real .quay/config.yml gates: wiring
✔ M63 A2: ts-typecheck gate PASSes for real against THIS repo's own root tsconfig.json
✔ M63 C1: `quay gate <task> --gate ts-typecheck` PASSes for real against this repo

$ node --test packages/quay-native/test/relation-sync.test.mjs     # 隔离
All M35-native-relation-sync tests passed.  → pass 1 · fail 0（内部断言 22/22 PASS）

$ bash scripts/test.sh --for-task gap-goal-branch-data-model-and-lifecycle --allow-thin
SCOPED_GATE_EXIT=0
ℹ tests 256 · pass 256 · fail 0        # 非 thin：本任务 3 个测试文件都真跑了，例：
✔ goal branch — name is DERIVED (goal/<id>) and the token parser accepts only GOAL-<3+digits>
✔ goal branch — draft opt-in reads true, is NOT created at birth, created lazily on activation, then locked
✔ goal branch — retiring a branch-mode goal deletes the branch and leaves the tip SHA in the retired statusLog entry
✔ goal-branch token: LEGAL while the GOAL is a live branch-mode goal (exit 0)
```
并已重写 scoped-gate-cache：`developSha fe56d7c8e3ba36e1de04bf76870d4e1ec0491715`（`git merge-base --is-ancestor` HEAD ⇒ OK）。
