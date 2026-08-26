---
id: gap-ff-starvation-no-dynamic-cap-relief
title: 长窗口任务被 ff 竞速饿死——无动态 cap 纾解机制（实测 7 天 111 次 ff 失败，8 个任务 ≥4 次，最高 8 次）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

> **立案归属说明**：本条由 manager 依人 2026-08-26 直接指令「你调查，然后立案」撰写（`tasks/*.md` 常规归 outer 写面）。已通报 outer 以免重复立案。

## Proposal

**人 2026-08-26 逐字指出**：「这也是个直观的『总是合不进去的分支』的例子：该任务每次 merge develop + 跑 suite + ff-merge 时间较长，以至于在这时间窗口内总是能有别的任务完成 ff-merge，则会导致该任务 ff-merge 总是失败。我不想靠给 suite 测试 + ff-merge 来处理该问题。核心还是应该在加速 suite 测试；此外，也需要有个机制让上述『总是合不进去的分支』情况出现时（尤其是当该任务还阻塞后续许多任务时），可以动态调整 caps。」

### 发生率（硬规则⑫，查历史非等下一轮；直接量 = ff 失败留下的 revert 提交）

`git log --all --grep='ff 失败' --since='7 days ago'` 逐条解析 `revert <task> done→ready`：

```
ff 失败事件总数 111 次 / 7 天，涉及 63 个任务
每任务失败次数分布：
  1 次: 41 个   2 次: 11 个   3 次: 3 个
  4 次:  5 个   5 次:  1 个   6 次: 1 个   8 次: 1 个
≥4 次（明确饿死）: 8 个任务
  8x gap-suite-load-sampler-orphan-process
  6x gap-suite-serial-lowconc-classification-recheck
  5x gap-live-ghost-superseded-task-workflow-events-start
  4x gap-tmux-stale-not-honored-comment-private-socket-leak-scan
  4x gap-suite-leak-scan-ol-scd-g-teardown-slow
  4x gap-m-bucket-long-tail-lpt-scheduling
  4x gap-fan-in-materialize-check-false-positive-non-bootstrap
  4x gap-webui-modernist-css-missing-in-tgz
```

**⛔ 一个必须先排除的错误读法（我自己差点用它）**：`worker-outcome.jsonl` 的 `final_state=exited-not-landed` 有 132 条、33 个任务 ≥2 次——**但该载体的 `failure_reason` 只写「task status=ready (not done) and worktree still present」，那是【症状】不是【成因】，无法区分 ff 竞速 / 套件红 / worker 回合结束**（同 `gap-fan-in-red-bucket-run-not-recorded` 的同形问题）。⇒ 33 这个数**不能**当饿死发生率用；上面的 111/8 才是能取假的直接量。

### 机理（实测推翻了一个看似合理的模型——记下来防下游继承）

**⛔ 被证否的模型**：manager 最初推 `P(落地) = exp(−(N−1)·W/W_avg)`（竞争者数正比于 cap）。
**实测对照**（把 ff 失败/落地事件按时间戳 join `worker-round.jsonl` 的 `in_flight`）：

```
在飞数   落地   ff失败   P(落地)   模型预测 e^-(N-1)
   1     12      5      0.71        1.00
   2     43     12      0.78        0.37
   4     23      8      0.74        0.05
   5     92     45      0.67        0.02
⇒ P(落地) 与在飞数【几乎无关】，恒在 0.67–0.78 ⇒ 模型的定量预测被证否
```

**根因**：单例套件锁已经把 suite 阶段串行化了，竞速只发生在 merge+ff 那个短窗口，不是整个 W。

**⊢ 但饿死是真的，证据换成分布形状**：若每次尝试独立同分布（p≈0.70），失败次数应服从几何分布：

```
失败次数   实测任务数   几何分布预期   倍数
   1          41         13.2        3.1x
   4           5          0.36      14.0x
   6           1          0.03      31.1x
   8           1          0.00     345.6x
≥4 次: 实测 8 个，几何分布只预期 0.51 个 ⇒ 16x
```
**⇒ 尾部远重于几何分布 ⇒ p 不是全局常数而是【每任务固有】属性 ⇒ 饿死任务的 p 系统性偏低
⇒ 原地重试对它们无效。这才是干预的正当理由（不是"运气差，多试几次"）。**

**⊢ 低 p 的相关属性（实测）**：饿死组（≥4 次，n=8）轮次时长中位数 **16.3 分钟**，
正常组（=1 次，n=37）**7.8 分钟** ⇒ **2.08x**。与人的判断一致：窗口长 ⇒ 被撞概率高。

