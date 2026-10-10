---
id: goal-034-merge-and-postmerge-verify
title: GOAL-034 ③：人工合并请求 + 机械 fan-in + 并入形态与落地树核验（AC-355，post-merge）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - goal-034-edge-count-before-after-negctl
goal_ac: AC-355
---
**type:** execution

## Proposal

GOAL-034 的第三块（并入 + 并入后核验）：在 AC-353（结构护栏）与 AC-354（边数读数）两个 pre-merge 判据都 achieved 之后，记录一次人工合并请求，由 worker-driver 机械 fan-in 把 `goal/GOAL-034` 并入 develop；随后在同一条 develop 尖端上核验 AC-355。

AC-355 已声明 `phase: post-merge`（GOAL-031 曾因漏声明导致 `quay goal merge` 恒被 `pre-merge-ac-unmet` 拒绝）。它的判据**不读**任何冻结的 landedSha，而是现场读 `git rev-parse develop` 并要求 `git merge-base develop HEAD == develop tip` ⇒ 求值树必须是 **develop 尖端本身或其子孙**。branch-mode goal 的 post-merge AC 在主检出（`evaluationRoot=/data/home/yale/work/quay`，分支 `author`）求值，因此并入后**必须先把主检出 ff 同步到 develop**（`git merge --ff-only develop`），否则 merge-base 停在旧的 fork point ⇒ exit 3（NOT-EVALUATED），而这个读数与「尚未并入」同形（硬规则 3b/4b：先看是不是 branch lag，再怀疑没并入 —— 已知形态 `production-carrier-static-red-can-be-branch-lag` / `post-merge-verify-ac-naming-a-live-reading-drifts-false`）。

本任务不改任何 `packages/quay/src/**` 源码；它只负责触发合并、核验形态、把落地树读数与七个测试文件的原始输出落进 `## Evidence`，并如实记录生产生效面。

## Plan

1. 前置核验（任一不满足 ⇒ 停在此处、把读数写进任务体，⛔ 不用 `--override` 绕过、⛔ 不自推范围）：
   - `quay goal show AC-353 --json` 与 `quay goal show AC-354 --json` 均 `achieved`；
   - `quay goal show AC-355 --json` 的 `phase` 为 `post-merge`；
   - `git show-ref refs/heads/goal/GOAL-034` 存在（分支尚未被删）。
2. `quay goal merge GOAL-034 --reason "<一句为什么现在并>" --root /data/home/yale/work/quay` —— 只追加一条 `goal-merge-request` 事件；真正的 `git merge --no-ff` 由 worker-driver 在加锁的临时 worktree 里执行并跑 anti-drift / typecheck / scoped 门 / 全量 suite。
3. 等待 `goal-merge-result` 事件。**若 fan-in 红**：读该事件 payload 与 suite 日志，在隔离 worktree 里单独跑失败文件，区分「本 goal 的搬迁造成」与「全量 suite 并发环境伪影」（GOAL-030 曾两次遇到后者并以独立 gap 任务修复）。属于本 goal 的回归 ⇒ 回分支修；属于环境伪影 ⇒ 另立 gap 任务修根因。⛔ 不经诊断就重试、⛔ 不改判据迁就结果。
4. 并入后在**主检出**追平 develop：`git merge --ff-only develop`（非 ff ⇒ 停下诊断，不要 force）。核 `git merge-base develop HEAD` == `git rev-parse develop`，且 `git rev-list --count develop..HEAD` 期望为 0。
5. 在主检出跑 AC-355 判据：`quay goal gate AC-355 --dry-run --json --root /data/home/yale/work/quay` ⇒ exit 0；原文进 `## Evidence`。判据自身已覆盖：`kernel/gate-run-options.ts` 存在、`gate/config/utils.ts` 与 `gate/factories/loader.ts` 均不存在、八个消费点（goal-store / cli/gate / acceptance-runner / registry / config/loader / config/index / factories/utils / factories/goal）按位置（剔注释行）仍 import kernel、七个测试文件全绿。
   - exit 3 ⇒ 求值树不是 develop 子孙（先查主检出是否落后 develop，branch lag 不是「没并入」）；exit 1 ⇒ 判据同行给 `CAUSE=`，逐字记下并交回实现/读数任务，不在本任务内改源码。
