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

### Landing blocker — 48 车道恢复档暴露的「新回归」：逐调用重探 CLI 的瞬态（2026-10-24）

**阶梯本身已生效**：48 车道恢复轮的完整判词
（`.quay/fan-in-suite-gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency~wk-prod-anchor~recovery-48-1792790045972-28885c.log`）：
```
2218:scheduler: unified group-budget scheduler (serial≤32 lowconc≤32 main≤48)
24265:[full-suite-runner] SUITE-PLAN planned=1046 terminal=1046 missing=0 source=probe:test.sh --list-files plan_error=null completeness=complete oomKill=0 telemetry=ok laneCount=48
```
⇒ `main≤48`、`oomKill=0`、`completeness=complete`（1046/1046，missing=0）。这是第一个**没被 OOM 杀死**的
更低并发档，直接满足 DoD 的第二条（「给出完整终态 SUITE-PLAN + 无 SUITE-INCOMPLETE」）。
该轮仍 `fail 7`：6 个文件在原轮（128）就已同样红（`quay-init` / `task-granularity-advice` /
`full-suite-runner-cgroup` / `capability-catalog`（2 条）/ `needs-human-parking-recheck`），
唯一的**新回归**（AC13(b) 的定义：原轮跑过且通过、更低并发下变红）是
`plugin/test/ownership-active-slice-adapter.test.mjs`。

**成因（不是并发本身）**：该测试每次 `computeSliceDelta()` 都重新 `resolveSliceDelta()` —— 后者是一个
`spawnSync("node", [cli, "slice-delta", "--help"], { timeout: 30_000 })` 的探针。suite 负载下探针超时 ⇒
`available:false` ⇒ `computeSliceDelta` 返回 `status:"unavailable"`（**该分支不带 `delta` 键**）。而测试的
能力闸 `STAYS_CAPABLE` 只排除了 `not-evaluated`，把 `unavailable` 当成「有能力」⇒ 断言读
`r.delta.removed_edges` 时抛 `TypeError`。逐字失败：
```
test at plugin/test/ownership-active-slice-adapter.test.mjs:109:1
✖ AC1: the REAL candidate ① … (34564.752384ms)
  TypeError: Cannot read properties of undefined (reading 'removed_edges')
```
耗时吻合：AC1 = 34.5s，AC2 = 3.0s ⇒ 差值 ≈ 30s 的探针超时；单独跑该文件 14/14 全绿（28.4s）。

**对照（判据能取假，硬规则 4c）**：写一个 wrapper CLI（`.quay/ac-slice-probe-control/archguard-probe-fail-on-2nd.mjs`，
经 `ARCHGUARD_CLI` 注入，除「第 2 次 `slice-delta --help` 探针失败」外全部转发真 CLI）：
- **旧文件**（`git show HEAD:` 副本）：探针 **7** 次、**5 条失败**，逐字复现上面的
  `TypeError: Cannot read properties of undefined (reading 'removed_edges')`；
- **修复后**：探针 **1** 次、**14/14 绿**（同一个失败注入下）。
⇒ 注入不变时，只有「是否逐调用重探」决定结果：判据不是恒真标签。

**修法（只改测试文件，⛔ 不动生产模块 / 不动 `docs/analysis/ownership-active-slice-adapter.mjs`）**：
`computeSliceDelta` 本就提供 `deps.sliceDelta` 注入位，测试在模块加载时也已解析过一次（`INSTALLED`）；
把它传入即可 —— 同一进程内 CLI 面不会变，重复探针不产生任何读数、只产生瞬态。
两处调用点都补（硬规则 5b：`replayDeps` 与其同族兄弟 `minimalRun`，后者在负对照里正是第二个探针的来源）；
`STAYS_CAPABLE` 同时把 `unavailable` 明确排除（硬规则 3b：未取到读数不得与「有能力」同形）。

## DoD

- 真实载体读数：至少一条 `main≤32` 来自**真实 fan-in 运行**写下的 `.quay/fan-in-suite-*.log`（或
  `.quay/suite-memory-evidence-*.json` 的 `concurrency.maxConcurrentOverall ≤ 32`），
  ⛔ 不是 fixture/注入数据（硬规则 4 推论三：fixture 只证明「能产出」）。
  ✅ 两条都有：`.quay/fan-in-suite-ac-fanin-ladder-real32b.log:2180`（`main≤32`，真实 runner 写出）与
  `.quay/suite-memory-evidence-real32b-1792781576.json` 的 `concurrency.maxConcurrentOverall = 32`。
