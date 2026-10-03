---
id: gap-goal-branch-reaper-accepts-preview-serve
title: 孤儿 serve 回收器认可在自身 root 登记过的 serve——否则 goal 预览实例会被当泄漏杀掉
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-328
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.10、§9.2 残留 3）：goal 的预览实例是一个以预览 worktree 为 workspace root、后台启动的 `quay serve`。`plugin/scripts/worktree-process-reaper.ts --orphan-serves`（`classifyOrphanServes` `:379` 起，调用 `:504`）回收「父进程已死（ppid 1）∧ 不是 `--root` 下登记的宿主」的 serve——后台启动的预览 serve 两条都满足，会被回收。

**修法（方向）**：ppid 1 的 serve，若其 cwd（workspace root）R 不是主 root，且 `R/.quay/server.json` 登记的 pid 与它一致、cmdline 确认是 quay serve ⇒ 视为合法，不回收。carrier 缺失、pid 不一致的仍按泄漏回收（2026-09-17 全局 OOM 正是泄漏 serve 堆积所致，⛔ 不得放宽到「cwd 不是主 root 就放过」）。

## AC

- [ ] `plugin/test/worktree-process-reaper.test.mjs` 新增用例，以注入的进程表与临时目录断言 `classifyOrphanServes`：① ppid 1、cwd = 预览目录、该目录 `.quay/server.json` pid 一致 ⇒ 不在回收集；② 同上但 pid 不一致 ⇒ 在回收集；③ 该目录无 carrier ⇒ 在回收集；④ 主 root 登记宿主的既有判定不变。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 在本机对当前进程跑一次 `--orphan-serves --root <主检出> --list`，改动前后输出的回收集一致（此时还不存在预览 serve）；前后输出贴进 Evidence。⚠️ 本文件已知有负载相关的时序 flake（probe-liveness），红时先隔离重跑。
- [ ] `bash scripts/test.sh --for-task gap-goal-branch-reaper-accepts-preview-serve` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：goal 预览实例的 serve 能在后台存活，而泄漏的测试 serve 仍被回收。生产读数由 GOAL-028 的 AC-328（live-probe AC 在预览实例上 pass 之后才并入）在第一个试点 goal 上取得。

## Touches

- plugin/scripts/worktree-process-reaper.ts
- plugin/test/worktree-process-reaper.test.mjs
- tasks/gap-goal-branch-reaper-accepts-preview-serve.md
