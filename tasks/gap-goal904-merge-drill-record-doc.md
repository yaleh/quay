---
id: gap-goal904-merge-drill-record-doc
title: GOAL-904 合并演练：新增托管文档 DOC-904（演练记录），必须经 goal/GOAL-904 分支落地
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-904
---
## Proposal

**这是 GOAL-904（goal 分支合并演练）的承载任务，内容刻意无害。**（正本：`orchestration/SPEC-goal-branch-2026-10-03.md` §4.7、§4.10；GOAL-028 的 AC-321…325/327/328 靠这次演练取真实读数。）

新增一份托管文档 `docs-managed/DOC-904-goal-branch-merge-drill-record.md`：frontmatter `id: DOC-904`、`title: goal 分支合并演练记录`、`status: draft`、`kind: drill`，正文用一小段话写明这是 GOAL-904 的演练产物（演练的目的、它只在 goal/GOAL-904 上、并入 develop 之前预览实例的 /doc 页能列出而生产列不出、并入之后可由人另行清理）。不改任何产品代码、不改测试。

这条任务**必须经 goal 分支落地**：它的 `goal_ac` 指向 AC-904，该 AC 属于 branch-mode 的 GOAL-904，派发时 mergeTarget 解析为 `goal/GOAL-904`。若它落到了 develop，说明派发接线有缺陷，不是演练成功——在 Evidence 里记下实际的 mergeTarget。

## AC

- [x] `node --experimental-strip-types -e 'import("./packages/quay/src/document-store.ts").then((m)=>{const d=m.createDocumentStore("docs-managed").get("DOC-904");if(!d||d.title!=="goal 分支合并演练记录"||d.status!=="draft"){console.error("DOC-904 unreadable or wrong frontmatter");process.exit(1)}console.log("ok",d.id)})'` 退出 0（文档能被托管文档存储读出，且 title 与 status 如上）。
- [x] `bash scripts/test.sh --static-checks-doc` 退出 0（文档类静态检查对这份新文档通过）。
- [x] `git diff --name-only develop...HEAD` 只列出 `docs-managed/DOC-904-goal-branch-merge-drill-record.md` 与 `tasks/gap-goal904-merge-drill-record-doc.md` 两个文件（演练不得夹带别的改动）。

## DoD

真实落地判据：本任务的翻 done 提交经 `goal/GOAL-904` 进入 goal 分支（不在 develop 上），预览实例的 /doc 页因此能列出 DOC-904。生产读数由 GOAL-028 的 AC-321/322/323（任务经 goal 分支落地、追平 develop、落地后不再被派发）在本任务落地后取得，AC-904 在预览实例上通过。

## Evidence

**派发时实际解析的 mergeTarget = `goal/GOAL-904`**（`reason: "goal-branch"`，`goalId: "GOAL-904"`）。读数来自 `plugin/scripts/worker-driver.ts` 导出的单一解析函数，在主检出上求值：`resolveTaskMergeTargetDetail("gap-goal904-merge-drill-record-doc", <main checkout>)` ⇒ `{"mergeTarget":"goal/GOAL-904","goalId":"GOAL-904","reason":"goal-branch"}`——证实本任务经 goal 分支落地，不是 develop，派发接线生效。

AC1：`node --experimental-strip-types -e '...createDocumentStore("docs-managed").get("DOC-904")...'` ⇒ `ok DOC-904`，exit 0（develop 并入后复跑，仍 exit 0）。
AC2：`bash scripts/test.sh --static-checks-doc` ⇒ exit 0。
AC3：**分支提交完成时**（doc 提交 + 本任务文件的勾选提交，尚未并入 develop）`git diff --name-only develop...HEAD` 恰列出 `docs-managed/DOC-904-goal-branch-merge-drill-record.md` 与 `tasks/gap-goal904-merge-drill-record-doc.md` 两个文件，无其它改动。

> ⚠️ AC3 的读数时点须说清（硬规则 4c：判据点名的量要穿过所有中间层还取得到）：worker 规程第 2b 步要求随后把 `develop` 并入 worktree。并入之后本任务文件与 develop 收敛（diff 变为仅 `docs-managed/DOC-904-goal-branch-merge-drill-record.md` 一个文件）——因为**任务文件（状态/勾选）的写面在 author→develop 基线上，不在 goal 分支的 delta 内**（CLAUDE.md「写面保留 author」、2026-08-31 人裁定）。故演练相对 develop 的净新增仅 DOC-904；「不得夹带别的改动」成立，两个文件的完整读数取在分支提交完成、尚未并入 develop 的那一刻。

### 阻断解除：AC-904 判据内联活宿主载体（develop-wide 静态红）的修复（2026-10-04）

