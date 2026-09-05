---
id: gap-psi-shadow-admission-controller
title: PSI 反馈准入——影子模式验证（先用现有数据测增量预测力，再决定是否上实时观察字段）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`gap-perfile-cpu-cost-collection`/`gap-suite-scheduler-perfile-cpu-emitter-missing` 建立了 `cost_f`（每文件真实 CPU 消耗）；讨论延伸到一个更根本的假设（人 2026-09-05）：真正需要低并发运行的测试，敏感的不是"当时有多少并发测试"，而是**自己（或自己的子进程）被 schedule out 的概率**——这是一个可以直接用 `/proc/self/schedstat` 的 `run_delay` 字段测量的量，且已经用对照实验验证（安静环境 `runDelayMs=0.29`，16 核 2x 超订阅环境 `runDelayMs=188.4`，约 650 倍差异，`onCpuMs` 几乎不变）。

**由此引出的问题**：本仓库现有的水位线机制（`gap-suite-scheduler-reliability-cap-not-speed`）用**并发文件数**做准入约束；PSI（`/proc/pressure/cpu` 的 `cpu_stall`）才是更直接的因果量。人要求"像当初 `gap-suite-dynamic-waterline-scheduler` 用历史数据模拟 min-lock vs 组预算那次的方法"，做一次 PSI 反馈控制 vs 当前水位线的历史模拟对比。

**已实测但结论是：那个方法在这个问题上不成立，不能照搬**。用 40 轮、2315 个真实采样点（`.quay/verification-round.jsonl` 的 perFile 时间戳重建并发 + `.quay/suite-load-*.jsonl` 的真实 `cpu_stall` 采样）算出 Pearson r(并发数, cpu_stall) = **0.918**——表面很强，但专门找解耦点后发现：

- **并发数 0~2 但 cpu_stall 32%~64%**（8 轮里出现，如 round 985 的 `t0+149s 并发=2 cpu_stall=58.9%`，round 1017 的 `t0+132s 并发=1 cpu_stall=63.6%`）——定位在 `tmax` 前后的 fan-in 机械开销窗口（doc-check/scoped-gate/typecheck）或本机其它非本轮 claude/agent 进程（实测此刻本机同时有 **25 个** claude/agent 进程）——**这些负载源完全在"并发文件数"的记账范围之外，PSI 却能看见**。
- **并发数≥25 但 cpu_stall<3%**（如 round 979 并发=28 时 cpu_stall=0.1%）——main 独占相里 28 个并发文件大多轻量，并发数**误报**成"高负载"。

**为什么不能直接照搬历史模拟法**：`gap-suite-dynamic-waterline-scheduler` 当年的模拟只需要 `durationMs`——一个不受调度策略本身反作用影响的量，可以在事件驱动模拟器里安全重放。PSI 反馈控制模拟有**反事实问题**：拿到的历史 `cpu_stall` 序列是"当前策略产生的结果"（内生量），不是外生输入；换一个准入策略，真实 PSI 轨迹本身就会不同（更严格的准入会让高负载窗口来得更晚/更短）。用旧策略产生的轨迹去评价新策略，要么需要假设一个"并发→PSI"映射模型去外推（而我们刚证明这个映射在最要紧的地方——外部负载源——失效），要么是拿因变量冒充自变量。这跟 `gap-suite-cost-model-is-wrong-optimizations-buy-nothing` 否定的模型是同一类错误：一个从未在真实反馈环里验证过的推算被当结论用。

**本任务改做安全、有真实反馈环的替代方案，分两阶段**，Phase 1 是否值得做由 Phase 0 的真实数据决定，不预设。

