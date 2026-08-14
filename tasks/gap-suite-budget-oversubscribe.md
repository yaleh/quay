---
id: gap-suite-budget-oversubscribe
title: nproc−in_use 预算公式固有超用——两并发 suite 各拿满预算（16+8=24>16，load 29.23）；三条 lane 推导两条不读旋钮②
status: ready
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

**修正方向（人 14:4xZ 逐字纠正，覆盖 manager 原 (b)/(c)）**：
> 「**不。我们提到过应该用几个配置项，再结合本机的环境（如 nproc）计算。**」

**⇒ (b) 认领账本 / (c) 锁发配额【都错】**——各自引入新运行时状态（账本/锁持有数）；**人要的是【纯计算】：配置项 × 宿主环境 → 全部导出，零新增运行时状态。**

**框架已在代码里但没被贯彻（manager 核实，full-suite-runner.ts:1471）**——旋钮齐全（①`QUAY_MAX_TASK_SUBAGENTS` cap=5 ②`QUAY_MAX_CONCURRENT_SUITES` S=2 ③`QUAY_MAX_OVERSUBSCRIPTION`），**但三条 lane 推导只有一条真读旋钮②**：
```
serial_lowconc_host_default()   = floor(nproc / S) = 8        ✅ 读旋钮②
defaultLaneCount()  (runner)    = floor(nproc / AMP) = 16     ❌ 读 AMP，不读 S
default_concurrency_formula()   = nproc − in_use  = 7~16      ❌ 读运行时 in_use，不读 S
```
**14:39 的 16+8=24 > 16 成因就在这里**：两条 main 路径绕开旋钮② ⇒ 无任何东西保证「S 个 suite 加起来不超 nproc」。

**与人 06:33「AC68 /slots 回退」的关系（manager 读解非人原话，以人为准）**：AC68 公式=`(total_budget − in_use) / S`（既减又除双重保护）；**人回退的是复合形态里的 `/S`；回退后本应留 `nproc / S`，实现留的是 `nproc − in_use`** ⇒ 人反对「减完再除」不反对「用 S 计算」。

**修法形状（纯计算，零新增运行时状态）**：
```
main lane = max(1, floor(nproc × oversub / S))
            nproc  ← 宿主（os.availableParallelism()，⛔ 不写字面量）
            S      ← 旋钮② QUAY_MAX_CONCURRENT_SUITES（现 2）
            oversub← 旋钮③ QUAY_MAX_OVERSUBSCRIPTION（现 1，现状非建议值）
⇒ 本机 = 16 × 1 / 2 = 8；S 个 suite 合计 = 16 = nproc，【结构上不可能超】
```

**判据1**：main lane 公式改 `max(1, floor(nproc × oversub / S))`——**Σ(所有在跑 suite 的 lane) ≤ nproc × oversub 不变式成立**（结构上不可能超）。
**判据2（能取假·真样本不构造）**：**此刻两 suite（16+8=24 > 16）就是真样本**——回放它，修后 Σlane ≤ nproc×oversub；现状超 8 必须红。
**判据3（三条推导全读旋钮②）**：`grep -L QUAY_MAX_CONCURRENT_SUITES` 命中任一 lane 推导函数所在文件 ⇒ 未落地——serial_lowconc / defaultLaneCount / default_concurrency_formula **全部**读旋钮②（配合 concurrency-literal-check：它管「字面量只允许在定义点」，现在缺反向那半——「定义点存在但推导没去读它」）。
**判据4（manager 14:4xZ 重述）**：纯计算下**单 suite 只拿 `nproc/S = 8`，不会拿满 16**——这是纯计算方案的**已知代价**，不是缺陷。若人要「单 suite 拿满」，由旋钮③ `oversub` 表达（如 oversub=2 ⇒ 单 suite 16、两 suite 各 16 但合计超）——**⛔ 不能靠「运行时看几个在跑」动态放大（正是被否的形态）**；要不要用旋钮③ 换掉欠用是人的取舍。**落地时保持 `nproc/S` 结构、不引入动态放大。**
**判据5**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不简单加回 /slots（人已裁定回退且欠用理由成立）；不设数值阈值（成本结构未知）；不改 load 判据本身。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 resource-gate.sh 的 main lane 公式（:451 只 serial/lowconc 除 S）+ process-budget.sh（total_budget=nproc）+ 单飞锁（RESOURCE_GATE_CONCURRENT_SUITES）。
2. 判据1：修法落地（(b) 认领制或 (c) 锁携带配额）——Σ lane ≤ budget 不变式。
3. 判据2 能取假：两 suite 真样本（16+8>16）回放不超；现状红。
4. 判据3：单 suite 仍拿满（欠用不回归）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：main lane = max(1, floor(nproc × oversub / S))——Σ lane ≤ nproc × oversub 不变式。
- [ ] AC2 判据2 能取假：两 suite 真样本（16+8>16）回放不超；现状超 8 红。
- [ ] AC3 判据3：三条 lane 推导全部读旋钮②（grep -L 命中 ⇒ 未落地）。
- [ ] AC4 判据4：纯计算（nproc/S，单 suite 欠用是已知代价非缺陷）；不引入动态放大。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] suite 预算纯计算（nproc × oversub / S，零新增运行时状态）+ Σ lane ≤ nproc × oversub 不变式 + 三条推导全读旋钮② + 单 suite 欠用为已知代价。

## Touches

- plugin/scripts/resource-gate.sh（main lane 预算公式：认领制或锁携带配额）
- plugin/scripts/process-budget.sh 或相关（共享账本 / 配额载体）
- plugin/scripts/claim-task.sh 或单飞锁（若 (c)：锁携带 lane 配额）
- plugin/test/（补测：两 suite 真样本 + 单 suite 不退化）
- tasks/gap-suite-budget-oversubscribe.md（自身）

## Evidence

（落地后回填）
