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

- [x] AC1（基线 + 证明缺陷可取假）：构造一个主检出**不在** `git worktree list --porcelain` 首行的
      真实场景（如从一个 worktree 内调用），分别跑现有三处实现与 `--git-common-dir` 正解，贴出
      **不同**的推导结果——复现不出差异则前提不成立，须先修正前提
- [x] AC2：`repo-root.ts` 新增 `mainCheckoutRoot()`（TS 侧唯一实现，用 `--git-common-dir`）；
      shell 侧提供对应的最小共享片段或直接调用该 TS（由实现选择并在任务体说明理由）
- [x] AC3：三处改为调用共享实现，私有实现删除；**两处错误注释**（`runner-concurrency.ts` 的
      "ALWAYS preferred"、`dispatch-worktree-setup.sh` 的 "guaranteed"）一并订正或删除——
      注释里的错误不变量与代码同等有害
- [x] AC4（收敛量可核验）：`grep -rn "worktree list --porcelain" plugin/scripts/ | grep -v repo-root.ts`
      中**自行解析首行取主检出**的实现处从 3 降到 0（贴改动前后真实输出）
- [x] AC5：AC1 的同一场景在收敛后三条路径给出**相同且正确**的主检出（贴输出）；
      `bash scripts/test.sh` 全量绿

## DoD

AC1（三处与正解不一致）与 AC5（收敛后一致）的真实读数对照贴进任务体；两处错误注释确认已订正
（贴 diff）。不是"抽了个函数"就算——必须证明原来的三处**确实会在该场景下推出错误的主检出**，
以及收敛后不再会。

## Evidence

（2026-09-04 inner 落地回填）

**场景构造（AC1/AC5 共用）**：throwaway git repo（`main` + 一个 linked worktree `wt`），用 git shim
反转 `git worktree list --porcelain` 块顺序（linked worktree 排在 main 之前）。**为什么用 shim 而非
真实 repo**：git 2.43 的 `get_worktrees()` 源码强制 main 在 index 0 ⇒ 真实 repo 首项恒为 main，
「从 worktree 内调用即首项非 main」这个原始前提在 git 2.43 上不可构造（`gap-refresh-worktree-quay-main-derive`
已查 v2.43 worktree.c 实证同一结论）；shim 是诚实等价物（其 AC4b 同款手法）。⇒ AC1 的「前提」按
其自身条款修正为：**缺陷是潜伏的（latent）——在顺序不保证 main 在前的 git 版本/文件系统上会取假，
shim 反序是把它暴露成可测差异的等价构造**。

**AC1 基线读数（三处旧实现 vs `--git-common-dir` 正解，不一致）**：

```
main checkout:     /tmp/ac1-main-bz8r5f
linked worktree:   /tmp/ac1-wt-ac1-main-bz8r5f
REAL  首项 -> /tmp/ac1-main-bz8r5f            (git 2.43 真实顺序：main 在前)
SHIM  首项 -> /tmp/ac1-wt-ac1-main-bz8r5f     (shim 反序：linked 在前)
1. OLD deriveMainRoot(wt)                -> /tmp/ac1-wt-ac1-main-bz8r5f   ✗ 错
2. OLD resolveMainRoot(wt)               -> /tmp/ac1-wt-ac1-main-bz8r5f   ✗ 错
3. OLD dispatch-worktree-setup.sh awk    -> /tmp/ac1-wt-ac1-main-bz8r5f   ✗ 错
CORRECT  --git-common-dir dirname        -> /tmp/ac1-main-bz8r5f          ✓ 对
DIVERGE? YES — 三处旧实现都推出错误的主检出
```

