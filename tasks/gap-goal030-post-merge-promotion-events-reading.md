---
id: gap-goal030-post-merge-promotion-events-reading
title: GOAL-030 ⑥：并入后生产读数——在主检出跑 AC-341 判据，确认并入后每一次生产 promotion-driver
  todo→ready 翻转都在 .quay/task-status-events.jsonl 有 promote 事件
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-341
---
**type:** execution

## Proposal

GOAL-030（goal 分支首个真实试点）的第六条 AC：**并入后生产读数**。AC-341 判的是「GOAL-030 并入 develop 之后，develop 上每一次 promotion-driver 机械晋升 todo→ready 都在 `.quay/task-status-events.jsonl` 有对应的 promote 事件」。它不是可独立实现的功能，而是对 ① ② 落地并并入后**生产真实行为**的读数。

为什么必须有本任务：AC-341 是 GOAL-030 七条 AC 里唯一一条**以「并入 develop 之后的 develop 生产晋升」为求值对象**的。① ② 在 goal 分支上把 kernel 转移决策与事件写入接好线，但它们证明的是分支 tip / 沙盒里的行为（AC-336/337），**证明不了生产上的 promotion-driver 每一次 todo→ready 真的写事件**。若接线在生产侧落空（例如主检出未追上 develop ⇒ 常驻 promotion-driver 仍从主检出工作树加载旧代码），① ② 的绿读数不会暴露它——只有本条的生产读数会。

**求值面（必须在共享主检出根，⛔ 不是任务 worktree）**：AC-341 判据先 `git rev-parse --show-toplevel` 再 `cd`，随后读 `<toplevel>/.quay/gate-events.jsonl`（取 GOAL-030 的 landed `goal-merge-result` 时刻 t）、`<toplevel>/.quay/task-status-events.jsonl`（事件载体），并对 `develop` 的提交主题取 promotion 翻转集合。`.quay/` 是**主检出的运行期载体**（`.gitignore:43` 起 `**/.quay/gate-events.jsonl` 等随 `.quay/` 不入 git），生产 promotion-driver 常驻从主检出工作树加载、把事件写进主检出的 `.quay/`。⇒ **判据在任务 worktree 里跑会把载体读成缺席（假红），必须在共享主检出根跑。**

**落笔当轮读数（2026-10-08，主检出 = author）**：
- `goal/GOAL-030` 存在（tip `6a00432`，落后 develop 6 提交）。
- `.quay/gate-events.jsonl` **无** GOAL-030 的 landed `goal-merge-result` ⇒ AC-341 此刻 `exit 3`（并入前尚未求值，属预期）。
- `.quay/task-status-events.jsonl` **不存在**（kernel 模块尚未并入）⇒ 并入前载体缺席同属预期；本任务须在并入后复评。

**本任务只做读数与诊断（read-only）**：⛔ 不改任何源码（含判据本身、kernel 模块、`ready-pool-check.ts`）；⛔ 不手写 / 补造事件行；⛔ 不为了取绿而改判据。若读数为红，那是 GOAL-030 §停止扩大范围「分支不健康 / 生产污染」方向上的信号，如实记录并上报，⛔ 不以任何方式伪造 PASS。（判据对 `--since=t` 的**全部**翻转求值，所以一旦出现「有翻转无事件」，改代码只能让**未来**的翻转带事件、**不能**追回那一条历史翻转 ⇒ 「改到绿」在本判据上不可达；正确处置是记录根因、把红当作健康度信号，而不是打补丁追绿。）

<!-- dedup-ref -->
关联任务（traceability，非前置）：本任务是 GOAL-030 的第六块。① `gap-goal030-kernel-task-transition-and-status-event`（goal_ac: AC-338）建 kernel 决策与事件写入模块；② `gap-goal030-promotion-writes-via-kernel-transition`（goal_ac: AC-336）把两条写入接线；③ `gap-goal030-branch-selfhost-probe`（AC-337）证沙盒 / 分支自举身份；④ `gap-goal030-archguard-before-after-comparability`（AC-339）证结构前后可比；⑤ `gap-goal030-preview-runs-branch-code`（AC-340）证预览跑分支代码。①-⑤ 的求值面是分支 tip / `/tmp` 沙盒 / 预览实例；**本条是唯一以「并入 develop 之后的生产 promotion-driver 行为」为求值面的**，验收面独立，故 separate、不合并。本任务 read-only、**不声明任何源码 Touches**，故与 ①② 不共享文件、不互相串行（`task-granularity-advice.ts` 对共享源码的既有任务只作 traceability 记录）。

