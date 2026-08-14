---
id: gap-suite-budget-oversubscribe-lock-carried-quota
title: nproc−in_use 预算公式固有超用——两并发 suite 各拿满预算（16+8=24>16，load 29.23）；修法=锁携带 lane 配额（认领制）
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（`nproc − in_use` 预算公式固有超用——manager 2026-08-14 14:3xZ 报，首次实测到代价）**。

**现场（14:39:14Z，按 ppid 归并非猜）**：
```
ppid 3546904 → 16 worker · ppid 3553084 → 8 worker ⇒ 两 suite 合计 24 并发 worker
同刻跨层预算：total_budget=16 in_use=26 available=0 verdict=WAIT
按 worktree 归并：test-isolation=30 进程 · workflows-dual-copy=16 进程
load1 = 29.23（今日最高，前高 18.58，上一轮 2.20）
```

**为什么会这样（公式固有性质，非竞态）**：
```
main lane = max(1, floor((total_budget − in_use) / AMP))
每个 suite 只减【它启动那一刻】已在用的，没人减【将来会来的】
⇒ 先起读 in_use≈0 ⇒ 拿满 16 ⇒ 后起读 in_use≈8 ⇒ 拿 8 ⇒ 合计 24 > 预算 16
```

**回退理由只算了欠用侧**（人 06:33:56 裁定 AC68 /slots 回退，test.sh:835-840 理由成立：单 suite /S 白砍一半、两 suite (16−8)/1/2=4 ⇒ 12<16 欠用 4）；**今天的读数补上超用侧**：
```
欠用（回退前）：两 suite ⇒ 12 < 16   ← 浪费 4
超用（回退后）：两 suite ⇒ 24 > 16   ← 超 8，load 29.23
```
**超用代价 > 欠用**——suite 在 load 29 下跑墙钟拉长，ff 撞头概率上升（反噬 ff-livelock）。

**修法形状（manager 建议，⛔ 不设阈值只给形状）**：
```
(a) main lane 下界 max(nproc/slots, nproc − in_use) ⇒ 单 suite 拿满、两 suite 各 ≥8
    ⚠️ 不解决超用，只解决欠用 —— 排除它
(b) 认领制：suite 启动把自己的 lane 数写进共享账本，后来者读账本而非 in_use
    ⇒ 「将来会来的」变成「已经声明的」
    ⊢ 判据：任意时刻 Σ(已声明 lane) ≤ total_budget；现在这个不变式【不存在】
(c) 单飞锁承担：slots=2 的锁已存在，让它同时发 lane 配额
    ⇒ 拿到锁 = 拿到 nproc/持锁数 配额，不再各自推导
```
**manager 倾 (c)**：锁已经知道有几个 suite 在跑，公式不知道——把配额发给已掌握信息的机件，比各自猜少一层间接。

**判据1**：修法落地（(b) 认领制或 (c) 锁携带配额，选哪条实现者按「少间接」原则裁）——**Σ(已声明 lane) ≤ total_budget 不变式成立**。
**判据2（能取假·真样本不构造）**：**此刻两 suite（16+8=24 > 16）就是真样本**——回放它，任何修法必须使 Σ lane ≤ budget；现状超 8 必须红。
**判据3**：单 suite 场景仍拿满（不退化到 /S 白砍一半）——**欠用侧不回归**。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不简单加回 /slots（人已裁定回退且欠用理由成立）；不设数值阈值（成本结构未知）；不改 load 判据本身。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 resource-gate.sh 的 main lane 公式（:451 只 serial/lowconc 除 S）+ process-budget.sh（total_budget=nproc）+ 单飞锁（RESOURCE_GATE_CONCURRENT_SUITES）。
2. 判据1：修法落地（(b) 认领制或 (c) 锁携带配额）——Σ lane ≤ budget 不变式。
3. 判据2 能取假：两 suite 真样本（16+8>16）回放不超；现状红。
4. 判据3：单 suite 仍拿满（欠用不回归）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：修法落地——Σ(已声明 lane) ≤ total_budget 不变式成立。
- [ ] AC2 判据2 能取假：两 suite 真样本（16+8>16）回放不超；现状超 8 红。
- [ ] AC3 判据3：单 suite 仍拿满（欠用不回归）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] suite 预算不再超用（Σ lane ≤ budget 不变式）+ 两 suite 真样本回放不超 + 单 suite 不退化。

## Touches

- plugin/scripts/resource-gate.sh（main lane 预算公式：认领制或锁携带配额）
- plugin/scripts/process-budget.sh 或相关（共享账本 / 配额载体）
- plugin/scripts/claim-task.sh 或单飞锁（若 (c)：锁携带 lane 配额）
- plugin/test/（补测：两 suite 真样本 + 单 suite 不退化）
- tasks/gap-suite-budget-oversubscribe-lock-carried-quota.md（自身）

## Evidence

（落地后回填）
