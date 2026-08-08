---
id: gap-suite-fixed-overhead-decomposition
title: 固定开销从未被拆解过：152s
  不属于任何一趟测试（build_dist_once/run_static_checks/resource-gate/三趟间隙）——直接测确定性串行段打点拆解，不用墙钟差（17–63s
  噪声带内不可判定）；顺手修 CLAUDE.md 103 行指向 done 任务要数据的误导
status: done
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**固定开销从未被拆解过：全量套件墙钟里约 152s（703s 轮的估算）不属于任何一趟测试（build_dist_once / run_static_checks / resource-gate / 三趟之间串行间隙）。这是唯一没被碰过的成本面。立项：直接测确定性串行段，不测并发墙钟差。**

### 正确口径（管理者 2026-08-08 二次更正后）

**为什么不能用"改前改后墙钟相减"测——但噪声口径已修正**：

- `gap-suite-cost-model-is-wrong-optimizations-buy-nothing`（done, 2026-08-03）AC3 实测：前 3 跑（含被污染的 run2）均值 487.8s、极差 63.4s、σ 32.8s(6.7%)；**剔除被污染的 run2 后（478.1/460.9/477.7）：极差 17.2s、σ 9.8s(2.1%)**；
- **修正**：17.2s 和 63.4s 不是一条噪声带的两端，是【两个不同样本各自的极差】。受控口径 = **σ≈9.8s(2.1%)**（gap-suite-sigma-distribution-stale-after-retirement 已明确：±10s 1σ 剔污染到 ±33s 含污染，非受控运行的离散是**上界非受控噪声**，不是噪声带）；
- **本轮绿 718.2s 比 839.2s 快 121s**：受控 σ≈9.8s 下 ≈ **12σ**，即便拿污染样本极差 63.4s 比也是 2×——**决定性显著**（不能用上界把真信号说成噪声）；
- **删除残留只快 15.9s（855.1→839.2）**：受控 σ≈9.8s 下 ≈ 1.6σ，是**弱证据**非"埋在噪声里"；真正理由 = 那两轮跑在 inner/outer 并发负载下（PSI 峰值 avg10=93），**属非受控条件，受控带不适用**；
- 三根杠杆估算（lowconc cc3→cc5 约 -78s、serial 最多 -78s）基于单文件耗时求和，按 cost-model 模型不可信，撤回。

### 测量前置条件（管理者补充，必守）

**测量必须在受控窗口进行**（资源门 GO + inner/outer 空闲），并**同一 commit 连跑 ≥3 次报极差与 σ**——否则得到的仍是非受控离散，重蹈"非受控运行当噪声带"覆辙。受控 σ≈9.8s 下，给 build_dist/static/gate 打点的段耗时**完全可判定**。

### 目标

1. **打点确定性串行段**：test.sh / full-suite-runner 对 build_dist_once、run_static_checks、resource-gate、三趟之间间隙各打点，输出每段耗时；
2. **拆解 152s**：受控窗口跑完整套件（≥3 次），输出固定开销构成（build_dist/static/gate/间隙各多少秒）+ 极差与 σ；
3. **不做优化决策**：只给"每段多少"的可判定数值，优化优先级留给数据出来后判断；
4. **文档修正**：CLAUDE.md 103 行"waits for gap-suite-cost-model-is-wrong-optimizations-buy-nothing's cost data"——该任务（done）实际产出是"这条路不可判定"，不是一组成本数字。

## Contract

measure overhead_breakdown = `grep -E "overhead_ms|build_dist|run_static|resource_gate|gap_ms" .quay/full-suite.log | tail -10` stdout 数字段（打点后每段耗时在场）
measure controlled_runs = `grep -cE "run [0-9]+.*[0-9]+\.[0-9]+s|range.*σ" .quay/full-suite.log` stdout 数字段（受控窗口 ≥3 跑 + 极差/σ 在场）
measure doc_fixed = `grep -c "不可判定\|cost data.*not coming\|waits for.*cost data" CLAUDE.md` stdout 数字段（CLAUDE.md 修正后不含误导表述）
band overhead_breakdown = 非空 且 controlled_runs ≥ 3 且 doc_fixed = 0
invoke `bash scripts/test.sh --for-task gap-suite-fixed-overhead-decomposition 2>&1 | tail -3`
control 受控窗口（资源门 GO + inner/outer 空闲）跑完整套件 ≥3 次，固定开销拆解成"每段多少"（build_dist/static/gate/间隙）+ 极差 σ；CLAUDE.md 不再指向 done 任务要数据
resume 若中断，先跑 measure 读打点输出 + 受控跑次数 + CLAUDE.md 现状

## Acceptance Criteria

- [x] AC1: **确定性串行段打点**——build_dist_once / run_static_checks / resource-gate / 三趟之间间隙各打点，输出每段耗时
      **证据**：develop 289d69ed + e33daf1d + 86676305。`_oh_mark`/`_oh_emit` 打点 build_dist /
      run_static_checks / resource_gate / lock / 三趟之间间隙（oh_t5b/oh_t6b 修正相位标记），全量默认路径
      输出 9 段 `__OVERHEAD__ <label>_ms=N`。86676305 修 uutils date 量纲 bug（`date +%s%3N` 返回 19 位
      epoch+全纳秒，实测本机 uutils 0.8.0 不截断）——改 `date +%s%N | cut -c1-13` 得真 epoch-ms，加
      ERR-UNSET 空值守卫。实测 3 跑各 9 段，数值为毫秒量级（非 ns 量纲）。
