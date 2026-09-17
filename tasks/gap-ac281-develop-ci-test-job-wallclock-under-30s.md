---
id: gap-ac281-develop-ci-test-job-wallclock-under-30s
title: 真实 develop CI test job 一次 success 且套件 schedulerMs≤30s（AC-281）——人
  2026-09-17 裁定改口径（原 job 墙钟 ≤30s 经实测不可达）；现 scheduler 54.1s / main floor
  43.0s，须压低最长单文件
status: ready
needs_human_cause: unclassified
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-suite-split-15-over-30s-test-files
  - gap-checker-mutation-parallel-case-loop
  - gap-ac282-runner-prereqs-already-present
goal_ac: AC-281
---
**type:** execution

> **2026-09-17 重定范围（人裁定后由 manager 改写，本轮）**：判据已被改写为只量**套件自身的 scheduler**，
> 本任务的对象随之改变。上一轮（worker，未完成）的完整取证与判死结论保留在
> `.quay/ac281-floor-evidence.md`（job 墙钟分解 / LPT 并发模拟 / 5 条对照）与 `.quay/ac281-evidence.md`，
> ⛔ 不要再重跑那两条路线——它们已得出结论且结论未变，只是**判据口径不再是它们量的那个量**。

## Proposal

**缺口（现判据口径）**：`goals/AC-281-*.md` 读本地载体 `.quay/ci-runs.jsonl` 里 `workflow=="CI"`
∧ `branch=="develop"` ∧ `ts > 2026-09-17T00:36:33Z`（SINCE = 立案时刻）的记录，取**最新一条**的
`jobs[]` 中 `name=="test"` 那条，要求 `conclusion=="success"` ∧ **`schedulerMs <= 30000`**。逐字重跑

```
node --experimental-strip-types packages/quay/src/goal-store.ts gate AC-281
```

### ⚠️ 判据已被人改写——本任务体的旧口径（job 总墙钟 `durationSec ≤ 30`）已作废

上一轮 worker 用真实 CI 数据证明原判据**结构上不可达**：`job = pre(≥16s) + suite(≥53.5s) +
runner 收尾(≥10s) ≥ 79.5s`，与 30s 目标差 2.6 倍；而其中 ≥27s 与套件无关（checkout / npm install /
coverage self-check / runner teardown），这与 `GOAL-022` 自己写的非目标「不追求"绝对30秒"是数学精确值」
直接矛盾。

⇒ **人 2026-09-17 裁定改判据**：只量**套件自身的调度器墙钟** `jobs[].schedulerMs`（派生自 job 日志里的
`__OVERHEAD__ scheduler_ms=` 行），不含固定 job 开销。字段由 `plugin/scripts/ci-runs-collect.ts` 派生
（依赖任务 `gap-ac281-scheduler-ms-carrier-field`，**已 done**）。字段未派生前判据诚实报
`CAUSE=scheduler-ms-not-recorded`（NOT-EVALUATED ≠ 通过）。

⇒ **本任务的对象 = 把套件的 scheduler 墙钟从 ~54s 压到 ≤30s。** 不是"压非测试相位"，是**套件成本削减**。

### 立案后实测（直接量，⛔ 非估算）

| 来源 | 读数 |
|---|---|
| `gate AC-281`（主检出 `/home/yale/work/quay`） | `fail`，`CAUSE=latest-run-not-green`（最新 post-filing develop run 35284521306 = failure） |
| 绿跑 35282567069 | `schedulerMs=54151` |
| 绿跑 35283904638（2026-09-17T22:49Z） | `schedulerMs=54149` |

### 套件相位分解（run 35283904638 日志自身的 `__OVERHEAD__` / `__GROUP__` 行）

```
build_dist_ms=194   run_static_checks_ms=3192   resource_gate_ms=60
main_phase_ms=51736  serial_phase_ms=19260  lowconc_phase_ms=18800
scheduler_ms=54149   lock_hold_ms=58151   lock_wait_ms=0
__GROUP__ concurrency=128 files=743 sum_ms=1605796 floor_ms=42963
```

