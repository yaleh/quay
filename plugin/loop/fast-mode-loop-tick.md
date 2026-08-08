# 快速模式 loop tick 指令

> **模板参数（gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them）**：本文件是随
> quay 插件包分发的内层 tick 文档（模板在 `plugin/loop/fast-mode-loop-tick.md`，外层模板是
> `plugin/loop/orchestrator-loop-tick.md`）。
> `quay-init --loop` **原样铺出**（字节相同，不做文本替换）——目标项目的值（`repo_root` /
> `test_command` / `tmux_session`）集中在一个配置文件 `.quay/config.yml` 的 `loop:` 节里，
> 脚本与本 tick 在**运行时读取**它们，不在落地时烘焙。铺到目标项目时的位置：
> `docs/analysis/fast-mode-loop-tick.md`（内层）/ `orchestration/orchestrator-loop-tick.md`（外层）。
> 模板正文本体不含任何具体仓库路径、测试命令或 tmux 会话字面量。
>
> **目标项目值引用约定**：`REPO_ROOT` / `TEST_COMMAND` / `TMUX_SESSION` / `WORKTREE_ROOT` /
> `FORK_BASELINE` / `MERGE_TARGET` 六个名字在本文件中指 `.quay/config.yml` `loop:` 节的对应值
> （`repo_root` / `test_command` / `tmux_session` / `worktree_root` / `fork_baseline` / `merge_target`）。
> 执行含这些名字的命令前，先读该文件把值代入——不要凭记忆。
>
> **工作分支模型（gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model）**：
> 工作分支名是**策略**（各项目自身 branch 模型现状），不是机制——本文件是下游项目经升级通道消费的
> 共享模板。`FORK_BASELINE`（独立任务分叉基线）与 `MERGE_TARGET`（待验证汇入点/合并目标）**默认
> 都是 `master`**（单线：独立任务从 master 分叉、合回 master——未做 branch cutover 的下游行为不变）。
> quay 自身在 `.quay/config.yml` 覆盖成 `fork_baseline: develop` / `merge_target: integration`（两线）。
> 所有含分支操作的命令先读这两个值代入，**不要字面写死分支名**。
> **worktree 一律建在 `$WORKTREE_ROOT/<slug>`**——`worktree_root` 是 quay-init 落盘时校验过的磁盘路径
> （tmpfs 会 fail-closed，见 gap-the-shipped-tick-doc-teaches-every-project-to-put-worktrees-in-tmpfs）；
> `/tmp` 是 tmpfs，每个 MB 都是内存，worktree 建进去就是在重演整机 OOM。

**这是一份 tick 指令，不是驱动器。** `/loop` 每次触发就执行一遍下面的步骤，然后重新排程。

<!--
标记约定（gap-dispatch-gate 的 Contract 机制之外，针对本文档自身的规范性语句）：
  unmechanized:   有意暂不机械化，附理由。是已声明的取舍，不是欠账，不要为它建检查
  unmechanizable: 本质不可机械化（思维纪律/判断题），只能靠每 tick 复读
未标记的规范性语句，默认应当有执行者——逐条审计见 docs/analysis/normative-prose-audit.md
-->

**这份文件必须能在 `/clear` 后的空上下文里独立启动。** 若你刚被清空上下文，按「冷启动」一节先建立
状态，再进入 tick 步骤。

**调用方式**（`.claude/loop.md` 已删除——exp5 退役；`/loop` 带显式 prompt 时不读该文件）：

```
/loop 25m 执行 fast-mode-loop-tick.md 中的 tick 指令
```

**可查验性 / 为什么用固定间隔（2026-08-03，外层更正理由）**：`/loop` **不是驱动器**——主推进信号
仍然是后台 agent 的完成通知（见「定位：看护，不是调度」节）。`/loop` 的作用是**跨 `/clear` 和
`/compact` 保持行为稳定**：上下文被清空后，仍有东西把 tick 指令重新调起来，让你读到冷启动一节自行
恢复。可查验只是**次要收益**，不是目的。

- **带间隔**（`/loop 25m <prompt>`）走 **CronCreate**，可用 `CronList` 列出（返回
  `2312da21 — Every 25 minutes (recurring) [session-only]`）——**可查验**。
- **不带间隔**（`/loop <prompt>`）是动态模式，走 **ScheduleWakeup**，**没有任何列出工具**。
- **真正的理由**：对一个**专门用来在上下文丢失后兜底的机制，不可查验等于不可信**——你无法在
  需要它之前知道它是否还活着。今天 16:14Z 被 `/clear` 时没有运行中的 loop，恢复全靠外层手工简报，
  正是这个机制缺席的实证。
- **规则**：固定间隔（25 分钟，落在本文件第 6 步的 1200–1800 秒区间）。这也对阶段 2 产品化有意义——
  「动态排程连是否存在都无法查询」是「排程不能靠会话内 cron」之外的第二个产品化缺口。

---

## 冷启动（`/clear` 后的空上下文）

按顺序读这四份，然后从 tick 步骤 1 开始：

1. `docs/analysis/batch2-queue-state.md`（文件名历史引用——batch2 是旧批次名；文件本身是当前队列状态）—— 队列当前状态（已完成/在飞/待执行）
1. `docs/analysis/batch2-queue-state.md` —— 队列当前状态（已完成/在飞/待执行）。**「batch2」是历史名**（旧批模型的队列快照，保留不改名以免破坏引用）；今天的派发是滚动的，不读成「分批门控」
2. `orchestration/exp6-phase1-sustained-unattended-operation.md` —— 目标、AC、DoD
3. `adr/ADR-021-adaptive-budget-self-regulating-methodology.md` —— 四项原则
4. 本文件其余部分

再跑这三条建立实况（**以实测为准，不以队列文件为准**——它可能是 compact 前的旧快照）：

```bash
git log --oneline -10 && git status --short
node --experimental-strip-types plugin/scripts/task-status-drift-check.ts
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json
```

## 定位：看护，不是调度

exp6 §9 把 loop 降级为**跨会话行为稳定层**。这份 tick 兑现那个定位：

| loop 做 | loop 不做 |
|---|---|
| 会话 idle 时把停摆的队列推进一步 | 轮询后台 agent 是否完成 |
| compact / `/clear` 后从队列文件恢复状态 | 决定任务优先级 |
| 触发停止条件时停下并报告 | 替人做合并冲突/审查失败的判断 |

**后台 agent 完成时会自动触发 `<task-notification>` 重新唤起会话**——那是主要的推进信号，也是**派发触发源**（`gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release`：实测派发=3 簇 tick 边界、槽位释放后 39 分钟不回填而池子 health，正是「并发打破外层瓶颈」设计的退化形态——瓶颈从外层搬到了 inner 自己的 tick）。**收到完成通知 = 槽位释放，必须立即重评估派发（「槽位释放回填」，见步骤 4），不等下一 tick。** 这个 tick 是**兜底心跳**，处理「会话 turn 结束了但队列还有活」的情况。因此间隔应长（20–30 分钟），不是快轮询——**派发节奏由完成事件驱动，不由 tick 间隔驱动**。

**派发评估有两个触发源，且都机械接线（`gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release` + `gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat`）**：① **完成事件（加速源）**——被 `<task-notification>` 唤起时，某个后台 subagent 完成、释放了一个并发槽，**立即**按「事件驱动派发（槽位回填）」一节评估是否回填空槽，不等下一 tick；② **tick 心跳（兜底必跑）**——每 tick（含轻触）**无条件跑 slot-refill**（`slot-refill.ts`，纯状态读取器）并按结果行动（`should_refill=true` + `recommended` 非空 ⇒ 派发），**不依赖完成事件**。两个触发源走同一步骤 4 派发闸。**没有完成事件、且 tick 心跳没到，才零派发评估**（负控制，AC4）；不引入新的轮询源/双驱动——tick 心跳是现成节奏，完成通知是 harness 原生事件，都不是新轮询。

<!-- unmechanizable: 判断题，无代码可强制。形态是启发式，靠每 tick 复读 -->
**不要把「没收到通知」当作「还在跑」（2026-08-02 两次停摆教训）**：后台 agent 会静默停止（transcript 静止、无 notify），尤其长测量任务。空闲时**先查进程再决定等不等**，别只依赖通知：
```bash
ps -e -o comm= | grep -cx node   # 0 = 没有 node 在跑
cat /proc/loadavg                # load1 < 1 = 无实质负载
```
两者满足 → 没有任何东西在跑，通知不会来了，**去核对产出/续跑**。每跑完一步就落盘（任务体/队列文件），不要攒到最后——即使 agent 静默停止，已落盘数据不丢，可从缺口续跑。

**跑全量前调用资源闸（机制，不是散文——`gap-no-resource-awareness-heavy-ops-run-blind`）**：
目标项目的全量测试命令（`.quay/config.yml` `loop.test_command`，下称 `TEST_COMMAND`）已在默认
全量路径接入 `bash plugin/scripts/resource-gate.sh --for full-suite`——WAIT 时打印数字后退出非 0，
**不静默等待**。手动跑全量同样先调 gate：退出码 0=GO 才跑，非 0=WAIT 不跑。
gate 读 `/proc/pressure/cpu` **`some avg10`**（结构信号：有任务在等 CPU 的比例；load 是代理，
claude 会话常驻使 load 永不降）、`free -m` available、`pgrep -xc node-MainThread`，并单列
ppid=1 且 cwd 已删除的孤儿 node 进程（AC10）。参考：本机 nproc=4，测试命令的默认并发已改为
**推导值 `max(1, floor(nproc / 1.0)) = 4`**（AC5 代价侧实验 2026-08-08 实测：
`gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible`——同一选中集在并发
1/4/8 下全零 cancelled，nproc 是墙钟甜点；旧的 2.1 放大系数使默认=1，其「avoid cancel」理由从未被
实验证实，现已被否定），`--test-concurrency=N` 显式传入永远优先（**分叉**：这是
node:test/test.sh 项目的旋钮；**vitest 项目真实文件级并行 flag 是 `--maxWorkers`**，archguard 用
`--maxWorkers=8` 跑通全量——同一份文档服务两种测试框架，`gap-full-suite-runner-red-pattern-matches-
bare-x-vitest-false-red` AC3）。两层绝不同时跑全量套件。
**跨层总预算（`gap-test-concurrency-cap-does-not-scope-nested-spawns` AC1/AC4，机制不是散文）**：
全仓并发 node --test 进程数由**单一权威** `plugin/scripts/process-budget.sh` 定义——
`total_budget = nproc`、`in_use = pgrep -xc node-MainThread`（跨全部 worktree 计数）、
`available = max(0, total_budget − in_use)`。test.sh 的 worker 推导（C 面）、cap-from-gate 的
槽位帽（B 面）、本节的资源闸/外层调度（A 面）**都读这同一预算，不各自推导**：
- **worker 数**：test.sh 默认并发 = `max(1, floor((total_budget − in_use) / 1.0))`——空闲时 = nproc（墙钟甜点），
  已有嵌套派生（quay-init 族 / 会话族内部 spawn）在跑时自动收口，**嵌套不再绕过上限**（17-19 进程 / load 18.70 的根因）；
- **槽位帽**：`effective_cap = min(档位cap, max(1, available))`——预算耗尽（available=0）时槽位帽落到 1，饱和主机不再派发；
- **资源闸**：report 模式输出 `total_budget / budget_in_use / budget_available`（与 test.sh/cap-from-gate 同一权威）。
验证判据：任何配置下 `ps -e -o comm= | grep -cx node-MainThread` ≤ total_budget。
**全量套件本身已移到外层后台**（`gap-full-suite-belongs-to-outer-background-above-3-min`，AC1/AC3）：
inner 不跑全量（默认无参路径），只读 `.quay/full-suite-state.json` 的 `state`（见步骤 3）——上面这条
资源闸是**外层后台 runner 起跑前**要过的闸，不是 inner 的。inner 只保留 `--for-task` 选中集
（秒级，走 scoped 路径，不触资源闸）。

**任务 DoD 不含全量套件；全量套件是批量合边界的闸门（`gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge`）**：
`--for-task` 跳资源闸、只跑 `## Touches` 选中集，**对「这次改动有没有破坏别处」是无知的**——它只能用在
迭代中途。**全量套件绿是批量合边界的闸门**：外层验证轮只在 `state: green` 时把 `$MERGE_TARGET`→
`$FORK_BASELINE` 批量合（判绿三条件见下）。任务自身的 DoD **不写**「完整套件连跑 2 次全绿」——移除的是
任务级那份重复，批量合边界那道闸**原封不动**（保护总量不变、耦合消失）。把「少跑全量」当目标就是把方向 C
做成方向 A。

