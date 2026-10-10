---
id: goal-035-merge-and-postmerge-verify
title: GOAL-035 ③：合并请求 + 机械 fan-in + 并入形态与落地树核验（AC-358，post-merge）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - goal-035-needs-human-transition-unify
  - goal-035-needs-human-transition-contract-tests
goal_ac: AC-358
---
**type:** execution

## Proposal

GOAL-035 的第三块（并入 + 并入后核验）：在 AC-356（结构护栏）与 AC-357（函数级可证伪契约 + 两个测试文件回归）两个 pre-merge 判据都 achieved 之后，记录一次 goal 合并请求，由 worker-driver 机械 fan-in 把 `goal/GOAL-035` 并入 develop；随后在同一条 develop 尖端上核验 AC-358。

AC-358 的判据**不读**任何冻结的 landedSha，而是现场读 `git rev-parse develop` 并要求 `git merge-base develop HEAD == develop tip` ⇒ 求值树必须是 **develop 尖端本身或其子孙**。branch-mode goal 的 post-merge AC 在主检出（`evaluationRoot=/data/home/yale/work/quay`，分支 `author`）求值，因此并入后**必须先把主检出 ff 同步到 develop**（`git merge --ff-only develop`），否则 merge-base 停在旧的 fork point ⇒ exit 3（NOT-EVALUATED），而这个读数与「尚未并入」同形（硬规则 3b/4b：先看是不是 branch lag，再怀疑没并入 —— 已知形态 `production-carrier-static-red-can-be-branch-lag` / `post-merge-verify-ac-naming-a-live-reading-drifts-false`）。

本任务不改任何 `plugin/scripts/**` 或 `plugin/test/**` 源码；它只负责触发合并、核验形态、把落地树读数与两个测试文件的原始输出落进 `## Evidence`，并如实记录生产生效面。

<!-- dedup-ref --> 立案时读到的两处现场事实，记录于此仅供追溯（本任务的范围=一个 AC；这两点不是本任务要修的）：(a) AC-358 的 goal 文件（`goals/AC-358-*.md`）**没有 `phase:` 行** ⇒ `readGoalAcs` 缺省 `pre-merge`（`goal-merge.ts:138`）⇒ `unmetPreMergeAcs(GOAL-035)` 恒含 AC-358（status active、last verdict not-evaluated）⇒ `quay goal merge GOAL-035` 除 `--override` 外恒被 `pre-merge-ac-unmet` 拒绝；同形先例 AC-355/GOAL-034 与 AC-349/GOAL-032 都在各自的 post-merge 任务里就地修（本任务按同一手法处理，见 Plan 第 2 步）。(b) 兄弟任务 `goal-035-needs-human-transition-unify`（`goal_ac: AC-356`）的 Evidence 记录 AC-356 判据当前有一个结构性缺陷（`environment-fatal` 锚点取错、400 字符窗口取不到 `return r;`），须由 goal 记录拥有者先修好——这是本任务结构上无法绕过的上游，但**不在本任务范围**（一刀一 AC；`depends_on` 已在 frontmatter 声明）。

## Plan

1. 前置核验（任一不满足 ⇒ 停在此处、把读数逐字写进任务体，⛔ 不用 `--override` 绕过、⛔ 不自推范围）：
   - `quay goal show AC-356 --json` 与 `quay goal show AC-357 --json` 均 `achieved`；
   - `quay goal show AC-358 --json` 的 `phase` 为 `post-merge`（若为 `pre-merge` 先做第 2 步）；
   - `git show-ref refs/heads/goal/GOAL-035` 存在（分支尚未被删）。
2. 若 AC-358 的 `phase` 仍是 `pre-merge`（声明缺陷，见 Proposal）：就地修 `quay goal write AC-358 --phase post-merge --root /data/home/yale/work/quay`，`git show <提交> --stat` 核 diff **仅 `+phase: post-merge` 一行**（未动 `origin`/`status`/`criterion`）；先例 AC-355 ⇒ `c1bfb8f1d`、AC-349 ⇒ `3723086fd`。**只改求值相位、不跳过验证**——AC-358 仍须在并入后被判定（第 6 步）。
3. `quay goal merge GOAL-035 --reason "<一句为什么现在并>" --root /data/home/yale/work/quay` —— 只追加一条 `goal-merge-request` 事件；真正的 `git merge --no-ff` 由 worker-driver 在加锁的临时 worktree 里执行并跑 anti-drift / typecheck / scoped 门 / 全量 suite。
4. 等待 `goal-merge-result` 事件。**若 fan-in 红**：读该事件 payload 与 suite 日志，在隔离 worktree 里单独跑失败文件，区分「本 goal 的改动造成」与「全量 suite 并发环境伪影」（GOAL-030 曾两次遇到后者并以独立 gap 任务修复）。属于本 goal 的回归 ⇒ 回分支修；属于环境伪影 ⇒ 另立 gap 任务修根因。⛔ 不经诊断就重试、⛔ 不改判据迁就结果。
5. 并入后在**主检出**追平 develop：`git merge --ff-only develop`（非 ff ⇒ 停下诊断，不要 force）。核 `git merge-base develop HEAD` == `git rev-parse develop`，且 `git rev-list --count develop..HEAD` 期望为 0。
6. 在主检出跑 AC-358 判据：`quay goal gate AC-358 --dry-run --json --root /data/home/yale/work/quay` ⇒ exit 0；原文进 `## Evidence`。判据自身已覆盖：`plugin/scripts/driver-filters.ts` 含 `applyNeedsHumanTransition`；`plugin/scripts/worker-driver.ts` 直接 `retryState.needsHuman.add(` 调用数为 0；`plugin/test/driver-filters.test.mjs` 与 `plugin/test/worker-driver.test.mjs` 全绿。
   - exit 3 ⇒ 求值树不是 develop 子孙（先查主检出是否落后 develop，branch lag 不是「没并入」）；exit 1 ⇒ 判据同行给 `CAUSE=`，逐字记下并交回实现/读数任务，不在本任务内改源码。
