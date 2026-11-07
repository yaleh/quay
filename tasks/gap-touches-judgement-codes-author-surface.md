---
id: gap-touches-judgement-codes-author-surface
title: Touches 判据码进作者面：touches-overbroad 只活在
  task-schema-check、touches-multi-path-bullet 只在晋升被拒时出现；复用既有判据接到 --help grammar
  + ready-pool，不新增规则
status: todo
labels:
  - gap
  - touches-parser
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**来源**：DSI triage 的 B 切片（原子 `x3-1` overbroad glob + `sa5b-5` 一条目一路径），30 题负载集的 **Q2**（「Touches 写成 `src/*` 会怎样？」）目前无法从产物面回答。

**现状（已核）**：
- `touches-overbroad` 的 code 已存在：`plugin/scripts/task-schema.ts:634`（消息已解释「need >=2 concrete leading path segments before any wildcard, or an exact path」）。但 `checkTouches` 只被 `task-schema-check.ts:42` 与 `prepare-admission-check.ts:711` 调用——**不在 `quay task check`（provider ABI）面，也不在 `ready-pool-check`**。
- `touches-multi-path-bullet` 已存在：`plugin/scripts/touches-one-entry-one-path-check.ts:220`，且已在 `plugin/scripts/ready-pool-check.ts:4307` 作为拒绝原因暴露。
- A 落地的 Touches grammar 小节（`quay task create --help`）只列解析器码，**两个判据码都不在**。

**发生率（2026-11-07 实测，3179 个任务文件）**：
- `touches-overbroad`：**1 个** —— `tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md`。
- `touches-multi-path-bullet`：21 个命中，**全部在 shrink-only 基线** `docs/analysis/touches-one-entry-one-path-baseline.md`（`baseline-count: 23`）⇒ **有效新增 0**。

**结论**：本任务**不新增规则、不新增第二份实现**，只把已有判据接到作者可见面。⛔ 不改 provider ABI（`client.taskCheck` 是产品层，Touches 是方法论层规则；跨层会让其他 provider 无谓地背上它）。

⛔ 不以 |D| 下降 / 原子计数作为任何 AC 或 DoD 的证据。

## Plan

1. **复用判据**：`isOverbroadDeclaration`（`touches-orthogonality-check.ts:70`）与 `checkTaskOneEntryOnePath`（`touches-one-entry-one-path-check.ts:212`）。⛔ 不写第二份。
2. **help grammar**：在 A 已有的 Touches grammar 小节里增加**判据码**（`touches-overbroad`、`touches-multi-path-bullet`），从**单一注册表**渲染；若与 A 的 `TOUCHES_PROBLEM_CODES` 语义不同（解析器问题 vs 判据问题），新增独立纯数据表 `TOUCHES_JUDGEMENT_CODES`，⛔ 不混进 problem 表、⛔ 不在 help 手写第二份列表。
3. **ready-pool-check**：在既有 multi-path 检查（`:4303`）旁增加 overbroad 检查，输出稳定 code + detail；multi-path 继续尊重 shrink-only 基线。
4. **迁移那 1 个 overbroad 任务**：把它的 Touches 改成 ≥2 段具体路径（或精确路径）；⛔ 不得静默豁免；若确实无法改，写进显式祖父清单并说明理由。
5. **测试**：跨层（`spawnSync` 跑真实 `quay task create --help`，解析码，⛔ 不 import 表比表）；ready-pool fixture（`src/*` ⇒ 出 `touches-overbroad`；`packages/quay/**` 与精确路径 ⇒ 不出）；multi-path 负臂（散文分隔符不误报）。

## Acceptance Criteria

- [ ] AC1 help 面：真实 `quay task create --help` 的 stdout 里能解析出 `touches-overbroad` 与 `touches-multi-path-bullet`，且与注册表逐项相等；负控制：抹掉 stdout 中一条后抽取器只读到 N−1（能取假）。
- [ ] AC2 ready-pool 面：对 `src/*` 的 fixture 输出 `touches-overbroad`；对 `packages/quay/**` 与精确路径**不**输出；multi-path 基线仍压制既有的 21 条（给出压制计数）。
- [ ] AC3 迁移：那 1 个 overbroad 任务改好或显式祖父；给出「3179 个任务里 overbroad = 1 → 0」的逐字读数。
- [ ] AC4 无回归：`scripts/test.sh --for-task gap-touches-judgement-codes-author-surface` 绿；两个既有 checker 的测试仍绿。

## Definition of Done

- 四条 AC 勾选，每条附可复跑命令与逐字读数。
- **明确不动 provider ABI**（在 Evidence 写一句：为何选 help + ready-pool，而不是 `client.taskCheck`）。
- 判据码来自单一注册表；`grep` 证明没有第二份手写列表。
- ⛔ 完成证据中不得出现「|D| 下降」或原子计数。

## Evidence

（执行者填写：fixture、help stdout 抽取、ready-pool 输出、迁移前后计数、负臂读数。）

## Touches

- packages/quay/src/kernel/touches-annotation.ts
- packages/quay/src/cli/help.ts
- plugin/scripts/ready-pool-check.ts
- plugin/scripts/touches-orthogonality-check.ts
- plugin/scripts/touches-one-entry-one-path-check.ts
- plugin/test/touches-parser-help-surface.test.mjs
- tasks/gap-touches-judgement-codes-author-surface.md (new)
