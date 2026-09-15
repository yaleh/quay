---
id: gap-first-green-release-and-master-ff
title: 首次真实全绿发布且 master 已 ff 到它的 tag：落地 advance-master job + needs 全集静态检查并真跑一次（AC-274）
status: todo
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-274
---
**type:** execution

## Finding

**缺口｜AC-274 的 (b) 半条今天结构性不可达：判据要求 `git rev-parse master`（本地 ref）等于一个「post-filing 窗口内全绿 Release run」的 tag 提交，而把 master 推到那个 tag 的机制——SPEC §6.1 裁定的 `advance-master` job——在本仓任何 workflow 里都不存在，也没有任何任务在造它。**

2026-09-15 立案实测（全部为直接量）：

```
$ git rev-parse master ; git rev-parse origin/master
9316b797dddc89d4b6168051b781e6d554fc70fa      ← master 停在化石 tip（本地与 origin 同值）
9316b797dddc89d4b6168051b781e6d554fc70fa
$ git tag -l | tail -3                          → v0.6.1 / v0.6.2 / v0.6.3
$ python3（读 .quay/ci-runs.jsonl，全 40 条）    → workflow="Release" 的只有 2 条，且都 failure：
                                                   2026-09-14T12:48:42Z  failure  v0.6.3
                                                   2026-09-14T12:22:03Z  failure  v0.6.2
$ git show develop:.github/workflows/release.yml | grep -nE '^  [a-z0-9-]+:'
  release:28  sea-release:119  sea-verify-node-free:269
  sea-verify-node-free-cross-platform:364  dist-verify-node-floor:452
  delivery-manifest-verify:499                  ← 6 个 job，其中没有 advance-master
$ grep -rln "advance-master" tasks/ plugin/ .github/
（仅 orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md 命中）  ← 只有 SPEC 写了，零实现、零任务
$ node packages/quay/bin/quay.js goal gate AC-274 --dry-run
verdict=fail  reason=acceptance failed (exit 1) — CAUSE=no-green-release-in-the-post-filing-window
```

四点由此确定，每点对应本任务的一个动作：

1. **(a) 半条已有持有者，本任务不重复它。** 「post-filing 窗口内出现过一次全绿 Release run」由 `gap-release-cut-via-workflow-dispatch` 承接（其 frontmatter `goal_ac: AC-268`，status todo），机制是 workflow_dispatch 切 tag 并让那次 run 全绿。本任务只消费它的结果。

2. **(b) 半条零持有者，这是本任务必须补的那一块。** SPEC §6.1 已裁定（人 2026-09-15，裁定 3）：master 的推进走 `release.yml` 内新增的 `advance-master` job —— `needs:` 枚举其余全部 job、`permissions: contents: write`、`git push origin ${{ inputs.tag }}:master`（⛔ 永不加 `--force`）。SPEC §9 第 4 步明写它「实现可今天就做」，但至今没有 AC、也没有任务承接它。

3. **criterion 比的是本地 ref，不只是 origin。** job 推的是 `origin/master`；本地 `master` 不动的话，判据照样报 `CAUSE=green-release-not-reflected-on-master`。⇒ 本任务必须把本地 master ref 以 ff-only、无 `--force` 的方式同步（`git fetch origin master:master`），并留下前后读数。

4. **载体字段约束（会被误读成 (b) 失败）**：criterion 把 `branch` 字段直接当 tag 名去 `git rev-parse --verify <branch>^{commit}`。`plugin/scripts/ci-runs-collect.ts:164` 写入的是 `head_branch`；既有两条 Release 记录的 `branch` 正是 `v0.6.3` / `v0.6.2`。⇒ 若新记录的 `branch` 不是 tag 名，判据会在 master 明明正确时报 `green-release-not-reflected-on-master`——一个指错方向的失败。故本任务把它写成一条独立 AC。

**顺序上的一条硬约束（影响能不能只发一版就收口）**：`workflow_dispatch` 的一次 run 用的是**被点名 tag 那棵树里的** `release.yml`。⇒ 若 advance-master 未在切 tag 之前进入 develop，那次 run 里就没有推进 master 的 job，master 不会动，AC-274 只能靠**另切一版**满足。

<!-- dedup-ref -->
同族但机制不同，故不是重复：`gap-release-cut-via-workflow-dispatch`（AC-268）只负责让那次 run 全绿并落进载体，其 AC1–AC12 无一条要求 master 移动；`gap-release-branch-deleted-after-merge`（AC-271）管的是 release 分支合回后删除；`gap-develop-ci-first-decisive-green`（AC-265）产载体与采集器，`gap-release-run-tests-hangs-on-shared-mcp-client-leak`（AC-266）与 `gap-sea-artifact-plugin-root-toplevel-eval`（AC-267）修的是那两个让 release run 变红的缺陷。本任务的机制是 **`advance-master` job 的存在性 + 它真跑成一次 ff**。

## Requested action