- `scheduler_ms ≈ run_static_checks_ms(≈3.2s) + max(main, serial, lowconc)`；
- main 相位的 **floor（最长单文件）= 42.96s**，**单独一项就超过 30s 目标**；
- **抬并发无用**：`sum_ms=1605796` 在 128 并发下理想 makespan 仅 12.5s，实测 main 51.7s 全被
  单文件地板 + 调度余量吃掉（LPT 模拟并发 64/128/256/512 的 makespan 恒 = 最长单文件，见
  `.quay/ac281-floor-evidence.md` §1）。

⇒ **唯一杠杆是压低【最长单文件】**。

### 当前 CI 逐文件长杆（同一 run 的 `__PERFILE__` 行**全量**解析，⛔ 非抽样）

| 耗时 | 文件 |
|---|---|
| **43.0s** | `plugin/test/driver-anchor.test.mjs` |
| **41.6s** | `plugin/test/fan-in-execute-paths-s07.test.mjs` |
| 28.9s | `plugin/test/inner-wakeup-heartbeat.test.mjs` |
| 28.2s | `plugin/test/supervisor-deliver.test.mjs` |
| 27.5s | `plugin/test/cap-from-gate-bands.test.mjs` |
| 27.3s | `plugin/test/inner-wakeup-heartbeat-check.test.mjs` |
| 24.3s | `plugin/test/cap-from-gate-config-budget.test.mjs` |
| 24.3s | `plugin/test/cap-from-gate-stale.test.mjs` |
| 24.3s | `plugin/test/cap-from-gate-hysteresis.test.mjs` |

`__PERFILE__ duration_ms > 15000` 的共 **18** 个文件。

⇒ **达标条件**：main 相位 floor + 调度余量必须 ≤ `30000 − 3200 ≈ 26.8s` ⇒
**必须让没有任何单文件超过 ~25s**。⚠️ **只拆前两名不够**——28–29s 那一簇会立刻顶上成为新地板，
18 个 >15s 的文件里任何漏网的都会重新钉住 makespan。

### ⛔ 不许用「跑得更少」换 30 秒

读数变小最容易的假法是让套件少跑；判据本身只读 success + 秒数，**抓不到**这件事。本任务自带一条
可取的对照量：同一 run 在载体里的 `testFiles`（由日志 `__GROUP__ … files=N` 派生，⛔ 不是 run 元数据里
可伪造的字段）。立案读数 **650**（run 35167517872）；run 35283904638 的 main 相位 `files=743`。
⇒ 收口 run 的 `testFiles` **不得低于 650**；若因合法合并而下降，必须给出被合并/移走文件的完整映射与
理由（⛔ 不是沉默通过）。

### ⚠️ 判据读的是【最新一条】post-filing develop run —— 收口顺序的硬约束

criterion 按 `ts` 排序后取 `rows[-1]`，所以：

1. 一次达标的绿跑**随时会被其后任意一条 develop run 覆盖**（哪怕那条只因别的原因慢/红）；
2. ⇒ 必须**以「绿且快的那次 run 是载体里最新的 post-filing develop run」收口**，收口后不得再往
   develop 推提交而不复核（goal-driver 的 I5 achieved-but-failing 轮转也盯着，但那不是借口）；
3. ⇒ 也定下**验证顺序**：先在任务分支上把拆分/压实的改动验证到位，再一次性落地 develop 触发 CI，
   ⛔ 不要在 develop 上留下中间态 run；
4. ⇒ **且 develop 当时必须是绿的**：判据要求最新一条的 test job `conclusion == "success"`。
   实测 develop 间歇红（最近 8 条 develop CI 里 2 条 failure）⇒ 收口前必须确认 develop 无已知红，
   否则再快的套件也判 fail。

<!-- dedup-ref -->
**去重核对（机制，不是症状关键词）**：本 store 内认领 `goal_ac: AC-281` 的只有本任务与
`gap-ac281-scheduler-ms-carrier-field`（后者 **done**——只建载体派生字段，不改套件）。机制相邻但**不同层**、
已 done 的：`gap-develop-ci-first-decisive-green`(AC-265) 建的是采集器与载体；`gap-suite-split-15-over-30s-test-files`(AC-279)
与 `gap-checker-mutation-parallel-case-loop`(AC-280) 只覆盖 `scripts/test.sh` 内部相位，且**它们点名的 15 个
文件与上表 9 个无交集**；`gap-ac282-runner-prereqs-already-present` 处置的是 runner 侧前置（已 done）。
本任务与 AC-279/AC-280/AC-282 的依赖是实测的、不是想象的，以顶层 `depends_on` 结构化声明。

