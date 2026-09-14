---
id: gap-rework-multiplier-predictors
title: 找返工的预测因子——什么样的任务注定被执行 5 次以上（中位 2 次、p90 5 次、最高 27 次）
status: todo
needs_human_cause: human-adjudication
labels:
  - gap
  - analysis
  - methodology
parent: null
children: []
extra: {}
---
## Finding

`docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §3 实测
（`.quay/worker-outcome.jsonl`，703 个不同任务 / 1,896 次 worker 执行）：

| 一次落地 | 2 次 | 3 次 | 4 次 | 5 次 | ≥6 次 |
|---|---|---|---|---|---|
| 303 (43%) | 165 | 77 | 55 | 37 | 66 |

中位 **2 次**，p90 **5 次**，最高 **27 次**（`gap-retire-session-liveness`）。

**返工是当前最大的一块隐性成本**：若中位任务要跑两遍，等于近一半的 worker 墙钟花在重做上。
但没有人知道它由什么预测——立案时完全没有任何信号提示「这个任务会返工 5 次」。

## 要算的那个量

把每个任务的返工次数（`.quay/worker-outcome.jsonl` 按 `task` 计数）对**任务自身属性**做
分组对比 / 回归：`## Touches` 声明的文件数与宽度、有无 `goal_ac`、task shape
（contract / finding / plan）、labels、任务体长度、`depends_on` 数量、立案者。

产出：哪些属性与高返工显著相关，以及**一条可操作的立案期建议**
（例如「Touches 超过 N 个文件的任务返工中位是 M 次，建议拆分」）。

## Touches

- `plugin/scripts/rework-predictors.ts` (new)
- `plugin/test/rework-predictors.test.mjs` (new)
- `plugin/scripts/capability-catalog.sh`
- `docs/analysis/rework-multiplier-predictors.md` (new)
- `tasks/gap-rework-multiplier-predictors.md`

## Acceptance Criteria

- [ ] 脚本对真实数据输出每个任务的 `{taskId, 执行次数, touchesFileCount, hasGoalAc, shape,
      labels, bodyLen, dependsOnCount}`，覆盖 ≥600 个任务（真实 `tasks/` + 真实
      `.quay/worker-outcome.jsonl`，不是 fixture）。
- [ ] 每个候选因子给出分组对比：按该因子分箱后各箱的返工中位与样本数；
      **样本数 <10 的箱必须标注「样本不足」且不参与结论**，不得照样给中位。
- [ ] 至少报出一个**可取假**的结论及其反向指标：例如「Touches 文件数与返工次数正相关」
      需同时给出相关系数与「若为假应观察到什么」的对照读数。
- [ ] 混杂因素显式处理：任务难度本身无法观测，必须在文档里说明哪些相关性可能是
      「难任务既 touches 多又返工多」的伪相关，以及做了什么（如按 shape 分层）来部分排除。
- [ ] 产出一条可操作的立案期建议，且该建议附带它的适用边界与实测支撑读数；
      给不出就明确写「数据不支持任何立案期建议」，不得编一条。
- [ ] `bash scripts/test.sh --for-task gap-rework-multiplier-predictors` 全绿，
      新测试在该轮被实际选中执行（按测试名核对）。

## Definition of Done

读数取自**生产载体**，不接受 fixture（关掉注入 seam 后 AC 仍应成立）。
`docs/analysis/rework-multiplier-predictors.md` 落地 develop，含可复跑锚点
（命令行 + 日期 + develop tip SHA）。
⚠️ 注意 `worker-outcome.jsonl` 的已知取值陷阱：`final_state == "landed"` 是死取值
（见 `tasks/gap-worker-outcome-final-state-landed-is-a-dead-value.md`），
成功态实为 `completed`——用错字段会把返工次数算错，必须在脚本里显式处理并在文档里说明口径。

## Needs-Human

**执行 2026-09-14T05:17:35.275Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
- 成因类：human-adjudication

**已裁定并解除（2026-09-14，人裁定 + manager 复核）**：本条 needs-human 不是立案质量问题，而是闸连续三轮读到了**过期的任务体**。补 `(new)` 标注的修复提交 `c6ebc6c5b` 落在 2026-09-14T05:05:16Z，而其后的 round188/189 仍报 `touchesResolve=false`。历史重放（同一个 `checkTaskTouchesResolve`、同一个 root）证明：立案版 `c21a93310` = `mustExist:5 / missing:3 / majorityMissing:true` ⇒ 不能过闸；修复版 `c6ebc6c5b` = `mustExist:2 / missing:0 / majorityMissing:false` ⇒ **结构上就能过闸**。⇒ 那两轮读到的不是修复版。同一次 task_write 在 `.quay/store-commit-propagation.jsonl` 记为 `propagated:false`（`branchClass:"other"`）。机制侧已另立 `gap-ready-pool-body-still-read-from-stale-main-checkout` 承接。本任务翻回 `todo` 重新入池——`reconcileNeedsHumanWithDisk` 在盘上 status 离开 needs-human 时会**同时清零**该 id 的连续失败计数，给全新重试预算，⛔ 无需重启 driver。
