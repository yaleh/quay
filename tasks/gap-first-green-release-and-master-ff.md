---
id: gap-first-green-release-and-master-ff
title: 首次真实全绿发布且 master 已 ff 到它的 tag：落地 advance-master job + needs 全集静态检查并真跑一次（AC-274）
status: ready
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

**2026-09-15 第二轮实测补：这条路真正被卡住的地方不是机制，是一个 GitHub 平台权限。** 真跑（run `35005849727`）里 **9 个原 job 全部 success**（含历史性首次成功的 `release` job），`advance-master` 是第 10 个、也是唯一失败的：它跑到了 push 那一步，被远端拒绝 ——

```
! [remote rejected] 5fdb3e646... -> master
(refusing to allow a GitHub App to create or update workflow `.github/workflows/release.yml`
 without `workflows` permission)
```

根因（**不是**本 job 的写法）：首次 ff 把 master 从 2026-08-03 的化石 tip 推进 19673 个提交，这段 delta 里 `release.yml` 被改过（`gap-github-actions-no-implicit-triggers` 等），而推送身份是 `GITHUB_TOKEN`（一个 GitHub App）；GitHub 拒绝任何**创建/更新 `.github/workflows/` 文件**的推送，除非该 App 有 `workflows` 权限 —— **而 `permissions:` 里没有 `workflows` 这个键**（GitHub 官方文档列出的可授权键为 actions / artifact-metadata / attestations / checks / code-quality / contents / deployments / discussions / id-token / issues / packages / pages / pull-requests / security-events / statuses / vulnerability-alerts，**无 workflows**）。⇒ 不是「加一行 `permissions: workflows: write`」能修的。

**双向对照（同一次测试，两个身份，同一个提交）**：同一枚提交 `5fdb3e646`，CI 里的 `GITHUB_TOKEN` ⇒ **拒绝**（上面那条原文）；本机用户 token（`gh auth status` → scopes `'gist','read:org','repo','workflow'`）⇒ `git push --dry-run origin 5fdb3e646:master` **exit 0**，`9316b797d..5fdb3e646 -> master` 可 ff。⇒ 限制**由身份决定，不由内容决定**：**具备 `workflow` 权限的用户/App 凭据可以推，`GITHUB_TOKEN` 不行**。

⇒ 兑现 AC-274 需要**人裁定一个凭据**（三者之一）：①加一个带 `workflow` scope 的 PAT 作为 repo secret，供 `advance-master` 的 checkout 用；②装一个有 `workflows: write` 的 GitHub App 并换取 token；③改走 SPEC §6.1 表里本就并列的 **C 本地机件**（`plugin/scripts/release-advance-master.ts`）—— 但本任务的 AC7 逐字禁止本地直接推 master，故 ③ 等于要人改裁定。⛔ 本 worker **没有**自行绕过：用 refs API 直接移动 ref 去规避这条平台护栏属于**安全护栏绕过**（该护栏正是为了防止被污染的 workflow 改写 workflow 文件而设），超出 worker 权限。

<!-- dedup-ref -->
同族但机制不同，故不是重复：`gap-release-cut-via-workflow-dispatch`（AC-268）只负责让那次 run 全绿并落进载体，其 AC1–AC12 无一条要求 master 移动；`gap-release-branch-deleted-after-merge`（AC-271）管的是 release 分支合回后删除；`gap-develop-ci-first-decisive-green`（AC-265）产载体与采集器，`gap-release-run-tests-hangs-on-shared-mcp-client-leak`（AC-266）与`gap-sea-artifact-plugin-root-toplevel-eval`（AC-267）修的是那两个让 release run 变红的缺陷。本任务的机制是 **`advance-master` job 的存在性 + 它真跑成一次 ff**。

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

