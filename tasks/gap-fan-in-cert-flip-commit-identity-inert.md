---
id: gap-fan-in-cert-flip-commit-identity-inert
title: suite 证书闸对 driver 自己的 flip-done 提交按【身份】判惰性，不再交给依赖 registry
  的分类器——外部项目每个任务白烧 3～6 次全量 suite 的根因修复
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
---
## Proposal

<!-- dedup-ref -->相关已完成任务（仅追溯）：gap-ff-merge-suite-cert-classifier-unshipped-and-misreported（分类器在安装布局下没跑起来）、gap-fan-in-ff-retry-reruns-suite-on-inert-increment（惰性增量不重跑 suite）、gap-ff-merge-quotepath-breaks-inert-retry。

**问题（另一项目实测报告 + 本仓复现，2026-09-20）**：flip-done 在 suite 跑完之后把 `tasks/<id>.md` 提交到任务分支，tip 于是超过 `suite_head`；证书闸（`packages/quay/src/fan-in/ff-merge.ts` 约 455-467 行）因此必须判定 `suite_head..tip` 是否惰性，调 `select-static-checks-for-touches.ts --classify-delta`。该分类器读 `<root>/plugin/scripts/runner-static-gate.ts`（`TEST_SH_REL` 硬编码），外部项目没有它 ⇒ exit 2 ⇒ `not-evaluated` ⇒ fail-closed 拒 ff ⇒ 白烧一次全量 suite；重投直到某次 flip-done 恰为 no-op（delta 为空）才落地。该项目实测每个任务 3～6 次尝试、3 次全量 suite 才落一次，3 个任务因此被重试上限翻成 needs-human。本仓复现：`node --experimental-strip-types plugin/scripts/select-static-checks-for-touches.ts --classify-delta --root <无 registry 的外部项目> tasks/x.md` exit 2；放一个空 `plugin/scripts/runner-static-gate.ts` 后 exit 0（`tasks/x.md` 惰性、`src/app.ts` 与 `README.md` 判为代码）。`ff-merge.ts` 与 `v0.10.0` 无差异，缺陷在 develop 上同样存在。

**人的裁定（2026-09-20，逐字）**：不希望 driver 自动停掉所有任务；重试上限保持不变；「仍会一次翻出多个 needs-human，每个都带同样的原文判词：接受」；不做仪器故障免计数、不做失败指纹停派（历史回放：指纹相同即停会停 92 个任务，其中 89 个后来落地，故否决）。

**做法**：证书闸在调分类器**之前**先做身份判定：若 `git rev-list suite_head..tip` **恰好一个提交**，且其父提交 == `suite_head`，且 `git diff --name-status suite_head tip` **恰好一行、状态为 M、路径 == 该任务在 `tasks_dir` 下的任务文件**（`tasks_dir` 读自 `.quay/config.yml` 已启用 provider，⛔ 不写死 `tasks/`）⇒ 判惰性，不调分类器。任一条不满足 ⇒ 落回现有分类器路径（行为不变）。不改重试上限、不改 needs-human 逻辑。

## AC

- [x] `node --test plugin/test/fan-in-ff-merge.test.mjs` exit 0，新增用例覆盖：① 单个 flip 提交、仅 M 该任务文件 ⇒ 惰性且**分类器未被调用**（以调用计数或 stub 断言）；② 同一提交多改一个文件 ⇒ 落回分类器；③ 两个提交 ⇒ 落回分类器；④ 状态为 A/R/D ⇒ 落回分类器；⑤ 改的是**别的任务**的文件 ⇒ 落回分类器；⑥ `tasks_dir` 配成非 `tasks/` 目录时按配置判定。
- [x] 反例判据（硬规则 4 推论三）：把身份判定短路关掉（注入 seam 置为 false）后，用例 ① 必须变红（证明它读到了真实的判定，不是回声）。
- [x] 真实对象：在临时外部 git 项目（无 `plugin/scripts/runner-static-gate.ts`）里，建任务分支、造 suite_head、追加一个只改 `tasks/<id>.md` 的 flip 提交，运行证书闸——修复前 `NOT-EVALUATED`（贴出原文），修复后通过（贴出原文）。同一项目里追加一个改 `src/app.ts` 的提交后仍走分类器（结果仍为 NOT-EVALUATED，贴出）——证明身份判定不放宽其它路径。
- [x] `scripts/test.sh --for-task gap-fan-in-cert-flip-commit-identity-inert` exit 0。