## Plan

1. **先读一次现场，确认判据口径与前置（⛔ 不假定）**：
   `node --experimental-strip-types packages/quay/src/goal-store.ts get AC-281` 确认 criterion 仍是
   `schedulerMs ≤ 30000` 口径且 `activatedAt`/`origin` 未被再次改动；`git log --oneline -5 develop` +
   `git show develop:<path>` 核实 AC-279 / AC-280 / AC-282 的改动确在 develop 上。未落地 ⇒ 本任务仍应
   在 todo，**不要开工**。
2. **取一次真实 per-file 剖面 —— 必须用 CI 自己的 `__PERFILE__`**：
   ```
   JOB=$(gh run view <runId> --repo yaleh/quay --json jobs -q '.jobs[]|select(.name=="test")|.databaseId')
   gh api "repos/yaleh/quay/actions/jobs/$JOB/logs" --allow-escape-sequences \
     | grep -o '__PERFILE__ duration_ms=[0-9]* [^ ]*' | sed 's/__PERFILE__ duration_ms=//' | sort -rn | head -30
   ```
   ⛔ **主检出 16 核的 `.quay/verification-round.jsonl` perFile 是代理量，不是 CI 的地板读数**——
   实测同一文件偏差最高 **127×**（`runtime-usage-inventory` 本地 50.8s / CI 0.4s；`prod-data-audit`
   59.0s / 3.5s），用它会把你引去拆 27 个在目标机器上根本不是地板的文件（同硬规则 4b）。
   ⛔ 也不拿本体上表当唯一清单——每次都要**重测**。
3. **压长杆（本任务的主体工作）**：按 `__PERFILE__` 降序逐个处理 >25s 的文件，直到没有任何单文件
   超过 ~25s。手法按文件性质选：拆分 `test()` 组 / 把串行循环后台化 / 把重复子进程调用塌缩为单次读数
   （⛔ 保留 fallback 路径，⛔ 不引入缓存/TTL——陈旧读数比慢更糟）。
   **每一项都要有 before/after 对照读数**（同一 run 的 `__PERFILE__` 前后各一次）；⛔ **无对照的项如实
   记为「未处置」**，不得写成已处置。⚠️ 拆分时同步核对 `scripts/test.sh` 的泳道/并发推导是否受影响。
4. **压实 test job 里非测试相位的残余**（与套件无关的部分）：
   ① `Install suite runtime prerequisites` —— **已由 `gap-ac282-runner-prereqs-already-present` 处置**
   （runner 镜像 `quay-ci-runner:ac282` 已预置 PyYAML/tmux/procps，读数从载体的 `jobs[].prereqProvision`
   读）⇒ ⛔ 不要重复做镜像预置；
   ② `npm install` —— 任务分支上已有改动（`~/.npm` 缓存 + `--prefer-offline` + `continue-on-error: true`），
   实测 pre 段方差 2→15s 全部来自它；
   ③ 静态检查相位里非 mutation 的部分（实测 `run_static_checks_ms≈3.2s`，占比已小）；
   ④ job 启动固定开销（checkout / setup-node / bootstrap config / coverage self-check）。
   ⛔ **不是把某一步删掉**——`ci.yml` 里每一步都有它存在的实测理由（注释逐条写了），删步会让「runner 缺件」
   重新变成几十个描述环境而非缺陷的红，`plugin/test/ci-runner-env-prereqs.test.mjs` 会立刻打红。
5. **触发一次真实 develop CI**：`gh workflow run ci.yml --ref develop`（gh 在 `/home/yale/.local/bin/gh`，
   已在 PATH 且 authed；dispatch 产生的 run 其 `head_branch` 就是 `develop`，满足判据的 branch 过滤），
   或 push develop。⛔ **只在任务分支上跑绿不算**。
