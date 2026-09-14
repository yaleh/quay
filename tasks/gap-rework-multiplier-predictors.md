---
id: gap-rework-multiplier-predictors
title: 找返工的预测因子——什么样的任务注定被执行 5 次以上（中位 2 次、p90 5 次、最高 27 次）
status: ready
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
- `plugin/scripts/task-file-bypass-check.ts`
- `docs/analysis/rework-multiplier-predictors.md` (new)
- `tasks/gap-rework-multiplier-predictors.md`

## Acceptance Criteria

- [x] 脚本对真实数据输出每个任务的 `{taskId, 执行次数, touchesFileCount, hasGoalAc, shape,
      labels, bodyLen, dependsOnCount}`，覆盖 ≥600 个任务（真实 `tasks/` + 真实
      `.quay/worker-outcome.jsonl`，不是 fixture）。
- [x] 每个候选因子给出分组对比：按该因子分箱后各箱的返工中位与样本数；
      **样本数 <10 的箱必须标注「样本不足」且不参与结论**，不得照样给中位。
- [x] 至少报出一个**可取假**的结论及其反向指标：例如「Touches 文件数与返工次数正相关」
      需同时给出相关系数与「若为假应观察到什么」的对照读数。
- [x] 混杂因素显式处理：任务难度本身无法观测，必须在文档里说明哪些相关性可能是
      「难任务既 touches 多又返工多」的伪相关，以及做了什么（如按 shape 分层）来部分排除。
- [x] 产出一条可操作的立案期建议，且该建议附带它的适用边界与实测支撑读数；
      给不出就明确写「数据不支持任何立案期建议」，不得编一条。
- [x] `bash scripts/test.sh --for-task gap-rework-multiplier-predictors` 全绿，
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

## Evidence

读数全部取自**生产载体** `/home/yale/work/quay/.quay/worker-outcome.jsonl` + `/home/yale/work/quay/tasks/`，
⛔ 无 fixture、⛔ 不读任务体自述。产出文档：`docs/analysis/rework-multiplier-predictors.md`。
锚点：`node --experimental-strip-types plugin/scripts/rework-predictors.ts --root /home/yale/work/quay` ·
生成于 2026-09-14T11:5xZ · develop tip `514459f52c1cfc635b1fb3c601753bd660749cef`。

### AC1 — 8 个字段 + ≥600 覆盖（真实数据）

`buildDataset` 的 `table` 逐条给出 `{taskId, executions, touchesFileCount, hasGoalAc, shape, labels, bodyLen, dependsOnCount}`。
读数：**可分析 721 条**（`tasks/` 下 2148 个任务文件；outcome 流中出现 721 个任务 id；0 个引用不到任务文件）。
对拍 §3：中位 **2** / p90 **5** / 最高 **27**（`gap-retire-session-liveness`）——与源文档一致。
测试 `AC1: the real corpus yields ≥600 analysable tasks with the full field set` 在 scoped 轮内**实跑通过**
（读取 `mainCheckoutRoot` 定位主检出的生产载体；未走 skip 分支，日志 `skipped 0`）。

### AC2 — 样本不足的箱不给统计量

真实语料中确实存在不足箱，不再是「结构上不可能失败」的判据：
`dependsOnCount` 的 `2`（n=9）与 `3+`（n=8）、`shape` 的 `contract`（n=1）与 `unknown`（n=1）——
四箱在 §3 表里一律渲染为 `样本不足（n<10，不参与结论）` + 其余统计量列全是 `—`（`Bin.median === null`，不是照样给中位）。
反向断言：`AC2: on the real corpus, EVERY under-sampled bin has null statistics` 同时断言 `checked > 0`
（真有不足箱，判据非空转）**且**至少有一个充足箱（判据非恒真）。

### AC3 — 可取假的结论 + 反向指标

