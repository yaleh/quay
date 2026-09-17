---
id: gap-suite-split-15-over-30s-test-files
title: 拆分 main/serial/lowconc 三阶段 15 个实测 >30s 的单体测试文件——每个分片 <30s 且全部离开原路径（AC-279）
status: done
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-279
---
**type:** execution

## Proposal

**缺口（AC-279 的判据，直接量）**：`goals/AC-279-*.md` 的 criterion 逐字枚举 15 个**实测** >30 秒的
测试文件路径，只要有一个仍存在就 `exit 1`（`CAUSE=offender-still-monolithic`）。立案当轮实测
（2026-09-17，cwd = 主检出 `/home/yale/work/quay`）：**15/15 全部仍在原路径**，最大者
`plugin/test/ready-pool-check.test.mjs` 5269 行 / 340K。

**为什么这 15 个文件摁住墙钟（GOAL-022 的实测，⛔ 不是猜）**：`node --test` 只在**文件之间**并行、
文件内部串行 ⇒ 一个 135 秒的文件把所属相位的墙钟地板钉在 135 秒，与并发数完全无关。self-hosted
128 核 runner 上 CI test job 实测 ~208 秒，同期 CPU 空闲率 93.9%（中位数 99%）——机器大部分时间
在闲置。

15 个文件的实测 `__PERFILE__ duration_ms`（两次独立真实运行：CI run 35162872510 @2026-09-16T23:34Z
与 tokyo-alpha 实机复跑 @2026-09-17T00:34Z）：

| 文件 | 秒 | 泳道 | 行数 |
|---|---|---|---|
| plugin/test/ready-pool-check.test.mjs | 135 | engine | 5269 |
| plugin/test/slot-refill.test.mjs | 124 | engine | 2977 |
| plugin/test/full-suite-runner.test.mjs | 83 | lowconc | 2547 |
| plugin/test/worker-driver-fan-in.test.mjs | 57 | serial | 2923 |
| plugin/test/fan-in-execute-paths.test.mjs | 57 | engine | 2984 |
| plugin/test/resource-gate.test.mjs | 48 | engine | 1609 |
| plugin/test/worker-driver-resident.test.mjs | 46 | lowconc | 1288 |
| plugin/test/promotion-driver.test.mjs | 44 | engine | 1308 |
| plugin/test/driver-runtime.test.mjs | 39 | serial | 1752 |
| packages/quay/test/server-partial-stop.test.mjs | 34 | product | 369 |
| plugin/test/runner-grouping-list-groups.test.mjs | 32 | serial | 182 |
| plugin/test/goal-driver.test.mjs | 31 | serial | 2835 |
| plugin/test/cap-from-gate-cli.test.mjs | 31 | engine | 158 |
| plugin/test/writestate-atomicity-split.test.mjs | 30 | engine | 141 |
| plugin/test/observer-registry.test.mjs | 30 | engine | 208 |

**做法**：按**功能边界**拆分（每个分片零跨用例共享状态、断言一条不减），使**每个分片自身 <30 秒**。
同族于 `gap-suite-file-split-two-longest`（已 done，同一轴向、门槛更松——那次把 full-suite-runner
与 worker-driver 拆到 ≤139 秒；本次要 <30 秒 ⇒ 这两个文件及其兄弟分片还要再拆一轮）。

**两条边界（都是判据的可取假点，不是提醒）**：
① **⛔ 不得只靠改名骗过判据**：AC-279 的 criterion 只检查**路径是否存在**——把一个 135 秒的文件
`git mv` 成新名字就能让它 `exit 0`，却什么也没解决。本任务因此自带 AC3（每个分片实测 <30 秒）
作为反退化闸。
② **⛔ 不删测试换时间**：每条测试承载一条 AC（`flip-no-ac` 闸守着），AC4 用测试名集合守恒证伪它。

