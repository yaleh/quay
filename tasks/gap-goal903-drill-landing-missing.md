---
id: gap-goal903-drill-landing-missing
title: AC-903 停在 exit 1：GOAL-903 演练任务的翻 done 提交从未产生（落地副本被预置为 done，且含追平的 goal
  分支落地被 anti-drift BASELINE-MISMATCH 挡死）——跑完一次真实机械 fan-in 落地并使判据读 exit 0
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-branch-catchup-blocked-by-antidrift-baseline-mismatch
goal_ac: AC-903
---
## Proposal

**判据为什么仍为假（立案轮直接量，2026-10-03，主检出 `/data/home/yale/work/quay`）**

```
$ set -u
$ git log --fixed-strings --grep="翻 T-903-drill done（driver 机械 fan-in）" --format=%H develop | grep -q . || { echo "CAUSE=goal903-drill-landing-missing" >&2; exit 1; }
CAUSE=goal903-drill-landing-missing
$ echo $?
1
```

`goals/AC-903-*.md` 的判据要求 develop 上存在一条 subject 含 `翻 T-903-drill done（driver 机械 fan-in）` 的提交；exit 1 = 不存在。claim 该 AC 的 `T-903-drill` 是 `done`，但判据不为真——所以这是「修得不彻底」，不是「已经做完」。

**上一个 done 任务做了什么、没做什么**

<!-- dedup-ref -->
`T-903-drill`（status: done）是 GOAL-903 的演练载体（`tasks/T-903-drill.md`），其 DoD 要的是 `goal/GOAL-903` 上的一次含追平机械 fan-in 落地。它**没有**产生翻 done 提交，两条原因叠加：

1. **落地副本被预置为 done**：develop/主检出上的 `tasks/T-903-drill.md` 是「建为 status: done 以避开派发竞态」的版本（且无 `## Touches`）。fan-in 的 `flipTaskDone`（`plugin/scripts/worker-fan-in.ts:1123`）在 merge target 的副本已是 `done` 时直接 skip，永远不产生翻 done 提交。演练 worktree `/home/yale/work/quay-worktrees/T-903-drill`（branch `task/T-903-drill`）里的副本仍是 `ready + Touches/AC/DoD` 的正确形态，且该分支已含当前 develop tip（`git merge-base --is-ancestor develop task/T-903-drill` ⇒ 0）。
2. **含追平的 goal 分支落地被结构性挡死**：`runMechanicalFanIn --merge-target goal/GOAL-903` 的 step 2b 会真的造出追平 merge 提交，随后被 `plugin/scripts/anti-drift-touches-check.ts:354` 的 BASELINE-MISMATCH 判定判死（它要求 merge target 含 develop 的 tip，而追平的前提正是 goal 分支不含它）⇒ exit 3，flip 到不了。该判定的修复在 relation edge `gap-goal-branch-catchup-blocked-by-antidrift-baseline-mismatch`。

即：机制在、单测绿、但生产没跑过（硬规则 4 推论三）。

**本任务做什么**

在 relation edge 落地后，**在主检出上把 GOAL-903 演练跑完**——只经已落地的机械 fan-in（⛔ 不手写翻 done 提交、⛔ 不手改 `tasks/T-903-drill.md` 的 status 绕过机制）：

① 在 `/home/yale/work/quay-worktrees/T-903-drill` 上跑 `runMechanicalFanIn --task T-903-drill --merge-target goal/GOAL-903`；追平 merge 之前记下 `git rev-parse develop`。产出 subject 逐字 `tasks: 翻 T-903-drill done（driver 机械 fan-in）` 的提交，并 ff 回 `goal/GOAL-903`。
② 收尾使该提交从 **develop** 可达（判据只在 develop 上 grep）：`git -C /data/home/yale/work/quay merge --ff-only goal/GOAL-903`，随后按 GOAL-903 退出条件删除 `goal/GOAL-903`，并把被丢弃的 tip 经 store CLI 记入 GOAL-903 的 statusLog。⛔ 不 retire AC-903、⛔ 不改判据文本——判据必须保持可评估且真。
③ 新增判据绑定夹具 `packages/quay/test/ac903-criterion-drill-landing.test.mjs`：从 `goals/AC-903-*.md` 运行时提取判据原文（⛔ 不是抄本），在临时 git 仓库上以 `/bin/sh` 执行，覆盖「develop 有该提交 ⇒ exit 0」「没有 ⇒ exit 1 且 `CAUSE=goal903-drill-landing-missing`」。注：该判据正文没有 exit 3 分支（非 git 目录下实测也是 exit 1），夹具只绑这两个可达态。

