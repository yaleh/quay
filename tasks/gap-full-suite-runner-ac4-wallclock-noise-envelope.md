---
id: gap-full-suite-runner-ac4-wallclock-noise-envelope
title: full-suite-runner AC4：on/off 墙钟差在 fan-in 负载下 1.86% > 1% ⇒
  采样与噪声容限按实测收紧（instrument 腿仍守 1%）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/test/full-suite-runner-cgroup.test.mjs:586-649` 的 AC4 有两条腿：

- instrument 腿：`samplerCostMs / minOn <= 1%` —— 采样器自身成本的权威读数；
- 墙钟 A/B 腿：`(minOn - minOff) / minOff <= 1%` —— 受调度噪声支配。

2026-10-19 fan-in 读数为墙钟腿 **1.86%**（54.1 s），instrument 腿远低于 1%：

```
✖ AC4 — the sampler's own cost stays under 1% of the suite wall ... (54139.011045ms)
  AssertionError: the on/off wall-clock delta is within the 1% budget (measured 1.86%)
```

同一文件在 Ready 任务 `gap-official-dist-delivery-acceptance-resource-optimization-quay-ccui-clean-host` 的干净 Round 3 里 `fail 0`，证明这是负载敏感 flake，不是固定回归。AC-237 已把每臂样本从 2 提到 3，仍不够。

修复方向（实现时二选一，用实测分布定参）：

- 每臂 5 个交替样本 + 取 min；或
- instrument 腿保持 1% 硬上限；墙钟腿引入具名噪声容限（例如 `deltaPct <= max(1%, 2 × 实测空载噪声)`），并把实测分布写进 Evidence。

⛔ 不是无证据地把 1% 抬大了事；必须保留一条「可控地让 instrument 读数 >1% ⇒ 测试仍红」的负控制，证明修法没有把判据变空。

本任务只处理 fan-in/服务 cgroup 下的墙钟腿。8 GiB 会话 cgroup 下另外 5 条宿主形状用例（AC1/AC2/AC3/AC3-DoD/REAL control）是环境前提问题，不是 fan-in 的阻断签名，另案处理，不计入本条。

## Plan

1. 在 fan-in/服务 cgroup（无 8 GiB 会话上限）下复测 AC4，记录 3 次墙钟腿读数与 instrument 读数。
2. 按实测选择 5 样本或具名噪声容限；改动只落在 AC4 的采样/断言，不动其它用例。
3. 加负控制：用可控 fixture 让 `samplerCostMs` 超过预算 ⇒ instrument 腿必须红。
4. 在 fan-in 环境重复跑 3 次，确认墙钟腿不再红。

## Acceptance Criteria

- [x] AC1 — fan-in 环境（服务 cgroup）下 `node --test plugin/test/full-suite-runner-cgroup.test.mjs` 的 AC4 通过；附 3 次墙钟腿与 instrument 腿读数。
- [x] AC2 — instrument 腿仍为 1% 硬上限：`costPct <= 1` 的断言保留，且实测值随输出打印。
- [x] AC3 — 负控制：可控地让 instrument 读数 >1% ⇒ 测试 exit 非 0，附失败断言原文；恢复后复绿。
- [x] AC4 — 墙钟腿的容限来自实测：Evidence 里给出空载/负载两组分布与所选参数；不是任意常数。
- [x] AC5 — 同文件其余用例零回归（fan-in 环境下 70/70；8 GiB 会话下那 5 条宿主形状用例另案处理，不计入本条）。

## Definition of Done

fan-in 负载下 AC4 不再是确定性阻断：连续 3 次运行墙钟腿不红，instrument 腿仍能对真实超预算取假；该文件从 fan-in 的 added-red 集合里消失，两条 needs-human 可被 retreat 重试。

## Touches

- plugin/test/full-suite-runner-cgroup.test.mjs
- tasks/gap-full-suite-runner-ac4-wallclock-noise-envelope.md

## Evidence

（实现链：worktree `gap-full-suite-runner-ac4-wallclock-noise-envelope`，branch `task/gap-full-suite-runner-ac4-wallclock-noise-envelope`，commit `a343868ff`。所有读数在 2026-10-20 实测。）

### 1. 墙钟腿测的量本身就是噪声支配的（AC4 的参数来源）

fixture suite = 3 s sleep + TAP echoes，REAL cgroup scope。每臂样本（ms）、min、以及 **min-to-runner-up gap**（该臂最低值与次低值之差 / 最低值，衡量 min 有多少是调度运气）：

| 条件 | 每臂 N | ON min | OFF min | wall delta | gap ON | gap OFF | instrument |
|---|---|---|---|---|---|---|---|
| 空载（load avg ~24 / 128 CPU） | 8 | 9488 | 9450 | **+0.40%** | 0.07% | 0.41% | 1.95 ms |
| 空载（第二次探针） | 6 | — | — | **−0.12%** | 0.30% | 0.06% | 2.03 ms |
| 加 32 个 CPU burner | 8 | — | — | **−0.11%** | 0.44% | 0.02% | 2.09 ms |
| `systemd-run --scope -p CPUQuota=50%`（fan-in 形状） | 6 | 11642 | 11449 | **+1.69%** | 1.20% | 2.12% | 2.08 ms |
| 同上 + journal seam，N=5 | 5 | 6397 | 6299 | **+1.56%** | 1.41% | 2.30% | 2.02 ms |

关键读数：

- **空载下墙钟腿在 0.4% 以内**（两次独立探针 −0.12% / +0.40%），instrument 腿 1.95–2.09 ms = **0.04–0.05%**；
- **服务 cgroup 受限时同一 fixture 的 wall delta 达 1.56–1.69%**，与 2026-10-19 fan-in 报告的 1.86% 同量级 —— 复现了失败签名；
- **仅把 N 从 3 提到 5 不够**：N=5 在 CPUQuota=50% 下仍读出 1.56% > 1%（上表最后一行）。因此本任务同时采用「5 样本」与「运行时噪声容限」，而不是只加样本。

### 2. 所选参数（不是常数，是每轮从同一批样本实测出来的）

- `AC4_SAMPLES_PER_ARM = 5`，且**每一对样本的先后顺序交替**（`on,off` / `off,on`），使测试窗口内的负载单调漂移对两个臂对称，而不是总偏向跑在后面的那个臂。
- 墙钟腿：`deltaPct <= max(1%, gapOn + gapOff)`，其中 `gap(arm) = (次低值 − 最低值) / 最低值`。
  依据：调度扰动是**单边**的（只会让一轮变慢），所以一个臂的 min 最多比真实 floor「低」它到次低值的距离；两个 min 各自不确定度之和就是 null delta 的上界。
  - 空载实测 gap 之和 0.06–0.44% ⇒ 容限 = **1% 地板**（与修复前同样严格）；
  - CPUQuota=50% 实测 gap 之和 3.32–3.71% ⇒ 容限随之放宽到覆盖实测 1.56–1.69% 的 delta。
- instrument 腿：`costPct <= 1` **原样保留**（`AC4_INSTRUMENT_BUDGET_PCT`），永不使用容限。它是「被预算的量自己的读数」，因此仍是权威判据（实测 0.037–0.051%）。
- 另外把 runner 在 verdict 之后的 `readScopeConsumedLoad` journal 轮询钉到单次 seam：实测该轮询占 9.4 s 墙钟里的 **5.25 s（一半以上）**，且在 sampler 停止之后才跑、与 sampler 成本无关；留在 A/B 里会让一个无关的固定尾巴主导分母、稀释百分比。cgroup scope 本身仍是真实的（`statMax` 断言照旧）。

### 3. AC1 — 3 次 fan-in 形状运行（`systemd-run --user --scope -p CPUQuota=50%`）

| run | ON walls (ms) | OFF walls (ms) | wall delta | 运行时容限 | instrument |
|---|---|---|---|---|---|
| 1 | 5267/5294/5275/5290/5219 | 5320/5201/5226/5371/5219 | **0.35%** | 1.27% | 1.946 ms = 0.037% |
| 2 | 5313/5382/5219/5415/5374 | 5266/5228/5317/5362/5235 | **−0.17%** | 1.94% | 2.061 ms = 0.039% |
| 3 | 5424/5236/5301/5267/5507 | 5181/5366/5241/5259/5289 | **1.06%** | 1.75% | 2.089 ms = 0.040% |

三次均 `pass 1 / fail 0 / EXIT=0`。run 3 正是回归场景：1.06% 会撞上旧的固定 1%，而运行时容限（off-gap 1.16%，即 OFF 的 min 比其次低值低 60 ms）把它正确地容纳为噪声，而非 sampler 开销。

同一容限在**整文件**、`CPUQuota=50%` 下也通过：`A/B delta=−0.06%`，容限 `1.00%`，instrument `2.043 ms = 0.039%`。

### 4. AC2 — instrument 腿仍是 1% 硬上限

`assertSamplerOverheadWithinBudget` 里 `costPct <= AC4_INSTRUMENT_BUDGET_PCT (=1)` 保留，且 stderr 每轮打印 `instrument-recorded samplerCostMs=… ⇒ …% of the suite wall`（上表与每次运行输出可见）。

### 5. AC3 — 可控地让 instrument 读数 >1% ⇒ 红；恢复后复绿

临时把 live AC4 的调用注入为 `assertSamplerOverheadWithinBudget({ ...m, costPct: 2 })`（instrument 读数 2.000%，墙钟腿保持绿），运行实测：

```
✖ AC4 — the sampler's own cost stays under 1% of the suite wall (instrument-recorded cost + an on/off A/B) (39652.936945ms)
  AssertionError [ERR_ASSERTION]: the sampler's own recorded cost is within the 1% budget (measured 2.000%)
      at assertSamplerOverheadWithinBudget (file:///.../plugin/test/full-suite-runner-cgroup.test.mjs:628:10)
      at TestContext.<anonymous> (file:///.../plugin/test/full-suite-runner-cgroup.test.mjs:702:3)
...
EXIT=1
```

注入已还原，同一命令复跑 `EXIT=0 / fail 0`。并且新增了一条**常驻**负控制测试 `AC4 negative control — a controlled >1% instrument reading still reds (the budget is not vacuous)`，它用同一对 `measureSamplerOverhead` + `assertSamplerOverheadWithinBudget` 函数驱动两次注入：instrument 2%（必须抛）、wall delta 高于运行时容限（必须抛），因此非空性每轮都被检查，而不只依赖本次实验记录。

### 6. AC5 — 同文件其余用例零回归

`node --test plugin/test/full-suite-runner-cgroup.test.mjs` →

- 普通环境：`tests 71 / pass 71 / fail 0 / cancelled 0 / skipped 0`，`EXIT=0`（83.6 s）；
- `systemd-run --user --scope -p CPUQuota=50%`（fan-in 形状）：`tests 71 / pass 71 / fail 0 / cancelled 0 / skipped 0`，`EXIT=0`（142.3 s）。

这 71 条里包含本任务新增的 `AC4 negative control — a controlled >1% instrument reading still reds`。AC 原文的「70/70」是写就时的计数；本次以实际注册条数 71/71 为准，其余用例零回归。
