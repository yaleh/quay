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
$ gh auth status                                → Token scopes: 'gist','read:org','repo','workflow'
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

- [x] **AC1 前置读数**：贴出三条前置任务在 develop 上的 status 行（`git show develop:tasks/<id>.md | grep -m1 '^status:'`，三条各一行）；⛔ 任一不是 `done` ⇒ 停，不代做它们的实现。
  - 证据（2026-09-15，`git show develop:tasks/<id>.md | grep -m1 '^status:'`）：
    `gap-develop-ci-first-decisive-green: status: done`
    `gap-release-run-tests-hangs-on-shared-mcp-client-leak: status: done`
    `gap-sea-artifact-plugin-root-toplevel-eval: status: done`
  - 三条皆 `done` ⇒ 未触发停止分支。
- [x] **AC2 载体通道可用**：`ls -l plugin/scripts/ci-runs-collect.ts` 存在 ∧ `.quay/ci-runs.jsonl` 中存在 ≥1 条 `workflow` ∈ {`release.yml`,`Release`} 的记录；逐字贴出该行与它在真实载体文件里的行号（证明不是 fixture / 不是手写）。
  - 证据：`-rw-rw-r-- 1 yale yale 48998 Sep 15 15:08 plugin/scripts/ci-runs-collect.ts`（存在）。
  - ⚠️ **偏离立案前提，如实记**：立案时载体**不存在**（`ls .quay/ci-runs.jsonl` → No such file or directory），即 Requested action 1 的第三条前置当场不满足。根因不是「通道坏了」而是**生产采集没开**：`goalCiRunsCollect(root)` 在 `drivers.yml` 缺失时缺省返回 `false`（`goal-driver.ts:176-188`），故 goal-driver 每轮并不采集。本任务**没有跳过**这一点，而是用**采集器本身**（唯一写面）把它建起来并证明通道可用：
    `node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --root /home/yale/work/quay --workflow release.yml --limit 10 --log-fetch none --gh /home/yale/.local/bin/gh`
    → `carrier=/home/yale/work/quay/.quay/ci-runs.jsonl appended=10 skipped=0 attributed=6 logRunsFetched=0 testFilesDerived=0`
  - 载体第 1 行逐字（`grep -n '"workflow":"Release"' .quay/ci-runs.jsonl | head -1`）：
    `1:{"ts":"2026-09-14T12:48:42Z","branch":"v0.6.3","workflow":"Release","conclusion":"failure","runId":34845477762,"url":"https://github.com/yaleh/quay/actions/runs/34845477762","durationSec":1821,"jobs":[{"name":"release","conclusion":"cancelled","durationSec":…`
  - 行号 1 = 真实载体文件的第 1 行，内容为 gh 真实 run（v0.6.3，runId 34845477762），非 fixture、非手写。
- [x] **AC3 版本一致且 tag 名一致**：在 release tip 上跑 `node --experimental-strip-types scripts/version-consistency-check.ts` → 贴出 exit 码与它打印的 version，且 tag 名 = `v<该 version>`。**负控制**：把该脚本对一份被人为改坏一处的副本跑一次（或等价对照），证明它不是恒 OK。
  - 正控（release tip = `bb7289188cbdb74d1d2436989e7d2f4d5c4358ab`，即 develop tip）：
    `VERSION-CONSISTENCY: OK` / `All 10 files carry version 0.7.0` / `EXIT=0` ⇒ tag 名 = **`v0.7.0`**。
  - 负控（`--root` 指向 10 文件副本，把 `plugin/VERSION` 改成 `0.6.9`）：
    `VERSION-CONSISTENCY: DRIFT DETECTED` / `plugin/VERSION  0.6.9` / `2 different versions across 10 files` / `EXIT=1` ⇒ 该脚本不是恒 OK。
- [x] **AC4 tag 已落地**：`git ls-remote --tags origin | grep <tag>` 非空 ∧ `git rev-parse <tag>^{commit}` == 版本一致性检查所在的 commit；贴出两个 sha 与 `git cat-file -t <tag>`。
  - 证据：
    `2a26cdb0bb32ae259cfe658d9fb3b97990e36634	refs/tags/v0.7.0`（附注 tag 对象）
    `bb7289188cbdb74d1d2436989e7d2f4d5c4358ab	refs/tags/v0.7.0^{}`
    `git rev-parse v0.7.0^{commit}` = `bb7289188cbdb74d1d2436989e7d2f4d5c4358ab` == version-consistency 所在 commit ✓
    `git cat-file -t v0.7.0` = `tag`（与既有形一致）
