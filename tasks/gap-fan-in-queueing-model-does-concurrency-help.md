---
id: gap-fan-in-queueing-model-does-concurrency-help
title: 用排队论量 fan-in 锁竞争——加并发到底提吞吐还是只加长队列（corr(suite时长,落地数)=−0.11 指向排队）
status: todo
labels:
  - gap
  - analysis
  - methodology
parent: null
children: []
extra: {}
---
## Finding

`docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §1 实测：套件中位时长从
17.2 min 降到 3.1 min（5.5 倍），而 `corr(中位 suite 时长, 当日落地数) = −0.11`——
**「把测试跑快就能提高迭代速度」在这一个月的数据里不成立**。§5 显示单次 fan-in 端到端
（中位 9.7 min、p90 154.6 min、最大 693 min）远大于已记录步骤之和（约 2 min），
缺口构成尚未拆开：其中既有锁排队，也有**未被该载体记录的 suite 步骤**。

⇒ 瓶颈大概率在排队/串行化而非计算，但目前这是**推测**，没有量。现有载体足以量：

- `.quay/fan-in-lock-events.jsonl`（2,311 条）与 `.quay/fan-in-merge-lock-events.jsonl`（2,554 条）：锁获取/释放事件
- `.quay/fan-in-step-trace.jsonl`：端到端时间戳
- `.quay/worker-outcome.jsonl`：`in_flight_count`（并发度）、`wall_clock_ms`

## 要回答的那个问题

**增加并发 worker 数会提高落地吞吐，还是只会拉长队列？** 用等待时间分布 + 锁持有时间分布 +
Little's law（L = λW）判定系统当前处在哪个区间，给出一个可操作的结论（例如「当前并发 3，
锁利用率 X%，再加并发只增加排队时间不增加吞吐」）。

⚠️ **必须显式处理已知缺口**：suite 步骤不在 step-trace 载体里（见
`tasks/gap-fan-in-step-trace-suite-steps-write-end-without-begin.md`），不要把 suite 运行时间
误算成排队时间——这正是本文档 §5 收回的那个错误。若该缺口未修，本任务必须用**另一个载体**
（如 `verification-round.jsonl` 按 commit/runId 关联）补出 suite 时长，或明确标注
「排队与 suite 无法拆开，结论降级为上界」。

## Touches

- `plugin/scripts/fan-in-queueing-model.ts` (new)
- `plugin/test/fan-in-queueing-model.test.mjs` (new)
- `plugin/scripts/capability-catalog.sh`
- `docs/analysis/fan-in-queueing-model.md` (new)
- `tasks/gap-fan-in-queueing-model-does-concurrency-help.md`

## Acceptance Criteria

- [ ] 脚本对**真实**载体输出：等待时间分布（中位/p90/最大）、锁持有时间分布、
      锁利用率 ρ、到达率 λ、平均在系统数 L；六个量缺任一即未完成。
- [ ] 端到端时长的**三段拆分**：排队等待 / suite 运行 / 其余步骤，三者之和与实测端到端的
      残差 <15%；若因载体缺口拆不开，必须明确输出 `NOT-EVALUATED` 而不是给一个凑出来的数
      （硬规则 3b：读不懂不得与合格同形）。
- [ ] 给出并发度与吞吐的实测关系：用历史上并发度不同的时间窗（`in_flight_count` 分组）
      对比当日落地数，至少 3 个不同并发档位，报出每档的样本天数。
- [ ] 结论必须可取假：明确写出「若结论为假，会观察到什么」（例如「若吞吐受计算而非排队限制，
      则锁利用率应远低于 1 且等待时间应接近 0」），并报出该反向指标的实测值。
- [ ] `bash scripts/test.sh --for-task gap-fan-in-queueing-model-does-concurrency-help` 全绿，
      新测试在该轮被实际选中执行（按测试名核对）。

## Definition of Done

全部读数取自 `.quay/` **生产载体**，不接受 fixture 或注入数据（关掉注入 seam 后 AC 仍应成立）。
`docs/analysis/fan-in-queueing-model.md` 落地 develop，含可复跑锚点（命令行 + 日期 + develop tip SHA）。
结论若是「加并发没用」，要给出**替代瓶颈**的候选与各自证据强度；若是「加并发有用」，
要给出建议并发度与它的依据读数——不接受只报一堆分布而不回答那个问题。
