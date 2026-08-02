# B2 队列状态（跨 compact 恢复用）

**更新：** 2026-08-02，编排会话写入
**用途：** auto-compact / `/clear` 后重读此文件恢复队列，不要靠记忆

---

## 已完成

| 任务 | 状态 |
|---|---|
| B2-0 `DIR-124-F-plancheck` DoD | ✔ `14c99720` |
| B2-1 `gap-fast-mode-no-telemetry` | ✔ merge `a13d2628` |
| B2-2 `gap-test-selection-not-scoped-to-touches` | ✔ merge `462b8391`，全量 1206 tests 0 fail；AC12 实测 8.3s vs 全量 ~378s |
| B2-3 `gap-suite-speedup` | ✔ merge `42ea36b0`，实测 378s ≤ 480s |
| B3-1 `gap-gate-registration-vs-dispatch-unmeasured` | ✔ merge `02c30cde`，全量 1218 tests 0 fail（418s）；真实基线已入任务体（16 gate/6 未派发/24 未注册/line-budget mismatch） |

## 进行中

| 任务 | 状态 |
|---|---|
| — | 无（stop-condition 已触发，等人工处置 B3-2） |

## 待执行

| 任务 | 状态 |
|---|---|
| B3-2 `gap-test-suite-has-no-layer-grouping` | **needs-human**（merge `56dd8267` 已入 master，fan-in 全量红）。两个根因：(1) AC9 硬约束违反——实测 627s >> 416s 上限（引擎组 31 文件在默认组里运行，proposal-convergence ~63s + it0-dod-check ~60s 太重）；(2) runner-grouping.test.mjs 3 失败——EXPECTED_ENGINE=58 硬编码，但 B3-1 的 gate-dispatch-coverage.test.mjs 在 B3-2 worktree 创建后并入 master 且默认 engine，把真实计数推到 59。处置待人工：修 AC9（引擎组太重，需机制级改动）或回退 merge |
| 用户新建 `fa0500ad`/`0f0c8d10` 两个 test-suite-cost 任务 | todo（用户手工提交，非本批范围） |

## 本批最终状态

- 已合并且全量绿：B2-0..B3-1（5 个）
- **B3-2 合并但全量红 → needs-human**（67.8m，telemetry 首条）
- 计量已接线：`--task-start`/`--task-end`/`--report` 首次工作（aggregate 已提交 `b1e51244`）

## 正交性决策（已执行，2026-08-02 实测）

`checkTouchesPair` 实测结果（历史决策，不再重猜）：B2-2 vs B3-1 disjoint=true；B2-2 vs B3-2 重叠（`fast-mode-execution-prompt.md`、`scripts/test.sh`）；B3-1 vs B3-2 之间 disjoint=true。
因此 B3-1 与 B2-2 并发派发（10:08:36Z），B3-2 等 B2-2 合并后派发（10:29:46Z）。

## 两个新任务的要点

**`gap-gate-registration-vs-dispatch-unmeasured`**
- 15 个 gate 注册、6 个被 Gate 阶段派发，无人度量差额
- **报告而非判决**：阶段 1 未派发 ≠ 死代码，可能是阶段 2 的产品度量
- 恒定退出 0、零写入
- 附带查反向：`it0-dashboard-line-budget-check.sh` 实跑但注册的是 `it0-ceiling-line-budget-check.sh`——注册名与实跑脚本是两个不同文件

**`gap-test-suite-has-no-layer-grouping`**
- 44 个方法论测试（18,181 行）在 CI glob 之外，从不运行
- 三组：`product` / `engine` / `governance`
- **governance 是封存不是删除**——它度量产品交付进度，exp6 阶段 2 要用
- 跳过必须在重量级 import **之前**（AC8）
- 默认组墙钟 **≤416s**（AC9，硬约束不是期望）

## 判据来源

`docs/proposals/exp6-queue-driven-concurrent-executor.md` **§0 交付范围**（2026-08-02 新增）：
exp6 交付方法论引擎（阶段 1，现在）**和**用它交付 quay 产品（阶段 2，引擎稳定后）。
governance 组封存而非删除，直接来自这条。

## 执行纪律

不变，见 `docs/analysis/fast-mode-batch2-prompt.md`。要点：
后台 subagent + 自建 `/tmp/quay-wt-<slug>` worktree、嵌套对抗审查硬上限 2 轮、
串行 fan-in、AC 和 DoD 都要勾、单任务 90 分钟硬上限、完成后停下报告。