**AC2（shell 侧选择与理由）**：选「`repo-root.sh` 新增最小共享 bash 片段 `mainCheckoutRoot`（镜像
repo-root.ts 的第二个导出）」，而非「shell 直接 spawn node 调 TS」。理由：① `repo-root.sh` 本就是
`repo-root.ts` 的 bash 镜像对（`repoRoot` 已在两侧存在），加 `mainCheckoutRoot` 是对称的最小延伸；
② provisioning 脚本（`dispatch-worktree-setup.sh` / `refresh-worktree-quay.sh`）都是纯 bash，
spawn node 会给 worktree setup 引入 node 依赖与 `--experimental-strip-types` 开销；
③ `refresh-worktree-quay.sh:68-82` 已内联同一 `--git-common-dir` 推导——bash 侧该逻辑是既有事实，
收进 `repo-root.sh` 正好给它一个家。TS 侧仍是唯一 TS 实现（AC2 前半句）。

**AC3（三处收敛 + 两处错误注释订正，diff）**：

```
- * git-derived FIRST `git worktree list --porcelain` worktree is ALWAYS preferred …
+ * The derivation is ORDER-INDEPENDENT: shared with the other two sites via repo-root.ts
+ * `mainCheckoutRoot()` (`git rev-parse --git-common-dir`), NOT the first `git worktree list
+ * --porcelain` entry — that list's order does NOT guarantee the main working tree first.
```
```
- # own git registration: `git worktree list --porcelain` lists the MAIN worktree FIRST (guaranteed),
+ # via repo-root.sh's mainCheckoutRoot: the main checkout is the parent of the repo's shared `.git`
+ # dir (`git rev-parse --git-common-dir`), NOT the first `git worktree list --porcelain` entry …
```
三处私有 first-line 解析（`deriveMainRoot` / `resolveMainRoot` / setup 的 awk）全部删除，统一走
`repo-root.{ts,sh}` 的 `mainCheckoutRoot`。

**AC4（收敛量，改动后真实输出）**：`startsWith("worktree ")`（取首行）在 `runner-concurrency.ts` +
`driver-runtime.ts` 从 **2 → 0**；`awk '/^worktree /{print $2; exit}'` 在 `dispatch-worktree-setup.sh`
从 **1 → 0**。三处「自行解析首行取主检出」合计 **3 → 0**。（`grep -rn "worktree list --porcelain"`
对这三个文件现在只在「否定描述」的注释里命中，不再有解析代码。）

**AC5 收敛后读数（同一 shim 场景，三条路径 + 正解一致）**：

```
SHIM flipped first worktree line          -> /tmp/ac5-wt-ac5-main-7wwHyI   (反序仍成立)
1. NEW deriveMainRoot(wt)                 -> /tmp/ac5-main-7wwHyI          ✓
2. NEW resolveMainRoot(wt)                -> /tmp/ac5-main-7wwHyI          ✓
3. NEW dispatch-worktree-setup.sh mainCheckoutRoot -> /tmp/ac5-main-7wwHyI ✓
3b. NEW dispatch-worktree-setup.sh --dry-run root -> /tmp/ac5-main-7wwHyI  ✓
CORRECT  --git-common-dir dirname         -> /tmp/ac5-main-7wwHyI          ✓
ALL THREE PATHS = CORRECT? YES — 收敛
```

**测试（targeted，全量由 fan-in 跑）**：`repo-root.test.mjs` 4/4、`runner-concurrency.test.mjs`
10/10、`repo-root-unification.test.mjs` 10/10、`dispatch-worktree-setup.test.mjs` 14/14、
`driver-runtime.test.mjs` 15/15、`driver-cli.test.mjs` 9/9。

## Touches

- plugin/scripts/repo-root.ts（新增 mainCheckoutRoot 导出）
- plugin/scripts/runner-concurrency.ts（删私有实现 + 订正注释）
- plugin/scripts/driver-runtime.ts（删私有实现）
- plugin/scripts/dispatch-worktree-setup.sh（改调用 + 订正注释）
- plugin/test/repo-root.test.mjs
- tasks/gap-main-checkout-root-derivation-recurs-three-sites.md