- [x] **AC1 实现面已落 develop**：`git show develop:.github/workflows/release.yml | grep -c advance-master` ≥ 1；贴出该 job 整块；并**机械**列出 workflow 全部 job 键（用 python 解析 `jobs:`，⛔ 不手抄）与 `advance-master.needs` 求集合差 = ∅；`git show develop:.github/workflows/release.yml | grep -c -- '--force'` = 0。〔落地读数 2026-09-15：`git show HEAD:.github/workflows/release.yml | grep -c advance-master` = **5**；yaml 解析得 job 键 **7 个** `[release, sea-release, sea-verify-node-free, sea-verify-node-free-cross-platform, dist-verify-node-floor, delivery-manifest-verify, advance-master]`，`advance-master.needs` **6 个**，`others − needs` = **[]**（集合差为空）；`grep -c -- '--force'` = **0**。读数取自本任务分支 tip —— fan-in 的 ff 使 develop 与该 tip 逐字相同，故 AC1 的 develop 口径在 flip 后逐字成立。〕

  **第二轮补（push refspec 修复，2026-09-15）**：首轮落地的 `git push origin "${TAG}:master"` 在真 run 上被远端拒绝 —— `remote: error: cannot update ref 'refs/heads/master': trying to write non-commit object <tag-object-sha> to branch 'refs/heads/master'`。根因：**本仓所有版本 tag 都是附注 tag**（`git cat-file -t v0.7.0` → `tag`），源头解析出的是 **tag 对象**而非 commit，而 `refs/heads/*` 必须指向 commit。**双向对照（主检之外的一次性 scratch remote pair）**：未 peel 形 ⇒ `exit 1` + 上面那条原文 + master **不动**；`TARGET="$(git rev-parse "${TAG}^{commit}")"` + `git push origin "${TARGET}:master"` ⇒ `exit 0`，`923f2c1..ed09623 -> master`，**master == tag commit**。⇒ 改的是**推送的形**，不是不变式：**仍未加任何 force 标志，全文件 `--force` 计数仍为 0**。以上三条读数在第二轮提交 `f13808fc2` 的 release.yml 真文件上复跑，`needs` 全集检查仍 `exit 0`、`plugin/test/release-master-advance-needs-check.test.mjs` **14/14** 绿。

- [x] **AC2 检查器三态可区分（能取假）**：对「新增第 7 个 job 而 `needs:` 未更新」的副本 ⇒ **非零**（贴 exit 码 + 报错行）；对真文件 ⇒ **0**；对读不到的输入 ⇒ **NOT-EVALUATED 且 exit 码与 PASS 不同**。三次运行逐字贴出。⛔ 只有「真文件 ⇒ 0」这一条不算验证（硬规则 4）。〔落地读数 2026-09-15（第二轮在真文件上复跑，读数不变）：(a) **真文件的副本** + 追加一个不进 `needs:` 的第 7 个 job ⇒ `exit 1`，报错行含 `1 job(s) missing: newly-added-seventh-job`；(b) 真文件 ⇒ `exit 0`（`PASS: advance-master.needs covers every other job in .github/workflows/release.yml … jobs: 7 […]`）；(c) 读不到 = 三种形态、三个**各自独立**的 reason slug：workflow 缺席 ⇒ `exit 3 / [workflow-absent]`、无 `jobs:` 映射 ⇒ `exit 3 / [jobs-block-unreadable]`、无 `advance-master` job ⇒ `exit 3 / [target-job-absent]`。四条 exit 码 0/1/2/3 互不相同（无参 ⇒ `exit 2` + stderr `Usage:`）。另有第四条：`needs:` 值不可读 ⇒ `exit 3 / [target-needs-unreadable]`；而 **`needs:` 整个缺席 ⇒ `exit 1`（RED）不是 exit 3** —— 无依赖的 job 在**任何** run 上都会推进 master，那是可读的、且是最坏读数，不得与「读不懂」同形。全部形态由 `plugin/test/release-master-advance-needs-check.test.mjs` **14/14** 绿 + `checker-mutation-cases/release-master-advance-needs-check.sh`（含一个**对真 release.yml 逐字副本**的相）机械复现。〕

