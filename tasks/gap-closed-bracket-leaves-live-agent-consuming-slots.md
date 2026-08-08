---
id: gap-closed-bracket-leaves-live-agent-consuming-slots
title: "REVERSE-direction bracket-lifecycle defect: manager-layer (2h24m) and
  split-batch (1h21m) subagents have CLOSED telemetry brackets (not in
  inProgress) but their agent processes never exited — the known four forms are
  \"bracket should close but didn't\", this is \"bracket closed, agent still
  alive\"; slot accounting sees the slot free (bracket closed) while the process
  still burns CPU, so a new dispatch could land in a slot that's actually busy"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**已闭合任务的括号关了、agent 进程却没退出——与今晚已知的四种括号形态【反向】。**

### 实测（管理者 2026-08-07 02:46Z）

| 任务 | 括号状态 | agent 进程 |
|---|---|---|
| manager-layer（2h24m） | **已闭合**（不在 inProgress） | **没退出**（pane 仍显示「Execute manager-layer task」↑ 输出中） |
| split-batch（1h21m） | **已闭合**（不在 inProgress） | **没退出**（pane 仍显示「Execute split-batch task」↑ 输出中） |

telemetry 核实（外层复验）：`inProgress` 只有 observer-registry + session-liveness-saturation，
manager-layer/split-batch 均不在——**括号确实已关**；但 inner pane 里两个 subagent 标签仍在且 ↑
（在产出）。

### 与已知四形态的方向关系

今晚四种括号缺陷都是**「该关没关」**：chart2-s2 / ac8 / shipped-ts（needs-human 未闭合）、
residue-check（完成未翻 done）——括号滞留 inProgress，触发 OVER90。**本条是反向**：
**「关是关了，但 agent 进程还活着」**。两者独立：括号闭合与否，与 agent 是否退出无关。

### 为什么这是资源盲区

**槽位/就绪池记账读 telemetry `inProgress`**（括号）判「在飞」，但**真实资源占用是进程**。
括号关了 ⇒ 池子认为该槽空 ⇒ 可派新任务进一个**实际还忙着 CPU 的槽**。叠上
`gap-test-concurrency-cap-does-not-scope-nested-spawns`（无跨层总预算），机器负载被系统性地
**低估**——括号是记账面、进程才是真负载，两者脱节。

### 需要确认的机制问题（接法留执行时）

1. **agent 为什么没退出**：是 inner 主 agent 没 reap 子 subagent，还是 subagent 在括号关后还在做
   **括号外的活**（如收尾、报告生成、未计量的验证）？若是后者，这是「括号外工作」的正常形态，
   需让记账看到它；
2. **槽位释放判据**：`ready-pool-check` / `slot-refill` 的 in-flight 计数是否该加一个「进程级」
   判据（如该任务 worktree 是否有活进程），而不是只信括号；
3. **与跨层总预算的接法**：若总预算以进程数为权威，括号-进程脱节自然被覆盖（进程数不会因括号关
   而变）。

## Contract

```
measure stale_agents = `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['inProgress']))"` stdout 数字段（当前 inProgress 数；stale_agents = pane 活跃 subagent 数 − 该数，管理者实测差 2）
invariant 括号闭合 ≠ agent 退出；槽位记账必须区分「括号在飞」与「进程在飞」（两层不能只信括号）
invoke `node --no-warnings --experimental-strip-types plugin/scripts/fast-mode-telemetry.ts --report --json | python3 -c "import sys,json; d=json.load(sys.stdin); print([t['taskId'] for t in d['inProgress']])"`
control 人为让一个任务在括号关后保留活 subagent ⇒ 槽位记账必须能报出该进程仍占用（不能只信括号=槽空）
resume 若中断，先跑 measure 读当前 inProgress 与 pane 里的活 subagent，再对照已知四形态（该关没关）区分方向
```

## Acceptance Criteria

- [ ] AC1: **mechanism 确认**——查清 manager-layer/split-batch 两个 agent 为什么括号关后仍活着
      （未 reap / 括号外工作 / 其他），贴出证据
- [ ] AC2: **记账判据**——槽位/就绪池的「在飞」判据在括号外增加进程级维度
      （或证明跨层总预算覆盖后无需另加）
- [ ] AC3: **负控制**——构造「括号已关但 agent 进程活着」场景，记账必须报出该槽非真空闲
      （不能派新任务进一个实际忙的槽）
- [ ] AC4: 与 `gap-needs-human-routing-does-not-close-bracket`（该关没关，正向）交叉标注——
      同一族的两面
- [ ] AC5: 与 `gap-test-concurrency-cap-does-not-scope-nested-spawns`（跨层总预算）交叉标注——
      若总预算以进程为权威，本缺陷自然被覆盖

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体（含两个 agent 存活原因 + 记账判据前后对比）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 未来 N 次收尾中，不再出现「括号关、agent 还活着」的静默占用（或被机械检出）

## Touches
- plugin/scripts/ready-pool-check.ts（在飞判据加进程级维度，或引用跨层预算）
- plugin/scripts/slot-refill.ts（槽位释放判据）
- plugin/loop/fast-mode-loop-tick.md（记账语义：括号 vs 进程）
- tasks/gap-closed-bracket-leaves-live-agent-consuming-slots.md（自身文件）
- tasks/gap-needs-human-routing-does-not-close-bracket.md（交叉标注）
- tasks/gap-test-concurrency-cap-does-not-scope-nested-spawns.md（交叉标注）
- tasks/gap-inner-panel-shows-frozen-stale-agent-line-after-bracket-close.md（交叉标注——同族反向：
  本任务「括号关、agent 进程活」是进程方向；那任务「括号关、面板行冻结残留」是显示/观测方向。
  两方向都由 `plugin/scripts/inner-panel-stale-check.ts` 观测机制表达「括号关 ≠ agent 退出/结束」）

## Dispatch review

reviewer: none
at: 2026-08-07T02:5xZ
changed: 管理者 2026-08-07 发现（不代写任务体，请外层判断）→ 外层裁定立案：反向形态（括号关、
  agent 活）+ 资源记账盲区 + 与跨层总预算交叉，证据充分（telemetry 复验 + pane 标签）。
