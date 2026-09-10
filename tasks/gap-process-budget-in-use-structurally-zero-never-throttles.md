---
id: gap-process-budget-in-use-structurally-zero-never-throttles
title: 跨层进程预算的 in_use 恒 0（仪器自检已报故障却不影响取值）⇒ 派生式的「减去在用」这一项永远不减；叠加 config 的
  max_oversubscription 后实测 splice 出 --test-concurrency=28（16 核）
status: done
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

> **⚠️ 立案后更正（2026-09-07T08:2xZ）**：原标题写「并发**恒等于 nproc**」是**错的**——实测 splice 出的是 **28**（= nproc 16 × `max_oversubscription` 1.75），不是 16。核心缺陷（`in_use` 恒 0 使「减去在用」这一项永不生效）不变，但乘数那一半当时没查到。第一节已补。

**结论**：套件并发的派生式**本来是预算感知的**——`max(1, floor((total_budget − in_use) × oversub / slots))`——但它的两个输入都失效了：`in_use` **结构上恒为 0**（减法永不减），而 `oversub` 从 config 读到 **1.75**（乘法把它抬到 nproc 之上）。合起来：**16 核的机器上实际跑 28 条测试泳道**。

### 一、乘数那一半（立案时漏查，现已补齐）

活进程实测——正在跑的 fan-in 套件，其 `full-suite-runner` 的子进程命令行逐字：

```
bash scripts/test.sh --buckets gap-meta-carrierstats --test-concurrency=28
```

来源 `.quay/config.yml`（**未受版本控制的本地配置**，`.gitignore:411`）：

```yaml
suite:
  main_tail_overlap_lanes: 16
  max_oversubscription: 1.75      ← 16 × 1.75 = 28，与实测逐字吻合
```

`plugin/scripts/full-suite-runner.ts:1142 defaultLaneCount()`：
```
oversub = QUAY_MAX_OVERSUBSCRIPTION ?? 1
return Math.max(1, Math.floor(ncpu * oversub / (slots + yielded)))
```
config → env 的提升由 `plugin/scripts/suite-params.ts` 完成（config < env < CLI）。

**⚠️ 人 2026-09-07 已指示把超订系数降到 1，我已把该配置行改为 `max_oversubscription: 1` 并用 YAML 复 parse 验证；`readSuiteParams()` 实跑返回 `{"max_oversubscription":1,...}`** ⇒ 下一轮套件应 splice 16 而非 28。**⛔ 这只是运维止血，不是本任务的修法**——该文件不受版本控制、不随提交落地，换台机器/重装即回到 1.75。

### 二、减法那一半（本任务的核心，未变）

套件正在跑、84 个 node 进程在的同一时刻：

