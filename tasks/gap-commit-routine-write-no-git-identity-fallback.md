---
id: gap-commit-routine-write-no-git-identity-fallback
title: commitRoutineWrite 不带 git 身份兜底：CI/无 global git config 环境下 routine 提交必然失败
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/scripts/probe-routine.ts:458` 的 `commitRoutineWrite`（真正的生产函数，不是测试 fixture——
`freshness-refresh` 等 routine 落盘 finding/task 后靠它把 append 提交，防止共享检出的 `git checkout`
把未提交的内容吃掉）内部 `spawnSync("git", ["-C", root, ...args], ...)` **完全没有传 `-c user.name=`/
`-c user.email=`**，纯靠环境里已经配好的全局 git config。

<!-- dedup-ref -->
GitHub Actions runner 默认**没有**全局 `user.name`/`user.email`（本仓库共享 memory 里已有同类问题的
记录：`fixture-git-identity-must-go-in-child-env-not-repo-config`，此前是在别的测试 fixture 场景发现
的；这次是同一类问题第一次在**生产函数**本身现身）。2026-09-16 `develop` push 后的 CI run
（`https://github.com/yaleh/quay/actions/runs/35065126553`，job `test`）里，
`plugin/test/probe-routine.test.mjs` 两个断言真实失败，报的正是 `commitRoutineWrite` 的失败分支：

```
AssertionError: the round must commit its own append: git commit failed (unstaged, bytes kept on disk): Author identity unknown

*** Please tell me who you are.

Run

  git config --global user.email "you@example.com"
  git config --global user.name "Your Name"
```

`commitRoutineWrite` 自己的失败上报设计是对的（`ok:false` + 具体 reason，不静默吞掉——函数头注释也
明确写了这点），**问题是它的能力在这种环境下根本不可用**，不是"报错报得不够好"。任何没有全局 git
身份的宿主（新起的 CI runner、容器、一台刚装好的机器）上，routine 的 append 就永远提交不了——
`freshness-refresh` 这类 routine 因此在这些环境里必然退化成"写了但每次都被下一次 checkout 吃掉"。

修法：给 `commitRoutineWrite` 的 `git(["commit", ...])` 那一步（以及它前面 `git add`/`git diff --cached`
如涉及需要身份的操作，一并核对）显式传入一个稳定的 routine 专用身份（`-c user.name="quay-routine" -c
user.email="routine@quay.local"` 之类，不依赖宿主是否配置），不要求也不修改全局/仓库级 git config
（同 memory 里"不要用 --global，也不要只写 repo config"的既有教训——这里更进一步：直接不依赖任何 ambient
配置，本身就该带身份跑）。

## AC

- [ ] 在一个显式清空 `GIT_AUTHOR_NAME`/`GIT_COMMITTER_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_EMAIL` 且仓库/全局均未配置 `user.name`/`user.email` 的子进程环境下（复现 CI 的真实条件，不是本机那种已经配好身份的环境），`commitRoutineWrite` 修复前 `git commit` 报 `Author identity unknown`，修复后返回 `{ok:true, reason:"committed"}`。
- [ ] `node --experimental-strip-types --test plugin/test/probe-routine.test.mjs` 全文件在同样"无身份"环境下 `passed=true`（覆盖 `CARRIER AC7` 与 `CARRIER AC7 (5b sibling)` 两条）。
- [ ] 负控制：宿主本身已配置了 git 身份时，`commitRoutineWrite` 提交记录的 author/committer 是 routine 专用身份（不是宿主用户的身份），确认修复没有引入"悄悄冒用宿主身份"的副作用。

## DoD

下一次 `develop` 分支触发的 GitHub CI `test` job 日志里，`plugin/test/probe-routine.test.mjs` 以
`passed=true` 出现——不是本地手跑一次充数（本地环境本来就配好了 git 身份，测不出这个问题，正如
`ci-runs-collect.test.mjs` 那次一样）。

## Touches

- plugin/scripts/probe-routine.ts
- plugin/test/probe-routine.test.mjs
- tasks/gap-commit-routine-write-no-git-identity-fallback.md