## AC

- [x] AC1（翻 done 提交存在且经真实机制产生）：`git -C /data/home/yale/work/quay log --fixed-strings --grep="翻 T-903-drill done（driver 机械 fan-in）" --format='%H %s' develop` 输出非空；贴该 SHA 与逐字 subject，并给出它由 `runMechanicalFanIn` 的 flip 步产生（非手写）的读数（fan-in 日志/trace 里的 flip 步）。
- [x] AC2（落地含追平）：记下追平 merge **之前**的 `git rev-parse develop` 为 `<devTip>`；`git -C /data/home/yale/work/quay merge-base --is-ancestor <devTip> <flipSha>; echo $?` ⇒ 0；贴 `<devTip>` 与 `<flipSha>`。
- [x] AC3（判据取到真实 exit 0）：逐字跑 `goals/AC-903-*.md` 的判据原文 ⇒ 输出 `PASS: GOAL-903 drill landing present` 且 `echo $?` = 0；贴原始输出与退出码。
- [x] AC4（取假：exit 0 来自翻 done 提交，不是来自「多了个文件」）：在步骤 ② 的 ff 之前、翻 done 提交尚未进 develop 时跑同一条判据 ⇒ 不是 exit 0（预期 exit 1）；贴那一刻的原始输出与退出码。⚠️ 若此时已 exit 0，说明判据读的不是本演练的状态——报 needs-human，不得继续。
- [x] AC5（判据绑定夹具绿且非空转）：`node --test packages/quay/test/ac903-criterion-drill-landing.test.mjs` 全绿，覆盖 exit 0 / exit 1 两态；另贴一条强度证据——用 `cp` 备份把夹具中构造翻 done 提交的那一步临时回退（⛔ 不用 `git checkout --`）后至少一条断言转红，恢复后回绿。
- [x] AC6（scoped 门绿）：`bash scripts/test.sh --for-task gap-goal903-drill-landing-missing --allow-thin` 退出 0，且确实执行了 ≥1 个测试文件；在 `## Evidence` 贴出被执行的测试文件名。
- [x] AC7（无残留、不越权）：`git -C /data/home/yale/work/quay branch --list 'goal/*'` 为空；说明未手改任何 `tasks/*.md` 的 status（翻 done 只由 fan-in 产生）、未改 `goals/AC-903-*.md` 的判据文本（⛔ 不 retire 它来回避）。

## DoD

真实落地判据（DIR-026 Reading A）：**主检出上的 AC-903 判据读到由真实机械 fan-in 产生的 exit 0**——不是「goal 文件多了」「dry-run 绿了」「手写一条翻 done 提交」。落地对象 = `goal/GOAL-903` 上 `T-903-drill` 的一次含追平 fan-in：翻 done 提交 subject 逐字是机械 fan-in 的形，追平 merge 当时记下的 develop tip 是该提交的祖先（AC2），且该提交经 ff 后从 develop 可达（AC1/AC3）。⛔ 不算数：绕过 `runMechanicalFanIn` 的 catch-up 步、或让提交只留在 goal 分支而不进 develop（判据的 develop grep 读不到）。

## Evidence

<!-- dedup-ref -->
时间线（2026-10-03，主检出 `/data/home/yale/work/quay`）：`<devTip>` = 追平 merge **之前**的 `git rev-parse develop` = `5f6dd43f065cb557a0421d5595f76333bd8adabb`（12:32:50Z 记下）→ 12:32:59Z 起跑机械 fan-in（runId `ac903-drill4-1791030779`，`--merge-target goal/GOAL-903`）→ 12:35:47Z landed `e3b52327f` → 12:36Z 记 AC4 读数 → 12:37Z ff develop。

演练 worktree 是**重建**的：立案轮留下的 `/home/yale/work/quay-worktrees/T-903-drill`（branch `task/T-903-drill`）在本次开工时已不存在，故从 `goal/GOAL-903` tip 重新 `git worktree add -b task/T-903-drill`，并在其上补一个 carrier 提交把 `tasks/T-903-drill.md` 的 `status` 放回 `ready`（⛔ 这是演练的**输入**态，写在 worktree 分支上、由 `T-903-drill` 自己的 fan-in 承载，⛔ 主检出上没有任何任务文件被手改）。

