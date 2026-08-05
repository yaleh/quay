---
id: gap-full-suite-runner-concurrency-default-and-gate
title: full-suite-runner laneCount default hardcoded 8 (not nproc-derived) +
  --test-concurrency splice is append-not-replace + resource-gate never called —
  ABORT#5 (=8 =8, PSI 88, WAIT-start) same crash class as ABORT#1/3/4; fix all
  three in ONE change
status: needs-human
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---

> **内层 fan-in 裁定（2026-08-05 11:53Z）：回退 + needs-human。** 任务实现已回退（revert `09e4fcab`，
> 撤销 merge `16068661`），因为 scoped 验证的 **AC5「signal-killed run writes red+aborted」测试
> 间歇性失败（实测 ~50-70% 失败率，隔离 10x 复测）**——fan-in 选中集非绿，按契约不落地。
>
> **证据**：runner 核心修复（AC1-AC4：nproc 派生默认、replace splice、resource-gate）实测可用
> （直接跑 5/5 green、laneCount=1、单 concurrency flag）。但 **AC5 的 SIGTERM→red+aborted 有真实竞态**：
> 测试起 fake suite 后发 SIGTERM，handler 有时不触发，runner 退出后 state 仍为 `running`（未写
> aborted）。已试两种修复均未消除：
> ① 移除 `process.removeListener("SIGTERM/SIGINT")`（消除监听器移除后的无处理窗口）——把失败形态
>    从「state=running」改为「state=green」（晚期信号被 runDone guard 吞掉）；
> ② fake suite `sleep 2`→`sleep 30`（确保信号落在运行中）——失败率降但未消除（10x 仍 ~30% 失败，
>    诊断 state-after-exit=「running」）。
> **根因**：node 测试 harness 下 SIGTERM 到子进程 runner 的投递间歇性失败（与 runner 逻辑无关的
> 事件循环/信号时序竞态），需任务作者聚焦修复。
>
> **保留**：agent 分支 `task/gap-full-suite-runner-concurrency-default-and-gate`（commit `5ceb039d`）
> 未删——修复 AC5 后可 re-dispatch reland。外层已知道该 AC5 竞态（其 11:4xZ tick 提及 flake fix）。
> **ABORT #5 仍未机制修复**（suite 验证 gate 仍受影响），优先级不降。
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

- [ ] AC1: runner 默认 laneCount 读 nproc 派生（nproc=4 → 1），无 `--lane-count` 时生效并发 = 1
- [ ] AC2: splice 是 replace——命令里已有 `--test-concurrency=8`（`=` 与空格拼写）时被替换为派生值，进程只出现一个 `--test-concurrency=<派生>`
- [ ] AC3: 起跑前过 resource-gate，WAIT 时不启动（state 保持 running/green 不动）
- [ ] AC4: `full-suite-runner.test.mjs` 扩展覆盖三行为（负控制：显式 8 + 已有 `=8` → 替换为派生值）
- [ ] AC5: **inner 停止条件区分 failed vs aborted**——`state: red` + `reason: aborted`（或等价语义）
      不触发 stop-dispatch；只有 `reason: failed`（或检测到真实失败行）才停。测试覆盖两种形态
      （负控制：aborted 下 inner 继续派发；failed 下 inner 停止）
- [ ] AC6: 与 `gap-red-window-dispatch-stop-should-be-shared-gate-conditional` 交叉标注（stop-dispatch
      语义同一族）

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
- plugin/test/full-suite-runner.test.mjs
- plugin/loop/fast-mode-loop-tick.md（步骤 3 停止条件：failed vs aborted）
- plugin/loop/orchestrator-loop-tick.md（红窗分诊：aborted 处置语义）
- tasks/gap-no-resource-awareness-heavy-ops-run-blind.md（AC3 交叉标注）
- tasks/gap-full-suite-belongs-to-outer-background-above-3-min.md（AC16 交叉标注）
- tasks/gap-red-window-dispatch-stop-should-be-shared-gate-conditional.md（AC6 交叉标注）

## Contract

measure   effective_concurrency = `ps -e -o args | grep -o -- '--test-concurrency=[0-9]*' | wc -l` stdout 数字段（应=1 且值为派生）
band      effective_concurrency = 1（派生值，无重复拼接）
invariant aborted_not_stop_dispatch = 1（`state: red` + `reason: aborted` 不触发 stop-dispatch）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --fail-fast-check`
control   显式传 `--lane-count 8` 且命令已含 `=8` ⇒ 进程只出现一个 `=8`（replace 生效）；aborted-red 构造 ⇒ inner 不停止（AC5）
resume    四条修改分步提交，任一步完成即写盘