6. **让读数进载体**：
   `node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --branch develop --workflow ci.yml --limit 20`
   （唯一写面；它会顺带派发 `testFiles` / `prereqProvision` / `schedulerMs`）。⛔ **不许手写一行 JSON 进载体**。
7. **读判据本身**：`node --experimental-strip-types packages/quay/src/goal-store.ts gate AC-281` ⇒
   `verdict: pass`，贴出它打印的 url / ts / `schedulerMs`。
8. **若仍 >30s**：回到第 2 步用剖面**归因到具体文件**，改完再走 5–7。⛔ 不设「跑 N 次直到绿」的赌法——
   每次都必须有测得的归因。
9. **收口纪律**：绿且快的那次 run 成为载体里**最新**的 post-filing develop run 之后，停止往 develop 推提交
   （除非同时接受重跑一次 CI 复核），否则第 7 步随时会被自己的下一次 push 作废。

## AC

- [ ] **AC1（goal 判据）**：`gate AC-281` 逐字重跑 `verdict: pass`，贴出它打印的 run url / ts /
      **`schedulerMs`**，以及同一 run 的 `testFiles`。
      ⛔ 不许靠「改宽判据」达成——2026-09-17 人裁定的那次改写是本任务开工的前提（已在 Proposal 记录），
      **此后** `goals/AC-281-*.md` 的 `criterion` / `expect` / `origin` / `activatedAt` 四处均不得再改动
      （举证：`git diff develop -- goals/` 对本 AC 文件零命中）。
- [x] **AC2（判据语义可分辨对照）**：把载体复制到 scratch cwd，构造合成载体，各跑一次**逐字提取**的
      criterion（提取方式：`goal-store get AC-281` 的 `criterion` 字段，round-trip 保真），逐条贴 exit code：
      ① 最新 = post-SINCE 绿 `schedulerMs=10000` ⇒ **0**；
      ② 最新 = post-SINCE 但 `conclusion=failure` ⇒ **1**；
      ③ 最新 = post-SINCE 绿 `schedulerMs=54149`（= 当前生产态）⇒ **1**；
      ④ 在绿 10s 之后追加一条 post-SINCE 慢记录 ⇒ **1**（证明取的是 `rows[-1]`，不是「存在一条快的就算数」）；
      ⑤ 最新 = **pre**-SINCE 绿 10s ⇒ **1**；
      ⑥ 最新 = post-SINCE 绿但该 test job **无 `schedulerMs` 键** ⇒ **1** 且 `CAUSE=scheduler-ms-not-recorded`
      （「未评估」必须与「合格」可区分——硬规则 3b）。
      ⛔ 不得改生产载体来做这组对照。
- [ ] **AC3（不是靠少跑换来的）**：收口 run 的 `testFiles` ≥ 立案读数 **650**（同一命令从载体读）；
      若低于，给出被合并/移走文件的完整映射与理由，并说明为什么套件覆盖没有下降。
- [ ] **AC4（残余墙钟有归因，不是猜）**：给出收口 run 的**相位级**耗时分解（来源：run 日志自身的
      `__GROUP__` / `__PERFILE__` / `__OVERHEAD__` 行，以及 GitHub 侧 step 时间），逐项命名并给出数值；
      对 Plan 第 3、4 步每一项给出「改前 → 改后」对照读数（⛔ 无对照的项如实记为**未处置**，不得写成已处置）。
- [x] **AC5（生产触发路径真跑过）**：贴出触发命令原文与 run id / url；证明该 run 的 `head_branch` 是
      `develop`（载体记录的 `branch` 字段即由此来）。⛔ 任务分支上的绿跑不作数。
- [ ] **AC6（载体由唯一写面产生）**：贴出 `ci-runs-collect.ts` 的调用与它打印的
      `appended= / skipped= / schedulerMsDerived=` 读数，证明收口那条记录是**采集器**写的；
      并证明没有手写：`git diff -- .quay/ci-runs.jsonl` 为空（该载体 gitignored，反证靠采集器调用读数 +
      载体行的字段完整性）。
