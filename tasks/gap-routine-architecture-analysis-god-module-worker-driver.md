---
id: gap-routine-architecture-analysis-god-module-worker-driver
title: "architecture-analysis: worker-driver.ts is 7149 lines, the repo's
  largest module; runResidentLoop outDegree=95"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
worker-driver.ts is 7149 lines, the repo's largest module; runResidentLoop outDegree=95

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793622670475` · ts `2026-11-02T12:31:10.475Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`runResidentLoop`
- 涉及文件：
- `plugin/scripts/worker-driver.ts:5822`
- kind：`god-module`
- verdict：`CONFIRMED`

## Requested action
Extract resident-loop and fan-in logic from worker-driver.ts into smaller driver modules

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-02T12:31:10.475Z

## Disposition（处置结论，可核）

复核时间 2026-11-02，worktree `gap-routine-architecture-analysis-god-module-worker-driver` @ develop `42ca016b4`。

### 1. 读数复核：finding 属实

| 量 | finding | 本次实测 | 命令 |
|---|---|---|---|
| worker-driver.ts 行数 | 7149 | 7149 | `wc -l plugin/scripts/worker-driver.ts` |
| runResidentLoop 定义行 | :5822 | :5822 | `grep -n "export async function runResidentLoop" plugin/scripts/worker-driver.ts` |
| runResidentLoop 出度 | 95 | 48 call / 62 deps（旧 scope `b4f87b21`） | archguard 口径随版本漂移，见下 |

出度口径说明（与 `gap-worker-driver-resident-loop-decomposition-discovery` §E5 同一把尺）：finding 的 95 是
今日例程的新鲜 archguard scope（6144 实体）；旧 scope `b4f87b21`（2026-10-21）call 出度 48 / deps 出度 62，
§E5 记 call 出度 84。三个数是「同一符号随代码与 archguard 口径增长」的同一条轨迹，95 在轨迹上、非孤点。

### 2. 处置：fan-in 半边【已修】+ resident-loop 半边【已有机制在管、失败在哪一步】

**fan-in 半边已修**：`Requested action` 的 "extract fan-in logic" 已由
`gap-arch-worker-fan-in-extract-from-worker-driver`（status: done）完成——机械 fan-in 区域（scoped 门 /
doc-check 解析 / kernel sibling argv / scoped-gate 缓存签名 / ff-merge 加载）已抽到
`plugin/scripts/worker-fan-in.ts`（4382 行），`worker-driver.ts:443/545` 现 `import { runMechanicalFanIn }
from "./worker-fan-in.ts"`。可核：`wc -l plugin/scripts/worker-fan-in.ts` = 4382；
`grep -c 'from "./worker-fan-in.ts"' plugin/scripts/worker-driver.ts` = 4。

**resident-loop 半边：已有机制在管、失败在哪一步**：

| 机制 | 管什么 | 失败在哪一步 |
|---|---|---|
| `gap-worker-driver-resident-loop-decomposition-discovery`（status: done） | 把 runResidentLoop 切四关注点（①状态机 ②派发决策 ③派发执行 ④落账）+ 定执行顺序 ④→①（②③ 是控制脊、⛔ 不做第一刀） | 其 DoD 逐字写「不实现拆分、不开 goal；是否立切片 goal 另行决定」——**分析→执行交接从未发生** |
| `gap-arch-worker-fan-in-extract-from-worker-driver`（status: done） | 抽走 fan-in 半边 | 已成功（见上），只剩 resident-loop 半边 |
| `archguard-runner.ts` / `import-graph-check.ts` | 每次 analyze 记 outDegree / 查 SCC | 只记录不判定（god-module 无阈值棘轮）；无 domain 维度 |
| `routine-file-gate.ts` dedup 闸 | 防同 subject 重复立案 | subject 键 = 精确符号集（`runresidentloop`），符号跨轮漂移 ⇒ 退化 rate 兜底 |

**失败在哪一步（一句话）**：resident-loop 拆分的分析已完成、执行顺序已定，但 discovery 任务明确不开
执行 goal ⇒ 无任何后续执行任务（`ls tasks/ | grep -c worker-round-ledger` = 0），故本 finding 以 module 级复发。

**下一步执行增量（本任务不执行——顺序不可交换，⛔ 非「已注意到」而是落到可执行动作）**：
① 立切片执行任务：`writeRound`/`writeErrorRound` → `plugin/scripts/worker-round-ledger.ts`（④ 落账，
discovery J1 的第一刀）；② 再 ① 状态机（`worker-pool.ts` 已收 retry/backoff，剩余收尾）。⛔ ②③（派发决策/执行）
是 while 控制脊，discovery J1 明确「不建议作为第一刀」。

### 3. 复核命令（可重跑）

```bash
wc -l plugin/scripts/worker-driver.ts plugin/scripts/worker-fan-in.ts
grep -n "export async function runResidentLoop" plugin/scripts/worker-driver.ts
grep -c 'from "./worker-fan-in.ts"' plugin/scripts/worker-driver.ts
grep -m1 '^status:' tasks/gap-arch-worker-fan-in-extract-from-worker-driver.md
grep -m1 '^status:' tasks/gap-worker-driver-resident-loop-decomposition-discovery.md
ls tasks/ | grep -c worker-round-ledger   # 期望 0（无执行任务 = 「失败在哪一步」的载体）
```

### 4. 读数（ADR-007）
- L_D import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0 files=555 edges=1712
- L_G archguard: runResidentLoop_outDegree=95 worker_driver_lines=7149 worker_fan_in_lines=4382

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-module-worker-driver`（routine `architecture-analysis`，runId `architecture-analysis-1793622670475`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/worker-driver.ts`
- `tasks/gap-routine-architecture-analysis-god-module-worker-driver.md`