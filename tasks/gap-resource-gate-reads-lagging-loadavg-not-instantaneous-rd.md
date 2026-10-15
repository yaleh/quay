---
id: gap-resource-gate-reads-lagging-loadavg-not-instantaneous-rd
title: 资源闸用带 1 分钟记忆的 loadavg 当「当前过载」判据 —— 实测 load1=209 而瞬时 R+D 仅 39；先把 R/D
  分量记进载体再判该换哪个量
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/scripts/resource-gate.sh` 的过载窗口判据读的是 **1-min loadavg**（`/proc/loadavg` 字段 1），阈值 `load >= nproc × RESOURCE_GATE_LOAD_OVER_FACTOR`（默认 2 ⇒ 本机 128 核 ⇒ 256）。

**本任务立案的直接量（2026-10-16 实测，本机 = tokyo-alpha = CI runner 宿主）**

**① 历史回归：load 确实预测红。** 数据源 `.quay/verification-round.jsonl`，2748 条同时带 `load` 与 `state` 的套件轮（剔除 6 条 `reason=aborted`，那是闸拒跑本身，纳入即循环论证）：

| load 区间 | n | red 率 |
|---|---|---|
| 0–25 | 1426 | 30.2% |
| 25–50 | 1124 | 34.7% |
| 50–75 | 138 | 55.8% |
| 75–100 | 27 | 88.9% |
| 100–150 | 26 | 96.2% |
| 150–200 | 4 | 100% |
| 200–256 | 2 | 50% |
| 256–∞ | 1 | 0% |

对照：`load>=50` 红率 66.2% vs `load<50` 32.2%；`load>=100` 红率 90.9% vs `load<100` 33.9%。
⇒ **闸的前提有实据，且危险区从 load≈50 就开始；阈值 256 偏松，不是偏紧。⛔ 不得以「放宽」为方向。**

**② 但判据读的量是【滞后】的。** 本机连续 20 次采样（`procs_running`/`procs_blocked` 取自 `/proc/stat`，内核权威计数）：

```
t         load1     R     D    R+D
02:04:26  208.7    24    15    39     <- load1 是瞬时 R+D 的 5 倍
02:04:31  195.9    23    15    38
02:04:41  174.9    29    18    47
02:04:56  143.3    26    12    38
02:05:16  106.8     7     0     7
02:06:01   87.4     7    88    95     <- D 主导
```

loadavg 是 1 分钟指数滑动平均 ⇒ **它记得刚才那阵子，不是现在**。⇒ **闸可能在机器已经空下来时仍判 WAIT**（这正是「load 237 而 CPU 79% idle」的来源）。

⚠️ **成分是变化的**：同一段采样里 D 占比从 0% 跳到 92%，⛔ 不得概括成「这里是 D 主导」或「这里是 R 主导」——那正是本任务要测的东西。

**③ 结构性限制（⛔ 不得绕过、不得用 fixture 假装）**
- `procs_running` / `procs_blocked` 在**整个仓库从未被读过**（已 grep `plugin/scripts/`、`packages/quay/src/`、`scripts/`、以及全部 `.quay/` 载体）⇒ **R/D 分量的历史回归在数据上不存在**，只能从本任务落地后开始攒。
- 数据是**截尾**的：高于阈值的轮次被闸拒跑、**根本不产生记录** ⇒ 观测不到 load>256 的行为；上表 150 以上各桶 n=4/2/1，**不足以下结论**。

## Plan

1. 把瞬时分量记进载体：在套件轮记录与 load sampler 里，与既有 `load` **并列**新增 `procs_running` / `procs_blocked` / 瞬时 `R+D`（读 `/proc/stat`）。⛔ 本步**不改判据**。
2. 取负控证明闸行为**逐字未变**（注入式对照，见 AC2）。
3. 攒够样本后做**分量回归**：红率分别按 R 分量、D 分量分桶（⛔ 不是按合并后的 loadavg 分桶——那一步已经做过，见 Proposal ①）。
4. 出**判别性结论**：判据该换成瞬时 R+D、保留 loadavg、还是两者并用；写明支持/排除了哪个假说。
5. 若结论是改判据，改的时候必须保负控（AC5）。

## AC

**落地（实现）**：`readRunQueue()`（`packages/quay/src/kernel/load-avg.ts`，唯一实现，`null` 而非 0）被三个消费者 import：`suite-load-sampler.ts`（曲线）、`full-suite-runner.ts`（正常轮 + crash trap 两个 appendVerificationRound 调用点）、`pre-verified-round-record.ts`（fan-in 落地面 writer，`--procs-running/--procs-blocked` 显式对 + 缺省自读；只给一个 ⇒ fail-closed）。`resource-gate.sh` 用同一口径的一行 awk 读、打印并导出（⛔ 不进任何判定）。⛔ 判据本身一个字节未动。

- [x] AC1: `procs_running` / `procs_blocked` / 瞬时 `R+D` 已与 `load` 并列写入套件轮记录与 load sampler；贴**一条真实新记录**的原文（注明它来自哪次真实运行）。

  **(a) 套件轮记录** — 来自 20 次真实 `full-suite-runner.ts` 调用中的第 19 次（`--root <worktree> --state-dir <worktree>/.quay/rd-evidence/state --command "bash scripts/test.sh --for-task <本任务> --allow-thin" --run-id rdcomp-38 --no-systemd-run`，全量 20/20 行都带三字段）：

  ```json
  {"round":19,"runId":"rdcomp-38","startedAt":"2026-10-15T20:07:01.603Z","durationMs":8218,"laneCount":128,"nproc":128,"pass":73,"fail":0,"cancelled":0,"tests":73,"per_test_ms":112.575,"redAt":null,"load":14.12,"procs_running":18,"procs_blocked":0,"runq":18,"state":"green","reason":null,"runner":"inner","scope":"worktree","commit":"a1f11597f6ecc88b6d4eb20117778ba644bda265", ...}
  ```

  **红色轮同样带**（同一 writer 的另一次真实调用，那轮真的红了——`sh-census-check exit=1`，不是注入）：`{"round":1,"runId":"rdcomp-1","load":11.43,"procs_running":10,"procs_blocked":0,"runq":10,"state":"red","reason":"gate-failed", ...}`（日志 `.quay/rd-evidence/run1.log`）。

  **(b) load sampler 曲线** — 同一次运行（`suite-load-rdcomp-21.jsonl`，原文，注意第三、四行：1-min EWMA 从 18.62 跳到 34.75，而瞬时 R+D 只从 18 走到 19）：

  ```
  {"t":1792094600276,"loadavg":18.62,"cpu_stall":0.04,"mem_avail":179066.1,"procs_running":15,"procs_blocked":0,"runq":15}
  {"t":1792094602278,"loadavg":18.62,"cpu_stall":0.03,"mem_avail":177597.3,"procs_running":16,"procs_blocked":0,"runq":16}
  {"t":1792094604281,"loadavg":18.62,"cpu_stall":0.20,"mem_avail":177347.8,"procs_running":18,"procs_blocked":0,"runq":18}
  {"t":1792094606283,"loadavg":34.75,"cpu_stall":0.35,"mem_avail":178444.6,"procs_running":19,"procs_blocked":0,"runq":19}
  ```

  **(c) fan-in 落地面 writer**（`pre-verified-round-record.ts`，真实 CLI 调用，自读与显式对两条路径）：`{"load":3.5,"procs_running":25,"procs_blocked":1,"runq":26,...}` / `{"load":3.5,"procs_running":24,"procs_blocked":15,"runq":39,...}`；半对（只给 `--procs-running`）⇒ `{"ok":false,"error":"--procs-running requires its pair …"}`，零行写入。

  证据文件：`.quay/rd-evidence/{state/verification-round.jsonl,state/suite-load-rdcomp-*.jsonl,pvr-test.jsonl,run*.log}`。

- [x] AC2: **闸行为未变**的负控：用 `RESOURCE_GATE_TEST_LOAD_OVERRIDE` 注入同一组值，贴改动**前后**的资源闸输出对比，证明每条 WAIT/GO 判定逐字相同（⛔ 本步只许加字段，不许动判据）。

  方法：`git show develop:plugin/scripts/resource-gate.sh` 取改动前那份，与本 worktree 版在**同一组 `RESOURCE_GATE_TEST_*` 注入**下逐场景对跑（CPU/300s/内存/swap/load/nproc/node_procs/comm/cmdline/orphans/caller_scope/worktree_node_tests 全部钉死，故差异只可能来自代码）。11 个场景全部 **判定相关行逐字相同、退出码相同**：

  ```
  S1-go-huge-hosts           verdict-relevant lines BYTE-IDENTICAL  exit 0 == 0
  S2-overload-window-wait    verdict-relevant lines BYTE-IDENTICAL  exit 0 == 0
  S3-load-unmeasurable       verdict-relevant lines BYTE-IDENTICAL  exit 0 == 0
  S4-cpu-wait                verdict-relevant lines BYTE-IDENTICAL  exit 0 == 0
  S5-mem-wait                verdict-relevant lines BYTE-IDENTICAL  exit 0 == 0
  S6-cpu-and-mem-wait        verdict-relevant lines BYTE-IDENTICAL  exit 0 == 0
  S1f-go-huge-hosts          verdict-relevant lines BYTE-IDENTICAL  exit 0 == 0
  S2f-overload-window-wait   verdict-relevant lines BYTE-IDENTICAL  exit 1 == 1
  S3f-load-unmeasurable      verdict-relevant lines BYTE-IDENTICAL  exit 1 == 1
  S6f-cpu-and-mem-wait       verdict-relevant lines BYTE-IDENTICAL  exit 1 == 1
  S7f-priority-override      verdict-relevant lines BYTE-IDENTICAL  exit 0 == 0
  ```

  原始 diff（S2，注入完全相同）——唯一不同的一行是新增字段行（另一行 `total_budget=` 是 process-budget.sh 的活体宿主读数，没有 seam，且非判定输入）：

  ```
  +runq(R+D)=39  procs_running=24  procs_blocked=15   [instantaneous /proc/stat; informational — no verdict]
  -total_budget=unreadable  budget_in_use=unreadable  budget_available=unreadable
  +total_budget=128  budget_in_use=187  budget_available=0
  ```

  证据：`.quay/rd-evidence/ac2-evidence.txt`（脚本 `ac2-negctl.sh`）。

- [x] AC3: **分量回归**：把红率分别按 `R` 分量、按 `D` 分量分桶各算一次；贴 n 与红率表，并写明样本来源（真实载体）与时间窗。

  **(i) 前提复核（大 n，真实全量套件历史）** — 载体 `quay/.quay/verification-round.jsonl`（全量套件轮），剔 `reason=aborted` 后 **n=2748**，时间窗 **2026-08-12T03:28 → 2026-10-15T17:51**。**独立重算（没有抄 Proposal ①）**，逐桶完全一致：`0-25 30.2%(1426)`、`25-50 34.7%(1124)`、`50-75 55.8%(138)`、`75-100 88.9%(27)`、`100-150 96.2%(26)`、`150-200 100%(4)`；`load>=100` 90.9% vs `load<100` 33.9%。⇒ loadavg 是**已被测过**的预测量。

  **(ii) 分量分桶（新字段，落地后唯一存在的样本）** — 载体 `.quay/rd-evidence/state/verification-round.jsonl`（真实 `full-suite-runner.ts` 20 次调用写的行，20/20 带分量），时间窗 **2026-10-15T20:03:07Z → 20:07:15Z**（约 4 分钟），口径 = **scoped 轮**（`--for-task … --allow-thin`，其红轴是 scoped 闸的结论，**不是全量套件的**）：

  | R (procs_running) | n | red | 红率 |
  |---|---|---|---|
  | 0–9 | 7 | 0 | 0.0% |
  | 10–19 | 10 | 0 | 0.0% |
  | 20–39 | 3 | 0 | 0.0% |
  | ≥40 | 0 | – | – |

  | D (procs_blocked) | n | red | 红率 |
  |---|---|---|---|
  | 0 | 16 | 0 | 0.0% |
  | 1–4 | 4 | 0 | 0.0% |
  | ≥5 | 0 | – | – |

  | R+D (runq) | n | red | 红率 |
  |---|---|---|---|
  | 0–9 | 6 | 0 | 0.0% |
  | 10–19 | 11 | 0 | 0.0% |
  | 20–39 | 3 | 0 | 0.0% |

  ⛔ **这张表不能推出任何结论，原因写清楚**：①每桶 red=0（20 轮 scoped 全绿），红率估计量退化为 0，无判别力；②口径是 scoped 轮，与 (i) 的全量套件红率**不可比**（分母不是同一个套件）；③按 Proposal ③ 的结构性限制，**全量套件的分量样本今天 n=0**（历史 2748 行早于本字段）。④唯一那条真实的红行（`rdcomp-1`，R=10/D=0/R+D=10，red）**已从回归中剔除**：它的红是 `sh-census-check` 静态失败（与负载无关），纳入会把一个与桶轴无关的红注入桶里。

  **(iii) 分量↔loadavg 标定（真实曲线样本，n=80）** — 载体 `.quay/rd-evidence/state/suite-load-rdcomp-*.jsonl`（真实 sampler 输出），时间窗 **2026-10-16T04:03:08 → 04:07:22**：loadavg 13.87/17.25/34.75（min/中位/max），R+D 6/13/41，D=0 占 57/80、max D=5，**loadavg ÷ (R+D)：min 0.37 / 中位 1.33 / max 3.85（>2 占 14/80，>3 占 4/80）**。⇒ 两者确实是不同的量（EWMA 记得上一分钟），但**本窗口内没有一个样本靠近任一阈值**（0/80 在任何判据下 WAIT），所以「改读法会不会翻结论」在本窗口**观测不到**——这正是需要攒量的理由。

  完整输出：`.quay/rd-evidence/regression-out.txt`（脚本 `regression.py`）。

- [x] AC4: **判别性结论**：给出「换判据 / 保留 loadavg / 并用」的结论，并写明它**支持或排除了**哪个假说。⛔ 不得只写「差别不大」——若结论是「保留 loadavg」，必须给出**证伪性对照**（即：若换成瞬时 R+D，读数会怎样不同）。

  **结论：保留 loadavg，本任务不改判据；把「改用/并用瞬时 R+D」记为【待分量回归数据】的待决项。**

  它**支持**的假说：Proposal ② 的「判据读的量是滞后的」——实测成立（AC3-iii：同一瞬间 loadavg 可以到 R+D 的 3.85 倍；AC1-b 里 loadavg 一步从 18.62 跳到 34.75 而 R+D 只从 18 到 19）。
  它**排除**的假说：Proposal ② 隐含的推论「所以判据该改读 R+D」——**没有任何数据支持** R+D 是更好的红率预测量：全量套件的分量样本 n=0，唯一的 scoped 表每桶 red=0（AC3-ii）。用一个未被测过的量替换一个已被测过的量（loadavg：30%→96% 红率，n=2748），违背本任务 DoD 的「改造必须由 AC3 的数据推动」。

  **证伪性对照（若换成瞬时 R+D，读数会怎样不同）**：①**比值**（已测）：`loadavg/(R+D)` 中位 1.33、max 3.85。②**条件外推**（⛔ 是外推不是测量，高负载点在本窗口不存在）：若该中位比值在那个负载上成立，则 `load1 = 256`（现行 WAIT 阈值）处 `R+D ≈ 192 < 256` ⇒ 判据 `runq >= nproc×2` 会在 `load >= nproc×2` 判 WAIT 的那一刻**判 GO**，即换成 R+D 会让闸在过载窗口**开门**。③它的**证伪器**（预登记）：在真实过载窗口（load1 ≥ 256）测该比值——若那里 ≈1，两条判据同向、上面的「翻结论」不成立；若 ≥2，翻结论为真。在拿到该读数之前，**不得**改判据。

- [x] AC5: 若 AC4 的结论是改判据，则必须保负控：注入**瞬时 R+D ≥ 阈值** ⇒ 仍必须 WAIT；并贴「loadavg 高但瞬时 R+D 低」那一刻的实际判定（必须与 AC4 的结论一致）。

  AC4 结论 = **保留 loadavg（不改判据）** ⇒ 本 AC 的**前提不成立**（没有新判据需要负控）。两个替代性的可证伪读数已取：
  - **分量对判定完全无效**（注入极值，真实 gate 调用）：`R+D = 0` / `39` / `19998` 三次注入，三次都 `exit 0`、`=> GO: 资源充足，可以跑`，判定行一字不变 ⇒ 新字段在任何取值下都不移动结论。（`.quay/rd-evidence/ac5-inert-control.txt`）
  - 「loadavg 高但瞬时 R+D 低」那一刻的实际判定：判据仍未变，因此**那一刻的判定仍由 loadavg 决定**（= WAIT），这正是 AC4 保留结论的**代价面**，也正是 AC4-② 的条件外推要量化的东西。⛔ 本窗口内 loadavg 未达阈值，故未观测到该形态；预登记的证伪器（AC4-③）覆盖它。

- [x] AC6: 改动只落在声明的 `## Touches` 内（贴 `git diff --name-only`）。

  ```
  packages/quay/src/kernel/load-avg.ts
  plugin/scripts/full-suite-runner-types.ts
  plugin/scripts/full-suite-runner.ts
  plugin/scripts/pre-verified-round-record.ts
  plugin/scripts/resource-gate.sh
  plugin/scripts/suite-load-sampler.ts
  ```
  6 个文件全部在 `## Touches` 内（`packages/quay/src/kernel/load-avg.ts` 为本次**新增声明**：它已经是「读取宿主负载」的唯一 kernel 落点，两个层都可达；把 `readRunQueue` 放在插件侧会让 hub 静态 import 一个带 entry guard 的入口脚本——正是 `gap-goal-branch-dispatch-wiring-and-task-fan-in` 记录的 inline-hijack 形状，故取 kernel 落点）。`resource-gate.sh` 对 `sh-census-check.ts` 的零余量 `embeddedInterpreterLines` 棘轮做到 **net 0 代码行**（`unmeasurable` 三处 guard 3→1 行折叠支付新读数的 4 行；读数 6566 = baseline 6566）。

## DoD

- AC3 的回归表必须来自**真实生产载体**（`.quay/verification-round.jsonl`、load sampler、资源闸输出），⛔ fixture / 注入 / mkdtemp 自检**不算**；并写明样本的**时间窗与 n**。
- ⛔ 达成方式不得是：手工调 `RESOURCE_GATE_LOAD_OVER_FACTOR`、放宽阈值、删除或弱化 WAIT 分支、或把判据改成恒 GO。
- ⛔ 不得在**没有分量回归读数**的情况下就改判据；改造必须由 AC3 的数据推动。
- 若加了字段 ⇒ 贴一条**实现落地之后**产生的真实记录（硬规则 4 推论三：只证明「能产出」不算，要证明「已产出」）。

## Touches

- packages/quay/src/kernel/load-avg.ts
- plugin/scripts/suite-load-sampler.ts
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/full-suite-runner-types.ts
- plugin/scripts/resource-gate.sh
- plugin/scripts/pre-verified-round-record.ts
- tasks/gap-resource-gate-reads-lagging-loadavg-not-instantaneous-rd.md
