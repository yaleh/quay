---
id: gap-archguard-structural-gate-in-fan-in-driver
title: archguard 依赖环结构闸接进 fan-in driver 机械步骤 + 退役 scripts/test.sh:966 旧接线（人
  2026-08-27 裁定「archguard 接 fan-in 非 suite test」）
status: done
labels:
  - gap
  - feature
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-fan-in-driver-mechanical-orchestration
---
**type:** execution

> **正本**：`orchestration/SPEC-fan-in-driver-mechanical-orchestration-2026-08-27.md` §2/§5/§6（commit ed1458609）。
> **人 2026-08-27 裁定（逐字）**：「archguard 应接在 fan-in 过程里（机械 driver 驱动的 fan-in），而不是 suite test。」

## Proposal

archguard 依赖环闸应接在 fan-in 过程（机械 driver 驱动的 fan-in），而不是 suite test。

**根因（manager 读码核实）**：`archguard-runner.ts` 目前只接在 `scripts/test.sh:966`（run_selected 内），而生产 fan-in 走 `--buckets` 非-hub 路径（`scripts/test.sh:1466-1511`）结构上绕过 `run_selected()`（`:1471-1473` 注释自证）⇒ 结构闸零生产调用。`gap-archguard-zero-production-calls` 修的「full-suite 默认路径」，没修到生产实际走的 bucket 路径。metrics-history.jsonl 自 08-25 开发验证期 2 条后、driver 落地以来无新记录即佐证。

## Plan

1. archguard 依赖环闸作为 fan-in driver 的机械步骤（typecheck 后、scoped门/suite 前；失败「依赖环 → Claude 会话」）。
2. 退役 `scripts/test.sh:966` 旧接线（archguard 不再由 test.sh 触发）。
3. archguard 闸测试写进 `plugin/test/fan-in-driver-mechanical-orchestration.test.mjs` + `plugin/test/worker-driver.test.mjs`，新建独立闸测试 `plugin/test/archguard-structural-gate-fan-in.test.mjs`（⛔ 按此命名，不另取名）。

⛔ **顺序（manager 2026-08-27 提醒）**：先接 archguard 进 fan-in driver（步骤 1），后退役 test.sh:966（步骤 2）——否则中间有 archguard 哪都不跑的窗口。AC2「生产能产出」天然覆盖此点，但实现顺序别反过来。

## Acceptance Criteria

- [x] AC1（能取假，单真相源）：`scripts/test.sh` 不再调用 `archguard-runner.ts`（旧接线 `:966` 退役）；（⛔ 仍调用 ⇒ 假——两个真相源）。
- [x] AC2（能取假，生产能产出）：driver 落地后，一次 post-landing fan-in 在 `metrics-history.jsonl` 产生新记录（结构闸真跑，非仅实现）；（⛔ 落地后无新记录 ⇒ 假——能产出≠已产出）。
  - 证据：`.archguard/metrics-history.jsonl` 第 3 条 `2026-08-29T05:29:06Z` `tool:"archguard-runner"` `verdict:"pass"` `commitSha:2d9826d9`（= `task/gap-full-suite-runner-test-poll-timeout-load-flake` worktree HEAD，`fan-in-workflow-lock-events.jsonl` 05:28:33Z acquire 同秒）——post-landing 机械 fan-in 第 5.5 步实跑 analyze 两 scope 并 `mirrorArchguardMetrics` 镜像回主检出。

## Definition of Done

archguard 结构闸接进 fan-in driver 机械步骤 + `scripts/test.sh:966` 旧接线退役；AC1-AC2 全勾；metrics-history.jsonl 在 post-landing fan-in 有生产记录。

## Touches

- plugin/scripts/worker-driver.ts（fan-in 状态机加 archguard 结构闸机械步骤）
- scripts/test.sh（退役 :966 旧接线）
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs（机械 fan-in 闸测试）
- plugin/test/worker-driver.test.mjs（worker-driver 闸测试）
- plugin/test/archguard-structural-gate-fan-in.test.mjs (new)（archguard 闸独立测试 + 单真相源负控制）
- tasks/gap-archguard-structural-gate-in-fan-in-driver.md（自身）