```
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

⇒ `(total_budget − in_use)` 这一项**永远等于 total_budget**，对宿主上已经在跑的一切完全不感知。实测套件运行期间 `loadavg` 26–45（16 核）。

### 三、缺陷的确切形态：自检修了「报警」这一半，没修「取值」那一半

CLAUDE.md 硬规则④推论二的检测半边（2026-08-12 立）要求：**按 comm 精确匹配为零、而按 cmdline 匹配非零 ⇒ 报【仪器故障】，不是报「机器空闲」**。这一半**已经做到了**——`instrument_failure=1` 与那句 note 就是它，措辞甚至明确写了「读数以 cmdline 为准」。

**但 `in_use` 自己仍然用那个坏读数**：自检把结论写进了一个旁路字段，而**消费方（并发派生式、`verdict`）读的还是恒零的那个量**。⇒ 诚实地报了故障，然后照常按故障值决策。

⊢ 硬规则③b 的一个新变体：不是「读不懂伪装成合格」，而是**「已知读不懂、但照样把那个值喂给下游」**——报警与取值脱钩。

### 四、两半都要修，只修一半仍会超订

- 只把 `oversub` 降到 1：并发 = `nproc` = 16，**仍然假设机器是空的**（基线实测 10–15）⇒ 有效超订仍约 2×。
- 只修 `in_use`：`oversub=1.75` 会把 `(16 − in_use) × 1.75` 重新抬上去。
- ⇒ **`in_use` 修真才是把有效超订压到 1 的那一半，且是自适应的**（空闲时仍拿满 `nproc`，忙时自动让路）；`oversub` 则应是一个**有理由的常数**，而不是一个没人记得为什么是 1.75 的实验残留。

**方向倾向（供执行者判断，非强制）**：
- **甲（自适应，推荐先做）**：让 `in_use` 用**已经算出来的** cmdline 读数（`node_cmdline_procs`），或在 `instrument_failure=1` 时 fail-closed 到该读数。⚠️ `node_cmdline_procs` 计的是**全部** node 进程（含 claude 会话、driver、serve），与 `total_budget=nproc` 的语义是否可比，**须由执行者测量后定义**，⛔ 不要直接相减了事。
- **乙（把 oversub 的默认与理由钉住）**：`max_oversubscription` 的**代码默认**已是 1；本条不改它，但须确认「config 缺省时行为正确」，并在任务体写明生产 config 的 1.75 是实验残留、已由人指示改为 1。
- ⛔ **不接受**：①只改 note 措辞而不改取值；②把 `verdict` 恒改成 WAIT（会直接停掉全部交付）；③换另一个**同样依赖 comm 字面量**的读法（换个字面量还是会随宿主/Node 版本失效）；④只改 `.quay/config.yml` 就算修完（该文件不受版本控制，换机即回退）。

### 五、与另外两条任务的关系（都需要，不重叠）

- `gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in`（优先）修「三个负载敏感文件未进安静泳道」。**只做任一条都仍会红**：泳道只保护那三个文件，而超订会继续把别的计时断言推翻（8 轮里已出现 6 个不同文件）；只降并发则那三个文件在负载尖峰时仍可能红。
- `gap-retire-main-tail-overlap-lanes-dead-knob-live-branches`：同一段 config 的**另一个**旋钮（人 2026-09-07 裁定废弃）。⛔ 本条**不动** `main_tail_overlap_lanes`，那条**不动** `max_oversubscription`。
- **（实现时补的第三条）与 `gap-suite-budget-oversubscribe` 的关系**：本条把该任务确立的「纯计算」公式 `nproc × oversub / S` 改成 `(nproc − in_use) × oversub / S`。**不重叠、不冲突**：`S` 除数（跨套件结构性上限 Σ lane ≤ nproc×oversub）**保留不变**；`in_use` 减法只是**在该上限内的单向向下调整**（忙宿主拿更少泳道，最坏情形 in_use=0 退化为纯公式）。该任务当年否决的「认领制/锁发配额」（新增运行时状态）与本条无关——本条读的 `in_use` 来自 `process-budget.sh`（已存在的 cmdline 分类，非新运行时状态），且那条关心的「两套件 16+8=24 > 16」超订根因是**没有 S 除数**，本条在有 S 除数之后才做减法 ⇒ 不会重引入超订。

## AC

- [x] `in_use` 反映真实占用：在**已知有 N 个 node 测试进程在跑**的场景下，`process-budget.sh` 的 `in_use` 非零且与该场景单调相关（⛔ 恒零、⛔ 恒等于某常数）。
- [x] 双向能取假：无额外负载时 `available` 接近 `total_budget`；人为起 K 个 node 进程后 `available` 相应下降；两个方向都断言，且**用 cmdline 读法核对**（⛔ 不得用 comm 字面量做判据——它正是坏掉的那个）。
- [x] 仪器故障不再与取值脱钩：断言当 `instrument_failure=1` 时，`in_use`/`available`/`verdict` **不得**沿用已知坏掉的读数（三态：真实值 / fail-closed 值 / 明确的「未评估」，⛔ 不得与「机器空闲」同形）。
- [x] 派生式确实随之改变：给定一个 `in_use` 非零的场景，`defaultLaneCount()` 返回值 **小于** `nproc`；把 `in_use` 改回 0 ⇒ 回到 `nproc × oversub`（能取假）。
- [x] 空闲不被误伤：机器空闲且 `oversub=1` 时派生并发仍为 `nproc`（⛔ 修复不得变成无条件降并发）。
- [x] **代码默认与生产实测对齐**：断言 `QUAY_MAX_OVERSUBSCRIPTION` 未设时 `defaultLaneCount()` 用 1（不是 1.75），并贴出一次真实 fan-in 套件的 `--test-concurrency=` 实测值作为生产证据。

## DoD

- [x] 上述判据本轮实跑并贴出输出（⛔ 不是转述），双向负控制均实跑确认能取假。
- [x] **生产载体证据（非 fixture）**：在真实工作区、真实有套件或 worker 在跑时采一次 `process-budget.sh` 输出，贴出 `in_use` 非零；⛔ 不得只用 fixture 证明（硬规则④推论三——本缺陷正是「fixture 能过、生产恒零」）。
- [x] 生产 `--test-concurrency=` 实测值写回任务体（立案时为 **28**，人已把 config 降到 1 后应为 **16**，本条修完后应 **< 16**）；三个数都要有真实读数。
- [x] 与上述两条任务的关系写入任务体，逐条说明为何不重叠。
- [x] ⛔ 未把 `verdict` 恒改为 WAIT；⛔ 未改动 `main_tail_overlap_lanes`；⛔ 未新增 driver kind、未新增周期性检查器（SPEC §5.1）。

### 判据实跑输出（本轮 2026-09-07，真实命令输出，非转述）

**AC1/AC2 双向（起 4 个真实 `node --test` 进程，每文件 1 runner + 1 worker = 8 个测试进程）**：

```text
# 起 4 个真实 node --test 前（空闲）：
{"total_budget": 16, "in_use": 0, "available": 16, "verdict": "GO", "node_comm_mainthread": 0, "node_cmdline_procs": 89, "instrument_failure": 1}
# 起 4 个真实 node --test 后：
{"total_budget": 16, "in_use": 8, "available": 8, "verdict": "GO", "node_comm_mainthread": 0, "node_cmdline_procs": 96, "instrument_failure": 1}
# 杀掉后（回空闲）：
{"total_budget": 16, "in_use": 0, "available": 16, "verdict": "GO", "node_comm_mainthread": 0, "node_cmdline_procs": 87, "instrument_failure": 1}
```

**AC3（instrument_failure=1 与取值脱钩，seam 钉死）**：

```text
RESOURCE_GATE_TEST_COMM_COUNT=0 RESOURCE_GATE_TEST_CMDLINE_COUNT=5 \
  RESOURCE_GATE_TEST_PROC_CMDLINES="node --test --test-concurrency=1 /tmp/a.test.mjs;node .../quay.js mcp" \
  bash plugin/scripts/process-budget.sh --json
