---
id: gap-full-suite-runner-concurrency-default-and-gate
title: full-suite-runner laneCount default hardcoded 8 (not nproc-derived) +
  --test-concurrency splice is append-not-replace + resource-gate never called —
  ABORT#5 (=8 =8, PSI 88, WAIT-start) same crash class as ABORT#1/3/4; fix all
  three in ONE change
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---

> **内层 fan-in reland（2026-08-05 12:2xZ）：AC5 竞态已修，任务 reland 完成。** 外层裁定采纳
> （SIGTERM 竞态是真问题）。两处修复（commit `f35459c7`）：
> ① **runner 保留 SIGTERM/SIGINT 监听器**（`runDone` guard 已让晚期信号 no-op——关闭监听器移除后
>    的无处理窗口，该窗口曾让 runner 以 state=running 死亡）；
> ② **AC5 测试改为由 fake suite 内部向 runner 发 SIGTERM**（沿祖先链找到最近 node 进程=runner，
>    在 handler 注册后信号必达）——消除外部 `child.kill` 在 node --test harness 下的投递竞态。
> **实测**：AC5 隔离 10/10 稳定（此前 ~30-70% 失败）；完整 scoped `--for-task --allow-thin`
> **29/29 EXIT=0**。merge 已 reland。任务恢复 ready，closure（翻 done）归外层异步。
**type:** execution

## Proposal

**ABORT #5（2026-08-05 10:2xZ，管理者紧急报警 + 外层核实）**：外层启动 full-suite-runner 验证套件，
实测进程是 `node --test --test-concurrency=8 --test-concurrency=8`（**两个 8**）——外层显式传 8，
test.sh 又拼接自己的默认 8。有效并发 8（nproc=4，AC5 派生默认应为 1）。PSI cpu 88、resource-gate
WAIT、load 15.77，**正是 ABORT #1/#3/#4 与两次整机崩溃的同一形态**。已立即中止。

**根因（管理者 09:03Z 预警的兑现 + 延伸）**：
1. `full-suite-runner.ts` 的 laneCount 默认硬编码 8（第 32 行注释「default: 8 (canonical full-suite
   concurrency)」），**没读 nproc 派生**——本机 nproc=4，AC5 的派生默认 `max(1,floor(nproc/2.1))=1`
   才对。AC16 只修了「显式传参不生效」，没修「默认值本身是 8」。
2. **拼接是 append 不是 replace**：`--test-concurrency=<N>` 追加到命令尾，与命令里已有的
   `--test-concurrency=*` 并存。node 取最后一个（AC17 记录过），但两个值都合法时无判据发现退化。
3. **resource-gate 从未被调用**：`full-suite-runner.ts` 里 resource-gate 出现 0 次（管理者 07:5x 已报），
   gate 说 WAIT 也没人问它——本轮就是在 WAIT 状态下开跑的。

**reason 轴缺口（管理者 07:29Z 首报 + 10:2xZ 第二次实证，同一次事故的另一半）**：
4. **aborted ≠ failed**：suite-state 的 `state` 是三值枚举（running/green/red），aborted 只通过
   `reason` 字段表达。但 **inner 的停止条件只看 `state` 不看 `reason`**——`state: red`（无论
   reason=aborted 或 failed）都触发 stop-dispatch。而 aborted 意味着「套件没跑完、**无任何正确性
   结论**」（durationMs=null，连验证都没发生）。把 aborted 当 failed 处理 = 用一个中止事件挡住
   全线派发。**10:2xZ 第二次实证**：load 0.92、PSI 3、gate GO、机器完全空闲，12 个互不相交任务
   全被 aborted-red 挡住，且不会自解除（re-green 需一轮成功套件，套件因 laneCount 缺陷跑不完
   ⇒ 闭环）。外层已临时止血（state 改 green + reason=aborted-no-failure），但**机制性修复**
   是本条：stop-dispatch 只应对 `failed` 生效，`aborted` 不应触发停派（或应区分处置）。