**⚠️ 2026-09-05 订正①（人指出原 AC1 的"≥100 轮"会摧毁可执行性，已实测坐实并修正）**：`.quay/verification-round.jsonl` 与 `.quay/suite-load-*.jsonl` **都被 `.gitignore`**（`git check-ignore` 已核实两者）——`git worktree add` 不会带这些文件（实测：新建干净 worktree，两个文件均不存在）；而 worker 标准派发流程 `dispatch-worktree-setup.sh` 只做 `node_modules` + `.quay/config.yml`（`worktree-include.sh`），**不 refresh 这两个运行时载体**——本仓库解决这个问题的机制是 `refresh-worktree-quay.sh`（`gap-fan-in-worktree-quay-provisioning`），但它只在 fan-in 跑全量套件之前被调用，不在 worker 实现阶段被调用。原 AC1 要求"worker 在自己 worktree 里跑脚本、读到 ≥100 轮"，在正常派发路径下会读到 **0 轮**——不是数字选大了，是路径没打通。**且"轮次数"本身是错的判据轴**：真正的瓶颈是失败样本数（全历史 240/190620=0.126%），轮次数再多、全是绿的也测不出信号。已按下方 Plan/AC 改正：脚本必须显式解析主检出根（`--root` / `QUAY_MAIN_CHECKOUT`，同 `refresh-worktree-quay.sh`/`suite-lpt-order.ts` 既有约定），且判据锚定失败样本数而非轮次数。

**⚠️ 2026-09-05 订正②（人提出：被动等 240 条太稀，改主动大并发跑 serial/lowconc 与曾 flaky 文件人为制造失败样本——已核实可行，但两个风险必须处理）**：

- **风险 a——最典型的受害者已经不存在**：历史 240 条失败样本涉及 65 个不同文件，最大头是 `session-liveness-*` 家族（18x/17x/17x/9x/5x/5x/4x/3x/3x/3x），但该家族已随 tmux 退役被整体删除（`gap-retire-session-liveness`）——"曾经 flaky 的文件"里最有代表性的那批，人为重跑也跑不了了。
- **风险 b（更危险）——历史失败清单里混着跟调度无关的失败**：逐个核对 65 个"仍存在"的历史失败文件与 `plugin/test-isolation-violations.txt`（本仓库已有的测试隔离违规名单），**3 个直接命中**：`runner-grouping-list-groups.test.mjs`(7x)、`plugin-packaging.test.mjs`(3x)、`runner-grouping-flags-only.test.mjs`(3x)——它们的历史失败大概率是共享临时路径/端口撞车，不是调度饥饿。若不排除，人为制造的失败会把"测试隔离缺陷"误判成"PSI 增量信号"，污染 Phase 0 结论。
- **已核实的干净候选**（历史失败过、仍存在、不在隔离违规名单）：`help-contract-incompatible-behaviors.test.mjs`(serial,15x)、`writestate-atomicity-split.test.mjs`(engine,14x)、`worker-driver-fan-in.test.mjs`(lowconc,11x)、`worker-driver-resident.test.mjs`(lowconc,7x)、`suite-bucket-reattr-ratchet-check.test.mjs`(engine,5x)——覆盖不同 @test-group、不同历史失败次数，主动实验应以这批为核心，再加上当前完整的 serial/lowconc 组文件列表。

## Plan

**Phase 0 —— 两条数据源，分开报告，不合并成一个数字**：

**(a) 主动制造（主数据源，人 2026-09-05 定向）**：挑选候选文件——当前完整的 serial/lowconc 组文件列表 + 上述已核实的干净历史失败候选，**排除任何出现在 `plugin/test-isolation-violations.txt` 里的文件**（这是硬约束，见 AC1）。对每个候选文件跑一批 trial：在受控环境下变化并发设置（该文件自身的 `--test-concurrency`，以及/或用忙等子进程人为注入背景 CPU 负载——复用本任务讨论阶段已验证可行的手法：`node -e "const e=Date.now()+Nms; while(Date.now()<e);"` 起若干后台忙等进程模拟满核），每个 trial 记录：并发/背景负载设置、trial 窗口内的真实 `/proc/pressure/cpu` 读数（`some avg10`）、该文件的 pass/fail、失败时的具体错误信号。**失败判读约束**：任何诱发出的失败，必须先核对其错误信息不是已知的隔离冲突签名（`EADDRINUSE`/临时路径 `EEXIST`/端口占用等），确认是调度/deadline 类失败（超时、断言的 wall-clock 上界被打破）才计入有效样本——这一核对本身要写进 Measured，不能只贴通过/失败计数。

**(b) 被动历史联合（补充数据源，原方案保留）**：联合 `.quay/verification-round.jsonl` 的 perFile `{file, startedAtMs, endedAtMs, passed}` 与对应 `.quay/suite-load-<runId>.jsonl` 的 `{t, cpu_stall}`，找同一并发区间内失败 vs 通过文件的 PSI 差异——它能捕捉主动实验难以人为复现的长尾负载源（本机其它 claude/agent 进程这类真实外部负载，已实测此刻同时有 25 个），但样本天然稀疏（240 条覆盖 65 个文件，多数已删除）。

