---
id: gap-ac281-develop-ci-test-job-wallclock-under-30s
title: 真实 develop CI test job 一次 success 且 durationSec≤30（AC-281）——立案后实测
  209s/206s，15 文件拆分与 82 用例并行化落地后仍须压实 test job 的非测试相位残余墙钟
status: ready
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

## Plan 第 2 步执行证据（2026-09-17，收集者：human + assistant，非本任务自身执行轮）

**来源**：`.quay/verification-round.jsonl` 第 **1858** 行（该载体的第 1858 条记录，非估算/非采样）。这一轮恰好是
`gap-spec-release-hotfix-branching-2026-09-17-revision` 任务的一次手动机械 fan-in 重跑产生的真实 suite round
（`runId: mfi-gap-spec-release-hotfix-branching-2026-09-17-revision-1789642850267-18e3a7`，`startedAt:
2026-09-17T11:02:48.376Z`，`durationMs: 397008`，`state: "green"`，`pass: 8678`，`fail: 0`，`tests: 8678`），
不是本任务自己触发的轮次，但其 `perFile`（816 个测试文件的逐文件耗时）是当前 develop 分支状态下
（AC-279/AC-280 均已落地之后）的真实、当轮、绿跑剖面，可直接作为 Plan 第 2 步「取一次改动后的真实
per-file 剖面」的起点数据，⛔ 不是本任务自己已完成第 2 步——仍需由执行者在自己的验证轮上复核。

**该轮 `perFile` 中仍 >30s 的文件，共 29 个（总 816 个测试文件中）**，按耗时降序：

| 耗时 | 文件 |
|---|---|
| 162.6s | `plugin/test/direct-to-develop-bypass-check.test.mjs` |
| 123.0s | `plugin/test/driver-anchor.test.mjs` |
| 120.3s | `plugin/test/verify-deliver-coldstart.test.mjs` |
| 68.2s | `packages/quay/test/branch-model.test.mjs` |
| 64.7s | `packages/quay/test/goal-store.test.mjs` |
| 62.6s | `packages/quay/test/npm-pack-e2e.test.mjs` |
| 61.1s | `packages/quay/test/server-status-web-control-same-pid.test.mjs` |
| 60.7s | `plugin/test/inner-wakeup-heartbeat.test.mjs` |
| 59.0s | `plugin/test/prod-data-audit.test.mjs` |
| 58.8s | `plugin/test/inner-wakeup-heartbeat-check.test.mjs` |
| 52.5s | `plugin/test/capability-catalog.test.mjs` |
| 50.9s | `plugin/test/full-suite-runner-phases.test.mjs` |
| 50.8s | `plugin/test/runtime-usage-inventory.test.mjs` |
| 50.2s | `plugin/test/cap-from-gate-bands.test.mjs` |
| 48.8s | `plugin/test/checker-mutation-check.test.mjs` |
| 46.9s | `plugin/test/fast-mode-telemetry.test.mjs` |
| 43.2s | `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` |
| 41.3s | `packages/quay/test/delivery-standalone-smoke-gate.test.mjs` |
| 40.0s | `packages/quay/test/observation.test.mjs` |
| 38.1s | `plugin/test/cap-from-gate-config-budget.test.mjs` |
| 38.1s | `plugin/test/cap-from-gate-hysteresis.test.mjs` |
| 37.7s | `plugin/test/cap-from-gate-stale.test.mjs` |
| 35.9s | `plugin/test/full-suite-runner-cgroup.test.mjs` |
| 33.6s | `experiments/quay-perpetual-stream/test/it0-dod-check.test.mjs` |
| 32.9s | `plugin/test/supervisor-deliver.test.mjs` |
| 32.3s | `packages/quay/test/build-plugin-dist.test.mjs` |
| 31.8s | `packages/quay/test/cli.test.mjs` |
| 31.4s | `plugin/test/worker-driver.test.mjs` |
| 30.6s | `plugin/test/fan-in-ff-merge.test.mjs` |