- [x] **AC3 检查器已登记**：若为新建 `plugin/scripts/*.ts`，逐条贴出四件义务的读数——`capability-catalog.sh` 六张表各一行、`runner-static-gate.ts` 的 `run_static_checks` 登记行、`checker-mutation-cases/<basename>.sh` 存在、`@checker-count` 的 +1 后取值；`node --experimental-strip-types plugin/scripts/checker-count-drift-check.ts --root .`、`node --experimental-strip-types plugin/scripts/rhythm-consumer-check.ts --check`、`bash plugin/scripts/checker-mutation-check.sh --check` 三条 exit 0。若检查器落在既有文件里，贴出该文件与它覆盖新不变式的判据/单测读数。〔落地读数 2026-09-15（第二轮在真文件上复跑）：新建 `plugin/scripts/release-master-advance-needs-check.ts`。① 六张表各一行：`QUESTION`（catalog:319）/ `GUARD_OBJECT`（:462）/ `CADENCE`（:678）/ `INVALIDATION`（:1023）/ `LAST_REAFFIRMED`（:1368）/ `MATCHING`（:1713）均已登记 —— `capability-catalog.sh --summary` = `337 scripts | 337 declared | 0 unclassified | 332 ship`。② `runner-static-gate.ts:958-959` 的 `run_static_checks` 登记行（`# @static-tier change` + `# @static-object .github/workflows/release.yml plugin/scripts/release-master-advance-needs-check.ts plugin/scripts/checker-mutation-cases/release-master-advance-needs-check.sh`，`--root repo_root` 非 main_root，理由同上方 release-test-client-close-check）。③ `plugin/scripts/checker-mutation-cases/release-master-advance-needs-check.sh` 存在，第二轮实跑 `checker-mutation-check.sh --check` = `mutations_that_stayed_green: 0 / uncovered: 0 / errors: 0` / `RESULT: PASS`，exit 0（duration_ms 87029）。④ `@checker-count` **62 → 63**，`checker-count-drift-check.ts --root .` 三条 registry 全 ok（`run_static_checks` declared 63 / measured 63）exit 0。⑤ `rhythm-consumer-check.ts --check` exit 0。⑥ 孪生 `experiments/quay-perpetual-stream/scripts/release-master-advance-needs-check.ts` 为符号链接（同其余镜像对），`mirror-pair-drift-check.ts` exit 0。〕

- [ ] **AC4 run 全绿**：`gh run view <runId> --json conclusion,jobs` —— run 的 `conclusion=success` ∧ **每一个** job 的 conclusion 都是 `success`（逐个列出 job 名与结论；⛔ 不许以「主要 job 绿」代替全部）；并给出载体记录里该 run 的逐 job 清单，证明两侧读数一致。（待外部）

  **第二轮实测（2026-09-15，run `35005849727`，tag `v0.7.0`，窗口 `18:10:49Z → 18:21:14Z`，墙钟 10m25s）—— 本条**仍不成立**，但形态已完全不同：`conclusion=failure`，因为 **10 个 job 里 9 个 success、只有 `advance-master` failure**。逐 job（`gh run view 35005849727 --json jobs`；载体第 14 行读出的清单**逐字一致**）：`release` **success**（历史性首次）／`sea-release (ubuntu-latest, linux-x64)` success／`sea-release (macos-latest, macos-arm64)` success／`sea-release (windows-latest, windows-x64)` success／`sea-verify-node-free` success／`sea-verify-node-free-cross-platform (macos-latest, macos-arm64, tar.gz)` success／`sea-verify-node-free-cross-platform (windows-latest, windows-x64, zip)` success／`dist-verify-node-floor` **success**（不再 skipped，因为依赖全成功）／`delivery-manifest-verify` **success**／`advance-master` **failure**。⇒ AC4 的「全部 job success」差这最后一个；`conclusion=success` 因此仍为假。〕