**管理者的建议（四条应同一次改动做完，只做任一条都会留缝——今晚已证明两次）**：
1. runner 的 laneCount 默认值应**读 nproc 派生**（同 test.sh 的 AC5 派生），不硬编码 8
2. 拼接应是**替换**而非追加：先剥掉命令里已有的 `--test-concurrency=*` 再拼
3. 启动前过一次 resource-gate（WAIT 则不开跑，等下一 tick）
4. **reason 轴机械化**：inner 的停止条件区分 failed vs aborted——`state: red` 且 `reason: failed`
   才 stop-dispatch；`reason: aborted`（套件未完成、无正确性结论）**不触发停派**，外层按其
   应有语义处置（记录 + 重跑）。

### 选定机制

1. runner 默认 laneCount = `max(1, floor(nproc / 2.1))`（同 test.sh AC5 派生），可被 `--lane-count` 覆盖
2. splice 改为 replace：先正则剥命令里已有 `--test-concurrency=*`（含 `=` 与空格两种拼写），再拼新值
3. 起跑前调 `bash plugin/scripts/resource-gate.sh --for full-suite`，非 0 = WAIT → 不启动，等下一 tick
4. **inner 停止条件（fast-mode-loop-tick.md 步骤 3 + inner-blocked-signal.ts 或 suite-state 消费者）
   区分 failed vs aborted**——aborted 不触发 stop-dispatch；外层按 aborted 语义处置（记录 + 等重跑）
5. 四条同一次改动 + 测试覆盖（既有 full-suite-runner.test.mjs 扩展 + inner 停止条件消费者测试）

## Acceptance Criteria

- [x] AC1: runner 默认 laneCount 读 nproc 派生（nproc=4 → 1），无 `--lane-count` 时生效并发 = 1
      — `defaultLaneCount()` = `max(1, floor(nproc/2.1))`（同 test.sh AC5 派生；`RESOURCE_GATE_NPROC`
      seam）。测试 `AC1 — default laneCount is NPROC-derived`：`RESOURCE_GATE_NPROC=4` ⇒
      `state.laneCount = 1` 且 spawn 命令 = `--test-concurrency=1`（唯一）。
- [x] AC2: splice 是 replace——命令里已有 `--test-concurrency=8`（`=` 与空格拼写）时被替换为派生值，进程只出现一个 `--test-concurrency=<派生>`
      — `stripConcurrencyFlags()` 剥 `=` 与空格两种拼写；`spliceConcurrency()` 只拼一个派生值。
      测试 `AC2 — splice is REPLACE`：命令含 `--test-concurrency=8` **与** `--test-concurrency 8`
      均被替换为唯一的 `--test-concurrency=1`。**配套 test.sh 改动**（`has_explicit_concurrency`）：
      显式 flag 存在时 test.sh 不再拼自己的默认——真实 node 进程也只出现一个
      `--test-concurrency`（ABORT #5 的 `=8 =8` 双拼杜绝）。
- [x] AC3: 起跑前过 resource-gate，WAIT 时不启动（state 保持 running/green 不动）
      — `checkResourceGate()` 在写 `state=running` **之前**跑 `resource-gate.sh --for full-suite`；
      WAIT ⇒ 退出非 0、state 文件字节不动。测试 `AC3 — resource gate WAIT`：预先写的 green 状态在
      WAIT 下原样保留、suite 未被 spawn；`AC3 — GO`：GO 下正常跑绿。
- [x] AC4: `full-suite-runner.test.mjs` 扩展覆盖三行为（负控制：显式 8 + 已有 `=8` → 替换为派生值）
      — 新增 AC1/AC2/AC3/AC4 测试（见上）；AC4 负控制 `explicit --lane-count 8 + command has =8`
      ⇒ 唯一 `--test-concurrency=8`（非两个 8）。