上一轮 `exited-not-landed` 的真因**不在本任务 delta**，而是 **develop-wide 静态红**：`criterion-carrier-inline-check`（`goals/*.md` 的 criterion 文本不得点名活宿主载体文件）在 `goals/AC-904-*.md` 的 criterion 段命中该字面量 ⇒ 任何 **code-delta** 的 fan-in 全量 suite 在静态层 fail-closed abort（签名 `# tests 0 · # pass 0 · # fail 72 · # suite red static-check`；真因尾部 `STATIC_CHECK_FAILED: criterion-carrier-inline-check exit=1`）。

反例对照（硬规则 4 推论四）——该红与「本任务 delta」无关：
- 主检出（author==develop）上直跑 `node --no-warnings --experimental-strip-types plugin/scripts/criterion-carrier-inline-check.ts --root .` ⇒ exit 1，点名 `AC-904 (goals/AC-904-…md)`；
- `git cat-file -e develop:goals/AC-904-…md` 命中 ⇒ **在 develop 自身字节上就红**，不依赖本分支任何提交；
- `git rev-list --count develop..HEAD` 中本任务的净新增只有 `docs-managed/DOC-904-…md`（`docs-managed/` 不在 DOC_SURFACES，故被判 code ⇒ 触发全量 suite，进而撞上该静态红；其余任务若 code-delta 同样会撞）。

修法（**离分支**，经 goal ABI 的写面 author→develop，⛔ 不入本任务 delta，故 AC3 仍成立）：把 AC-904 的 criterion 从「内联读活宿主载体」改为**调用**单一定义点 `plugin/scripts/live-web-address.ts`（语义等价：仍取本 root 存活 serve 的 `host:port`，再 `curl /doc` 判 `DOC-904`；载体缺席/不可读/无 web ⇒ exit 3，web down ⇒ exit 1）。命令：`quay goal write AC-904 --criterion "<新判据>"`。落库提交 `1aec2bd8b goals: AC-904 field:criterion by cli:403681`，随 author→develop 同步进入 develop（`git rev-list --count develop..author` 归 0 后复核）。

复核读数：修复后 `criterion-carrier-inline-check --root .` ⇒ **exit 0**（`0 criterion(s) inline "server.json"`）；本任务 worktree 并入 develop 后同判 ⇒ exit 0。此红与派发接线（mergeTarget）无关，但曾使本演练的 fan-in 无法变绿。

本任务 worktree 本轮复核：`bash scripts/test.sh --for-task gap-goal904-merge-drill-record-doc --allow-thin` ⇒ exit 0；scoped-gate cache 以 develop sha `1aec2bd8b` 写入。

### 本轮复核（2026-10-04）：develop 全量 suite 的三簇常红（不在本任务 delta）

本轮 `bash scripts/test.sh --for-task gap-goal904-merge-drill-record-doc --allow-thin` ⇒ exit 0（selector 选 0 个测试文件，thin allowed）；scoped-gate cache 以 develop sha `5c4631db8` 写入。AC1/AC2/AC3 复跑均成立（AC3 现列出单文件 `docs-managed/DOC-904-…md`，为允许两文件的子集）。

但机械 fan-in 的全量 suite 在 **develop（`5c4631db8`）自身字节**上常红 **9 条**（+ `ready-pool-check-s22` 计时 flake 1 条），**三簇均与本任务 delta（一份 `docs-managed/` 文档）无关**，已在 worktree（内容 == develop）逐个复现：

1. `packages/quay/test/ac322-criterion-catchup.test.mjs` 5 红 —— AC-322 判据 2026-10-03T15:42Z（`d5c3df8d0`）改为祖先关系版后，`live_goals()` 要求 goal frontmatter 含 `activatedAt:`，夹具 `writeGoal()` 不写 ⇒ `live_goals()` 恒空 ⇒ `checked=0` ⇒ 恒 exit 3；同时该测试仍期待被删去的 `NOT-EVALUATED: no goal record carries branch: true yet`。
2. `plugin/test/worker-driver.test.mjs` 1 红（goal-merge e2e AC-327）—— 同源：`makeGoalMergeRepo()` 的 `goals/GOAL-901-*.md` 有 `branch: true` 无 `activatedAt:` ⇒ AC-327 exit 3（期待 0）。
3. `plugin/test/live-web-address.test.mjs` 3 红 —— AC-904 判据（2026-10-04T00:15Z，`1aec2bd8b`）调用 `plugin/scripts/live-web-address.ts`，被语料谓词 `criterion.includes("live-web-address.ts")` 收进「17 条」语料（实得 18）；且其语义在合成夹具 `enPage()` 上不可满足、拒绝词不匹配 mutant arm。

⇒ 三簇均需改**测试夹具/语料**（非本任务 delta；也非判据本身必错）。本任务受 AC3（delta 仅 DOC-904 + 任务文件）约束，不得夹带，故在 develop 修好这三簇前无法变绿。已单独立任务 `gap-goal-criterion-rewrite-stale-test-fixtures` 收口。⛔ 下一轮请勿重复实现本任务 delta——本任务实现早已完成（AC 全勾、scoped 门绿）。

### 收口（2026-10-04 本轮）：兄弟任务已落地，三簇红清零

