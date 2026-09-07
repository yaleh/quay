---
id: gap-process-budget-in-use-structurally-zero-never-throttles
title: 跨层进程预算的 in_use 恒 0（仪器自检已报故障却不影响取值）⇒ 套件并发恒等于 nproc、对既有负载完全不感知，有效超订约 2×
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test plugin/test/resource-gate.test.mjs
---
## Finding

**结论**：套件并发的派生式**本来是预算感知的**——`scripts/test.sh:418` `default = max(1, floor((total_budget − in_use) / AMPLIFICATION))`——但它读到的 `in_use` **结构上恒为 0**，于是恒等于 `nproc`，对宿主上已经在跑的一切**完全不感知**。

### 一、实测（套件正在跑时采的，非空闲态）

```
$ ps -eo args | grep -c '[f]ull-suite-runner'   → 1        （套件在跑）
$ bash plugin/scripts/process-budget.sh
total_budget=16
in_use=0                       ← 恒零
available=16
verdict=GO                     ← 恒 GO
node_comm_mainthread=0
node_cmdline_procs=84          ← 同一时刻 84 个 node 进程
instrument_failure=1
instrument_failure_note=comm 字面量 node-MainThread 恒 0 但 cmdline 见 84 个 node 进程 —— 本机 comm=MainThread; 读数以 cmdline 为准
```

⇒ `max(1, floor((16 − 0) / 1.0)) = 16`。**并发恒 16，无论机器上还有什么。** 实测套件运行期间 `loadavg` 26–42（16 核），有效超订约 **2×**。

### 二、缺陷的确切形态：自检修了「报警」这一半，没修「取值」那一半

CLAUDE.md 硬规则④推论二的检测半边（2026-08-12 立）要求：**按 comm 精确匹配为零、而按 cmdline 匹配非零 ⇒ 报【仪器故障】，不是报「机器空闲」**。这一半**已经做到了**——上面的 `instrument_failure=1` 与 note 就是它，措辞甚至明确写了「读数以 cmdline 为准」。

**但 `in_use` 自己仍然用那个坏读数**：自检把结论写进了一个旁路字段，而**消费方（并发派生式、`verdict`）读的还是恒零的那个量**。⇒ 诚实地报了故障，然后照常按故障值决策。

⊢ 这是硬规则③b 的一个新变体：不是「读不懂伪装成合格」，而是**「已知读不懂、但照样把那个值喂给下游」**——报警与取值脱钩。

### 三、与「降低超订系数」的关系（人 2026-09-07 指示的第二个杠杆）

`AMPLIFICATION` 当前 = 1.0，即并发 = `nproc`，**相对核数已经没有超订**。真正的超订来自**分母之外**：宿主基线负载（`quay.ts serve` 44.5% CPU、三个 driver 及其子进程、数十个 claude 进程）没有被计入 `in_use`。

⇒ **把 `in_use` 修真，正是把有效超订系数从 ~2 降到 1**，且是自适应的——机器空闲时仍拿满 `nproc`，忙时自动让路。**静态调大 `AMPLIFICATION`**（例如 1.0→2.0，并发砍半）是另一条路，但它在机器空闲时同样砍半，代价是墙钟翻倍。

**方向倾向（供执行者判断，非强制）**：
- **甲（自适应，推荐先做）**：让 `in_use` 用**已经算出来的** cmdline 读数（`node_cmdline_procs`），或在 `instrument_failure=1` 时 fail-closed 到该读数；⇒ 派生式立刻变得真正预算感知。⚠️ 须注意 `node_cmdline_procs` 计的是**全部** node 进程（含 claude 自身、driver、serve），与 `total_budget=nproc` 的语义是否可比，**须由执行者测量后定义**，⛔ 不要直接相减了事。
- **乙（静态兜底）**：若甲的语义一时定不下来，可先把 `AMPLIFICATION` 调到使并发 ≤ `nproc − 观测基线`，并**写明这是临时值与它的到期条件**（⛔ 硬规则④推论二：不要写一个恰好等于当前机器容量的字面值）。
- ⛔ **不接受**：①只改 note 措辞而不改取值（问题原样保留）；②把 `verdict` 恒改成 WAIT（会直接停掉全部交付）；③用 `pgrep -xc node-MainThread` 之外的另一个**同样依赖 comm 字面量**的读法（换个字面量还是会随宿主/Node 版本失效）。

### 四、与另一条任务的关系（都需要，不重叠）

`gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in`（优先）修「三个负载敏感文件未进安静泳道」；本条修「套件并发不感知既有负载」。**只做任一条都仍会红**：泳道只保护那三个文件，而满并发会继续把别的计时断言推翻（8 轮里已出现 6 个不同文件）；只降并发则那三个文件在负载尖峰时仍可能红。

## AC

- [ ] `in_use` 反映真实占用：在**已知有 N 个 node 测试进程在跑**的场景下，`process-budget.sh` 的 `in_use` 非零且与该场景单调相关（⛔ 恒零、⛔ 恒等于某常数）。
- [ ] 双向能取假：无额外负载时 `available` 接近 `total_budget`；人为起 K 个 node 进程后 `available` 相应下降；两个方向都断言，且**用 cmdline 读法核对**（⛔ 不得用 comm 字面量做判据——它正是坏掉的那个）。
- [ ] 仪器故障不再与取值脱钩：断言当 `instrument_failure=1` 时，`in_use`/`available`/`verdict` **不得**沿用已知坏掉的读数（三态：真实值 / fail-closed 值 / 明确的「未评估」，⛔ 不得与「机器空闲」同形）。
- [ ] 派生式确实随之改变：给定一个 `in_use` 非零的场景，`scripts/test.sh` 派生出的主泳道并发 **小于** `nproc`；把 `in_use` 改回 0 ⇒ 并发回到 `nproc`（能取假）。
- [ ] 空闲不被误伤：机器空闲时派生并发仍为 `nproc`（⛔ 修复不得变成无条件降并发）。

## DoD

- [ ] 上述判据本轮实跑并贴出输出（⛔ 不是转述），双向负控制均实跑确认能取假。
- [ ] **生产载体证据（非 fixture）**：在真实工作区、真实有套件或 worker 在跑时采一次 `process-budget.sh` 输出，贴出 `in_use` 非零；⛔ 不得只用 fixture 证明（硬规则④推论三——本缺陷正是「fixture 能过、生产恒零」）。
- [ ] 若采用乙（静态调 `AMPLIFICATION`），须写明该值的**到期条件**与它依赖的宿主读数；⛔ 不得留下一个只对本机成立的字面量（硬规则④推论二）。
- [ ] 与 `gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in` 的关系写入任务体，说明为何两条都需要。
- [ ] ⛔ 未把 `verdict` 恒改为 WAIT；⛔ 未新增 driver kind、未新增周期性检查器（SPEC §5.1）。

## Touches

- `plugin/scripts/process-budget.sh`
- `plugin/scripts/resource-gate.sh`
- `scripts/test.sh`
- `plugin/test/resource-gate.test.mjs`
- `tasks/gap-process-budget-in-use-structurally-zero-never-throttles.md`
