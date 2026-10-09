---
id: gap-direct-to-develop-bypass-check-git-fixture-cost
title: direct-to-develop-bypass-check.test.mjs 真实 git spawn（init/commit/merge）主导
  74.2s 耗时——先分解再决定能不能共享 fixture
status: needs-human
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

**⚠️ 分解修正了 Finding 的前提（实测见 Measured）**：该文件 `spawnSync` 调用点实测只有 **6 处**（非 ~68——那是 `test(` 条数），且耗时**不是**"逐测试从零建 git 仓库"主导：全文件 68 条测试里只有 2 条 ≥500ms，其中一条（58-65s，占全文件 ~79%）`git=1 / checker=1`——它的成本全在**一次对真实仓库 20075-commit 历史的 checker 扫描内部**。全部"建基础仓库"的夹具构造只占全文件 ~1.5%。

## AC

- [x] 用断言汇聚点计时法（同 `gap-slow-test-shared-fixture-and-group-recheck` AC3 的手法，`QUAY_TEST_ASSERT_TIMING=1` 或该文件已有的等价计时方式；没有现成手法时可在文件里临时加 env-gated 的计时 console.error，不改变任何断言语义）分解该文件全部测试的耗时分布，列出每个耗时 ≥500ms 的测试名、耗时、它调用了几次 git/checker spawn，贴入任务体的 Measured 部分。
- [x] 基于上一条的分解结果，逐个测试判断它是"behavior-under-test 本身要求从零 git 状态"（例如正测试的就是"刚 init 的仓库第一次提交如何被分类"）还是"仅把 git 仓库当前置条件、可以与同一 describe 块内其它测试共享同一个基础仓库再在末尾分叉"。只对后一类做共享基础仓库的改造（例如 `before()`/`beforeEach` 建一次基础仓库，各测试在其上 checkout/branch 出变体），不改变任何断言语义、不减少测试数量。对前一类保留原状，并在任务体写明具体是哪些测试、为什么不能共享（不能只写"保留原状"四个字，要点名测试和理由）。
- [x] 隔离跑改动前后对照（同机、同一并发/环境条件）：`node --test plugin/test/direct-to-develop-bypass-check.test.mjs`，0 cancelled，全部既有断言通过，且任意测试执行顺序下重跑仍通过（证明共享状态不引入顺序依赖）。前后两次墙钟都贴进任务体，只写实测数字。
- [ ] 改动落地并经过真实 worktree/driver 执行后，从 `.quay/verification-round.jsonl` 取 ≥5 个新轮次核实该文件 durationMs 的实测前后差值（前基线已在 Finding 里给出：round #2463 实测 74181ms），写入任务体。若分解后发现可安全共享的测试子集为零（即全部是 behavior-under-test 必要成本），如实记录"无安全可动空间"这个结论本身也是合法交付，不得为了制造"有改进"而强行拆分出虚假收益。（待外部——落地后外层 verification-round 台账读数）
- [x] scoped 门：`bash scripts/test.sh --for-task gap-direct-to-develop-bypass-check-git-fixture-cost --allow-thin` exit 0。

## DoD

分解数据必须贴在任务体里（不是只停留在"看起来可以共享"这句话上）；若有改动，必须经过真实的任务 worktree 执行与 fan-in，并有落地之后的生产台账轮次读数印证；若无可动空间，必须写清楚具体卡在哪些测试、什么语义要求。不弱化任何既有断言的真实 git 语义（不允许用 mock/stub 的假 git 操作替换真实 spawnSync 来换速度，除非任务体里明确记录了确认过这不会削弱被测行为的证据）。测试数量不得减少。

## Measured

### AC1 — 分解（断言汇聚点计时，env-gated `QUAY_TEST_ASSERT_TIMING=1`）

手法：本文件新增 env-gated 计时（未设 env 时 `test` 就是 node:test 的 `test`，零断言语义改动；git/checker spawn 计数只在设了 env 时累加）。每个测试打印 `[cost] <ms> git=<n> checker=<n>`（n = 该测试真实起的 git / checker 子进程数）。隔离跑 `node --test plugin/test/direct-to-develop-bypass-check.test.mjs`（68 tests，0 cancelled），耗时 ≥500ms 的测试**只有 2 条**：

| 测试 | 耗时 | git spawn | checker spawn |
|---|---|---|---|
| `AC3 回放·CLI — 全量扫描（生产基线 b11ce720）NOT-EVALUATED：reflog 被 gc 剪 ⇒ 不伪装成「未发现 direct」` | 58423ms（另一轮 65306ms） | 1 | 1 |
| `NEGATIVE CONTROL on the REGISTERED argv: a code-surface direct commit to develop REDs; its absence is GREEN` | 4802ms | 209 | 3 |

其余 66 条全部 <500ms（次高 453ms；CLI 类每条 ~60-250ms，几乎全是 1 次 `runChecker`（`node --experimental-strip-types` 进程）的成本）。**结论：本文件不是"逐测试从零建 git 仓库"主导**——第一条占全文件 ~79%，`git=1 / checker=1`，其 58-65s 全在**一次 checker 调用内部**。