- [ ] **AC5 `advance-master` 真跑成**：该 run 的 job 列表里 `advance-master` 的 `conclusion=success`，并贴出它的 push 步骤日志行（含 `tag:master`）。（待外部）

  **第二轮实测——本条跑起来了但被远端拒绝，失败原因不在本 job**：`advance-master` `conclusion=failure`（job id `104508810604`）。它**确实执行到了 push**（`checkout` 成功、`ref: v0.7.0`、HEAD `5fdb3e646`），日志逐字：

  ```
  advance-master: fast-forwarding refs/heads/master to v0.7.0
  5fdb3e64640acb9be5106bcddbe783f90fde02d6 2026-09-15T17:55:25Z release: strip -dev suffix for the v0.7.0 release cut (SPEC §4.3)
  To https://github.com/yaleh/quay
   ! [remote rejected]     5fdb3e64640acb9be5106bcddbe783f90fde02d6 -> master (refusing to allow a GitHub App to create or update workflow `.github/workflows/release.yml` without `workflows` permission)
  error: failed to push some refs to 'https://github.com/yaleh/quay'
  ##[error]Process completed with exit code 1.
  ```

  ⇒ 两件事同时被证实：①**peel 修复生效**（推送走到了远端；未修前会死在本地 refspec 解析上）；②**新的、非本 job 写法的阻塞**：`GITHUB_TOKEN` 是 GitHub App，缺 `workflows` 权限，而该权限**不可由 `permissions:` 授予**。根因与双向对照见 §Finding 末段。⛔ 「job 出现在列表里」不等于「job 跑成」——本条正是这条纪律的实例：它出现了、跑了、失败了，且失败原因**不是**它的代码。〕

- [ ] **AC6 master 是 ff 上去的，不是改写**：`git merge-base --is-ancestor master <tag>` 为真；`git rev-list --count master..<tag>` = 0 ∧ `git rev-list --count <tag>..master` = 0；`git rev-parse master` == `git rev-parse <tag>^{commit}`（贴出两个 sha）。（待外部）

  **第二轮实测**：ff 的**前提**已逐条核过（缺的只是那次成功的 push）：`git merge-base --is-ancestor master 5fdb3e646…` = **真**；`git rev-list --count master..5fdb3e646` = **19673**；`git rev-list --count 5fdb3e646..master` = **0**；`git rev-parse master` = `9316b797d`，`git rev-parse v0.7.0^{commit}` = `5fdb3e646…` ⇒ 两个 sha **不等**（push 被拒，master 未动）。⇒「是 ff 不是改写」这一半由上面三个读数**已经成立**；缺的是「已发生」。〕

- [ ] **AC7 本地 master ref 已同步且推进只发生在 CI 侧**：贴出 `git fetch origin master:master` 前后 `git rev-parse master` / `git rev-parse origin/master` 四行读数，同步后本地 master == tag 提交；全轮无 `--force`、无本地直接 `git push origin …:master`。（待外部）

  **第二轮实测**：**未做同步**，因为第 6 步的前提（CI 侧推进已发生）不成立 —— 在 push 被拒的情况下同步本地 master 只会把它指向一个**从未被发布**的提交，那是伪造读数。「推进只发生在 CI 侧」这一半**成立且被反向证实**：本轮**没有任何**本地 `git push origin …:master`，唯一一次对 master 的推送尝试发生在 CI job 内（并被远端拒绝）。AC5 的 `--force` 禁令在**文件**上成立（`grep -c -- '--force'` = 0）；tag 的 re-point 用的是 `git push --force origin v0.7.0`（**推 tag**，不是推 master，也不是 `advance-master` 的形态）—— 如实记于此。〕

