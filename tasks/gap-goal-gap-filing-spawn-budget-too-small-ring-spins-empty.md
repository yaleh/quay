---
id: gap-goal-gap-filing-spawn-budget-too-small-ring-spins-empty
title: G9 缺口立案环 spawn 预算 180s 不足 ⇒ 每轮烧满 spawn_cap 个 LLM agent、产出恒 0、taskCount
  永不脱离 0（空转，比不点火更贵）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`goal-driver.ts` 的 G9 缺口语义环（`gap-goal-driver-gap-semantic-filing-ring`，2026-09-07 11:32 落地）在生产上**点火但从不产出**：每轮对前 `spawn_cap` 条 gap AC 各 spawn 一个 gap-filing agent，全部撞 `GAP_WORKER_TIMEOUT_MS = 180_000` 被杀，`taskCount` 恒 0 ⇒ 下一轮再对**同一批 AC** 重来。环不是断开，是**空转**：持续烧 LLM 调用换零产出，且缺口集合结构上无法收敛。

**⊢ 这比"环没点火"更贵**：未点火时是零成本停摆；空转时每轮烧满 `spawn_cap` 次 LLM 调用，而 `gaps` 读数与"机制不存在"完全同形（硬规则 3b：一个恒不产出的环，其读数与"没有这个环"不可区分）。

### 实测（生产载体 `.quay/goal-round.jsonl`，run_id `gl-prod-1788781024`）

driver 于 2026-09-07T11:37:05Z 重启（此前进程 07:51 启动，早于 11:32 的实现落地 ⇒ 跑的是旧代码，属 `driver-code-fix-activation-requires-main-sync-restart` 类）。重启后第一轮：

```
round=1  ts=2026-09-07T11:47:34.799Z  spawned=3  llm_invoked=true  gaps=13
taskCounts: [0,0,0,0,0,0,0,0,0,0,0,0,0]
gap_spawns: GOAL-003/AC-156  exit=None  timedOut=true
            GOAL-003/AC-157  exit=None  timedOut=true
            GOAL-003/AC-158  exit=None  timedOut=true
```

在此之前，`gaps=13 / taskCount 全 0` 已连续 **9 小时以上、约 470 轮**（02:22 round=39 起至 11:35 round=191）纹丝不动。

### 区分性对照（硬规则 4 推论四：只改一个变量，结果翻转）

「180s 太短」若只是一个能解释现象的说法，不算结论。实做的对照：**同一 `buildGapWorkerArgv` 产出的 argv、同一 prompt、同一 cwd，仅把 `spawnGapWorker` 的 `timeoutMs` 由 `180_000` 换成 `900_000`**：

```
elapsed_s=602.9   exit=0   timedOut=false
⇒ 真的立成 tasks/gap-ac156-spec-12e-dead-set-lines-writeback.md
   （top-level goal_ac: AC-156；task_write 自动提交 ae0c3e57a；
     promotion-driver 已机械晋升 todo→ready 013f69546）
```

⇒ **假设「agent 结构性卡住（给多久都没用）」被证否**；真值是 gap-filing 角色的单次墙钟成本 ≈ 603s，是当前预算的 3.35 倍。

### 为什么共享阈值的前提失效了

`goal-driver.ts:76-78` 的注释明确写着「与 promotion-driver 的 `FIX_WORKER_TIMEOUT_MS` 同值（⛔ 不为 gap worker 另设阈值——硬规则 4 推论）」。**这个纪律在当时是对的**（成本结构未知前不设新数值阈值），但现在测量出现了，且两个角色在同一阈值下表现相反：

| 角色 | 阈值 | 历史读数 |
|---|---|---|
| promotion-driver fix-worker | 180s | 最近 400 轮 **266/266 零超时** |
| goal-driver gap-filing agent | 180s | **3/3 全超时**；放宽后单次 602.9s 成功 |

⇒ 同一个数字对一个角色 100% 够、对另一个 100% 不够 ⇒ 「同值」不再是节省，而是把一个角色钉死在不可能完成的预算上。两个角色的工作量本就不同：fix-worker 改已定位的代码；gap-filing 要读 AC 记录、按机制查重、撰四件套、过 ABI 落盘。

### 修法方向（不预设实现细节，但排除一种做法）

⛔ **不要把 `180_000` 换成另一个写死的数字**（硬规则 4 推论二：依赖当前宿主/当前 prompt 长度的字面量，换机换模型就静默失效）。**应接成配置项**，正本 = `plugin/scripts/drivers.yml` 的 `kinds.goal.*`，接法照抄同文件里已有的 `spawn_cap: 3`（`goalSpawnCap` 就地读该字段、缺失时 fail-open 回退）。现状是 `GAP_WORKER_TIMEOUT_MS` 为纯字面量，**无 CLI 缝、`drivers.yml` 无对应键**（已 grep 确认，全仓仅 `goal-driver.ts:78` 定义 + `:419` 作默认参数两处）。

### 附带的第二个缺口（同一函数、同一载体，故并案不另立）

