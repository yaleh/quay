---
id: gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency
title: 恢复阶梯的降档对 hub(bucket full=1) 轮次静默失效：test.sh 的 bucket_full 分支丢掉 rest_args ⇒
  --lane-count 64/48/32 全部跑回 main≤128 ⇒ OOM 永远解不掉
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
## Finding

**结论**：fan-in 的「完整、更低并发的恢复重跑」阶梯（64/48/32）对 **hub 形态**（`__BUCKETS__ … full=1`，即
桶选择器回退到全量 suite）**结构上完全不生效** —— 每一档都跑回 ~126 并发，因此在声明的 32G `MemoryMax`
下每一档都 OOM，`exited-not-landed` 永远解不掉。2026-10-23/24 的
`gap-ac920-criterion-pipe-swallows-exit-code` 连续 3 轮即此形态。

### 事实一：恢复档请求 32 并发，实际跑到 126（逐字读数，2026-10-23T18:16Z）

同一轮（runId `mfi-gap-ac920-criterion-pipe-swallows-exit-code-1792777515502-e9b9b5`）：

- `.quay/suite-memory-evidence-mfi-gap-ac920-criterion-pipe-swallows-exit-code-1792777515502-e9b9b5.json`：
  `concurrency.laneCount = 32`（**请求值**）、`concurrency.maxConcurrentOverall = 126`（**实测值**）、
  `memoryMaxPolicy.actualConcurrency = 128`、`oomKill = 3`、`peakBytes = 34360061952` vs
  `memoryMaxBytes = 34359738368`（峰值仅超声明上限 323584 字节）。
- 同轮 `recovery-32-1792779371990-5d3c97.log` 第 3 行逐字：
  `scheduler: unified group-budget scheduler (serial≤32 lowconc≤32 main≤128)`；
  第 4 行逐字：`scheduler: serial=64≤32 lowconc=37≤32 main=945≤126`。
  ⇒ `serial/lowconc` 的 config 32 生效了，**但 main 预算是 128（nproc 派生），不是请求的 32**。

### 事实二：根因 —— `bucket_full` 分支丢掉 `rest_args`（代码位置）

1. `plugin/scripts/worker-fan-in.ts:941` — 恢复档 argv = `[...retargetLogFile(base, recLogFile),
   "--lane-count", String(n)]`。base argv（`worker-fan-in.ts:2028-2036`）本身不含 `--lane-count`，
   故 runner 确实收到 `--lane-count 32`（与事实一的 `laneCount=32` 一致）。
2. `plugin/scripts/full-suite-runner.ts:3121` 读 `--lane-count` ⇒ `laneCount=32`；
   `:3175` `spliceConcurrency(baseCommand, laneCount)` ⇒ 子命令
   `bash scripts/test.sh --buckets <task> --test-concurrency=32`。
3. `scripts/test.sh`（bucket 分支，修复前）：
   ```
   if [ "${bucket_full}" = "1" ]; then
     # Hub touch / no-bucket-triggerable ⇒ the full default suite (run_selected exits).
     run_selected "$(effective_groups)"
   fi
   ```
   ⛔ 调用 **没有转发 `"${rest_args[@]}"`** ⇒ `--test-concurrency=32` 在这一支被静默丢弃。
   `run_selected` 于是走 `default_test_concurrency()`（nproc 派生 128）⇒ `main≤128`。
4. 对照（同一文件、非 hub 分支）：`--main-concurrency "$(bucket_test_concurrency "${rest_args[@]}")"`
   ⇒ 非 hub 路径**是**尊重该旗标的。同族第二处（selector 选中 0 文件 ⇒ 回退全量）同样不转发 `rest_args`。

### 事实三：既有测试为何没发现（代理量 vs 直接量，硬规则 4b）

`full-suite-runner` 的 AC16 只断言「`--lane-count N` 传播成 spawned `test.sh` argv 里的
`--test-concurrency=N`」（**命令字符串** = 代理量），没有断言「下游 effective main 预算 == N」
（**`scheduler:` 行 / `maxConcurrentOverall`** = 直接量）。二者在 hub 分支上分叉，测试仍绿。

### 为什么这不是「再降一档就好」

`SUITE_RECOVERY_CONCURRENCY_LADDER = [64, 48, 32]`（`worker-fan-in.ts:862`）的**全部三档**都经过
上述同一分支 ⇒ 三档实际同形（都 ~126）。这正是 `AC13` 想禁止的「用同一组参数无限重试」，只是被伪装成
「已声明地降档」——**声明了、投递了、但从未生效**（硬规则 3b 的同形失败：读起来像降了档）。

