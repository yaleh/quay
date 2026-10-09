---
id: gap-goal033-merge-and-postmerge-verify
title: GOAL-033 ③：人工合并请求 + 机械 fan-in + 并入形态与落地树核验（AC-352，post-merge）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal033-selfhost-and-archguard-evidence
goal_ac: AC-352
---
**type:** execution

## Proposal

GOAL-033 的第三块（并入 + 并入后核验）：在 AC-350 / AC-351 两个 pre-merge 判据都 achieved 之后，记录一次人工合并请求，由 worker-driver 机械 fan-in 把 `goal/GOAL-033` 并入 develop；随后核对规定的合并形态与落地树内容，让 post-merge 判据 AC-352 可被判定为真。

AC-352 已声明 `phase: post-merge`（GOAL-031 曾因漏声明而导致 `quay goal merge` 恒被 `pre-merge-ac-unmet` 拒绝；本 goal 创建时已规避）。AC-352 读的是**落地的合并提交树**（`git cat-file` / `git grep <landedSha>`），不是会继续移动的 develop tip，因此不会在之后 develop 前进时漂移成假。

## Plan

1. 前置核验：`quay goal show AC-350 --json` 与 `AC-351` 均为 `achieved`；`quay goal show AC-352 --json` 的 `phase` 为 `post-merge`。任一不满足 ⇒ 停在这里、把读数写进任务体，⛔ 不用 `--override` 绕过。
2. `quay goal merge GOAL-033 --reason "<一句为什么现在并>"`——只追加一条 `goal-merge-request` 事件；真正的 `git merge --no-ff` 由 worker-driver 在加锁的临时 worktree 里执行并跑 anti-drift / typecheck / scoped 门 / 全量 suite（SPEC-goal-branch §4.7）。
3. 等待 `goal-merge-result` 事件。**若 fan-in 红**：先读该事件的 payload 与 suite 日志，在隔离 worktree 里单独跑失败的测试文件，区分「本 goal 的改动造成」与「全量 suite 并发环境伪影」（GOAL-030 曾两次遇到后者并以独立 gap 任务修复）；⛔ 不经诊断就重试，⛔ 不改判据迁就结果。属于本 goal 的回归 ⇒ 回到分支上修；属于环境伪影 ⇒ 另立 gap 任务修根因。
4. 并入之后的核验：
   - 在主检出跑 AC-352 判据（`quay goal gate AC-352 --dry-run`）⇒ exit 0；
   - `git show <landedSha>:packages/quay/src/serve-sessions.ts | grep -n 'driver-control'` 与 `serve.ts | grep -n 'driver-vocab'` 有命中、`git show <landedSha>:packages/quay/src/cli/driver-vocab.ts` 报不存在；
   - 在主检出（追平 develop 之后）跑 `packages/quay/test/driver-control.test.mjs` 与 `packages/quay/test/server.test.mjs` 全绿；
   - `quay goal check --staleness` 对 GOAL-033 不报分歧。
5. ⛔ 本任务不重启任何生产 driver / serve 进程。若判断生产进程需要重启才能加载新代码，只在任务体里写清「哪个进程、为何需要、重启后可观测变化是什么、当前读数」，交回人裁定。预期结论：本 goal 不改任何运行时行为（CLI / web / `quay server` 三个表层输出逐字不变），故无需重启——但要用读数说明，不要只下结论。

## Acceptance Criteria

- [ ] `.quay/gate-events.jsonl` 含一条 GOAL-033 的 `goal-merge-request` 事件，未使用 `--override`（事件 id、tipSha、`unmetAcs` 读数进 `## Evidence`）
- [ ] 同一文件含一条 GOAL-033 的 `goal-merge-result`，`outcome: landed`，记录 `landedSha` 与 `tipSha`
- [ ] AC-352 判据在主检出 exit 0（`quay goal gate AC-352 --dry-run` 的 JSON 原文进 `## Evidence`）——即 merge shape 恰为一个合并提交、第二父 = goal tip、无分支提交泄漏到 first-parent，且落地树 core-root 零 `./cli/` import
- [ ] 主检出追平 develop 之后 `packages/quay/test/driver-control.test.mjs` 与 `packages/quay/test/server.test.mjs` 全绿
- [ ] `quay goal check --staleness` 对 GOAL-033 无分歧（读数原文进 `## Evidence`）
- [ ] 生产生效面已按 Plan 第 5 步以读数说明；本任务未调用任何 `quay driver start|stop|restart` 或重启 serve

## Definition of Done

GOAL-033 以恰好一个合并提交进入 develop，落地树的 core-root 不再 import `cli/`，AC-350/351/352 全部可判定为真；fan-in 若出现红灯已诊断归因而非盲目重试；全程未重启生产进程。

## Touches

- tasks/gap-goal033-merge-and-postmerge-verify.md