- [x] **AC5 tag push 无隐式触发（负控制）**：push 前与 push 后各取一次 `gh run list --workflow=release.yml --json event,createdAt`，证明其中**没有**新增 `push` 事件的 run；贴出两份读数。
  - **push 前**：`total runs: 25` / `by event: Counter({'push': 25})`。
  - **push 后（+45s 等待）**：`AFTER total runs: 25` / `by event: Counter({'push': 25})` / `NEW runs since pre-push: 0` ⇒ 无新增 `push` 事件 run。
  - 事后复核（dispatch 之后）：`[.[]|select(.event=="push")]|length` = `25`，仍与 push 前相同。
  - 旁证（硬规则 5b：不止查被点名的那两个文件）：`.github/workflows/` 下仅 ci.yml / publish-plugin-dist.yml / release.yml 三个；`on:` 块分别为 `push: branches: [master, develop]`（tag push 不匹配 branch 过滤器）、`workflow_dispatch`、`workflow_dispatch` ⇒ 推 tag 在**任何一个** workflow 上都不产生 run。
- [x] **AC6 dispatch 可达**：存在 `event=workflow_dispatch` ∧ `headBranch=<tag>` 的 release run；贴出 `gh run list --workflow=release.yml --json databaseId,event,headBranch,conclusion,createdAt` 的原始行。若首试被拒，本条还须逐字贴出拒绝原文 ∧ 使默认分支可达的那个动作（`git rev-parse master` 前后 + `git rev-list --count master..develop` 前后）。
  - **首试即被接受**，故「被拒」分支未触发。逐字响应：`EXIT=0` / stdout `https://github.com/yaleh/quay/actions/runs/34987120091` / stderr 空。
  - 原始行：`[{"conclusion":"","createdAt":"2026-09-15T15:14:42Z","databaseId":34987120091,"event":"workflow_dispatch","headBranch":"v0.7.0"},{…v0.6.3 push failure…}]`
  - ⚠️ **立案前提已过期，如实记**：立案时 `defaultBranchRef` = `master`（落后 develop 19530 提交、release.yml 无 dispatch）。**当轮实测其为 `develop`**，而 origin 的 `develop`（`9dd8067566f8a22a9f699e29beee68f0ab0f9c56`）自带 `workflow_dispatch` ⇒ GitHub 的「默认分支须有该触发」这一条**当场即满足**，无需对 master 做任何动作。故本次**没有** `git rev-parse master` 前后读数可贴 —— 那个动作按 AC 的措辞只在「首试被拒」时才要求。
- [ ] **AC7 run 结论 = success**：`gh run view <runId> --json conclusion,jobs` —— run 的 `conclusion` 为 `success` ∧ **每一个** job 的 conclusion 都是 `success`（`release` + `sea-release` × linux-x64/macos-arm64/windows-x64），逐个列出 job 名与结论。⛔ 不许以「主要 job 绿」代替全部。
  - **未满足。** run `34987120091` 的 `conclusion` = **`failure`**，墙钟 15:14:42Z → 15:25:05Z（约 10.3 分钟，**不是** 30 分钟超时取消）。
  - 逐个 job：`sea-release (windows-latest, windows-x64)` success / `release` **failure** / `sea-release (ubuntu-latest, linux-x64)` success / `sea-release (macos-latest, macos-arm64)` success / `sea-verify-node-free-cross-platform (macos-latest, macos-arm64, tar.gz)` success / `sea-verify-node-free-cross-platform (windows-latest, windows-x64, zip)` success / `sea-verify-node-free` success / `dist-verify-node-floor` skipped / `delivery-manifest-verify` skipped。
  - 失败 job = `release`，失败 step = **`Run tests`**（第 5 步）；第 6「Build release artifact (npm pack)」与第 7「Upload artifact to GitHub Release」因之前失败而 skipped。
  - ✅ AC-266 的 hang 与 AC-267 的 SEA 两处**都已修复且在本次 run 上被证实**：`run tests` 不再 hang（10.3 分钟失败，非 30 分钟取消），三平台 `sea-release` + 三平台 `sea-verify-node-free*` 六个 job **全绿**，`seaVerify=success`。