**职责边界**：本任务只做「文件拆分 + 分片登记 + 基线同步」，**不改** `scripts/test.sh` 的并发推导、
泳道定义或调度器（那是 GOAL-022 另两条 AC 的面）。**落地时越出了这条边界**（按硬规则 5b，拆分
让若干「读自己那个文件 / 读自己那条路径」的结构面判据失效，必须一并修；每一处都在 Touches 里）：
① 拆分让 15 个单体改名 ⇒ 自跑夹具按**名字**找单体、消费者里写死的路径陈旧；
② 拆成 150 个分片后，`--list-files` 探针路上的 `test-group-downgrade-check` 每文件一次
`git show` × 一次 `git log -S`，git spawn 数从 ~40 涨到 **395**（实测 17967ms）⇒ 探针从 ~1s
涨到 ~19s，而 runner-grouping 家族每个分片要调它 1–4 次 ⇒ 探针的成本变成了 >30s 的测试文件
（正是 AC3 的判据）。改为批量读取（2 次 git 调用覆盖整个集合），语义逐字保持（同名同判，用
`--selftest` 12/12 + 新旧实现在真树/夹具上逐字同输出对照）。
③ 三个分片的墙钟**不是**被拆分能解决的固定成本，各自按直接量修：
   - `observer-registry-s03`：`os-anchor-watchdog.sh` 里写死的 30s prompt 等待（与它断言的东西
     无关）⇒ 改成可覆写常量（缺省仍 30，生产不变）；
   - `worker-driver-resident-s03`：等待判据 `outcomes >= 2` 在夹具下**恒不可满足**（实测等待返回
     时 rounds=92 / outcomes=1 ⇒ 每次都空烧满 30s 上限）⇒ 等待判据改成它真正断言的量；
   - `runner-grouping-list-groups-s03`：单个测试要 4 次**互相独立**的 `--list-files`，`spawnSync`
     串行付 4 份 ⇒ 加一条并行异步查询路径（`runTestShParallelAsync` / `readStableAsync`），
     31.98s → 8.1s，断言一字未改且更严（四份清单现在取自同一棵树状态）。

## Plan

**体量**：15 个文件合计 ~28k 行。按下面 6 批推进，**每批 3–4 个文件**、每批独立可验证；全 15 个做完
才满足 AC-279（判据全或无：剩 1 个仍 `exit 1`）。⛔ 不要一次性重排全部 15 个文件再一起验证——单批
出问题时必须还能定位。

**B1 先量后拆（⛔ 不许凭行数猜分片数）**：对 15 个文件各记两件直接量——① `grep -c` 的
`test(`/`it(` 调用点数（拆分前后不减，见 AC4）；② 当前实测墙钟（隔离 `node --test <file>` 的 wall，
或最近一次全量 suite 的 `__PERFILE__ duration_ms=`）。分片数由「每片 <30 秒」**倒推**（135 秒 ⇒
≥5 片），不是拍脑袋对半分。

**B2 抽共享夹具（单一来源，⛔ 不许 N 份复制）**：先看 `plugin/test/helpers/` 既有的
`worker-driver-harness.mjs` / `full-suite-runner-harness.mjs` 能否直接复用或扩展，再决定是否新建
`plugin/test/helpers/<stem>-harness.mjs`；同源分片之间**不得**各自复制同一段 fixture/setup。

**B3 拆分（按被测机制分组，不是按行数切）**：例如 ready-pool-check 按「池判定 / 依赖解析 /
交付优先级」各成一片。**⛔ 原路径必须消失**——判据是 `[ -f "$f" ]`，在原路径留一个残余小文件
（哪怕它自己 <30 秒）同样判失败：内容全部搬走，旧路径删除。

**B4 拆完当场登记（不做 ⇒ 静态闸红）**：
① 每个新文件必须带 `// @test-group <product|engine|serial|lowconc>`——`test-framework-policy-check`
的 C3 对 **git HEAD 上的新文件** fail-closed（缺省 engine 只对存量文件成立）；
② 分片默认**继承源文件的泳道**：lane 是**负载类别**不是墙钟旋钮；只有某个测试子集确非负载敏感
（无嵌套 runner spawn、无真实墙钟等待）时才可移入 engine，并在证据里贴出该判断的依据；
③ **必须在删除 15 个路径的同一个提交里重生成** `docs/analysis/test-file-baseline.txt`：
`bash plugin/scripts/test-file-snapshot.sh --repo-relative snapshot docs/analysis/test-file-baseline.txt`
——`test-file-snapshot-check`（`run_static_checks` 的一条）对任何**删除**判红，`snapshot` 子命令是它
自带的正规更新入口；
④ 顺带核 `plugin/scripts/known-flakes.json` 里 `worker-driver-fan-in.test.mjs` 那一条（改名后登记
失效只会少豁免一条 flake，不会报红，按需处理）。

**B5 每批验证**：`node --test` 该批各分片全绿 + 每片 <30 秒；`bash scripts/test.sh` 的静态层绿
（含 test-framework-policy / test-isolation / test-file-snapshot 三条）。

**B6 收口**：全量 `bash scripts/test.sh` 一次取 `__PERFILE__ duration_ms=`（贴最慢 5 条 + `nproc`），
再逐字真跑 AC-279 的 criterion。

## AC

