---
id: gap-git-graph-live-ref-oracle-siblings-unfrozen
title: git-graph 测试族里仍有 4 个「实时 ref oracle 对实时数据层读」的对拍判据未冻结 ref 窗口——同族的第 3
  份实例又会以窗口位移误杀 fan-in
status: ready
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

- [x] 4 个文件逐一对拍判据的两侧取自**同一个不可变 ref 集合**（快照或等价机制），打印实现位置与取值时机；`observation.ts` 保持零改动（除非能证明必须改）。
- [x] 负控制可区分（硬规则 4 推论三）：每个文件都留一个「关掉冻结」的注入缝隙（沿用 `QUAY_TEST_GIT_GRAPH_LIVE_REFS=1` 这一族命名，⛔ 不设第二个语义相同、名字不同的开关）；隔离 clone + churn 下关掉 ⇒ 红、打开 ⇒ 绿，两臂都是真实读数。
- [x] 判据不得退化：各文件原本的非空性/一致性断言修后仍能取假（至少给出一处「构造错位读数 ⇒ 报红」的真实读数），⛔ 不得用「只比交集」「重读一次生产函数」等方式削弱。
- [x] `scripts/test.sh --for-task <本条>` exit 0，且**逐行核过**选中的测试确实包含这 4 个文件（不是只看 exit code —— 本仓库实测过「门绿在 0 个测试上」的形态）。

## Evidence

**AC1 — 实现位置与取值时机（运行时打印，非注释声称）**
- 位置：`packages/quay/test/helpers/git-ref-window.mjs`。`snapshotRefWindow()`（一次性 `for-each-ref` ∪ `rev-parse HEAD`，⛔ 排除 `refs/notes/*` 以镜像生产 `GIT_HISTORY_REF_SCOPE`）→ `windowScopeArgs(refs)`（**oracle 侧** argv）/ `windowGitExec(refs)`（**数据层**：经 `observation.ts` 既有 `exec` 宿主读取缝隙）。4 个文件**共用这一个实现**——本条缺陷正是「各文件各自重新推导同一个 oracle」，第 5 份本地拷贝就是把缺陷复制到第 5 个载体。
- 取值时机：每个对拍判据读前取一次。运行时逐条打印：
  `[ref-window] attempt 1/20: FROZEN at 2026-09-20T08:58:49.592Z (181 ref object names); packages/quay/test/helpers/git-ref-window.mjs snapshotRefWindow() → windowScopeArgs()/windowGitExec()`
- 干跑等价（本仓库实测，181 个 ref 对象名，含 **18 个 annotated tag**；⛔ 不靠推断）：`git log --exclude=refs/notes/* --all --topo-order -n {5,50,200,500}` 与 `git log <frozen> …` 输出 **md5 相同**；`--graph` 同；`-1 --pretty=%H` 同（annotated tag 被 `git log` 与 `--all` 同样 peel）。
- `observation.ts` 零改动：`git diff --stat develop...HEAD -- packages/quay/src/observation.ts` 为空。

**AC2 — 负控制（隔离 `git clone --shared` + 每 250ms 推进 scratch ref `_churn`）**
- 单一开关：helper 内一处 `LIVE_REFS = process.env.QUAY_TEST_GIT_GRAPH_LIVE_REFS === "1"`；4 个文件不另设开关。
- **关掉冻结（`QUAY_TEST_GIT_GRAPH_LIVE_REFS=1`）×3 ⇒ RED**：fail 2 / 6 / 5（exit 1）。真实签名：`column mismatch = 0 (got 1)`、`the label set matches %D-nonempty commits exactly (mismatch 2)`、`rows[0] (smallest y) is the newest --all commit`、`every rendered label matches git %D exactly (mislabel 1)`、`the recycling allocation matches git (precondition)`。
- **打开冻结 ×3 ⇒ GREEN**：17/17 pass ×3（exit 0）；stability gate 实际触发 retry 0 / 4 / 6 次（证明闸门在跑，不是空转）。
- 两臂同 clone、同 churn、同 4 个文件，**只差冻结**。