- [ ] **AC8 经采集器落痕**：`.quay/ci-runs.jsonl` 中出现 `workflow` ∈ {`release.yml`,`Release`} ∧ `conclusion=success` ∧ `ts` 晚于当轮 `git log -1 --format=%cI -- .github/workflows/release.yml` 的记录；贴出该行逐字 + 产生它的采集器调用命令 + 前后行数（证明是新追加而非手写）。
  - **未满足**（要求 `conclusion=success`，本次为 `failure`）。但**采集器调用已做且是新追加**，如实记录：
    命令：`node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --root /home/yale/work/quay --workflow release.yml --limit 10 --log-fetch none --gh /home/yale/.local/bin/gh`
    前后行数：`10` → `11`；返回 `appended=1 skipped=9 attributed=1 logRunsFetched=0 testFilesDerived=0`（`skipped=9` = 既有 9 条未重写 ⇒ 追加语义，非重写）。
    第 11 行逐字（节选关键字段）：`ts= 2026-09-15T15:14:42Z | workflow= Release | conclusion= failure | runId= 34987120091 | seaVerify= success | attribution= real-defect`，jobs 同 AC7 清单。
    `ts`(2026-09-15T15:14:42Z) > `land`(2026-09-14T13:18:29+00:00) ✓ —— 窗口条件满足，但 `conclusion` 不是 `success`。
- [ ] **AC9 AC-268 判据取真**：逐字跑 `goals/AC-268-goal.md` 的 `criterion:` 块 → **exit 0**，贴出 stdout/stderr 与退出码。
  - **未满足。** 逐字跑（cwd = 生产根 `/home/yale/work/quay`，判据文本从 `goals/AC-268-goal.md` 提取，sha256 `2df0e9fc7d6ae6ad3576fcb1d6c7c1562637837b42abea3cee833fa7a7ba94ec`）：
    `CAUSE=release-still-failing — 1 release runs after 2026-09-14T13:18:29+00:00, none with conclusion=success (streak at filing: v0.4.0/v0.5.0/v0.6.0/v0.6.2/v0.6.3 all failed, last success v0.3.13 on 2026-07-24)`
    `EXIT=1`
  - 附带一条**发版前基线**（证明该判据此前确实为假、不是恒真）：同一判据在采集器写入前跑 → `CAUSE=no-release-run-after-change …` / `EXIT=1`。
  - 三点读数：`no-release-run-after-change`（前）→ `release-still-failing`（写入后）→ `no-release-run-after-change`（负控删记录）⇒ 判据由载体内容驱动，可双向取假。
- [x] **AC10 判据取假（负控制）**：复制载体、删掉该条 release 记录，对副本同法跑判据 → **exit 1 ∧ stderr 含 `CAUSE=no-release-run-after-change`**；逐字贴出。⛔ 不做这一步，「exit 0」就不是读数而是回声（硬规则 4）。
  - 证据（在**与生产同 `land` 的一次性 worktree** 里做，避免我自己的 release.yml 提交改变 `land` 而污染对照；控制 worktree 的 `git log -1 --format=%cI -- .github/workflows/release.yml` = `2026-09-14T13:18:29+00:00` == 生产值）：
    ① 载体**含** v0.7.0 记录：`CAUSE=release-still-failing — 1 release runs after 2026-09-14T13:18:29+00:00, none with conclusion=success …` / `EXIT=1`
    ② 删掉 v0.7.0 那条记录后（11 → 10 行）：`CAUSE=no-release-run-after-change — carrier holds no release run with ts > 2026-09-14T13:18:29+00:00 => the release channel has not been exercised since it became dispatch-only` / `EXIT=1`
  - 两次唯一差别就是那一条记录 ⇒ 判据确实由载体内容驱动、且能取到 AC 逐字要求的那个 CAUSE。
  - ⚠️ 本条**按其字面判据**已满足；但它是 AC9 的负控，而 AC9 未达成（run 未成功），故它**不能**被读作「AC9 的 exit 0 已被证明不是回声」（硬规则 4 的本意）。
