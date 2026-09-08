---
id: gap-git-graph-trunk-ref-resolves-to-head-not-mainline
title: git-history 主干泳道名取自 HEAD 分支（恒为 author）而非 mainline，且同提交多 ref 时 --source
  按字母序把共享提交全归给 author ⇒ develop 在图上零存在感，而汇总表与导语都说 develop，同页三处口径矛盾
status: done
labels:
  - gap
  - webui
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（2026-09-08 用 Playwright MCP 对生产实例 `http://100.78.206.100:4173/git-history` 实测，读 `#git-graph-data` JSON 与渲染后 DOM，非目测）**：

- 主干泳道的 `trunk.ref` = **`author`**；全页 SVG 里没有任何 `develop` 文字（实测 `developChipOnChart: false`，16 个 chip 名字中无 develop）。
- 而底部「分支汇总」表**有 develop 一行**（464 提交 / 156 合并）。
- 页面导语又写着「develop 竖直主干」——同一页三处口径互相矛盾。
- 图上还多出一条**名为 `author` 的分支泳道**（3 提交），与主干同名。

**根因（两条叠加，均已取证）**：

1. `packages/quay/src/serve-git.ts:200` `layoutGitGraph` 把主干名取自 `branchNameOf(history, history.head ?? trunkHashes[0])`——即 **HEAD 所在分支名**。本仓库主检出常驻 `author`，主干于是恒被命名为 `author`。
2. `author` 与 `develop` 指向同一提交（实测 `git rev-list --count author..develop` = 0，反向亦 0），`observation.ts` 的 `git log --source` 按 `git for-each-ref` 的**字母序**把共享提交全部归给先出现的 `author`（实测 `git log author develop --source -n 5` 的 `%S` 全为 `author`）。`observation.ts:2484` 的 mainline 再归因只在 `GIT_HISTORY_MAINLINE_REFS` 命中时生效，同提交多 ref 时它拿不到优先权。

**期望**：主干名按**语义优先级** `develop > master > HEAD 分支名` 解析；同提交多 ref 时 `--source` 归因优先 mainline；主干顶端画出 trunk 名字 chip，使图、表、导语三处指同一个名字。

**相关（机制不同，不重复）**：`gap-git-graph-branch-name-fallback-to-trunk-ref`（done）修的是**分支泳道**名的 `:254` 回退路径，不覆盖主干自身的命名来源。

## AC

- [x] AC1 主干命名判定为一个可直接 import 的纯函数，对 `{heads:{author:X, develop:X, master:Y}, head:X}` 返回 `develop`，对 `{heads:{author:X, master:X}, head:X}` 返回 `master`，对 `{heads:{feature:X}, head:X}` 返回 `feature`——三例在 `packages/quay/test/gap-git-graph-trunk-ref-resolves-to-head-not-mainline.test.mjs` 断言，`node --test` 退出码 0。
- [x] AC2 负控制：测试内显式实现一份旧逻辑（取 HEAD 分支名）并断言它对 AC1 第一、二例返回 `author` ⇒ 判据能取假，不是恒真。
- [x] AC3 生产读数：`curl -s http://127.0.0.1:4174/git-history | grep -o '"trunk":{"ref":"[^"]*"'` 输出的 ref ∈ {develop, master}；同一份 HTML 中主干 chip 的文本含该 ref（用 node 解析 SVG 文本节点断言 ≥1 次命中）。
- [x] AC4 同提交多 ref 归因：测试内 `git init` 造一个 `author` 与 `develop` 同指的临时仓库，`readGitHistory` 返回的 commits 里 `ref === "develop"` 的条数 > 0 且 `ref === "author"` 的条数 = 0。
- [x] AC5 `grep -n 'history.head ?? trunkHashes' packages/quay/src/serve-git.ts` 无输出（旧代码路径确实消失，而不是被新分支绕过）。

## DoD

生产实例 `/git-history` 页面上，主干泳道带 `develop`（或 `master`）名字 chip、导语文案与实际主干名一致、汇总表的 develop 行与图上主干指同一对象——三处口径统一，由一次**真实浏览器读数**证明（Playwright 取 `#git-graph-data` 的 `trunk.ref` 加 SVG chip 文本），不以单测通过替代。旧的「取 HEAD 分支名」代码路径在 `serve-git.ts` 中不再存在，把它改回去会让 AC1/AC3 变红。

## Touches

- packages/quay/src/serve-git.ts（主干名解析改为 mainline 优先，并在主干顶端画出名字 chip）
- packages/quay/src/observation.ts（同提交多 ref 时 --source 归因优先 mainline）
- packages/quay/test/gap-git-graph-trunk-ref-resolves-to-head-not-mainline.test.mjs（本任务的回归测试）
- packages/quay/test/observation.test.mjs（readGitHistory 多 ref 归因用例）
- tasks/gap-git-graph-trunk-ref-resolves-to-head-not-mainline.md