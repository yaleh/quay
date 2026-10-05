---
id: gap-goal-merge-leaks-empty-mkdtemp-parent-dirs
title: goal 并入只删临时 worktree 的 wt 子目录、不删 mkdtemp 父目录——/tmp 里留下 584 个空的
  goal-merge-GOAL-* 目录（测试 575、真实 9）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-325
---
## Proposal

**机制**（2026-10-06 实测）：`plugin/scripts/worker-fan-in.ts:2554` 的 `runGoalMergeFanIn` 用 `path.join(fs.mkdtempSync(path.join(os.tmpdir(), \`goal-merge-${goalId}-\`)), "wt")` 建并入用的临时 worktree——也就是说 `mkdtemp` 建出的是**父目录**，worktree 在它的 `wt` 子目录里。`finally` 段（`:2620` 起）只做 `git worktree remove --force <tmp>/wt` 与 `fs.rmSync(<tmp>/wt)`，**从不删那个 mkdtemp 父目录**，于是每次并入（成功或失败）都留下一个空目录 `/tmp/goal-merge-GOAL-NNN-XXXXXX`。

**生产读数**（2026-10-06，`/tmp`）：`/tmp/goal-merge-GOAL-*` 共 584 个，**全部为空**（`find /tmp -maxdepth 1 -name 'goal-merge-GOAL-*' -empty` = 584）。其中 GOAL-901 575 个（单元测试夹具跑出来的），GOAL-905 6 个、GOAL-904 3 个（真实并入尝试，与本会话里 6+3 次并入请求一一对应）。每个 4 KB，占用空间可以忽略；但 `/tmp` 目录本身已有约 3.6 万个子目录（目录文件约 3.3 MB），这批空目录是其中的一部分，并且会把真正的泄漏淹没（同一天里根分区因 `/tmp` 写满而让并入红了两次，排查时要在一堆无害的空目录里找大头）。

**修法（方向，实现者可调）**：`finally` 里在 worktree 移除之后删掉 mkdtemp 父目录（`path.dirname(tmpWorktree)`，用 `fs.rmSync(..., { recursive: true, force: true })`，best-effort 同现有写法）；⛔ 不要去删 `os.tmpdir()` 本身或任何不是由本函数 mkdtemp 出来的路径——删之前先确认父目录的 basename 以 `goal-merge-` 开头。跑 `runGoalMergeFanIn` 的测试同样不得留下目录（给测试一个独占的 `TMPDIR`，结束时断言其中没有 `goal-merge-*`）。

## AC

- [ ] `plugin/test/worker-driver.test.mjs` 的 goal 并入端到端用例改用独占的临时 `TMPDIR`，新增断言：成功并入之后、以及一次 suite 红的并入之后，该 `TMPDIR` 里都没有任何 `goal-merge-*` 条目。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 同一用例新增一条安全断言：函数不会删除不属于它的目录——在 `TMPDIR` 里预先放一个名为 `keep-me` 的目录，两次并入之后它仍在。
- [ ] 5b 邻近扫描：`grep -rnE 'mkdtempSync' plugin/scripts/*.ts packages/quay/src/*.ts | grep -v test` 里凡是「mkdtemp 出父目录、只清理其子路径」的同形写法逐个列出（命中数与前 3 条贴进 Evidence），判断是否同样泄漏；在 Touches 内的一并修，其余在 Evidence 写明理由。
- [ ] `node --test plugin/test/worker-driver.test.mjs` 退出 0。

## DoD

真实落地判据：落地之后，每次 goal 并入（无论成败）不再在 `/tmp` 留下 `goal-merge-GOAL-*` 目录；单元测试也不再留。现存的 584 个空目录是一次性清理，`/tmp` 是共享的，不属于本任务的 AC——需要时由人在确认后执行 `find /tmp -maxdepth 1 -name 'goal-merge-GOAL-*' -empty -delete`（只删空目录）。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/test/worker-driver.test.mjs
- tasks/gap-goal-merge-leaks-empty-mkdtemp-parent-dirs.md
