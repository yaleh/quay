---
id: gap-release-cut-via-workflow-dispatch
title: release 渠道经 workflow_dispatch 真发一个版本：切 post-fix tag v0.7.0 → dispatch →
  采集器落痕（AC-268）
status: ready
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-develop-ci-first-decisive-green
  - gap-release-run-tests-hangs-on-shared-mcp-client-leak
  - gap-sea-artifact-plugin-root-toplevel-eval
goal_ac: AC-268
---
**type:** execution

## Finding

**缺口｜AC-268 今天结构上不可达成：判据要一个「post-release.yml-落地且 conclusion=success 的 release run」，而该 run 既从未被触发过，它唯一可能的触发路径（workflow_dispatch）也从未被验证可达。**

2026-09-15 立案实测（主检出，全部为直接量）：

```
$ ls .quay/ci-runs.jsonl                        → No such file or directory
$ ls plugin/scripts/ci-runs-collect.ts          → No such file or directory
$ gh run list --workflow=release.yml --limit 30 --json event | grep -c workflow_dispatch
0                                               ← 全仓历史上没有任何一次 workflow_dispatch run
$ gh run list --workflow=release.yml --limit 8 --json conclusion,createdAt,headBranch
v0.6.3 failure 2026-09-14T12:48:42Z / v0.6.2 failure 2026-09-14T12:22:03Z /
v0.6.1 cancelled 2026-08-21 / v0.6.0 failure / v0.5.0 failure / v0.4.0 failure /
v0.3.13 success 2026-07-24T05:20:49Z            ← 最后一次成功，之后连续 6 版失败
$ git log -1 --format=%cI -- .github/workflows/release.yml
2026-09-14T13:18:29+00:00                       (d097f48c7)
$ gh repo view --json defaultBranchRef -q .defaultBranchRef.name   → master
$ git rev-list --count master..develop                             → 19530
$ git show master:.github/workflows/release.yml | grep -c workflow_dispatch
0                                               ← 默认分支的 release.yml 仍是旧 push-tags 触发
$ env -i HOME=$HOME PATH=/usr/bin:/bin bash -c 'command -v gh'     → （空）
                                                gh 实为 /home/yale/.local/bin/gh
$ gh auth status                                 → Token scopes: 'gist','read:org','repo','workflow'
```

三条结论，各自对应本任务的一个动作：

1. **必须切新 tag，不可能用既有 tag。** `release.yml` 的 checkout 是 `ref: ${{ inputs.tag }}` —— 一次 run 检出的是**被点名那个 tag 的树**，不是 dispatch 时刻的 develop。v0.6.3 的树不含 AC-266/AC-267 的修复，重跑只会逐字复现那两个失败（`release` job 撞 30m 超时 + `sea-verify-node-free` 三平台崩于 `fileURLToPath`）。⇒ 修复先落 develop，再在 post-fix tip 上切一个新 tag。

2. **触发可达性是一个必须当场读出来的量，不是一个可以假定的量。** 全仓 0 次 dispatch run；默认分支 `master` 落后 develop 19530 个提交，其 `.github/workflows/release.yml` 仍是 `on: push: tags: v*` 的旧版，**不含** `workflow_dispatch`。GitHub 按**默认分支**判定一个 workflow 能否被 dispatch ⇒「`gh workflow run release.yml --ref <tag>` 会不会被接受」在写这个任务时**未知**，任务体里因此把「读出它」写成一步，并为被拒的形态准备好最小修法与读数。

3. **版本已在树上但无 tag。** `packages/quay/package.json` = `0.7.0`（`713565ff7` 落地）；`scripts/version-consistency-check.ts` 是 10 文件 lockstep 的单一正本，2026-09-15 当轮实跑 `VERSION-CONSISTENCY: OK / All 10 files carry version 0.7.0`（exit 0）；本地与 origin 的 tag 都停在 `v0.6.3`。既有 tag 是**附注 tag**（`git cat-file -t v0.6.3` → `tag`）并带一条 release note。

⚠️ 本任务**不重新诊断**那两个 release 失败：`Run tests` 因子进程泄漏退化成 hang 属 AC-266，SEA bundle 里 `plugin-root.ts` 顶层求值 `import.meta.url` 属 AC-267。两者各有归属任务（已写进本任务的 depends_on），本任务只消费它们的结果。

