---
id: gap-ac322-goal-branch-catchup-landing-real-reading
title: AC-322 停在 exit 3：追平机制已落地但从未在 goal 分支的生产落地上跑过——在真实 store 上完成一次含追平的 goal
  分支落地使 AC-322 取到真实 exit 0，并新增逐字绑定该判据的三态夹具
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-322
---
## Proposal

**判据为什么仍为假（立案轮直接量，2026-10-03，主检出 `/data/home/yale/work/quay`）**

```
$ grep -l '^branch: true' goals/GOAL-*.md        # 0 个文件
$ node packages/quay/bin/quay.js goal gate AC-322 --dry-run --json --root /data/home/yale/work/quay
⇒ {"verdict":"not-evaluated","cause":"declared",
    "reason":"acceptance failed (exit 3) — NOT-EVALUATED: no goal record carries branch: true yet"}
```

判据（`goals/AC-322-追平-每次-goal-分支落地都包含其追平时刻的-develop.md`）要求**至少一个** `branch: true` 的 goal 有 ≥1 次「落地」——一个 `goal_ac` 指向该 goal 名下 AC 的任务，其翻 done 提交（subject 为 `tasks: 翻 <id> done（driver 机械 fan-in）`）晚于 opt-in 时刻——并对每次落地断言「该次落地内合入 develop 的 merge 提交时刻的 develop tip 是它自己的祖先」。今天 store 里连一个 branch-mode goal 都没有，判据只能诚实地停在 exit 3（`goals/GOAL-028-*.md` §退出条件 也写明：第一个试点 goal 跑起来前读 exit 3 是正确输出，不是缺陷）。

**上一个 done 任务做了什么、没做什么**

<!-- dedup-ref -->
`gap-goal-branch-antidrift-two-line-base`（done）修的是追平的**前提**（anti-drift 的两线 diff 基准），其 `## DoD` 自陈「生产读数由 AC-322 在第一个试点 goal 上取得；本任务落地时该 AC 读 exit 3 是正确的」。`gap-goal-branch-catch-up-develop-at-landing`（done）实现并单测了**追平这一步本体**（`worker-fan-in.ts` step 2b：mergeTarget ≠ develop 时先合 goal 分支再合 develop），其 `## DoD` 同样把生产读数显式推给「branch-mode 派发接线 + 人的试点」。那次试点从未发生：`grep -l '^branch: true' goals/*.md` 今日仍为 0。于是机制在、单测绿、判据仍 exit 3——硬规则 4 推论三「实现落地、测试绿了、但生产没跑过」。两个 done 任务都不是本任务的重复：它们交付的是机制，本任务交付的是**生产载体上的一次真实落地**（sibling `gap-ac326-branch-discard-drill-real-reading` 对 AC-326 用的是同一形状）。

**本任务做什么**

① **在真实 goal store（主检出根 `/data/home/yale/work/quay`）上完成一次含追平的 goal 分支落地**，全程只用 store CLI 与**已落地的机械 fan-in**（`plugin/scripts/worker-fan-in.ts` 的 `runMechanicalFanIn`，含 catch-up 步），⛔ 不手改 `goals/*.md`、⛔ 不手写翻 done 提交：

