---
id: gap-routine-semantic-dedup-scan-fail-helper
title: "semantic-dedup-scan: Identical fail(msg) except per-script log prefix;
  both emit {ok:false,error} in --json mode else stderr and return 2."
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Identical fail(msg) except per-script log prefix; both emit {ok:false,error} in --json mode else stderr and return 2.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793780123988` · ts `2026-11-04T08:15:23.988Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`fail`
- 涉及文件：
- `plugin/scripts/per-task-suite-record.ts:391`
- `plugin/scripts/pre-verified-round-record.ts:1002`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-04T08:15:23.988Z

## ADR-007 暗轴
该轴仍暗,理由:本次是 plugin/scripts 内 fail 帮助器去重（两份字节相同的私有副本收敛到 gate-script-base 已有的共享 home，未新增任何模块间依赖边——两个文件本就 import gate-script-base），未跑 archguard 的 L_D/L_G 读数。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `fail-helper`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793780123988`）所描述的问题被复核并处置 —— 复核结论：**属实**。develop `47e911ce8` 上按代码位置枚举 `const fail = (msg)` 闭包 = **2 处 / 2 文件**（finding 点名的 `per-task-suite-record.ts:391` 与 `pre-verified-round-record.ts:1002`）。处置 = **修掉（extract）**：两份私有副本删除，统一 import `gate-script-base.ts` 新增的单一 `makeCliFail(prefix, asJson)`（返回 exit 2 的 `fail` 闭包，仅前缀是每脚本差异）。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 结论 = **修掉**，可复跑读数：① `const fail = (msg)` 声明（按代码位置）develop = **2 处 / 2 文件** → 本分支 = **0 处**；② `export function makeCliFail(` 声明本分支 = **1 处**（仅 `gate-script-base.ts:788`），`const fail = makeCliFail(` 调用点本分支 = **2 处**（两文件各一）；③ 行为保持：两个 CLI 的 fail 路径实跑——human 模式 stderr 前缀 + exit 2、`--json` 模式 `{ok:false,error}` + exit 2。

## DoD
- [x] 上面的判据实跑通过 —— 上述读数均已实跑：两份副本删除后按位置 grep（0 处 `const fail = (msg)` / 仅 1 处 `makeCliFail` 定义、2 处调用），且两个 CLI 的 fail 路径 human/json 各实跑 exit=2、输出形状与前一致。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 修复由 worker 派发链执行（worktree `quay-worktrees/gap-routine-semantic-dedup-scan-fail-helper`，分支 `task/gap-routine-semantic-dedup-scan-fail-helper`，提交 `8f47a2ca8`）；例程探针只往 `.quay/routine-findings.jsonl` 写 finding 记录并机械立案，未执行任何修复。

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/per-task-suite-record.ts`
- `plugin/scripts/pre-verified-round-record.ts`
- `tasks/gap-routine-semantic-dedup-scan-fail-helper.md`