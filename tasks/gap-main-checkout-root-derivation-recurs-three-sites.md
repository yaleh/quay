---
id: gap-main-checkout-root-derivation-recurs-three-sites
title: 主检出根推导的 bug 修过一次却在另外 3 处仍在犯——两处注释还把错误当不变量写着「guaranteed first」；收敛为
  repo-root.ts 的第二个导出
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
  consolidates: 3
---
**type:** execution

## Proposal

**`git worktree list --porcelain` 的第一条 `worktree ` 行不保证是主检出。** 这个事实在本仓库
**已经被发现并修复过一次**：`plugin/scripts/refresh-worktree-quay.sh:61-75` 现在用
`git rev-parse --path-format=absolute --git-common-dir` 推导，并留了注释
"the list order is not guaranteed to place the main working tree first"
（任务 `gap-refresh-worktree-quay-main-derive`，done）。

**现场核实（2026-09-04 会话审计）：同一个判定在另外 3 处仍在犯同一个错，且都是活路径**：

- `plugin/scripts/runner-concurrency.ts:187-201` `deriveMainRoot` —— 注释甚至断言
  "FIRST … is ALWAYS preferred"，接在 CLI flag（`:246`）上；
- `plugin/scripts/driver-runtime.ts:269-283` `resolveMainRoot` —— 被 `:1183` 调用；
- `plugin/scripts/dispatch-worktree-setup.sh:74-80` —— 注释写着
  "lists the MAIN worktree FIRST (**guaranteed**)"。

**⇒ 最贵的形态不是"错了 3 处"，是"修复没有传播，连『这里错了』这个认知都没传播"**——反而在两个新
地方把错误当成不变量写进了注释，下一个读者会信它。

**落点已由既有任务圈定（去重证据）**：`gap-b2-repo-root-unification`（done，18 处 → 1）把
repo-root 走查统一进了 `plugin/scripts/repo-root.ts:repoRoot`，其记录第 39 行**明确写道**
"`refresh-worktree-quay.sh` 的 `git rev-parse --git-common-dir` 是**主检出推导**（非 repo-root 走查），
无迁移面，Touches 保留但未改动"——**那次统一显式把主检出推导排除在外**，所以本任务不是重复，
而是补上被排除的那一半，天然落点就是 `repo-root.ts` 增加第二个导出（如 `mainCheckoutRoot`）。

## AC

- [ ] AC1（基线 + 证明缺陷可取假）：构造一个主检出**不在** `git worktree list --porcelain` 首行的
      真实场景（如从一个 worktree 内调用），分别跑现有三处实现与 `--git-common-dir` 正解，贴出
      **不同**的推导结果——复现不出差异则前提不成立，须先修正前提
- [ ] AC2：`repo-root.ts` 新增 `mainCheckoutRoot()`（TS 侧唯一实现，用 `--git-common-dir`）；
      shell 侧提供对应的最小共享片段或直接调用该 TS（由实现选择并在任务体说明理由）
- [ ] AC3：三处改为调用共享实现，私有实现删除；**两处错误注释**（`runner-concurrency.ts` 的
      "ALWAYS preferred"、`dispatch-worktree-setup.sh` 的 "guaranteed"）一并订正或删除——
      注释里的错误不变量与代码同等有害
- [ ] AC4（收敛量可核验）：`grep -rn "worktree list --porcelain" plugin/scripts/ | grep -v repo-root.ts`
      中**自行解析首行取主检出**的实现处从 3 降到 0（贴改动前后真实输出）
- [ ] AC5：AC1 的同一场景在收敛后三条路径给出**相同且正确**的主检出（贴输出）；
      `bash scripts/test.sh` 全量绿

## DoD

AC1（三处与正解不一致）与 AC5（收敛后一致）的真实读数对照贴进任务体；两处错误注释确认已订正
（贴 diff）。不是"抽了个函数"就算——必须证明原来的三处**确实会在该场景下推出错误的主检出**，
以及收敛后不再会。

## Touches

- plugin/scripts/repo-root.ts（新增 mainCheckoutRoot 导出）
- plugin/scripts/runner-concurrency.ts（删私有实现 + 订正注释）
- plugin/scripts/driver-runtime.ts（删私有实现）
- plugin/scripts/dispatch-worktree-setup.sh（改调用 + 订正注释）
- plugin/test/repo-root.test.mjs
- tasks/gap-main-checkout-root-derivation-recurs-three-sites.md
