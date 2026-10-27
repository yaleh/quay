---
id: gap-ci-red-task-granularity-advice-git-merge-identity
title: task-granularity-advice AC6 fixture 的 git merge 缺身份，CI 无宿主 git 身份时 status 128
status: todo
labels:
  - gap
  - ci-red
  - defect
parent: null
children: []
extra: {}
---
## Proposal

CI test job 里 `plugin/test/task-granularity-advice.test.mjs` 的 `AC6 (hermetic fixture)` 恒红：
`Error: Command failed: git merge --no-ff ... (status 128)`。fixture 的 `g("merge", "--no-ff", ...)`
创建合并提交却不带 `-c user.email/user.name`，继承宿主 git 身份——开发机有全局身份 ⇒ 本地假绿；
CI runner 的 /root/.gitconfig 无身份 ⇒ "Committer identity unknown"（status 128）。

## Plan

在 `git init -b develop` 之后给 fixture 仓库设一次 local 身份（`git config user.email t@e` /
`user.name t`），让后续所有提交（含 merge）不再依赖宿主 git 身份。

## AC

- [x] 本地 AC6 全绿，且在 `env -u GIT_* HOME=<空目录>`（无环境 git 身份）下复跑仍全绿。
- [x] fixture 不再读取宿主的 user.email/user.name（no-live-host-state）。

## DoD

修复提交（377000a60）落地后，CI runner 无 git 身份时 AC6 仍绿；同文件里另两个已用内联 `-c` 的
fixture 未被改动（保持原有 hermetic 写法）。