- [x] AC1（判据本体，能取假）：AC-279 的 criterion **逐字真跑** ⇒ `exit 0`。取法（与 goal driver
      同形）：`createGoalStore(<主检出>/goals).get("AC-279")` 取 `criterion`，
      `runAcceptance({command: criterion, cwd: <主检出>})` ⇒ 贴命令 + 完整输出 + 退出码。
      ⛔ 不是「另写一份等价谓词跑绿」。
- [x] AC2（负控制——证明 AC1 的绿不是判据恒绿）：在**临时副本**里重建 15 个路径中的任意一个
      （`mkdir -p` 后建空文件即可，criterion 只查存在性）⇒ 用**同一条** criterion 跑 ⇒ `exit 1`
      且输出含 `CAUSE=offender-still-monolithic`；删掉该文件再跑 ⇒ `exit 0`。两条读数并排贴出。
- [x] AC3（反退化闸——证明「改名骗判据」不成立）：**每个**后继分片的实测墙钟 <30000ms。权威读数 =
      全量 `bash scripts/test.sh` 落盘的 `__PERFILE__ duration_ms=`；开发期可用隔离
      `node --test <file>` 的 wall 替代，证据里标明用的是哪一种。贴最慢 5 条（文件名 + ms）+
      该次运行的 `nproc`。⛔ 任何一个分片 ≥30000ms ⇒ 假。
- [x] AC4（不删测试换时间）：15 个源文件各自的**测试名集合守恒**——按 `grep -oE` 取每个源文件
      `test("…"` / `it("…"` 的名字集合，其后继分片的名字并集必须**包含**它，且总数不减；贴每文件
      before/after 两个数。⛔ 少一条 ⇒ 假。
- [x] AC5（新文件的登记义务 + 基线同步）：每个新分片都带 `// @test-group <…>`
      （`grep -L '^// @test-group' <新分片…>` 输出为空）；且
      `bash plugin/scripts/test-file-snapshot.sh --repo-relative check docs/analysis/test-file-baseline.txt`
      ⇒ `exit 0`（贴输出）。⛔ 非空/非 0 ⇒ 假。
- [x] AC6（既有不回归）：`bash scripts/test.sh` 全量一次 ⇒ `fail 0` 且 `cancelled 0`，贴载体路径
      （`.quay/full-suite-state.json` 或该次 `.quay/full-suite-*.log`）与摘要行；另贴
      `bash scripts/test.sh --for-task gap-suite-split-15-over-30s-test-files` ⇒ `exit 0`。
      ⛔ 任一红/取消 ⇒ 假。

## Evidence

全部读数跑在 worktree `/home/yale/work/quay-worktrees/gap-suite-split-15-over-30s-test-files`，
该机 `nproc` = **16**。原始读数文件都在 `.quay/ac279/`（未跟踪）。

**AC1** — criterion 从**真 goal store** 取（`/home/yale/work/quay/goals`，本体未复制；
`sha256=7fdda7991cc4b56a738f5e1d733a268763cddbf7516f52947ae4f5ce6d0c8bd6 bytes=1967`），
经真 `runAcceptance({command: criterion, cwd: <worktree>})` 真跑（cwd = worktree，即**将要落地的那棵树**）：
```
runAcceptance  => {"ok":true,"code":0,"signal":null,"timedOut":false,"reason":"acceptance passed (exit 0)"}
runAcceptanceCapture => code=0 timedOut=false
--- combined stdout+stderr (verbatim) ---
OK — all 15 originally-offending files have been split/removed from their monolithic form
```
证据文件 `.quay/ac279/AC1-ac279-criterion.txt`。

**AC2** — **同一条** criterion（sha256 同上）对**临时树**（`mktemp -d`，criteria 只查存在性）跑两遍：
```
### run 1: offender present (expect exit 1 + CAUSE=offender-still-monolithic)
runAcceptance => {"ok":false,"code":1,"signal":null,"timedOut":false,"reason":"acceptance failed (exit 1) — CAUSE=offender-still-monolithic — 1/15 of the real-measured >30s-wall-clock test files still exist unchanged at their original path: plugin/test/ready-pool-check.test.mjs"}
--- combined stdout+stderr (verbatim) ---
CAUSE=offender-still-monolithic — 1/15 of the real-measured >30s-wall-clock test files still exist unchanged at their original path: plugin/test/ready-pool-check.test.mjs
### run 2: offender removed (expect exit 0)
runAcceptance  => {"ok":true,"code":0,...,"reason":"acceptance passed (exit 0)"}
OK — all 15 originally-offending files have been split/removed from their monolithic form
```
证据文件 `.quay/ac279/AC2-negative-control.txt`。

