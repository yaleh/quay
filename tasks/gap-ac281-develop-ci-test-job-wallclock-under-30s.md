---
id: gap-ac281-develop-ci-test-job-wallclock-under-30s
title: 真实 develop CI test job 一次 success 且 durationSec≤30（AC-281）——立案后实测
  209s/206s，15 文件拆分与 82 用例并行化落地后仍须压实 test job 的非测试相位残余墙钟
status: todo
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

## Proposal

**缺口（AC-281 判据，立案当轮直接量，2026-09-17，cwd = 主检出 `/home/yale/work/quay`）**：
`goals/AC-281-*.md` 读的是**本地载体** `.quay/ci-runs.jsonl` 里 `workflow=="CI"` ∧ `branch=="develop"`
∧ `ts > 2026-09-17T00:36:33Z`（SINCE = 本 AC 立案时刻）的记录，取**最新一条**的 `test` job，要求
`conclusion=="success"` ∧ `durationSec <= 30`。逐字重跑

```
node --experimental-strip-types packages/quay/src/goal-store.ts gate AC-281
```

**verdict=fail**：

```
"verdict": "fail",
"reason": "acceptance failed (exit 1) — CAUSE=too-slow — the latest post-filing CI test job
 (https://github.com/yaleh/quay/actions/runs/35167517872) took 209s, still above the 30s target"
```

立案时的 post-filing 读数（`ci-runs-collect.ts --branch develop --workflow ci.yml --limit 5 --dry-run`
直接读出，⛔ 不是估算）：

| run | ts | 整体 | `test` job | testFiles |
|---|---|---|---|---|
| 35167517872 | 2026-09-17T00:40:37Z | success | success **209s** | 650 |
| 35166479109 | 2026-09-17T00:25:10Z | failure | failure 206s | 650 |

⇒ 缺口既不是「没有读数」也不是「没接线」：**采集器与载体都在生产上跑着**（每条 develop run 由
`plugin/scripts/ci-runs-collect.ts` —— 载体的唯一写面 —— 写进载体，实测能直接读回上表两行）。
缺的是**把墙钟真正压到 30 秒内的那一次真实 develop CI 绿跑**；而那件事在 15 个 >30 秒单体文件与
82 用例串行循环仍在时**结构上不可能**——仅 `plugin/test/ready-pool-check.test.mjs` 一个文件的实测
duration 就是 135 秒 ⇒ 单文件地板 135s > 30s 目标，与并发数完全无关（`node --test` 只在文件之间并行）。

### ⚠️ 本任务不是那两条 AC 的重复，而是它们【落地之后】的那一半

- `gap-suite-split-15-over-30s-test-files`（AC-279）：把 15 个 >30s 文件按功能边界拆开/移走 ⇒ 拉低
  **文件粒度地板**。
- `gap-checker-mutation-parallel-case-loop`（AC-280）：把 `checker-mutation-check.sh` 的用例循环真正
  后台化 ⇒ 消掉静态相位里那一段单线程 18 秒。
- **两者都只覆盖 `scripts/test.sh` 内部的相位**。AC-281 量的是**整个 `test` job 的墙钟**，它的预算里
  还装着这些**没有任何既有任务认领**的项：`Install suite runtime prerequisites`（每次 job 重新
  apt 装 PyYAML/tmux/procps，ephemeral 容器不留状态 ⇒ 纯重复劳动）、`npm install`、静态检查相位里
  非 mutation 的部分（GOAL-022 背景实测：前 20 秒静态检查单线程）、job 启动固定开销
  （checkout / setup-node / bootstrap `.quay/config.yml` / coverage self-check），以及**任何不在原 15
  名单里、拆分后才暴露出来的 >30s 文件**（15 个是**某一次运行**测出来的，不是全集）。

### ⚠️ 判据读的是【最新一条】post-filing develop run —— 这是收口顺序的硬约束

criterion 按 `ts` 排序后取 `rows[-1]`，所以：

1. 一次 ≤30s 的绿跑**随时会被其后任意一条 develop run 覆盖**（哪怕那条只是因为别的原因慢/红）；
2. ⇒ 必须**以「绿且快的那次 run 是载体里最新的 post-filing develop run」收口**，收口后不得再往 develop
   推提交而不复核（goal-driver 的 I5 achieved-but-failing 轮转也盯着，但那不是借口）；
3. ⇒ 也定下**验证顺序**：先在任务分支上把拆分/并行化/残余压实的改动验证到位，再一次性落地 develop
   触发 CI，⛔ 不要在 develop 上留下中间态 run。

### ⛔ 不许用「跑得更少」换 30 秒

`durationSec` 变小最容易的假法是让套件少跑。判据本身只读 success + 秒数，**抓不到**这件事；所以本条
自带一条可取的对照量：同一 run 在载体里的 `testFiles`（由 run 日志的 `__GROUP__ … files=N` 派生，
⛔ 不是 run 元数据里可伪造的字段）。立案读数 **650**。⇒ 收口 run 的 `testFiles` 不得低于此地板；
若因合法合并而下降，必须给出被合并/移走文件的映射与理由（⛔ 不是沉默通过）。

