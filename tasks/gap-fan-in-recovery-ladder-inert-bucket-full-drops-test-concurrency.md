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
3. `scripts/test.sh:1764-1767`（bucket 分支）：
   ```
   if [ "${bucket_full}" = "1" ]; then
     # Hub touch / no-bucket-triggerable ⇒ the full default suite (run_selected exits).
     run_selected "$(effective_groups)"
   fi
   ```
   ⛔ 调用 **没有转发 `"${rest_args[@]}"`** ⇒ `--test-concurrency=32` 在这一支被静默丢弃。
   `run_selected` 于是走 `default_test_concurrency()`（nproc 派生 128）⇒ `main≤128`。
4. 对照（同一文件、非 hub 分支，`:1815-1824` 与 `:1822`）：
   `--main-concurrency "$(bucket_test_concurrency "${rest_args[@]}")"` ⇒ 非 hub 路径**是**尊重该旗标的。
   同族第二处：`:1770-1771`（selector 选中 0 文件 ⇒ 回退全量）同样不转发 `rest_args`。

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

- [ ] AC1 对照实测（修复前/后各一次真实读数）：对同一个 **hub 形态**任务，`--lane-count 32`
  下 `recovery-32` 日志的 `scheduler: unified group-budget scheduler (… main≤N)` 必须 `N ≤ 32`；
  修复前该行读到 `main≤128`。⛔ 两条读数都贴逐字日志行与文件路径（不是「我改对了」）。
- [ ] AC2 判据能取假（负对照，硬规则 4c 两半）：把 `rest_args` 转发去掉（或用一个不转发
  `--test-concurrency` 的 fake suite 作 fixture），AC1 的同一条判据必须报红 —— 证明 AC1 不是恒真标签；
  再把修复放回，同一 fixture 转绿。
- [ ] AC3 非 hub 路径不回归：`--buckets <非 hub 任务> --test-concurrency=N` 的 `main≤` 仍 == N
  （该路径本就正确），贴读数。
- [ ] AC4 `scripts/test.sh` 的两处兄弟调用都修：`:1766` 与 `:1771` 的 `run_selected "$(effective_groups)"`
  全部转发 `"${rest_args[@]}"`；在同一提交里贴出 `grep -n 'run_selected "$(effective_groups)"'
  scripts/test.sh` 的命中数与前 3 条内容（硬规则 2 / 5b：修一个别漏一簇）。
- [ ] AC5 判据升级为直接量：扩展 full-suite-runner 的 AC16 断言面，使其读**下游** effective main 预算
  （`scheduler:` 行或 `maxConcurrentOverall`），而不只是 grep spawned argv；该断言在 AC2 的负对照下必须红。

## DoD

- 真实载体读数：至少一条 `main≤32` 来自**真实 fan-in 运行**写下的 `.quay/fan-in-suite-*.log`（或
  `.quay/suite-memory-evidence-*.json` 的 `concurrency.maxConcurrentOverall ≤ 32`），
  ⛔ 不是 fixture/注入数据（硬规则 4 推论三：fixture 只证明「能产出」）。
- 一个此前因此 OOM 的 hub 任务，其 `recovery-32` 轮 `oomKill` 读数为 0（或该轮给出完整终态
  `SUITE-PLAN` + 无 `SUITE-INCOMPLETE`），即阶梯在地板档真的降下去了。
- `scripts/test.sh` 两处兄弟调用都已修（AC4 的命中数为 0 遗漏），并有可复核注释说明
  「bucket 回退全量时必须转发 rest_args，否则 `--lane-count` 静默失效」。
- ⛔ 不改 `suite.memory_max`（仍 32G，人 2026-10-15 裁定）：本任务的杠杆是**并发**，不是上限。

## Touches

- `scripts/test.sh`
- `plugin/scripts/full-suite-runner.ts`
- `plugin/test/full-suite-runner-phases.test.mjs`
- `tasks/gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency.md`

## Dark Axis

该轴仍暗,理由: 本任务只改一个 bash 分支的 argv 转发与一条测试断言，不新增/删除模块、不改变依赖方向（L_D/L_G 无读数可采）；内存行为的变化由 AC1 的真实读数直接度量。