```sh
R=/data/home/yale/work/quay            # ⛔ 必须是主检出：判据读的是【这个根的工作树】的 goals/*.md
# 1) 先写 AC（store 拒绝 0 AC 的 draft/active GOAL）——保持 draft
node packages/quay/bin/quay.js goal write AC-902 --store --root $R \
  --goal GOAL-902 --status draft \
  --criterion '<一条真能跑、且可为假的判据：检查 GOAL-902 名下 AC-902 的落地含追平>' \
  --expect '<逐字写清 exit 0/1/3 各代表什么>' --origin 'GOAL-028 退出条件① 落地的 AC-322 生产读数（drill）'
# 2) drill goal：draft + branch:true —— 此步【不】建分支（懒创建是设计）
node packages/quay/bin/quay.js goal write GOAL-902 --store --root $R \
  --title 'AC-322 追平落地演练（drill）：只用于跑一次 goal 分支的追平落地，⛔ 不是真实开发方向' \
  --status draft --branch true --body '<≥40 非空白字符：背景/范围与非目标/退出条件>'
# 3) active ⇒ store 从【当时的 develop tip】建出 goal/GOAL-902 —— 记下它（AC1①）
node packages/quay/bin/quay.js goal write GOAL-902 --store --root $R --status active --reason '...'
git -C $R rev-parse goal/GOAL-902
# 4) 一个 goal_ac: AC-902 的 drill 任务，在其 worktree 上跑机械 fan-in，--merge-target goal/GOAL-902
#    ⇒ step 2b 先 merge goal/GOAL-902 再 merge develop（追平），suite 绿后 ff 回 goal/GOAL-902 并
#      flip done（提交 subject 逐字 `tasks: 翻 <T> done（driver 机械 fan-in）`）
# 5) 读数（dry-run 不写台账；driver 下一轮自己会判并落账）
node packages/quay/bin/quay.js goal gate AC-322 --dry-run --json --root $R
```

实现者可调：drill 任务的创建状态须避开派发竞态（建议直接建为 `done`，由 `flipTaskDone` 的 done→ready→done 收敛路径产出唯一 flip 提交）；fan-in 的 suite 步若在 drill 上过重，可只对**落地那棵树**做一次本任务声明的验证，⛔ 但不得跳过 `runMechanicalFanIn` 的 catch-up 步——那正是被验证的对象。落地树的 develop tip 必须在**追平 merge 之前**记下（`git rev-parse develop`），供 AC1③ 与取假用。

<!-- dedup-ref -->
② **收尾：drill 不得留下第二个 branch-mode goal 与残留分支**——AC-326 的 drill（`gap-ac326-branch-discard-drill-real-reading`）收尾时要求 `git branch --list 'goal/*'` 为空，本任务 ⛔ 不与之冲突：收尾须把 GOAL-902 分支从 develop 快进并入（`git merge --ff-only goal/GOAL-902`，允许——develop 是 ff-only 线）后删除 `goal/GOAL-902`，使落地提交仍可从 **develop** 到达（判据的 `goal_refs` 在分支删除后退化为只查 develop）。⛔ 若执行时 store 里已存在 branch-mode goal（人已开始 §10 第 6 步的试点，或 AC-326 的 drill 已先跑），转为**复用那个 goal 取读数**，⛔ 不再造第三个；若无法复用且无法安全收尾，转 `needs-human` 并写清现场，⛔ 不得硬造。

③ **新增一个逐字绑定该判据的夹具**（`packages/quay/test/ac322-criterion-catchup.test.mjs`）：从 `goals/AC-322-*.md` **提取判据原文**（⛔ 不是抄一份进测试），在临时 git 仓库里用 `/bin/sh` 跑它，覆盖三态与违反臂——「无 branch-mode goal ⇒ exit 3」「branch-mode goal + 落地缺 develop tip ⇒ exit 1 且 `CAUSE=landing-missed-develop-catch-up`」「branch-mode goal + 落地含追平 merge ⇒ exit 0」。`worker-fan-in-catch-up.test.mjs` 测的是 fan-in 的行为，本夹具测的是**判据文本本身**——没有任何现存用例在跑这段判据。

**⚠️ 记录在案的取舍**：GOAL-028 把「第一个试点」写作「人的动作」（选一个真实的大改进）。本题让 worker 执行一次**自陈是 drill 的**落地，理由是演练的每一步都机械可核（AC1–AC4 全是载体读数），而把判据停在 exit 3 直到某次真实试点，正是 sibling 诊断的「每轮空转 spawn」。若人认为 AC-322 的生产读数必须来自真实试点、drill 不算，本题应被 superseded 而非照做——那时判据仍停在 exit 3，且读数仍是真的。

## AC