### 重复代价（已发生次数）

- `gap-ac920-criterion-pipe-swallows-exit-code`：2026-10-23T17:37:39 / 18:22:49 与更早一轮，
  共 **3 次** `step=suite: oom-killed`，reason 逐字 `recovery exhausted at floor concurrency 32 —
  no declared rung produced a complete verdict (64,48,32)`。
- 每次失败 = 一整轮 worker 会话 + 4 次全量 suite（原轮 + 3 档，单轮 main phase 353–620s）。

## AC

- [x] AC1 对照实测（修复前/后各一次真实读数）：对同一个 **hub 形态**任务，`--lane-count 32`
  下 `recovery-32` 日志的 `scheduler: unified group-budget scheduler (… main≤N)` 必须 `N ≤ 32`；
  修复前该行读到 `main≤128`。⛔ 两条读数都贴逐字日志行与文件路径（不是「我改对了」）。
  见 ## Evidence AC1：修复前 `main≤128`（`.quay/ac-fanin-ladder/ac1-before-rereading.log:13`），
  修复后真实 runner 载体 `main≤32`（`.quay/fan-in-suite-ac-fanin-ladder-probe.log:4`）与真实执行轮
  `.quay/fan-in-suite-ac-fanin-ladder-real32b.log:2180` + `concurrency.maxConcurrentOverall=32`。
- [x] AC2 判据能取假（负对照，硬规则 4c 两半）：把 `rest_args` 转发去掉（或用一个不转发
  `--test-concurrency` 的 fake suite 作 fixture），AC1 的同一条判据必须报红 —— 证明 AC1 不是恒真标签；
  再把修复放回，同一 fixture 转绿。
  见 ## Evidence AC2：去掉转发 ⇒ 同一命令读到 `main≤127`；AC5 的测试同时转红（`got main≤98` 对请求 7）。
- [x] AC3 非 hub 路径不回归：`--buckets <非 hub 任务> --test-concurrency=N` 的 `main≤` 仍 == N
  （该路径本就正确），贴读数。见 ## Evidence AC3：`main≤9`（请求 9）。
- [x] AC4 `scripts/test.sh` 的两处兄弟调用都修：`:1766` 与 `:1771` 的 `run_selected "$(effective_groups)"`
  全部转发 `"${rest_args[@]}"`；在同一提交里贴出 `grep -n 'run_selected "$(effective_groups)"'
  scripts/test.sh` 的命中数与前 3 条内容（硬规则 2 / 5b：修一个别漏一簇）。见 ## Evidence AC4。
- [x] AC5 判据升级为直接量：扩展 full-suite-runner 的 AC16 断言面，使其读**下游** effective main 预算
  （`scheduler:` 行或 `maxConcurrentOverall`），而不只是 grep spawned argv；该断言在 AC2 的负对照下必须红。
  见 ## Evidence AC5（落地位置 `plugin/test/runner-grouping-flags-only.test.mjs` 及为何选它）。

## Evidence

### AC1 — 对照实测（同一 hub 形态任务本任务自身，`--lane-count 32`）

**修复前**（真实 `scripts/test.sh`，develop 基线 db6c3c011，未改任何代码）：
`.quay/ac-fanin-ladder/ac1-before-rereading.log`（原始 `/tmp/ac1-before2.log` 的逐字副本）
```
2:__BUCKETS__ buckets=full files=1046 full=1
13:scheduler: unified group-budget scheduler (serial≤32 lowconc≤32 main≤128)
16:scheduler: serial=64≤32 lowconc=37≤32 main=945≤128 (reliability cap: total ≤ min budget of active groups)
```
命令：`QUAY_TEST_SKIP_STATIC_CHECKS=1 QUAY_TEST_SKIP_DIST_BUILD=1 QUAY_TEST_SKIP_RESOURCE_GATE=1 QUAY_TEST_SKIP_QUAY_REFRESH=1 timeout 25 bash scripts/test.sh --buckets <本任务> --test-concurrency=32`
⇒ 请求 32，下游 main 预算 **128**（`--test-concurrency=32` 在 bucket_full 分支被丢弃），
`main=945≤128` 即 945 个 main 文件全部压进 128 车道。