## DoD

在无 registry 的外部项目里，真实走通「suite 绿 → flip-done → 证书闸」不再因 NOT-EVALUATED 被拒；只改任务文件的 flip 提交被判惰性，任何多出的文件或提交仍走原分类器；重试上限与 needs-human 逻辑字节未变。

## Touches

- packages/quay/src/fan-in/ff-merge.ts
- plugin/test/fan-in-ff-merge.test.mjs
- tasks/gap-fan-in-cert-flip-commit-identity-inert.md
- packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs（不是本缺陷的载体，是本轮 fan-in 的**阻塞器**：该文件 AC3 的实时 ref 竞态与本 delta 无关，但每次 suite 都可能红 ⇒ 见 Evidence E1–E5）

## Evidence

### E1 本轮 suite 红的归因：一条落在两次读之间的提交（⛔ 不是本 delta 引入）

上轮 `exited-not-landed` 于 `step=suite`，`# fail 1`，唯一失败文件与本任务 delta 无 import 通路：

```
packages/quay/test/gap-git-graph-pagination-mainline-lane-empty-before-page.test.mjs:127:10
✖ AC3: every in-window second parent is fetched (no side branch lost by the production traversal)
  AssertionError [ERR_ASSERTION]: git --all emits 200 commits; the data layer dropped 1 (side branch lost)
  1 !== 0
```
日志：`/home/yale/work/quay/.quay/fan-in-suite-gap-fan-in-cert-flip-commit-identity-inert~wk-prod-anchor~1789891421089-765b21.log:7888-7894`（`# pass 3419 / # fail 1`）。

**归因读数（机械，非推断）**：该文件 AC3 结束于 `end_ms=1789891775883`（= 08:09:35.883Z，duration 214ms ⇒ oracle 读在 08:09:35.87Z），而 `git reflog` 显示
`e18962e2a HEAD@{2026-09-20 08:09:35 +0000}: commit: tasks: gap-anti-drift-… todo→ready（promotion-driver 机械晋升）`
——**恰好落在那两次读之间**。`--all` 窗口头因此前进 1 ⇒ 尾部掉出 1 ⇒ `dropped = 1`，掉出的正是**数据层读不到的那个新提交**。

**隔离重跑（判据）**：`node --test …mainline-lane-empty-before-page.test.mjs` ⇒ `tests 3 / pass 3 / fail 0`（修前，工作树内）。⇒ 红不是本 delta 造成的，是**窗口位移**。

### E2 根因：AC3 的两侧是两次独立实时读，中间没有快照（同族先例：已修过一份，未修这一份）

- 数据层：`readGitHistory(REPO_ROOT, {limit})` → `git log <GIT_HISTORY_REF_SCOPE> --topo-order -n 200`（`observation.ts`；AC1 先调过 ⇒ AC3 复用其 **30s TTL 缓存**，所以两次读的间隔不是毫秒级而是 ~1 秒级）。
- oracle：`liveWindowHashes()` → 同一条 argv 的**第二次实时读**。间隔内任何 ref 前进 K 个 ⇒ 窗口头多 K、尾部掉 K ⇒ `dropped = K`。

**硬规则 5b（修好一处 ≠ 只此一处）**：同一 race 已在**兄弟文件**修过并通过 ——
`gap-git-graph-pagination-ac2-oracle-races-live-refs`（done）对 `gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs` 实现了冻结 ref 窗口（`snapshotRefWindow()` / `frozenGitExec()`），且当时**未**覆盖本文件。**全库扫描同一形态**（`readGitHistory(REPO_ROOT…` ∧ 实时 `git` oracle ∧ 无冻结）：`gap-git-graph-adopt-git-column-algorithm-and-decorate-labels` / `-cross-column-edges-drawn-as-fixed-stubs-not-anchored` / `-decoration-labels-as-colored-chips` / `-stride-chip-overlaps-commit-row-text` / `-task-view-aggregate-commits-by-task-id` / `-reconstructed-lanes-all-named-mainline-ref` / `-ref-partition-collapses-all-topology-to-one-lane` 共 7 个文件**仍带同一形态**，但它们的 oracle 与数据层**不构成 AC3 那一对同 argv 的两次读**（逐条看过：有的只在同一函数内读一次、有的读的是 `%D`/`--graph` 而数据层另有快照缝隙）——本任务只修**已实际误杀本轮 fan-in 的这一个**，其余 7 个不属本任务 Touches，另记，⛔ 不借机扩大 delta。

