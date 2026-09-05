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

`gap-perfile-cpu-cost-collection`/`gap-suite-scheduler-perfile-cpu-emitter-missing` 建立了 `cost_f`（每文件真实 CPU 消耗）；讨论延伸到一个更根本的假设（人 2026-09-05）：真正需要低并发运行的测试，敏感的不是"当时有多少并发测试"，而是**自己（或自己的子进程）被 schedule out 的概率**——这是一个可以直接用 `/proc/self/schedstat` 的 `run_delay` 字段测量的量，且已经用对照实验验证（安静环境 `runDelayMs=0.29`，16 核 2x 超订阅环境 `runDelayMs=188.4`，约 650 倍差异，`onCpuMs` 几乎不变，**注意：该对照实验的负载注入窗口只用了 2 秒**）。

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
- **已核实的干净候选**（历史失败过、仍存在、不在隔离违规名单）：`help-contract-incompatible-behaviors.test.mjs`(serial,15x)、`writestate-atomicity-split.test.mjs`(engine,14x)、`worker-driver-fan-in.test.mjs`(lowconc,11x)、`worker-driver-resident.test.mjs`(lowconc,7x)、`suite-bucket-reattr-ratchet-check.test.mjs`(engine,5x)。

**⚠️ 2026-09-05 订正③（needs-human 复盘：真根因不是"忘勾 AC"，是主动实验规模远超单个 worker session 的时间预算，且产生了一个失控的孤儿进程——已直接处理，任务体已按此收紧）**：

worker-driver 连续 3 次 exited-not-landed，机械诊断写的是"AC 未全勾——续做只需验证并勾选 AC"——**这个诊断是错的，不要采信**。用 `meta-cc` 查了最后一次失败会话（`fcbe20bd-...`）的真实工具调用记录：worker 启动了主动实验（`psi-failure-correlation-check.ts --source active`），该实验在**单次 trial 里**用 `node -e "const e=Date.now()+600000; while(Date.now()<e);"` 起了 **32 个忙等子进程，每个忙等 10 分钟**；worker 随后在一个 `until ! kill -0 <pid>; do sleep 15; done` 轮询循环里等这个 trial 跑完，会话在等待中耗尽了时间预算，从未跑到写 Measured/勾 AC 那一步——三次尝试都死在同一处。**更严重的是**：worker session 结束（07:24:07Z）时没有回收这个后台实验，它成了孤儿进程，独立核查时发现它已经**跑了 31 分 46 秒仍未结束**，32 个忙等子进程仍在真实消耗这台 16 核共享主机的 CPU——**已直接 kill 掉整个进程树**（`pkill -P` + `kill`），核实清理干净（`pgrep -cf "while\(Date.now"` 归零）。

**根因是本任务 Plan (a) 的候选矩阵设计错误**：候选清单写的是"当前完整 serial/lowconc 组文件列表（约 28 个）+ 5 个额外候选"，乘上每个候选的负载注入窗口若选到分钟级，总耗时轻易到小时级——而本任务讨论阶段自己验证过的对照实验只用了 **2 秒**注入窗口就测出了 650 倍的清晰信号（`runDelayMs` 0.29→188.4），10 分钟窗口毫无必要。**已按下方 Plan 收紧**：候选清单从"约 28+5"砍到"5 个已核实候选为必须覆盖的核心集，其余 serial/lowconc 文件仅作为预算允许时的可选扩展"；注入窗口从"未限定"改为"数秒级，不得超过 10 秒"；新增一条硬性预算上限（整个主动实验含分析在内 ≤10 分钟真实墙钟）；新增一条硬约束：**任何后台/子进程必须在同一个工具调用内同步等待完成并回收，不得跨多个回合轮询**——这是本次孤儿进程产生的直接原因，不是"运气不好"，是控制流写法本身有问题。

**⚠️ 2026-09-05 订正④（第 4 次派发实测：主动实验用收紧前的宽口径跑出了真实命中，但结果暴露了收紧后默认候选集会漏掉 2/3 个已知阳性）**：

worker 在把脚本收紧到 5-核心候选默认口径之前，先用一个更宽的候选集（`--include-all-groups` 等效范围：serial 12 + lowconc 12 + cleanExtra 2 = 26 个候选）跑了一次完整实验（单次同步阻塞 Bash 调用，~54 分钟墙钟，无孤儿——忙等子进程在每个 trial 内同步 `SIGKILL` 回收，`pgrep -cf "while\(Date.now"` 核实归零，本次未重犯订正③的孤儿问题）。**真实结果：26 个候选里命中 3 个 load-induced scheduling-like 失败**（低载全过、2×超订阅下卡到约 180s 超时被杀，非隔离冲突）：