- [ ] **AC7（回归：压墙钟没有把仪器变成恒绿）**：① 收口时 `gate AC-279` 与 `gate AC-280` 仍 `pass`
      （它们是真的验收，⛔ 不是被本任务的改动绕开）；② 收口 run 的 `test` job
      `conclusion == "success"`（快而红不算——判据自己也这么要求）；③ 被拆/被改的测试文件在收口 run 里
      **实际执行过**——从该 run 的 `__PERFILE__` 行里 grep 到各分片的执行行（⛔ 不是只看文件存在）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「本地跑快了」，而是**生产载体上出现了一条真的、绿的、
`schedulerMs ≤ 30000` 的 develop CI `test` job 记录，且它是 post-filing 的最新一条**：

1. **落地对象**：`gate AC-281` 在**真实载体**上 exit 0，贴出 url / ts / `schedulerMs` / `testFiles` / runId。
2. **可被打红**：AC2 的 6 条对照**实际跑过**并逐条贴上 exit code（尤其 ④「最新一条」语义与 ⑥
   「未评估 ≠ 合格」）。
3. **归因**：AC4 的相位分解与逐项 before/after（⛔ 若某项因未测量而无对照，如实记为未处置）。
4. **不许用「跑得更少」换绿**：AC3 的 `testFiles` 读数；若曾下降，映射与理由齐备。
5. **收口顺序**：明确记录收口 run 之后**没有再往 develop 推提交**；若推了，贴出随后复核的第二次
   `gate AC-281` 读数。⛔ 允许「收口后被自己的下一次 push 作废」成为沉默失败，是这条最贵的失败形态。
6. **证据留痕**：判据输出、对照、相位分解、采集器调用读数落成
   `.quay/ac281-evidence.md` / `.quay/ac281-floor-evidence.md`（沿用前轮两个文件）**或**写进任务体，
   **可被下一轮独立复算**（⛔ 不是只写一句「已绿」）。
   ⚠️ **这些 `.quay/` 证据文件是运行时产物：⛔ 不要 `git add` 它们。** 若要提交，必须把**具体**路径
   逐条写进 `## Touches`——`anti-drift` 的 `actualFiles` 是 `git diff --name-only develop...HEAD`，
   已提交的 `.quay/` 文件会立刻变成 `out-of-declared` HARD FAIL；且**通配形**（`.quay/ac281-*.md`）
   会被 `isOverbroadDeclaration` 判 overbroad 从而**挡住晋升**（实证 AC-260）。本任务 Touches 已登记
   上面两个具体路径作为兜底。

## 历史（前两轮，⛔ 已结案，不要重跑）

- **判死结论（仍成立）**：job **总墙钟** ≤30s 结构上不可达——`job = pre(≥16s) + suite(≥53.5s) +
  runner 收尾(≥10s) ≥ 79.5s`。完整取证（9 连跑的 step 时间分解 + 逐段下界）见 `.quay/ac281-floor-evidence.md`。
  ⇒ 这条**不再**是本任务的阻塞理由，因为判据已改口径；但它仍是「不要试图去压 pre 段到 30s」的依据。
- **已证伪的路线**：抬高并发（LPT 模拟 64/128/256/512 的 makespan 恒 = 最长单文件）；把本地 16 核
  `verification-round.jsonl` 的 perFile 当清单（偏差最高 127×）。
- **分支上未落地的既有工作**：`task/gap-ac281-…` 的 `4b0a99a06`（`cap-from-gate.ts` 把
  `computeEffectiveCap` 的 3 次子进程调用塌缩为 1 次读数，spawn 3→1、单次 4207ms→539ms，
  并把 `cap-from-gate-process-budget-path.test.mjs` 作为可打红的回归闸；实测把 `cap-from-gate-stale`
  从 24.3s 降到 11.5s——**正是本任务要压的那一簇**）。⛔ **不要重做**；重派时驱动会复用该 worktree/分支
  （`worker-driver.ts` `continueStateForTask` 仅以「worktree 是否存在」为条件），该提交随分支继承。
  已核：该分支合入当前 develop **零冲突**，与 develop 后来的路径锚定改动共存。

## Touches