- 一个此前因此 OOM 的 hub 任务，其 `recovery-32` 轮 `oomKill` 读数为 0（或该轮给出完整终态
  `SUITE-PLAN` + 无 `SUITE-INCOMPLETE`），即阶梯在地板档真的降下去了。
  ✅ **已被 recovery-48 轮真实满足**（`SUITE-PLAN … planned=1046 terminal=1046 missing=0
  completeness=complete oomKill=0 laneCount=48`，见 ## Evidence 的 Landing blocker 节）。
  ⚠️ 此前那次 `recovery-32` 轮曾 **未达 0**（如实记录）：`oomKill = 1`、`SUITE-INCOMPLETE reason=oom-killed`
  （`peakBytes=34360094720` vs `memoryMaxBytes=34359738368`，仅超 348 KiB）。阶梯本身**已真的降下去**
  （`maxConcurrentOverall=32`，见上一条），但那一轮仍被杀一次。同一份证据给出了残差的成因方向：
  `processTreeAccounting` 显示 **planned（车道）进程峰值 39 个 / 4.4 GB**，而 **descendant 峰值 200 个 /
  32.3 GB**（`maxRssBytes=36.2 GB`）—— 峰值由某个测试的**后代进程树**贡献，⛔ 不是 32 条车道本身。
  ⇒ 「再降 `--lane-count`」对这一残差无效；需要单独定位那个 200 进程 / 32GB 的后代子树（另立任务）。
- `scripts/test.sh` 两处兄弟调用都已修（AC4 的命中数为 0 遗漏），并有可复核注释说明
  「bucket 回退全量时必须转发 rest_args，否则 `--lane-count` 静默失效」。
  ✅ 见 AC4；注释在 `scripts/test.sh` 的两处调用上方（逐字含「⛔ BOTH full-suite fallbacks below MUST
  forward "${rest_args[@]}"」）。
- ⛔ 不改 `suite.memory_max`（仍 32G，人 2026-10-15 裁定）：本任务的杠杆是**并发**，不是上限。
  ✅ 未改 `suite.memory_max`（工作树 `.quay/config.yml` 来自 main，仍是 `32G`）。

## Touches

- `scripts/test.sh`
- `plugin/test/runner-grouping-flags-only.test.mjs`
- `plugin/test/ownership-active-slice-adapter.test.mjs`
- `plugin/scripts/full-suite-runner.ts`
- `plugin/test/full-suite-runner-phases.test.mjs`
- `tasks/gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency.md`

## Dark Axis

该轴仍暗,理由: 本任务只改 `scripts/test.sh` 一个 bash 分支的 argv 转发、一个 plan-only 探针 seam 与一条下游断言，不新增/删除模块、不改变依赖方向（L_D/L_G 无读数可采）；内存与并发行为的变化由 AC1/DoD 的真实 `.quay/fan-in-suite-*.log` 与 `concurrency.maxConcurrentOverall` 读数直接度量。

## Blocker

**2026-10-23T22:35:17.642Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (2) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：5f8eee7f-1186-4ffc-8337-bc7939637ed6

## Round 2026-10-24 — 复位轮实测与残差定位（本轮未改代码）

**本轮做了什么**：把 develop 合入工作树（4 个提交，全部是 task 状态记录 / 无关文档），逐条复核 AC，
跑 scoped 门（`tests 75 / pass 75 / fail 0`）与 anti-drift（2 个实际改动文件，全在 `## Touches` 内）。
**没有新增代码改动** —— 修复本身在前几轮已落地且仍然成立（见下）。落地仍被 `oomKill ≥ 1` 挡住。

### AC 复核（本轮，合并后的树上）

- **AC4**：`grep -nF 'run_selected "$(effective_groups)"' scripts/test.sh` ⇒ 4 条命中；
  `1779` / `1785` 两条已转发 `"${rest_args[@]}"`（hub 回退 + selector 空集回退），
  `1613` 是 `$# -eq 0` 无参分支（结构上无参数可转发），`1931` 是 flags-only 分支且本就转发 `"$@"`。
  **遗漏数 = 0**；`scripts/test.sh:1772` 的注释逐字含「⛔ BOTH full-suite fallbacks below MUST forward」。
- **AC5**：`node --test plugin/test/runner-grouping-flags-only.test.mjs` ⇒
  `✔ bucket-full fallback: --test-concurrency reaches the SCHEDULER (scheduler: main≤N), not just argv`。
- **AC1–AC3**：`## Evidence` 里的真实载体读数（`.quay/fan-in-suite-*.log` 的 `main≤32`、
  `concurrency.maxConcurrentOverall=32`）本轮未触碰，仍成立。