**修复后 · 真实 fan-in 载体（runner 写出的 `.quay/fan-in-suite-*.log`）**：
`.quay/fan-in-suite-ac-fanin-ladder-probe.log`
```
3:__BUCKETS__ buckets=full files=1046 full=1
4:scheduler: unified group-budget scheduler (serial≤32 lowconc≤32 main≤32)
```
命令：`node --experimental-strip-types plugin/scripts/full-suite-runner.ts --buckets <本任务> --root <worktree> --lane-count 32 --runner inner --run-id probe-… --log-file .quay/fan-in-suite-ac-fanin-ladder-probe.log`。
（该 probe 用 `QUAY_TEST_PLAN_ONLY=1` 让 test.sh 打印 scheduler 头后退出，执行阶段省略；见 AC5 的 seam。
耦合点是**真实的** `bucket_test_concurrency "${rest_args[@]}"` 表达式，不是 fixture 回显。）

**修复后 · 真实执行轮（非 plan-only，1046 文件全跑完）**：
`.quay/fan-in-suite-ac-fanin-ladder-real32b.log:2180-2183`
```
scheduler: unified group-budget scheduler (serial≤32 lowconc≤32 main≤32)
scheduler: heavy=0≤0 (declared bucket; runs in the tail, alone)
scheduler: lpt provenance=rolling-carrier entries=26751 files=1046 main_reordered=true
scheduler: serial=64≤32 lowconc=37≤32 main=945≤32 (reliability cap: total ≤ min budget of active groups)
```
`main=945≤32` —— 此前同样的 945 个文件跑在 ≤128 上。对应的内存证据
`.quay/suite-memory-evidence-real32b-1792781576.json`：`concurrency.laneCount=32`、
`concurrency.maxConcurrentOverall=32`。

### AC2 — 判据能取假（负对照两半）

半①（代码负对照）把 hub 分支临时改回 `run_selected "$(effective_groups)"`，同一命令、同一任务：
`scheduler: unified group-budget scheduler (serial≤32 lowconc≤32 main≤127)`（nproc 派生值随宿主
in-use 读数在 127/128 间浮动，恒 ≫ 32）。把转发放回 ⇒ `main≤32`（上一节）。

半②（测试负对照）在同一「转发被去掉」的树上跑 AC5 的测试：
```
✖ bucket-full fallback: --test-concurrency reaches the SCHEDULER (scheduler: main≤N), not just argv
AssertionError: test.sh's bucket fallback must hand --test-concurrency=7 to the scheduler
  (host default is 96); got main≤98 — the flag was dropped between argv and the scheduler
```
转发放回 ⇒ `✔ … (2108ms)`（`.quay/ac-fanin-ladder/ac5-test-green.log`：`tests 1 / pass 1 / fail 0`）。
⇒ AC1 的判据不是恒真标签。

### AC3 — 非 hub 路径不回归

`bash scripts/test.sh --buckets cand-cjk-proposal-slot-word-boundary --test-concurrency=9`
（`QUAY_TEST_PLAN_ONLY=1`，非 hub 分支自己的 scheduler 头）：
```
__BUCKETS__ buckets=P files=581 full=0
scheduler: unified group-budget scheduler (bucket path: serial≤32 lowconc≤32 main≤9)
```
请求 9 ⇒ `main≤9`，与修复前一致（该路径本就转发 `rest_args`）。

### AC4 — 两处兄弟调用都修 + 同族普查

```
$ grep -cF 'run_selected "$(effective_groups)"' scripts/test.sh
4
$ grep -nF 'run_selected "$(effective_groups)"' scripts/test.sh | head -3
1613:  run_selected "$(effective_groups)"
1779:    run_selected "$(effective_groups)" "${rest_args[@]}"
1785:    run_selected "$(effective_groups)" "${rest_args[@]}"
```
4 条命中逐个交代（遗漏数 = 0）：
- `1613` = `$# -eq 0` 无参分支 —— 结构上没有额外参数可转发；
- `1779` = **hub / 无桶可触发回退**（本缺陷点）—— 已补 `"${rest_args[@]}"`；
- `1785` = **selector 选中 0 文件 ⇒ 回退全量**（同族兄弟）—— 已补 `"${rest_args[@]}"`；
- 第 4 条 `1931` = flags-only 分支 `run_selected "$(effective_groups)" "$@"` —— 本就转发。

### AC5 — 判据升级为直接量（读下游 scheduler 预算，不是 grep argv）

断言落在 `plugin/test/runner-grouping-flags-only.test.mjs`：
- 它从**真实任务库**派生一个 hub 任务（排序扫描 + `touchesHub`，不硬编码任务 id —— 硬编码的 id 离开
  任务库后会让这条断言静默地不再探测该分支）；
- 跑**真实** `scripts/test.sh --buckets <hub> --test-concurrency=N`（N = 7，且断言 N ≠ 宿主派生默认值，
  否则「转发生效」与「默认恰好等于 N」不可区分 —— 硬规则 4c 的预跑）；