- .github/workflows/ci.yml
- .quay/suite-bucket-reattribution.jsonl
- plugin/scripts/cap-from-gate.ts
- plugin/test/cap-from-gate-process-budget-path.test.mjs
- plugin/test/cap-from-gate-stale.test.mjs
- plugin/test/cap-from-gate-bands.test.mjs
- plugin/test/cap-from-gate-config-budget.test.mjs
- plugin/test/cap-from-gate-hysteresis.test.mjs
- plugin/test/driver-anchor.test.mjs
- plugin/test/driver-anchor-bundle.test.mjs
- plugin/test/fan-in-execute-paths-s07.test.mjs
- plugin/test/fan-in-execute-paths-s11.test.mjs
- plugin/test/inner-wakeup-heartbeat.test.mjs
- plugin/test/inner-wakeup-heartbeat-check.test.mjs
- plugin/test/supervisor-deliver.test.mjs
- plugin/test/supervisor-deliver-crosshost.test.mjs
- plugin/test/ci-runner-env-prereqs.test.mjs
- scripts/test.sh
- .quay/ac281-evidence.md
- .quay/ac281-floor-evidence.md
- tasks/gap-ac281-develop-ci-test-job-wallclock-under-30s.md

## Evidence（执行轮 3，2026-09-17，worker）

### §13 执行轮 3（2026-09-17）—— 按**新口径**（`schedulerMs ≤ 30000`）推进

新口径是开工前提（已由人 2026-09-17 裁定、Proposal 记录），本轮据此干活，⛔ 未改判据、未改 GOAL 文件。

**Plan 第 2 步——用 CI 自己的 `__PERFILE__` 重取剖面（⛔ 不用本地 16 核代理量）**：
run **35283904638** 的 `test` job 原始日志，831 行 `__PERFILE__` 全量解析（⛔ 非抽样）：

```
__OVERHEAD__ run_static_checks_ms=3192  main_phase_ms=51736  scheduler_ms=54149  lock_wait_ms=0
__GROUP__ concurrency=128 files=743 sum_ms=1605796 floor_ms=42963 capped=0
```

**Plan 第 3 步——按 `__PERFILE__` 降序压长杆，本轮拆掉 3 个（⛔ 未删/未弱化/未 skip 任何 test()，
搬走的用例逐字未改）**：

| 文件 | 拆前（本地实测） | 拆后 | 新文件 |
|---|---|---|---|
| `plugin/test/driver-anchor.test.mjs` | 57.4s | **35.6s** | `driver-anchor-bundle.test.mjs` **22.9s** |
| `plugin/test/fan-in-execute-paths-s07.test.mjs` | 16.3s | **5.9s** | `fan-in-execute-paths-s11.test.mjs` **10.5s** |
| `plugin/test/supervisor-deliver.test.mjs` | 32.1s | **10.7s** | `supervisor-deliver-crosshost.test.mjs` **21.3s** |

提交：`7373e1e4c`（driver-anchor + fan-in）、`8213d6060`（supervisor-deliver）、
`22460a9b1`（新 shard 的 AC121 reattribution 登记——否则 `suite-bucket-reattr-ratchet-check --gate`
层 1 直接红；取值 `attributeBuckets(...)` 是**测出来的**，同 s07/s09 先例）。
拆分手法：按**功能边界**（陈旧 bundle 动作面 / durationMs 与有界等待 / ssh 跨主机），
⛔ 不是「一个 test 的两半」；两半之间零共享可变状态，故并行跑与串行跑判定等价。
可复算：`node --test plugin/test/<file>`；`node --experimental-strip-types plugin/scripts/suite-bucket-reattr-ratchet-check.ts --gate --root .`

**本轮新增的可复算量——达标还差多远（LPT 模拟，输入 = 上面那份 831 行 `__PERFILE__`）**：

| 拆哪些 | 分片数 | ideal(sum/128) | **LPT@128 makespan** | 预测 `main` (×1.205) | 预测 `scheduler` (≈main+static) |
|---|---|---|---|---|---|
| 不拆（现状） | 831 | 15.9s | **42.96s** | 51.7s | **54.1s** ✗ |
| 只拆 >30s | 833 | 15.9s | 28.9s | 34.8s | ~38.0s ✗ |
| 拆 >25s | 837 | 15.9s | 24.3s | 29.3s | ~32.5s ✗ |
| **拆 >20s** | 842 | 15.9s | **19.4s** | 23.4s | **~26.6s ✓** |
| 拆 >15s | 851 | 15.9s | 15.9s | 19.2s | ~22.4s ✓ |

