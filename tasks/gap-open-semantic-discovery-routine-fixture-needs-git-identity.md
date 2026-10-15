---
id: gap-open-semantic-discovery-routine-fixture-needs-git-identity
title: open-semantic-discovery-routine 夹具缺 git identity ⇒ runner 上 Author
  identity unknown（同族已 done 修法的第二个实例）
status: ready
labels:
  - gap
  - ci
parent: null
children: []
extra: {}
---
## Proposal

develop 的 CI 全红里，`plugin/test/open-semantic-discovery-routine.test.mjs` 的
「AC(citations)」是 runner 上**没有 git identity** 导致的夹具失败：

- run 38700638546 该用例失败信息逐字含 `Author identity unknown`（`git commit` 被 git 拒绝：既无 `user.name`/`user.email` 配置，也无 `GIT_AUTHOR_*`/`GIT_COMMITTER_*` 环境）。
- 同族已有 done 任务 `gap-commit-routine-write-no-git-identity-fallback`（修的是**另一个**夹具）⇒ 本夹具是**未被覆盖的第二个实例**，⛔ 不重复立案：本任务只处理本文件。
- ⛔ 不许用「跳过该用例 / 标记 skip」来消红：这条 AC 要测的正是 routine 真的产出了 citations（那要真的提交）。

## Plan

1. 查重：读已 done 的 `gap-commit-routine-write-no-git-identity-fallback` 的落地实现，判断其中是否有**可复用**的 helper / env 注入形状；有则复用（⛔ 不静默各写一份），无则在 AC3 里给出「为何不能复用」的具名结论。
2. 在本夹具里把身份**显式给定**（`GIT_AUTHOR_NAME/EMAIL` + `GIT_COMMITTER_NAME/EMAIL`，或 `git -c user.name=… -c user.email=… commit`），范围只限本夹具造出的子进程。
3. 复现「无全局身份」的环境形状（例如 `HOME=$(mktemp -d)` + `GIT_CONFIG_GLOBAL=/dev/null`），A/B 两侧：改动前红（`Author identity unknown`），改动后绿。

## AC

- [ ] AC1: 粘贴改动后的行：本夹具的 `git commit` 现在显式携带身份（说明用的是 env 还是 `-c`），并说明它为什么不影响宿主/别的夹具。
- [ ] AC2: A/B 两侧原文读数：在 `HOME=<临时空目录> GIT_CONFIG_GLOBAL=/dev/null` 的形状下，改动前该用例红且报 `Author identity unknown`；改动后 `node --test plugin/test/open-semantic-discovery-routine.test.mjs` 退出码 0（粘贴两侧 `ℹ tests/pass/fail`）。
- [ ] AC3: 查重结论：`gap-commit-routine-write-no-git-identity-fallback` 的修法**复用了吗**？复用则给出复用的 helper 名与其所在文件；不能复用则给出具名理由（⛔ 不接受「各自独立所以各写一份」这种无理由表述）。
- [ ] AC4: 该用例的语义未被削弱：改动后仍断言 routine 真的产出了 citations（粘贴改动后的断言行 / 判据行），⛔ 不得改成 skip 或只断言退出码。
- [ ] AC5: 改动只落在该测试文件（`git diff --name-only` 只有它）。

## DoD

- 落地后 develop 上**下一轮真实 CI run** 中该用例不再是失败项（粘贴 run id + 结论）。
- ⛔ 不引入新的 CI 失败项。

## Touches

- plugin/test/open-semantic-discovery-routine.test.mjs
- tasks/gap-open-semantic-discovery-routine-fixture-needs-git-identity.md
