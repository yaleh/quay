---
id: gap-release-cut-gh-absent-fixture-negative-control-fails-on-runner
title: release-cut 夹具「让 gh 不存在」靠改写 PATH，runner 上 gh 在 /bin/gh ⇒ 自己的负控失败
status: ready
labels:
  - gap
  - ci
parent: null
children: []
extra: {}
---
## Proposal

develop 的 CI 全红里，`plugin/test/release-cut.test.mjs` 的
「P1/AC2: with `gh` absent the hand-dispatch instruction names the SAME ref the tool would have used」是**夹具自己的负控**失败：

- run 38700638546 断言逐字：`AssertionError [ERR_ASSERTION]: the fixture must really have removed \`gh\` from PATH`（同段含 `'/bin/gh' !== ''`）。
- 成因：夹具通过改写 `PATH` 来「让 `gh` 不存在」，但 runner 上 `gh` 在 **`/bin/gh`**，改写后的 PATH 仍能解析到它 ⇒ 负控前提（真的摘掉了 gh）不成立 ⇒ 用例红。⛔ 这不是产品缺陷，也不是「`gh` 不该存在」——是夹具的**环境耦合**。

## Plan

1. 复现：本机造一个 `gh` 位于 `/bin/gh`（或任意在 PATH 中可解析的位置）的形状，跑该用例并记录红（A 侧）。
2. 把「让 gh 不存在」做成**与宿主布局无关**的机制（例如：把子进程的 `PATH` 收敛到本次注入的 shim 目录、用绝对路径 shim 覆盖查找、或在 PATH 首位注入一个 record-and-exit 的 `gh` 替身），并把负控断言改成**对该机制本身**的断言（「本夹具注入的替身位于 PATH 首位且被调用」），而不是断言「宿主上没有 gh」。
3. B 侧读数：同一形状下该用例绿，且 `P1/AC2` 仍然真的覆盖「`gh` 不可用时手派指令给出的 ref 与工具会给出的一致」这条语义（粘贴改动后断言与读数）。
4. 负控：让替身失效（或从 PATH 移除该目录）后，`P1/AC2` 必须红并点名原因。

## AC

- [ ] AC1: 给出 runner 上 `gh` 的真实位置读数（`command -v gh` / `ls -l /bin/gh` 原文），并说明改写 PATH 为什么摘不掉它。
- [ ] AC2: 粘贴改动后的实现片段，说明「gh 不可用」现在由**夹具注入的机制**保证而不是由宿主布局保证。
- [ ] AC3: 本机 A/B：改动前在 `gh` 位于 PATH 的形状下该用例红（粘贴原文断言）；改动后同一形状退出码 0（粘贴 `ℹ tests/pass/fail`）。
- [ ] AC4: 负控：撤掉注入机制后 `P1/AC2` 必须红且点名（粘贴两次读数）。
- [ ] AC5: 语义未被削弱：改动后该用例仍断言「手派指令给出的 ref == 工具会用的 ref」（粘贴改动后的断言行），⛔ 不得退化成「只要不抛错就算过」。
- [ ] AC6: 改动只落在该测试文件（`git diff --name-only` 只有它）。

## DoD

- 落地后 develop 上**下一轮真实 CI run** 中该用例不再是失败项（粘贴 run id + 结论）。
- ⛔ 不引入新的 CI 失败项。

## Touches

- plugin/test/release-cut.test.mjs
- tasks/gap-release-cut-gh-absent-fixture-negative-control-fails-on-runner.md