1. **实现面（不等任何兄弟任务，今天可做）**：按 SPEC §6.1 逐字形态在 `.github/workflows/release.yml` 加 `advance-master` job —— `needs:` 机械枚举其余全部 6 个 job（`release` / `sea-release` / `sea-verify-node-free` / `sea-verify-node-free-cross-platform` / `dist-verify-node-floor` / `delivery-manifest-verify`）、`runs-on: ubuntu-latest`、`permissions: contents: write`、`actions/checkout@v4` 带 `ref: ${{ inputs.tag }}` 与 `fetch-depth: 0`、最后一步 `git push origin ${{ inputs.tag }}:master`（⛔ 不得出现 `--force`）。三条不变式的语义见 SPEC §6.1 表：任一 job 非 success ⇒ 本 job 被 `needs` 跳过（fail-closed 是 GitHub 默认语义，不是额外代码）；非 ff 更新被 `git push` 默认拒绝；`needs:` 漂移由第 2 步的机械检查挡住。

2. **同批落 `needs:` 全集静态检查（⛔ SPEC §6.1 明写「与 A 同批落地，不得延后」）**：断言 `advance-master.needs ⊇（release.yml 全部 job 键 − advance-master）`。**读不懂输入时必须给独立取值（NOT-EVALUATED），不得与 PASS 同形**：读不到 workflow、解析不出 `jobs:`、目标 job 不存在，三者都要可区分（硬规则 3b）。归位按 SPEC §10 残留 2 在实现时定；默认形态取既有 release.yml 型检查器的先例（登记形态见 `plugin/scripts/runner-static-gate.ts:933`）。**若新建 `plugin/scripts/*.ts`，四件机械义务必须同批**：`capability-catalog.sh` 六张表各一行、登记进 `runner-static-gate.ts` 的 `run_static_checks`（含 `@static-tier` / `@static-object`）、`checker-mutation-cases/<basename>.sh`、`@checker-count` 注解 +1；并补 `experiments/quay-perpetual-stream/scripts/` 的孪生文件（其余镜像对是符号链接）。⛔ 若最终落在上面 `## Touches` 之外的路径，落地前必须先把 Touches 更新为实际路径。

3. **双向控制**：对一份**新增了第 7 个 job 却没写进 `needs:`** 的 `release.yml` 副本跑该检查 ⇒ 非零；对真文件跑 ⇒ 零；对一份读不到的输入跑 ⇒ NOT-EVALUATED。⛔ 只跑真文件那一次证明不了它能取假（硬规则 4）。

4. **真跑（消费 AC-268 的结果）**：经 AC-268 的 dispatch 路径触发该 tag 的 Release run，轮询到终态。记 `runId`、**逐个** job 名与 conclusion、墙钟耗时。**全部 job success 才继续**；任一失败 ⇒ 走第 8 步的如实分支。若此刻已经有一次全绿 run、但它的 tag 树里没有 `advance-master`（即实现面落在切 tag 之后）⇒ 用同一 dispatch 机制**另切一版**（新 tag，同 AC-268 的切法），使 (a)(b) 在同一次 run 上同时成立。

5. **确认 `advance-master` 真跑成**：`gh run view <runId> --json jobs` 里 `advance-master` 的 `conclusion=success`，并在日志里定位它的 push 行（含被推的 `tag:master`）。⛔ 「job 出现在列表里」不等于「job 跑成」。

6. **同步本地 master ref（ff-only，无 `--force`）**：先核 `git merge-base --is-ancestor master <tag>` 为真（证明是 ff 而不是改写）；再 `git fetch origin master:master`；留 `git rev-parse master` / `git rev-parse origin/master` 的前后四行读数。⛔ 本地只做只读同步，推进动作只由第 4 步的 job 做。

7. **经采集器落痕**：用 `plugin/scripts/ci-runs-collect.ts` 的既有调用方式把该 run 写进 `.quay/ci-runs.jsonl`（`workflow=Release`、`conclusion=success`、`ts` = run 的创建时刻、`branch` = **tag 名逐字**）。⛔ 不手写 JSONL 行。

8. **双向验收**：逐字跑 `goals/AC-274-*.md` 的 `criterion:` 块，**经 store 自己的 runner**（`quay goal gate AC-274 --dry-run`，⛔ 不用本地抄一份的 python）⇒ exit 0；再做 AC8/AC9 两条负控制。若最终没拿到全绿：逐字记录 runId + 失败 job + 首条决定性日志行并归因到 AC-265/266/267 或 AC-268 的范围，**不宣告完成**。

## Acceptance Criteria