**核对**：以上 29 个文件均**不在** AC-279（`gap-suite-split-15-over-30s-test-files`）原先点名的 15 个文件清单中
——按逐文件名比对，`gap-suite-split-15-over-30s-test-files.md` 与本任务体全文均无 `grep` 命中这些文件名（本次
核对时 `direct-to-develop-bypass-check` 在两份任务体里都是零命中）。⇒ 印证本任务 Proposal 里的预判
（"拆分后才暴露出来的 >30s 文件（15 个是某一次运行测出来的，不是全集）"）：这些是 AC-279/AC-280 落地
**之后**才暴露的新地板，是本任务（而非 AC-279/AC-280）的对象，⛔ 不应被当成 AC-279 的遗留缺口去重新指派。

**⚠️ 待执行者复核，本节不构成 AC2/AC4 的完成**：这是起点数据，不是收口 run；执行者仍需在自己的验证轮
（Plan 第 4-6 步的真实 develop CI 触发）上重新采集，且逐项归因（AC4 要求相位级分解，不是只列文件名+耗时）。

### 🔴 2026-09-17 执行轮更正：上面这 29 个文件是【本地 16 核】的仪器读数，不是 CI 的

执行轮（worker `gap-ac281-develop-ci-test-job-wallclock-under-30s`）把上表**逐个**对着**真实 CI run 的
`__PERFILE__` 行**复核了一遍（来源：run **35225478541** 的 `test` job 原始日志，`gh api …/jobs/<id>/logs
--allow-escape-sequences`，816 行 `__PERFILE__` 全量解析，⛔ 不是抽样）：

| 文件 | 上表（本地 16 核） | **CI 实测（128 核 tokyo-alpha）** | 倍差 |
|---|---|---|---|
| direct-to-develop-bypass-check | 162.6s | **8.1s** | 20× |
| driver-anchor | 123.0s | **43.1s** | 2.9× |
| verify-deliver-coldstart | 120.3s | 13.4s | 9× |
| branch-model | 68.2s | 19.4s | 3.5× |
| goal-store | 64.7s | 14.7s | 4.4× |
| npm-pack-e2e | 62.6s | 10.8s | 5.8× |
| server-status-web-control-same-pid | 61.1s | 14.2s | 4.3× |
| inner-wakeup-heartbeat | 60.7s | 29.1s | 2.1× |
| prod-data-audit | 59.0s | 3.5s | 17× |
| inner-wakeup-heartbeat-check | 58.8s | 27.2s | 2.2× |
| capability-catalog | 52.5s | 12.2s | 4.3× |
| full-suite-runner-phases | 50.9s | 19.3s | 2.6× |
| runtime-usage-inventory | 50.8s | **0.4s** | 127× |
| cap-from-gate-bands | 50.2s | 27.5s | 1.8× |
| checker-mutation-check | 48.8s | 8.1s | 6× |
| fast-mode-telemetry | 46.9s | 9.3s | 5× |
| proposal-convergence | 43.2s | 9.2s | 4.7× |
| delivery-standalone-smoke-gate | 41.3s | 12.3s | 3.4× |
| observation | 40.0s | 18.6s | 2.2× |
| cap-from-gate-config-budget | 38.1s | 24.3s | 1.6× |
| cap-from-gate-hysteresis | 38.1s | 24.3s | 1.6× |
| cap-from-gate-stale | 37.7s | 24.3s | 1.6× |
| full-suite-runner-cgroup | 35.9s | 4.5s | 8× |
| it0-dod-check | 33.6s | 7.0s | 4.8× |
| supervisor-deliver | 32.9s | 28.5s | 1.2× |
| build-plugin-dist | 32.3s | 4.5s | 7× |
| cli | 31.8s | 9.2s | 3.5× |
| worker-driver | 31.4s | 16.5s | 1.9× |
| fan-in-ff-merge | 30.6s | 9.9s | 3.1× |

**结论：上表 29 个里只有 2 个在 CI 上真的 >30s**（`driver-anchor` 43.1s；以及**上表根本没列**的
`plugin/test/fan-in-execute-paths-s07.test.mjs` 41.6s）。其余 27 个在 128 核 runner 上是 0.4–29.1s。
⇒ **AC-281 量的是 CI job 的墙钟，其 per-file 剖面必须用 CI 自己的 `__PERFILE__` 行**；用主检出 16 核的
`verification-round.jsonl` perFile 当清单，会把执行者引去拆 27 个在目标机器上根本不是地板的文件。
（同硬规则 4b：本地 16 核 perFile 是**代理量**，CI 自己打印的 per-file 才是直接量。本地那些 >100× 的
偏差也不是纯并发差——`runtime-usage-inventory` 50.8s→0.4s、`prod-data-audit` 59.0s→3.5s 只能由那轮
本地的排队/资源闸等待解释，进一步说明它不是可搬运的地板读数。）