| 文件 | loadProcs=0 | loadProcs=32 |
|---|---|---|
| `experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs` | pass | timeout ~180s, scheduling-like |
| `plugin/test/full-suite-runner-phases.test.mjs` | pass | timeout ~180s, scheduling-like |
| `plugin/test/worker-driver-fan-in.test.mjs`（已在 5 核心候选内） | pass | timeout ~180s, scheduling-like |

3 个有效命中 < `MIN_N_ACTIVE=5` 门槛，脚本正确地报了 `insufficient`（不是伪造方向性结论，判据本身没问题）。**但两个已证实的阳性候选（`proposal-convergence.test.mjs`、`full-suite-runner-phases.test.mjs`）都不在收紧后脚本默认的 5-核心候选集里**——两者均已核对不在 `plugin/test-isolation-violations.txt` 隔离违规名单（干净）。若下一轮直接用收紧后的默认口径（仅 5 核心候选）重跑，大概率只再摸到 1 个有效样本（`worker-driver-fan-in.test.mjs`），仍过不了 MIN_N=5 门槛——不是信号弱，是默认候选集把两个已知阳性筛掉了。**已按下方 Plan/AC1 把这两个文件补进核心候选集（5→7），下一轮应可直接达到或接近 MIN_N_ACTIVE=5 门槛**，不需要再跑一次宽口径搜索。

**⚠️ 2026-09-05 订正⑤（人质疑：`MIN_N_ACTIVE=5` 是否重要、是否匹配实验规模——核实后成立，判据轴已从"凑数量"改为"验证机制"）**：

`MIN_N_ACTIVE=5` 是类比被动源 `MIN_N_PASSIVE=10` 随手定的常量，从未做过与本实验真实成本结构的核对。**订正④已测出的成本结构**：命中一次 load-induced 失败，trial 必须跑满该文件自身的 test-timeout（约 180 秒）才算数；26 候选、11.5% 命中率下，凑到 N=5 需要的候选规模和重跑次数，按同样命中率外推需要 40+ 候选，总耗时远超 Plan 里刚定的 ≤10 分钟预算——**`MIN_N_ACTIVE=5` 与 `≤10 分钟预算` 是两个从未相互核对过、互相矛盾的数字**，继续按此门槛走大概率会再次耗尽预算后报 `insufficient`，不是信号弱，是门槛与成本不自洽（同硬规则 4：成本结构未知前不要设数值阈值）。

**更根本的问题**：单纯计数"命中了几次超时"只能证明"高负载下会挂"，不能证明"挂的机制是 schedule-out"——而"是不是被调度出去（run_delay 飙升），而不是内存/IO/锁等别的资源竞争"才是本任务 Proposal 开篇要验证的核心假设,也是讨论阶段唯一被直接测量过（650倍信号）的量。订正④已经免费拿到 3 个真实命中样本，**不需要再扩大候选面去凑数量，而应该在重跑这 3 个已知命中时顺手采样被测试进程自身的 `/proc/<pid>/schedstat` run_delay**（同 loadProcs=0 vs loadProcs=32 对照），直接确认命中 trial 的 run_delay 是否相对同文件的低载基线显著抬升——这比"再跑几个文件凑到任意选定的 5"更接近任务真正要回答的问题,且复用已有命中,成本更低。

**已按下方 Plan/AC 改正**：每个 trial 除了记录 `cpu_stall`，还要采样被测试进程（或其代表性子进程）的 `run_delay`；判定信号轴从"有效失败样本数 ≥ MIN_N_ACTIVE"改为"命中样本中机制确认（run_delay 显著抬升）的比例与具体读数"——样本数从硬性门槛降级为报告项，不再是从未核实过可达性的任意常数。

## Plan

**Phase 0 —— 两条数据源，分开报告，不合并成一个数字**：

**(a) 主动制造（主数据源，规模已收紧，见订正③，候选集已按订正④扩充）**：候选文件清单 = 7 个已核实候选（`help-contract-incompatible-behaviors.test.mjs`/`writestate-atomicity-split.test.mjs`/`worker-driver-fan-in.test.mjs`/`worker-driver-resident.test.mjs`/`suite-bucket-reattr-ratchet-check.test.mjs`/`experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs`/`plugin/test/full-suite-runner-phases.test.mjs`，后两个是订正④实测已确认的真实阳性，非历史失败清单里原有的 5 个）——**这 7 个是必须覆盖的核心集**；当前 serial/lowconc 组的其余文件**仅作为预算允许时的可选扩展，不是硬性要求**。**排除任何出现在 `plugin/test-isolation-violations.txt` 里的文件**（硬约束，见 AC1；7 个均已核对干净）。