**判绿三条件（2026-08-03，外层：fail 0 ≠ 绿）**：崩溃的套件也可能报 `fail 0`——batch4a 那次（历史引用）
**判绿三条件（2026-08-03，外层：fail 0 ≠ 绿）**：崩溃的套件也可能报 `fail 0`——batch4a（**历史批名**，指旧的全量验证轮次，保留不改名）那次
`fail 0` 但 `cancelled 2`、`tests 2246`（非参考值 2361），两个重型测试被 cancelled
（'Promise resolution is still pending'）不计入 fail。**判绿必须三条同时成立**：
```bash
grep 'cancelled 0'   # cancelled == 0（cancelled 不计入 fail，必须显式查）
grep 'FULL-SUITE-EXIT=0'
grep 'tests 2239'    # tests 数等于参考值（2026-08-04 实测 2239＝2227+readyqueue touches-resolve 新测试，全量套件全绿；套件构成每次变都要重测参考值）
```
只查 fail 会把崩溃读成绿。reference `tests` 数演变：batch4b/4c 稳定 2361（历史引用）→ … → +14 resource-gate =
**判绿理由（2026-08-03 外层更正）**：cancelled 的成因**不是**「饥饿必然导致 cancelled」——sigma 高压负控制
（gate WAIT 41→99）仍 155/155 完整捕获、cancelled 未发生，推翻那个普适性。batch4a 的 cancelled（历史引用）可能有
只查 fail 会把崩溃读成绿。reference `tests` 数演变：batch4b/4c（**历史批名**）稳定 2361 → … → +14 resource-gate =
**判绿理由（2026-08-03 外层更正）**：cancelled 的成因**不是**「饥饿必然导致 cancelled」——sigma 高压负控制
（gate WAIT 41→99）仍 155/155 完整捕获、cancelled 未发生，推翻那个普适性。batch4a（**历史批名**）的 cancelled 可能有
自身异步结构的触发条件（Promise 未决 + 事件循环已解决）。**判绿三条件成立的理由改为：「cancelled 是一种
会被 fail 0 掩盖的失败」——显式查它是为了不漏掉这种失败，不是因为饥饿必然产生它。**
2436（05:30）→ **retire 删除 18 个测试文件 = 2034**（05:45，155 files）→ **+stranded +parser = 2052**
（07:15，156 files）→ **+tmpdirs 测试隔离 R6 = 2054（08:40）→ **+token 重操令牌 = 2065**（09:05，token fan-in 套件实测）
参考值以最近一次全量绿的 tests 数为准。**注意 starvation 是单套件稳态（4 核跑 c8 = 4 倍过订，
压力 ~87）：全量只串行跑、起跑前调用资源闸（some avg10 < 40 才 GO），但套件自身跑起来压力必然 >40，
那是设计性超订不是异常。默认并发已改为推导值 max(1,floor(nproc/1.0))=4（4 核）；全量验证用
--test-concurrency=8（外层 runner 实跑 13+ 轮全零 cancelled）或默认 4 lanes**。

## 已知负载敏感族（KNOWN-LOAD-SENSITIVE）——判绿/放宽判据必须排除，不得读成真回归

**这族测试的权威清单是机器可读的**：`plugin/scripts/known-load-sensitive.ts --list`（解析各测试文件头
的 `// @load-sensitive <kind>` 标注，`gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage`
AC1/AC2）。本散文只讲判读规则，**不再手列族文件**——文件清单以该脚本输出为准（单一来源，消灭双源）。
代表成员（示意，非清单）：`plugin/test/session-liveness-events.test.mjs`、`session-liveness-heartbeat.test.mjs`、
`session-liveness-signals.test.mjs`（原 `session-liveness.test.mjs` 拆分，
`gap-session-liveness-tail-capped-split`）、`plugin/test/cold-start-skill.test.mjs`（及其演练/laid-down
`--once` 同类）、`plugin/test/runner-grouping.test.mjs`（`nested-spawn` kind）——它们用**真实进程 + tmux 时序**
或**嵌套 node --test spawn** 验证会话存活/冷启动/分组语义，机器负载一高就红——
隔离下全绿、并发下红，**不是逻辑错误**。2026-08-04 全量套件 #6/#7 各挂一条不同但同族的测试，
隔离单跑全过，确认并发敏感。**两种根因、两个 kind，判读不得混用**（`wall-clock` = 真实进程 + tmux 时序；
`nested-spawn` = 嵌套 runner）。

**判读规则（强制）**：
1. **这一族的 fail 在并发/高负载下不算真回归**。放宽实验（第三步：把重活令牌从单飞放宽到两个
   并发套件，= 负载翻倍——`heavy-op-token.sh` 已随 2026-08-06 人裁定整体退休，「一次只跑一个
   重测试」约束退役，此放宽实验前提不再存在）的判据**明确排除**这族的 fail——判定时先看 fail 是否落在这族
   （机械判定：`red-window-triage.ts --partition` 把失败分区为 in-family / not-in-family），
   落在 ⇒ 单独重跑该族（隔离、低负载），绿 ⇒ 是「已知时序敏感被放大」，不是「并发放宽暴露了真问题」。
2. **这族永远单独跑全量或低负载判读**。判绿三条件（上面）里的 `fail 0` 判据对这族不适用；
   全量套件中若只有这族红，先按第 1 条单独重跑再下结论。隔离重跑命令由 `red-window-triage.ts --partition`
   自动产出并写回套件状态（`isolate_rerun`），裁决 `isolate_rerun_result` 绿 ⇒ 记 environmental + kind、
   红 ⇒ 非环境升级——全程机械可查（AC3/AC6）。
3. **不要删/降级/改 skip 这族**——它们抓的是真问题（并行观测、laid-down 实跑、`--once` 接缝），
   只是天生负载敏感。

**机制标记**：这族测试文件头部带 `// @test-group governance` 之外的**显式负载敏感注释**：`// @load-sensitive <kind>`
（机器可解析，`known-load-sensitive.ts` 读取）+ `KNOWN-LOAD-SENSITIVE` 散文标记（人读）。`known-load-sensitive.ts --check`
强制「有 KNOWN-LOAD-SENSITIVE 头声明 ⇒ 必有 `@load-sensitive`」，无标注的声明机械拒绝（AC2）。低负载基线实测：单套件连跑 2 次
全绿（fail 0 / cancelled 0，`$TEST_COMMAND plugin/test/session-liveness-events.test.mjs plugin/test/session-liveness-heartbeat.test.mjs plugin/test/session-liveness-signals.test.mjs plugin/test/cold-start-skill.test.mjs`）；
人为负载（并发放量套件）下确实变红 ⇒ 敏感是真实的，标注不是伪装的借口。

## serial 组的显式判据（gap-serial-group-recompose-nested-runner-criterion，2026-08-07）

**进 serial 的唯一理由 = 该文件 spawn 自己 worker 池的子套件（嵌套 runner）**——通过
`$TEST_COMMAND` / `--for-task` 派生并发 N 的子套件（runner-grouping / select-tests-for-touches /
quay-init-loop-core 属此类，见各文件头 `@test-group serial`）。serial 并发 1 是机制不变量——这类
文件在并发 8 主套件下 = 8×N 进程互相放大，cc1 是正确答案不是保守。

**其它理由一律走 lowconc，不走 serial**：
- **低负载/时序敏感**（如 checker-cost 的 9 处单调性断言）——需要的是【机器有余量】不是【独占】；
- **hermetic 但先前留串行**（如 session-topology 的私有 socket 自隔离）——隔离功课做完、分组没跟；
- **串行只是验收标准文本、非技术必要**（如 install-config-driven-e2e）。

判定新文件归组时读这条：能说清「不串行会怎样」才算 serial；否则进 lowconc（需低负载）或主套件。
GROUP NOTE 必须与判据对齐——同一家族内，嵌套 runner 的留 serial，低负载/时序的走 lowconc。

## 会话存活监视（`session-liveness.sh`）——看自己还在不在（AC13）

**内层同样要挂 `session-liveness.sh`**（泛化后的会话存活监视，原 `outer-liveness.sh`）。
理由（2026-08-03 实测）：只看**工作产出**的工具（旧的 `inner-state.sh`，现已退役）在会话死后
只会看到「没有新遥测」，与「内层在思考一个难题」完全同形——这是本仓当天两次栽过的那一族失效换了个
位置。内层跑重活，会话死掉代价更大，**更需要**进程存活这一层。

**挂载无锁（2026-08-06 人裁定，gap-session-liveness-remove-shared-events-and-lock）**：观测是**树**
（manager→N 个 outer、outer_i→inner_i），每条边是独立的 (观察者,目标) 对，**只读天然不排他**。
挂载**不取任何锁**——观测对目标纯只读（capture-pane/git log/stat，零写入），两个观察者盯同一
pane 的代价只是每周期多一次 capture-pane；不再有共享 events.jsonl（那是把 N 条独立流合并成一条
再让每个消费者过滤回自己要的——严格劣于 N 条独立流）。**谁挂的谁拥有自己的 stdout 事件流**：
挂载方（Monitor 工具）直接消费该流，谁先启动无关，观察者之间互不知情、不共享任何写点。
（旧的「单飞挂载 + 共享事件」设计及 `heavy-op-token.sh` 已随人裁定整体退休。）

挂法与心跳（AC11/AC16）：内层的心跳不是外层那种 tick 日志，而是它的**会话 transcript**
（AC1/AC16，2026-08-03 实测选定：`.workflow-events/` 每任务只写 1-2 行、任务进行中完全冻结，
不是有效心跳源；transcript 每次工具调用都写，含 subagents 目录）。经
`SESSION_TRANSCRIPTS="<名字> <会话id|绝对路径>"`（推荐，会话 id 是配置不去推断）或
`SESSION_HEARTBEATS="<名字> <路径>"` 配置。事件 `SESSION-GONE/BACK/OVERDUE/IDLE/RESUMED` 报的是
「会话本身还在不在、忙不忙」，`REPO-STALL` 报的是仓库信号（AC8，原 `SESSION-STALL`）。
**观测只有一个工具**（SPEC-one-observer-two-surfaces.md）——旧 `inner-state.sh` 的「在做什么」
事件集随其退役而撤下；工作产出信号由外层直接读 `fast-mode-telemetry --report`（外层 cwd 就是本
仓库），仓库告警同理直接看 `git log`。**解除停机（删 `.halt`）那一刻重置陈旧度基线**，停泊期间
的陈旧不计入解除停机后的 OVERDUE/REPO-STALL。

## 状态单一来源

`docs/analysis/batch2-queue-state.md`（文件名历史引用——batch2 是旧批次名；文件本身为当前状态源）

每个 tick 结束**必须**写回该文件。它是 compact 后唯一可信的状态——不要靠记忆。

## 停止哨兵

`.halt`（仓库根）

exp5 已退役（`.claude/loop.md` 已删除），`.halt` 从「暂停 exp5 循环」改为**快速模式的唯一停止开关**。
存在即暂停；移除即放行。

移除前跑 `experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh`——
它检查工作树干净、无半途 merge、工作分支（`$FORK_BASELINE`，quay 自身为 develop）未被占用等硬条件。
注意它有一条是「working tree clean」，
而快速模式下开发会话本就在工作分支（`$FORK_BASELINE`）上工作，所以**在飞任务未落地时它会 FAIL 是预期的**，
不是故障；等在飞任务合并完、树干净了再移除。

---

## 状态自检清单（重锚时逐项核对，机械可执行，强制）

**本文档是 inner 的出厂锚。** 外层每 20 分钟经 cron 转发固定重锚 prompt
（`plugin/scripts/reanchor-prompt.txt`，外层 `orchestrator-loop-tick.md` 步骤 1c）。收到该唤醒时，
按下面清单**逐项机械核对**当前状态是否符合本文档：符合 ⇒ 无操作；有明确偏差 ⇒ 向本文档对齐自我
修正。**本唤醒只做一致性核对，不决定任何任务动作**——派发与否由本文档步骤 3/4 自己的规则决定，
不是重锚唤醒的新决策。