**CI 侧真实相位分解（同一 run 35225478541 的日志 marker + `gh jobs` API step 时间戳）**：

```
build_dist_ms=196   run_static_checks_ms=3642   resource_gate_ms=61
main_phase_ms=51124 serial_phase_ms=19310 lowconc_phase_ms=18921 scheduler_ms=53538
test job durationSec=95（steps 合计 84s ⇒ job 固定开销 ≈11s）
```
`__GROUP__ concurrency=128 files=728 sum_ms=1571644 floor_ms=43053`（floor = 最长单文件）。
⇒ **main 相位是长杆限制、不是容量限制**：816 文件合计 1996.5s ⇒ 128 并发理想 makespan 15.6s，
而 87% 的文件在 t+20s 前就跑完了，相位却到 t+51s —— 因为 `driver-anchor` 一个文件从 t=0 跑到 t+43s。
按实测 per-file 时长做贪心调度模拟：并发 128/256/384/512/768 的 makespan **都是 43.1s**。
⇒ **提高并发对当前套件完全无效；唯一的杠杆是压低【最长单文件】。**（本地 16 核与 CI 128 核对同一
文件的读数相近或本地更慢 —— `cap-from-gate-stale` 本地 30s / CI 24.3s，`driver-anchor` 本地 60.5s /
CI 43s ⇒ 这些 per-file 时长**不是**被 128 路并发灌水出来的，sum 1996.5s 是可用的工作量估计。）

## 执行轮结论（2026-09-17，worker，⛔ 未完成 AC-281）

**本任务按现范围无法在其自身的执行轮内达成 AC1（test job ≤30s）**，依据是上节的可复算读数：

- job 固定开销 ≈11s（三个 run 实测 11/13/11s）+ checkout 2s + verify 1s + coverage 3s + post 1s ≈ 18s；
- 加上静态相位 3.6s + 调度器 makespan；
- 调度器的**理论地板** = max(main 1571.6/128, serial 174.6/64, lowconc 250.3/64) = **12.3s**（完美均衡、
  且没有任何文件超过它时才能达到）；
- ⇒ 即使把 `npm install` 与 `setup-node` 都变成 0（需要 runner 镜像侧预置），地板仍是 ≈ 18 + 3.6 + 12.3
  ≈ **34s**；要压到 30s，必须把套件**总工作量**从 ≈1996s 砍到 ≈1000s 量级（`128 × (30−18−3.6)`），
  也就是**砍掉约一半的套件执行成本**，而不只是重排/拆分。

⚠️ 上条是**推断**（由实测 per-file 时长推出的下界），不是直接测量；它的对照臂是：本地 16 核（idle）与
CI 128 核（load）对同一批文件的时长**相当或本地更慢**，所以 1996.5s 不是并发灌水出来的虚高值 —— 若
该对照反过来（本地显著更快），这个下界就不成立。

**本次实际落地（都在任务分支 `task/gap-ac281-…`，commit `4b0a99a06`）**：

1. `plugin/scripts/cap-from-gate.ts` —— **真缺陷，不是微优化**：`computeEffectiveCap` 用
   **3 次子进程**（resource-gate.sh ×2 + process-budget.sh ×1）去取三个读数，而 resource-gate.sh 的
   **同一次**报告里本来就并排打印这三者（它内部已调用 process-budget.sh 并输出
   `total_budget=… budget_in_use=… budget_available=…`）。实测**单次调用 4207ms**，几乎全是 spawn；
   `cap-from-gate-stale.test.mjs` 调它 7 次 ⇒ **一个 `test()` 24.3s CI 墙钟**（main 相位里除两个 >30s
   文件之外最大的单文件地板）。改后**单次 539ms、该文件 11.5s**。spawn 3 → 1，**读数逐字不变**
   （无 memoize / 无 TTL / 无缓存，每次仍是新读数）。fallback 路径（gate 脚本解析不到）逐字保留。