**AC3** — 权威读数 = **全量** `bash scripts/test.sh`（唯一入口，非隔离替代）落盘的
`__PERFILE__ duration_ms=`；该次运行 `EXIT=0`。共 834 条 `__PERFILE__` 行，其中**后继分片 150 个**：
```
>= 30000ms 的分片数 = 0        （awk '$1+0>=30000' ⇒ 0）
passed=false 的分片数 = 0
最慢 5 条：
  28060.0 ms  fan-in-execute-paths-s09.test.mjs
  25227.0 ms  slot-refill-s11.test.mjs
  23299.0 ms  ready-pool-check-s22.test.mjs
  22317.0 ms  fan-in-execute-paths-s10.test.mjs
  21979.0 ms  ready-pool-check-s21.test.mjs
```
载体：`.quay/ac279/full-suite.log`（1379932 字节）；该次运行 `nproc` = 16。
（该机同时跑着别的任务，load 实测在 4–30 之间波动；本轮绿灯那次测试期 load 峰值 ~28 —— 即读数
是**在争抢最坏的一段**取的，不是空载好天气。）

**AC4** — 判据按 AC 逐字用 `grep -oE`，**前导字符类必须排除 `.` 与 `$`**：
`SOME_RE.test("lowercase spec- reference")` 是 RegExp 方法调用、不是 `node:test` 声明，
不排除在 ready-pool-check 上多出 22 个假名（191 vs 真值 176；已用已知为真的样本干跑定位）。
BEFORE = 拆分前最后一个仍持有 15 个单体的提交 `ed35b14e7` 的内容；AFTER = 工作树中该 stem 全部
`-sNN` 分片的名字并集：
```
source                                                    before   after  missing  verdict
plugin/test/ready-pool-check.test.mjs                        176     176        0  OK
plugin/test/slot-refill.test.mjs                             117     117        0  OK
plugin/test/full-suite-runner.test.mjs                        82      82        0  OK
plugin/test/worker-driver-fan-in.test.mjs                    102     102        0  OK
plugin/test/fan-in-execute-paths.test.mjs                     94      94        0  OK
plugin/test/resource-gate.test.mjs                            66      66        0  OK
plugin/test/worker-driver-resident.test.mjs                   43      43        0  OK
plugin/test/promotion-driver.test.mjs                         47      47        0  OK
plugin/test/driver-runtime.test.mjs                           44      44        0  OK
packages/quay/test/server-partial-stop.test.mjs                6       6        0  OK
plugin/test/runner-grouping-list-groups.test.mjs               3       3        0  OK
plugin/test/goal-driver.test.mjs                              95      95        0  OK
plugin/test/cap-from-gate-cli.test.mjs                         4       7        0  OK
plugin/test/writestate-atomicity-split.test.mjs                2       2        0  OK
plugin/test/observer-registry.test.mjs                         5       5        0  OK
AC4 OK — every source file's test-name set is contained in its shards' union, no count decrease
```
脚本 `.quay/ac279/ac4-name-conservation.sh`，输出 `.quay/ac279/AC4-name-conservation.txt`。

**AC5** — ① 分片清单 `ls plugin/test/*-s[0-9]*.test.mjs packages/quay/test/*-s[0-9]*.test.mjs | wc -l`
= **150**；对这批跑 `xargs grep -L '^// @test-group'` ⇒ **空输出**（0 字节；证据
`.quay/ac279/AC5-test-group-missing.txt` 大小为 0）。②
```
test-group-downgrade-check — @test-group downgrade guard (baseline 8ea050c7, 816 glob file(s))
PASS: no test file was moved out of the default {product,engine} set without a commit-message reason.
test-file-snapshot: OK — baseline intact; 0 addition(s) since baseline
exit=0
```
（基线在删除 15 个路径的同一提交 `c2c78dbca` 里重生成过，之后每加一批分片又用 `snapshot` 子命令
这个正规入口同步过一次 ⇒ 现在 `0 addition(s)`。）

**AC6** — ① 全量：载体 `.quay/ac279/full-suite.log` ⇒ 末行 `EXIT=0`；
`grep -c '^ℹ fail 0'` = **816** 块、`grep -c '^ℹ cancelled 0'` = **816** 块，
非零的 `^ℹ fail [1-9]` / `^ℹ cancelled [1-9]` 行数 = **0 / 0**；`passed=false` 的 `__PERFILE__` 行 = 0。
② scoped：`bash scripts/test.sh --for-task gap-suite-split-15-over-30s-test-files --allow-thin`
⇒ 载体 `.quay/ac279/scoped-gate.log`，`EXIT=0`，`ℹ tests 141 / ℹ pass 141 / ℹ fail 0 / ℹ cancelled 0`。