- `git rev-list --count b11ce720..develop` = **20075**；`node … --root <repo> --baseline b11ce720` 单独实测 **59.8s**（user 14.0s / **sys 46.5s**——系统时间主导 = checker 内部逐 commit 起子进程），exit 3、unclassifiableCommits=455、evaluated=false。
- `makeDevelopSpineRepo` 单独实测：101 commit 构建 **648ms**；其上单次 checker 跑 **1264ms**（该测试 3 次 ⇒ ~3.8s）。

### AC2 — 逐类判定与改造

**Class 2（git 只是前置条件，可安全共享）**：所有 `initRepo(dir)` 调用点（~19）与 `makeForkedDevelopRepo`（~5 测试）。它们的主体是「checker 对叠在一个**完全相同**的 2-commit 基础仓库之上的提交如何分类」，基础仓库本身从不是被测对象 ⇒ 改造：`initRepo`/`makeForkedDevelopRepo` 改为**每轮建一次基础仓库 + 每个测试 cpSync 一份私有副本**（`sharedBase`），断言语义与测试数量均不变。
- 隔离微基准（N=25 次调用）：逐次 fresh 建仓 **533ms**（每次 21.3ms）→ 一次建仓 + 25 次 cpSync **23ms**（每次 0.9ms）。

**Class 1（保留原状，behavior-under-test 要求真实/特定 git 形态）**——点名与理由：
- `AC3 回放·CLI — 全量扫描（生产基线 b11ce720）`：被测的正是「对**真实 20075-commit 生产区间**、reflog 被 gc 后判 NOT-EVALUATED」；真实历史不可替换（换小范围即弱化被测量本身），`b11ce720` 是该测试钉住的基线，改动即改语义。
- `NEGATIVE CONTROL on the REGISTERED argv`：依赖 `makeDevelopSpineRepo` 的 **101 commit** 深度，因为注册 argv 的 `--baseline develop~100` 窗必须解析得出——夹具深度是行为要求，不是前置。
- `buildOffSpineLandingFixture` 系（`AC3 回归 — 离脊落地 tip` / `AC4 负控制①` / `AC5 负控制②`）：被测对象就是 merge/离脊 reflog **拓扑**本身，每个测试需要不同拓扑 ⇒ 拓扑是行为不是前置（其 `initRepo` 基础已随 Class 2 共享）。
- 4 条真样本 `--commits` 回放：读的是 REPO_ROOT 真实历史。

### AC3 — 前后对照（同机、隔离）

`node --test plugin/test/direct-to-develop-bypass-check.test.mjs`，68/68 pass、0 fail、0 cancelled：
- 改动前（`git checkout -- <file>` 还原原文件）：**59498ms**（另一次带 spec reporter 的基线 **82174ms**）。
- 改动后（本改动）：**58090ms**（带计时另一轮 **69304ms**）。

**如实说明**：文件级墙钟被那唯一一条 58-65s 的真实仓库扫描主导，同一原文件两次跑就相差 **22.7s**（59498 vs 82174）——本改动的 ~0.5s 远在文件噪声之下，**文件级前后差不可归因**；可归因的量在隔离微基准里（见 AC2：25 次调用 533ms→23ms）。

**顺序无关**：共享基础仓库每轮只建一次、此后只被**读**（cpSync 源），每个测试的写只落在自己的私有副本上 ⇒ 无跨测试共享状态。实证：3 条代表性共享基础仓库测试（`CLI — 直接提交 develop 触及代码面` / `AC6 CLI — rewind` / `AC3 回归 — 离脊落地 tip`）各自 `--test-name-pattern` 单独跑（作为「第一个」）均通过，且在整文件跑中（非第一个）也通过；整文件两次跑均 68/68、0 cancelled。（本机 Node v24.21.0 无 `--test-shuffle`，故「任意顺序」以「单独跑 vs 整文件跑」两种相对位置取证。）

### AC4 — 待外部

改动落地（fan-in ff 到 develop）后，从 `.quay/verification-round.jsonl` 取 ≥5 个新轮次核实 durationMs 前后差值——本 worker 在落地前无法产生「新轮次」，留待外层落地后读取。鉴于 AC1 已证明文件级墙钟被真实仓库扫描主导，预期新轮次读数同样落在噪声内；可归因的节省见 AC2 微基准。

### AC5

`bash scripts/test.sh --for-task gap-direct-to-develop-bypass-check-git-fixture-cost --allow-thin` → **exit 0**，68/68 pass、0 fail、0 cancelled。

## Touches

- plugin/test/direct-to-develop-bypass-check.test.mjs
- tasks/gap-direct-to-develop-bypass-check-git-fixture-cost.md
## Needs-Human

**执行 2026-10-09T02:48:07.020Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 5 failing lines and attributed none to a file; pseudo-stage tokens: __PERFILE__, lint; unrecognized tokens: ...); stopping instead of spending another worker session
- 失败步/判词：step=suite: __PERFILE__ duration_ms=3801 /data/home/yale/work/quay-worktrees/gap-direct-to-develop-bypass-check-git-fixture-cost/plugin/test/shipped-entry-runnable.test.mjs passed=false end_ms=1791513967958 cpu_ms=2957.363 mem_peak_kb=54376
- run_id：wk-prod-anchor
- session_id：42de3790-9bbf-4fcc-8b58-d49786c9dedb
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-direct-to-develop-bypass-check-git-fixture-cost~wk-prod-anchor~1791513719476-da22b0.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-direct-to-develop-bypass-check-git-fixture-cost-wk-prod-anchor.log