| # | 核对项 | 机械判据 |
|---|---|---|
| ① | 在飞 agent 是否符合文档 | **读槽位视角，不读原始括号**（`gap-telemetry-brackets-vs-subagents-no-slot-visibility`——括号 ≠ subagent，红窗遗留的未闭合 start 会把健康态误判成满负荷）：`node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slots --cap "${effective_cap:-3}" --root "$(pwd)" --json` 的 **`realInFlight` ≤ `effective_cap`**（步骤 4 并发上限，由 `cap-from-gate.sh` 在派发时刻读 cpu 压力（some avg10）算出——见步骤 3.6 前置块；不再固定 3）。**`real_in_flight > cap` ⇒ 并发违规（真超派发），判据抓住**；`brackets_reflect_subagents: false` ⇒ 有陈旧括号未 reconcile（`--reconcile` 处理）或 `--task-start`/`--task-end` 对没调齐（AC4）——是偏差，对齐而非误判健康。**反向维度（`gap-closed-bracket-leaves-live-agent-consuming-slots`：括号关 ≠ 进程退）**：`--slots` 的 `closedButLive` / `occupied_slots`（= `realInFlight` + 已关括号但 executor 仍存在者）——**括号关 ≠ 槽空**，executor 仍在（worktree 未清 / 进程未退）的已关括号仍占槽，`occupied_slots > cap` 同样并发违规；该槽不得派新任务。每个在飞任务有 worktree 且在 `$WORKTREE_ROOT/<slug>`（磁盘，非 `/tmp`） |
| ① | 在飞 agent 是否符合文档 | 遥测 **`realInFlight`** ≤ `effective_cap`（步骤 4 并发上限，由 `cap-from-gate.sh` 在派发时刻读 cpu 压力（some avg10）算出——见步骤 3.6 前置块；不再固定 3）；**不用原始 `inProgress[]` 括号数**——括号 ≠ subagent（5 个红窗遗留括号 ≠ 1 个真实 subagent，用括号会把恒真空检查当判据，`gap-telemetry-brackets-vs-subagents-no-slot-visibility` AC3）。读取形态：`node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slots --cap "${effective_cap:-3}"` 的 `real-in-flight`，或 `--report --json` 的 `realInFlight` 字段（reconcile 感知：括号数扣减 executor 已消失者）。每个真实在飞任务有 worktree 且在 `$WORKTREE_ROOT/<slug>`（磁盘，非 `/tmp`） |
| ② | 就绪池是否维护 | `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --cap "${effective_cap:-3}"` 的 `pool` / `dispatchable_disjoint` 字段（`effective_cap` 见步骤 3.6 前置块）；`pool < floor`（=cap×4）或 `dispatchable_disjoint < cap` 时是否已按步骤 3.6 补晋 |
| ③ | 是否在偷偷做收尾 | inner 已无收尾职责（步骤 2 不写任务状态、步骤 3.5 只写 `--task-start`；收尾是外层步骤 1b 的异步活）。核对：本回合未合并改动里无 `status: *done` 写入、无 `--task-end` 调用、无轮次记录写入 |
| ④ | 停止条件是否被遵守 | 步骤 3 命中项（合并冲突 / OVER90 / ruling-required / 外层 suite-state `state: red` / 就绪队列空 / 窗口新增 needs-human ≥3）命中时是否停止派发；`.halt` 存在则本 tick 空转 |

有明确偏差 ⇒ 向文档对齐：重新执行本文档对应步骤修正（补 worktree 纪律、按步骤 3.6 补就绪池、
撤销偷偷收尾的状态写入、按步骤 3 停止条件停止派发），修完才继续。

---

## 事件驱动派发（槽位回填）——完成即重评估，不等下一 tick

**派发评估的触发源有两个，且只有两个**（`gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release` + `gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat`——后者是前者 AC4 负控制的反面形态，tick 心跳必跑 slot-refill 兜底）：
1. **tick 边界**（下面的 Tick 步骤 3/4，`/loop` 心跳 1200–1800s）
2. **完成事件**——任一在飞后台 subagent 完成，`<task-notification>` 唤起本会话的那一刻

**被 `<task-notification>` 唤起时（≠ tick 心跳）**，不是空转等下一 tick，而是立即走**槽位回填**路径：
把刚完成的任务从在飞集合里移除（**它的槽位在完成时刻释放，不在 fan-in 时刻**——遥测括号未闭合不意味着槽位还被占着，AC6：括号≠subagent，`gap-telemetry-brackets-vs-subagents-no-slot-visibility`），然后评估是否立即派发新任务填这个空槽。**不 fan-in、不写任务状态、不重排程**——只做派发重评估；合并与收尾仍归下一 tick / 外层异步。

**先看是什么唤起了本回合**：transcript 里出现 `<task-notification>`（后台 agent 完成）⇒ 走本节的槽位回填（**加速触发源**）；
否则（/loop 心跳、重锚、人工）⇒ 按「Tick 步骤」全流程，**且步骤 4 无条件先跑 slot-refill**（**兜底必跑触发源**，`gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat`——长任务霸占期间空槽对机制不可见，心跳必须每 tick 问一次）。两者都跑步骤 3 停止条件 + 步骤 4 派发闸——完成事件/心跳只是「何时评估派发」的两个触发源，不是另一套更宽松的闸。

### 槽位回填的机械判定（强制）

```bash
effective_cap="$(bash plugin/scripts/cap-from-gate.sh 2>/dev/null | sed -n 's/^effective_cap=\([0-9]*\)$/\1/p')"
node --experimental-strip-types plugin/scripts/slot-refill.ts --root "$(pwd)" --cap "${effective_cap:-3}" --in-flight <仍在跑的任务id逗号分隔> --closed-but-live <已关括号但 executor 仍在的任务id（来自 --slots 的 closedButLive，可空）>
```

- stdout 是 JSON。**`slots_free` = 空槽数**（`max(0, cap − 在飞数 − closed_but_live 数)`；在飞数由**本会话自己维护的集合**给出，不是遥测——AC6 括号≠subagent，遥测括号会把已完成任务多算在飞）。**`closed_but_live` 是反向维度**（`gap-closed-bracket-leaves-live-agent-consuming-slots`）：括号已关（`--task-end` 已写）但 executor 进程仍存在（worktree 未清 / 进程未退）的任务 id——它们仍占槽，`--slots` 的 `closedButLive` 机械给出，回填时一并传入，**别把它们的槽当空**。
- **`should_refill` = 事件驱动 go/no-go**：`slots_free > 0` 且 `recommended` 非空（有候选通过步骤 4 的触摸可解析/依赖就绪/并发资格三道检查）。
- **`recommended` = 建议立即派发的候选**（至多 `slots_free` 个，生产 disjoint 批，与在飞两两不相交）。用它做派发候选，仍需跑步骤 4 自己的逐候选检查（触摸可解析、依赖就绪、并发资格）。
- **`no_refill_reason` 非空 = 不派发**：`in-flight ≥ cap`（并发上限语义不变，AC5；cap 仍是 `cap-from-gate.sh` 读 cpu 压力（some avg10）+ 滞回 + 档位配置的产物）、`.halt` 存在（**抢占挂载**，`gap-supervisor-preemption` AC2——代码强制点，任意点生效）或无可派发候选（负控制）。

### 规则

- **完成事件加速回填，tick 心跳兜底必跑 slot-refill**（`gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat`）：被 `<task-notification>` 唤起时立即走本节回填（加速）；tick 心跳（含轻触）也**无条件跑 slot-refill**——`should_refill=true` + `recommended` 非空 ⇒ 按步骤 4 派发（兜底，不依赖完成事件）。**无完成事件、且 tick 心跳没到 → 零派发评估**（AC4 负控制）。**不引入新轮询源**：不建第二个 `/loop`、不改 `ScheduleWakeup` 间隔成快轮询、不设常驻 watcher——tick 心跳是现成节奏、完成通知是 harness 原生事件，都不是新轮询。
- **回填走与 tick 相同的派发闸**：被唤起后仍先按步骤 3 查停止条件（`--detect-stop`、`.halt`、外层 suite-state、needs-human 窗口、就绪队列空），命中任一 ⇒ 不派发，报告后重新排程。事件驱动不绕过任何停止条件。**`.halt` 的机械强制点**：`slot-refill.ts` 在 `.halt` 存在时 `should_refill=false`（`gap-supervisor-preemption` AC2）——回填路径不用等到 tick 边界就被代码挡住。
- **在飞集合是本会话所有**：派发时把任务 id 加进在飞集合；收到该任务的完成通知时移出。**回填派发新任务后，下一次评估的 `--in-flight` 必须包含它**——否则 `slots_free` 虚高，把刚占用的槽又算成空闲，可能双派发。
- **已完成未 fan-in 的任务仍持有未合并的改动**：回填候选若与它 Touches 重叠，先 fan-in 它再回填，或把它 id 留在 `--in-flight` 直到 fan-in（宁可少派一个，不制造合并冲突——冲突仍会 needs-human 被抓住，但那是浪费）。
- **幂等（无双派发）**：`slot-refill.ts` 是纯状态读取器（exit 0 恒、零写入、零派发）——同输入同输出。双派发在结构上不可能：派发动作在步骤 4（消费 `should_refill`/`recommended` 并 spawn Agent），不在 helper 里。
- **交叉标注（AC6）**：回填依赖**准确的完成感知**——`<task-notification>` 是真实完成信号；遥测括号（`--task-start`/`--task-end`）在括号失真时不能当完成/在飞判据，否则空槽计算失真。括号对齐是 `gap-telemetry-brackets-vs-subagents-no-slot-visibility` 的活，回填机制不读括号。**反向维度（`gap-closed-bracket-leaves-live-agent-consuming-slots`）**：括号关 ≠ 进程退——**完成感知的另一面**：不能因为 `--task-end` 写了就断言该槽空，executor 进程是否还在是独立事实；回填的 `--closed-but-live` 把「已关括号但仍占槽」显式传进槽位算术。

---

## Tick 步骤

**词汇规范（AC5，`gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round`，跨模型沿用）**：
**分派是滚动的，不叫批号**——槽位空即派、不攒批、不等批；任何「batch + 编号」的措辞都只能是历史
引用或错误。**全量验证/收尾节奏叫 `verification-round-N`**（外层异步例程，见步骤 2 与
`orchestrator-loop-tick.md` 步骤 1b），它**只关于验证/收尾，不是分派门控**。tick-log 与 commit message
沿用同一词汇：描述派发用「滚动派发」，描述全量验证/收尾轮次用 `verification-round-N`。

### 分支模型（两线：develop + integration，`gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point`）

**结构根因**（`orchestration/SPEC-branching-model-integration-branch-2026-08-05.md`）：master 曾同时是
「分叉基线」和「汇入点」——红窗必须停派发正是这两个角色压在同一 ref 上。**拆开即无此冲突**：

| 线 | 角色 | 谁分叉/合回 |
|---|---|---|
| **`develop`** | **已验证基线**（绿） | 独立任务从它分叉；只接受外层 verification-round 的批量 fast-forward 合并（integration→develop） |
| **`integration`** | **待验证汇入点** | 声明依赖的任务从它分叉；**所有任务合回它**（红窗期照常接收——结构性消除停派） |
| `master` | 发布线角色**空置**（quay 无发布流程） | 等真有发布授权时再加，语义才实（裁定①） |

- **分叉基线即依赖声明（AC2）**：独立 → develop；声明依赖 / touches 与 integration 未验证任务相交 →
  integration。机械判定用 `plugin/scripts/integration-branch-model.ts --fork-baseline`（见步骤 4）。
- **合并机制（AC3）**：任务合回 integration（步骤 2，`git merge --no-ff task/<id>`）；外层
  verification-round 验证绿后批量合回 develop（`orchestrator-loop-tick.md` 步骤 1b，`--ff-only` 硬约束）。
- **命名 = `integration`（AC6）**：gate（与 quay gate 概念打架）/ staging（暗示部署）/ next（表达不出
  待验证）均被否。
- **前置②**（AC4，`gap-global-count-assertions-fragile-relative-baseline`，done）：全局计数断言已改
  相对基线判据——develop 相对 integration 滞后不再触发断言噪声。
- **前置③**（AC5）：历史遗留分支（experiment-4-iteration-* / _master_check 等）已清。

### 0. 哨兵

`.halt` 存在 → 本 tick 空转，报告「已暂停」，重新排程，结束。

**抢占挂载（`gap-supervisor-preemption`：.halt 任意点生效，不再只是本步骤 0）**：本步骤只是
tick 边界的**规则文本**；`.halt` 的**强制点在代码**（机械挂载，任意执行点生效——今晚事故 7
halt 后仍派发 5 个 subagent 的根因就是「连续流程绕过步骤 0」，SPEC-state-crystallization §2.1）：

1. **新派发被代码挡**：`slot-refill.ts`（事件驱动回填 + tick 心跳回填的派发推荐）读
   `<root>/.halt` —— 存在 ⇒ `should_refill=false` + `no_refill_reason` 点名 halt（AC2 实测）。
2. **在飞层被进程级停**：`plugin/scripts/supervisor-preempt.sh preempt <target>` 对目标
   进程/会话发停止信号（TUI 形态 = tmux C-c；`-p` 迁移后 = `kill <pid>`，OS 就是抢占原语，
   AC4/AC5b）；`preempt-all --root <根> --target <层>[,<层>] --pid <pid>[,<pid>]` 在 halt 时对
   全部在飞层发信号。
3. **读哨兵**：`bash plugin/scripts/supervisor-preempt.sh halt-check --root <根>` 输出
   `halted=true|false` + `reason`（fail-closed——读失败 = 停，gap-halt-sentinel-path-mismatch）。

本 tick 每步派发前（步骤 3/4 与槽位回填）都要先问 halt-check/slot-refill——halt 置位即停派，
不等到下一 tick 边界。

**Monitor 挂载自检**（`gap-nothing-checks-whether-the-monitor-is-mounted-or-aimed-right`）：外层靠
`plugin/scripts/session-liveness.sh` 的 Monitor 消费本层停止条件（观测只有一个工具；`inner-state.sh`
已退役）——它没挂上/挂错目标/属于上个会话，本层停摆就没人发现。每个 tick 用一条命令核实，不靠人判断：

```bash
bash plugin/scripts/monitor-mount-check.sh --json
```

两判据缺一不可：`mounted=true`、`targetRoot` 等于本仓根（`targetOk=true`）。2026-08-06 起
`delivered`（AC9 的共享事件文件判据）随共享 events.jsonl 移除——事件送达由挂载方自己的 Monitor
事件流承担（谁挂的谁拥有），不是检查器能读的跨观察者文件。