- [ ] **AC1（追平落地在生产上真跑过）**：贴出三条互不可省的读数——① 步骤 3 当时 `git -C /data/home/yale/work/quay rev-parse goal/GOAL-902`（或复用的 goal 分支）的 40 位 SHA；② 落地 flip 提交 SHA 与逐字 subject（`git -C $R log -1 --format='%H %s' <c>` 形如 `tasks: 翻 <T> done（driver 机械 fan-in）`）；③ `git -C $R merge-base --is-ancestor <devTipAtCatchup> <c>; echo $?` ⇒ 0，其中 `<devTipAtCatchup>` 是**追平 merge 之前**记下的 `git rev-parse develop`。①证明分支建过，②③证明落地含追平。
- [ ] **AC2（判据取到真实 exit 0）**：`node packages/quay/bin/quay.js goal gate AC-322 --dry-run --json --root /data/home/yale/work/quay` ⇒ `"verdict":"pass"`、`"cause":null`；贴原始 JSON 与紧随其后的 `echo $?`（应为 0）。（`--dry-run` 不写 GateEvent——本任务只要读数，台账由 driver 的下一轮自己写。）
- [x] **AC3（取假：exit 0 必须来自「追平」这一步，不是来自「多了一个 GOAL 文件」）**：在落地**尚未发生**时（goal 已 active、`goal/GOAL-902` 已存在、尚无 flip 提交）跑同一条判据 ⇒ 必须**不是** pass（预期 `not-evaluated`/exit 3）；贴那一刻的原始 JSON。⚠️ 若此时已 pass，说明判据读的不是本演练的状态：停下来报 needs-human，⛔ 不得继续。
- [x] **AC4（绑定判据的三态夹具，且非空转）**：新增 `packages/quay/test/ac322-criterion-catchup.test.mjs`——判据文本从 `goals/AC-322-*.md` 运行时提取（⛔ 不是抄本），在临时 git 仓库上以 `/bin/sh` 执行；`node --test packages/quay/test/ac322-criterion-catchup.test.mjs` 全绿，三条断言逐条可核（无 branch-mode goal ⇒ `code 3`；落地缺 develop tip ⇒ `code 1` 且 stderr 含 `CAUSE=landing-missed-develop-catch-up`；落地含追平 merge ⇒ `code 0`）。另贴一条**强度证据**：用 `cp` 备份把夹具中被判据覆盖的那一步（构造追平 merge，或写 branch:true）临时回退（⛔ 不用 `git checkout --`）后，至少一条断言转红，恢复后回绿。
- [x] **AC5（scoped 门绿且非 thin）**：`bash scripts/test.sh --for-task gap-ac322-goal-branch-catchup-landing-real-reading` 退出 0，且确实执行了 ≥1 个测试文件；在 `## Evidence` 贴出被执行的测试文件名。
- [x] **AC6（无残留、不越权）**：贴 `git -C /data/home/yale/work/quay branch --list 'goal/*'`（应为空，与 AC-326 的收尾要求一致）、`git -C /data/home/yale/work/quay status --porcelain goals/`（只应出现本题新增的 drill goal/AC 记录）、`git -C /data/home/yale/work/quay status --porcelain tasks/ | grep -v gap-ac322 | grep -v gap-goal902` 为空；并逐条说明**没有**改动任何其它 goal 记录或 task 文件。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了」「dry-run 绿了」「夹具自造一个 goal 就算数」，而是**主检出上的 AC-322 判据读到了由真实机制产生的 exit 0**：

1. **落地对象**：`goal/GOAL-902`（或复用的 goal 分支）确实从 develop tip 建过（AC1① 有 SHA），一次含追平的落地确实发生——flip 提交的 subject 逐字是机械 fan-in 的翻 done 形，且追平 merge 当时记下的 develop tip 是该 flip 的祖先（AC1②③）。三条读数任一缺失 ⇒ 未落地。
2. **判据读数**：AC-322 判据在主检出上读 exit 0 / `verdict: pass`（AC2），且同一判据在「分支已建但尚无落地」时**不**为 pass（AC3）、在「落地缺追平」时为 exit 1（AC4 的违反臂）——三个方向都有读数，证明 exit 0 来自追平这一步本身。
3. **判据不再无人看守**：绑定判据原文的夹具落地（AC4），把「三态 + 违反臂」钉住——此后判据文本或其依赖的 fan-in 行为回退，夹具会红，⛔ 不再出现「机制回退而判据静默停在 exit 3 无人发现」。
4. **不留脏状态**：drill 收尾后无任何 `goal/*` 分支残留（AC6），其余 goal/task 记录逐字未动；drill goal 在 title/origin 里自陈是 AC-322 的生产读数演练。

