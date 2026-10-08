---
id: gap-goal030-ac338-slice-smoke-verification
title: GOAL-030 AC-338 补：六文件整片 smoke——在 goal 判据树上实跑 scripts/test.sh 六文件集、修红、并证判据能取假
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal030-promotion-writes-via-kernel-transition
goal_ac: AC-338
---
**type:** execution

## Proposal

AC-338 是 GOAL-030 的「测试与 smoke」**整片**验收：`scripts/test.sh` 跑六个文件全绿（至少 6 个测试）。六个文件横跨 ①（`packages/quay/src/kernel/task-transition.ts` 的 kernel 转移决策与事件写入）与 ②（`plugin/scripts/ready-pool-check.ts` 的两条写入接线）两块产物，外加边表、载体注册表与两个既有 characterization 快照。它是**整片**判据，不属于任何单个块的验收面。

落笔当轮读数（2026-10-08，报告时刻 2026-10-08T04:06:22Z）：AC-338 `exit 1`，`CAUSE=test-file-absent — plugin/test/ready-pool-check-transition-writes.test.mjs`。在 goal 判据树 `/home/yale/work/quay-worktrees/goal-GOAL-030`（tip `5aec19d2d` = `goal/GOAL-030` tip）上，六个文件里 **5 个已存在**（`packages/quay/test/task-transition.test.mjs`、`packages/quay/test/lifecycle-edge-table.test.mjs`、`plugin/test/carrier-registry-completeness.test.mjs`、`packages/quay-native/test/characterization-store-write.test.mjs`、`packages/quay/test/characterization-serve-routes.test.mjs`），**唯一缺的第 6 个是 ② 的产物**（`plugin/test/ready-pool-check-transition-writes.test.mjs`，存在于 `task/gap-goal030-promotion-writes-via-kernel-transition` 分支 tip `07ee32697`，尚未 fan-in 到 goal 树；② 状态 `ready`、worker PID 352427 在飞）。⇒ 本任务**不重建**该文件，只声明 `depends_on: gap-goal030-promotion-writes-via-kernel-transition`，待其落地后取整片读数。

**为什么声称 AC-338 的既有任务没守住**：`gap-goal030-kernel-task-transition-and-status-event`（frontmatter `goal_ac: AC-338`，status `done`）自己的 AC5 只跑了**另一个四文件集**（`packages/quay/test/task-transition.test.mjs` + `packages/quay/test/lifecycle-edge-table.test.mjs` + **`plugin/test/task-ops.test.mjs`** + `plugin/test/carrier-registry-completeness.test.mjs`）——既**不含** AC-338 要求的 `ready-pool-check-transition-writes.test.mjs` 与两个 `characterization-*` 文件，又**多出**一个不在判据内的 `task-ops.test.mjs`。因此 **AC-338 按原文（六文件集，含 `scripts/test.sh` 的静态相位）从未被任何任务真正跑过一次**；① 的绿是「另一组文件的绿」，不是本条 AC 的绿。这不是 ① 的实现缺陷，而是它声称的 AC 与实际验证集合不一致（硬规则 2：按位置判定，不按关键词；硬规则 5b：修一个实例 ≠ 只有一个）。

<!-- dedup-ref -->
关联任务（traceability，非本任务新增前置；本任务唯一前置已在 frontmatter `depends_on` 声明）：② `gap-goal030-promotion-writes-via-kernel-transition`（goal_ac: AC-336，在飞）产出缺失的第 6 个文件；① `gap-goal030-kernel-task-transition-and-status-event`（goal_ac: AC-338，done）产出 kernel 侧其余测试。本任务与 ①、② 的验收面不同：①、② 各自验自己产出的文件，本任务验**六文件整片集**是否真被 `scripts/test.sh` 跑绿（含静态相位），故 separate、不合并。

范围：
1. 待 ② 落地后，在 goal 判据树根 `/home/yale/work/quay-worktrees/goal-GOAL-030` 用 bash 执行 `quay goal show AC-338` 的 criterion，须 `exit 0` 且 stdout 含 `PASS:`。
2. 若红：在本任务内修复真正导致红的文件（含 ② 已落地的产物——② 此时已 `done`，不再在飞），并把真正改动过的文件按实写入 `## Touches`（anti-drift：committed delta ⊆ Touches）。
3. 若红且原因属 GOAL-030 §停止扩大范围的健康度信号（分支自举身份 / 架构 / 基线漂移 / 生产污染），⛔ 不以改判据、改测试断言或 `--override` 换绿；同处给出直接量根因与临时红集，如实上报。
4. 证明判据能取假：cp 移走六文件之一后重跑判据须 `exit 1` 且 stderr 含 `CAUSE=test-file-absent`，cp 还原后 `exit 0`。