### 「立即 cap=1 还是渐进」——由条件失败概率直接给出，非拍脑袋

```
已失败k次  N(≥k)  N(≥k+1)  P(再失败|已失败k次)   判读
    1        63      22         0.35          重试有效，不该干预
    2        22      11         0.50          临界
    3        11       8         0.73          重试劣于抛硬币 ⇒ 必须干预
    4         8       3         0.38          （样本 8，波动大）
```
**⇒ 条件失败概率从 k=1 的 0.35 升到 k=3 的 0.73** —— 这正是异质总体的signature，
且给出一个**数据推导而非发明**的阈值：**k=1 不干预（重试确实有效），k≥3 必须干预**。
⇒ **答案是渐进，不是立即**：k=1 立刻降 cap 会白白牺牲吞吐（65% 的任务下一次就落地了）。

## Plan

1. **扩展既有机制，不新建**：`plugin/scripts/slot-refill.ts:196` 的 `computeArbitratedCap({baseCap, redWindowActive, redBacklogCap})` 已是「满足条件即收窄 cap」的纯函数，且其文档已钉死正确原则「**降 cap ≠ 停派**」（收窄成节流而非停止，否则死锁）。饿死纾解应作为**该函数的第二个触发条件**加入，⛔ 不另起一套。
2. **触发条件**（人 2026-08-26 给的方向）：**当前 live 任务发生 ff 失败且导致必须重跑 suite/bucket 测试**。计数载体需能按任务累计当轮 ff 失败次数。
3. **分级策略**（上表推导，实现时以实跑数据复核）：`k=1` 不干预；`k=2` 收窄；`k≥3` 降到 1（无竞争者 ⇒ 确定性落地）。任务落地后 cap 自动恢复 baseCap。
4. **阻塞权重**：`ready-pool-check.ts:1055` 已有 `dependedOnCount`（多少任务 `depends_on` 它），`:1046` 已有 `blocking_suite` + `SUITE_BLOCKING_WEIGHT=2` 的加权先例 ⇒ 「阻塞下游多的优先纾解」接现成信号，⛔ 不新增数据源。
5. **⊢ 与加速 suite 的分工（人已定核心方向）**：本条是**纾解**不是**根治**。根治是缩短 W（`gap-suite-pure-execution-900s-optimization` 那条）。两者不互相替代：W 缩短会让饿死变罕见，但不为零；本机制保证罕见发生时不无限拖延。

## Acceptance Criteria

- [ ] AC1（能取假，触发条件生效）：某任务当轮 ff 失败次数达阈值时，`computeArbitratedCap` 返回收窄后的 cap（非 baseCap）；对照：未达阈值时返回 baseCap 原值；（⛔ 两种输入返回同值 ⇒ 假）。
- [ ] AC2（能取假，分级非一刀切）：`k=1` 不收窄、`k≥3` 收窄到 1，三档取值可区分并有实跑数据复核记录（⛔ 直接 k=1 就降到 1、或只有一档 ⇒ 假；⛔ 阈值未经实跑复核即钉死 ⇒ 假）。
- [ ] AC3（能取假，确实解除饿死）：一个已连续 ff 失败 ≥3 次的任务，在机制生效后于下一次尝试落地；负控制：同期未触发阈值的任务 cap 不受影响、照常并发（⛔ 只证明降了 cap 未证明落地 ⇒ 假；⛔ 把所有任务都降到 1 ⇒ 假）。
- [ ] AC4（能取假，节流非停派）：收窄期间 `slot-refill` 仍推荐到收窄后的 cap（不为 0、不停派）——同既有 red-window 节流的「降 cap ≠ 停派」原则；（⛔ 收窄导致零派发/死锁 ⇒ 假）。
- [ ] AC5（能取假，成因可区分）：ff 竞速导致的未落地在载体上与「套件红」「worker 回合结束」可区分（当前 `failure_reason` 三者同形，见 Proposal）；（⛔ 仍只写 status=ready 同形串 ⇒ 假）。

## Definition of Done

饿死纾解作为 `computeArbitratedCap` 的第二触发条件落地；分级阈值经实跑数据复核而非发明；AC1-AC5 全勾；一个真实饿死任务被该机制解除并有实测记录；负控制证明未触发阈值的任务并发不受影响。

## Touches

- plugin/scripts/slot-refill.ts
- plugin/test/slot-refill.test.mjs
- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check.test.mjs
- tasks/gap-ff-starvation-no-dynamic-cap-relief.md
