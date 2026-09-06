---
id: gap-goal-driver-mechanical-ring
title: 新增 goal driver kind——机械环跑 AC 判据写 evidence、I2 flip achieved、I3/I4 报出
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-store-abi-encapsulation-provider-backed
---
## Proposal

正本：`orchestration/SPEC-goal-mechanism-2026-09-06.md` §6 + `goals/AC-177-goal-driver-production-records.md`。

**立条依据（实测）**：G4 落地后 `goal-store.ts check --staleness` 把 `GOAL-001`/`GOAL-002`
**全部判进 `notEvaluated` 桶**——因为它们的 AC **一条 `evidence.at` 都没有**，
`lastProgressAt` 无从计算。**没有任何进程在跑这些判据。**

⇒ 这正是 GOAL-001 立条时诊断的病：`goal-store.ts` 2026-08-09 落地后 28 天零使用，
根因是**没有强制消费者**。前五期把 store 做对、迁入真实数据、断掉旧路、封了 ABI，
**但至今没有一个常驻进程在读它**。本任务就是那个消费者——
**它落地后 `notEvaluated` 应当变成 `fresh`，这是可观测的状态迁移，不是自述。**

**新增 kind 是数据表加一行**：`driver-runtime.ts:106-107` 明写「新增一个 kind = 这里加一行 +
写该 kind 的 .ts（继承 Layer 0 + 1a 或 1b），⛔ 不需要重写 respawn 循环/心跳/判停」。
现有 6 个 kind（meta/outer/promotion/quality/suite/worker），例程型（Layer 1b）先例是
`outer-driver.ts` 与 `quality-gate-driver.ts`；`meta` kind 是最近一次新增（`5516d291f`），可照抄其注册形态。

## Plan

**循环体（例程型 Layer 1b，每轮）**：
```
对每个 active GOAL：
  ① 对其每条 AC：跑 criterion → verdict → 写 evidence（落 GateEvent）
  ② I2 推导 → 全部 AC achieved 则 flip achieved
  ③ I3 判陈旧 → fresh | stale | notEvaluated
  ④ I4 查 status 与 I2 推导的分歧
→ 一条 Fact[] 写 .quay/goal-round.jsonl；reportFacts 上报
```
`Fact.state ∈ verified | not-evaluated | failed`（`driver-runtime.ts:762`）**正好承载 I3 三态**，
不要新增表达形态。

**⛔ 职责边界（人 2026-09-06 裁定划定，逐条不得越界）**：
1. `draft → active`（**激活**）：**人/manager 手动，driver 不碰**（裁定「暂不做自动晋升机制」）。
2. `active → retired`（**放弃**）：**人裁定**。与①对称——放弃是判断不是计算，driver **只报红不翻状态**。
3. `active → achieved`：**driver 可机械 flip**——人 2026-09-06 明裁「不算自动晋升，它是 I2 的确定性推导」。
4. **不直接改 task 状态**（撞 lifecycle/promotion-driver 的 `expectedStatus` CAS）。
5. **不机械写 `tasks/*.md`**（全仓四个 driver 零先例；缺口立案属 G7 的语义环，本期不做）。

**注册面**：
- `driver-runtime.ts` 的 `DriverKind` 联合类型 + `DRIVER_KINDS` 表加一条
- `plugin/scripts/drivers.yml`（`cap` / `interval_ms`）
- `plugin/scripts/driver-config.ts` 的接口 + `defaultDriverConfig()` + `loadDriverConfig` 返回体
- **`packages/quay/src/cli/driver.ts:31` 的 `KINDS` 白名单**
- `plugin/scripts/capability-catalog.sh` 的各表（新增 plugin/scripts 脚本必须登记）

**⚠️ 一个现成的坑，不要重蹈**：`cli/driver.ts:31` 现为
`["promotion","worker","outer","quality","meta"]`——**缺 `suite`**，而 kernel 的 `DRIVER_KINDS`
有 6 个。**本任务加 `goal` 时请一并把 `suite` 补回**，否则同一处漂移会从 1 处变成 2 处。

## Acceptance Criteria

- [x] `test -s .quay/goal-round.jsonl && test "$(grep -c '"verdict"' .quay/goal-round.jsonl)" -ge 3` 退出 0（AC-177 判据，立案时取假：载体不存在）
- [x] 状态迁移可观测：driver 跑过之后 `node packages/quay/src/goal-store.ts check --staleness` 中 `GOAL-001` **不再位于 `notEvaluated` 桶**（立案时它在该桶）
- [x] AC 记录被真实写回：至少 3 条 `goals/AC-*.md` 的 `evidence.at` 晚于本任务落地时刻（读生产载体，非 fixture）
- [x] 边界负控制：driver 跑一轮后，`draft` 状态的 `GOAL-003` **仍为 draft**（未被自动激活）
- [x] 边界负控制：driver 一轮内不产生任何 `tasks/*.md` 的写入（单测/日志断言）
- [x] `cli/driver.ts` 的 `KINDS` 与 kernel `DRIVER_KINDS` 一致（含补回 `suite`）——单测断言两者集合相等
- [x] `bash scripts/test.sh --for-task gap-goal-driver-mechanical-ring` 退出 0

## Definition of Done

**验收对象是【生产载体里有实现落地之后写入的真实 verdict】，不是【driver 能启动】。**
`.quay/goal-round.jsonl` 有 ≥3 条带 `verdict` 的轮次记录，且**只计实现落地之后的时间窗**。
**反例判据（硬规则 4 推论三）**：把 fixture / 注入 seam 关掉后本条仍能通过，它才是测量；否则只是回声。
配套的可观测迁移：`GOAL-001` 由 `notEvaluated` 迁出。
仅单测绿而 `.quay/goal-round.jsonl` 不存在或只含 fixture 记录 ⇒ 不算完成。

## Touches

- plugin/scripts/goal-driver.ts (new)
- plugin/scripts/driver-runtime.ts
- plugin/scripts/drivers.yml
- plugin/scripts/driver-config.ts
- plugin/scripts/meta-driver.ts
- plugin/scripts/capability-catalog.sh
- plugin/scripts/quay-init-closure-ratchet.ts
- packages/quay/src/cli/driver.ts
- plugin/test/goal-driver.test.mjs (new)
- plugin/test/driver-runtime.test.mjs
- .gitignore
- tasks/gap-goal-driver-mechanical-ring.md

## Needs-Human

**执行 2026-09-06T12:05:27.184Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=suite: AssertionError [ERR_ASSERTION]: heavy ratio (0.211) must exceed wait ratio (0.239) — else cpu_ms is duration-derived
- run_id：wk-prod-1788285192
- session_id：048f6a89-53bf-4305-8b67-9da4436c06c6
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-goal-driver-mechanical-ring~wk-prod-1788285192~1788695953840-0a297c.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-goal-driver-mechanical-ring-wk-prod-1788285192.log
