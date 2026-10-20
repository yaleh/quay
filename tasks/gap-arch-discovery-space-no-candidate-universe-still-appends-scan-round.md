---
id: gap-arch-discovery-space-no-candidate-universe-still-appends-scan-round
title: arch-discovery 在 space 半边无候选宇宙时仍每轮 append scan-round（空转）
status: ready
labels:
  - gap
  - defect
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**空转（2026-10-20 核实）。** `plugin/scripts/arch-discovery-routine.ts` 里
`appendCarrierRecords(carrier, [...findingLines, round])` 在 space-state 判定之前执行，所以即使 space 半边
是 `no-candidate-universe`（缺 `loop.arch_discovery.space_registry` / 无 authorities），仍每个 interval 写
一条 `kind:"scan-round"` 载体记录。fact 已诚实报 `not-evaluated`（2026-10-14
`gap-arch-discovery-space-instrument-has-no-candidate-universe-on-non-quay-hosts`，done，修了「假绿」半边），
但轮次照写——非 quay 宿主上每 6h 一条近乎空的 space 读数（空转）。修法方向（三选一或组合）：preflight 缺
`space_registry` 时拒绝启动或不 append 该轮；time 半边 finding 单独落载体、不与 space 轮次捆在一起；从
archguard 的 sources/scope 自动派生 space_registry。

## AC

- [x] AC1（判定）：space 半边 `no-candidate-universe` 且 time 半边无 finding 时，改后不 append
      `scan-round`（载体字节不变）；负控制：改前同一夹具 append 一条 `scan-round`（证明谓词可判）。
- [x] AC2（time 半边不丢）：time 半边有 finding、space 半边 `no-candidate-universe` 时，time finding 仍
      如实落载体（不得因去空转而吞掉真 finding）。
- [x] AC3（回归）：`plugin/test/arch-discovery-routine.test.mjs` 绿（含既有 case(6) 与新增负控制），
      `scripts/test.sh --for-task <this task>` 绿。

## DoD

非 quay 宿主（无 space_registry）上，space 半边 no-candidate-universe 且无 time finding 的轮不再写
scan-round 载体记录；有 time finding 的轮照常落 finding。AC1-AC3 勾齐并贴证据。

## Evidence

- AC1：`plugin/test/arch-discovery-routine.test.mjs` case (11) AC1 —— 预置载体行后整轮跑完，
  载体字节完全相同、`rounds == 0`、last-run 仍推进（空轮消耗自己的窗口，不会变成每 tick 重跑）；
  `fact.value.appended === false`，读数仍在 Fact 里。负控制：同一夹具只把 space 半边换成 evaluated
  （candidates: 1），则恰好 append 1 条 scan-round —— 证明该夹具本身能产出轮次、上面的 0 条是谓词判的。
- AC2：case (11) AC2 —— space candidates:0 + time 两条 finding ⇒ 两条 finding 行与 1 条 scan-round
  一起落载体，`instrument` 均为 `time`。
- AC3：`node --experimental-strip-types --test plugin/test/arch-discovery-routine.test.mjs` ⇒ 23 pass / 0 fail
  （含既有 case (6)）；`bash scripts/test.sh --for-task gap-arch-discovery-space-no-candidate-universe-still-appends-scan-round --allow-thin`
  ⇒ exit 0（scoped 静态检查 + 本任务测试集全绿）。

## Touches

- plugin/scripts/arch-discovery-routine.ts
- plugin/test/arch-discovery-routine.test.mjs
- tasks/gap-arch-discovery-space-no-candidate-universe-still-appends-scan-round.md