- [x] **AC11 三平台产物面**：`gh release view <tag> --json assets` 列出 linux-x64 / macos-arm64 / windows-x64 三份产物，逐字贴出 asset 名与字节数。
  - 证据（`gh release view v0.7.0 --json tagName,assets`）：
    `v0.7.0`
    `quay-sea-0.7.0-linux-x64.tar.gz  73725871 bytes`
    `quay-sea-0.7.0-macos-arm64.tar.gz  64201100 bytes`
    `quay-sea-0.7.0-windows-x64.zip  58937350 bytes`
  - 三平台产物齐备。⚠️ **但 npm tgz（`quay-0.7.0.tgz`）不在其中** —— `release` job 在「Run tests」就失败，npm pack 与上传两步 skipped。故这是一次**不完整的 Release**，不可当可用发版消费。
- [ ] **AC12 未成功即如实**（条件触发）：若最终没有拿到 `conclusion=success`，逐字记录 runId + 失败 job + 首条决定性日志行，并归因到 AC-266/AC-267，**不**宣告本任务完成。
  - **触发条件成立（无 `conclusion=success`），但本条不勾**：本 AC 逐字要求「归因到 AC-266/AC-267」，而**实测的失败原因两者都不是**（见下节）。把它勾上等于宣称做了那个归因。**「记录 + 不宣告完成」这一半已按 DoD 执行**（见下节与 DoD 的未闭合声明）。
  - runId `34987120091` / 失败 job `release` / 失败 step `Run tests` / 首条决定性日志行：
    `✖ M63 D1: ts-typecheck gate PASSes against THIS repo's own real .quay/config.yml gates: wiring (1.391615ms)` → `AssertionError [ERR_ASSERTION]: real .quay/config.yml must exist in this worktree`
    同形共 **157** 条失败，主导消息：`Error: no .quay/config.yml found (searched from /home/runner/work/quay/quay/packages/quay/test upward) — point --root at a quay workspace root.`（9 处逐字）与 `##[error]Process completed with exit code 1.`

## Failure attribution (2026-09-15, run 34987120091) — 未闭合声明

**根因（直接观察，非推断）：`release.yml` 的 `release` job 在 fresh `actions/checkout@v4` 的
tagged tree 上跑测试时，没有 `.quay/config.yml`。** `.quay/config.yml` 是 gitignored
（DIR-050，per-workspace），而 quay 自身的「向上走找 `.quay/config.yml` 定位 repo root」
助手把缺失当致命 ⇒ 157 条测试同形失败。

**对照（硬规则 5b —— 修好一个 ≠ 只在那一处）：** `ci.yml` 早已有这一步
（`gap-config-yml-example-and-ci-bootstrap`：
`- name: Bootstrap .quay/config.yml` / `run: cp .quay/config.yml.example .quay/config.yml`），
而 `release` job 因为**刻意不委派 `scripts/test.sh`**（它自己的注释写明偏窄、只跑
`packages/quay` + `packages/quay-native`）是**第二个调用点**，那次修复漏了它。
⇒ `Run tests` 不再经 `scripts/test.sh`，因此也拿不到那个入口自带的 bootstrap。

**已落地的修复（在本任务 `## Touches` 声明的 `.github/workflows/release.yml` 内）：**
提交 `6d84ef0de`，在 `Install dependencies` 与 `Run tests` 之间补一步与 ci.yml 同形的
`Bootstrap .quay/config.yml`（+16 行，1 文件）。
**双向本地对照**：隐藏 `.quay/config.yml` ⇒
`packages/quay/test/ts-typecheck-gate-config-wiring.test.mjs` 以**同一条断言**
`real .quay/config.yml must exist in this worktree` exit 1（复现 CI 读数）；
`cp .quay/config.yml.example .quay/config.yml` ⇒ exit 0。
（还原原始 config 后未留痕。）

⚠️ **该修复不能使 v0.7.0 变绿**，也不改变本次 run 的结论：run 检出的是**已推送 tag 的树**
（`ref: ${{ inputs.tag }}`），提交无法回溯进它。修好的树要变绿必须**切一个新 tag**，
而 `v0.7.0` 已被占用 ⇒ 需要一次**版本号递增**（10 文件 lockstep + delivery-manifest +
package-lock），那是另一个任务的形状。