7. 并入形态核验（AC-358 判据**不含**此项，但它是本 goal 的退出条件：「GOAL-035 以恰好一个合并提交进入 develop」）：
   - `develop` tip == `landedSha`，且是 `git rev-list --first-parent develop` 首行；
   - `git rev-list --parents -n1 <landedSha>` 恰两个父：`^1` = 并入前 develop tip、`^2` = goal tip（记 tipSha）；
   - `git rev-list <landedSha>^1..<tipSha>` 与 first-parent 链无交集（无分支提交泄漏到 first-parent）。
8. 两个测试文件的**原始输出**另存：在主检出并排跑 `node --no-warnings --experimental-strip-types --test plugin/test/driver-filters.test.mjs plugin/test/worker-driver.test.mjs`，记 `tests/pass/fail` 行；与判据内置那次互为第二来源（硬规则 4/4c）。⚠️ `worker-driver.test.mjs` 较大（约 4379 行），评估时显式传一个较大的 `--timeout`（如 900000ms），避免把真实超时误判为回归。
9. 生产生效面（读数，非结论）：记 `ps -eo pid,etimes,args` 里的 `serve` 与 driver anchor 行。本 goal 改的是**常驻 worker-driver** 的 `onWorkerFinished`——它已把旧代码载入内存，改动要等下一次 driver 重启才生效；而 goal body 明令**不重启任何生产进程**。⛔ 本任务不调用任何 `quay driver start|stop|restart`、不重启 `serve`；只如实记录「已落地到 develop、待下次重启生效」这一读数。
10. 自查：`node --experimental-strip-types plugin/scripts/task-schema-check.ts tasks/goal-035-merge-and-postmerge-verify.md` exit 0；`quay task check <本任务 id> --json` 的 `ok:true` 且 `acChecked == acTotal`。

## Acceptance Criteria

- [ ] 前置核验读数已记录（`quay goal show AC-356 --json` / `AC-357 --json` 均 `achieved`；`git show-ref refs/heads/goal/GOAL-035` 非空）；任一不满足则停在 Plan 第 1 步并如实记录读数。
- [ ] AC-358 的 `phase` 声明已就地修/确认：`quay goal show AC-358 --json` 的 `phase` 为 `post-merge`；若是本轮修为，`git show <提交> --stat` 显示 diff **仅一行 `+phase: post-merge`**，未动 `origin`/`status`/`criterion`。
- [ ] `.quay/gate-events.jsonl`（主检出）含一条 GOAL-035 的 `goal-merge-request` 事件，payload `override: null`、`unmetAcs: []`（事件 id、tipSha 进 `## Evidence`），未使用 `--override`。
- [ ] 同一文件含一条 GOAL-035 的 `goal-merge-result`，`outcome: landed`，记录 `landedSha` 与 `tipSha`。
- [ ] 并入形态：`develop` tip == `landedSha` 且为 first-parent 首行；`git rev-list --parents -n1 <landedSha>` 恰两父（`^1`=并入前 develop tip、`^2`=goal tip）；`comm -12 <(git rev-list <landedSha>^1..<tipSha>) <(git rev-list --first-parent develop)` 为空。
- [ ] 主检出已 ff 追平 develop（`git merge-base develop HEAD` == `git rev-parse develop`，`git rev-list --count develop..HEAD` = 0），AC-358 判据在其上 `--dry-run` exit 0，JSON 原文进 `## Evidence`。
- [ ] 落地树结构读数逐字进 `## Evidence`：`grep -q applyNeedsHumanTransition plugin/scripts/driver-filters.ts` 命中；`grep -c "retryState.needsHuman.add(" plugin/scripts/worker-driver.ts` = 0。
- [ ] `plugin/test/driver-filters.test.mjs` 与 `plugin/test/worker-driver.test.mjs` 在主检出全绿，`tests/pass/fail` 原始行进 `## Evidence`（大文件用大 `--timeout`）。
- [ ] 生产生效面已按 Plan 第 9 步以读数说明；本任务未调用任何 `quay driver start|stop|restart`、未重启 `serve`。
- [ ] 本任务未改动任何生产源码（`git diff --name-only develop...HEAD` 不含 `plugin/scripts/**` 与 `plugin/test/**`）。

## Definition of Done

GOAL-035 以恰好一个合并提交进入 develop，落地树持有本刀全部结构改动（`applyNeedsHumanTransition` 是 `retryState.needsHuman`/`counts` 的唯一 mutator，`worker-driver.ts` 内 `retryState.needsHuman.add(`/`counts.set(` 直接调用归零），AC-358 判据在主检出 exit 0、两个受影响测试文件实测全绿；fan-in 若出现红灯已诊断归因而非盲目重试；全程未重启生产进程、未用 `--override` 跳过任何验证。

## Touches

- tasks/goal-035-merge-and-postmerge-verify.md
- goals/AC-358-post-merge-生产验证-develop-尖端持有本刀全部结构改动-两个受影响测试文件回归全绿.md