**AC3 — 判据不退化（构造错位读数 ⇒ 报红，且 refs 稳定）**
- clone 内两个 shim（改 oracle，不改数据层）：列号 oracle 全体 +1 ⇒ `column mismatch = 0 (got 500)`；`%D` oracle 每条加一个伪 label ⇒ `mislabel 500`。两者 RED，且都在 **attempt 1 直接上抛**（`withStableWindow` 不吞稳定 refs 下的真失败）。
- 各文件原有负控制（adopt AC2 no-recycle 列分配、ref-partition AC2 塌成一列、stride AC3 还原浮动 chip）在 17/17 绿中同时通过 = 它们各自观察到 >0。
- ⛔ 未使用「只比交集」「重读一次生产函数」等削弱手法；两侧仍是两次独立 git 读，只是起点列表不可变。

**⚠️ 实测发现的第二个机制（超出本条 Finding 的诊断，已一并修掉）**：**冻结 ref「集合」并不冻结 `%D`**。同一份不可变对象名列表下，两次相邻 `git log … %D` 读数**会不同**（实测：`b644776…_churn` → `b644776…`）——churn ref 前进到冻结列表之外的提交，原来带 decoration 的提交就失去了它。`%D` 由 git 从**实时 ref 表**渲染，而 3 个文件判的正是 decoration 集合 ⇒ 残留同类假失败。`%D` 无法在不让一侧沦为回声（硬规则 4）的前提下钉死，故加 `withStableWindow()`：整个判据在 ref 映射变动时重取（refs 稳定时的失败**立即上抛**；尝试耗尽则 fail-closed 报错，⛔ 不静默通过）。

**AC4 — scoped 门 exit 0，选择面逐行核过**
- `bash scripts/test.sh --for-task gap-git-graph-live-ref-oracle-siblings-unfrozen --allow-thin` ⇒ **exit 0**，`tests 17 / pass 17 / fail 0`。
- 选择面逐行核过（`select-tests-for-touches.ts --root <worktree> --task <本条> --allow-thin`）：`task gap-git-graph-live-ref-oracle-siblings-unfrozen: 4 test file(s)`，其后逐行就是这 4 个文件（adopt / reconstructed / ref-partition / stride）——⛔ 不是「只看 exit code」，也不是「门绿在 0 个测试上」。
- **重跑过一次**：develop 在本轮内前进（`8721aa853` → `8a260e748`，其中 `plugin/scripts/anti-drift-touches-check.ts` +184 行），故重新 `merge develop` 并**重跑** scoped 门 ⇒ 仍 exit 0 / 17 pass。
- `anti-drift-touches-check --task <本条> --worktree <wt> --merge-target develop` ⇒ `ANTI-DRIFT OK: 5 actual file(s), all within declared Touches (6 glob(s))`。
- scoped-gate cache 以 `develop=8a260e748` 写入 `.quay/scoped-gate-cache.json`。

**DoD 佐证**：`observation.ts` 零改动；各判据负控制仍取红；生产读路径与判据强度均未下降。

## DoD

git-graph 测试族里不再存在「实时数据层读 × 实时窗口 oracle」的对拍判据：任何 ref 在两次读之间前进都不再产生假的 `dropped K` / `git=undefined` 不一致；生产读路径（`observation.ts`）与这些判据的强度都不下降（各自的负控制仍能取红）。

## Touches

- packages/quay/test/gap-git-graph-adopt-git-column-algorithm-and-decorate-labels.test.mjs（AC1 `:75`→`:79`、`:133`→`:142`、AC6 `:200`→`:203` 三处对拍点冻结 ref 窗口）
- packages/quay/test/gap-git-graph-stride-chip-overlaps-commit-row-text.test.mjs（`:138`→`:147` 的 `%D` oracle 冻结 ref 窗口）
- packages/quay/test/gap-git-graph-reconstructed-lanes-all-named-mainline-ref.test.mjs（AC3 `:55`→`:62` 的 `%D` oracle 冻结 ref 窗口）
- packages/quay/test/gap-git-graph-ref-partition-collapses-all-topology-to-one-lane.test.mjs（AC3 `:57`→`:60` 的 `--graph` 列号 oracle 冻结 ref 窗口）
- packages/quay/test/helpers/git-ref-window.mjs（新增：4 个文件共用的冻结 ref 窗口唯一实现 + `withStableWindow()` 稳定性闸）
- tasks/gap-git-graph-live-ref-oracle-siblings-unfrozen.md（自身）