### 1. 读状态

读队列文件。若与 `git log` / `git worktree list` 不一致，**以 git 为准**并修正文件——文件可能是 compact 前的旧快照。

**收件箱机械挂载点**（`gap-supervisor-message-bus-with-identity` AC4——「文件在、无人读」不再发生）：
显式读 manager 收件箱，有 `unread:` 行 ⇒ 逐条进本轮决策（人/manager 的消息在决策时被调用，不是落盘即完）：

```bash
bash plugin/scripts/supervisor-bus-identity.sh inbox-summary
```

`delivered` = 投递成功（放进了收件箱），`consumed` = 已读回执（人读了）——两者分开（AC3），
unread = delivered − consumed。本步只读不写回执（消费是人的动作，`inbox-reader.sh` 负责）。

### 2. Fan-in 已返回的任务（合并串行，不写任务状态）

**词汇规范（本步与外层 1b 同词，`gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round`）**：
全量验证 + 收尾节奏统一叫 **`verification-round-N`**（外层异步例程，每轮一次全量套件验证 + 收尾记账）。
**`verification-round-N` 只关于验证/收尾，不是分派门控**——分派永远是滚动的（见步骤 4），验证轮的
节奏不约束、不命名、不门控任何一次派发。旧文里把「全量套件批量」当分派单位的说法已随机制根删除。

**只合并与清理，不写任何任务状态。** 全量套件验证已从 inner 移除——它是外层后台异步跑的验证 gate
（`orchestrator-loop-tick.md` 步骤 1b「异步收尾例程（verification-round-N）」），inner 的停止条件
只读外层的 `.quay/full-suite-state.json`（见步骤 3）。inner 在这里**不翻 done、不写轮次记录、
不写 `--task-end`**。

**两线分支模型（quay 自身配置启用；`gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point`，AC1/AC2/AC3）**：
当 workspace 把 `fork_baseline` / `merge_target` 配置为 develop / integration（quay 自身）时，
`$FORK_BASELINE` 不再承担「分叉基线」+「汇入点」双角色（这正是红窗必须停派发的结构根因——两个角色
压在同一 ref 上）。拆成两线：

| 线 | 角色 | 从哪分叉 | 合到哪 |
|---|---|---|---|
| `$FORK_BASELINE`（quay: develop） | 已验证基线（绿，只含通过 verification-round-N 的工作） | 独立任务 | —（只被外层批量合） |
| `$MERGE_TARGET`（quay: integration） | 待验证汇入点（含未验证前序工作） | 声明依赖前序的任务 | 所有任务合并目标 |

- **分叉基线即依赖声明**（AC2）：独立任务从 `$FORK_BASELINE` 分叉；声明依赖的从 `$MERGE_TARGET` 分叉——
  机械判定 `plugin/scripts/fork-baseline.ts`（`--develop "$FORK_BASELINE" --integration "$MERGE_TARGET"`；
  touches 与 `$MERGE_TARGET` 上未验证任务相交 ⇒ `$MERGE_TARGET`）。
- **合并机制**（AC3）：任务合回 `$MERGE_TARGET`（红窗期照常接收——结构性消除停派）；外层
  verification-round-N 批量合 `$MERGE_TARGET`→`$FORK_BASELINE`（fast-forward 无冲突，
  `plugin/scripts/integration-batch-merge.sh --develop "$FORK_BASELINE" --integration "$MERGE_TARGET" --sync --reconcile`）。
- **`integration-batch-merge.sh --reconcile`（主检出对账步骤由脚本提供，`gap-batch-merge-reconcile-destroys-uncommitted-work`）**：批量合是
  REF-LEVEL（update-ref CAS），主检出正检出的分支若就是被推进的 `$FORK_BASELINE`，ref 被从底下换掉后
  HEAD/index 变陈旧。**对账步骤由 `integration-batch-merge.sh --reconcile` 自己提供，调用方不得各自发明**
  （inner 曾发明 `git reset --hard HEAD`，2026-08-08 08:08:24 销毁了 manager 未提交编辑）：ref 移动前先断言
  `git status --porcelain` 为空，非空即失败退出并报出属主；合后 `git reset --mixed <新 tip>` 刷新 index，
  **绝不用 --hard**（`--mixed` 只刷新 index 不碰工作区，未提交内容保留）。**Land 锁边界**：锁防交错不防销毁，
  拿到锁≠能动工作区——共享主检出对账不得覆盖共存会话的未提交内容。
- **对象闸门（`integration-batch-merge.sh` 自带，`gap-batch-merge-gate-validates-tip-not-merge-result`）**：
  批量合前校验**合并结果**不是只验 tip——套件测的是 `$MERGE_TARGET` tip，批量合放行的是
  `$MERGE_TARGET` ⊕ `$FORK_BASELINE` 的合并结果，两者只在 `$FORK_BASELINE` 侧无新提交时才等价。three-dot
  `git diff --name-only <merge-base> <$FORK_BASELINE>`（即 `$FORK_BASELINE` 侧自分歧点起的变更）含代码文件
  （.ts/.js/.mjs/.sh）⇒ **fail-closed 不移动任何 ref、报出文件清单**（该代码从未进过被测树，合并结果会带上
  未测代码）；纯 .md/tasks 文件放行（2026-08-08 报告那 5 个文件）。`$FORK_BASELINE` 侧有代码提交需先
  fan-in 到 `$MERGE_TARGET` 补测再批量合。与 stale-green 不同轴（时间轴 vs 对象轴）。
- **单线（默认）退化**：`$FORK_BASELINE == $MERGE_TARGET == master` 时本节退化为「独立任务从 master
  分叉、合回 master」——`fork-baseline.ts --develop master --integration master` 恒返回 master
  （`master..master` 空，无未验证任务），`integration-batch-merge.sh` 为无操作——与未做 branch cutover
  的下游行为完全一致（AC6 负控制）。
- master 发布线角色**空置**（裁定①：quay 无发布流程、push 需人显式授权；等真有发布授权时语义才实）。
- 依赖约束：**fan-in 合到 `$MERGE_TARGET`，不合并到 `$FORK_BASELINE`**；`$FORK_BASELINE` 只由外层批量合推进。
- **词汇规范（AC2/AC5）**：`verification-round-N` 是**验证/收尾节奏**（批量合 `$FORK_BASELINE`），**不是分派门控**——
  分派是滚动的（不叫批号），规范块见步骤 4。

对每个已返回但未合并的 subagent，逐个：

0. **先 rebase 到当前 `$MERGE_TARGET`**（汇入点，含并发任务合并）：
   ```bash
   git -C $WORKTREE_ROOT/<slug> rebase $MERGE_TARGET
   ```
   worktree 建立时对分叉基线（`$FORK_BASELINE` 或 `$MERGE_TARGET`）取了快照，之后并发合并的其它任务它看不到。
   B3-2 就是这样红的——它的 worktree 建于 B3-1 合并前 13 分钟，于是对全局测试文件计数的断言过期。
   **并发窗口是并发模型固有的，不是偶发**，所以 rebase 是必需步骤不是可选优化。
   rebase 冲突 → 停止该任务的 fan-in，标 needs-human，报告；不要 `--skip`、不要 `-X ours`。
1. `git merge --no-ff task/<taskId>`（合并目标 = 当前检出的 `$MERGE_TARGET`——两线模型下内层共享检出
   立在 `$MERGE_TARGET` 上，不是 `$FORK_BASELINE`；`$FORK_BASELINE` 只由外层批量合推进）
0. **先 rebase 到当前 integration**（待验证汇入点，两线模型——`orchestration/SPEC-branching-model-integration-branch-2026-08-05.md`）：
   ```bash
   git -C $WORKTREE_ROOT/<slug> rebase integration
   ```
   worktree 建立时对**分叉基线**（独立任务 = `develop` / 声明依赖 = `integration`，见步骤 4 的
   `--fork-baseline` 判定）取了快照，之后并发合并的其它任务它看不到。B3-2 就是这样红的——
   它的 worktree 建于 B3-1 合并前 13 分钟，于是对全局测试文件计数的断言过期（该断言形态已由
   `gap-global-count-assertions-fragile-relative-baseline` 改成相对基线判据）。
   **并发窗口是并发模型固有的，不是偶发**，所以 rebase 是必需步骤不是可选优化。
   rebase 冲突 → 停止该任务的 fan-in，标 needs-human，报告；不要 `--skip`、不要 `-X ours`。
1. `git merge --no-ff task/<taskId>` —— **合回 integration**（待验证汇入点；红窗期照常接收合并，
   这是停派被结构性消除的一半）。**不直接合 develop**——develop 只接受外层 verification-round 的
   批量 fast-forward 合并（`orchestrator-loop-tick.md` 步骤 1b）。
2. 冲突 → `git merge --abort`，标 needs-human，**停止本 tick 的后续合并与派发**，报告
3. 跑 `$TEST_COMMAND --for-task <taskId>`（该任务自己的选中集，秒级；`TEST_COMMAND` 见 `.quay/config.yml` `loop.test_command`）
4. 选中集非绿 → 回退该 merge，标 needs-human，停止，报告

合并完成后对每个已合并任务做**合并清理**：`git worktree remove` + `git branch -d`。这只是清理
worktree/分支——翻 done、写轮次记录、写 `--task-end` 都由外层异步做（`orchestrator-loop-tick.md`
步骤 1b），inner 不需要也不应该碰。

**两机协作：合并后释放认领（`gap-two-machine-collaboration-git-branch-claiming`）**——若本任务派发时
经认领协议认领过（`QUAY_CLAIM_REMOTE` 设置了共享裸仓库），合并进 `$MERGE_TARGET` 后**释放认领**：
`bash plugin/scripts/release-task.sh <taskId> --remote "$QUAY_CLAIM_REMOTE"`（合并+删分支=释放，
`merge + delete = release`）。释放只删共享仓库上的 `task/<id>` 认领标记，不碰已合并进 `$MERGE_TARGET`
的工作——下台机可再认领该任务。未设置 `QUAY_CLAIM_REMOTE`（单机）⇒ 跳过，无行为变化。

**全量套件验证为什么不在 inner 跑**：旧的「全部合并后跑一次全量」+「绿 → 写任务状态」就是批次
同步点——同步期间零新派发，写状态变成调度边界。全量 gate 移给外层后台异步跑（验证 gate，见步骤 3
的停止条件），inner **只读** `.quay/full-suite-state.json` 的 `state`、只保留逐任务的 `--for-task`
选中集把关（秒级）——**inner 零全量套件自跑**（DoD grep 证明：本文件无任何全量套件自跑命令字面量，
只读外层 suite-state）。

**阈值决策规则（AC5，门槛机械化，与外层文档同一份规则）**：测全量套件耗时 `suite_duration` =
`.quay/full-suite-state.json` 的 `durationMs`（外层 runner 每次跑完写入，即测量 hook）：
- `suite_duration ≥ 3 分钟` ⇒ **outer 集中后台跑**（当前形态，实测 11-12 分钟量级）——inner 只读
  state；
- `suite_duration < 3 分钟` ⇒ **下放 inner 各任务自己跑**（批概念彻底消除）——那时 inner 恢复全量
  自跑，外层停止集中跑。
一旦阈值判定成立，按该形态执行；当前实测明确 ≥3 分钟。

**三块消除批次（AC7）**：本条读 suite-state 的机制属 **(a) 套件块**；收尾/记账 **(b) 块** =
`gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async`（已落地）；AC/证据
**(c) 块** = `gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence`
（在队列）。三块合起来，inner 侧只剩「执行 → 合并」，没有任何批次同步点。

**合并本身必须串行。** 并发合并会在共享工作树上撞车。

**worktree 隔离的传播代价（2026-08-03 观察）**：主检出的紧急修复**不会自动传播**到在飞任务的 worktree——
每个 worktree 有自己的测试 runner 等副本。这次是好事（隔离生效），但也意味着一个紧急修复要**显式同步
进每个在飞 worktree**（把 `$TEST_COMMAND` 对应的 runner 脚本复制进 `$WORKTREE_ROOT/<slug>/` 对应位置），否则在飞任务会继续用旧行为跑完
（实例：并发默认推导改为 1 后，主检出已修复回 8，但 sigma worktree 仍在串行跑 ~52 分钟）。派发/协调时要检查
在飞 worktree 是否有需要同步的主检出修复。

### 3. 检查停止条件（机械——`--detect-stop` 本身就是落盘）

跑这条命令作为停止条件的**机械检查**（取代纯散文清单）。**先抓自己的 pane 再传给 `--pane`**
（`gap-ruling-required-trigger-is-dead-code-never-wired-into-any-tick`——`ruling-required` 的主判据
是屏幕观察者，不是 `--transcript`）：

```bash
tmux capture-pane -p -t "$TMUX_SESSION" > .quay/last-pane.txt && \
node --no-warnings --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --pane .quay/last-pane.txt
```

**面板冻结行观测（`gap-inner-panel-shows-frozen-stale-agent-line-after-bracket-close`）**：同一
`last-pane.txt` 再喂给 `inner-panel-stale-check.ts`（面板观测机制，状态转换表达）——括号关闭
（`--task-end`）后该任务的 agent 行若仍残留且计时冻结，必须被机械检出（不是等人跨时间采样猜）：