- [x] AC5: **inner 停止条件区分 failed vs aborted**——`state: red` + `reason: aborted`（或等价语义）
      不触发 stop-dispatch；只有 `reason: failed`（或检测到真实失败行）才停。测试覆盖两种形态
      （负控制：aborted 下 inner 继续派发；failed 下 inner 停止）
      — `suite-state-trigger.ts` 新增 `shouldStopDispatch()`（`red && reason !== aborted`），
      `runOnce().stopSignal` / `SUITE-RED.stopSignal` 都走它；runner 写 red 时带 `reason`
      （`failed`/`aborted`），SIGTERM/SIGINT 处理写 `red+aborted`。测试：`shouldStopDispatch`
      单元（aborted=false, failed/missing=true）+ `runOnce` 两形态 + runner 信号杀 ⇒ red+aborted
      ⇒ `stopSignal=false`。文档（fast-mode-loop-tick 步骤 3 / orchestrator-loop-tick 红窗）同步。
- [x] AC6: 与 `gap-red-window-dispatch-stop-should-be-shared-gate-conditional` 交叉标注（stop-dispatch
      语义同一族）— 本任务体提到该任务；该任务体加回链（见 Dispatch review / Touches）；
      测试 `AC6 — cross-annotation` 双向断言。

## Definition of Done

- [ ] AC1–AC6 全部勾上
- [ ] `full-suite-runner.ts` 默认 laneCount 由 nproc 派生（本机 nproc=4 → 1），实测 `ps` 无重复
      `--test-concurrency`
- [ ] 显式传 `--lane-count 8` + 命令含 `=8` ⇒ 进程只出现一个 `=8`（replace 生效，实测输出贴任务体）
- [ ] aborted-red 构造下 inner 不停止、failed-red 下 inner 停止（测试实跑，负控制输出贴任务体）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-full-suite-runner-concurrency-default-and-gate.md（自身文件：勾 AC + 贴 invoke 证据授权）
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/suite-state-trigger.ts（`shouldStopDispatch` + `reason` 字段——stop-dispatch 消费者）
- plugin/test/full-suite-runner.test.mjs
- plugin/test/suite-state-trigger.test.mjs（AC5 两形态测试）
- scripts/test.sh（`has_explicit_concurrency`——显式 flag 为唯一并发源，杜绝 `=8 =8` 双拼）
- plugin/loop/fast-mode-loop-tick.md（步骤 3 停止条件：failed vs aborted）
- plugin/loop/orchestrator-loop-tick.md（红窗分诊：aborted 处置语义）
- tasks/gap-no-resource-awareness-heavy-ops-run-blind.md（AC3 交叉标注）
- tasks/gap-full-suite-belongs-to-outer-background-above-3-min.md（AC16 交叉标注）
- tasks/gap-red-window-dispatch-stop-should-be-shared-gate-conditional.md（AC6 交叉标注）

## Contract