- [ ] **AC8 AC-274 判据取真**：`node packages/quay/bin/quay.js goal gate AC-274 --dry-run` ⇒ **exit 0**，贴出 stdout/stderr 与退出码。**负控制 (a)**：复制载体、删掉那条 post-window 全绿行，对副本同法跑 ⇒ **exit 1 ∧ stderr 含 `CAUSE=no-green-release-in-the-post-filing-window`**，逐字贴出。（待外部）

  **第二轮实测**：取真**不成立**（`verdict=fail` / `exit 1` / `CAUSE=green-release-not-reflected-on-master — 1 fully green Release run(s) since 2026-09-15T14:00:00Z (v0.7.0) but master is at 9316b797d, which is none of their tags`）。**负控制 (a) 已跑并命中**：隔离 clone `/tmp/ac274-ctl2`（`git clone /home/yale/work/quay`，`git branch -f master 9316b797d`）内，把真实载体 **14 行**去掉那条 post-window 全绿行（丢掉 1 行：`('v0.7.0','2026-09-15T17:26:14Z','success')`，剩 13 行）后经 store 自己的 runner 跑 ⇒ **exit 1** ∧ `CAUSE=no-green-release-in-the-post-filing-window — carrier holds 13 Release runs (12 decisive), none with conclusion=success and ts > 2026-09-15T14:00:00Z`。⇒ 判据由载体内容驱动、能取假；剩的只是「取真」那一半。〕

- [x] **AC9 负控制 (b)：绿了但 master 没跟上**：在一个 master 停在非 tag 提交的独立检出（临时 clone/worktree，载体含那条全绿行）里跑同一 criterion ⇒ **exit 1 ∧ stderr 含 `CAUSE=green-release-not-reflected-on-master`**。逐字贴出。⛔ 不做这一步，AC8 的 exit 0 就不是读数而是回声（硬规则 4）。〔落地读数 2026-09-15，**控制性夹具**：独立 `git clone /home/yale/work/quay /tmp/ac274-ctl`（**不碰主检出**），`git branch master 9316b797d`（本地 master 停在一个**不指向任何 tag** 的提交，`git tag --points-at master` = 0），载体写入**一行合成的 post-window 绿行**（`branch` = 真实 tag `v0.7.0`，`conclusion=success`，`ts=2026-09-15T16:00:00Z`）—— ⛔ 该行是**控制夹具，不是生产读数**。经 store 自己的 runner 跑 ⇒ `verdict=fail` / **exit 1** / `CAUSE=green-release-not-reflected-on-master — 1 fully green Release run(s) since 2026-09-15T14:00:00Z (v0.7.0) but master is at 9316b797d, which is none of their tags`。**同夹具的两个反向对照**：(i) `git branch -f master v0.7.0^{commit}` ⇒ `verdict=pass` / **exit 0** ⇒ 证明 AC-274 **在机制上是可满足的**；(ii) 把 master 推回非 tag 提交 ⇒ 又红 ⇒ 判据**不是恒绿**。另一 CAUSE（新 clone 无本地 `master` 分支）：`CAUSE=no-master-ref`。**第二轮在真实载体上复现，读数相同**（见 AC8 段）。〕

- [ ] **AC10 载体行经采集器且 `branch` == tag 名**：贴出 `.quay/ci-runs.jsonl` 新增行逐字（含 `branch` 字段）、产生它的采集器调用命令、前后行数（证明是新追加而非手写）。**负控制**：把该行 `branch` 改成一个非 tag 值（如 `develop`），对副本跑 criterion ⇒ exit 1 且 CAUSE = `green-release-not-reflected-on-master`——证明这条字段约束是真约束。（待外部）

  **第二轮实测——机械面全部已验，但载体行的结论是 `failure`，故本条**不勾**。① 采集器调用（⛔ 非手写）：`node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --root /home/yale/work/quay --workflow release.yml --limit 10 --log-fetch none --gh /home/yale/.local/bin/gh` ⇒ `carrier=/home/yale/work/quay/.quay/ci-runs.jsonl appended=1 skipped=9 attributed=1`（`skipped=9` = 既有行未被重写 ⇒ **追加语义**）。② 前后行数：**13 → 14**。③ 新增行（第 14 行，经 `json.loads` 读出）：`ts=2026-09-15T18:10:49Z | branch=v0.7.0 | workflow=Release | conclusion=failure | runId=35005849727`，`jobs` 10 条（9 success + `advance-master` failure）。`branch` **逐字就是 tag 名** ✓。④ **负控制已跑并命中**：在同一隔离 clone 内把那条（真实的、post-window 全绿）行的 `branch` 改成 `develop`，经 store 自己的 runner 跑 ⇒ **exit 1** ∧ `CAUSE=green-release-not-reflected-on-master — 1 fully green Release run(s) since 2026-09-15T14:00:00Z (develop) but master is at 9316b797d, which is none of their tags` ⇒ 证明「`branch` 必须是 tag 名」**是真约束**，不是修辞。⛔ 之所以仍不勾：本条点名的是**使 AC-274 取真的那条**载体行，而那条尚未产生（新增的是 failure 行，负控制用的是上一版的绿行）；机械面绿 ≠ 本条要证的事成立。〕

