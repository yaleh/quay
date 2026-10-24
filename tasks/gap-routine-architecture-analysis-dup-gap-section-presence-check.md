---
id: gap-routine-architecture-analysis-dup-gap-section-presence-check
title: "architecture-analysis: archguard dup 0bdbac73a819ef6f: 118 tokens/11
  lines; the two checks differ only in section name and code prefix, so a third
  section would be copied a third t"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard dup 0bdbac73a819ef6f: 118 tokens/11 lines; the two checks differ only in section name and code prefix, so a third section would be copied a third time.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792847950884` · ts `2026-10-24T13:19:10.884Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`checkGapFinding`、`checkGapRequestedAction`
- 涉及文件：
- `plugin/scripts/task-schema.ts:543`
- `plugin/scripts/task-schema.ts:555`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Parameterize one checkRequiredSection(task, section, codePrefix) and keep the two exports as thin wrappers; AC: one body, both codes/messages unchanged.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-24T13:19:10.884Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-gap-section-presence-check`（routine `architecture-analysis`，runId `architecture-analysis-1792847950884`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Resolution
- 已修掉：`plugin/scripts/task-schema.ts` 的两个逐字重复检查合并为单一 `checkRequiredSection(task, section, codePrefix)` 函数体（唯一残留差异 = 每个 section 的角色措辞，收在 `GAP_SECTION_HINTS` 里）；`checkGapFinding` / `checkGapRequestedAction` 保留为一行薄包装，调用点与导出面不变。commit `458851fa3`。
- 码/消息不变（可核）：对照按旧实现逐字重建的基线，跑 20 组输入（缺节 / 占位 / 39 字符 / 40 字符 / 完整 × 两个 section）比较 `{ok, code, message}` —— mismatches=0。
- 测试：`node --test experiments/quay-perpetual-stream/test/task-schema.test.mjs` 32/32 通过（含 `checkTask: kind=gap MISSING ## Finding/## Requested action -> FAIL with gap-specific codes`）；scoped 门 `scripts/test.sh --for-task gap-routine-architecture-analysis-dup-gap-section-presence-check --allow-thin` exit 0。

## Dark axis（ADR-007）
- 该轴仍暗,理由:本次改动是单文件内两处逐字重复函数的参数化合并,不改变包依赖结构(L_D)也不改变包规模分布(L_G),两轴均未被本次改动点亮

## Touches
- `plugin/scripts/task-schema.ts`
- `tasks/gap-routine-architecture-analysis-dup-gap-section-presence-check.md`

## Blocker

**2026-10-24T15:06:35.642Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: at least one bin is under-sampled (otherwise the rule is vacuous) [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：5d3190a4-14c4-4184-9776-f102e3b34a9c