<!-- dedup-ref -->
**去重核对（机制，不是症状关键词）**：本 store 内**无任何任务**以 `goal_ac: AC-281` 认领该 AC——逐文件扫
`^goal_ac:` 只命中 `gap-suite-split-15-over-30s-test-files`（AC-279）与
`gap-checker-mutation-parallel-case-loop`（AC-280）；按机制词扫（`ci-runs.jsonl` / `durationSec` /
`Install suite runtime prerequisites` / `重复装包` / `runner image`）亦无第三条命中本机制。机制相邻但
**不同层**、且已 done 的一条：`gap-develop-ci-first-decisive-green`（AC-265）**建的是本任务消费的采集器
与载体**，不是「把墙钟压到 30 秒」；`gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red`（done）解决的是
runner 缺 PyYAML/tmux 导致的环境性红，与本条「每次 job 重装约 8 秒」是同一处代码的**不同缺陷**（它要
「装上」，本条要「不要每次装」）。本任务与那两条 AC 任务的**依赖关系是实测的、不是想象的**（单文件地板
135s > 30s 目标，见上），因此以顶层 `depends_on` 结构化声明 `gap-suite-split-15-over-30s-test-files` 与
`gap-checker-mutation-parallel-case-loop`，⛔ 不靠散文里的措辞。

## Plan

1. **先读一次现场，确认前置真的落地**（⛔ 不假定）：`git log --oneline -3 develop` 加上
   `git show develop:<path>` 核实——被点名的大文件是否已全部离开原路径、`checker-mutation-check.sh`
   的调用行是否已带 `&` 且其后有 `wait`。未落地 ⇒ 本任务仍应在 todo，不要开工。
2. **取一次改动后的真实 per-file 剖面**：在落地后的 develop（或任务分支）上跑一次全量套件，读它自己
   打印的 `__PERFILE__ duration_ms=` 与 `__GROUP__ … floor_ms=`。⛔ 不拿立案时的 15 个名字当唯一清单——
   拆分后要**重新测**；任何仍 >30s 的文件（含拆分出来的分片本身、以及不在原名单里的）都是本任务对象。
3. **压实 test job 里非测试相位的残余**（第 3 项起**无既有任务认领**）：按测得的比例逐项取证——
   ① `Install suite runtime prerequisites`（apt PyYAML/tmux/procps，每次 job 重装）——**已由 `gap-ac282-runner-prereqs-already-present` 处置（2026-09-17）**：tokyo-alpha 的 runner 已换上预置了这三个前置的镜像 `quay-ci-runner:ac282`（可复现定义 `.github/runner/Dockerfile`），该步在它上面走 no-op 分支；读数可从载体的 `jobs[].prereqProvision` 直接读（机器可读 marker `__PREREQ__ <name>=<state>` 随该条落进 `.github/workflows/ci.yml`）⇒ ⛔ 不要重复做镜像预置；
   ② `npm install`；③ 静态检查相位里非 mutation 的部分；④ job 启动固定开销（checkout / setup-node /
   bootstrap config / coverage self-check）。处置方向按 GOAL-022 范围第三条：**把重复装包移出每次 job**
   （runner 侧预置 / 镜像 / 缓存）。⛔ **不是把某一步删掉**——`.github/workflows/ci.yml` 里每一步都有它
   存在的实测理由（注释逐条写了），删步会让「runner 缺件」重新变成几十个描述环境而非缺陷的红，而
   `plugin/test/ci-runner-env-prereqs.test.mjs` 会立刻打红。
4. **触发一次真实 develop CI**：`gh workflow run ci.yml --ref develop`（gh 在 `/home/yale/.local/bin/gh`，
   已在 PATH 且 authed；dispatch 产生的 run 其 `head_branch` 就是 `develop`，满足判据的 branch 过滤），
   或 push develop。⛔ **只在任务分支上跑绿不算**——判据的 branch 过滤是 `develop`。
5. **让读数进载体**：run 结束后跑
   `node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --branch develop --workflow ci.yml --limit 20`
   （唯一写面；`--log-fetch decisive` 会同时派生 `testFiles`）。driver 侧 `collectForRound` 有 10 分钟
   节流兜底，但那不构成「不用手动采一次」的理由。⛔ **不许手写一行 JSON 进载体**。
6. **读判据本身**：`node --experimental-strip-types packages/quay/src/goal-store.ts gate AC-281` ⇒
   `verdict: pass`，贴出它打印的 url / ts / durationSec。
7. **若仍 >30s**：回到第 2 步，用剖面**归因到具体项**（哪一相位、哪个文件），改完再走 4–6。
   ⛔ 不设「跑 N 次直到绿」的赌法——每次都必须有测得的归因。
