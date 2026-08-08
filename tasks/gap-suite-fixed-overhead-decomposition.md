---
id: gap-suite-fixed-overhead-decomposition
title: 固定开销从未被拆解过：152s
  不属于任何一趟测试（build_dist_once/run_static_checks/resource-gate/三趟间隙）——直接测确定性串行段打点拆解，不用墙钟差（17–63s
  噪声带内不可判定）；顺手修 CLAUDE.md 103 行指向 done 任务要数据的误导
status: ready
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**固定开销从未被拆解过：全量套件墙钟里约 152s（703s 轮的估算）不属于任何一趟测试（build_dist_once / run_static_checks / resource-gate / 三趟之间串行间隙）。这是唯一没被碰过的成本面。立项：直接测确定性串行段，不测并发墙钟差。**

### 为什么不能用"改前改后墙钟相减"测（管理者 2026-08-08 撤半 + 纠正）

- `gap-suite-cost-model-is-wrong-optimizations-buy-nothing`（done, 2026-08-03）实测：118s 单文件节省只换 2s 墙钟；run-to-run 噪声极差 **17–63s**；结论「15s 预期改善埋在噪声里不可判定」；
- 管理者 2026-08-08 撤回「删 __PERFILE__=207.5s 文件墙钟只降 15.9s」——**15.9s 落在 17–63s 噪声带内，不可判定**（把不可判定差值当成了测量）；
- 三根杠杆估算（lowconc cc3→cc5 约 -78s、serial 最多 -78s）**全部基于单文件耗时求和，按上述模型不可信，一并撤回**；
- 本轮绿 718.2s 比 839.2s 快 121s，同样跨越噪声带边缘，**可判定性存疑，不能当"配对修复提速"证据**。

### 正确口径：直接测确定性串行段

build_dist_once、run_static_checks、resource-gate、三趟之间串行间隙——这些是**顺序执行、不受并发抖动影响**的段，各自打点得到可判定数值。先把 152s 拆成"每段多少"，再谈要不要优化——不先猜杠杆再去验。

### 目标

1. **打点确定性串行段**：在 test.sh / full-suite-runner 里对 build_dist_once、run_static_checks、resource-gate、三趟之间间隙各打点（开始/结束时间戳），输出每段耗时；
2. **拆解 152s**：跑一轮完整套件，输出固定开销构成（build_dist / static / gate / 间隙各多少秒）；
3. **不做优化决策**：只给"每段多少"的可判定数值，优化优先级留给数据出来后判断；
4. **文档修正**：CLAUDE.md 103 行"waits for gap-suite-cost-model-is-wrong-optimizations-buy-nothing's cost data"——该任务（done）实际产出是"这条路不可判定"，不是一组成本数字。**修正该行**，避免后来者以为数据在路上。

## Contract

measure overhead_breakdown = `grep -E "overhead_ms|build_dist|run_static|resource_gate|gap_ms" .quay/full-suite.log | tail -10` stdout 数字段（打点后每段耗时在场）
measure doc_fixed = `grep -c "不可判定\|cost data.*not coming\|waits for.*cost data" CLAUDE.md` stdout 数字段（CLAUDE.md 修正后不含"等成本数据"的误导表述）
band overhead_breakdown = 非空（打点输出在场）且 doc_fixed = 0（误导表述移除）
invoke `bash scripts/test.sh --for-task gap-suite-fixed-overhead-decomposition 2>&1 | tail -3`
control 跑一轮完整套件，固定开销拆解成"每段多少"（build_dist/static/gate/间隙）；CLAUDE.md 不再指向 done 任务要数据
resume 若中断，先跑 measure 读打点输出 + CLAUDE.md 现状

## Acceptance Criteria

- [ ] AC1: **确定性串行段打点**——build_dist_once / run_static_checks / resource-gate / 三趟之间间隙各打点，输出每段耗时
- [ ] AC2: **固定开销拆解**——一轮完整套件的 152s 拆成"每段多少"（可判定数值，非墙钟差）
- [ ] AC3: **不误用墙钟差**——不把并发墙钟差当测量（遵循 gap-suite-cost-model 的 17–63s 噪声模型）
- [ ] AC4: **CLAUDE.md 修正**——103 行不再指向 gap-suite-cost-model 要成本数据（该任务已 done，产出=不可判定）
- [ ] AC5: 与 gap-suite-cost-model-is-wrong-optimizations-buy-nothing（噪声模型）、
      gap-install-suite-cost-instrument-reporter-not-wired（reporter 仪器）交叉标注

## Definition of Done

- [ ] AC1-AC4 实跑输出贴任务体（打点输出、固定开销拆解、CLAUDE.md diff）
- [ ] 打点机制接入 test.sh 全量默认路径（每次全量跑自动输出固定开销构成）

## Touches
- scripts/test.sh 或 plugin/scripts/full-suite-runner.ts（确定性串行段打点）
- CLAUDE.md（103 行文档缺陷修正）
- tasks/gap-suite-cost-model-is-wrong-optimizations-buy-nothing.md（AC5 交叉标注）
- tasks/gap-install-suite-cost-instrument-reporter-not-wired.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-08T03:1xZ
changed: 管理者 2026-08-08 解锁耗时分解议题 + 纠正口径：不用墙钟差测（17–63s 噪声带内不可判定），
  直接测确定性串行段（build_dist/static/gate/间隙）打点拆 152s。CLAUDE.md 103 行文档缺陷顺手修
  （指向 done 任务要数据）。不先猜杠杆再去验。
