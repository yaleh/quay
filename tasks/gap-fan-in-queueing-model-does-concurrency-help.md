---
id: gap-fan-in-queueing-model-does-concurrency-help
title: 用排队论量 fan-in 锁竞争——加并发到底提吞吐还是只加长队列（corr(suite时长,落地数)=−0.11 指向排队）
status: ready
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

- [x] 脚本对**真实**载体输出：等待时间分布（中位/p90/最大）、锁持有时间分布、
      锁利用率 ρ、到达率 λ、平均在系统数 L；六个量缺任一即未完成。
      **⇒ 已达成**：等待 中位 0.083s / p90 914.3s / max 4033.7s（n=1205）；持有 中位 396s /
      p90 757s / max 4243s（n=1205）；ρ=0.3814；λ=77.83/天；L=0.630（Little）与 0.626（时间平均）。
      载体缺任一 ⇒ 该量取 NOT-EVALUATED，⛔ 不与 0 同形（测试负控制钉住）。
- [x] 端到端时长的**三段拆分**：排队等待 / suite 运行 / 其余步骤，三者之和与实测端到端的
      残差 <15%；若因载体缺口拆不开，必须明确输出 `NOT-EVALUATED` 而不是给一个凑出来的数
      （硬规则 3b：读不懂不得与合格同形）。
      **⇒ 已达成**：残差 n=1202，中位 **0.026%**、p90 **0.77%**，超 15% 仅 **3 条**（0.25%）。
      三段（中位/聚合占比）：排队 0.083s / **39.6%**；suite 303.5s / **42.7%**；其余 123.3s / 17.7%。
      suite 未跑的 181 次尝试输出 NOT-EVALUATED（⛔ 不是 0）。负控制在测试里（时间戳与 wall_ms
      矛盾的日志必须报出 >15% 残差）。
- [x] 给出并发度与吞吐的实测关系：用历史上并发度不同的时间窗（`in_flight_count` 分组）
      对比当日落地数，至少 3 个不同并发档位，报出每档的样本天数。
      **⇒ 已达成**：4 档，样本天数 1 / 1 / 3 / 18（max in_flight = 2 / 3 / 4 / 5）；
      均落地数 31.0 / 16.0 / 18.7 / 35.5；观测 cap=5。⚠️ 混淆项已在文档与机件里显式标注：
      档位由资源闸自适应选出且与池饥饿相关 ⇒ 本表只报实测关系、不证因果。
- [x] 结论必须可取假：明确写出「若结论为假，会观察到什么」（例如「若吞吐受计算而非排队限制，
      则锁利用率应远低于 1 且等待时间应接近 0」），并报出该反向指标的实测值。
      **⇒ 已达成**：反向指标 ρ=**0.381**（远低于 1）✓、低 ρ 档等待中位 **0.044s**（≈0）✓
      ——**反向读法在聚合层成立**；但高 ρ 档（ρ≥0.9）等待中位 **779.7s** ✗，**反向读法在尾部失败**。
      两个读法都对（量的是均值 vs 中位、聚合 vs 分档），必须同时报出。
- [x] `bash scripts/test.sh --for-task gap-fan-in-queueing-model-does-concurrency-help` 全绿，
      新测试在该轮被实际选中执行（按测试名核对）。
      **⇒ 已达成**：`--allow-thin` 轮 EXIT=0；该轮输出里逐条可见本任务的 21 条测试名
      （AC1 六个必需量 / AC2 三段拆分 / AC3 分档 / AC4 knee …），tests 37 pass 37 fail 0。

## Definition of Done

全部读数取自 `.quay/` **生产载体**，不接受 fixture 或注入数据（关掉注入 seam 后 AC 仍应成立）。
`docs/analysis/fan-in-queueing-model.md` 落地 develop，含可复跑锚点（命令行 + 日期 + develop tip SHA）。
结论若是「加并发没用」，要给出**替代瓶颈**的候选与各自证据强度；若是「加并发有用」，
要给出建议并发度与它的依据读数——不接受只报一堆分布而不回答那个问题。

**⇒ 已满足**：读数全部来自 `.quay/fan-in-lock-events.jsonl`、`.quay/fan-in-*.log`（per-run 过程日志）、
`.quay/worker-outcome.jsonl` 与 `git log develop`，无 fixture、无注入 seam。锚点（命令行 + 日期
2026-09-14 + develop tip `a21d0433736a59faa837bb02c9ed6de5001ea67b` + 窗口）见文档 §7。
**结论回答了两个方向**：聚合吞吐**不**受锁限制（ρ=0.381，余量 2.6×，且 worker 槽位中位利用率
仅 0.47）⇒ **现在加并发不提吞吐**；但尾部延迟**已被排队支配**（knee 在 ρ≈0.75）。
替代瓶颈候选按证据强度列出：**强** = 返工（59% worker 执行不落地，1157 vs 703）、
`ready-pool-check` 晋升闸成本；**中** = 派发供给（任务停在 ready + 残留 worktree）；
**弱（观察项）** = 上游立案速率（无载体）。

> **本次的载体纠正（不影响本任务的 AC，但必须留痕）**：Finding 里引用的「suite 步骤不在载体里」
> 与姊妹文档 §7 第 5 条「排队无载体」**均不成立**。排队时延自 2026-08-30 起就写在 per-run 过程
> 日志 `.quay/fan-in-<task>-<runId>.log` 的 `acquire-fan-in-lock` 步（自带 `wall_ms`，n=1205）；
> suite 时长同样在本载体（`suite-end.wall_ms`）。两处都是**在错误的载体里查**才读成「不存在」
> （硬规则 5），故本任务**没有新增任何埋点**。