⛔ 本任务**也不生产载体记录的语义**：`.quay/ci-runs.jsonl` 与其采集器 `plugin/scripts/ci-runs-collect.ts` 归 AC-265；release 记录上的 `timedOut`/`seaVerify` 字段归 AC-266/AC-267。本任务只负责**让那次 run 真实发生**并**经由采集器**把它落进载体 —— 手写一行 JSONL 去满足判据，是被两个兄弟任务逐字禁止的伪造形态（硬规则 4 推论三：只能被注入数据满足的判据不是测量）。

<!-- dedup-ref -->
同族先例（均已 done，机制不同，故不是重复）：gap-release-v061-after-134-commits 与 gap-ac108-push-tag-release-v060 走的是 **push tag 隐式触发**下的发版；本任务的机制是 **dispatch-only 之后经 workflow_dispatch 显式触发**，且要求随附一次 conclusion=success 的机械读数（前者只要求 tag/release note 与提交一致）。另：gap-release-v061-readme-changelog-drift 记录的是发版后的文档漂移，与本案无关。

## Requested action

1. **前置读数（先做；任一不满足就停并报告，不代做兄弟任务的实现，不手写载体）**：三条前置任务在 develop 上 `status: done`；`plugin/scripts/ci-runs-collect.ts` 存在；`.quay/ci-runs.jsonl` 存在且已含 ≥1 条 release 系记录 —— 最后一条是「这条记录通道真的能承载 release run」的直接证据，缺它则本任务无论如何都会撞 `CAUSE=carrier-absent`。
2. **定 release tip 与 tag 名**：取 develop tip，在该 commit 上跑 `node --experimental-strip-types scripts/version-consistency-check.ts`，要求 exit 0，读出版本号（当轮预期 `0.7.0`）；tag 名 = `v<该版本号>`。先确认该 tag 本地与 origin 都不存在（`git tag -l`、`git ls-remote --tags origin`）。
3. **确认 tag push 没有隐式副作用**：读被推的那棵树里的 `.github/workflows/release.yml` 与 `.github/workflows/publish-plugin-dist.yml` 的 `on:` 块，确认已无 `push: tags:` 触发（gap-github-actions-no-implicit-triggers，落地于 d097f48c7 = 2026-09-14T13:18:29Z）。推完 tag 后再核一次：没有新增 `push` 事件的 run。
4. **切 tag 并推送**：附注 tag（与既有形一致，`git cat-file -t v0.6.3` → `tag`），message 写一行 release note。
5. **探触发可达性 —— 用 dispatch 本身探（被拒是零副作用的）**：`gh workflow run release.yml --ref <tag> -f tag=<tag>`（gh 不在默认 PATH，用绝对路径 `/home/yale/.local/bin/gh`），逐字记下响应。
   - 被接受 ⇒ 直接进第 6 步。
   - 被拒（预期文本含 `does not have 'workflow_dispatch' trigger`）⇒ 根因是**默认分支**不带该触发。取**最小**修法把带 dispatch 的 `release.yml` 落到默认分支（把 master 快进到 release tip / 定向落一份该文件 / 等价的最小动作），**记录动作前后 `git rev-parse master` 与 `git rev-list --count master..develop`**，然后重试 dispatch。
   - ⛔ 不新造第三个 workflow 文件绕过；⛔ 不静默重写默认分支（动作与前后读数都进证据）。
6. **等结论**（轮询，不是 sleep 一次）：记 `runId`、`gh run view <id> --json jobs` 里**每个** job 的名字与 conclusion、墙钟耗时、最终 `conclusion`。若失败：记下失败 job 与首条决定性日志行，归因到 AC-266 或 AC-267 的范围，**不声称本任务完成**。
7. **经采集器落痕**：用 `plugin/scripts/ci-runs-collect.ts` 的既有调用方式把该 run 写进 `.quay/ci-runs.jsonl`（`workflow=release.yml`、`conclusion=success`、`ts` 晚于当轮的 `git log -1 --format=%cI -- .github/workflows/release.yml`）。⛔ 不手写 JSONL 行。
8. **双向验收**：逐字跑 `goals/AC-268-goal.md` 的 `criterion:` 块，要求 exit 0；再做负控制（载体副本删掉该记录后同法跑，期望 exit 1 且 stderr 含 `CAUSE=no-release-run-after-change`）。

## Acceptance Criteria