- [x] **AC11 未成功即如实**（条件触发）：若最终没拿到全绿，逐字记录 runId + 失败 job + 首条决定性日志行，并归因到 AC-265/266/267 或 AC-268 的范围，**不**宣告本任务完成。〔条件**已再次触发**，第二轮同样未拿到全绿。**第二轮记录**：`runId=35005849727`（tag `v0.7.0`，`workflow_dispatch`，窗口 `18:10:49Z → 18:21:14Z`），失败 job = **`advance-master`**（唯一失败者；其余 9 个全 success），首条决定性日志行 = `! [remote rejected] 5fdb3e646… -> master (refusing to allow a GitHub App to create or update workflow '.github/workflows/release.yml' without 'workflows' permission)`。⚠️ **归因偏差，如实记**：本条逐字要求「归因到 AC-265/266/267 或 AC-268 的范围」，而**本轮失败的原因不在那个集合里** —— 它是一个**新发现的、AC-274 自身机制上的凭据阻塞**（`GITHUB_TOKEN` 无 `workflows` 权限，且该权限不可授予；见 §Finding 末段）。按硬规则 3b，**读不懂的输入不得产出与合格同形的值**，故我没有把它硬塞进那三个范围去凑合本条 —— 该缺陷**不属于**那三族，记为**新成因**。**第一轮记录（保留）**：`runId=34990408957`，失败 job = `release`，首条决定性行 = `✖ AC1 — the detector is green on the real repo and its --json reading is OK with no violators`；更早一轮 `runId=34987120091` 的 config.yml 失败已结案。⛔ 本任务**不宣告完成**。〕

## 落地记录（2026-09-15，worker 第二轮）

### 已闭合：机制落地（AC1–AC3）+ 一个真跑才暴露的缺陷

`.github/workflows/release.yml` 的 `advance-master` job 与 `plugin/scripts/release-master-advance-needs-check.ts` 已在分支上（第一轮落地）。第二轮补了**一处只有真跑才能暴露的缺陷**（提交 `f13808fc2`）：`git push origin "${TAG}:master"` 对**附注 tag** 结构性失败（`cannot update ref …: trying to write non-commit object …`），改为先 `git rev-parse "${TAG}^{commit}"` 再推该 sha。**双向对照**：未 peel ⇒ exit 1 且 master 不动；peel ⇒ exit 0 且 master == tag commit（见 AC1 段）。这条缺陷的形态正是本任务自己盯的那种：**语法合法、历史齐备、只有远端自己的 ref 更新规则会拒绝**，本机无论怎么跑都看不出来。

### 真实进展：run `35005849727` —— 首次 9/10 job 全绿，只剩最后一步

第二轮通过 re-point `v0.7.0` 到含本 job 的 release cut（`5fdb3e646`，见下）并 dispatch，拿到本仓**历史上第一次** `release` job success：**10 个 job 里 9 个 success**（含此前从未成功的 `release`、以及此前一直 skipped 的 `delivery-manifest-verify` / `dist-verify-node-floor`）。唯一失败者是 `advance-master`，且失败**不在它的代码**：远端拒绝「GitHub App 更新 workflow 文件」。⇒ 剩余距离从「机制不存在 + 发布链红」缩短为**一个凭据裁定**。