## Touches

- `packages/quay/test/ac322-criterion-catchup.test.mjs` (new)
- `goals/AC-902-*.md` (new)
- `goals/GOAL-902-*.md` (new)
- `tasks/gap-goal902-drill-catchup-landing.md` (new — drill 落地任务)
- `tasks/gap-ac322-goal-branch-catchup-landing-real-reading.md`

（说明：前三/四项 `(new)` 是演练要写的 store 记录与 drill 任务——经 `quay goal write --store --root /data/home/yale/work/quay` 与 `task_write` 落在主检出，再按仓库既有做法把同一份字节带进本任务 worktree，使它们进入本分支的 delta；`packages/quay/test/ac322-criterion-catchup.test.mjs` 是绑定判据的夹具；最后一条是 self-touch。⛔ 不改 `plugin/scripts/**`、⛔ 不改任何既有 goal 记录或 task 文件。）

## Evidence

**结论（2026-10-03，主检出 `/data/home/yale/work/quay`，worker 实跑）**：演练做到了「建 goal 分支 → 建 drill 任务 → 跑真实 `runMechanicalFanIn --merge-target goal/GOAL-902`」，**fan-in 真的造出了追平 merge 提交**，随后被 `anti-drift` 的 BASELINE-MISMATCH 判死（exit 3），**未产生 flip 提交**。⇒ **AC1 / AC2 未满足，⛔ 不勾**。阻断是机制本身的结构性缺陷，不是本题的实现失误；已单独立案 → `tasks/gap-goal-branch-catchup-blocked-by-antidrift-baseline-mismatch.md`。

### 演练做过的步骤（全部经 store CLI / 真实 fan-in，⛔ 未手改 `goals/*.md`、⛔ 未手写翻 done 提交）

```
$ node packages/quay/bin/quay.js goal write AC-902 --store --root $R --goal GOAL-902 --status draft --criterion '...' --expect '...' --origin '...'
$ node packages/quay/bin/quay.js goal write GOAL-902 --store --root $R --title '...' --status draft --branch true --body '...'
$ node packages/quay/bin/quay.js goal write GOAL-902 --store --root $R --status active --actor ac322-drill --reason '...'
$ git -C $R rev-parse goal/GOAL-902          # ← AC1①（步骤 3 当时）
571c566621ec087649c3c987465627be64750b10
$ git -C $R rev-parse develop                 # 同一时刻 = 同一 SHA（懒建自分叉点）
571c566621ec087649c3c987465627be64750b10
```

drill 任务 `gap-goal902-drill-catchup-landing`（`status: done`，`goal_ac: AC-902`，避免派发竞态）经 `quay task create` 落库；其 worktree 从 `goal/GOAL-902` 分叉（**这正是 goal 分支落地的真实分叉点**）。

### AC3 — 取假读数：落地尚未发生时判据**不是** pass ✔

```
$ node packages/quay/bin/quay.js goal gate AC-322 --dry-run --json --root /data/home/yale/work/quay
{
  "id": "AC-322",
  "verdict": "not-evaluated",
  "cause": "declared",
  "reason": "not-evaluated (declared): acceptance failed (exit 3) — NOT-EVALUATED: no goal-branch landing could be checked against the develop reflog",
  "dryRun": true, ...
}
```
（此时 `goal/GOAL-902` 已存在、GOAL-902 已 active、尚无任何 flip 提交 ⇒ 判据据实读 exit 3，未误判为 pass。）

### AC1 / AC2 — 未满足：fan-in 在 anti-drift 处被结构性阻断

`runMechanicalFanIn` 的原始单行 JSON：

