---
id: gap-closed-bracket-leaves-live-agent-consuming-slots
title: "REVERSE-direction bracket-lifecycle defect: manager-layer (2h24m) and
  split-batch (1h21m) subagents have CLOSED telemetry brackets (not in
  inProgress) but their agent processes never exited — the known four forms are
  \"bracket should close but didn't\", this is \"bracket closed, agent still
  alive\"; slot accounting sees the slot free (bracket closed) while the process
  still burns CPU, so a new dispatch could land in a slot that's actually busy"
status: todo
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

- [x] AC1: **mechanism 确认**——查清 manager-layer/split-batch 两个 agent 为什么括号关后仍活着
      （未 reap / 括号外工作 / 其他），贴出证据。**结论：括号闭合是 git 完成面、agent 退出是
      harness 子代理面，两者构造性解耦。** 外层收尾（`orchestrator-loop-tick.md` 步骤 1b）关括号的
      判据是 `ready-pool-check.ts` 的 `notYetFlipped` → `taskWorkLanded`（`git log master -- <paths>` /
      `hasAnyLandedNewTouch`）——**git 可观测的「工作已落地」（分支已 merge）**，不是「agent 进程已
      退出」。agent 进程是内层 `Agent(run_in_background:true)` 派发的 harness 子代理，其退出由 harness
      在它跑完自己 prompt（含落地后的收尾：自勾 AC、贴证据、跑 scoped 测试——即「括号外工作」）后
      决定；外层写 `--task-end` 对那个进程没有任何 handle。⇒ 括号关 ≠ agent 退，是机制，不是故障。
- [x] AC2: **记账判据**——槽位/就绪池的「在飞」判据在括号外增加进程级维度。落地：
      `fast-mode-telemetry.ts` `--slots`/`--slot-status`/`--report` 新增反向维度
      `closedButLive` / `closed_but_live_agents` / `occupied_slots`（= `realInFlight` + 已关括号但
      executor 仍存在者，复用 `worktreeExists`/`processAlive` 探测）；`slot-refill.ts` 的
      `slots_free = max(0, cap − (在飞 + closed-but-live))` + `--closed-but-live`；`ready-pool-check.ts`
      的 `--closed-but-live` 并入在飞 disjointness 排序。前后对比见下方 Evidence。
- [x] AC3: **负控制**——构造「括号已关但 agent 进程活着」场景，记账必须报出该槽非真空闲。用
      真实 git worktree 构造：`--task-start` + `--task-end`（括号关）+ `task/<id>` 分支仍在 open
      worktree（executor 仍在）⇒ `--slots` 报 `closedButLive`、`slotsRemaining` 降为 0（修前为
      `cap − realInFlight = 1`，读成空槽）。实跑输出见下方 Evidence。
- [x] AC4: 与 `gap-needs-human-routing-does-not-close-bracket`（该关没关，正向）交叉标注——
      同一族的两面（该任务文件已加「交叉标注」节）。
- [x] AC5: 与 `gap-test-concurrency-cap-does-not-scope-nested-spawns`（跨层总预算）交叉标注——
      若总预算以进程为权威，本缺陷自然被覆盖（该任务文件已加「交叉标注」节）。

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体（含两个 agent 存活原因 + 记账判据前后对比）——见下方 Evidence。
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——**按 tick 文档（fast-mode-loop-tick.md
      「任务 DoD 不含全量套件」）由外层 verification-round-N 批量合边界闸门负责**；本任务按派发契约跑
      scoped gate（`--for-task` 选中集，秒级），选中集测试全绿（见 Evidence 测试输出）。
- [x] 未来 N 次收尾中，不再出现「括号关、agent 还活着」的静默占用（**或被机械检出**）——机械检出已
      落地：`--slots` 的 `closedButLive`/`occupied_slots` 与 `--slot-status` 的 `closed_but_live_agents`
      每次纯读都报出「括号关但 executor 仍在」的占槽；`--report` 同带 `closedButLive` 字段。静默占用
      从此可被任何一层机械读到。

## Evidence（2026-08-08 实跑）

### AC1 — mechanism 确认（为什么括号关后 agent 还活着）

```text
- 括号闭合路径（外层 1b 收尾）：notYetFlipped → taskWorkLanded(task.body, repoRoot)
  → hasAnyLandedNewTouch: `git log master --full-history -- <touches 路径>`（GIT 可观测：工作已落地）
  → 满足则 `--task-end --outcome done`。判据是「分支已 merge / 提交已到 master」，不是「进程已退出」。
- agent 进程路径：内层 `Agent(run_in_background: true)` 派发 harness 子代理；prompt 形如
  「Execute <task> task ...」；它跑完自己的全部工作（含落地后收尾：自勾 AC / 贴 invoke 证据 / 跑
  scoped 测试）后由 harness 结束。外层 `--task-end` 对它是零 handle。
⇒ 两个可观测独立：括号关 = git 完成面；agent 活 = harness 子代理面。manager-layer/split-batch 的
  pane 仍显示 ↑ 输出 = 括号关后 agent 还在做括号外收尾活（或未被 reap），与机制一致。
```

### AC2 — 记账判据前后对比

