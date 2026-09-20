---
id: gap-git-graph-live-ref-oracle-siblings-unfrozen
title: git-graph 测试族里仍有 4 个「实时 ref oracle 对实时数据层读」的对拍判据未冻结 ref 窗口——同族的第 3
  份实例又会以窗口位移误杀 fan-in
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: finding
---
## Finding

**来源**：`gap-fan-in-cert-flip-commit-identity-inert` 的 fan-in 被 `packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs` AC3 的实时 ref 竞态误杀（2026-09-20 08:09:35Z，`git --all emits 200 commits; the data layer dropped 1`）。该 worker 修掉了那**一个**载体（冻结 ref 窗口，`QUAY_TEST_GIT_GRAPH_LIVE_REFS=1` 为负控制缝隙），并按硬规则 5b 扫了同族。

**同族扫描读数**（谓词：`readGitHistory(REPO_ROOT…` ∧ 实时 `git` oracle ∧ 无冻结；命中 8 个文件，含已修的那一个）：**剩余 4 个文件仍是「实时数据层读 × 实时窗口 oracle，中间无快照」的同一对**，逐条比对点坐标：

| 文件 | 对拍点 | oracle 形态 |
|---|---|---|
| `packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs` | AC1 `:75` 读 → `:79`；`:133` → `:142`；AC6 `:200` → `:203` | `git log --graph` 列号 / `%D` / `git log -1` 最新提交 |
| `packages/quay/test/gap-git-graph-stride-chip-overlaps-commit-row-text.test.mjs` | `:138` → `:147` | `%D` oracle（比 inline-label 行**计数**） |
| `packages/quay/test/gap-git-graph-reconstructed-lanes-all-named-mainline-ref.test.mjs` | AC3 `:55` → `:62` | `%D` oracle（逐条 label 比对） |
| `packages/quay/test/gap-git-graph-ref-partition-collapses-all-topology-to-one-lane.test.mjs` | AC3 `:57` → `:60` | `git log --graph` 列号 |

**机制（已受控复现，非推断）**：两次独立实时读 `--all` 之间任何 ref 前进 K 个 ⇒ 窗口头前进 K、尾部掉出 K ⇒ oracle 侧多出 K 个「数据层读不到的提交」（列号 oracle 报 `git=undefined`；集合/计数 oracle 报「dropped K」）。**修前形态的受控复现**（隔离 `git clone --shared` + 每 250ms 推进一个 scratch ref 的 churn 循环）：`pass 2 fail 1` ×3，原句 `the data layer dropped 1` / `dropped 1` / `dropped 2`；**冻结后同条件 `pass 3 fail 0` ×3**。

**已确立的修法（先例两处，⛔ 不要另发明）**：
- `gap-git-graph-pagination-ac2-oracle-races-live-refs`（done）→ `gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs` 的 `snapshotRefWindow()` / `frozenGitExec()`；
- `gap-fan-in-cert-flip-commit-identity-inert`（本轮）→ `gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs` 的同名机制 + `QUAY_TEST_GIT_GRAPH_LIVE_REFS=1` 负控制。
两者共同要点：**一次性**把 ref 集合冻结成不可变对象名（`for-each-ref` ∪ `rev-parse HEAD`，⛔ 排除 `refs/notes/*` 以镜像 `GIT_HISTORY_REF_SCOPE`），**两侧同源**；经 `readGitHistory` 既有 `exec` 宿主读取缝隙进入生产读路径（`observation.ts` 零改动）；缝隙 **fail-closed**（`log` 调用无 `--all` 即 throw）。

**暴露度（实测口径）**：4 个的比对点两读相邻（几十 ms），比已修那一个（数据层那次被 AC1 的 30s TTL 缓存复用 ⇒ ~1s 窗口）低得多，但**同类同签名**，且每个 code-delta 任务的 fan-in 都会跑这些文件 ⇒ 每次都是独立的抽签。

**⛔ 不属本条的 3 个**（扫描命中但 oracle 读的不是浮动窗口）：`…cross-column-edges-drawn-as-fixed-stubs-not-anchored`（`git show 303a94950^:<blob>`）、`…decoration-labels-as-colored-chips`（`symbolic-ref -q HEAD` / `git remote`）、`…task-view-aggregate-commits-by-task-id`（**已经**用 `exec: snapshotExec` 冻结）。

## AC

- [ ] 4 个文件逐一对拍判据的两侧取自**同一个不可变 ref 集合**（快照或等价机制），打印实现位置与取值时机；`observation.ts` 保持零改动（除非能证明必须改）。
- [ ] 负控制可区分（硬规则 4 推论三）：每个文件都留一个「关掉冻结」的注入缝隙（沿用 `QUAY_TEST_GIT_GRAPH_LIVE_REFS=1` 这一族命名，⛔ 不设第二个语义相同、名字不同的开关）；隔离 clone + churn 下关掉 ⇒ 红、打开 ⇒ 绿，两臂都是真实读数。
- [ ] 判据不得退化：各文件原本的非空性/一致性断言修后仍能取假（至少给出一处「构造错位读数 ⇒ 报红」的真实读数），⛔ 不得用「只比交集」「重读一次生产函数」等方式削弱。
- [ ] `scripts/test.sh --for-task <本条>` exit 0，且**逐行核过**选中的测试确实包含这 4 个文件（不是只看 exit code —— 本仓库实测过「门绿在 0 个测试上」的形态）。

## DoD

git-graph 测试族里不再存在「实时数据层读 × 实时窗口 oracle」的对拍判据：任何 ref 在两次读之间前进都不再产生假的 `dropped K` / `git=undefined` 不一致；生产读路径（`observation.ts`）与这些判据的强度都不下降（各自的负控制仍能取红）。

## Touches

- packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs（AC1 `:75`→`:79`、`:133`→`:142`、AC6 `:200`→`:203` 三处对拍点冻结 ref 窗口）
- packages/quay/test/gap-git-graph-stride-chip-overlaps-commit-row-text.test.mjs（`:138`→`:147` 的 `%D` oracle 冻结 ref 窗口）
- packages/quay/test/gap-git-graph-reconstructed-lanes-all-named-mainline-ref.test.mjs（AC3 `:55`→`:62` 的 `%D` oracle 冻结 ref 窗口）
- packages/quay/test/gap-git-graph-ref-partition-collapses-all-topology-to-one-lane.test.mjs（AC3 `:57`→`:60` 的 `--graph` 列号 oracle 冻结 ref 窗口）
- tasks/gap-git-graph-live-ref-oracle-siblings-unfrozen.md（自身）