两条数据源在 Measured 里**分列**——"受控实验条件下诱发的失败"和"真实生产条件下自然发生的失败"是两种不同性质的证据，合并成一个数字会掩盖各自的适用范围。最终 go/no-go 结论可以引用两者，但要分别注明各自的样本量和局限。

**数据源解析（必须，防止 worktree-gitignore 死路）**：脚本接受 `--root <path>`，未传时回落 `process.env.QUAY_MAIN_CHECKOUT`，再回落当前 cwd（与主检出跑时行为一致）——`.quay/verification-round.jsonl`/`.quay/suite-load-*.jsonl` 一律从该 root 下解析，不假设 cwd 就是数据所在处。worker 在自己的 worktree 里执行时，必须显式传 `--root <主检出路径>`（`git rev-parse --git-common-dir` 的父目录，或直接读 `QUAY_MAIN_CHECKOUT` 若已被上游设置）——本仓库已有的先例是 `refresh-worktree-quay.sh`（同一个问题的另一半：suite 本身读 worktree 内 `.quay`）与 `suite-lpt-order.ts --root`。主动实验（(a)）不依赖这两个载体，可以在任意环境（含 worktree）直接跑，不受此限制。

**判据锚定失败样本数,不是轮次数**（如实写入稀疏性，不回避）：被动数据源（b）的核心数字是"联到 PSI 数据的失败样本数"（而不是"扫过多少轮"），轮次数只是过程数字，不作为 AC 的通过/失败条件。主动数据源（a）的核心数字是"诱发出的、经过隔离冲突排除后的有效失败样本数"。两者都按并发/PSI 分档 report，样本数低于脚本自定的门槛时输出"样本不足，无法判定"而不是勉强给出方向性结论（硬规则 3b：读不懂/测不出不能伪装成有结论）。

**Phase 1（仅当 Phase 0 判定"有信号，值得继续"时才做；否则本任务在 Phase 0 结束，Phase 1 相关 AC 标 N/A）**：给已经在每轮全量套件常驻运行的 `plugin/scripts/suite-load-sampler.ts` 加一个纯观察字段——在每次采样时，用一个显式命名、写明依据的 PSI 阈值（依据本任务 Proposal 里已经测出的"安静~8% vs 满载~68%"分布，具体取值由实现者结合 Phase 0 数据定，不预设），派生一个 `would_throttle: boolean` 字段随 `{t, loadavg, cpu_stall, mem_avail}` 一起落盘。**这个字段只读、只记录，不接入任何真实调度/准入逻辑**——它的作用是让"如果当时有 PSI 反馈准入，会不会拦"这个判断，从此变成每轮自动产出的标准数据，供未来（另立任务）决定要不要真的把它接进 `suite-scheduler.ts` 的准入逻辑时使用，而不必每次都重新做一次回溯分析。

**明确不做的事**（划界，防范围膨胀）：不修改 `suite-scheduler.ts` 的 `nextDispatch`/`currentCap`，不让 `would_throttle` 产生任何真实的准入/节流效果，也不让主动实验（(a)）接入真实生产调度——它是一次性的、独立跑的诊断实验，不是新的常驻机制。

## Acceptance Criteria