`GapSpawnOutcome` 只保留 `{ac, goal, exitCode, stderr, timedOut}`，**丢弃 `stdout`**（`spawnGapWorker` 明明收了它）。⇒ 一个超时的 spawn **完全看不出它进行到哪一步**：是卡在启动、卡在查重、还是差最后一步落盘。本次诊断之所以要另起一次 900s 对照才有结论，正是因为超时记录的诊断面为零。若 `stdout` 尾部随 outcome 落盘，第一轮读数就足以定位。

### 当前生产状态（本任务的起点，实现者需知）

goal driver 已 **drain**：`.quay/goal-control.json` = `{halted: true, halted_by: "quay-driver-drain", halted_at: "2026-09-07T11:48:42.394Z"}`。按 `goal-driver.ts:601` 注释，halt **只挡 spawn、不挡机械读数**（缺口测量是观测性的、零 LLM），故 32 条 criterion 的每轮判定仍在写载体。**修复落地后需 `quay driver resume --kind goal` 才恢复立案环**；在预算修好之前恢复 = 恢复空转烧钱。

## AC

- [x] **超时值成为配置项，且能取假**：`plugin/scripts/drivers.yml` 的 `kinds.goal` 下存在 gap-filing spawn 超时字段，且 `goal-driver.ts` 现读该字段（照 `goalSpawnCap` 的接法：显式参数 → drivers.yml → 保守回退）。判据：把该字段改成一个显著不同的值后，一次 `spawnGapWorker` 的实际 `timeoutMs` 随之改变（单测断言解析结果，非断言字面量）。⛔ `grep -c 'GAP_WORKER_TIMEOUT_MS = 180_000' plugin/scripts/goal-driver.ts` 仍为 1 且无读配置路径 ⇒ 假；⛔ 仅把 180_000 改成另一个写死数字 ⇒ 假。
- [x] **新预算由实测导出，不是拍脑袋**：任务体或提交信息中写明所选缺省值的来源读数（本任务已提供一次真实测量 `elapsed_s=602.9`；实现者可补更多次），且缺省值 > 该读数。⛔ 只写一个数字而不给出它对应哪次测量 ⇒ 假（硬规则 4 推论：成本结构未知前不设数值阈值——此处结构已知，必须引用它）。
- [x] **超时 spawn 留下可归因的诊断**：`GapSpawnOutcome` 增加 stdout（截断保存，长度上限同样不写死或明确说明），且 `runGapSpawnPass` 把它写进轮记录的 `gap_spawns`。判据：构造一个必然超时的假 gap worker（测试缝 `gapWorkerCmd`），断言其 outcome 中 stdout 字段非 null 且含该假 worker 的输出。⛔ 字段存在但恒为 null ⇒ 假。
- [x] **单测覆盖预算读取与超时归因**：`plugin/test/goal-driver.test.mjs` 新增用例覆盖上述两点（配置读取的三级回退、超时 outcome 含 stdout），`node --test` 该文件退出码 0。⛔ 用例存在但断言的是常量本身而非解析路径 ⇒ 假。
- [ ] **生产载体验证（⛔ 不得由 fixture 满足，硬规则 4 推论三）**：修复落地并 `quay driver resume --kind goal` 后，`.quay/goal-round.jsonl` 中**实现落地时刻之后**的轮记录里，至少有一轮满足 `spawned ≥ 1` ∧ 该轮 `gap_spawns` 中 `timedOut=false` 的条数 ≥ 1。⛔ 关掉 `gapWorkerCmd` 测试缝后该判据仍能通过，才算测量。（待外部）
- [ ] **环收敛可见**：resume 后的某一轮，`gaps` 中至少一条 AC 的 `taskCount` 由 0 变为 ≥ 1（即 `readTaskFacts` 独立复核到新立的 `goal_ac:` 任务），且 `gaps` 长度较修复前的 13 严格下降。⛔ 仅 `spawned>0` 而 `taskCount` 全 0 ⇒ 空转未解决 ⇒ 假。（待外部）

## DoD

真实运行过的对象，不是产物齐备：goal driver 处于 **resume 状态**（`.quay/goal-control.json` 的 `halted` 为 false），且 `.quay/goal-round.jsonl` 上能读出**连续多轮**的收敛轨迹——`gaps` 长度单调不增、且至少一条 gap AC 完成了 `taskCount: 0 → ≥1` 的翻转，其对应的新任务在 `tasks/` 中带 top-level `goal_ac:` 字段并已被 promotion-driver 机械晋升。

⛔ 以下都不算完成：①单测绿而 driver 仍处 drain（等于机制没在生产跑过）；②`spawned>0` 但每轮 `gap_spawns` 仍全 `timedOut=true`（预算没真正修好）；③改了缺省数字但未接配置缝（下次换模型/换 prompt 长度会同样静默失效，本缺陷会原样复发）。

本任务的**负控制**已在立案时具备：`tasks/gap-ac156-spec-12e-dead-set-lines-writeback.md`（`goal_ac: AC-156`）证明了在预算充足时整条链路——agent 读 AC → 查重 → 撰四件套 → 过 ABI 落盘 → promotion-driver 晋升 ready——是通的。故本任务的范围**只是预算与诊断面**，不含链路本身。

## Touches

- `plugin/scripts/goal-driver.ts`
- `plugin/scripts/drivers.yml`
- `plugin/test/goal-driver.test.mjs`
- `tasks/gap-goal-gap-filing-spawn-budget-too-small-ring-spins-empty.md`