**第二处阻断（已定位、未修，会把「下一个 tag」继续打死）：**
`delivery-manifest.json` 的 `version` 停在 **`0.5.0`**，而
`scripts/delivery-manifest-check.ts:252` 的 `seaEntryHasPublishedAsset` 用它拼
`quay-sea-${version}-${plat}` 做**精确匹配** ⇒ 对 `quay-sea-0.7.0-*` 恒不命中。
本次 run 里该 job 因 `release` 先失败而 **skipped**，所以这是**尚未被真实 run 观察到**的一处
（不是本次失败的原因）。**两向本地对照**（对已完整发布的 `v0.3.13`）：
真实 manifest（0.5.0）⇒ `DELIVERY-MANIFEST-CHECK (--ci): FAIL` +「no matching published
assets found in GitHub Release 'v0.3.13'」/ `EXIT=1`；
把副本的 `version` 改成 `0.3.13` ⇒ `DELIVERY-MANIFEST-CHECK (--ci): OK` / `EXIT=0`。
⇒ 一旦 `release` job 修好并跑到第四个 job，本次失败会被这一处**接着**复现。
（历史旁证：`delivery-manifest.json` 的 version **曾**随发版递增 —— `23683877e` 0.3.11 →
`0750ff282` 0.3.12 → `1c4a383f5` 0.3.13 → `7c147b390` 0.4.0 → `08e8ec55f`「release: bump
version 0.4.0 → 0.5.0（8 文件 + plugin/VERSION + **delivery-manifest** + package-lock）」，
之后停更。它**不在** `version-consistency-check.ts` 的 10 文件名单里 ⇒ 漂移无检查可拦。）

⚠️ **第三个相互作用（本次自伤，必须记）：** AC-268 的窗口 `land` =
`git log -1 --format=%cI -- .github/workflows/release.yml` —— 即**最后一次改到
release.yml 的提交时刻**。我的修复提交落在 release.yml 上，**把 `land` 推到了
2026-09-15T15:27:05+00:00**（在一次性 worktree 里实测），使本次 run 的记录
（ts 15:14:42Z）**反而落在窗口之外**。在生产根 `land` 未变（我的提交还在任务分支上），
但**一旦 fan-in 到 develop**，AC-268 会退回 `no-release-run-after-change`。
⇒ 修好 release.yml 之后，**必须有一次 ts 晚于该修复落地的成功 run** —— 这与「修复必须先落、
再切新 tag」是同一条纪律，不是新问题；但它意味着修复本身会重置 AC-268 的窗口。

**未闭合声明（照 DoD 的诚实分界）：本任务未完成。**
`conclusion=success` 未取到，AC-268 判据在生产载体上仍 `EXIT=1`。本任务的交付物是
**失败归因 + 上述已落地的修复 + 未闭合声明**，不是「已完成」。

**建议的后续（一个任务，因为三件事必须同时成立才可能变绿）：**
① 修 `delivery-manifest.json` 的 version 漂移，并把它加进 `version-consistency-check.ts`
的 lockstep 名单（否则会再漂）；
② 递增版本号（10 文件 lockstep + delivery-manifest + package-lock）；
③ 用带 ① ② 的 develop tip 切新 tag → `gh workflow run release.yml --ref <新 tag> -f tag=<新 tag>`
→ 轮询 → 经采集器落痕 → 跑 AC-268 判据取真 + 负控。
（本任务已把 ①②之外的路面全部踩通：tag 推送零副作用、dispatch 首试即达、
`sea-release`/`sea-verify-node-free` 六 job 全绿、采集器可写、判据可双向取假。）

## Definition of Done

真实落地（DIR-026 Reading A）的形态**不是**「多了一个 tag」或「dispatch 命令执行过」，而是：**一次由 `workflow_dispatch` 触发的 release run 真的 `conclusion=success`，它的三平台产物真的挂在该版本的 GitHub Release 上，且这次 run 真的被采集器写进了 `.quay/ci-runs.jsonl` —— 于是 AC-268 的 criterion 在真实载体上 exit 0。** fixture / 注入数据 / 手写 JSONL 行一律不算。判据的两侧都要有读数：取真（AC9）与取假（AC10）各一次。

诚实分界：若 run 最终未成功，本任务的交付物是**失败归因 + 未闭合声明**，不是「已完成」。⛔ 本 AC 不带 long-term（发版是一次性动作，不是需要每轮复验的活性状态），故收口时**不**把它写成「每轮复验」形态。

## Touches

- tasks/gap-release-cut-via-workflow-dispatch.md
- .github/workflows/release.yml