```bash
node --no-warnings --experimental-strip-types plugin/scripts/inner-panel-stale-check.ts \
  --pane .quay/last-pane.txt --root "$REPO_ROOT" --json
```

exit 1 = 面板仍有「已结束/冻结」agent 行（括号已关但行未清）⇒ 检出该误导窗口；exit 0 = 干净。
（`inner-session-check.sh` 判的是会话四态，本观测器判的是面板行状态——两件事，不混。）

它做什么（gap-the-blocked-channel-has-a-writer-nobody-calls——触发是**后果**，不是「记得再跑一条命令」）：

- **机械检测**可判定条件：**合并冲突**（git 有未解决路径）、**任务超 90 分钟**（遥测
  in-progress > 90m）。任一成立 ⇒ **自动**写入 `.quay/inner-blocked.json`（带 `reason` + 可行动
  `question` + `evidence`，`source:"auto"`）——**写入是检测本身的后果**，你跑的这条命令就是停止
  条件检查，不存在「忘了写阻塞信号」这回事。**OVER90 注意（2026-08-05 起，`gap-telemetry-brackets-
  vs-subagents-no-slot-visibility` AC8 起加强）**：遥测括号由外层异步闭合（`orchestrator-loop-tick.md`
  步骤 1b 的 `--reconcile`），in-progress 会因此多算至多一个外层 tick 的滞后——命中 OVER90 时先核对
  是不是「外层尚未闭合该括号」而非真超时，避免把运行 70–90 分钟的任务误判。**over-90m 判据本身已
  reconcile 感知**（`detectTaskOver90m` 只对「工作已落地」——任务分支已 merge/有 merge record——的
  括号跳过）：一个 fan-in 已落地、只是 `--task-end` 未写的任务不再触发假 over-90m。
- **`ruling-required` 的屏幕观察者（`--pane`）**：`classifyPaneState` 只读 pane 的**底部区域**
  （输入框 + 状态行，ADR-016 修订 boundary b——**不做整屏哈希**），分类成五态之一。连续
  `INNER_BLOCKED_RULING_SAMPLES`（默认 3）次 `waiting-input` / `permission-prompt` ⇒ 写
  `ruling-required`（可行动 `question` + 底部区域 `evidence`）。60s 轮询 × 3 采样 ≈ 3 分钟
  结构上界 ≤ 5 分钟 p100 预算（裁定 C，AC2）。`busy` / `error-banner` / `unknown`、pane 文件缺失、
  或显式 `--clear` 都**重置**滚动计数（AC4 双向负控制）。`--transcript` 保留但**不再是主判据**
  （AC3）——它只在 pane 观察者没产出时作为「会话真的死了」的旁证触发。
- **在飞 agent 消歧（外层裁定 2026-08-04）**：`waiting-input` 只在**没有在飞后台 agent** 时算
  needs-input 采样。状态区出现「← N agent」（N>0）/ `general-purpose` / `subagent`，或遥测有在飞
  任务 bracket（`--task-start` 未闭合）⇒ 是**良性空闲**（等自己的后台 agent），不是等人类裁定——
  不计数、不写块（实况误报修复）。`permission-prompt` 恒为人类等待形状，不被抑制。
- 全部不成立 ⇒ **自动清除**先前由本命令写入的 auto 阻塞记录；**绝不**清除手动
  （`--assert-blocked`，judgment 条件）的阻塞——那需要显式 `--clear`（AC3 负控制）。
- 输出列出命中的条件（`--pane` 给到时，`pane_decision=...` 行是判定分支字段）；**命中任一 ⇒
  不派发新任务，报告后重新排程**。

**无法从仓库状态机械判定的条件**（本 tick 判断后同样要落盘，见「阻塞信号」节）：
- `.halt` 存在 —— **不写阻塞信号**（外层主动暂停，不是「等裁定」；写了一个小时后
  `restart-readiness-check.sh` 检查 7 会因「内层在等裁定」拒绝解除停机，死锁）
- **窗口内新增** needs-human ≥ 3（2026-08-03 外层裁定：**不是总数**——历史积压不构成停止理由，
  它需要派发才能解开；意图是「产出 needs-human 的速度超过消解速度」。判据是**窗口内新增数**，
  不是仓库里 needs-human 的总数。分诊规则见 `orchestrator-loop-tick.md` 步骤 3）
- **外层全量 suite 状态（改读外层 suite-state，不再自己跑全量）**：读 `.quay/full-suite-state.json`
  的 `state` 字段——`running`/`green` ⇒ 照常派发与合并（**RUNNING 不等套件**——这正是消除同步点的
  关键）；`red` 则**看 `reason` 轴**（`gap-full-suite-runner-concurrency-default-and-gate` AC5，
  2026-08-05 ABORT #5 第二次实证：12 个互不相交任务全被 aborted-red 挡住）：
  - `state: red` 且 `reason: failed`（或缺失——兼容旧记录，fail-closed 当失败）⇒ **一律暂缓
    `$MERGE_TARGET`→`$FORK_BASELINE` 的批量合**（两线模型 AC3：`$FORK_BASELINE` 是已验证基线，绝不被
    未验证树推进——这是结构性消除红窗停派的关键；任务合 `$MERGE_TARGET` **不受**红窗阻挡，红窗只挡
    `$FORK_BASELINE` 的推进，见步骤 2「两线分支模型」），直到外层 re-green（state 回到 green/running）。
    **新派发按失败位置条件化**
    （`gap-red-window-dispatch-stop-should-be-shared-gate-conditional`，共享闸门规则——与
    `orchestrator-loop-tick.md` 步骤 1b 同一份规则，不是两份）：
    - 失败落在**共享闸门（`run_static_checks`——每次 scoped 运行都跑的静态检查）** ⇒ **停新派发**
      （所有新任务都被同一个红污染）；
    - 失败落在**具体测试文件**且与新任务触摸集**无关** ⇒ **派发继续**（新任务 worktree 是独立
      `$FORK_BASELINE` 副本、跑自己 scoped 测试，与别处的红无关）；
    - 失败文件与新任务触摸集**相交** ⇒ 该任务停派（下一 tick 再评估）。
    判定信息现成：`state.failures`（早期 RED 失败行 + 文件上下文）→ 共享闸门 vs 具体测试 → 与新任务
    touches 相交性（用既有 `parseTouches`/`matchGlob`）；可机械执行的判定函数 =
    `suite-state-trigger.ts` 的 `shouldDispatchOnRed(state, touches)`。无法判定失败位置（legacy red /
    未知）⇒ **保守停派发**（fail-closed）。
  - `state: red` 且 `reason: aborted`（套件**未完成、无任何正确性结论**——被外层中止/信号杀/spawn
    失败）⇒ **不触发 stop-dispatch**，照常派发与合并——把 aborted 当 failed 处理 = 用一个中止事件
    挡住全线派发，且不会自解除（re-green 需一轮成功套件，套件因缺陷跑不完 ⇒ 闭环）。
  **文件缺失 ⇒ 不阻塞**（外层还没跑到第一轮，不是套件红；等下一 tick 再读）。注意该状态有至多一个
  外层 tick 的滞后——inner 刚合并的任务可能还没被外层起的新一轮套件覆盖；这是异步设计的固有窗口，
  外层下一轮会追上（见 `orchestrator-loop-tick.md` 步骤 1b「红窗分诊」）。**inner 零全量套件自跑**
  （只读上面的 state；`--for-task` 选中集仍逐任务把关，秒级）。
- 就绪队列为空
- 对抗审查 2 轮后仍 REFUTED、队列文件与 git 状态矛盾且无法判定（判断边界表）

### 3.5 计量（强制，不可跳过）

派发前对每个任务：

```bash
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --task-start --taskId <id>
# 记下打印的 runId
```

inner 只写 `--task-start`。**`--task-end`（关遥测括号）由外层异步写**（`orchestrator-loop-tick.md`
步骤 1b），inner 不需要也不应该调它——`--report` 的 `inProgress` 在外层闭合前会显示在飞，这是预期。
**派发/收尾这对调用就是遥测从「历史归档」变回「当前状态」的机制**（`gap-telemetry-brackets-vs-
subagents-no-slot-visibility` AC4）——本步的 `--task-start` 是派发时的开括号，外层 1b 的 `--task-end`
/ `--reconcile` 是收尾时的关括号；缺任一半，遥测就退化成只记录历史。

**括号 ≠ subagent（`gap-telemetry-brackets-vs-subagents-no-slot-visibility`）**：`--report` 的
`inProgress` 是括号视角——红窗遗留的未闭合 start 会让它虚高。要看**真实并发/空槽**，用
`--slots --cap "${effective_cap:-3}"`（纯读，不写盘）：`real_in_flight` 是执行者仍存活的括号数，
`stale_brackets` 是 `--reconcile` 会闭合的幽灵括号数，`slots_free = max(0, cap − real_in_flight)`
——「还剩几个并发槽」机械可见（AC2）。

**括号关 ≠ 进程退（`gap-closed-bracket-leaves-live-agent-consuming-slots`，反向维度）**：`--task-end`
写了（括号关）只证「记账上不在飞」，**不证 agent 进程退没退**——两者独立。`--slots` 的 `closedButLive`
/ `occupied_slots`（= `real_in_flight` + 已关括号但 executor 仍存在者：worktree 未清 / 进程未退）
把「关是关了、进程还活着」显式报出来：`occupied_slots` 才是真实占用，`slots_free = max(0, cap −
occupied_slots)`。**别把已关括号的槽当空**——executor 仍在就不许派新任务进去（AC3 负控制）。

**这不是可选步骤。** 工具在 B2-1 造好并合并了，但截至 2026-08-02 11:08 `--report` 返回
`{tasks: [], tasksPerHour: 0}`——一次都没被调用过。所有耗时数字仍靠 commit 时间戳反推，
正是这个工具本该消除的考古。

没有计量，「1 任务/小时」无法判定，也无法知道任何优化是否真的有效。

**派发前先读一次空槽信号（AC2/AC5）**——「还剩几个并发槽」必须机械可见，不靠内层手写叙事：
```bash
node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slots --cap "${effective_cap:-3}"
# real-in-flight N / slots-remaining M；dispatchable_disjoint（步骤 3.6）− realInFlight = 槽位级闲置
```

### 3.6 就绪池维护（晋级节奏是机制，不是角色自觉——强制）

**就绪池 < floor 时，本 tick 内从 todo 补晋到 ready。** 晋级节奏与优先级曾只活在外层的**自愿 AC-queue**
（`orchestration/outer-phase-goal.md` 的旧 AC-queue）——角色自觉，换会话/模型就丢。**现在是 tick 调用的
子机制**（`gap-promotion-cadence-is-role-volition-not-product-mechanism`），任何未来冷启动本项目的会话
都会继承它。**顺序由脚本承载，不是散文。**

**前置：先算自适应并发上限（`gap-adaptive-concurrency-cap-tied-to-resource-gate`）——派发决策点的资源读取，
每 tick 只算一次，本步（floor）与步骤 4（派发上限）共用。** cap 不再是固定 3，而是
`cap = f(resource-gate)`：在派发时刻读 `/proc/pressure/cpu` **`some avg10`**（10 秒窗口——信号语义见下），
带**滞回**（连续 2 次同向才切档，单次采样不触发——负控制；采样点在派发时刻、间隔 25 分钟量级，所以
avg10 的快窗被滞回压成慢切换——2 次同向 = 持续负载，不是瞬时抖动），档位数字由项目配置
`.quay/config.yml` `loop:concurrency_bands` 给出（quay 默认 GO=5 / WAIT=2 / EXTREME=1，下游可覆盖如
4/2/1；机制共用、数字各项目定）。**信号语义（`gap-cap-from-gate-avg300-driven-by-claude-session-churn-
structural-cap-2`，2026-08-08 外层实测）**：`some avg300`（5 分钟窗）被 claude 会话常驻 churn 主导——
稳定 50-55、恒 > 旧 WAIT=40，且对派发类负载不跟随（4 核满载注入 30s：avg300 只 +1.5pt、avg10 +26pt；
撤载后 avg300 几乎不动）——avg300 驱动的 cap 结构性锁 WAIT=2，节流派发无法缓解。因此**信号改用 `some
avg10`（对真实过载响应），阈值抬高以剔 churn 基线**：avg10 < 60 → GO；60..85 → WAIT；≥85 → EXTREME。
60 高于实测 churn 基线（avg10 42-54）、低于实测真实过载读数（4 核注入 avg10=68）——阈值抬升即「剔 churn」
（候选 A 思想），avg10 即「对真实过载响应的信号」（候选 B 换信号的实测选型；`full avg300` 实测恒 0、
连满载都不响应，弃用——不选固定减法，churn 基线随会话启停漂移）。信号不可测（内核无 PSI）⇒ 落到最低档
（fail-closed，绝不静默维持高并发）。**交叉标注（AC8）**：信号源
`resource-gate.sh`、同决策点的触摸不相交判定 `concurrent-batch-scheduler.ts`（步骤 4 并发资格）、
容器化硬限额上位解 `orchestration/SPEC-isolation-and-resource-governance-2026-08-05.md`。