### 残差实测：`# fail 7` 不是本任务引入；唯一拦住落地的是 `oomKill ≥ 1`

同一 runId 的四轮（同一棵受测树，`.quay/verification-round.jsonl` round 3037–3040）：

| 轮次 | laneCount | fail | oomKill | SUITE-INCOMPLETE |
|---|---|---|---|---|
| 3037（原轮） | 128 | 18 | 3 | oom-killed |
| 3038（recovery-64） | 64 | 9 | 1 | oom-killed |
| 3039（recovery-48） | 48 | 19 | 2 | oom-killed |
| 3040（recovery-32） | 32 | 7 | 1 | oom-killed |

四轮都是 `planned=1046 terminal=1046 missing=0` —— **没有任何计划文件缺终态**，被 OOM 杀的是后代进程。

- 第 3040 轮（32 车道）内存证据 `.quay/suite-memory-evidence-mfi-…-1792782862395-781417.json`：
  `peakBytes=34,359,820,288` vs `memoryMaxBytes=34,359,738,368` —— 仅超 **81,920 字节（80 KiB）**；
  `concurrency.laneCount=32`、`maxConcurrentOverall=32`（**阶梯确实降到位了**）。
- `processTreeAccounting`：`plannedMax=40 / 4.5 GB`，`descendantMax=204 / 30.2 GB`，`maxProcesses=254`。
  ⇒ 峰值由**每条车道派生的后代进程**承担（≈1 GB/车道），不是某一条失控子树。
- 用第 3040 轮的 `perFile[]` 区间独立重算：**最大重叠并发 = 32**（正好等于请求车道数）。重叠的 32 个文件
  里含 `full-suite-runner-phases`、多份 `worker-fan-in-*` / `worker-driver-fan-in-*`、`goal-driver-*`
  等**大量派生子进程**的测试；单文件 `memPeakKb` 峰值 950,648 KB。

### 对 `## DoD` 里「再降 --lane-count 对这一残差无效」的更正

该句当时是**未经对照的推断**（硬规则 4 推论四）。本轮读数给出反向证据：峰值随
**并发车道数 × 每车道后代进程**缩放（32 车道 ⇒ 后代 30.2 GB；最大重叠恰为 32）。
⇒ **更低的恢复档（24 / 16）是合理的下一杠杆**；「必须单独定位某棵 200 进程子树」不是唯一解释。
（原 DoD 段落保留在上方不删，此处为更正，不是抹除。）

### 为什么本轮修不掉它（结构性，不是遗漏）

fan-in 的恢复阶梯与 runner 都从**主检出**加载：
`worker-fan-in.ts` 的 `resolveMechanicalSuiteCommand` 用 `kernelSiblingArgv("full-suite-runner.ts")`
（kernel 安装位置 = 主检出），只有 `--root <worktree>` 让 `scripts/test.sh` 取自本分支工作树。
⇒ 在本分支修改 `plugin/scripts/worker-fan-in.ts`（阶梯）或 `full-suite-runner.ts`（内存策略）
**在本次落地之前不会生效**（循环依赖）；本分支唯一能改变本次 fan-in 结果的载体是 `scripts/test.sh`，
而它的修复已验证成立。

### 给下一层（需在主检出落地，或由人裁定）

1. 扩展 `SUITE_RECOVERY_CONCURRENCY_LADDER`（`plugin/scripts/worker-fan-in.ts`，现为 `[64,48,32]`）
   增加 24 / 16 两档；或按上一轮 `peakBytes / maxConcurrentOverall` 推导下一档（**先用读数再设数值**，
   硬规则 4）。梯子仍须声明式且严格降序（AC13 不变）。
2. 第 3040 轮的 6 个红文件是 **develop 侧既存红**：3040 的红集合 ⊂ 3037 的红集合，**新增回归 = ∅**。
   逐条（本轮在合并后的树上单独复跑，均可复现）：
   `capability-catalog`（`release-model-check.ts` 的 question = "2026-10-23"、cadence 非五枚举值）、
   `needs-human-parking-recheck`（该树真实板 needs-human 计数 = 0 ⇒ 断言 "carries needs-human tasks" 失败）、
   `task-granularity-advice`（AC6 生产分箱「至少一箱欠采样」）、
   以及 `quay-init` / `full-suite-runner-cgroup` / `release-cut` 三个 @load-sensitive 文件（负载相关，
   本轮单独复跑时 `quay-init` 与 `release-cut` 仍红）。
   既存红等价（A/B）本可豁免它们，但该通道要求本轮先成为 `complete-red` ⇒ 仍以第 1 条为前提。