8. **收口纪律**：绿且快的 run 成为载体里**最新**的 post-filing develop run 之后，停止往 develop 推提交
   （除非同时接受重跑一次 CI 复核），否则第 6 步随时会被自己的下一次 push 作废。

## AC

- [ ] **AC1（goal 判据）**：`gate AC-281` 逐字重跑 `verdict: pass`，贴出它打印的 run url / ts /
      `durationSec`，以及同一 run 的 `testFiles`。⛔ 不许靠「改宽判据」达成——`goals/AC-281-*.md` 的
      `criterion` / `expect` / `origin` / `activatedAt` **四处均不得改动**（举证：`git diff develop -- goals/`
      对本 AC 文件零命中）。
- [ ] **AC2（判据读的是【最新一条】post-filing develop run——可分辨对照）**：把载体复制到 scratch cwd，
      构造 5 种合成载体，各跑一次**逐字提取**的 criterion（提取方式：`goal-store get AC-281` 的
      `criterion` 字段，round-trip 保真、`python3 -` 逐行可还原），逐条贴 exit code：
      ① 最新 = post-SINCE 绿 10s ⇒ **0**；② 最新 = post-SINCE 但 `conclusion=failure` ⇒ **1**；
      ③ 最新 = post-SINCE 绿 45s ⇒ **1**（= 立案时的生产态）；④ 在绿 10s 之后追加一条 post-SINCE 慢记录
      ⇒ **1**（证明取的是 `rows[-1]`，不是「存在一条快的就算数」）；⑤ 最新 = **pre**-SINCE 绿 10s ⇒ **1**。
      ⛔ 不得改生产载体来做这组对照。
- [ ] **AC3（不是靠少跑换来的）**：收口 run 的 `testFiles` ≥ 立案读数 **650**（同一命令从载体读）；
      若低于，给出被合并/移走文件的完整映射与理由，并说明为什么套件覆盖没有下降。
- [ ] **AC4（残余墙钟有归因，不是猜）**：给出收口 run 的**相位级**耗时分解（来源：run 日志自身的
      `__GROUP__` / `__PERFILE__` 行，以及 GitHub 侧 step 时间），逐项命名并给出数值；对 Plan 第 3 步
      每一项给出「改前 → 改后」对照读数（⛔ 无对照的项如实记为**未处置**，不得写成已处置）。
- [ ] **AC5（生产触发路径真跑过）**：贴出触发命令原文与 run id / url；证明该 run 的 `head_branch` 是
      `develop`（载体记录的 `branch` 字段即由此来）。⛔ 任务分支上的绿跑不作数。
- [ ] **AC6（载体由唯一写面产生）**：贴出 `ci-runs-collect.ts` 的调用与它打印的
      `appended= / skipped= / testFilesDerived=` 读数，证明收口那条记录是**采集器**写的；
      并证明没有手写：`git diff -- .quay/ci-runs.jsonl` 为空（该载体是 gitignored 运行时载体，手改不进
      版本控制，反证靠采集器调用读数 + 载体行的字段完整性）。
- [ ] **AC7（回归：压墙钟没有把仪器变成恒绿）**：① 收口时 `gate AC-279` 与 `gate AC-280` 仍 `pass`
      （它们是真的验收，⛔ 不是被本任务的改动绕开）；② 收口 run 的 `test` job
      `conclusion == "success"`（快而红不算——判据自己也这么要求）；③ 被拆/被改的测试文件在收口 run 里
      **实际执行过**——从 run 日志里 grep 到各分片的执行行（⛔ 不是只看文件存在）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「本地跑快了」，而是**生产载体上出现了一条真的、绿的、
≤30 秒的 develop CI `test` job 记录，且它是 post-filing 的最新一条**：

1. **落地对象**：`gate AC-281` 在**真实载体**上 exit 0，贴出 url / ts / durationSec / testFiles / runId。
2. **可被打红**：AC2 的 5 条对照**实际跑过**并逐条贴上 exit code（尤其 ④：证明「最新一条」语义真的在
   起作用，而不是「存在一条快记录」）。
3. **归因**：AC4 的相位分解与逐项 before/after（⛔ 若某项因未测量而无对照，如实记为未处置）。
4. **不许用「跑得更少」换绿**：AC3 的 `testFiles` 读数；若曾下降，映射与理由齐备。
5. **收口顺序**：明确记录收口 run 之后**没有再往 develop 推提交**；若推了，贴出随后复核的第二次
   `gate AC-281` 读数。⛔ 允许「收口后被自己的下一次 push 作废」成为沉默失败，是这条最贵的失败形态。
6. **证据留痕**：判据输出、5 条对照、相位分解、采集器调用读数落成 `.quay/ac281-*` 证据文件或写进任务体，
   **可被下一轮独立复算**（⛔ 不是只写一句「已绿」）。

## Touches

- .github/workflows/ci.yml
- plugin/test/ci-runner-env-prereqs.test.mjs
- scripts/test.sh
- tasks/gap-ac281-develop-ci-test-job-wallclock-under-30s.md