→ {"total_budget": 4, "in_use": 1, "available": 3, "verdict": "GO", "node_comm_mainthread": 0, "node_cmdline_procs": 5, "instrument_failure": 1}
# comm=0 且 cmdline=5 ⇒ instrument_failure=1；但 in_use=1 来自 cmdline 分类（那 1 个 --test worker），
# 不是坏掉的 comm 读数的 0 —— 报警与取值已不再脱钩。
```

**AC4/AC5/AC6（defaultLaneCount 派生式，seam）**：

```text
in_use=0,  S=1, oversub=1  → defaultLaneCount=16   （空闲 = nproc，未被误伤）
in_use=4,  S=1, oversub=1  → defaultLaneCount=12   （< nproc，预算感知）
in_use=20 ≥ nproc          → defaultLaneCount=1    （max(1, …) 钳位，永不 0/负）
oversub 未设 + in_use=0    → defaultLaneCount=16   （代码默认 oversub=1，不是 1.75 ⇒ 不是 28）
```

**DoD2 生产载体（真实工作区、真实 fan-in 套件在跑的同一时刻，非 fixture）**：

```text
$ bash plugin/scripts/process-budget.sh --json
{"total_budget": 16, "in_use": 3, "available": 13, "verdict": "GO", "node_comm_mainthread": 0, "node_cmdline_procs": 96, "instrument_failure": 1}
$ node --experimental-strip-types --input-type=module -e 'import("./plugin/scripts/full-suite-runner.ts").then(m => console.log(m.defaultLaneCount()))'
13    ← (16 − 3) × 1 / 1，真实 in_use=3 ⇒ 派生并发 13 < 16（修完后忙时自动让路）
```

**DoD3 三个 `--test-concurrency=` 实测值**：

- 立案时（oversub=1.75）：**28**（finding §一 的 ps 捕获：`bash scripts/test.sh --buckets gap-meta-carrierstats --test-concurrency=28`）。
- config 降 1 后（纯公式、无 in_use 减法）：**16**（本轮实时捕获：`bash scripts/test.sh --buckets gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in --test-concurrency=16`）。
- 本条修完后（真实 in_use=3）：**13**（上面 defaultLaneCount 实跑，< 16）。

**DoD5 负控制**：未把 `verdict` 恒改 WAIT（`process-budget.sh` 的 verdict 逻辑未动，仍 `available ≥ 1 ⇒ GO`）；未动 `main_tail_overlap_lanes`（`suite-params.ts` / config 该键未改）；未新增 driver kind / 周期检查器（只改 `runner-concurrency.ts` / `full-suite-runner.ts` 的派生式 + 相关测试判据）。

## Touches

- `plugin/scripts/full-suite-runner.ts`
- `plugin/scripts/runner-concurrency.ts`
- `plugin/test/resource-gate.test.mjs`
- `plugin/test/runner-concurrency.test.mjs`
- `plugin/test/full-suite-runner-phases.test.mjs`
- `plugin/test/suite-slot-ssot-check.test.mjs`
- `plugin/test/worker-driver.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-process-budget-in-use-structurally-zero-never-throttles.md`