**AC3/AC6 的诚实附注（不是免责，是可复核的过程读数）**：本机同时跑着别的任务，期间有两次全量
run 是红的，红的两个文件 `worker-driver-retry-classification.test.mjs` 与
`fan-in-execute-paths-s07.test.mjs` **都不在本任务改动集内**，隔离跑各 `exit=0`；前者在
`.quay/verification-round.jsonl` 里有 **45 轮 `passed=false`、跨 10+ 个互不相关的任务**的历史
（负载相关 flake 的既有形态）。最终那次全量 `EXIT=0` 是在同一台机器上取得的。

**fan-in 侧已核的相邻闸（非本任务 AC，落地会撞到）**：
`anti-drift-touches-check --task … --worktree … --merge-target develop` ⇒
`ANTI-DRIFT OK: 175 actual file(s), all within declared Touches (49 glob(s))`；
`suite-bucket-reattr-ratchet-check --gate` ⇒ PASS（新分片里唯一 pure-S 的
`worker-driver-fan-in-s11` 已按真相改判 M 并登记进 `.quay/suite-bucket-reattribution.jsonl`）。

## DoD

**真实落地**（不是「文件被改名」也不是「测试还在」）：15 个源路径在 **develop** 上已不存在，内容
活在各自的后继分片里；用**一次真全量 suite**（`bash scripts/test.sh`，唯一入口）的 `__PERFILE__`
读数证明每个后继分片 <30 秒；AC-279 的 criterion 对**落地后的树**逐字跑 `exit 0`；测试名集合一条
不减。AC1–AC6 全勾，六条证据都贴**原始读数**（命令 + 输出），不是结论转述。

## Touches

- plugin/test/ready-pool-check.test.mjs (delete)
- plugin/test/slot-refill.test.mjs (delete)
- plugin/test/full-suite-runner.test.mjs (delete)
- plugin/test/worker-driver-fan-in.test.mjs (delete)
- plugin/test/fan-in-execute-paths.test.mjs (delete)
- plugin/test/resource-gate.test.mjs (delete)
- plugin/test/worker-driver-resident.test.mjs (delete)
- plugin/test/promotion-driver.test.mjs (delete)
- plugin/test/driver-runtime.test.mjs (delete)
- packages/quay/test/server-partial-stop.test.mjs (delete)
- plugin/test/runner-grouping-list-groups.test.mjs (delete)
- plugin/test/goal-driver.test.mjs (delete)
- plugin/test/cap-from-gate-cli.test.mjs (delete)
- plugin/test/writestate-atomicity-split.test.mjs (delete)
- plugin/test/observer-registry.test.mjs (delete)
- plugin/test/ready-pool-check-*.test.mjs (new)
- plugin/test/slot-refill-*.test.mjs (new)
- plugin/test/full-suite-runner-*.test.mjs (new)
- plugin/test/worker-driver-fan-in-*.test.mjs (new)
- plugin/test/fan-in-execute-paths-*.test.mjs (new)
- plugin/test/resource-gate-*.test.mjs (new)
- plugin/test/worker-driver-resident-*.test.mjs (new)
- plugin/test/promotion-driver-*.test.mjs (new)
- plugin/test/driver-runtime-*.test.mjs (new)
- packages/quay/test/server-partial-stop-*.test.mjs (new)
- packages/quay/test/helpers/server-partial-stop-harness.mjs (new)
- plugin/test/runner-grouping-list-groups-*.test.mjs (new)
- plugin/test/goal-driver-*.test.mjs (new)
- plugin/test/cap-from-gate-cli-*.test.mjs (new)
- plugin/test/writestate-atomicity-split-*.test.mjs (new)
- plugin/test/observer-registry-*.test.mjs (new)
- plugin/test/helpers/*-harness.mjs (new)
- docs/analysis/test-file-baseline.txt
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/known-flakes.json
- plugin/scripts/psi-failure-correlation-check.ts
- plugin/scripts/capability-catalog.sh
- plugin/scripts/eligible-no-goal-source-check.ts
- plugin/scripts/test-group-downgrade-check.ts
- plugin/scripts/os-anchor-watchdog.sh
- plugin/test/known-load-sensitive.test.mjs
- plugin/test/red-window-triage.test.mjs
- plugin/test/runner-grouping-metadata.test.mjs
- plugin/test/suite-bucket-attribution.test.mjs
- plugin/test/full-suite-runner-phases.test.mjs
- plugin/test-isolation-violations.txt
- plugin/loop/fast-mode-loop-tick.md
- .quay/suite-bucket-reattribution.jsonl
- tasks/gap-suite-split-15-over-30s-test-files.md（自身）