- 结论 A：`Touches` 条目数与 `executions` **正相关**，ρ = **0.2245**。
  - 反向指标 1（置换零分布，2000 次、seed 20260914）：|ρ| 的 p50 **0.0250** / p95 **0.0722** / p99 0.0995 / **max 0.1299**，经验 p **0.0005**。
    ⇒ 若该关联只是配对噪声，打乱后应能取到 0.22 量级——**实测取不到**（max 0.1299 < 0.2245）。
  - 反向指标 2（偏相关）：控制 `bodyLen` 后 ρ = **0.1945**（几乎不降）；反向控制 touches 后 `bodyLen` 的 ρ 从 0.1341 **塌到 0.0501**。
    ⇒ 若结论 A 为假，应观察到前者塌向 0——**未塌**。
- 结论 B（否定式，同样可取假）：`depends_on` 条数 ρ = 0.1052（p=0.0065，统计上为正）**但立案期不可用**——
  86.8% 的任务全落在同一个 `0` 箱，该箱中位/均值与全场几乎相同 ⇒ 没有区分力。反向读数：若可用，应能把任务分成返工水平不同的组。

### AC4 — 混杂因素

文档 §5 显式写明**难度不可观测**、「难任务既 touches 多又返工多」能产生同样的表，并给出做了的三件事：
①按 `shape` 分层（层内 ρ：plan 0.2557 / proposal 0.1616 / finding 0.0907——关联在各层内各自成立，不是权重堆出来的）；
②观测窗控制——**主控制用载体派生的「曝露时长」**（本任务第一条 outcome 记录距今天数），ρ(Touches, executions) = **0.2089**，
且窗内曝露时长与返工**已不相关**（ρ = −0.0495 ⇒ 该控制确实摁住了混杂因子）；
③副控制用 git 派生的文件年龄 = 0.2145（与主控制同号，独立复核）。
每一条都写明「能排除什么 / 不能排除什么」，并明确 `hasGoalAc` 因与曝露时长 ρ = −0.4282 而降为观察项、不作结论。

### AC5 — 立案期建议

建议：**`## Touches` 声明条目数 ≥15 时先按子系统拆分再立案**——该箱平均执行 **4.92** 次、中位 3、
**≥5 次占比 41.2%**（全场均值 2.71、≥5 次占比 14.7%，n=51）。
附带 4 条适用边界（适用面=已入池任务 / 观测窗 / 口径 / **中位并非载体，收益来自尾部** / 非因果）与实测支撑表（**只列充足箱**）。
反向读数：若建议为假，最高箱的 ≥5 次占比应落到全场水平（≈14.7%）——实测 41.2%（2.80×）。
两条「编不出就拒」的路径也有测试兜底：`buildRecommendation` 在尾部不动或不支持时返回 `数据不支持任何立案期建议`（两个测试分别覆盖）。

### AC6 — scoped 轮实跑

`bash scripts/test.sh --for-task gap-rework-multiplier-predictors --allow-thin` ⇒ **exit 0**；
选择集含 `+ plugin/test/rework-predictors.test.mjs`（按文件名核对），
该文件 25 个测试**按测试名**出现在本轮输出中（`DEAD VALUE …` / `AC1: the real corpus …` / `AC2: on the real corpus …` / `AC3+AC4: the real-corpus …` 等），
整轮 `tests 41 / pass 41 / fail 0 / skipped 0`。

### DoD — 死取值口径

`final_state` 全表（原样，未归并）：`exited-not-landed` 1147 · `completed` 694 · `failed` 109 · `killed` 1 · **`landed` 1（死取值）**。
脚本**不在任何地方内联比较状态字面量**：每条记录经 `classifyFinalState` 归入四个**可区分**取值
（`success` / `legacy-alias` / `non-landed` / `unrecognized`），无法识别的取值单列计数、既不并入成功也不并入失败。
两道守卫：行为断言 + **按位置判定**的源码断言（分类器函数体内不得出现 `"landed"` 字面量）。
负控制已实测：把分类器改回 `s === "landed" → success` 后，3 个测试同时报红（含两道死值守卫），改回即绿。