- [ ] AC1（能取假，Phase 0 主动数据源，候选筛选正确）：候选文件清单 = 当前 serial/lowconc 组全部文件 + 本任务 Proposal 列出的已核实干净候选，**且清单里没有任何一个文件出现在 `plugin/test-isolation-violations.txt`**（grep 核对，写进 Measured）；对每个候选跑受控并发/背景负载 trial，记录并发设置、真实 `cpu_stall`、pass/fail、失败错误信号；任何诱发出的失败都核对过不是隔离冲突签名（`EADDRINUSE`/路径 `EEXIST` 等）才计入有效样本，核对过程写进 Measured；（⛔ 候选清单命中隔离违规名单 ⇒ 假；⛔ 诱发失败未核对隔离冲突就直接计入样本 ⇒ 假）。
- [ ] AC2（能取假，Phase 0 被动数据源 + 数据源解析）：脚本支持 `--root`/`QUAY_MAIN_CHECKOUT` 解析主检出（在一个干净 `git worktree add` 出的目录里、不带 `--root` 直跑必须报"未找到载体"而不是假装空数据合格；带正确 `--root` 时必须能读到全历史真实数据），联合 `passed:false` 记录与其执行窗口内的 PSI 读数，按并发区间分档输出通过组 vs 失败组的 PSI 对比；（⛔ 只给相关性数字不给按失败/通过分组的对比 ⇒ 假；⛔ 在 worktree 里不传 `--root` 却读到非零数据或不报错 ⇒ 假）。
- [ ] AC3（能取假，诚实的样本量报告，主动/被动分列）：Measured 必须**分别**给出 (a) 主动实验的有效失败样本数、(b) 被动历史联合的失败样本数——不得合并成一个数字；两者各自定义并写明"判定所需的最小 N"，N 低于门槛的档位一律报"样本不足"；最终 go/no-go 结论须注明主要依据哪个数据源、另一个数据源起什么补充/交叉验证作用；（⛔ 两个来源合并成一个数字 ⇒ 假；⛔ 任何档位 N 低于自定门槛却仍给出正/负判定 ⇒ 假）。
- [ ] AC4（能取假，Phase 1，仅当 Phase 0 判定为"进入 Phase 1"时适用；若判定"不做"，本条标 `[x]` 并注明"N/A——Phase 0 判定不做，正确地未尝试 Phase 1"）：`suite-load-sampler.ts` 在每条采样行追加 `would_throttle` 字段，派生自一个命名常量阈值（代码注释写明依据 Phase 0 的分布数据）；grep 全仓确认该字段未被 `suite-scheduler.ts` 或任何调度/准入代码读取——它是纯观察字段；新增单测覆盖派生函数本身（纯函数，不需要真实进程）。
- [ ] AC5（能取假，Phase 1 生产核验，仅当 AC4 适用时适用；否则同 AC4 标 N/A）：Phase 1 落地之后，至少一轮真实全量套件产出的 `.quay/suite-load-*.jsonl` 文件里出现该字段，且 true/false 两个值都真实出现过（不是恒定值）；（⛔ 该字段只出现一种取值 ⇒ 假）。
- [ ] AC6（能取假，范围守卫）：`git diff` 不含 `suite-scheduler.ts` 的 `nextDispatch`/`currentCap` 或任何准入/调度逻辑改动，且主动实验（AC1）未接入 `scripts/test.sh`/常驻 CI 路径——它是一次性诊断脚本，不是新增的常驻机制；（⛔ 动了调度逻辑，或主动实验被接成常驻步骤 ⇒ 超范围 ⇒ 假）。

## Definition of Done

Phase 0 用主动诱发（候选已排除隔离违规文件）+ 被动历史联合两条独立数据源，分别给出真实样本数与 PSI 对比，交付一个诚实的 go/no-go 结论（不是没有数据支撑的方向性猜测，也不是把两种不同性质的样本混为一谈）；被动数据源的脚本正确解析主检出根，在 worktree 里也能拿到真实全历史数据；若判定进入 Phase 1，`suite-load-sampler.ts` 落地一个零效应的纯观察字段并在至少一轮真实生产轮里验证其有分辨力；全程未改动任何真实调度/准入逻辑、主动实验未被接成常驻机制（AC6）；AC1-6 全部勾选（Phase 1 不适用时对应 AC 标 N/A 而非留空）；本任务不对"PSI 准入控制是否真的该上线"做出结论——它只交付：(a) 一次有真实数据支撑（两条独立来源交叉验证）的初步判断，和 (b)（如果判断支持）一个供未来任务积累更多真实前瞻数据的被动观察机制。

## Touches

- plugin/scripts/psi-failure-correlation-check.ts（新，Phase 0 分析脚本：(a) 主动诱发实验 + (b) 被动历史联合，含 `--root`/`QUAY_MAIN_CHECKOUT` 数据源解析）
- plugin/scripts/capability-catalog.sh（新脚本六表注册）
- plugin/scripts/suite-load-sampler.ts（Phase 1，仅当判定进入 Phase 1 时改动：追加 would_throttle 派生字段）
- plugin/test/suite-load-sampler.test.mjs（新，Phase 1 单测：would_throttle 派生函数，仅当 Phase 1 适用时新增）
- tasks/gap-psi-shadow-admission-controller.md（自身）
