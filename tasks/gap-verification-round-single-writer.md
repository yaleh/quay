---
id: gap-verification-round-single-writer
title: verification-round 单一 writer——删除 writeRedSuiteRecord 平行红写，红绿统一由 runner 记录
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

verification-round.jsonl 在机械 fan-in 路径是**两个 writer 混写**（实证：红轮 692-707 带 runId=wk-prod-* + preverified=false = `suite-driver.ts:344` `writeRedSuiteRecord` → `pre-verified-round-record.ts --state red --run-id <driver> --preverified 0`；绿轮 708/709 不带 runId = `full-suite-runner.ts:3309` `appendVerificationRound`）。两 writer 各算 round=prior+1，并发有撞号隐患；且红绿记账不对称（红有专门可靠 writer，绿靠 best-effort append）。

统一：`appendVerificationRound` 是机械路径唯一 writer，红绿都记；删除 `writeRedSuiteRecord`。⚠️ 前提：先钉死「runner 的 append 在机械路径为何不落地」（best-effort try/catch 静默吞 / 桶路径提前 return / 落点差异），否则删了红会裸奔。

## Plan

1. 复现并钉死 runner append 不落地的根因（实证矛盾：机械路径红轮只有 writeRedSuiteRecord 记录、无 runner 记录；绿轮 708/709 落了、gap-b4 等没落——同一 state-dir=main、同一 appendVerificationRound，行为不一致）。
2. 修复后删除 `writeRedSuiteRecord`（suite-driver.ts 的 writeRedSuiteRecord + 其 pre-verified-round-record --state red 调用），红绿统一由 runner 记录。
3. 验证：红 suite 记录为 runner 形状（带 runId、无 preverified）；无双条记录。

## Acceptance Criteria

- [x] AC1（能取假，读生产载体）：一条红 suite 机械 fan-in 后 ledger 恰有一条该轮记录（runner 形状、无 preverified 字段），无 writeRedSuiteRecord 双写。（worker-driver.test.mjs AC1 机械缺省命令跑红桶 → 恰一条 record、无 preverified、state=red；生产载体 round 717 已见 runner 单写红：state=red、runId、无 preverified）
- [x] AC2（能取假，对称）：一条绿 suite 后恰有一条记录（与红同 writer、同 shape）。（full-suite-runner.test.mjs green contrast → 恰一条、无 preverified；与红同 runner appendVerificationRound、同 shape）
- [x] AC3（能取假，静态）：`writeRedSuiteRecord` 在 suite-driver.ts 中不再存在，且无残留调用点。（已删 suite-driver.ts 定义 + 内部 pre-verified-round-record --state red 调用；grep 全 plugin 树 0 残留；suite-driver.test.mjs AC3 静态断言）

## Definition of Done

verification-round.jsonl 对机械 fan-in 红绿统一由 runner 记录，ledger 无双 writer、红绿 shape 对称；一次红 suite 与一次绿 suite 各恰有一条记录（读生产载体）。

## Touches

- plugin/scripts/suite-driver.ts（删除 writeRedSuiteRecord）
- plugin/scripts/worker-driver.ts（suite 步不再依赖红平行写）
- plugin/scripts/full-suite-runner.ts（append 可靠化——见 Plan 1）
- plugin/test/suite-driver.test.mjs（删 writeRedSuiteRecord 后调整）
- plugin/test/worker-driver.test.mjs（红记录形状断言）
- plugin/test/full-suite-runner.test.mjs（append 落盘验证）
- tasks/gap-verification-round-single-writer.md（自身）