```bash
effective_cap="$(bash plugin/scripts/cap-from-gate.sh 2>/dev/null | sed -n 's/^effective_cap=\([0-9]*\)$/\1/p')"
# Contract 的读取形态：`bash <cap-from-gate-helper> 2>&1 | grep -o '[0-9]'`（stdout 数字段）；
# sed 提取是同一 stdout 的健壮写法（effective_cap= 行是末行）。空值 ⇒ 重跑一次看 stderr。
# 槽位帽已接跨层总预算（gap-test-concurrency-cap-does-not-scope-nested-spawns AC1/B 面）：
# effective_cap = min(档位cap, max(1, available))——available 来自 process-budget.sh（全仓
# node --test 进程预算 = nproc，减去已在跑的 node-MainThread 数）。预算耗尽 ⇒ 落到 1。
```

```bash
node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --cap "${effective_cap:-3}"
```

- stdout 是 JSON。**`pool` 字段 = 真实就绪池**：`status: ready` 且排除三类
  （① 本回合已派发完未翻 done 的——AC 全勾但 status 仍 `ready`；② `labels: fixture` 的；③ 带 `**PARKED`
  标记的）。**`floor` 字段 = cap × 4**（GO 档 cap=5 ⇒ floor 20；WAIT 档 cap=2 ⇒ floor 8；EXTREME 档
  cap=1 ⇒ floor 4；`--cap` / `--floor-mult` 可调）。`pool ≥ floor` ⇒ 无需补晋，直接进步骤 4 派发。
- **判据是 `dispatchable_disjoint` 不是 pool 数**：脚本同报**池内最大互不冲突子集大小**
  （两两 `checkTouchesPair` disjoint，用派发闸同一个 declared-path expander）。**`dispatchable_disjoint
  ≥ cap` 才是「池够用」**——池 5 条全不冲突就够了；池 30 条全撞（`pool ≥ floor` 但
  `dispatchable_disjoint < cap`）机制自报 `POOL BIG BUT ALL COLLIDING`，仍要补晋/排障。floor 是手段、
  `dispatchable_disjoint` 是结果。
- **`pool < floor` ⇒ 按 `promotions` 数组补晋**（数组顺序就是定义好的顺序：**触摸不相交排最前**——
  与池内已有候选 + 在飞任务两两 `checkTouchesPair` 不相交者优先；`gap-*` 缺陷 > `DIR-*` 新能力作次
  tiebreak；同类里 touches resolve 的排前）。对每个候选：**缺四件套的先补齐**（`missingArtifacts`
  字段点名缺哪个），再 `status: todo → ready`。`touchesResolve: false` 的候选**不派发、不补晋**
  （解析不了的候选踢出，大池只白晋级不污染——ADR-022 教训）。
- 补晋落盘后，步骤 4 就用这份就绪池派发——不再重复判定 promotion 顺序，只需做步骤 4 自己的并发资格
  （`checkTouchesPair`）与触摸可解析性复核。
- **成本不对称（AC6，偏向过量）**：过量晋级 = 前移非浪费（池更深，下个 tick 直接派）；欠量 = 空槽纯浪费
  （当 tick 无人可补）。floor 取 cap×4 已留这一档余量。
- **定向晋级 `--targeted` 是外层工具，内层不用**（`gap-targeted-promotion-operation-does-not-exist`）：
  `ready-pool-check.ts --targeted <id>` 是外层按阶段目标挑选 todo 任务的机械承载——**不受 `pool<floor`
  约束**（阶段目标要的任务被补充门挡在 todo 时，外层用这条路径把它提出来，`quay promote <id>`）。
  **内层不知道阶段目标**：本步只做机械补充（`pool < floor` 的 `promotions[]`），不调用 `--targeted`。
  职责切分：晋级（选择，需要阶段目标）= 外层；派发（机械，只需 touches/cap/停止条件）= 内层。

### 3.7 例常例行（routine track）——周期探针发现（AC3，gap-delivery-outline-vs-verify-surface-single-source）

**这是产品里唯一「主动去找缺陷并建议任务」的机制（pre-friction 发现）**。判据见
`docs/proposals/quay-product-outline.md` §3.5。**接线状态（2026-08-08 修复）**：routine-scheduler.ts
的唯一调用方曾是退休的 loop-driver SKILL（活 tick 文档零命中）——本步骤把 routine track 接回活文档。

1. **读例常配置**：`.quay/config.yml` `loop.routines:`（`readLoopParams` 校验；`config-wiring-check.ts`
   钉「有配置必有人读」）。默认 `[]` = 无例行 → 本步空转。
2. **调度**：把 routines 写成临时 JSON，跑
   `node --no-warnings --experimental-strip-types routine-scheduler.ts --iteration <tick 计数> --event checkpoint --plugin-root "$CLAUDE_PLUGIN_ROOT" /tmp/routines-<tick>.json`
   ——exit 0 = 有 DUE；exit 3 = 无 DUE（`every(N)` 的 N 以 tick 计数计，不再用退休管线的「迭代号」）。
3. **派发**：对每条 DUE routine，用 `read-probe-spec.ts` 读 `<plugin-root>/probes/<name>.md` 的 spec
   （instrument / fallback / objective）；instrument 可用才派后台 subagent，不可用且 `fallback: none` 则跳过。
4. **闸门 + FILE-ONLY**：findings 走 `routine-file-gate.ts`（新颖性 / 去重 / 限流）；只产新任务文件
   （`tasks/`），改任何产品/方法代码 = 违规丢弃。

`quay:run-routines` skill（`plugin/skills/routines/SKILL.md`）是这条 track 的操作化承载——本步调度它
即可，不必手抄流水线；routine-scheduler.ts / read-probe-spec.ts / routine-file-gate.ts 随 --loop 铺入目标
（机制语料裸名解析，见 quay-init.sh 的 derive_loop_scripts）。

### 4. 派发就绪任务（并发）

**派发评估有两个触发源，走同一步、同一道闸**：① tick 边界（本步随 Tick 步骤执行）；② 完成事件——
任一在飞 subagent 完成释放槽位时，由「事件驱动派发（槽位回填）」节触发，**立即**重评估（不等下一 tick）。
两者共用下面的并发上限、逐候选检查与派发形态。

**tick 心跳必须无条件先跑 slot-refill**（`gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat`）：
每 tick（含轻触）先跑 `node --experimental-strip-types plugin/scripts/slot-refill.ts --root "$(pwd)" --cap "${effective_cap:-3}" --in-flight <本会话在飞集合> --closed-but-live <--slots 的 closedButLive 任务id，可空>`——
`should_refill=true` 且 `recommended` 非空 ⇒ 按 `recommended` 逐候选走下面 1-6 检查后派发，**不等完成事件**；
`should_refill=false` / `recommended` 空 ⇒ 本 tick 不派发（负控制，AC4）。步骤 3 停止条件仍优先——命中任一 ⇒ 不派发。

**词汇规范（AC5，`gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round`）**：
**分派是滚动的，不叫批号**——任何给分派编批次号的措辞都该是历史引用或错误；
`concurrent-batch-scheduler.ts` 输出的 `{batch, deferred}` 字段是机件真名，不是分派门控。
**全量验证/收尾节奏叫 `verification-round-N`**（关于验证/收尾，不是分派门控）。未来会话
（含换模型后）沿用拆分词汇。
**槽位释放回填（slot-release refill）——派发是事件驱动的，不是 tick 边界驱动的（`gap-dispatch-
evaluated-only-at-inner-tick-boundary-not-slot-release`）**：任一在飞 subagent 完成 → harness 发
`<task-notification>` 重新唤起会话 → **本回合立即执行本步的派发评估（槽位释放回填），不等下一 tick**。
完成通知就是派发触发器；tick 心跳只是兜底（「会话 turn 结束了但队列还有活」时推进一次），不是派发节奏。
**tick 间隔（20–25 分钟）不再是派发节奏**——把派发节奏当 tick 间隔，就是本文档自己警告过的退化形态
（瓶颈从外层搬到 inner 自己的 tick：实测派发=3 簇 tick 边界、槽位空 39 分钟而池子 health）。

**回填评估是机械的一条命令（slot-refill，纯评估，绝不自己派发）**——每次收到完成通知，先跑回填评估，
GO 才走下方的候选资格（1-4）与派发：

```bash
bash plugin/scripts/slot-refill.sh --root "$(pwd)"
# REFILL GO: slots-remaining M, dispatchable_disjoint N  ⇒ 走下方候选资格后派发
# REFILL NO-GO: <reason>（cap 已满 / 池空 / .halt / 空槽不可知）⇒ 不派发，本回合到此为止
```

评估组合的读取与步骤 3.5/3.6/4 同一套（slot-refill.ts 组合它们，不另造平行实现）：
`cap-from-gate.sh`（effective_cap，**机制/策略分离——档位数字仍由项目配置，AC5**）+
`fast-mode-telemetry.ts --slots --cap`（realInFlight / slots-remaining，**reconcile 感知——括号 ≠
subagent**，`gap-telemetry-brackets-vs-subagents-no-slot-visibility` AC3/AC6，事件驱动依赖准确的完成
感知）+ `ready-pool-check.ts --cap`（pool / dispatchable_disjoint）。**负控制（AC4）**：slot-refill
只在两类时刻被调用——(a) 完成通知到达（事件驱动）；(b) tick 心跳（兜底）。**它不自排程、不轮询、不双
驱动**——无完成事件的时段零派发（除 tick 心跳本身）。**并发上限语义不变（AC5）**：回填同样遵守「至多
`effective_cap` 个在飞 subagent」，只是让派发发生得更早。

**并发上限 = 步骤 3.6 前置块算出的 `effective_cap`（自适应，非固定 3）**：`cap-from-gate.sh` 在派发
决策点读 `some avg10`（10 秒窗口；avg300 已被实测为 churn 主导的死信号，弃用——见步骤 3.6 前置块信号语义）
+ 滞回 + 档位配置（GO=5/WAIT=2/EXTREME=1，可配置），资源空时 GO 档 ≥3（吞吐较固定 cap=3 提高，AC5），
高负载（avg10 ≥60，实测真实过载读数）自动回落 WAIT/EXTREME 档（不加重，AC6）。**churn 剔除靠阈值抬升
不靠固定减法**——avg10 的实测 churn 基线 42-54 落在 GO 带内，不再像 avg300 那样把 cap 结构性锁在 WAIT=2。
**槽位帽再受跨层总预算钳制（`gap-test-concurrency-cap-does-not-scope-nested-spawns` AC1/B 面）**：
`effective_cap = min(档位cap, max(1, available))`——available 来自 `process-budget.sh`
（全仓 node --test 进程预算 = nproc，减去已在跑的 node-MainThread 数）；预算耗尽 ⇒ 槽位帽落到 1，
饱和主机不再派发。**滞回已修僵死（AC3）**：consecutive 计数在 WAIT/GO 交替下**累加而非被同向样本清零**，
且仅在偏离陈旧（>90 分钟）时归零——223 分钟僵死（cap 停在 GO 穿过 EXTREME 峰值）不再复现。
本 tick 只派发**至多 `effective_cap` 个在飞 subagent**。并发是打破「外层变瓶颈」的手段——串行时外层的
20 分钟 tick 频率会和任务完成频率同量级，分层退化成单层加延迟。

派发前对每个候选：

1. **触摸可解析性**（gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files，
   AC2）：`checkTouchesResolve`（`plugin/scripts/touches-orthogonality-check.ts` 的 `--resolve`
   模式）对每个 `status: ready` 候选检查其 `## Touches` 是否能在真实树中解析。ADR-022 删除了
   经典管线文件后，8/9 个 ready 任务的 Touches 整体指向不存在的文件，而 `checkTouchesPair`
   只查两两重叠、**不查文件存在性**——这就是这组任务漏过资格闸的原因。`(new)`/`(delete)`
   标记豁免（前者是任务将创建的文件、后者是任务将删除的文件，都不必已存在）。
   **多数未标记条目缺失 ⇒ 该候选不具备派发资格**：标 needs-human、记录理由，不派发
   （exit 1 即不派发）：

```bash
node --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts --resolve tasks/<id>.md --root "$(pwd)"
# 输出每条目 ok/MISSING；末行 RESOLVE ... MAJORITY-MISSING (NOT dispatchable) + exit 1 ⇒ 不派发
```

2. **依赖就绪**：父任务 done、无未满足前置。用 `it0-split-or-commit-check.ts` 的
   PARENT-DONE-IFF-CHILDREN 语义，不自己重新发明
3. **并发资格**：用生产入口 `concurrent-batch-scheduler.ts` 对**所有在飞任务和彼此**两两检查。
   生产入口自 `gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet` 起已按**声明路径**
   判定（`expandDeclaredTouches`）：具体路径不论是否已存在都直接参与比较（任务将创建的
   `(new)` 文件不会被误判成「matched nothing / likely a typo」），只有通配符才落到文件系统展开。
   此前手写的 `expand`（`normalizePath` + 剥注解）已删除——直接用生产入口即可：