（`main_phase_ms/floor_ms` 实测比 = 51736/42963 = **1.205**，上表第 4 列用它外推；这是**推断**，
对照臂 = 抬并发恒无效（模拟里 128/256/384/512 同为 floor），故地板是唯一杠杆。）

⇒ **判据口径下的达标条件 = 拆掉 CI 上全部 >20s 的 9 个文件**（43.0 / 41.6 / 28.9 / 28.2 / 27.5 /
27.3 / 24.3×3）。**「只拆前几名不够」这一点被上表坐实**：拆完 >30s 后地板仍是 28.9s，
`scheduler` 只从 54.1 降到 ~38，离 30s 还差 8s。

**Plan 第 4 步——未处置，如实记录（⛔ 不写成已处置）**：`Install suite runtime prerequisites` 已由
AC-282 处置（读数走载体 `jobs[].prereqProvision`）；`npm install` 已在分支上处置（`~/.npm` 缓存 +
`--prefer-offline`，实测 8–15s → 1s）；`run_static_checks_ms=3192`（占比已小）；
`setup-node`(7s) / checkout / coverage self-check / bootstrap config —— **均未处置**。

**剩余长杆（下一次取剖面时会变，⛔ 不要照抄——但可作起点）**：`inner-wakeup-heartbeat.test.mjs`
(28.9s)、`inner-wakeup-heartbeat-check.test.mjs` (27.3s)、`cap-from-gate-bands.test.mjs` (27.5s)；
`cap-from-gate-config-budget/stale/hysteresis` (各 24.3s) **预计随分支上既有的 `4b0a99a06`
（`computeEffectiveCap` 3 spawn→1）落地而大幅下降**（该修复实测把 `cap-from-gate-stale` 24.3s→11.5s），
⛔ 故不要先去拆它们。另有两个**新 shard**（`driver-anchor-bundle`、`fan-in-execute-paths-s11`）
的 CI 时长**尚未实测**（本地 22.9s / 10.5s，CI 倍差按文件性质不同，⛔ 不要用本地值当 CI 地板）。

### §14 ⚠️ 仍存在的结构阻塞：判据的【时序】缺陷 ①（**改阈值没有消掉它**）

新口径把阈值从「job 总墙钟」换成「套件 `schedulerMs`」，**这是对的**（旧阈值 30s 对 job 是刀刃值，
且与 GOAL-022 的非目标「不追求绝对30秒」冲突）。但判据**读的还是同一样东西**：

> `.quay/ci-runs.jsonl` 里 `branch=="develop"` ∧ `ts > SINCE` 的**最新一条**的 `test` job。

而 develop 上的 CI 跑的是 **develop 的代码**；本任务的改动只能经 fan-in 的 ff 合入 develop，
而 fan-in 的 step 6.5 ac-precheck（`plugin/scripts/worker-driver.ts:4850`，读 `checked===total`）
**先于 suite 与 ff 就 fail-fast 拒翻**。

⇒ **要把改动送上 develop 必须先勾满 AC；而勾满 AC1/AC3/AC4/AC6/AC7②③ 需要一条 post-landing 的
develop run。两者互为前提 ⇒ 本任务按现判据**任何 worker 都无法落地**。**

**可分辨的对照（硬规则 4-推论四）**：同 GOAL 的 **AC-282 读的是同一种 post-filing develop run**，
却能在落地前被勾——因为它的修复在 **runner 宿主机**（镜像 `quay-ci-runner:ac282`），
**不依赖本任务分支被合并**；AC-279/AC-280 同理（判据对象是分支上的文件形态）。
⇒ 差别**正是**「判据点名的量是否穿过本任务自己的落地」。AC-281 是本 GOAL 四条里**唯一**一条穿过的。
⇒ 本轮的实际后果：**这 3 个拆分（以及分支上既有的 `4b0a99a06`）都不会到达 develop**，
下一轮会再次以「AC 未全勾（checked 2/7）」exit-not-landed。

**建议（⛔ 本 worker 不改判据）**——按强度：

