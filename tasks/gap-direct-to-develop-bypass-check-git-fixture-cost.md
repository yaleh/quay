---
id: gap-direct-to-develop-bypass-check-git-fixture-cost
title: direct-to-develop-bypass-check.test.mjs 真实 git spawn（init/commit/merge）主导
  74.2s 耗时——先分解再决定能不能共享 fixture
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**优先级 P1**：本任务是用户 2026-10-09 授权的一组性能改进里的第二项（driver-shared 定时器泄漏 P0 之后、cold-start 台账收口与跨项目资源准入协同之前）。

**实测（`.quay/verification-round.jsonl` round #2463，2026-10-09T01:41:44Z，生产台账直接读数）**：`plugin/test/direct-to-develop-bypass-check.test.mjs` 该轮耗时 **74181ms**，是当轮 Top15 耗时文件第 2 名。文件内大量测试通过 `spawnSync("git", [...])` 跑真实 git 操作（例如 `:100` 的 `git(...)` helper、`:969` 的真实 commit、`:1484` 的真实 merge），粗略统计该文件 spawnSync 调用点 ~68 处，暗示相当比例的测试各自从零建立 git 仓库。

**必须先读的教训（同类任务，done，不要重犯同一个错）**：`gap-slow-test-shared-fixture-and-group-recheck`（done）明确记录了"不能假设接 fixture = 变快"——它给 `quay-init-loop-runtime.test.mjs` 接了 sharedFixture 后发现仍然慢，分解后确认是因为很多测试是 **install-as-behavior**（被测的正是"从零状态开始的行为"本身，比如 fail-closed/auto-build/migration），结构上无法共享固定夹具；只有 **install-as-setup**（git/install 只是前置条件，不是被测对象）的测试才能安全切到共享 fixture。

本任务很可能面对同样的分叉：`direct-to-develop-bypass-check.test.mjs` 测的是"对各种 git 历史拓扑的分类判定"，很多测试可能需要**彼此不同**的 git 拓扑（不同的 merge/rebase/reflog 形态）才能覆盖不同分类分支——这些测试即使看起来都在"建一个 git 仓库"，也可能不能共享同一个固定夹具。但也可能存在一批测试共享同一个"基础拓扑"只是在末尾加一个不同的 commit/merge 变体，这部分才是真正可动的空间。**不预设哪一种占多数，必须先分解再动手**。

## AC

- [ ] 用断言汇聚点计时法（同 `gap-slow-test-shared-fixture-and-group-recheck` AC3 的手法，`QUAY_TEST_ASSERT_TIMING=1` 或该文件已有的等价计时方式；没有现成手法时可在文件里临时加 env-gated 的计时 console.error，不改变任何断言语义）分解该文件全部测试的耗时分布，列出每个耗时 ≥500ms 的测试名、耗时、它调用了几次 git/checker spawn，贴入任务体的 Measured 部分。
- [ ] 基于上一条的分解结果，逐个测试判断它是"behavior-under-test 本身要求从零 git 状态"（例如正测试的就是"刚 init 的仓库第一次提交如何被分类"）还是"仅把 git 仓库当前置条件、可以与同一 describe 块内其它测试共享同一个基础仓库再在末尾分叉"。只对后一类做共享基础仓库的改造（例如 `before()`/`beforeEach` 建一次基础仓库，各测试在其上 checkout/branch 出变体），不改变任何断言语义、不减少测试数量。对前一类保留原状，并在任务体写明具体是哪些测试、为什么不能共享（不能只写"保留原状"四个字，要点名测试和理由）。
- [ ] 隔离跑改动前后对照（同机、同一并发/环境条件）：`node --test plugin/test/direct-to-develop-bypass-check.test.mjs`，0 cancelled，全部既有断言通过，且任意测试执行顺序下重跑仍通过（证明共享状态不引入顺序依赖）。前后两次墙钟都贴进任务体，只写实测数字。
- [ ] 改动落地并经过真实 worktree/driver 执行后，从 `.quay/verification-round.jsonl` 取 ≥5 个新轮次核实该文件 durationMs 的实测前后差值（前基线已在 Finding 里给出：round #2463 实测 74181ms），写入任务体。若分解后发现可安全共享的测试子集为零（即全部是 behavior-under-test 必要成本），如实记录"无安全可动空间"这个结论本身也是合法交付，不得为了制造"有改进"而强行拆分出虚假收益。
- [ ] scoped 门：`bash scripts/test.sh --for-task gap-direct-to-develop-bypass-check-git-fixture-cost --allow-thin` exit 0。

## DoD

分解数据必须贴在任务体里（不是只停留在"看起来可以共享"这句话上）；若有改动，必须经过真实的任务 worktree 执行与 fan-in，并有落地之后的生产台账轮次读数印证；若无可动空间，必须写清楚具体卡在哪些测试、什么语义要求。不弱化任何既有断言的真实 git 语义（不允许用 mock/stub 的假 git 操作替换真实 spawnSync 来换速度，除非任务体里明确记录了确认过这不会削弱被测行为的证据）。测试数量不得减少。

## Touches

- plugin/test/direct-to-develop-bypass-check.test.mjs
- tasks/gap-direct-to-develop-bypass-check-git-fixture-cost.md