- [x] AC2: **固定开销拆解（受控）**——受控窗口完整套件 ≥3 次，152s 拆成"每段多少" + 极差与 σ
      **证据**（受控窗口 3 跑，commit b30d739e，`--lane-count 8`，runner state 各 red reason=failed
      ——审计独立性测试族红，非打点仪器问题；`__OVERHEAD__` 9 段全出）：
      - 固定开销构成（3 跑 mean/min/max/range/σ）：
        - lock_overhead: mean **0.03s**（range 0.00）
        - resource_gate: mean **0.84s**（range 0.21，σ 0.11）
        - build_dist: mean **1.05s**（range 0.40，σ 0.21）
        - run_static_checks: mean **20.02s**（range 1.88，σ 0.94）
        - gap_ms_main_to_serial: mean **3.18s**（range 0.99，σ 0.50）
        - gap_ms_serial_to_lowconc: mean **2.50s**（range 0.07，σ 0.04）
        - 固定开销合计 ≈ **27.6s**（3.6% 墙钟）
      - 三趟测试（对照，非固定开销）：main 310.0s（σ 19.2）/ serial 161.8s（σ 6.2）/ lowconc 254.6s（σ 6.3），
        合计 726.4s（96% 墙钟）
      - **结论：152s 固定开销估算不成立**——实际确定性串行固定开销仅 ~27.6s，最大段 run_static_checks
        20s；墙钟主要成本是三趟测试本身（并行度下不叠加到固定开销）。原始 152s 估算的组成已拆解为
        "每段多少"，优化优先级：run_static_checks 是唯一 >10s 的固定段。
- [x] AC3: **受控测量前置**——测量在资源门 GO + inner/outer 空闲的受控窗口进行；同一 commit 连跑 ≥3 次报极差与 σ（不把非受控离散当噪声带）
      **证据**：3 跑前资源门 GO（cpu-some avg10≈6.6）、load 2.3、无并发套件；3 跑同一 commit b30d739e
      （中途外层动 manager-tick docs，非测试对象）；各段报 range + σ（见 AC2）。受控 σ 下各固定段
      完全可判定（run_static_checks σ≈0.9s = 4.7%）。
- [x] AC4: **CLAUDE.md 修正**——103 行不再指向 gap-suite-cost-model 要成本数据（该任务已 done，产出=不可判定）
      **证据**：845ae4a7 改 CLAUDE.md 103-105 行——"gap-suite-cost-model-is-wrong-optimizations-buy-nothing
      is done and its measured output is that wall-clock diff is INDETERMINATE within the 17–63s noise
      band — it produced no usable cost numbers to wait on"。`doc_fixed` measure 实测 0 命中。
- [x] AC5: 与 gap-suite-cost-model-is-wrong-optimizations-buy-nothing（σ≈9.8s 受控口径）、
      gap-suite-sigma-distribution-stale-after-retirement（±10s 到 ±33s）、
      gap-install-suite-cost-instrument-reporter-not-wired（reporter 仪器）交叉标注
      **证据**：本任务 Proposal 正确口径引用 cost-model AC3 受控 σ≈9.8s(2.1%)；sigma-distribution
      （±10s 1σ 到 ±33s 含污染）为噪声口径来源；本任务打点输出经 measure-suite-reporter 的
      __PERFILE__ 通道（install-suite-cost-instrument）同文件流输出。

## Definition of Done

- [x] AC1-AC4 实跑输出贴任务体（打点输出、受控拆解 + 极差 σ、CLAUDE.md diff）——见各 AC 证据
- [x] 打点机制接入 test.sh 全量默认路径（每次全量跑自动输出固定开销构成）——289d69ed/e33daf1d/86676305 落地

## Touches
- scripts/test.sh 或 plugin/scripts/full-suite-runner.ts（确定性串行段打点）
- CLAUDE.md（103 行文档缺陷修正）
- tasks/gap-suite-cost-model-is-wrong-optimizations-buy-nothing.md（AC5 交叉标注）
- tasks/gap-suite-sigma-distribution-stale-after-retirement.md（AC5 交叉标注）
- tasks/gap-install-suite-cost-instrument-reporter-not-wired.md（AC5 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-08T03:2xZ
changed: 管理者二次更正噪声口径：17.2s/63.4s 是两个样本各自极差（非一条带两端）；受控 σ≈9.8s(2.1%)。
  修正两处：① 718.2s 快 121s = 12σ 决定性显著（不是噪声）② 15.9s = 1.6σ 弱证据（理由=非受控条件，
  非"埋在噪声里"）。补测量前置：受控窗口（资源门 GO + inner/outer 空闲）+ 同一 commit ≥3 跑报极差 σ。