⛔ 非目标：不新建 ② 的产物 `plugin/test/ready-pool-check-transition-writes.test.mjs`；不改 AC-338 判据本身；不为取绿而放宽任何测试断言。

## AC

- [x] AC-338 判据在 goal 判据树根 `/home/yale/work/quay-worktrees/goal-GOAL-030` 取 0（`quay goal show AC-338` 的 criterion，用 bash 执行），`exit 0` 且 stdout 含 `PASS:`；完整 stdout/stderr 进 Evidence
- [x] 六文件在 goal 树根齐备（六个 `test -f` 全 `exit 0`），且第 6 个文件来自 ② 的 fan-in：`git -C /data/home/yale/work/quay log -1 --format=%H goal/GOAL-030 -- plugin/test/ready-pool-check-transition-writes.test.mjs` 的 sha 可在 `goal/GOAL-030` 上读出（⛔ 本任务未新建该文件）
- [x] 整片 smoke 读数已固化：Evidence 与 `docs/rup/goal030-ac338-slice-smoke.md` 同时给出 `scripts/test.sh <六文件>` 的输出摘要（`tests N ≥ 6`、`fail 0`、静态相位结论）与 goal 判据树 tip sha
- [x] 判据强度能取假（负对照；⛔ 不用 `git checkout` 还原）：cp 移走 `packages/quay/test/lifecycle-edge-table.test.mjs` 后重跑判据须 `exit 1` 且 stderr 含 `CAUSE=test-file-absent`；cp 还原后须 `exit 0`；两次 exit 码进 Evidence
- [x] 红即如实上报：判据红且原因属 GOAL-030 §停止扩大范围的健康度信号时，⛔ 不伪造 PASS、不改判据 / 不放宽断言 / 不用 `--override` 换绿；同处给出直接量根因与临时红集

## DoD

真实落地 = AC-338 判据在 goal 判据树（goal 分支 tip）上被**真实执行一次**并 `exit 0`，且该次执行是**六文件整片集**（含 `scripts/test.sh` 的静态相位），不是任何子集的重放；读数同时固化在任务库（`## Evidence`）与 `docs/rup/goal030-ac338-slice-smoke.md`。

本任务经 goal/GOAL-030 分支落地（mergeTarget 由 `goal_ac: AC-338` ⇒ GOAL-030 解析），⛔ **本任务产出的 `docs/rup/goal030-ac338-slice-smoke.md` 与任何源码/测试改动不落 develop**：GOAL-030 并入前 `git show develop:docs/rup/goal030-ac338-slice-smoke.md` 不存在。
如实注记（⛔ 不要拿一条已在落笔当轮为假的判据）：任务记录文件 `tasks/<id>.md` 由 `task_write` 随状态写入、经 doc→develop 同步机制传播——落笔当轮实测它**已在 `develop` 上**，与同批兄弟 GOAL-030 任务（①、②）一致，故 `git show develop:tasks/<id>.md` **不是**本条的判据；判据取 `docs/rup/…` 与源码 delta 的可见性。

⛔ 不新建 ② 的产物 `plugin/test/ready-pool-check-transition-writes.test.mjs`。

## Touches

- tasks/gap-goal030-ac338-slice-smoke-verification.md
- docs/rup/goal030-ac338-slice-smoke.md
- packages/quay/test/task-transition.test.mjs
- plugin/test/ready-pool-check-transition-writes.test.mjs
- packages/quay/test/lifecycle-edge-table.test.mjs
- plugin/test/carrier-registry-completeness.test.mjs
- packages/quay-native/test/characterization-store-write.test.mjs
- packages/quay/test/characterization-serve-routes.test.mjs

## Evidence