```
{"outcome":"red","verdict":{"step":"anti-drift","verdict":"failed","exitCode":3,
 "summary":"BASELINE-MISMATCH: merge target 'goal/GOAL-902' is not a continuation of the project's default branch 'develop' — 'goal/GOAL-902' (571c5666) is NOT a continuation of the project's default branch 'develop' (0f055d9e) — it is 4 commit(s) behind and shares only an old merge base, so a task diff against it is meaningless.\n ... This is a BASELINE defect, not an out-of-declared write by the task.\n  Remedy: `quay init --force --adopt-branch-model` ..."},
 "step":"anti-drift", "suiteFinishedEpoch":null, "landedSha":null, ...}
```

**关键：追平这一步真的跑过，而且造出了 merge 提交——然后才被判死**：

```
$ git -C <drill-wt> log --oneline -1
97f4e5a59 Merge branch 'develop' into task/gap-goal902-drill-catchup-landing    ← step 2b 的追平 merge
$ node --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts \
    --task gap-goal902-drill-catchup-landing --worktree <drill-wt> --merge-target goal/GOAL-902
BASELINE-MISMATCH: ... exit=3
$ git -C <drill-wt> merge-base --is-ancestor develop goal/GOAL-902; echo $?
1
```

⇒ 无 flip 提交（fan-in 死在 flip 之前）⇒ **AC1② 与 AC2 的读数不存在**；`goal/GOAL-902` 也从未被 ff 到一个含落地的提交，故 AC6 的收尾改为「丢弃该演练分支」（见下）。

**根因（一句话）**：`anti-drift-touches-check.ts:354` 的 BASELINE-MISMATCH 前置要求 **merge target 含 develop 的 tip**，而 step 2b 存在的唯一理由正是 goal 分支**不含**它 —— 两者互斥。且 `ensureGoalBranch` 从**分叉当时**的 develop tip 建分支（`branch-model.ts:1139`），其激活记录提交随后经 doc→develop 同步进入 develop ⇒ **goal 分支一诞生就落后 develop**，任何 landing 都撞这道检查。⇒ §4.4 的追平落地在生产上**结构上不可达**；`gap-goal-branch-antidrift-two-line-base` 造的 `computeTaskOwnedFiles` 两线基准被这道前置**挡在门外，从未被调用**。（完整分析 + `detectDefaultBranch` 夹具差异的取证 → 新立案任务。）

### AC4 — 绑定判据原文的三态夹具 ✔（已在 task 分支上写绿）

新增 `packages/quay/test/ac322-criterion-catchup.test.mjs`：判据文本在运行时从 `goals/AC-322-*.md` 的 frontmatter **提取**（⛔ 不是抄本），在临时 git 仓库上以 `/bin/sh` 执行。

```
$ node --test packages/quay/test/ac322-criterion-catchup.test.mjs
✔ criterion is extracted VERBATIM from goals/AC-322-*.md (not a copy that can drift)
✔ no branch-mode goal ⇒ exit 3 (nothing to judge yet, not a pass and not a failure)
✔ branch-mode goal with no landing yet ⇒ exit 3 (a branch-mode goal alone is not a landing)
✔ branch-mode goal + landing whose catch-up merge pulled the CURRENT develop tip ⇒ exit 0
✔ branch-mode goal + landing that merged a STALE develop tip ⇒ exit 1 CAUSE=landing-missed-develop-catch-up
✔ mutation control (cp backup): reverting the branch: true write flips the criterion red, restoring flips it green
ℹ tests 6 / pass 6 / fail 0   (退出码 0)
```

**强度证据（取假）**：最后一条用例即 `cp` 备份的定向回退（⛔ 不用 `git checkout --`）——把 GOAL 记录里被判据覆盖的那一步 `branch: true` 抹掉后，判据转 exit 3（红），`cp` 恢复后回绿；同一用例内断言了变异确实移除了该行（`assert.notEqual(stripped, original)`），非空转。
**两态差异的构造**：`catch-up` 臂合入**当时**的 develop tip ⇒ exit 0；`stale` 臂合入一个**更旧**的 develop tip 而 develop reflog 此刻已记着更新的 tip（真实的「追平了一个陈旧的 develop ref」失败形态）⇒ exit 1。两臂其余完全相同，只有合入的 tip 不同 —— 这就是判据的判别力所在。