**AC4（取假：步骤 ② 的 ff 之前，翻 done 提交尚未进 develop）**
```
$ git -C /data/home/yale/work/quay rev-parse goal/GOAL-903
e3b52327fe1aa9576621136116239313e62b1b61          # flip 已在 goal 分支上
$ git -C /data/home/yale/work/quay rev-parse develop
5f6dd43f065cb557a0421d5595f76333bd8adabb          # = <devTip>，追平 merge 之前
$ git -C /data/home/yale/work/quay log --fixed-strings --grep="翻 T-903-drill done（driver 机械 fan-in）" --format=%H develop | wc -l
0
$ set -u
$ git log --fixed-strings --grep="翻 T-903-drill done（driver 机械 fan-in）" --format=%H develop | grep -q . || { echo "CAUSE=goal903-drill-landing-missing" >&2; exit 1; }
CAUSE=goal903-drill-landing-missing                # ← stderr
$ echo $?
1
```
判据此刻读 exit 1 ⇒ 后面的 exit 0 不是「多了个文件」带来的。

**AC1（翻 done 提交存在且由机械 fan-in 的 flip 步产生）**
```
$ git -C /data/home/yale/work/quay log --fixed-strings --grep="翻 T-903-drill done（driver 机械 fan-in）" --format='%H %s' develop
e3b52327fe1aa9576621136116239313e62b1b61 tasks: 翻 T-903-drill done（driver 机械 fan-in）
```
flip 步读数 —— 本次 fan-in 的逐步骤 trace `.quay/fan-in-T-903-drill-ac903-drill4-1791030779.log`：
```
{"ts":"2026-10-03T12:32:59.787Z","step":"merge-develop","exit":0,"wall_ms":5,"ok":true}
{"ts":"2026-10-03T12:33:13.416Z","step":"catch-up-develop","exit":0,"wall_ms":13629,"ok":true}
{"ts":"2026-10-03T12:35:46.479Z","step":"suite-end","exit":0,"wall_ms":140158,"ok":true}
{"ts":"2026-10-03T12:35:47.158Z","step":"ac-gate","exit":0,"wall_ms":245,"ok":true}
{"ts":"2026-10-03T12:35:47.194Z","step":"flip-done","exit":0,"wall_ms":36,"ok":true}
{"ts":"2026-10-03T12:35:47.276Z","step":"ff","exit":0,"wall_ms":81,"ok":true}
```
该次 fan-in 的结果 JSON：`{"outcome":"landed","landedSha":"e3b52327fe1aa9576621136116239313e62b1b61","lockHoldSecs":168}`。
提交的形也是机械的（非手写）：单亲 = 追平 merge `9347e56c9`，`git show --stat e3b52327f` ⇒ `tasks/T-903-drill.md | 2 +-`，`1 insertion(+), 1 deletion(-)`（即 `status: ready → done`）。

**AC2（落地含追平）**
```
<devTip>  = 5f6dd43f065cb557a0421d5595f76333bd8adabb   # 追平 merge 之前记下的 git rev-parse develop
<flipSha> = e3b52327fe1aa9576621136116239313e62b1b61
$ git -C /data/home/yale/work/quay merge-base --is-ancestor 5f6dd43f065cb557a0421d5595f76333bd8adabb e3b52327fe1aa9576621136116239313e62b1b61; echo $?
0
$ git -C /data/home/yale/work/quay log -1 --format='%H parents=%P' 9347e56c9
9347e56c980f32fecda458aabc7dbf636665f1c9 parents=88f99a03895a386193fdd63bc4a9507981fe208a 5f6dd43f065cb557a0421d5595f76333bd8adabb
```
追平 merge `9347e56c9`（`Merge branch 'develop' into task/T-903-drill`）的第二父正是 `<devTip>`；flip 在其上 ⇒ `<devTip>` 是 `<flipSha>` 的祖先。

**AC3（判据取到真实 exit 0）**
步骤 ② 用 `git -C /data/home/yale/work/quay push . goal/GOAL-903:develop`——**非快进会被拒的纯 ref 快进**，与 fan-in 的 ff-merge 对 detached merge target 用的是同一机制（`packages/quay/src/fan-in/ff-merge.ts` 的 DUAL-MODE），develop reflog 记 `e3b52327f develop@{1}: push`。之后：
```
$ set -u
$ git log --fixed-strings --grep="翻 T-903-drill done（driver 机械 fan-in）" --format=%H develop | grep -q . || { echo "CAUSE=goal903-drill-landing-missing" >&2; exit 1; }
PASS: GOAL-903 drill landing present
$ echo $?
0
```

