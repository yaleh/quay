---
id: gap-goal030-archguard-before-after-comparability
title: GOAL-030 ④：ArchGuard 前后可比读数——分支 tip 上实跑 AC-339（分叉点 vs tip 单根对照），守五条方向约束 + 负对照
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal030-promotion-writes-via-kernel-transition
goal_ac: AC-339
---
**type:** execution

## Proposal

GOAL-030（goal 分支首个真实试点）的第四条 AC：AC-339「ArchGuard 前后可比」。它不是可独立实现的功能，而是对 ①② 落地后的**分支 tip 与分叉点做同一 archguard 构建的单根前后对照**，并守住五条方向约束：文件数差额与 `git diff` 一致；目录环不增加；`packages→plugin` 为 0；`plugin/scripts→非 kernel` 不上升；`plugin/scripts→kernel` 强度上升。本任务负责把这次对照**实跑并留成可复跑的读数**，⛔ 不新增第二套分析实现——判据本身即正本（`quay goal show AC-339` 的 criterion）。

为什么需要本任务而非自动达成：判据机械可跑，但只有 ②（`ready-pool-check` 改走 kernel）落地后 `plugin/scripts→kernel` 强度才上升，判据才有意义。落笔当轮读数（2026-10-08）：AC-339 `exit 3`（切片未落地）；且 `goal/GOAL-030` 当前等于 develop tip（`git rev-list --count develop..goal/GOAL-030` = 0），判据会走 post-merge 臂并因无 `goal-merge-result` 事件而 `exit 3`——② 落地使分支 tip 领先 develop 后，判据改走 pre-merge 臂（`before = git merge-base HEAD develop`、`after = HEAD`）。

<!-- dedup-ref -->
关联任务（traceability，非前置）：本任务依赖 ② `gap-goal030-promotion-writes-via-kernel-transition`（goal_ac: AC-336）落地 kernel 接线后取读数；与 ① `gap-goal030-kernel-task-transition-and-status-event`（AC-338）、③ `gap-goal030-branch-selfhost-probe`（AC-337）同属 GOAL-030，但验收面独立（① 建能力、② 接线写入、③ 证分支自举身份、④ 证结构前后可比）——故 separate，不合并。

范围：
1. **跑判据**：在本任务 worktree 根（从 `goal/GOAL-030` 开出、已含 ② 的 kernel 接线），用 bash 执行 `quay goal show AC-339` 的 criterion，须 `exit 0`，stdout 含 `PASS: comparable before/after (pre-merge)`。
2. **固化读数**：把 before sha（`git merge-base HEAD develop`）、after sha（`git rev-parse HEAD`）、`mode=pre-merge`、两侧文件数、目录环数、`plugin/scripts→kernel` 与 `→非 kernel` 强度、`packages→plugin` 反向边数，以及本次使用的 archguard CLI 绝对路径（`readlink -f`），写进 `## Evidence` 并落盘到 `docs/rup/goal030-archguard-before-after.md`——使「前后可比」不依赖会被清理的 `/tmp/quay-archbaseline/`。同一构建两棵树各分析一次（criterion 内只有一个 `$cli`，两侧各一次 `git archive` 单根）。
3. **负对照**：cp 备份 `plugin/scripts/ready-pool-check.ts`，临时删掉其 kernel import 行（保留 kernel 模块本身），重跑 criterion 须 `exit 1` 且 stderr 含 `CAUSE=kernel-edge-not-observed`；用备份还原（⛔ 不用 `git checkout` 还原），再跑须 `exit 0`；两次 exit 码进 Evidence。
4. **失败即如实上报**：若任一方向约束被违反（环增 / 文件数差额不符 / `packages→plugin` > 0 / `非 kernel` 上升），⛔ 不得改判据或改探针绕过——它是 GOAL-030 §停止扩大范围「架构」一行定义的**分支不健康**信号；`exit 3` 时定位前提（切片未落地 / archguard CLI 不可解析 / 分析失败）并如实报告。

⛔ 非目标：不新建第二套 archguard 前后对比脚本（判据即正本，另写一套正是 ①② 警告的「第三套实现」）；不改 `plugin/scripts/archguard-runner.ts`（它做的是六 scope `sccCount`，非跨树前后对照）；不改任何源码行为（唯一临时改动是负对照，cp 还原）；不落 develop。

## AC

- [ ] 本任务 worktree 根（从 goal/GOAL-030 开出、已含 ② 的 kernel 接线）运行 GOAL-030 的 AC-339 判据（`quay goal show AC-339` 的 criterion，用 bash 执行）`exit 0`，stdout 含 `PASS: comparable before/after (pre-merge)`；完整 stdout/stderr 进 Evidence
- [ ] 同一构建单根分析：Evidence 贴出 `readlink -f` 后的 archguard CLI 绝对路径，且 before/after 两侧由同一次 criterion 运行分析（一个 `$cli`、两次 `git archive` 单根）
- [ ] 对照读数已固化：Evidence 与 `docs/rup/goal030-archguard-before-after.md` 同时含 before/after 两 sha、`mode=pre-merge`、两侧文件数、目录环数、`plugin/scripts→kernel` 与 `→非 kernel` 强度、`packages→plugin` 反向边数；读数为 `packages→plugin` = 0、环不增、`→非 kernel` 不升、`→kernel` 升（`14→15` 量级）
- [ ] 负对照能取假：cp 备份后临时删掉 `applyPromotions` 的 kernel import，重跑 criterion 须 `exit 1` 且 stderr 含 `CAUSE=kernel-edge-not-observed`；备份还原后 `exit 0`；两次 exit 码进 Evidence（⛔ 不用 `git checkout` 还原）
- [ ] 载体已落盘且可读：`test -f docs/rup/goal030-archguard-before-after.md` exit 0，且该文件含 before/after 两 sha 与 `plugin/scripts→kernel` 强度读数（`grep -cE 'kernel' docs/rup/goal030-archguard-before-after.md` ≥ 1）

## DoD

本任务不改任何源码行为（唯一临时改动是负对照，cp 还原）。真实落地 = AC-339 判据在本任务 worktree 根（goal/GOAL-030 分支开出、含 ② 的 kernel 接线）上 **`exit 0`**，且 before/after 对照读数同时固化在任务库（`## Evidence`）与 `docs/rup/goal030-archguard-before-after.md`（不再只存在于会被清理的 `/tmp/quay-archbaseline/`）。本任务经 goal/GOAL-030 分支落地，⛔ 不落 develop：GOAL-030 并入前 `git show develop:tasks/gap-goal030-archguard-before-after-comparability.md` 与 `git show develop:docs/rup/goal030-archguard-before-after.md` 均不存在。

判据 `exit 1` 且原因属「架构」信号（环增 / 文件数差额不符 / `packages→plugin` > 0 / `非 kernel` 上升）⇒ 停止扩大范围、如实上报；`exit 3` ⇒ 定位前提（切片未落地 / archguard CLI 不可解析 / 分析失败）并如实报告；⛔ 不伪造 PASS，⛔ 不以改判据 / 改探针 / `--override` 换绿。因不改任何源码，本任务不跑 suite（同 gap-status-flip-history-and-parser-diff-readings 的先例）。

## Touches

- tasks/gap-goal030-archguard-before-after-comparability.md
- docs/rup/goal030-archguard-before-after.md