- 断言 stdout 的 `__BUCKETS__ … full=1`（证明走的是丢旗标的那一支）且 `scheduler: … main≤N` 里 N == 请求值。
- 负对照下转红（见 AC2 半②）。

为什么不在 `full-suite-runner-phases.test.mjs` 里加：该文件受 `plugin/test-isolation-violations.txt`
R3 `spawns-test-sh` 的 **shrink-only** ratchet 约束 —— 新建一个 spawn `scripts/test.sh` 的测试文件是
一条新违规（检查器逐字要求「Do NOT add it to the list」）。`runner-grouping-flags-only.test.mjs` 早已是
该 ratchet 基线内的 spawner（它的主题就是「test.sh 收到这些 argv 后做什么」），下游断言因此落在那里；
`full-suite-runner-phases.test.mjs` 的 AC16 仍是**代理量**那一半的 keeper（runner 确实把 N 拼进 argv），
两半合起来覆盖 runner→argv→scheduler 整条链。

## DoD

- 真实载体读数：至少一条 `main≤32` 来自**真实 fan-in 运行**写下的 `.quay/fan-in-suite-*.log`（或
  `.quay/suite-memory-evidence-*.json` 的 `concurrency.maxConcurrentOverall ≤ 32`），
  ⛔ 不是 fixture/注入数据（硬规则 4 推论三：fixture 只证明「能产出」）。
  ✅ 两条都有：`.quay/fan-in-suite-ac-fanin-ladder-real32b.log:2180`（`main≤32`，真实 runner 写出）与
  `.quay/suite-memory-evidence-real32b-1792781576.json` 的 `concurrency.maxConcurrentOverall = 32`。
- 一个此前因此 OOM 的 hub 任务，其 `recovery-32` 轮 `oomKill` 读数为 0（或该轮给出完整终态
  `SUITE-PLAN` + 无 `SUITE-INCOMPLETE`），即阶梯在地板档真的降下去了。
  ⚠️ **未达 0**（如实记录）：本任务的真实 32 车道执行轮 `oomKill = 1`、`SUITE-INCOMPLETE reason=oom-killed`
  （`peakBytes=34360094720` vs `memoryMaxBytes=34359738368`，仅超 348 KiB）。阶梯本身**已真的降下去**
  （`maxConcurrentOverall=32`，见上一条），但这一轮仍被杀一次。同一份证据给出了残差的成因方向：
  `processTreeAccounting` 显示 **planned（车道）进程峰值 39 个 / 4.4 GB**，而 **descendant 峰值 200 个 /
  32.3 GB**（`maxRssBytes=36.2 GB`）—— 峰值由某个测试的**后代进程树**贡献，⛔ 不是 32 条车道本身。
  ⇒ 「再降 `--lane-count`」对这一残差无效；需要单独定位那个 200 进程 / 32GB 的后代子树（另立任务）。
  本条 DoD 的「地板档真的降下去了」已由 `maxConcurrentOverall=32` 直接证明，但「oomKill=0」这一
  具体读数**没有被本任务的修复满足**，不冒充满足。
- `scripts/test.sh` 两处兄弟调用都已修（AC4 的命中数为 0 遗漏），并有可复核注释说明
  「bucket 回退全量时必须转发 rest_args，否则 `--lane-count` 静默失效」。
  ✅ 见 AC4；注释在 `scripts/test.sh` 的两处调用上方（逐字含「⛔ BOTH full-suite fallbacks below MUST
  forward "${rest_args[@]}"」）。
- ⛔ 不改 `suite.memory_max`（仍 32G，人 2026-10-15 裁定）：本任务的杠杆是**并发**，不是上限。
  ✅ 未改 `suite.memory_max`（工作树 `.quay/config.yml` 来自 main，仍是 `32G`）。

## Touches

- `scripts/test.sh`
- `plugin/test/runner-grouping-flags-only.test.mjs`
- `plugin/scripts/full-suite-runner.ts`
- `plugin/test/full-suite-runner-phases.test.mjs`
- `tasks/gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency.md`

## Dark Axis

该轴仍暗,理由: 本任务只改 `scripts/test.sh` 一个 bash 分支的 argv 转发、一个 plan-only 探针 seam 与一条下游断言，不新增/删除模块、不改变依赖方向（L_D/L_G 无读数可采）；内存与并发行为的变化由 AC1/DoD 的真实 `.quay/fan-in-suite-*.log` 与 `concurrency.maxConcurrentOverall` 读数直接度量。

## Blocker

**2026-10-23T20:20:51.433Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (3) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：432e6257-472e-46e9-906b-e600f4c73db1