```bash
node --experimental-strip-types plugin/scripts/concurrent-batch-scheduler.ts --root "$(pwd)" tasks/<A>.md tasks/<B>.md --json
# 输出 { batch, deferred }（batch/deferred 是 concurrent-batch-scheduler.ts 的机件输出字段名）。
# 两者都在 batch ⇒ disjoint，可并发/无触摸重叠，非门控分批；
# deferred 的 reason 里 `(overlap: <file>)` 指名冲突文件（两个任务要创建同一个文件也会指名）。
```

重叠 → 不同时派发，等下一 tick（**分派是滚动的，不是攒批门控**）。**不要凭读 Touches 列表目测**——本会话有过目测判断被实测推翻的先例。
# 输出 { batch, deferred }（`batch`/`deferred` 是机件输出字段名，保留）。两者都在 batch ⇒ disjoint，
# 可并发/无触摸重叠，非门控分批；
# deferred 的 reason 里 `(overlap: <file>)` 指名冲突文件（两个任务要创建同一个文件也会指名）。
```

重叠 → 不可并发，等下一 tick。**不要凭读 Touches 列表目测**——本会话有过目测判断被实测推翻的先例。

4. **分叉基线判定（两线模型 AC2，`gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point`）**：
   派发前用 `fork-baseline.ts` 判定每个候选从哪条线分叉（**分叉基线即依赖声明**——独立 →
   `$FORK_BASELINE`、声明依赖 → `$MERGE_TARGET`，机械可查；分支名**从配置代入，不字面写死**）：

```bash
node --experimental-strip-types plugin/scripts/fork-baseline.ts --task tasks/<id>.md --root "$(pwd)" --develop "$FORK_BASELINE" --integration "$MERGE_TARGET"
# stdout: $FORK_BASELINE（独立，从已验证基线分叉）或 $MERGE_TARGET（依赖未验证前序，从待验证汇入点分叉）
```

   worktree 建立命令相应取该基线：`git worktree add $WORKTREE_ROOT/<slug> -b task/<id> <基线>`。
   这保证**新工作永不从未验证的树上分叉**——`$FORK_BASELINE` 永不包含未验证前序，红窗停派由此结构性消除
   （`fork_baseline_is_dependency = 1`）。

5. **自身文件授权（self-touch，`gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence`）**：
   每个任务的 `## Touches` 必须含**它自己的任务文件** `tasks/<id>.md`——**不带 `(new)` 标注**（带
   `(new)` 会误触 `hasAnyLandedNewTouch` 的 new-touch 路径，把每个任务都判成「工作已落地」、
   破坏就绪池）。自身文件是任务代理完成时编辑自己任务文件（勾 AC + 贴证据）的**授权**；缺它 ⇒
   **不派发**（先给 Touches 补 `tasks/<id>.md`）。**只允许自己的文件，禁止碰其他任务文件**（并发
   资格仍由 checkTouchesPair 判：自身文件每任务唯一，A.md≠B.md ⇒ 仍 disjoint）：

```bash
node --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts --self-touch tasks/<id>.md --root "$(pwd)"
# 输出 SELF-TOUCH ... ok + exit 0 ⇒ 可派发；MISSING ... + exit 1 ⇒ 不派发
```

   就绪池整体核验用 `--self-touch-scan`（AC1 静态检查）：
   `node --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts --self-touch-scan --root "$(pwd)"`
   ——任一 ready 任务缺自身文件 ⇒ exit 1（先补，否则该任务不可派发）。

6. **两机认领（跨主机互斥，`gap-two-machine-collaboration-git-branch-claiming`）**：两机协作时
   （`.quay/config.yml` `loop:` 未配置、但环境变量 `QUAY_CLAIM_REMOTE` 指向**共享裸仓库**），派发前
   **先认领**本任务：

   ```bash
   bash plugin/scripts/claim-task.sh <id> --remote "$QUAY_CLAIM_REMOTE" --check-touches
   # claimed            → 可派发（空 task/<id> 分支已推到共享裸仓库）
   # already-claimed    → 对方在飞，不派发本任务
   # touches-overlap    → 与对方在飞任务触摸相交，不派发本任务（AC2，换一个任务）
   ```

   认领 = 把空 `task/<id>` 分支推到共享裸仓库：**git 是唯一真正跨主机共享的状态存储**（遥测
   inProgress 文件与 worktree 目录都是本机的，B 机看不到；`task/*` 分支双方 `git ls-remote` 都可见）。
   推送本身是**原子互斥**（同任务两机抢认领，一成一败——git 的非快进拒绝就是 CAS）。`--check-touches`
   复用单一来源 `checkTouchesPair`（`plugin/scripts/claim-task.ts`）与本机 `tasks/<peer>.md` 对共享仓库
   `task/*` 分支判触摸相交——**与单机串行是同一个约束，只是提前到认领时**。任务合并进 `$MERGE_TARGET`
   后由步骤 2 释放认领（`release-task.sh`）。**单机（未设置 `QUAY_CLAIM_REMOTE`）⇒ 认领步骤为 no-op，
   直接跳过**——现有单机派发零回归（claim-task.sh 无 remote 时 fail-closed 退出 2）。

派发形态：**后台 `Agent(run_in_background: true, ...)`——`run_in_background` 必须是 `true`**
（`gap-two-thirds-of-a-task-is-polling-a-suite-log` AC1b：前台派发阻塞内层到全部在飞返回、拿不到先完成者的
早期反馈、期间什么也做不了，`<task-notification>` 唤醒流永远不会被触发——那是本仓实测等待的另一半来源，
见 `orchestration/SPEC-cut-the-waiting.md`。同一条消息里发多个 `Agent` 调用拿到的并发是 harness 并发执行，
不是后台派发）。

**分叉基线（两线模型，AC2——分叉基线即依赖声明；`orchestration/SPEC-branching-model-integration-branch-2026-08-05.md`）**：
subagent 用裸 `git worktree add` 自建 `$WORKTREE_ROOT/<slug>`（磁盘，不在 `/tmp`——tmpfs 是内存，
`worktree_root` 见上）和 `task/<id>` 分支，**分叉点由
`plugin/scripts/integration-branch-model.ts` 的 `forkBaseline` 机械判定**：
```bash
UNVERIFIED_IDS=$(node --experimental-strip-types plugin/scripts/unverified-integration-task-ids.ts --root "$(pwd)")
node --no-warnings --experimental-strip-types plugin/scripts/integration-branch-model.ts \
  --fork-baseline tasks/<id>.md --overlaps-unverified "$UNVERIFIED_IDS" --root "$(pwd)"
# 输出 develop（独立，默认）或 integration（声明依赖 / touches 与未验证任务相交）
```
  `--overlaps-unverified` **不得传空串**（`gap-ac19-two-line-model-actually-runs` AC3：空串使
  `integration-branch-model.ts:47` 的 `overlapsUnverifiedIntegration` 路径恒假——机制半死）；未验证任务 id 由
  `unverified-integration-task-ids.ts` 从 `git log --oneline develop..integration`（fan-in 合并信息）
  机械提取——即 `integration-branch-model.ts:139` 的 Contract invoke，内层无需记忆来源。
- **独立任务（默认）→ 从 `develop` 分叉**（已验证基线，绿）
- **声明依赖前序任务 / touches 与 integration 上某未验证任务相交 → 从 `integration` 分叉**
  （含未验证前序；`--overlaps-unverified` 传 `unverified-integration-task-ids.ts` 提取的未验证任务 id，
  helper 做 touches 交集）
- **develop 永不从未验证树分叉 ⇒ 红窗停派结构性消除**（AC3）；「基线陈旧只对触摸集相交的任务造成
  麻烦，而相交任务本来就该串行」——与 checkTouchesPair + disjointness 排序是同一个约束（SPEC §3）。
- worktree 建立后内部起独立对抗审查（硬上限 2 轮），**只提交不合并**。
`milestone-worktree.ts` **不可用**——它要求数字 M 号，gap 任务没有；用裸 `git worktree add`。

**任务代理完成时编辑自己的任务文件（AC2 派发词约定，`gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence`）**：
任务代理提交前编辑 `tasks/<id>.md`（它自己的任务文件，Touches 已授权）：**勾 AC 复选框**（它实现了、
自己跑过 scoped 测试，有全部事实）+ **贴 invoke 实跑证据**（自己 scoped 测试的输出）。**仍 SCOPED ONLY**
（不跑全量 suite——全量判据归外层 verification-round-N，见步骤 2 词汇规范）；**不翻 status**（翻 done 是外层收尾的活）；
**不勾 DoD 行**（DoD 全量绿在 SCOPED ONLY 下任务内不可知，是唯一真时序依赖）。收尾（外层异步）因此
每任务只剩「核对 DoD 行 + 翻 done + 关遥测括号」——量小到不是同步点（(c) 块落地后，closure-async
机制根的收尾对已自勾 AC/证据的任务是 no-op）。

**驱动文本只携带数据，不复述行为（外层裁定 R2 — gap-drive-text-carries-data-not-behavior-outer-inner-handoff，AC1）**：
外层驱动内层的文本只携带**数据**——任务 id、裁定结论、依赖事实（如「B 消费 D 的 classifyPaneState」）。
**行为**（怎么派发、worktree 位置、纪律、并发上限）一律由本节供给，外层**不复述**——出厂文档的行为错了
就**改文档**，不用散文覆盖。若驱动文本**确需指定任务顺序**，必须**附 `checkTouchesPair` 实际输出**
（机械证据）：

```text
A-D: {"disjoint":true,"overlaps":[],"reason":"disjoint file-sets"}   # 合规：顺序断言自带证据
```

否则不按顺序执行，按本节的并发规则执行。

**内层 fail-safe 子句（机械承载，不是自觉）**：收到与本节派发契约**矛盾**的驱动文本——如「按 A→D→B
顺序」且同文无任何 `checkTouchesPair` 输出（2026-08-04 实锤的静默串行形态；对比上面的合规形态），或与
「并发上限 = effective_cap（cap-from-gate 读 cpu 压力 + 滞回 + 档位配置）」冲突（如指令写死固定 3）——
**以本节为准执行，并向外层标注矛盾**，不静默服从散文。产品不被散文覆盖的机械承载
是这一句，不是「指望外层永远记得不复述」。

### 4a. 跨机同步心跳（`sync-lag-check.sh`，兜底必跑——`gap-cross-machine-sync-has-no-mechanism-only-manual-pushes`）

**每个 tick（含轻触）无条件跑一次** `bash plugin/scripts/sync-lag-check.sh --push --branch "$FORK_BASELINE" --root "$(pwd)"`——
它问「本地 `$FORK_BASELINE`（quay: develop）是否领先 `origin/$FORK_BASELINE`」，领先即 push（复用非强推/幂等的
`periodic-push-backup.sh` 本体），**不依赖任何完成事件**。这是双触发源（`slot-refill` 模式）的**兜底触发源**：
外层 3b 的事件驱动路径在 land 收口同一轮内推送（加速），本步保证「即使事件驱动漏了 / 外层没跑 / 本机
`$FORK_BASELINE` 悄悄积累」，每 tick 也会把本地领先推上 origin。**内层与外层同挂**——两机各层 tick 都是
心跳（幂等，up-to-date 退出 0）。

**同步落后量机械可读（AC3）**：`bash plugin/scripts/sync-lag-check.sh --json --branch "$FORK_BASELINE" --root "$(pwd)"`
输出 `unpushed` / `behind` / `leads` 字段——「本地领先 origin 几笔」有测量。心跳跑 `--push` = 测 + 领先即推；
push 失败（非快进 = 真分歧）只报告、不覆写、下一 tick 重试（fail-closed，绝不 force）。

### 5. 写回状态

更新队列文件：已完成 / 在飞（含 worktree 路径和派发时刻）/ 待执行 / 计量表 / 本 tick 做了什么。

### 6. 重新排程

`ScheduleWakeup`，间隔 **1200–1800 秒**。理由：后台完成有 task-notification 自动唤起——完成即触发
派发评估（见「事件驱动派发（槽位回填）」）；tick 是兜底必跑心跳（每 tick 无条件跑 slot-refill，见步骤 4），
不是派发的主节奏也不是新轮询源。
`ScheduleWakeup`，间隔 **1200–1800 秒**。理由：后台完成有 task-notification 自动唤起（那是派发触发源，
见步骤 4 的「槽位释放回填」），这只是兜底——**tick 间隔不是派发节奏**，派发节奏由完成事件驱动
（`gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release`）。

---

## 无人值守期间的判断边界

以下**一律停下等人**，不要自行决定：

| 情况 | 动作 |
|---|---|
| 合并冲突 | abort，needs-human，停止派发 |
| 外层全量 suite 红（`.quay/full-suite-state.json` `state: red`） | **一律暂缓已完成 agent 的 fan-in**（真正保护）+ 新派发按失败位置条件化：共享闸门（`run_static_checks`）⇒ 停派发；具体测试文件且与新任务触摸集无关 ⇒ 派发继续（`running`/`green` ⇒ 照常；文件缺失不阻塞，等下一 tick） |
| 对抗审查 2 轮后仍 REFUTED | 标 needs-human，停止该任务 |
| 任务超 90 分钟 | 中止 subagent，needs-human，不带内重试 |
| **窗口内新增** needs-human ≥3 | 停止派发新任务（2026-08-03 裁定：历史积压不构成——它们是范围决定不是解阻塞，升级给人） |
| 队列文件与 git 状态矛盾且无法判定 | 停，报告两边的实际内容 |