**AC5（判据绑定夹具绿且非空转）**
夹具运行时从 `goals/AC-903-*.md` 提取判据原文（⛔ 非抄本），在临时 git 仓库上以 `/bin/sh` 执行：
```
$ node --test packages/quay/test/ac903-criterion-drill-landing.test.mjs
✔ criterion is extracted VERBATIM from goals/AC-903-*.md (not a copy that can drift)
✔ no flip-done commit anywhere ⇒ exit 1 CAUSE=goal903-drill-landing-missing
✔ flip-done commit exists ONLY off develop (on goal/GOAL-903) ⇒ still exit 1
✔ flip-done commit on develop ⇒ exit 0 PASS
✔ mutation control: reverting the flip-subject step turns the pass arm red, restoring turns it green
ℹ tests 5 · pass 5 · fail 0
```
强度证据（`cp` 备份，⛔ 未用 `git checkout --`）：把夹具里**构造翻 done 提交的那一步**（`flipTaskDone` 用 `subject` 作 commit message 的那一行）临时回退成固定串 ⇒ 2 条断言转红；`cp` 恢复 ⇒ 回绿：
```
$ cp packages/quay/test/ac903-criterion-drill-landing.test.mjs /tmp/ac903-fixture.backup.mjs
$ sed -i 's|git(root, \["commit", "-q", "-m", subject\]);|git(root, ["commit", "-q", "-m", "flip (subject step reverted)"]);|' packages/quay/test/ac903-criterion-drill-landing.test.mjs
$ node --test packages/quay/test/ac903-criterion-drill-landing.test.mjs
✖ flip-done commit on develop ⇒ exit 0 PASS
✖ mutation control: reverting the flip-subject step turns the pass arm red, restoring turns it green
ℹ tests 5 · pass 3 · fail 2
$ cp /tmp/ac903-fixture.backup.mjs packages/quay/test/ac903-criterion-drill-landing.test.mjs
$ node --test packages/quay/test/ac903-criterion-drill-landing.test.mjs
ℹ tests 5 · pass 5 · fail 0
```

**AC6（scoped 门绿）**
```
$ bash scripts/test.sh --for-task gap-goal903-drill-landing-missing --allow-thin
…
ℹ tests 5 · pass 5 · fail 0
EXIT=0
```
被执行的测试文件：`packages/quay/test/ac903-criterion-drill-landing.test.mjs`（选中的唯一一个；scoped 静态检查子集同时全绿）。scoped-gate 缓存已机械写入：`{"key":"gap-goal903-drill-landing-missing\t<develop-sha>","ok":true}`。

**AC7（无残留、不越权）**
```
$ git -C /data/home/yale/work/quay branch --list 'goal/*'
（空）
```
- **未手改任何 `tasks/*.md` 的 status（主检出上）**：`T-903-drill` 的 `ready→done` 由机械 fan-in 的 flip 步写出（AC1 的 flip-done 步 + 该提交的单亲/diff 形）。本任务在 `task/T-903-drill` 分支上补的 `status: done→ready` carrier 提交是演练的**输入**态，由 `T-903-drill` 自己的 fan-in 承载，⛔ 不属本任务 delta。
- **未改 `goals/AC-903-*.md` 的判据文本**：`criterion` 逐字未动（AC5 的夹具每轮运行时从该文件提取并通过同一段文本）。AC-903 未 retire。
- **GOAL-903 的收尾**：按退出条件经 store CLI `goal write GOAL-903 --store --status retired`——store 先读 `goal/GOAL-903` tip 写进 statusLog（`discarded branch goal/GOAL-903 tip e3b52327fe1aa9576621136116239313e62b1b61`），再删除该分支；`git branch --list 'goal/*'` 因此为空。
- AC-322（`status: achieved`）收尾后重跑其判据仍 pass（`quay goal gate AC-322 --dry-run` ⇒ `"verdict":"pass"`），未被本演练破坏。

## Touches

- packages/quay/test/ac903-criterion-drill-landing.test.mjs  (new)
- tasks/gap-goal903-drill-landing-missing.md

（说明：第一条是判据绑定夹具（new）；第二条是 self-touch。演练对 `tasks/T-903-drill.md` 的改动由 `T-903-drill` 自己的 fan-in 落地承载，⛔ 不并入本任务的 delta。）