对每个候选文件跑一批 trial：变化并发设置（该文件自身的 `--test-concurrency`）和/或用忙等子进程注入背景负载——**注入窗口必须是数秒级（建议 2-5 秒，参考本任务讨论阶段的对照实验），硬上限 10 秒，不得使用分钟级窗口**；每次注入的子进程数量、启动方式必须在**同一个 Bash 调用内**完成"起子进程→等它们全部退出→读结果"，**不得跨多个工具调用轮询等待**（这正是本次产生孤儿进程、耗尽会话预算的直接原因）。每个 trial 记录：并发/背景负载设置、trial 窗口内的真实 `/proc/pressure/cpu` 读数、**被测试进程（或其代表性子进程）的 `/proc/<pid>/schedstat` run_delay（订正⑤，机制确认，不是可选项）**、该文件的 pass/fail、失败时的具体错误信号。

**整个主动实验（含分析和结果写入）的总墙钟预算 ≤10 分钟**——若接近或超出，立即停止、用已收集到的部分数据如实写 Measured（标注"预算内未跑完全部候选"），不得为了"跑完"而无限期等待。**订正④已实测：单个 trial 若命中真实调度型超时，会跑满该文件自身的 test-timeout（约 180s）才被杀——7 个候选 × 2 负载档 = 14 个 trial，多数应在数秒~数十秒内通过，只有真正命中的 trial 才会拖到 180s；若预算 10 分钟不够跑完全部 14 个 trial，优先保证覆盖全部 7 个候选各至少 1 个负载档，而不是把预算耗在重复 trial 上。**

**失败判读约束**：任何诱发出的失败，必须先核对其错误信息不是已知的隔离冲突签名（`EADDRINUSE`/临时路径 `EEXIST`/端口占用等），确认是调度/deadline 类失败（超时、断言的 wall-clock 上界被打破）才计入有效样本——这一核对本身要写进 Measured，不能只贴通过/失败计数。

**(b) 被动历史联合（补充数据源，原方案保留）**：联合 `.quay/verification-round.jsonl` 的 perFile `{file, startedAtMs, endedAtMs, passed}` 与对应 `.quay/suite-load-<runId>.jsonl` 的 `{t, cpu_stall}`，找同一并发区间内失败 vs 通过文件的 PSI 差异——它能捕捉主动实验难以人为复现的长尾负载源（本机其它 claude/agent 进程这类真实外部负载，已实测此刻同时有 25 个），但样本天然稀疏（240 条覆盖 65 个文件，多数已删除）。这一步不涉及后台进程，无本节风险。

两条数据源在 Measured 里**分列**——"受控实验条件下诱发的失败"和"真实生产条件下自然发生的失败"是两种不同性质的证据，合并成一个数字会掩盖各自的适用范围。最终 go/no-go 结论可以引用两者，但要分别注明各自的样本量和局限。

**数据源解析（必须，防止 worktree-gitignore 死路）**：脚本接受 `--root <path>`，未传时回落 `process.env.QUAY_MAIN_CHECKOUT`，再回落当前 cwd（与主检出跑时行为一致）——`.quay/verification-round.jsonl`/`.quay/suite-load-*.jsonl` 一律从该 root 下解析，不假设 cwd 就是数据所在处。worker 在自己的 worktree 里执行时，必须显式传 `--root <主检出路径>`（`git rev-parse --git-common-dir` 的父目录，或直接读 `QUAY_MAIN_CHECKOUT` 若已被上游设置）——本仓库已有的先例是 `refresh-worktree-quay.sh`（同一个问题的另一半：suite 本身读 worktree 内 `.quay`）与 `suite-lpt-order.ts --root`。主动实验（(a)）不依赖这两个载体，可以在任意环境（含 worktree）直接跑，不受此限制。

**判据锚定失败样本数,不是轮次数**（如实写入稀疏性，不回避）：被动数据源（b）的核心数字是"联到 PSI 数据的失败样本数"（而不是"扫过多少轮"），轮次数只是过程数字，不作为 AC 的通过/失败条件。**主动数据源（a）的核心判据是机制确认，不是样本计数（订正⑤）**：对每个诱发出的有效命中样本，report 其 run_delay 是否相对同文件低载基线显著抬升；命中样本数本身如实报告，但不设一个未经成本核对的硬性 `MIN_N_ACTIVE` 门槛——go/no-go 结论依据"命中样本里机制被确认的比例与具体 run_delay 读数"，而不是"命中数是否≥某个任意常数"。被动数据源（b）仍保留 `MIN_N_PASSIVE` 的小样本门槛（历史联合数据无法做机制级 run_delay 回溯，只能按样本量报告置信度）。两者都按并发/PSI 分档 report，样本数低于脚本自定的门槛时输出"样本不足，无法判定"而不是勉强给出方向性结论（硬规则 3b：读不懂/测不出不能伪装成有结论）。