1. **把判据的量换成【分支/工作树自己的套件读数】**：fan-in 在 ff 之前本来就会在工作树上跑一次全量
   套件，它**自己就打印** `__OVERHEAD__ scheduler_ms=`（本轮 §13 的一切读数都来自这一行）。
   把 AC-281 改成读那一次读数（或读 `verification-round.jsonl` 的对应字段），时序缺陷即消失，
   而**判据要保住的量（套件调度器墙钟）逐字不变**。
2. 若一定要保留「develop CI run」作收口证据：那只能由 **manager / human 在 fan-in 之外**把本分支的
   改动送上 develop（或先临时勾 AC 让 fan-in 落地、落地后复核 gate 并在下一轮把 AC 与证据对齐——
   但那需要明确授权，⛔ 本 worker 不自行这样做）。
3. **拆分工作本身照 §13 继续**（它不依赖判据口径，且 9 个 >20s 文件是达标条件）。

### §15 AC 逐条核对（本轮实测，⛔ 只勾**真的达成**了的）

**AC2 —— 勾。** 6 条对照（+1 条额外的 carrier-absent）**实际跑过**；criterion 经
`goal-store get AC-281` 的 `criterion` 字段**逐字提取**（shell 片段 round-trip 保真），cwd = scratch 临时目录，
⛔ 未动生产载体：

```
case 1 latest = post-SINCE green schedulerMs=10000                 exit=0  ✔
case 2 latest = post-SINCE but conclusion=failure                  exit=1  ✔ CAUSE=latest-run-not-green
case 3 latest = post-SINCE green schedulerMs=54149（= 生产态）      exit=1  ✔ CAUSE=too-slow
case 4 green 10s 之后【追加】一条 post-SINCE 慢记录(90s)            exit=1  ✔ CAUSE=too-slow，报的是后追加那条
                                                                          ⇒ 证明确实取 rows[-1]
case 5 latest = PRE-SINCE green 10000                              exit=1  ✔ CAUSE=no-post-filing-run
case 6 post-SINCE green 但该 test job 无 schedulerMs 键             exit=1  ✔ CAUSE=scheduler-ms-not-recorded
case 7（额外对照）载体不存在                                         exit=1  ✔ CAUSE=carrier-absent
ALL CONTROLS AS EXPECTED: True
```

**AC5 —— 勾。** 生产触发路径真跑过：

```
$ gh workflow run ci.yml --ref develop --repo yaleh/quay
⇒ run 35288482345   head_branch=develop   event=workflow_dispatch   2026-09-17T23:48:48Z
   https://github.com/yaleh/quay/actions/runs/35288482345   conclusion=success
```

（判据的 `branch` 过滤即由 `head_branch` 来；载体里该条为
`35288482345 develop success schedulerMs=54194 testFiles=744`。）

**AC6 —— 机制臂成立，但「收口那条记录」子句不成立 ⇒ ⛔ 未勾。** 采集器（唯一写面）调用读数：

```
$ node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --branch develop --workflow ci.yml --limit 5
carrier=/home/yale/work/quay/.quay/ci-runs.jsonl appended=2 skipped=3 attributed=1 enriched=0
enrichedPrereq=0 enrichedScheduler=1 logRunsFetched=3 testFilesDerived=5 prereqProvisionDerived=3
schedulerMsDerived=3
```

`git diff -- .quay/ci-runs.jsonl` 为空（载体 gitignored；⛔ 本任务一行 JSON 都没手写）。

**AC1 / AC3 / AC4 / AC6 / AC7②③ —— ⛔ 未勾**：观测对象是「收口 run」，因 §14 的时序缺陷不存在。
本轮 develop dispatch 跑完后 `gate AC-281` 的**实测**读数（⛔ 非估算）：

```
verdict: fail — CAUSE=too-slow；run 35288482345 的套件 scheduler = 54.2s > 30s
```

**AC7① —— 成立，但 ②③ 不成立 ⇒ AC7 整条未勾**：`gate AC-279 = pass`、`gate AC-280 = pass`
（⛔ 未被本任务改动绕开，即两条兄弟判据仍是真的验收）。同时这条读数也证明
**本轮的 3 个拆分尚未到达 develop**（develop 的 `schedulerMs` 仍是 54.2s，与立案时 54.1s 同级）。