2. `plugin/test/cap-from-gate-process-budget-path.test.mjs` —— 新增可打红的回归闸：对一个假 plugin root
   数 resource-gate.sh 的真实调用次数，断言 **= 1**。**负控制已跑**：对着改前的
   `cap-from-gate.ts` 跑 ⇒ `AssertionError: … exactly ONCE …; got 2`（FAIL），改后 ⇒ PASS。
3. `.github/workflows/ci.yml` —— 缓存 `~/.npm`（键 = `hashFiles('package-lock.json')`）+ `--prefer-offline`。
   runner 容器是 **ephemeral**（`--rm` + `EPHEMERAL=true`）⇒ 每个 job 都从空 `~/.npm` 重新下载全部 tarball。
   `continue-on-error: true` 是有意的：缓存故障不得把绿的套件变红。⛔ 没有删步、⛔ 没有浮动版本。

**未处置（如实记为未处置，⛔ 不写成已处置）**：`setup-node`（6s）、`Run tests` 的长杆文件拆分、
`run_static_checks` 与调度器的重叠、runner 镜像侧预置（需 tokyo-alpha 的 host 侧动作与授权）。
**AC1/AC3/AC4/AC5/AC6/AC7 均未勾** —— 没有一次 ≤30s 的 post-filing develop 绿跑，这些 AC 的前提
不存在；⛔ 不以本地读数或推断代替收口 run。

**交给下一轮的结论**：AC-281 不是「重排/压非测试相位」类任务，而是**套件总成本削减**类任务；且它的
Plan 第 2 步清单必须换成 CI 自己的 `__PERFILE__`（当前真值：只有 2 个文件 >30s，18 个 >15s）。建议
按「单文件耗时 ≤ 阈值」重新切分，而不是按「>30s 文件个数」。

3. **压实 test job 里非测试相位的残余**（第 3 项起**无既有任务认领**）：按测得的比例逐项取证——
   ① `Install suite runtime prerequisites`（apt PyYAML/tmux/procps，每次 job 重装）——**已由 `gap-ac282-runner-prereqs-already-present` 处置（2026-09-17）**：tokyo-alpha 的 runner 已换上预置了这三个前置的镜像 `quay-ci-runner:ac282`（可复现定义 `.github/runner/Dockerfile`），该步在它上面走 no-op 分支；读数可从载体的 `jobs[].prereqProvision` 直接读（机器可读 marker `__PREREQ__ <name>=<state>` 随该条落进 `.github/workflows/ci.yml`）⇒ ⛔ 不要重复做镜像预置；
   ② `npm install`（本次已处置：`~/.npm` 缓存 + `--prefer-offline`，见上）；③ 静态检查相位里非 mutation 的部分；④ job 启动固定开销（checkout / setup-node /
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
- [x] **AC2（判据读的是【最新一条】post-filing develop run——可分辨对照）**：把载体复制到 scratch cwd，
      构造 5 种合成载体，各跑一次**逐字提取**的 criterion（提取方式：`goal-store get AC-281` 的
      `criterion` 字段，round-trip 保真、`python3 -` 逐行可还原），逐条贴 exit code：
      ① 最新 = post-SINCE 绿 10s ⇒ **0**；② 最新 = post-SINCE 但 `conclusion=failure` ⇒ **1**；
      ③ 最新 = post-SINCE 绿 45s ⇒ **1**（= 立案时的生产态）；④ 在绿 10s 之后追加一条 post-SINCE 慢记录
      ⇒ **1**（证明取的是 `rows[-1]`，不是「存在一条快的就算数」）；⑤ 最新 = **pre**-SINCE 绿 10s ⇒ **1**。
      ⛔ 不得改生产载体来做这组对照。
      **【2026-09-17 执行轮 2 实测：5/5 与规格相符，exit code 逐条 = 0 / 1 / 1 / 1 / 1】** 见 `## Evidence` §2。
- [ ] **AC3（不是靠少跑换来的）**：收口 run 的 `testFiles` ≥ 立案读数 **650**（同一命令从载体读）；
      若低于，给出被合并/移走文件的完整映射与理由，并说明为什么套件覆盖没有下降。
