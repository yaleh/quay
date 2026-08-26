---
id: gap-suite-lane-budget-structural-guarantee-broken-buckets-no-lock
title: lane 预算「Σ lane ≤ nproc×oversub」结构性保证失效——--buckets 路径不取锁 ⇒ 每 suite 取满 16 lanes ⇒ M bucket 2-3x 超订（墙钟 +72% 但工作量只 +16%）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`full-suite-runner.ts` 的 lane 预算公式 `floor(nproc × oversub / S)`（:1060-1070 `defaultLaneCount`）的安全性论证是「S 个 suite 各自派生 nproc×oversub/S ⇒ **Σ lane ≤ nproc×oversub structurally**」（:1046-1058）。**这个结构性保证有两个漏口，实测已把墙钟拖慢 37%**：

**实测（manager 直接量，读 `.quay/verification-round.jsonl` 643 轮 + 读码到行）**：
```
M bucket（最常见）：墙钟中位 310s → 534s（+72%），cpu_time 2608→3036（+16%），tests +5%，bucket_files +10%
⇒ 工作量只涨 16%、墙钟涨 72%，差额全在【真实并行度】 9.05 → 5.64（−38%）
负控制（最硬）：三个最重文件两时间点 git 对象逐字节相同（prod-data-audit / quay-init-loop / real-target-verify
  同一份字节分别慢 +69% / +41% / +23%）⇒ 文件没变、CPU 没怎么涨 ⇒ 只能外部争抢
并发交叠（按 [startedAt, startedAt+duration] 窗口相交，⛔ 非单点 load）：#450-490 中位 0（几乎独占），
  #600-643 中位 1、29/44 轮至少 1 个并发 suite
```

**漏口①（核心，⛔ 无既有任务覆盖）**：`--buckets` 路径**根本不取锁**。`full_suite_lock_acquire` 只在 full 路径调用（`scripts/test.sh:914`，`oh_full=1` 分支内）；`--buckets` 分支（`:1385` 一路到 `:1450` 的 `run_selected`/`suite-lpt-runner`）从头到尾没有这一步。⇒ M/P 桶 suite 彼此之间、以及它们与持锁 full suite 之间**完全不受 S 约束**，每个都按 `S=1 ⇒ 我是唯一在跑` 取满 16 lanes。

**漏口②**：锁持有看门狗 `FULL_SUITE_LOCK_HOLD_MAX_S=1800`（`test.sh:657-663`）超 30 分钟释放槽位、而**让出槽位的 suite 继续用它的 16 lanes 跑**。注释原文已接受这个代价（"accepts the contention risk of a (S+1)-th suite joining"），**但 lane 公式没跟着改**——新进来的那个也照样取 16。

⇒ 2-3 个 suite × 16 lanes 跑在 16 核上 = 2-3 倍超订，与实测并行度 9.05→5.64 完全吻合。

**⊢ 已查既有任务（manager grep）**：`laneCount`/`QUAY_MAX_CONCURRENT_SUITES`/`oversubscrib` 命中的全是 `done`（gap-ac68-per-suite-lane-budget-zero-consumers / gap-lane-formula-ignores-phase-overlap-concurrency / gap-ac101-lane-concurrency-control-round 等）——**没有一条覆盖「bucket 路径不取锁 ⇒ lane 预算结构性保证失效」这个缺口**。

## Plan

1. **让 lane 预算与真实并发数一致**（最大杠杆）：要么 `--buckets` 运行也占一个槽（走 S 约束），要么 lane 数改为按**观测到的并发 suite 数**推导而非按声明的 S。方向留实现方，⛔ 不代拍。按当前 CPU 量算：恢复 9.05 并行度 ⇒ 3036/9.05 ≈ 335s，比现在 534s 少 37%。
2. **看门狗让出槽位时同时让出 lane**——现在只让槽不让 lane，等于把「序列化」换成了「双倍超订」。

## Acceptance Criteria

- [ ] AC1（能取假，buckets 受 S 约束）：`--buckets` 路径也取锁（或 lane 数按观测并发推导），M/P 桶 suite 不再彼此 + 与持锁 full suite 之间超订；（⛔ 仍不取锁/仍取满 16 lanes ⇒ 假）。
- [ ] AC2（能取假，看门狗让 lane）：看门狗让出槽位时同时让出 lane（不再只让槽不让 lane 的双倍超订）；（⛔ 只让槽不让 lane ⇒ 假）。
- [ ] AC3（能取假，单跑不退化）：恢复后单 suite 独占时 lane 仍取满 16（⛔ 因修复而把单跑也限死 ⇒ 假——「S=1 时取满」是公式的原意，不该被破坏）。

## Definition of Done

lane 预算与真实并发数一致（两个漏口都堵）；AC1-AC3 全勾；M bucket 真实并行度从 ~5.6 恢复、墙钟回落；单跑不退化。

## Touches

- scripts/test.sh（--buckets 路径取锁 或 lane 按观测并发推导 + 看门狗让槽同时让 lane）
- plugin/scripts/full-suite-runner.ts（defaultLaneCount / lane 预算公式）
- plugin/test/（buckets 受 S 约束 + 看门狗让 lane + 单跑不退化负控制）
- tasks/gap-suite-lane-budget-structural-guarantee-broken-buckets-no-lock.md（自身）