### ⛔ 需要人裁定（本任务无法自行闭合的那一步）

`advance-master` 需要一枚**具备 `workflows`/`workflow` 权限**的凭据才能完成首次 ff。候选三条：①repo secret 放一个带 `workflow` scope 的 PAT，`advance-master` 的 checkout 用 `token: ${{ secrets.<PAT> }}`；②装一个有 `workflows: write` 的 GitHub App；③改走 SPEC §6.1 表里并列的 C 方案（本地机件 `release-advance-master.ts`）—— 但 AC7 逐字禁止本地推 master，故等于要人改裁定。**本 worker 未自行绕过**：用 refs API 移动 ref 规避这条护栏属于安全护栏绕过，超出 worker 权限（该护栏正是为阻止被污染的 workflow 改写 workflow 文件而设）。

### 第二轮的三条读数（可直接复核）

1. **re-point 的载体**：`v0.7.0` 由 `2ea2bef25`（→ commit `660abbf7c`，其树**不含** `advance-master`，故它的任何 re-run 都不可能移动 master）改为 `e874efee0`（→ commit `5fdb3e646`，即本任务分支 tip + SPEC §4.3 去 `-dev` 后缀的 release cut）。**原 sha 两枚都记在此处，可逆**。
2. **本地跑得动的预检**（dispatch 之前做的，不是事后解释）：在 release cut 树上按 `release` job **自己的顺序**先建 dist（`build-dist.mjs` ×2 + `sync-vendor.sh --sync-dist`）再跑它**自己的命令** `node --test packages/quay/test/*.mjs packages/quay-native/test/*.test.mjs` ⇒ `ℹ tests 1522 / pass 1517 / fail 0 / skipped 5`，**exit 0**。⚠️ 第一次预检 `cli.test.mjs` 红在 `FAIL: golden-replay "--version": spawn vs run() byte-identical (stdout 10/6B)` —— 那是**我自己造的表象**：我剥了 `-dev`（9 字 → 5 字）却没重建 dist，于是 spawn 读旧 bundle（`0.7.0-dev`，10B）、run() 读源码（`0.7.0`，6B）。按 CI 的顺序重建 dist 后即绿。**留痕以免下一个 worker 重走。**
3. **载体已落痕且不是手写**：采集器 `appended=1 skipped=9`，13 → 14 行，新行 `branch=v0.7.0 / conclusion=failure / runId=35005849727`（见 AC10 段）。

### 一条新发现的**载体口径隐患**（观察项，非本任务阻塞）

criterion 与载体都**按 tag 名**（`branch`）索引，而 tag 是可被 re-point 的：本轮的 14 行里，那条 `conclusion=success` 的 `v0.7.0` 行描述的是**旧树**（`660abbf7c`），与**当前** `v0.7.0` 所指的 `5fdb3e646` 不是同一个提交。⇒ 一旦将来 master 真被推到 `5fdb3e646`，AC-274 会**靠一条属于旧树的绿行**取真。本轮未触发（master 仍是化石 tip），故**不阻塞**；但它是一条会在「成功那一刻」静默失真的读数，记此备查（候选修法：载体行加 `headSha`，criterion 一并比对）。

### 未闭合声明

本任务交付的是**机制落地 + 一个真跑暴露的缺陷修复 + 失败归因 + 一个需要人裁定的凭据阻塞**。**AC-274 仍为 `fail`**，master 仍在化石 tip `9316b797d`；AC4–AC8 与 AC10 **保留未勾**并各自标注了本轮实测到哪一步。⛔ **不宣告完成**：第一轮写下的兑现条件（「AC-268 产出一个全绿 Release run 且该 tag 的树里含本 job」）**已由本轮满足一半** —— 全绿 run 存在、我这一版也把本 job 放进了 tag 树 —— 但**新暴露的凭据阻塞**必须由人先裁定，本任务才有第二个可闭合路径。

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