### E3 修法：把 ref 集合冻结成不可变对象名，两侧同源（生产读路径零改动）

`observation.ts` **零改动** —— 冻结列表经它既有的 `exec` 宿主读取缝隙（`GitExec`，其设计理由逐字就是 "hand the reader a frozen snapshot of the host instead of racing the live repo"）进入生产读路径；oracle 用**同一个** `shas`。新增 `snapshotRefWindow()` / `resolveRefWindow()` / `frozenGitExec()` / `oracleWindowHashes(scope)`，AC3 在**任一侧读之前**一次性取值。`frozenGitExec` 是 **fail-closed**：`log` 调用里没有 `--all` 就 throw（⛔ 不静默回答另一个问题，硬规则 3b）——沿用同文件 `linearWindow()` 缝隙既有的纪律。

**落笔前干跑（硬规则 4c）**，工作树 `-n 200`：
```
live --all md5: bc7c2972de509f4172b0edb5f0b04d9c  -
frozen  refs md5: bc7c2972de509f4172b0edb5f0b04d9c  -
EQUIVALENT ✔   refs count: 182
```
（`refs/notes/*` 从冻结列表里排除，因为 `GIT_HISTORY_REF_SCOPE` 排除它——只冻结不够：一个稳定的、仍带 notes 链的窗口是「稳定地错」。）

### E4 受控复现（隔离 clone，单一变量 = 跑测试期间推进 ref 的 churn 循环）

```
git clone --shared <worktree> /tmp/ggw-race-probe；拷入本文件（带修）；symlink node_modules
churn: while :; do git commit -q --allow-empty -m churn && git update-ref refs/scratch/race HEAD; sleep 0.25; done
```
| 臂 | 冻结 | churn | 读数 |
|---|---|---|---|
| 修前形态（`QUAY_TEST_GIT_GRAPH_LIVE_REFS=1`） | 关 | 开 | **红 3/3**：`pass 2 fail 1`，原句 `the data layer dropped 1` / `dropped 1` / `dropped 2` |
| 修后（缺省） | 开 | 开 | **绿 3/3**：`pass 3 fail 0` |
| 修后（缺省） | 开 | 关 | 绿 3/3 |

⇒ 与真实样本**同一签名**（`dropped K`，K=1）；单变量可区分：同一份代码只翻转冻结开关，红/绿互换 ⇒ 冻结窗口是**被读到的**，不是回声（硬规则 4 推论三）。churn 探针已删除（`rm -rf /tmp/ggw-race-probe`），源仓库未被扰动。

### E5 负控制另一半：非空性判据没被这次修复削弱

`QUAY_GGW_LINEAR_WINDOW=1`（既有的线性窗口缝隙）⇒ AC3 **仍红** `the window contains merge second parents to verify (non-vacuous)`（`fail 1`）。⇒ 冻结没有把 AC3 变成恒真；窗口内第二父的边缘仍是真的被数出来的。
三臂的绿色读数都带**臂标识**（`frozen at <ts> (N ref object names)` / `LIVE --all (QUAY_TEST_GIT_GRAPH_LIVE_REFS=1)` / `linear`），⛔ 三个臂不会互相冒充。

### E6 反例判据（硬规则 4 推论三）：关掉冻结 ⇒ 并发 churn 下重新报红

见 E4 第一行：`QUAY_TEST_GIT_GRAPH_LIVE_REFS=1` ∧ churn ⇒ **红 3/3**，且**修前形态**就是缺这个冻结。⇒ AC3 读的是真实判定。

### E7 诚实口径注：scoped-gate 缓存的 `--develop-sha`

缓存键是 `(task, developSha)`，fan-in 的命中判据是**锁内 merge 到的 develop tip 逐字相符**（`worker-driver.ts:4787-4791`）。本文件记录的 sha 取**本门实际验证过的**那个 develop tip（worktree 里那个 merge 提交的第二父），⛔ 不取「写缓存那刻的 `git rev-parse develop`」——develop 若在跑门期间前进，后者会记下一个**本门从未验证过**的状态，制造假命中。develop 此后前进 ⇒ 未命中 ⇒ 门照跑（fail-closed，安全方向）。