**Phase 1（仅当 Phase 0 判定"有信号，值得继续"时才做；否则本任务在 Phase 0 结束，Phase 1 相关 AC 标 N/A）**：给已经在每轮全量套件常驻运行的 `plugin/scripts/suite-load-sampler.ts` 加一个纯观察字段——在每次采样时，用一个显式命名、写明依据的 PSI 阈值（依据本任务 Proposal 里已经测出的"安静~8% vs 满载~68%"分布，具体取值由实现者结合 Phase 0 数据定，不预设），派生一个 `would_throttle: boolean` 字段随 `{t, loadavg, cpu_stall, mem_avail}` 一起落盘。**这个字段只读、只记录，不接入任何真实调度/准入逻辑**——它的作用是让"如果当时有 PSI 反馈准入，会不会拦"这个判断，从此变成每轮自动产出的标准数据，供未来（另立任务）决定要不要真的把它接进 `suite-scheduler.ts` 的准入逻辑时使用，而不必每次都重新做一次回溯分析。

**明确不做的事**（划界，防范围膨胀）：不修改 `suite-scheduler.ts` 的 `nextDispatch`/`currentCap`，不让 `would_throttle` 产生任何真实的准入/节流效果，也不让主动实验（(a)）接入真实生产调度——它是一次性的、独立跑的诊断实验，不是新的常驻机制。

## Acceptance Criteria

- [ ] AC1（能取假，Phase 0 主动数据源，候选筛选正确、规模受控）：候选文件清单 = 上述 7 个已核实候选（serial/lowconc 组其余文件为可选扩展，不是必须），**且清单里没有任何一个文件出现在 `plugin/test-isolation-violations.txt`**（grep 核对，写进 Measured）；每次负载注入窗口 ≤10 秒（Measured 里贴出实际用的窗口时长）；对每个候选跑受控并发/背景负载 trial，记录并发设置、真实 `cpu_stall`、**被测试进程（或代表性子进程）的 `/proc/<pid>/schedstat` run_delay（订正⑤）**、pass/fail、失败错误信号；任何诱发出的失败都核对过不是隔离冲突签名才计入有效样本，核对过程写进 Measured；（⛔ 候选清单命中隔离违规名单 ⇒ 假；⛔ 注入窗口 >10 秒 ⇒ 假；⛔ 诱发失败未核对隔离冲突就直接计入样本 ⇒ 假；⛔ trial 记录缺 run_delay 读数 ⇒ 假）。
- [ ] AC2（能取假，Phase 0 被动数据源 + 数据源解析）：脚本支持 `--root`/`QUAY_MAIN_CHECKOUT` 解析主检出（在一个干净 `git worktree add` 出的目录里、不带 `--root` 直跑必须报"未找到载体"而不是假装空数据合格；带正确 `--root` 时必须能读到全历史真实数据），联合 `passed:false` 记录与其执行窗口内的 PSI 读数，按并发区间分档输出通过组 vs 失败组的 PSI 对比；（⛔ 只给相关性数字不给按失败/通过分组的对比 ⇒ 假；⛔ 在 worktree 里不传 `--root` 却读到非零数据或不报错 ⇒ 假）。
- [ ] AC3（能取假，诚实的样本量报告 + 机制确认，主动/被动分列，订正⑤改判据轴）：Measured 必须**分别**给出 (a) 主动实验的有效失败样本数及**每个样本的 run_delay 机制确认结果**（命中 trial 的 run_delay 相对同文件低载基线是否显著抬升，附具体读数）、(b) 被动历史联合的失败样本数——不得合并成一个数字；(a) 的 go/no-go 不设未经成本核对的硬性 `MIN_N_ACTIVE` 计数门槛，而是依据"命中样本中机制被确认的比例与读数"；(b) 仍保留 `MIN_N_PASSIVE` 门槛，低于门槛的档位报"样本不足"；最终 go/no-go 结论须注明主要依据哪个数据源、另一个数据源起什么补充/交叉验证作用；（⛔ 两个来源合并成一个数字 ⇒ 假；⛔ (a) 只给命中计数不给 run_delay 机制确认读数 ⇒ 假；⛔ (b) 任何档位 N 低于自定门槛却仍给出正/负判定 ⇒ 假）。
- [ ] AC4（能取假，无孤儿进程）：主动实验（AC1）跑完之后，`pgrep -cf "while\(Date.now"`（或等价的忙等/负载注入进程检索）归零；实现里起后台负载的代码必须在同一控制流里同步等待并回收，不得跨多个工具调用轮询；Measured 贴出实现落地后跑一次的负控制读数（归零）；（⛔ 跑完后仍有残留的负载注入进程 ⇒ 假）。
- [ ] AC5（能取假，Phase 1，仅当 Phase 0 判定为"进入 Phase 1"时适用；若判定"不做"，本条标 `[x]` 并注明"N/A——Phase 0 判定不做，正确地未尝试 Phase 1"）：`suite-load-sampler.ts` 在每条采样行追加 `would_throttle` 字段，派生自一个命名常量阈值（代码注释写明依据 Phase 0 的分布数据）；grep 全仓确认该字段未被 `suite-scheduler.ts` 或任何调度/准入代码读取——它是纯观察字段；新增单测覆盖派生函数本身（纯函数，不需要真实进程）。
- [ ] AC6（能取假，Phase 1 生产核验，仅当 AC5 适用时适用；否则同 AC5 标 N/A）：Phase 1 落地之后，至少一轮真实全量套件产出的 `.quay/suite-load-*.jsonl` 文件里出现该字段，且 true/false 两个值都真实出现过（不是恒定值）；（⛔ 该字段只出现一种取值 ⇒ 假）。
- [ ] AC7（能取假，范围守卫）：`git diff` 不含 `suite-scheduler.ts` 的 `nextDispatch`/`currentCap` 或任何准入/调度逻辑改动，且主动实验（AC1）未接入 `scripts/test.sh`/常驻 CI 路径——它是一次性诊断脚本，不是新增的常驻机制；（⛔ 动了调度逻辑，或主动实验被接成常驻步骤 ⇒ 超范围 ⇒ 假）。

