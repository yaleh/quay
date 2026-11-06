---
id: gap-goal-driver-filing-ledger
title: goal-driver 立案台账：spawn→filed/not-filed 的可核实生命周期
status: todo
labels:
  - gap
  - goal-driver
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-934
---
## Proposal

`runGapSpawnPass` 只记录 `gap_spawns[].exitCode`，并在注释里明写「不验证立没立案，下一轮 readTaskFacts 独立复核」（plugin/scripts/goal-driver.ts:3057）。下一轮复核能看出「该 AC 有没有带 goal_ac 的任务」，但看不出三种完全不同的成因：agent 根本没落盘、落了盘但没写 goal_ac、落了盘但被 quay-file-task 的去重挡下。三者在下一轮都表现为同一个 `gap`，于是驱动会再次 spawn。生产上 AC-109 一天内 5 次 spawn 混着这个成分（消费者侧读数，仅作证据）。

本任务新增 `.quay/goal-filing.jsonl`：spawn 前写 `spawned`（带 requestId / ac / goal / at / promptSha），下一轮读完 tasks 后写 `filed` 或 `not-filed` 终态。`not-filed` 是独立取值，不与 `filed` 同形；它不直接重派，交给后续节流任务按冷却处理。

同时修一处同源的读面成本：goal-driver 每轮对 `goal list` 读两次（pass 1 与 pass 2 的 evidence 刷新），每次都要从 206MB 的 `.quay/gate-events.jsonl` 派生 evidence，实测 14.4s；pass 1 不使用 evidence（唯一消费者 `ledgerTailVerdict` 在 pass 2）。pass 1 改走 `--no-evidence`（实测 1.4s），pass 2 保留 evidence 刷新。list 的 wall-clock 上限从写死的 120s 改为 `drivers.yml kinds.goal.list_timeout_ms` 派生，避免高负载/接管窗口把一次长读误记成 store 读失败。

## Plan

1. 在 goal-driver 增加 `.quay/goal-filing.jsonl` 的只追加读写（坏行跳过并计数）。
2. `runGapSpawnPass` 对每个 target 先写 `spawned` 行（requestId 稳定派生：goal+ac+round+序号），再 spawn；spawn 结果只作诊断，不当作立案结论。
3. 下一轮 `readTaskFacts` 之后，对仍 open 的 `spawned` 行核对：tasks 中存在 `goal_ac == ac` 且创建/更新时间晚于 spawned.at ⇒ `filed`；否则 `not-filed`，reason 区分 `no-task` / `no-goal-ac` / `deduped-by-skill`。
4. `not-filed` 立即写终态但不重派；轮 fact 增加 `filing` 读数，供节流任务消费。
5. pass 1 的 `goal list` 加 `--no-evidence`（`meta-driver.ts` 的 list argv 增加参数）；pass 2 保持现状。
6. `listGoalRecords` 的 timeoutMs 从 `drivers.yml kinds.goal.list_timeout_ms` 派生，缺省 180000；解析失败回落缺省并记原因。
7. 测试：filed / not-filed / 坏行 / 重放；list argv 含 --no-evidence；list timeout 可配置。
8. live 证据：一次真实 gap spawn 的 spawned→filed 链，落在 `.quay/goal-filing.jsonl`。

## AC

- [ ] `node --test plugin/test/goal-driver.test.mjs` 退出码 0，新增用例覆盖 filed / not-filed / 坏行 / 重放。
- [ ] `runGapSpawnPass` 在 spawn 前写 `spawned` 行；下一轮对每条 open 的 spawned 写 `filed` 或 `not-filed`，两者是不同取值。
- [ ] `not-filed` 的 reason 能区分 `no-task` / `no-goal-ac` / `deduped-by-skill`（枚举，不布尔）。
- [ ] pass 1 的 `goal list` argv 含 `--no-evidence`；pass 2 仍带 evidence；`grep` 可核。
- [ ] `listGoalRecords` 的 timeout 从 `drivers.yml kinds.goal.list_timeout_ms` 派生；缺省 180000，非法值回落并记原因。
- [ ] live 证据：`.quay/goal-filing.jsonl` 中至少一条真实 `spawned` 对应一条 `filed`，证据文档逐字记录该行与对应 task id。

## DoD

真实交付物是 goal-driver 的 filing 台账、pass 1 的无 evidence 读面、可配置的 list 超时，以及一份 live 证据。证据必须来自实现落地之后的真实 spawn（`.quay/goal-filing.jsonl` 的行 + 对应 `tasks/*.md` 的 goal_ac），不能只用 fixture；负控必须证明 `no-task` 与 `no-goal-ac` 不会被写成 `filed`。全量 `bash scripts/test.sh` 绿。

## ADR-007 dark axis

- 该轴仍暗,理由:本任务只增加 goal-driver 的立案台账与读面成本，不改变模块依赖图，未产生 L_D/L_G 数值读数。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/scripts/meta-driver.ts
- plugin/test/goal-driver.test.mjs
- docs/evidence/2026-11-06-goal-filing-ledger.md (new)
- tasks/gap-goal-driver-filing-ledger.md