<!-- unmechanized: ADR-021 证据不足；覆盖上方「判断边界」表全部行。这不是欠账，是已声明的取舍——不要为它建检查 -->

这是**保守默认**。ADR-021 原则：不要在证据不足时把策略机械化。这些判断目前由人做，等积累了足够多的真实案例再考虑规则化。

## 阻塞信号：机械触发、停下即写、恢复后清（强制，gap-the-blocked-channel-has-a-writer-nobody-calls）

2026-08-02 两次静默停摆（22:05、22:24）与那次 68 分钟块的根因是**内层停下时没有任何方式说出
「我停下了、在等什么」**——外层只能从缺席（TUI md5 / inProgress 空集）猜，而缺席信号会错。

**教训（gap-the-blocked-channel-has-a-writer-nobody-calls）**：写、读、以及本文件早先「记得调
`--assert-blocked`」的指令**都在**，而 `.quay/inner-blocked.json` **全历史 0 次写入**——一条写在文档
里的指令从未被执行。**再加一条文档指令不会有用。** 因此触发改成**机械的**：

- **机械条件自动落盘（步骤 3 的 `--detect-stop`）**：合并冲突、任务超 90 分钟由 CLI 从仓库状态
  机械判定，命中即写——**写入是停止条件检查的后果**，你不需要「记得」另跑一条命令，因为你跑的那条
  检查命令本身就落盘。**`ruling-required` 现在也有机械路径**（`gap-ruling-required-trigger-is-dead-
  code-never-wired-into-any-tick`）：步骤 3 带 `--pane` 时，屏幕观察者按形状分类（连续 3 次
  `waiting-input` / `permission-prompt`）自动写 `ruling-required`——不再需要「记得」手动 assert。
- **判断条件手动落盘**：`review-refuted`（无法从仓库状态判定）等 judgment 条件，在停下等裁定的
  那一刻调一次 `--assert-blocked`（见下）。判断边界表里除 `.halt` 外的每一行都属于这一类。

手动 assert / 清除（judgment 条件专用；机械条件不要手写——`--detect-stop` 已自动处理）：

```bash
# 停下前（judgment 条件触发时——ruling-required / review-refuted / suite-red / queue-empty / needs-human 窗口）：
node --no-warnings --experimental-strip-types plugin/scripts/inner-blocked-signal.ts \
  --assert-blocked --taskId <当前任务/阶段> \
  --reason <合法值见 `--schema`；不要照抄到这里，代码是唯一真源> \
  --question <要外层裁定的问题> [--options '<json>'] [--evidence '<json>']

# 恢复后（裁定下达、继续推进的那一刻）：
node --no-warnings --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --clear
```

规则：

- **文件存在 == 内层在等。** `--detect-stop` / `--assert-blocked` 写在停下的那一刻，`--clear` 删在恢复
  的那一刻。这是存在性信号，不是从缺席推断。外层在每个 tick 直接读该路径
  （`plugin/scripts/inner-blocked-signal.ts --read --root <root>`）拿 `reason` + `question`，不必读屏就能
  开始判断。旧的 `inner-state.sh` 曾用 inotifywait 监视它，现随 inner-state.sh 一起退役——阻塞信道是
  「内层主动写、外层主动读」的显式信道，不需要一个常驻轮询工具转达。
- **`--detect-stop` 只清自己写的 auto 记录。** 手动（`--assert-blocked`，judgment）的阻塞只有显式
  `--clear` 才清——裁定没下达前文件必须留着（AC3 负控制）。
- **不手写 JSON。** 只调 CLI（AC4）——`reason` 合法值就是「判断边界」表 + 停止条件里已有的七种，不新增
  语义（AC2，见 CLI `--schema`）。手写 JSON 会造成格式漂移，正是本机制要消灭的。
- **从 worktree 里也写主 checkout。** CLI 自动解析共享根（主 checkout）为落点——阻塞记录落在主
  checkout 的 `.quay/`（外层 tick 直接读它），且必须活得比产生它的 worktree 长。
- **等待时长由此可测。** `since` → 删除的时间差由 `--clear` 记进遥测；`fast-mode-telemetry --report`
  输出**累计死时间**与**单次最长**——「内层实际等了多久」这个数此前完全没有，现在有了基线。
- **un-halt 前** `restart-readiness-check.sh` 会打印阻塞记录（AC5）：内层在等裁定 ≠ 可以解除 `.halt`。

**本机制不让内层自动恢复**——内层仍然停、仍然等裁定，只是现在能说出自己停了（任务 DoD 明记）。

## 派发闸口的清单与留痕：`## Contract` + `## Dispatch review`（强制，gap-dispatch-gate-has-no-checklist-and-no-trace）

2026-08-02 的外层闸口介入是**惯例不是机制**——没有清单、没有留痕、没有触发条件。现在它变成
**任务创建时写下的、机器能消费的声明**。内层（本文件）与外层（orchestrator-loop-tick.md）都要执行：

**建任务时**（内层）：fast-mode 执行型任务应写一个 `## Contract` 块（`## Chosen mechanism` 之后），
六个键，每个都能指回一次真实介入，不预先扩充：

**格式硬约束：一行一个键，不可折行。** 折行的续行会被判 `contract-line-unknown`——
外层 2026-08-03 连踩两次（`gap-no-inventory`、`gap-quantified-stop-conditions`）。

```bash
## Contract

measure   suite_wall  = `$TEST_COMMAND` stdout 的 duration_ms 字段   # 单次墙钟，非 Σ 每文件；TEST_COMMAND 见 .quay/config.yml loop.test_command
band      noise       = 20–63s（20000..63000 ms）                       # 实测基线
invariant selected_files = 163                                          # 变了则差异不可归因
invoke    `$TEST_COMMAND --test-concurrency=4`                          # 必须 `=`；空格形式走另一分支
control   把并发改回 8 ⇒ 判定必须不成立                                    # 负控制
resume    每跑完一次即写盘                                               # 中断保全
```

`n/a: <理由>` 是每个键的合法值；**留白不是**（留白与「没想过」不可区分，与 `reviewer: none` 同一条原则）。
`## Dispatch review` 段记录「谁审的、改了什么」（`reviewer: outer|none` / `at: <ISO>` / `changed: <逐条|无>`）；
`reviewer: none` 合法——不是每个任务都需要过闸，但「没过闸」必须是被记录的选择。

**派发前/关任务前**（外层）：跑消费者检查器，读**内容**不只验存在：

```bash
node --experimental-strip-types plugin/scripts/task-contract-check.ts --root <repo> [--json]
```

- 五条消费者判定：AC 阈值必须引用已声明的 measure/band 名；measure 必须同时含命令与字段名；
  invoke 必须反引号命令、done 任务证据逐字出现；defect 任务必须有 control；键空值报出
- **报出而不阻断**；违规名单是数据文件 `docs/analysis/contract-violations.md`，**只能变短**
  （检查器对新增违规退出 1，对既有违规只报不挡）
- 匹配按代码/字段位置（declared name / field token），不按文本——今晚 7 次「匹配到注释而非它本身」
  的教训

**不做**：不引入审查 agent、不加轮次、不阻断派发、不恢复 prepare 管线。

## 测试不得硬编码全局计数

`EXPECTED_ENGINE = 58` 这类断言在任何人新增一个测试文件时都会红。B3-2 的三个失败里有一个正是
如此——真实缺陷不是计数漂移，是**断言形态本身脆弱**。

全局量（文件数、测试数、组成员数）必须**运行时计算**，不得写成常量。断言可以是「product 组 +
engine 组 + governance 组 == 去重后 realpath 总数」这类**关系**，不能是「== 58」这类**快照**。

## 提出处置方案前，先跑那一条能证伪它的命令

上一条规则管的是**建任务**的门槛。这一条管的是**下结论**的门槛，两者是不同的漏洞。

2026-08-02 的四次外层纠偏全部是同一个形状：**结论比支撑它的证据强，而证伪它的命令只有一行、
只要几秒。**

| 内层的结论 | 一条命令就能证伪 | 实际是 |
|---|---|---|
| 「workflow-replay 12 个失败」 | 单独跑那个文件 | **14 个** |
| 「M243 与 master 有 schema-convention 冲突」 | `git show <merge> -- <那个 schema 文件>` | **空的**——那次合并根本没动它 |
| 「批量升格 expectations 到新约定即可」 | 看负控制是否也在失败 | `*-tampered (GREEN)` 也失败 ⇒ **是 runner 单点故障，不是 14 个陈旧 fixture** |
| 「AC9 满足」 | 实跑全量套件 | **627s，超限** |

<!-- unmechanizable: 思维纪律，无代码可强制。今晚由它挡住过一次掩盖式修复 -->
**规则**：在把一个处置方案写进队列状态文件或提交说明之前，先问「**如果我错了，哪一条命令会告诉
我？**」然后跑它，把输出贴出来。跑不出来的，方案里要写明这一条没被验证。

**特别地，当一个批量修复要改的是「期望值」而不是「实现」时，先找负控制。** 黄金语料、快照、
基线这类东西的全部价值就是钉住已观察到的行为——**改期望值让测试变绿，正是它们存在来防止的那件
事**。若负控制（故意制造的坏输入，应当被抓住）也在失败，那么在它恢复之前，任何期望值重写都不
合法，因为你无法区分「约定变了」和「检测器坏了」。

## 发现问题时建任务（有证据才建）

内层要能自己发现问题并建任务，否则 12 小时无人值守只会产出代码不产出待办。

**建任务的门槛：有可复现证据。** 三者之一即可：

- 一个失败的测试（贴出失败输出）
- 一个 grep/实测结果（贴出命令与输出）
- 一次真实运行的耗时或行为记录

**没有证据的观察不建任务**——记进队列状态文件的「待查」一节，等有证据再升格。这条是为了防止
12 小时产出十几个噪声任务。

建的任务必须有：`## Proposal`（问题 + 证据 + 选定机制）、`## Acceptance Criteria`（可机械验证）、
`## Touches`。缺任一项的不算建成。

**发现问题必须处置**：修，或建任务。**不要静音、不要降级后就走。** 本项目已有四次
「造了检测机制 → 它正确报警 → 警报无人处理」（RED 测试被改 skip、golden replay 被当预存失败、
clause-14 降为 advisory、既有失败记在已 done 的任务体里）。

## 每个 tick 必报

- 本 tick 合并了什么、派发了什么
- 在飞任务及其已运行时长——**「在飞」按 AC7 拆三种含义分别标注**：遥测括号在飞（`--task-start` 未闭合）、
  **真实在飞**（reconcile 感知 `realInFlight`——括号数扣减 executor 已消失者，`--slots` 的 real-in-flight）
  vs subagent 在飞（原始 Agent 调用 `input.run_in_background: true`）；核实并发读原始字段，不用 START
  事件或 pane 文字（见 `orchestrator-loop-tick.md` 步骤 4b）
- **槽位视角（`--slot-status`）**：`real_in_flight` / `stale_brackets` / `slots_free`
  （`node --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --slots --cap "${effective_cap:-3}"`）
  ——「还剩几个并发槽」机械可见（AC2）；`stale_brackets > 0` 时调 `--reconcile` 闭合，别让红窗遗留
  括号污染后续判定
  事件或 pane 文字（见 `orchestrator-loop-tick.md` 步骤 4b）。**空槽数**（AC2/AC5）：`--slots --cap
  ${effective_cap}` 的 slots-remaining + `dispatchable_disjoint − realInFlight` 的槽位级闲置
- 停止条件是否触发、触发了哪条
- 计量表当前行数与均值
- 遥测吞吐：`tasksPerHour`（= `--task-end` 闭合任务数 / 墙钟窗口小时，报 `windowStart`/`windowEnd`/
  `windowHours`——2026-08-03 起口径由 `60/均耗时` 修正，旧量更名为 `serialEquivalentPerHour`，与并发
  无关；`--task-end` 由外层异步写，见 `orchestrator-loop-tick.md` 步骤 1b）
- 阻塞信号状态（步骤 3 `--detect-stop` 的输出：命中了哪些停止条件、`.quay/inner-blocked.json`
  存在与否；存在则报 `reason` + `question`，以及 `fast-mode-telemetry --report` 的累计死时间/单次最长
  ——2026-08-03 起该数有基线）
- Monitor 两判据（`bash plugin/scripts/monitor-mount-check.sh --json` 的 `mounted` /
  `targetRoot` 是否等于本仓根 / `targetOk`）——外层消费本层停止条件的那条命脉，挂没挂/挂哪个仓库
  （2026-08-06 起 `delivered` 随共享 events.jsonl 移除；事件送达由挂载方自己的 Monitor 流承担）

不要只说「继续中」——没有这些数字，1 任务/小时的目标无法判定。