## Definition of Done

Phase 0 用规模受控（7 个核心候选、注入窗口≤10秒、总预算≤10分钟、无孤儿进程）的主动诱发 + 被动历史联合两条独立数据源，主动数据源以 run_delay 机制确认为判据轴（不设未经成本核对的硬性计数门槛，订正⑤），分别给出真实样本数、机制确认读数与 PSI 对比，交付一个诚实的 go/no-go 结论（不是没有数据支撑的方向性猜测，也不是把两种不同性质的样本混为一谈）；被动数据源的脚本正确解析主检出根，在 worktree 里也能拿到真实全历史数据；若判定进入 Phase 1，`suite-load-sampler.ts` 落地一个零效应的纯观察字段并在至少一轮真实生产轮里验证其有分辨力；全程未改动任何真实调度/准入逻辑、主动实验未被接成常驻机制、未留下孤儿进程（AC4/AC7）；AC1-7 全部勾选（Phase 1 不适用时对应 AC 标 N/A 而非留空）；本任务不对"PSI 准入控制是否真的该上线"做出结论——它只交付：(a) 一次有真实数据支撑（两条独立来源交叉验证）的初步判断，和 (b)（如果判断支持）一个供未来任务积累更多真实前瞻数据的被动观察机制。

## Touches

- plugin/scripts/psi-failure-correlation-check.ts（新，Phase 0 分析脚本：(a) 主动诱发实验（规模受控、同步回收、7 核心候选）+ (b) 被动历史联合，含 `--root`/`QUAY_MAIN_CHECKOUT` 数据源解析——worktree 里已有一份按订正③收紧过的实现，且订正④已用它实测出 3 个真实阳性，可直接在其基础上把 CORE_CANDIDATES 从 5 扩到 7 并重跑，不需要重写）
- plugin/scripts/capability-catalog.sh（新脚本六表注册）
- plugin/scripts/suite-load-sampler.ts（Phase 1，仅当判定进入 Phase 1 时改动：追加 would_throttle 派生字段）
- plugin/test/suite-load-sampler.test.mjs（新，Phase 1 单测：would_throttle 派生函数，仅当 Phase 1 适用时新增）
- tasks/gap-psi-shadow-admission-controller.md（自身）

## Needs-Human

**执行 2026-09-05T07:24:08.909Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：AC 未全勾（checked 0/6，剩余未勾 6）——续做只需验证并勾选 AC
- run_id：wk-prod-1788285192
- session_id：fcbe20bd-12d2-4b29-94fe-3233edbf0b04

**⚠️ 上面这条机械诊断是错的，见 Proposal「订正③」——真根因是主动实验规模失控+产生孤儿进程，已处理，任务体已收紧，status 已退回 ready 供重新派发。**