- [ ] **AC4（残余墙钟有归因，不是猜）**：给出收口 run 的**相位级**耗时分解（来源：run 日志自身的
      `__GROUP__` / `__PERFILE__` 行，以及 GitHub 侧 step 时间），逐项命名并给出数值；对 Plan 第 3 步
      每一项给出「改前 → 改后」对照读数（⛔ 无对照的项如实记为**未处置**，不得写成已处置）。
- [x] **AC5（生产触发路径真跑过）**：贴出触发命令原文与 run id / url；证明该 run 的 `head_branch` 是
      `develop`（载体记录的 `branch` 字段即由此来）。⛔ 任务分支上的绿跑不作数。
      **【2026-09-17 执行轮 2 实测：`gh workflow run ci.yml --ref develop` ⇒ run 35229453772，
      `head_branch=develop`、`event=workflow_dispatch`】** 见 `## Evidence` §3。
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
- plugin/scripts/cap-from-gate.ts
- plugin/test/cap-from-gate-process-budget-path.test.mjs
- plugin/test/ci-runner-env-prereqs.test.mjs
- scripts/test.sh
- tasks/gap-ac281-develop-ci-test-job-wallclock-under-30s.md

## Evidence（执行轮 2，2026-09-17）

**结论：AC-281 的 30s 阈值低于 `test` job 自身的【不可约开销】—— 该判据结构上不可满足，不是「本轮没做完」。**
完整取证（含逐条复算命令）：`.quay/ac281-floor-evidence.md`。

### §0 job 墙钟的逐段分解（真实 CI，tokyo-alpha 128 核，`gh api …/jobs` 的 step 时间戳）

| run | job 总 | pre（checkout/setup-node/npm install/coverage） | **Run tests** | **runner 收尾** |
|---|---|---|---|---|
| **35229453772**（本轮 dispatch） | **87s** | **16s** | **60s** | **11s** |
| 35227553148 | 94s | 22s | 60s | 11s |
| 35228548244 | 96s | 23s | 60s | 12s |
| 35225478541 | 95s | 25s | 60s | 10s |
| 35215970607 | 104s | 33s | 60s | 11s |

⇒ **job 的方差全部来自 pre 段**（`npm install` 2→15s）；`Run tests` 与 runner 收尾是常数。
`Run tests` 在 **9 连跑**上是 60/61s（`35214296126 60 35214586703 60 35215002986 60 35215586532 61
35215970607 60 35225478541 60 35226449580 60 35227553148 60 35228548244 60`）。

**⇒ 下界**：把 pre 段与 runner 收尾**全部假想成 0**（绝大多数不在 `ci.yml` 能力内），
`0 + 60 + 0 = 60s` —— **正好是 30s 目标的两倍**。即使套件耗时归零，job 仍是
`16 + 0 + 11 = 27s`… 但套件耗时**不可能**归零：`Run tests` = 静态段 ~6.7s + `scheduler_ms` 53.5s。
**⇒ `job = pre(≥16) + suite(≥53.5) + tail(≥10) ≥ 79.5s`，判据要求 ≤30s。**

### §1 suite 内部：长杆是单文件，不是容量（run 35227553148 的 `__OVERHEAD__` / `__GROUP__` 行）

```
__OVERHEAD__ lock_wait_ms=1          ← 锁不是瓶颈（runner 独占）
__OVERHEAD__ lock_hold_ms=57731      ← 持锁 ≈ 整个 suite 时长
__OVERHEAD__ main_phase_ms=51092  serial_phase_ms=19098  lowconc_phase_ms=18912
__OVERHEAD__ scheduler_ms=53507   build_dist_ms=202   resource_gate_ms=59
__GROUP__ concurrency=128 files=728 sum_ms=1572369 floor_ms=43058
```
816 文件 `sum_ms=1 995 479`（1995.5s）⇒ 128 并发理想 makespan 15.6s；实测 main 相位 51.1s，
因为 `plugin/test/driver-anchor.test.mjs` 单文件 43.1s。**LPT 模拟：并发 64/128/256/512 的 makespan
全部 = 43.1s** ⇒ 抬并发无用，唯一杠杆是压低最长单文件。CI 上 >30s 的只有 2 个：
`driver-anchor.test.mjs` 43.1s、`fan-in-execute-paths-s07.test.mjs` 41.6s（后者不在任何既有清单里）。