- [ ] **AC1 实现面已落 develop**：`git show develop:.github/workflows/release.yml | grep -c advance-master` ≥ 1；贴出该 job 整块；并**机械**列出 workflow 全部 job 键（用 python 解析 `jobs:`，⛔ 不手抄）与 `advance-master.needs` 求集合差 = ∅；`git show develop:.github/workflows/release.yml | grep -c -- '--force'` = 0。
- [ ] **AC2 检查器三态可区分（能取假）**：对「新增第 7 个 job 而 `needs:` 未更新」的副本 ⇒ **非零**（贴 exit 码 + 报错行）；对真文件 ⇒ **0**；对读不到的输入 ⇒ **NOT-EVALUATED 且 exit 码与 PASS 不同**。三次运行逐字贴出。⛔ 只有「真文件 ⇒ 0」这一条不算验证（硬规则 4）。
- [ ] **AC3 检查器已登记**：若为新建 `plugin/scripts/*.ts`，逐条贴出四件义务的读数——`capability-catalog.sh` 六张表各一行、`runner-static-gate.ts` 的 `run_static_checks` 登记行、`checker-mutation-cases/<basename>.sh` 存在、`@checker-count` 的 +1 后取值；`node --experimental-strip-types plugin/scripts/checker-count-drift-check.ts --root .`、`node --experimental-strip-types plugin/scripts/rhythm-consumer-check.ts --check`、`bash plugin/scripts/checker-mutation-check.sh --check` 三条 exit 0。若检查器落在既有文件里，贴出该文件与它覆盖新不变式的判据/单测读数。
- [ ] **AC4 run 全绿**：`gh run view <runId> --json conclusion,jobs` —— run 的 `conclusion=success` ∧ **每一个** job 的 conclusion 都是 `success`（逐个列出 job 名与结论；⛔ 不许以「主要 job 绿」代替全部）；并给出载体记录里该 run 的逐 job 清单，证明两侧读数一致。
- [ ] **AC5 `advance-master` 真跑成**：该 run 的 job 列表里 `advance-master` 的 `conclusion=success`，并贴出它的 push 步骤日志行（含 `tag:master`）。
- [ ] **AC6 master 是 ff 上去的，不是改写**：`git merge-base --is-ancestor master <tag>` 为真；`git rev-list --count master..<tag>` = 0 ∧ `git rev-list --count <tag>..master` = 0；`git rev-parse master` == `git rev-parse <tag>^{commit}`（贴出两个 sha）。
- [ ] **AC7 本地 master ref 已同步且推进只发生在 CI 侧**：贴出 `git fetch origin master:master` 前后 `git rev-parse master` / `git rev-parse origin/master` 四行读数，同步后本地 master == tag 提交；全轮无 `--force`、无本地直接 `git push origin …:master`。
- [ ] **AC8 AC-274 判据取真**：`node packages/quay/bin/quay.js goal gate AC-274 --dry-run` ⇒ **exit 0**，贴出 stdout/stderr 与退出码。**负控制 (a)**：复制载体、删掉那条 post-window 全绿行，对副本同法跑 ⇒ **exit 1 ∧ stderr 含 `CAUSE=no-green-release-in-the-post-filing-window`**，逐字贴出。
- [ ] **AC9 负控制 (b)：绿了但 master 没跟上**：在一个 master 停在非 tag 提交的独立检出（临时 clone/worktree，载体含那条全绿行）里跑同一 criterion ⇒ **exit 1 ∧ stderr 含 `CAUSE=green-release-not-reflected-on-master`**。逐字贴出。⛔ 不做这一步，AC8 的 exit 0 就不是读数而是回声（硬规则 4）。
- [ ] **AC10 载体行经采集器且 `branch` == tag 名**：贴出 `.quay/ci-runs.jsonl` 新增行逐字（含 `branch` 字段）、产生它的采集器调用命令、前后行数（证明是新追加而非手写）。**负控制**：把该行 `branch` 改成一个非 tag 值（如 `develop`），对副本跑 criterion ⇒ exit 1 且 CAUSE = `green-release-not-reflected-on-master`——证明这条字段约束是真约束。
- [ ] **AC11 未成功即如实**（条件触发）：若最终没拿到全绿，逐字记录 runId + 失败 job + 首条决定性日志行，并归因到 AC-265/266/267 或 AC-268 的范围，**不**宣告本任务完成。

## Definition of Done

真实落地（DIR-026 Reading A）的形态**不是**「多了一个 job 块」，也**不是**「一次 dispatch 成功」，而是：**一次 workflow_dispatch 触发的 Release run 的每一个 job 都是 success，其中 `advance-master` 那个 job 真的把 master 推到了该 tag，本地 master ref 也随之 ff 到同一个提交——于是 `quay goal gate AC-274` 在真实载体与真实 git 读数上 exit 0。**

fixture、注入数据、手写 JSONL 行、「job 写进 yml 了就算数」一律不算。三个面各要有读数：机制落地（AC1–AC3）、生产真跑（AC4–AC7）、判据两侧（AC8 取真 + AC9 取假）。

诚实分界：AC-274 是一次性判据（**不带 long-term**），故收口时**不**把它写成「每轮复验」形态。若第 4 步没拿到全绿，本任务的交付物是**失败归因 + 未闭合声明**，不是「已完成」。

## Touches

- tasks/gap-first-green-release-and-master-ff.md
- .github/workflows/release.yml
- plugin/scripts/release-master-advance-needs-check.ts (new)
- experiments/quay-perpetual-stream/scripts/release-master-advance-needs-check.ts (new)
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/capability-catalog.sh
- plugin/scripts/checker-mutation-cases/release-master-advance-needs-check.sh (new)
- plugin/test/release-master-advance-needs-check.test.mjs (new)
- .quay/ci-runs.jsonl
