---
id: gap-git-graph-reconstructed-lanes-all-named-mainline-ref
title: git-history 恢复第二父轨道后，113/113 条 reconstructed 泳道全部被命名为 develop（100% 同名，与
  gap-git-graph-branch-name-fallback-to-trunk-ref 修过的现象逐字相同、方向相反）；根因是 ff
  dev-merge 的第二父本就是主线自身历史、根本没有分支名可恢复，取 task/X 是张冠李戴、取 develop 语义对但退化成零信息
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

**现象（2026-09-09，`gap-git-graph-ref-partition-collapses-all-topology-to-one-lane`（A）落地后，对生产实例 `/git-history` 实测）**：拓扑恢复了，但**泳道名 100% 同名**——

```
泳道总数 118 = mainline 1 + live 4 + reconstructed 113
reconstructed 的 ref 直方图 = { "develop": 113 }      ← 113/113 全部叫 develop
allNamedDevelop = true
```

抽 5 条样本用独立 oracle 核验，它们的提交**全部是 develop 祖先**（`git merge-base --is-ancestor <hash> develop` 退出码 0）：`6aad9529c` / `212a33847` / `898a437b9` / `23f607189` / `de62023b7`。截图 `git-after-A.png` 里满屏都是同一个 `develop` chip。

**这是一个被修好过又以相反方向复发的缺陷。** `gap-git-graph-branch-name-fallback-to-trunk-ref`（done）当时的现象逐字就是：「**28 条 lane 的 `ref` 直方图是 `{ "develop": 28 }`，即 100% 同名**」。命名规则在两个错误答案之间来回摆动：

```
develop × 28  →（改成挑非 mainline 名）→ task/X（可区分但张冠李戴）→（改成挑带引号名）→ develop × 113
```

**根因：这两个答案都错，因为问题本身问错了。** 本仓库 fan-in 是 ff、dev-merge 形如 `Merge branch 'develop' into task/<id>`，其**第二父确实就是 develop 自己的旧 tip**。所以第二父轨道**在语义上根本不是一条分支**，而是「ff fan-in 把上一版主线推到第二父」留下的结构痕迹。给它取 `task/X` 是张冠李戴；取 `develop` 虽然**语义正确**却退化成 113 条同名泳道，信息量为零，且与「一切正常」同形。**没有任何分支名可从这类轨道上恢复**——真正的分支信号在第一父那侧（已被 ff 拍平进主线脊柱）。

**参照 `git log --graph --all` 的做法**：它把这些侧线**画出来但不加 decoration**——有结构、无标签，因为那里确实没有 ref。这才是诚实的呈现。

**伴生的过度碎片化（同一机制）**：113 条 reconstructed 泳道里 **49 条只有 1 个提交**（`· 1 commits · 0m`）、37 条 2–5 个；同时页面上出现大量「窗口外分叉」标记。这是「每一次 dev-merge 的第二父都成为一条独立泳道」的直接后果，与命名问题同源，应一并处理。

**判据缺陷自查（本条立案的直接教训）**：A 的 AC3 写的是「对每一条 `kind === 'reconstructed'` 的泳道，其提交须是它被标注的 ref 的祖先」。把全部泳道标成 `develop` 会让这条**平凡为真**（它们本来就是 develop 祖先）⇒ 判据被退化标注满足，闸绿而生产退化。这与前一轮 P2 的 AC7（对空集的全称判断恒真）是同一类错误的第二次发生，本任务的 AC 必须给出**不能被退化标注满足**的判据（见下）。

## Plan

1. **凡解析结果等于 mainline ref 的 reconstructed 泳道，不得作为具名分支泳道发出**。二选一（实现者按渲染效果定）：
   - (a) 折叠回 mainline 泳道（它本来就是主线历史）；
   - (b) 保留拓扑但**不给 chip**（照搬 `git log --graph` 的「有结构、无标签」），`ref` 置为 `null` 并新增 `unnamed: true`。
2. **禁止把 mainline ref 当成分支名回退**：`branchNameFromMergeSubject` 及其调用点，解析结果落在 `GIT_HISTORY_MAINLINE_REFS` 时返回 `null`，不再作为泳道名。
3. **收敛碎片**：连续的、同属主线历史的第二父轨道合并；1 提交的轨道不单独占一条泳道（并入相邻轨道或折叠进主线）。
4. **「窗口外分叉」标记**仅在该轨道确有独立身份（有名字或有 ≥2 提交）时才画，避免满屏噪声。

## AC

- [x] AC1 **命名多样性（不可被退化标注满足）**：生产 `#git-graph-data` 中，具名泳道（`ref != null`）的**不同取值数 ≥ 2**，且**没有任何单一 ref 占具名泳道总数的 90% 以上**（当前 develop 占 113/117 ≈ 97%）：`node --test packages/quay/test/gap-git-graph-reconstructed-lanes-all-named-mainline-ref.test.mjs` 退出码 0。
- [x] AC2 **mainline 名不得作分支名**：断言 `branches.filter(b => b.kind !== 'mainline' && GIT_HISTORY_MAINLINE_REFS.has(b.ref)).length === 0`（当前 = 113）。
- [x] AC3 负控制：测试内显式还原「第二父轨道取带引号名」的旧规则，断言 AC2 的计数 > 0 ⇒ 判据能取假，不是恒真。
- [x] AC4 拓扑不因此丢失（防止用「删泳道」来满足 AC1/AC2）：窗口内每个合并提交的第二父仍必须出现在某条泳道的 commits 中——孤儿数 = 0（沿用 A 的 AC1 不变式，确保本次修复不是又一次塌缩）。
- [x] AC5 碎片收敛：`reconstructed` 泳道中 `commits.length === 1` 的条数占比 **< 20%**（当前 49/113 ≈ 43%）；且「窗口外分叉」标记数 ≤ 具名 reconstructed 泳道数。
- [x] AC6 生产读数：以上 AC1/AC2/AC5 三项均在**真实生产页面**的 `#git-graph-data` 上取值，不接受仅 fixture 通过（硬规则 4 推论三）。

## DoD

生产 `/git-history` 上，肉眼扫一屏不再是满屏同一个 `develop` chip：具名泳道的名字有区分度（AC1），且不存在把主线 ref 当分支名的泳道（AC2），同时拓扑完备性不回退（AC4 孤儿数 = 0）。把命名规则改回「取带引号名」会让 AC2/AC3 变红。截图与 `#git-graph-data` 读数各留一份为证。

## Touches

- packages/quay/src/serve-git.ts（reconstructed 泳道命名：mainline ref 不作分支名；碎片收敛；窗口外分叉标记条件）
- packages/quay/test/gap-git-graph-reconstructed-lanes-all-named-mainline-ref.test.mjs（本任务的回归测试）
- packages/quay/test/gap-git-graph-ref-partition-collapses-all-topology-to-one-lane.test.mjs（A 的拓扑不变式，收敛后行数会变，需同步更新）
- packages/quay/test/gap-git-graph-branch-name-fallback-to-trunk-ref.test.mjs（同一命名机制的历史回归测试，需同步）
- packages/quay/test/gap-git-graph-lane-path-inverts-and-duplicates-per-devmerge.test.mjs（同一命名机制的历史回归测试，develop/# 命名断言需同步）
- packages/quay/test/gap-git-history-lane-identity-and-row-layout-overlap.test.mjs（unnamed 约定 #<hash>→ref:null，断言需同步）
- tasks/gap-git-graph-reconstructed-lanes-all-named-mainline-ref.md