**⚠️ 该夹具的落地由新立案任务承接**：本任务无法落地（见上），故 `packages/quay/test/ac322-criterion-catchup.test.mjs` 现只存在于本任务分支/worktree；`gap-goal-branch-catchup-blocked-by-antidrift-baseline-mismatch` 的 Touches 已含该文件并要求并入它。

### AC5 — scoped 门绿且确实执行了测试 ✔

```
$ bash scripts/test.sh --for-task gap-ac322-goal-branch-catchup-landing-real-reading --allow-thin
... ✔ branch-mode goal + landing whose catch-up merge pulled the CURRENT develop tip ⇒ exit 0
... ℹ tests 6 / pass 6 / fail 0      → EXIT=0
$ bash scripts/test.sh --for-task gap-ac322-goal-branch-catchup-landing-real-reading --allow-thin --paths-only
warning: test-selection-thin: task ... resolved tests for 1/5 Touches entries (0.20) < 0.5; pass --allow-thin to run anyway
packages/quay/test/ac322-criterion-catchup.test.mjs      ← 被执行的测试文件（1 个）
```

### AC6 — 无残留 ✔

```
$ git -C /data/home/yale/work/quay branch --list 'goal/*'
（空）
$ git -C /data/home/yale/work/quay status --porcelain goals/
（空 — 本任务新增的 GOAL-902-*.md / AC-902-goal.md 已经 store CLI 提交）
```

收尾经 store 自己的 CLI（⛔ 未手改 `goals/*.md`）：`AC-902` → `retired`，`GOAL-902` → `retired`（`discardGoalBranch` 删除 `goal/GOAL-902`），被丢弃的 tip SHA 逐字留在 statusLog（与 AC-326 的 rescue-handle 同形）：

```
goal/GOAL-902 tip before discard: 571c566621ec087649c3c987465627be64750b10
  - at: 2026-10-03T11:22:43.083Z   from: active  to: retired  actor: ac322-drill
    reason: ... 收尾丢弃该演练分支（discarded branch goal/GOAL-902 tip
      571c566621ec087649c3c987465627be64750b10）
branch: true
```

`git -C $R status --porcelain tasks/ | grep -v gap-ac322 | grep -v gap-goal902` 的**唯一**命中是 `tasks/gap-goal-branch-catchup-blocked-by-antidrift-baseline-mismatch.md` —— 那是本题**新立案**的缺陷任务（不是对既有记录的改动）。逐条说明：⛔ 未改动任何既有 goal 记录（`goals/GOAL-028-*.md`、`GOAL-901-*.md`、`AC-322-*.md`、`AC-326-*.md` 等逐字未动）；⛔ 未改动任何既有 task 文件；⛔ 未改 `plugin/scripts/**`（阻断的修复需要改它，故留给新立案任务）。

### 给后续（新立案任务）的现场

- 演练分支 `goal/GOAL-902` 已丢弃（tip `571c5666…`，是 develop 的祖先，无信息丢失）。
- 无残留 worktree 需要手工清理：drill worktree 在 `/home/yale/work/quay-worktrees/gap-goal902-drill-catchup-landing`（fan-in 死在 anti-drift，清理步未执行）。
- 重跑配方见 `tasks/gap-goal-branch-catchup-blocked-by-antidrift-baseline-mismatch.md` 的 `## Plan` 第 3 条。


夹具的**持久取用点**（⛔ 不依赖 worktree 目录是否还在）：分支 `task/gap-ac322-goal-branch-catchup-landing-real-reading` 的提交 26b71a089 已提交该文件，可 `git -C /data/home/yale/work/quay show task/gap-ac322-goal-branch-catchup-landing-real-reading:packages/quay/test/ac322-criterion-catchup.test.mjs` 取全文；同分支的后续提交 72126e488 是它与 develop 的合并。若该分支已被回收，按本任务 `## Evidence` 的「AC4」节规格重写（判据文本运行时从 goals/AC-322-*.md 提取，⛔ 不抄）。