**取证时刻**：2026-10-08T04:52:10Z（本机 +0800 = 12:52:10）；主机 VM-16-5-ubuntu（nproc=128）。判据树 = `/home/yale/work/quay-worktrees/goal-GOAL-030`，**tip sha `e20ef12140bf3efef3c699b93044d84fcc83cde9`**（= `git rev-parse goal/GOAL-030`，判据树 HEAD 同值）。完整取证稿：`docs/rup/goal030-ac338-slice-smoke.md`。

**AC1（判据在 goal 判据树根取 0）** —— `exit 0`，stdout 含 `PASS:`，stderr 空：

```
（stdout）
PASS: scripts/test.sh on 6 files (kernel transition, ready-pool-check wiring, edge table, carrier registry, store-write golden, serve-route snapshot smoke): 26 tests, 0 fail

（stderr）
（空）
```

同一判据在本任务 worktree 根（同 tip `e20ef1214`）独立复跑，同得 `exit 0` + 同一 `PASS:` 行（26 tests, 0 fail）——两次读数一致。

**AC2（六文件齐备 + 第 6 个来自 ② fan-in）** —— 六文件在 goal 树根逐个 `test -f` 全 `exit 0`；第 6 个文件 sha 可在 `goal/GOAL-030` 上读出：

```
$ git -C /data/home/yale/work/quay log -1 --format=%H goal/GOAL-030 -- plugin/test/ready-pool-check-transition-writes.test.mjs
62f01fe135d0fa78ea757941de4659e20e8820ff
$ git -C /data/home/yale/work/quay show -s --format='%ci %s' 62f01fe1…
2026-10-08 11:55:27 +0800 GOAL-030 ②: promotion path writes status via kernel transition decision + event
$ git merge-base --is-ancestor 62f01fe1… goal/GOAL-030   ⇒ ancestor: YES
```

⛔ 本任务未新建该文件（工作树 `git status` 对该文件为空）。

**AC3（整片 smoke 读数固化）** —— `scripts/test.sh <六文件>` exit 0 摘要：`tests 26`（≥6）、`fail 0`、`pass 26`、`cancelled 0`、`skipped 0`、`duration_ms 3666.368`。静态相位结论：整跑 `exit 0` ⇒ 无阻断违规；`checker-mutation-check --selftest: ALL PASS`、`checker-count-drift-check … PASS (3/3 evaluated)`、阻断检查 `violations: 0`；一处 `exit=1 FAIL …`（输出第 616 行）为 `repo-root-derivation-check` 的 **mutation 自检 arm 2 RED**（故意植入缺陷），其后紧跟 arm 3 GREEN（unmutated restored，exit 0）与 `case OK … took all three values (0/1/3)`——非本集失败；19 条任务文件语法违规经台账明示**非阻断**。同一读数固化于 `docs/rup/goal030-ac338-slice-smoke.md`（含 goal 判据树 tip sha `e20ef12140bf3efef3c699b93044d84fcc83cde9`）。

**AC4（判据能取假 / 负对照）** —— 本任务 worktree（同 goal tip）上 `cp` 移走 `packages/quay/test/lifecycle-edge-table.test.mjs` 后重跑判据：`exit 1`，stderr `CAUSE=test-file-absent — packages/quay/test/lifecycle-edge-table.test.mjs (the slice's own tests must exist before this AC can pass)`；`cp` 还原后 `exit 0`（`PASS: … 26 tests, 0 fail`）。三次 exit 码：`0 → 1 → 0`。还原完整性：md5 移走前后均 `c9c12c76d726c86e969c28d6b6108211`，`git status --short` 对该文件为空（⛔ 未用 `git checkout`）。

**AC5（红即如实上报）** —— 本次判据 **绿（exit 0）**，未触发 GOAL-030 §停止扩大范围的健康度信号（分支自举身份 / 架构 / 基线漂移 / 生产污染）⇒ 不存在「伪造 PASS、改判据、放宽断言、`--override` 换绿」的情形；本条在前件为假（无红）下满足，直接量 = 判据 exit 码 0 与 `fail 0`。

**DoD** —— 判据在 goal 判据树（goal 分支 tip `e20ef1214`）上被真实执行一次并 `exit 0`，且为六文件整片集（含 `scripts/test.sh` 静态相位），非任何子集重放。`git show develop:docs/rup/goal030-ac338-slice-smoke.md` ⇒ ABSENT（GOAL-030 并入前不落 develop，符合 DoD）。