measure   effective_concurrency = `ps -e -o args | grep -o -- '--test-concurrency=[0-9]*' | wc -l` stdout 数字段（应=1 且值为派生；实测等价断言：fake test.sh 记录的 spawn 参数恰一个 `--test-concurrency=<派生>`）
band      effective_concurrency = 1（派生值，无重复拼接）
invariant aborted_not_stop_dispatch = 1（`state: red` + `reason: aborted` 不触发 stop-dispatch）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --fail-fast-check`
control   显式传 `--lane-count 8` 且命令已含 `=8` ⇒ 进程只出现一个 `=8`（replace 生效）；aborted-red 构造 ⇒ inner 不停止（AC5）
resume    四条修改分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T11:2xZ
changed: ABORT #5（`--test-concurrency=8 =8` 双拼、PSI 88、WAIT 下开跑）同 ABORT #1/3/4 形态的
机制性修复，四条同一族改动一次做完：
1. **AC1** runner 默认 laneCount 改为 nproc 派生（`max(1, floor(nproc/2.1))`，本机 nproc=4 ⇒ 1），
   不再硬编码 8——测试以 `RESOURCE_GATE_NPROC=4` 实测 `laneCount=1` 且 spawn 恰一个
   `--test-concurrency=1`。
2. **AC2** splice 改为 REPLACE：`stripConcurrencyFlags()` 剥命令里已有的 `--test-concurrency=*`
   （`=` 与空格两种拼写）再拼派生值；配套 **test.sh `has_explicit_concurrency`**——显式 flag 存在时
   test.sh 不拼自己的默认，真实 node 进程也只一个 `--test-concurrency`（负控制：`--lane-count 8` +
   命令含 `=8` ⇒ 恰一个 `=8`）。
3. **AC3** 起跑前过 `resource-gate.sh --for full-suite`；WAIT ⇒ 退出非 0、state 文件字节不动
   （green 预写状态在 WAIT 下原样保留、suite 未 spawn）。
4. **AC5 reason 轴** runner 写 red 带 `reason`（failed/aborted），SIGTERM/SIGINT 写 red+aborted；
   `suite-state-trigger.shouldStopDispatch()`（red && reason ≠ aborted）成为 stop-dispatch 唯一判据，
   负控制 aborted-red ⇒ `stopSignal=false`（12 个互不相交任务被 aborted-red 全挡的第二次实证的机制
   修复）。文档（fast-mode-loop-tick 步骤 3 / orchestrator-loop-tick 红窗）同步 reason 轴语义。
DoD 未勾——全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）由外层异步验证 gate 在
修复后重跑确认；本任务只实现 + scoped 验证。

**验证证据（scoped 实跑，2026-08-05）**：

```text
$ bash scripts/test.sh --for-task gap-full-suite-runner-concurrency-default-and-gate --allow-thin
warning: test-selection-thin: task ... resolved tests for 4/11 Touches entries (0.36) < 0.5; pass --allow-thin
  (thin 预期：touches 多为 loop-tick 文档 + 任务交叉标注，仅 full-suite-runner / suite-state-trigger 两个测试文件)
✔ AC1 — default laneCount is NPROC-derived (nproc=4 → 1); spawned command carries ONE --test-concurrency=1
✔ AC2 — the splice is REPLACE: an existing --test-concurrency=8 (= and space spellings) is stripped and replaced by the derived value
✔ AC3 — resource gate WAIT ⇒ the runner does NOT start and leaves the state file untouched
✔ AC3 — resource gate GO ⇒ the runner starts (state=running then green)
✔ AC4 — negative control: explicit --lane-count 8 + command already has =8 ⇒ exactly ONE =8 (replace, not two)
✔ AC5 — a signal-killed run writes state=red reason=aborted, which must NOT trigger stop-dispatch
✔ AC5 — shouldStopDispatch distinguishes failed vs aborted (aborted does NOT stop; failed/missing DOES)
✔ AC5 — runOnce reports stopSignal=false for red+aborted and true for red+failed
✔ Contract invoke — full-suite-runner.ts --fail-fast-check: failure suite => red => SUITE-RED => stopSignal
ℹ tests 29 / pass 29 / fail 0 / cancelled 0
```

```text
$ node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --fail-fast-check
full-suite-runner: FAILURE detected on stream -> state=red reason=failed (run still in progress)
full-suite-runner: FINAL state=red reason=failed durationMs=37 exit=1
fail-fast-check: suite exit=1 state=red reason=failed stopSignal=true suiteRedEvent=recorded early=false
fail-fast-check OK: runner wrote state=red reason=failed → trigger recorded SUITE-RED → stopSignal in place
```

配套 test.sh 改动验证（`resource-gate.test.mjs` AC5 5 个派生站点 + `select-tests-for-touches.test.mjs` AC11
exec 行 pinning 均绿：33/33 pass）——`has_explicit_concurrency` 使显式 flag 为唯一并发源，真实
node --test 进程只出现一个 `--test-concurrency`（杜绝 ABORT #5 的 `=8 =8` 双拼）。