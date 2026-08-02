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
| B3-2 `gap-test-suite-has-no-layer-grouping` | ✔ merge `56dd8267`；**三步处置完成**（不回退）：(1) runner-grouping 硬编码计数改运行时关系断言 `0e26e6a6`；(2) AC9 改写为有序目标 + 627s 过渡态记录 `3f0bd792`；(3) needs-human → done。揭示 3 既有 engine + 3 既有 governance 失败，记录为发现 |

## 进行中

| 任务 | 状态 |
|---|---|
| — | 无（stop-condition 已触发，等人工处置 B3-2） |

## 待执行

| 任务 | 状态 |
|---|---|
| 用户新建 `fa0500ad`/`0f0c8d10` 两个 test-suite-cost 任务 | todo（用户手工提交，非本批范围；AC9 有序目标的达成依赖它们） |
| 揭示的既有失败 | 3 engine（symlink-mirror ×2 + enforcement-with-design ×1）+ 3 governance（chart2-s2）—— 记录为发现，需另行建任务跟踪修复 |

## 本批最终状态

- 已合并且全量绿：B2-0..B3-1（5 个）
- **B3-2 合并 + 三步处置后 done**（机制完整，AC/DoD 全勾；全量 627s 为 AC9 过渡态）
- 计量已接线：`--task-start`/`--task-end`/`--report` 首次工作（B3-2 67.8m needs-human → done；aggregate 已提交）
- **两条 tick 常设规则已落地**（`bc57d318`）：fan-in 前必须 rebase master；测试不得硬编码全局计数（runner-grouping 已按此改造）

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