## AC

- [ ] 生产读数已取（共享主检出根）：用 bash 执行 `quay goal show AC-341` 的 criterion（cwd = 共享主检出根 = `git rev-parse --git-common-dir` 的父目录，⛔ 非任务 worktree），exit 码与完整 stdout/stderr 逐字进 `## Evidence`；`exit 3` 时须写明未满足的前提（无 landed `goal-merge-result` / 并入后尚无生产晋升）
- [ ] 并入时刻与翻转集合已固化：`## Evidence` 与 `docs/rup/goal030-post-merge-reading.md` 同时给出——GOAL-030 的 landed `goal-merge-result` 时刻 t（取自主检出 `.quay/gate-events.jsonl`）；`git log develop --since=t --format='%s'` 中主题匹配 `tasks: <id> todo→ready（promotion-driver 机械晋升）` 的 id 列表与去重条数；`.quay/task-status-events.jsonl` 中对应 `kind=promote ∧ to=ready ∧ ts≥t-60000` 的事件。若判据 `exit 1`，同处给出直接量根因（缺事件的 id 清单与条数、事件载体是否存在、主检出工作树是否含并入的 `packages/quay/src/kernel/task-transition.ts` 与 `plugin/scripts/ready-pool-check.ts` 的 kernel 接线）；若 `exit 0` 则该项记为 `N/A`
- [ ] 判据强度能取假（负对照；⛔ 不改生产 `.quay/` / `tasks/`，⛔ 不用 `git checkout` 还原）：在一棵一次性 fixture 树（`/tmp` 下的独立 git 仓库，含自制 `develop` 提交主题 + 自制 `.quay/gate-events.jsonl` 与 `.quay/task-status-events.jsonl`）上给出三种取值——(a) 有翻转无事件 ⇒ `exit 1` 且 stderr 含 `CAUSE=flip-without-event`；(b) 有翻转但事件载体缺席 ⇒ `exit 1` 且 stderr 含 `CAUSE=event-carrier-absent`；(c) 翻转与事件一致 ⇒ `exit 0` 且 stdout 含 `PASS:`；三个 exit 码进 `## Evidence`
- [ ] 载体已落盘可读：`test -f docs/rup/goal030-post-merge-reading.md` exit 0，且该文件含上文第二条要求的 t、id 列表（含去重条数）与判据 exit 码（`grep -cE 'exit|CAUSE|PASS' docs/rup/goal030-post-merge-reading.md` ≥ 1）

## DoD

真实落地 = **AC-341 判据在共享主检出根上被真实执行一次**，其 exit 码、stdout/stderr、GOAL-030 的并入时刻 t、并入后 develop 上的生产晋升 id 列表、以及 `.quay/task-status-events.jsonl` 中的对应事件，全部固化在任务库（`## Evidence`）与 `docs/rup/goal030-post-merge-reading.md`。

判据 `exit 0` ⇒ GOAL-030 的并入后生产读数达标（并入后全部生产晋升翻转都带事件），AC-341 在生产上被满足；`exit 1` ⇒ 生产接线在并入后落空，作为 GOAL-030 的**健康度信号**如实记录（含直接量根因），⛔ 不改判据、⛔ 不手写事件、⛔ 不伪造 PASS；`exit 3` ⇒ 前提未满足，写明是「尚未并入」还是「并入后尚无生产晋升」哪一个。

本任务 read-only、不改任何源码，故不跑 suite（同 ④ `gap-goal030-archguard-before-after-comparability` 的先例）。本任务经 **develop** 落地（它是并入后读数，⛔ 不是 goal 分支任务）。

## Touches

- tasks/gap-goal030-post-merge-promotion-events-reading.md
- docs/rup/goal030-post-merge-reading.md

## 停放说明

本任务以 needs-human 状态立案，用于停放：在 GOAL-030 尚未并入 develop 之前，⛔ 不得被派发（判据只会 `exit 3`，白跑一轮）。由立案会话在 `.quay/gate-events.jsonl` 出现 GOAL-030 的 landed `goal-merge-result`、且主检出已追上 develop 之后改回 todo。