- [ ] **AC1 前置读数**：贴出三条前置任务在 develop 上的 status 行（`git show develop:tasks/<id>.md | grep -m1 '^status:'`，三条各一行）；⛔ 任一不是 `done` ⇒ 停，不代做它们的实现。
- [ ] **AC2 载体通道可用**：`ls -l plugin/scripts/ci-runs-collect.ts` 存在 ∧ `.quay/ci-runs.jsonl` 中存在 ≥1 条 `workflow` ∈ {`release.yml`,`Release`} 的记录；逐字贴出该行与它在真实载体文件里的行号（证明不是 fixture / 不是手写）。
- [ ] **AC3 版本一致且 tag 名一致**：在 release tip 上跑 `node --experimental-strip-types scripts/version-consistency-check.ts` → 贴出 exit 码与它打印的 version，且 tag 名 = `v<该 version>`。**负控制**：把该脚本对一份被人为改坏一处的副本跑一次（或等价对照），证明它不是恒 OK。
- [ ] **AC4 tag 已落地**：`git ls-remote --tags origin | grep <tag>` 非空 ∧ `git rev-parse <tag>^{commit}` == 版本一致性检查所在的 commit；贴出两个 sha 与 `git cat-file -t <tag>`。
- [ ] **AC5 tag push 无隐式触发（负控制）**：push 前与 push 后各取一次 `gh run list --workflow=release.yml --json event,createdAt`，证明其中**没有**新增 `push` 事件的 run；贴出两份读数。
- [ ] **AC6 dispatch 可达**：存在 `event=workflow_dispatch` ∧ `headBranch=<tag>` 的 release run；贴出 `gh run list --workflow=release.yml --json databaseId,event,headBranch,conclusion,createdAt` 的原始行。若首试被拒，本条还须逐字贴出拒绝原文 ∧ 使默认分支可达的那个动作（`git rev-parse master` 前后 + `git rev-list --count master..develop` 前后）。
- [ ] **AC7 run 结论 = success**：`gh run view <runId> --json conclusion,jobs` —— run 的 `conclusion` 为 `success` ∧ **每一个** job 的 conclusion 都是 `success`（`release` + `sea-release` × linux-x64/macos-arm64/windows-x64），逐个列出 job 名与结论。⛔ 不许以「主要 job 绿」代替全部。
- [ ] **AC8 经采集器落痕**：`.quay/ci-runs.jsonl` 中出现 `workflow` ∈ {`release.yml`,`Release`} ∧ `conclusion=success` ∧ `ts` 晚于当轮 `git log -1 --format=%cI -- .github/workflows/release.yml` 的记录；贴出该行逐字 + 产生它的采集器调用命令 + 前后行数（证明是新追加而非手写）。
- [ ] **AC9 AC-268 判据取真**：逐字跑 `goals/AC-268-goal.md` 的 `criterion:` 块 → **exit 0**，贴出 stdout/stderr 与退出码。
- [ ] **AC10 判据取假（负控制）**：复制载体、删掉该条 release 记录，对副本同法跑判据 → **exit 1 ∧ stderr 含 `CAUSE=no-release-run-after-change`**；逐字贴出。⛔ 不做这一步，「exit 0」就不是读数而是回声（硬规则 4）。
- [ ] **AC11 三平台产物面**：`gh release view <tag> --json assets` 列出 linux-x64 / macos-arm64 / windows-x64 三份产物，逐字贴出 asset 名与字节数。
- [ ] **AC12 未成功即如实**（条件触发）：若最终没有拿到 `conclusion=success`，逐字记录 runId + 失败 job + 首条决定性日志行，并归因到 AC-266/AC-267，**不**宣告本任务完成。

## Definition of Done

真实落地（DIR-026 Reading A）的形态**不是**「多了一个 tag」或「dispatch 命令执行过」，而是：**一次由 `workflow_dispatch` 触发的 release run 真的 `conclusion=success`，它的三平台产物真的挂在该版本的 GitHub Release 上，且这次 run 真的被采集器写进了 `.quay/ci-runs.jsonl` —— 于是 AC-268 的 criterion 在真实载体上 exit 0。** fixture / 注入数据 / 手写 JSONL 行一律不算。判据的两侧都要有读数：取真（AC9）与取假（AC10）各一次。

诚实分界：若 run 最终未成功，本任务的交付物是**失败归因 + 未闭合声明**，不是「已完成」。⛔ 本 AC 不带 long-term（发版是一次性动作，不是需要每轮复验的活性状态），故收口时**不**把它写成「每轮复验」形态。

## Touches

- tasks/gap-release-cut-via-workflow-dispatch.md
- .github/workflows/release.yml