上一轮点名的兄弟任务 `gap-goal-criterion-rewrite-stale-test-fixtures` 已按 fan-in 落地 develop（`0cec238b9`）。本 worktree 并入该 develop 后逐个复跑三簇夹具，**全绿**：`packages/quay/test/ac322-criterion-catchup.test.mjs` 6/6、`plugin/test/live-web-address.test.mjs` 17/17、`plugin/test/worker-driver.test.mjs` 118/118。

本任务 AC1/AC2/AC3 复跑均成立（AC1 ⇒ `ok DOC-904` exit 0；AC2 `scripts/test.sh --static-checks-doc` ⇒ exit 0；AC3 `git diff --name-only develop...HEAD` 列单文件 `docs-managed/DOC-904-…md`，为允许两文件的子集）。scoped 门 `scripts/test.sh --for-task gap-goal904-merge-drill-record-doc --allow-thin` ⇒ exit 0（selector 选 0 个测试文件，thin allowed）；scoped-gate cache 以 develop sha `0cec238b9` 写入（`git merge-base --is-ancestor 0cec238b9 HEAD` 为真）。⇒ 上一轮记录的三簇 develop-wide 常红已不再是本任务 fan-in 的阻断。

### 本轮复核（2026-10-04 第二次）：唯一红 = `build-dist-smoke` (b) 的 serve 绑定超时（load-shaped，非本任务 delta）

上一轮（run `wk-prod-anchor`，suite 日志 `.quay/fan-in-suite-gap-goal904-merge-drill-record-doc~wk-prod-anchor~1791047080806-636f1c.log`）机械 fan-in 的全量 suite：`# tests 10055 / # pass 10054 / # fail 1`，三簇旧红已清零；唯一红是 `packages/quay/test/build-dist-smoke.test.mjs:122` 的 `(b) serve --port + HTTP GET returns 200`（15138ms，100×150ms 轮询从未 bind，断言处得 `undefined !== 200`）。

**delta 相关性**：该文件不在本任务 Touches/diff（本任务 delta 仍仅 `docs-managed/DOC-904-…md` + 任务文件，`git diff --stat develop..HEAD` = 2 files / 20 insertions，**`packages/` 与 develop 逐字节相同**）；机检判 UNRELATED。

**复核动作与对照（硬规则 4 推论四）**——同一 worktree（内容==develop）内：
- 单独跑 `node --test packages/quay/test/build-dist-smoke.test.mjs` ⇒ **连跑 3 次全绿**，`(b)` 各约 320ms（对照：失败时为 15092ms）；整文件 1.7s（失败时 16.2s）。
- 与测试同参数（绝对 `nativeProviderDir` + `nativeBin=QUAY_NATIVE_CLI`）的独立复现脚本 spawn 该 bundle 的 `serve` ⇒ `quay serve: listening on http://0.0.0.0:<port>`、`GET /tasks → 200`。
- 该测试自身 `stdio: "ignore"`，无 serve 子进程 stderr 可读；一次早期的复现脚本因**误传相对 `nativeProviderDir`**（`providerDir=path.resolve(workspaceRoot, "./packages/quay-native/bin")` 指向工作区下不存在的目录 ⇒ `spawn node ENOENT`）而假红，改用测试同款绝对路径后即 200——这条弯路本身也是「cwd 不存在 ⇒ spawn ENOENT」的形态，⛔ 不是本红成因。

⇒ 该红**不可确定性复现**，判为 **load-shaped 计时 flake**：该文件 `@test-group product`＝主组（本轮 `__GROUP__ concurrency=127 files=842`），而其 15s 窗口的注释是按 `--test-concurrency=8` 标定的（Aug-25 `8d0920765` 把它从 `lowconc` 移入默认组）。与本任务 delta 无因果关系；受 AC3 约束不夹带修，留作独立观察项。

**本轮 scoped 门与缓存**：先 `git merge --no-edit develop`（并入 `21313a412` 等 3 个 develop 提交，无冲突，任务文件 `status: ready` 取 develop 值、3 条 AC 保持 `[x]`）；`bash scripts/test.sh --for-task gap-goal904-merge-drill-record-doc --allow-thin` ⇒ exit 0（selector 选 0 个测试文件，thin allowed）；scoped-gate cache 以 develop sha `21313a412` 写入。AC1 复跑 ⇒ `ok DOC-904` exit 0；AC3 `git diff --name-only develop...HEAD` 列两文件（doc + 任务文件），仍满足。


## Touches

- docs-managed/DOC-904-goal-branch-merge-drill-record.md
- tasks/gap-goal904-merge-drill-record-doc.md

## Needs-Human

**执行 2026-10-03T17:07:36.213Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: GET /tasks on the standalone-bundle server must return 200
- run_id：wk-prod-anchor
- session_id：f88c02cb-c64d-4929-9b0b-0011a5451a29
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-goal904-merge-drill-record-doc~wk-prod-anchor~1791047080806-636f1c.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-goal904-merge-drill-record-doc-wk-prod-anchor.log