### §2 AC2 —— 5 条对照逐条实跑（criterion 经 `goal-store get AC-281` 逐字取出：55 行 / 2106 字节；scratch cwd，⛔ 未改生产载体）

```
case 1  latest = post-SINCE green 10s                       exit 0  ✔ (stdout: "OK — … took 10s <= 30s target")
case 2  latest = post-SINCE but conclusion=failure           exit 1  ✔ CAUSE=latest-run-not-green
case 3  latest = post-SINCE green 45s（立案时的生产态）      exit 1  ✔ CAUSE=too-slow
case 4  green 10s，其后追加一条 post-SINCE 慢记录(90s)      exit 1  ✔ CAUSE=too-slow，报的是后追加的那条
                                                                      ⇒ 证明确实取 rows[-1]，不是「存在快记录就算数」
case 5  latest = pre-SINCE green 10s                        exit 1  ✔ CAUSE=no-post-filing-run
ALL 5 CONTROLS AS EXPECTED: True
```

### §3 AC5 —— 生产触发路径真跑过

```
$ gh workflow run ci.yml --ref develop --repo yaleh/quay
⇒ run 35229453772   head_branch=develop   event=workflow_dispatch
   test job: 2026-09-17T13:48:47Z → 13:50:14Z = 87s  conclusion=success
```
（⛔ 载体里此刻**最新**的 post-filing develop run 就是它：`ts=2026-09-17T13:48:43Z`，success，87s，
`testFiles=728`。）

### §4 AC6 的机制臂（⛔ 其「收口那条记录」子句因无收口 run 而不成立，故 AC6 未勾）

```
$ node --experimental-strip-types plugin/scripts/ci-runs-collect.ts --branch develop --workflow ci.yml --limit 5
carrier=/home/yale/work/quay/.quay/ci-runs.jsonl appended=1 skipped=4 attributed=0 enrichedPrereq=0
logRunsFetched=1 testFilesDerived=5 prereqProvisionDerived=1
```
（两趟：一趟追加 35228548244，一趟追加 35229453772；`git diff -- .quay/ci-runs.jsonl` 为空 —— 载体 gitignored。）

### §5 AC7① —— 兄弟判据未被绕开

`gate AC-279` = `pass`；`gate AC-280` = `pass`。

### §6 未做的事（如实记录）

- **AC1 未达成**：`gate AC-281` 仍 `fail`（最新 = 35229453772，success，**87s**）。
- **AC3 / AC4 / AC7②③ 的观测对象是「收口 run」，该 run 不存在** ⇒ 未勾。
  可核的替代读数：最新 develop test job 的 **`testFiles=728 ≥ 650`**，即**套件覆盖没有下降**。
- **未拆 `driver-anchor.test.mjs`**：它是唯一能把 job 从 ~94s 压到 ~64s 的杠杆，但**拆了也仍 >30s**
  （§0 的下界），且该文件不在 `## Touches` 内、有回归风险 ⇒ 留给重定范围后的轮次，不在此轮押上。

### §7 给重定范围的建议（⛔ 本 worker 不改判据）

判据量的是 **job 墙钟**，而其中 ≥27s 与套件无关，且 `GOAL-022` 的「范围与非目标」逐字写着
「不追求"绝对30秒"是数学精确值」—— 与该 AC 的硬阈值 `durationSec <= 30` 直接矛盾。
⇒ 建议（按强度）：① 改用只量套件的 `scheduler_ms`（当前 53.5s，拆 driver-anchor 后可达 ~23s）
作判据，或把阈值改为「与套件无关的固定开销 + 可达套件预算」；② 把「测试执行」从 `test` job 拆成
独立 job，判据改读那个 job；③ 拆 `driver-anchor.test.mjs`（43.1s）+ 抬高有效并发上限
（当前 `reliability cap: total ≤ min budget of active groups` = 64）。**⛔ 单靠 ③ 到不了 30s。**
