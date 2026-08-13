---
id: gap-single-flight-lock-2-slot-concurrent-suites
title: 单飞锁 1→2 槽（人裁定：最多同时 2 组 suite）+ 相预算 = hostParallelism() ÷ 并发槽数（8=16÷2
  实例非字面量）+ 资源闸按 2 槽——两把锁文件 .0/.1 无新依赖
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**id 说明：`2-slot` 是立案时的取值（当时人裁 2 槽），真值以 `QUAY_MAX_CONCURRENT_SUITES` 为准（当前 2）——勿把 2 当设计常量。**

**人 2026-08-13 裁定：「我希望可以支持最多同时跑两组 suite 测试，即两个 inner task subagent 可以并行跑 suite 测试。我可以接受在这种情况下对 suite 测试各项的并发约束，例如前面说的把 main 项约束为 8。」**

**这不是测量绕锁，是把安全约束上界从 1 槽提到 2 槽（产品能力，非临时口子）。**

**关键：人的 `8` 是 `16 ÷ 2` 的实例，不是一个字面量。** AC44 刚落地（1e7bfbe6）：serial/lowconc/main 三相全 = hostParallelism() = 16。2 套件并发 = 32 lane 压 16 核。若把 main 写成 8，就是把 AC44 刚消灭的字面量原样请回（硬规则 4 推论二：换 32 核机器 8 又错）。**正确形态 = AC44 原则再走一步：`相预算 = hostParallelism() ÷ 并发套件槽数`**——1 套件⇒16、2 套件⇒各 8（人的 8 由此得出，非写进去）；32 核机器 2 并发⇒各 16，无需改码。AC44 教「读宿主不写字面量」；这步是「读宿主 ÷ 读并发度」，同一条纪律多一个除数。

**两个串行化者都要改，只改锁不够**：
```
① 单飞锁  .git/full-suite.lock   1 槽 → 2 槽（计数信号量）
② 资源闸  "gate says WAIT ⇒ exit 1"  ← 它不知道「2 个是允许的」
```
只把锁提到 2，第 2 个套件会改撞资源闸并 exit 1（不是等待）⇒ 表现仍是「并发跑不起来」，只是失败点换地方。**闸的预算也要按 2 槽算。**

**实现简化（outer 裁定）**：2 槽信号量不需要新依赖——**两把锁文件 `full-suite.lock.0` / `.1`，依次 `flock -n` 试，都占满则阻塞等待任一释放**。比真信号量简单，且**保留 flock 的进程崩溃自动释放语义**（重要：run2-a 曾等锁 600s 超时 abort，不想换成会泄漏的槽）。

**框架（人 2026-08-13 目标形态：人指定三个量，其它值全部计算出来）**：
```
人指定（宿主级，唯一定义点）
   QUAY_MAX_TASK_SUBAGENTS       inner 并发 task subagent 上限   （旋钮①，当前 5）
   QUAY_MAX_CONCURRENT_SUITES    并发 suite 数  S                 （旋钮②，当前 2）
   QUAY_MAX_OVERSUBSCRIPTION     最大超订系数  O                  （旋钮③，新增，默认 1.0）
读/测（不配置；AMPLIFICATION 保留为 test seam）
   H = os.availableParallelism()
   A = AMPLIFICATION（一个 lane 实际展开成几个进程——实现/宿主属性，应被测量）
派生
   每套件 lane 预算 = floor( H × O ÷ S ÷ A )      → H=16,O=1,S=2,A=1 ⇒ 8（8 不写字面量）
   单飞锁槽数       = S
   资源闸预算       = H × O（闸预算也乘 O，否则调高超订时闸先挡住）
   ready-pool cap   = QUAY_MAX_TASK_SUBAGENTS
   pool floor       = cap × floorMult（已有，不动）
```
**⚠️ 不撞车**：`AMPLIFICATION`（除数，实现属性，实测 2.1→1.0）与 `QUAY_MAX_OVERSUBSCRIPTION`（乘数，策略，人指定）**方向相反**——复用会语义倒置（调高超订表现为调小 AMPLIFICATION，下一个人必读错）；两者并存都进公式。

**默认 O=1.0 的理由（写进任务体）**：超订系数有用区间从未被测量；两个读数方向相反（4-vs-8 落噪声带不可判定；main conc 8→16 仅 −14.6% 墙钟却 +33.7% CPU）。拐点未知 ⇒ 默认 1.0（行为不变），做成可有依据调高的旋钮；不设 1.5（成本结构未知前不设数值——K=2/AC53/AC44 三次同族教训）。**旋钮价值 = 人想试 1.5 改配置即可，不需代码改、不需实验「证明 1.5 对」。**
配置面 = 既有 `$QUAY_GLOBAL_DIR`（~/.quay-global，per-host，非 `.quay/config.yml`——那是 per-workspace provider map）。2 槽不是「锁的参数」，是旋钮② 的一个取值。试点 AC3 并发要求写旋钮名（QUAY_MAX_CONCURRENT_SUITES）而非 2（人改配置时判据不失效）。

## Plan

1. `scripts/test.sh` 单飞锁 1→2 槽：两把锁文件（`.0`/`.1`）依次 `flock -n` 试、都占满阻塞等任一释放；保留崩溃自动释放。
2. `plugin/scripts/full-suite-runner.ts` 相预算 = `hostParallelism() ÷ 并发套件槽数`（serial/lowconc/main 三相；1 套件⇒16、2 套件⇒各 8）。
3. `plugin/scripts/resource-gate.sh`（或调用处）预算按 2 槽算——闸知道「2 个是允许的」。
4. `gap-spec-11-stage-2-per-task-full-suite-pilot` AC3 并发度 =2（人上界，已改）。
5. 测试：2 套件并发真跑起来（scope=worktree ×2 同时 running）；1 套件行为不变（16）。

## AC

- [ ] AC1: `QUAY_MAX_CONCURRENT_SUITES` 个（当前 2）套件并发跑（不串行化、第 2 个不 exit 1）
- [ ] AC2: 相预算 = `hostParallelism() ÷ QUAY_MAX_CONCURRENT_SUITES`（1⇒16、2⇒各 8；无字面量，AC44 合规；「并发槽数」= 旋钮②，唯一定义点）
- [ ] AC3: 资源闸按 `QUAY_MAX_CONCURRENT_SUITES` 槽算（第 2 个套件不被闸挡 exit 1）
- [ ] AC4: 1 套件行为不变（16，无回归）；flock 崩溃自动释放保留（无泄漏槽）
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 2 套件并发实测读数贴出（scope=worktree ×2 同时 running + 各相预算）
- [ ] 全量套件绿

## Touches

- scripts/test.sh（单飞锁 1→2 槽：.0/.1 两把锁文件）
- plugin/scripts/full-suite-runner.ts（相预算 ÷ 并发槽数）
- plugin/scripts/resource-gate.sh（预算按 2 槽）
- plugin/test/full-suite-runner.test.mjs（÷槽数 + 1/2 套件用例）
- tasks/gap-single-flight-lock-2-slot-concurrent-suites.md（自身）