6. 并入形态核验（AC-355 判据**不含**此项，但它是本 goal 的退出条件：「GOAL-034 以恰好一个合并提交进入 develop」）：
   - `develop` tip == `landedSha`，且是 `git rev-list --first-parent develop` 首行；
   - `git rev-list --parents -n1 <landedSha>` 恰两个父：`^1` = 并入前 develop tip、`^2` = goal tip（记 tipSha）；
   - `git rev-list <landedSha>^1..<tipSha>` 与 first-parent 链无交集（无分支提交泄漏到 first-parent）。
7. 七个测试文件的**原始输出**另存：在主检出并排跑 `node --no-warnings --experimental-strip-types --test packages/quay/test/gate-config-loader.test.mjs packages/quay/test/gate.test.mjs packages/quay/test/goal-store.test.mjs packages/quay/test/acceptance.test.mjs packages/quay/test/acceptance-env.test.mjs packages/quay/test/gate-diagnostics.test.mjs packages/quay/test/gate-ergonomics.test.mjs`，记 `tests/pass/fail` 行；与判据内置那次互为第二来源（硬规则 4/4c：判据读数要能取假，负对照由 AC-354 任务承担）。
8. 生产生效面（读数，非结论）：记 `ps -eo pid,etimes,args` 里的 `serve` 与 driver anchor 行，说明本 goal 是**行为等价的纯符号搬迁**（AC-353 证结构收敛、AC-354 证边数读数、步骤 7 证运行时回归全绿）⇒ 不存在「重启后才会出现的可观测变化」，**无需重启**。⛔ 本任务不调用任何 `quay driver start|stop|restart`、不重启 `serve`。
9. 自查：`node --experimental-strip-types plugin/scripts/task-schema-check.ts tasks/goal-034-merge-and-postmerge-verify.md` exit 0；`quay task check <本任务 id> --json` 的 `missing` 为空。

## Acceptance Criteria

- [ ] `.quay/gate-events.jsonl`（主检出）含一条 GOAL-034 的 `goal-merge-request` 事件，`override: null`、`unmetAcs: []`（事件 id、tipSha、读数进 `## Evidence`），未使用 `--override`。
- [ ] 同一文件含一条 GOAL-034 的 `goal-merge-result`，`outcome: landed`，记录 `landedSha` 与 `tipSha`。
- [ ] 并入形态：`develop` tip == `landedSha` 且为 first-parent 首行；`git rev-list --parents -n1 <landedSha>` 恰两父（`^1`=并入前 develop tip、`^2`=goal tip）；无分支提交泄漏到 first-parent。
- [ ] 主检出已追平 develop（`git merge-base develop HEAD` == `git rev-parse develop`，`git rev-list --count develop..HEAD` = 0），AC-355 判据在其上 `--dry-run` exit 0，JSON 原文进 `## Evidence`。
- [ ] 落地树结构读数逐字进 `## Evidence`：`kernel/gate-run-options.ts` 存在；`gate/config/utils.ts`、`gate/factories/loader.ts` **不存在**；八个消费点按位置 import kernel。
- [ ] 七个测试文件（`gate-config-loader`/`gate`/`goal-store`/`acceptance`/`acceptance-env`/`gate-diagnostics`/`gate-ergonomics`）在主检出全绿，`tests/pass/fail` 原始行进 `## Evidence`。
- [ ] 生产生效面已按 Plan 第 8 步以读数说明；本任务未调用任何 `quay driver start|stop|restart` 或重启 `serve`。
- [ ] 本任务未改动任何 `packages/quay/src/**` 源码（`git diff --name-only` 不含该目录）。

## Definition of Done

GOAL-034 以恰好一个合并提交进入 develop，落地树持有本刀全部结构改动且两个死文件消失，AC-355 判据在主检出 exit 0、七个测试文件实测全绿；fan-in 若出现红灯已诊断归因而非盲目重试；全程未重启生产进程。

## Touches

- tasks/goal-034-merge-and-postmerge-verify.md

## Evidence

（执行时填写：合并请求/结果事件原文、并入形态读数、AC-355 判据 stdout 原文、七文件 `tests/pass/fail` 行、生产进程读数。）