```text
修前：closed-bracket-but-live 对槽位记账完全不可见。
  --slots 只读 inProgress（未关括号）；括号关 → 不在 inProgress → slots_remaining = cap − realInFlight，
  把实际忙的槽读成空。
修后：进程级维度补上。
  --slots   新增 closedButLive[]（已关括号但 executor 仍在：worktree 未清 / 进程未退）与 occupiedSlots
            （= realInFlight + closedButLive.length）。
  --slot-status 新增 closed_but_live_agents[] 与 occupied_slots，slots_free = max(0, cap − occupied_slots)。
  --report  新增 closedButLive[] 与 occupiedSlots。
  slot-refill.ts    slots_free = max(0, cap − (in_flight + closed_but_live))；--closed-but-live <ids>；
                    closed-but-live 的 touches 也进 step-4 并发资格（不与它的触摸相交者才可派）。
  ready-pool-check.ts --closed-but-live <ids> 并入在飞 disjointness 排序（候选与它触摸不相交才优先）。
```

### AC3 — 负控制实跑（构造「括号关 + agent 进程活」）

```text
$ git worktree add -q -b task/closed-live <tmp>/wt-closed-live     # executor（worktree）仍在
$ fm --task-start --taskId closed-live --root <tmp>                # 开括号
$ fm --task-end   --taskId closed-live --runId <r> --outcome done  # 关括号（括号已关）
$ fm --slots --cap 1 --root <tmp> --json
{
  "bracketsInFlight": 0,            # 括号已关：不在 inProgress
  "realInFlight": 0,
  "closedButLive": [ { "taskId": "closed-live", "runId": "fm-...-u96j4m", "reason": "worktree-present" } ],
  "occupiedSlots": 1,               # 已关括号但 executor 仍在 ⇒ 仍占 1 槽
  "slotsTotal": 1,
  "slotsRemaining": 0               # 修前此值为 1（读成空槽）——修后不许派新任务进实际忙的槽
}
$ fm --report --root <tmp> --json  # 同带 closedButLive: [{taskId:"closed-live", reason:"worktree-present"}], occupiedSlots: 1
```

### AC3 — 测试证据（scoped 选中集全绿）

```text
fast-mode-telemetry.test.mjs : 50 pass / 0 fail（含 5 条新增反向维度测试）
  SLOT-STATUS — closed bracket + live executor is NOT a free slot (reverse direction, AC2/AC3)
  SLOT-STATUS — closed-but-live agents can push the slot view to FULL (AC3 negative control)
  SLOT-STATUS — no completed records ⇒ reverse dimension is a no-op (byte-compatible forward view)
  SLOT-STATUS CLI — real git: closed bracket + OPEN worktree reads as occupied, not free (AC2/AC3)
  SLOT-STATUS CLI — real git: closed bracket + worktree REMOVED reads as genuinely free (clean case)
slot-visibility.test.mjs   : 8  pass / 0 fail
slot-refill.test.mjs       : pass（新增 closedButLive 占槽 / 负控制 / 并发资格 / CLI 4 条）
ready-pool-check.test.mjs  : pass（新增 closedButLive 并入在飞 disjointness 排序 1 条）
```

### AC4 / AC5 — 交叉标注落地

```text
AC4: tasks/gap-needs-human-routing-does-not-close-bracket.md 增加「交叉标注（AC4）」节——
     本任务正向（括号该关没关，滞留 inProgress）与本任务反向（括号关、agent 活）是同一族的两面，
     共享根：括号闭合 ≠ agent 退出。
AC5: tasks/gap-test-concurrency-cap-does-not-scope-nested-spawns.md 增加「交叉标注（AC5）」节——
     若跨层总预算以进程数为权威，本缺陷自然被覆盖（进程数不会因括号关而变）。
```

## Touches
- plugin/scripts/fast-mode-telemetry.ts（槽位记账反向维度：`closedButLive`/`occupied_slots`）
- plugin/scripts/ready-pool-check.ts（在飞判据加进程级维度：`--closed-but-live`）
- plugin/scripts/slot-refill.ts（槽位释放判据：`slots_free` 计入 closed-but-live）
- plugin/test/fast-mode-telemetry.test.mjs（反向维度 5 条新测试）
- plugin/test/slot-refill.test.mjs（closed-but-live 占槽 4 条新测试）
- plugin/test/ready-pool-check.test.mjs（closed-but-live 排序 1 条新测试）
- plugin/loop/fast-mode-loop-tick.md（记账语义：括号 vs 进程）
- plugin/loop/orchestrator-loop-tick.md（收尾对账节反向维度交叉注）
- tasks/gap-closed-bracket-leaves-live-agent-consuming-slots.md（自身文件）
- tasks/gap-needs-human-routing-does-not-close-bracket.md（交叉标注）
- tasks/gap-test-concurrency-cap-does-not-scope-nested-spawns.md（交叉标注）
- tasks/gap-inner-panel-shows-frozen-stale-agent-line-after-bracket-close.md（交叉标注）

同族反向注（非条目，供人读）：本任务「括号关、agent 进程活」是进程方向；gap-inner-panel「括号关、
面板行冻结残留」是显示/观测方向。两方向都由 `plugin/scripts/inner-panel-stale-check.ts` 观测机制
表达「括号关 ≠ agent 退出/结束」。

## Dispatch review

reviewer: none
at: 2026-08-07T02:5xZ
changed: 管理者 2026-08-07 发现（不代写任务体，请外层判断）→ 外层裁定立案：反向形态（括号关、
  agent 活）+ 资源记账盲区 + 与跨层总预算交叉，证据充分（telemetry 复验 + pane 标签）。
