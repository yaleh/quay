---
id: gap-routine-architecture-analysis-dup-strict-jsonl-reader-two-copies
title: "architecture-analysis: archguard dup 97719ef99c4433c0: 251 tokens/19
  lines; both bodies are the same strict JSONL-object reader (missing flag,
  throw on non-object) differing only i"
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard dup 97719ef99c4433c0: 251 tokens/19 lines; both bodies are the same strict JSONL-object reader (missing flag, throw on non-object) differing only in the path variable.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792847950884` · ts `2026-10-24T13:19:10.884Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readCarrierRounds`、`readLedgerRecords`
- 涉及文件：
- `plugin/scripts/discovery-method-routine.ts:509`
- `plugin/scripts/discovery-method-routine.ts:627`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract one readJsonlStrict(path) helper and make both readers delegate; AC: one definition, both call sites, non-object line still throws.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-24T13:19:10.884Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-strict-jsonl-reader-two-copies`（routine `architecture-analysis`，runId `architecture-analysis-1792847950884`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
- 复核：`plugin/scripts/discovery-method-routine.ts` 中 `readCarrierRounds`（原 `:509`）与 `readLedgerRecords`（原 `:627`）函数体逐行等价，仅路径变量与错误前缀不同 —— 即 archguard dup `97719ef99c4433c0`。
- 处置（修掉，非「已注意到」）：抽出唯一 `readJsonlStrict(filePath)`（`:510`），两处改为 `return readJsonlStrict(...)` 委托（`:534` / `:636`）。语义保持：缺文件 ⇒ `{missing:true,records:[]}`；非法 JSON ⇒ 抛 `is not valid JSON`；非对象行 ⇒ 抛 `is not a JSON object`（硬规则 3b：缺值 ≠ 未查）。
- 硬规则 5b 同载体检索：`grep -c "is not a JSON object" plugin/scripts/discovery-method-routine.ts` ⇒ 2 行（`:508` 文档注释 + `:524` 唯一 throw；提取前是 2 条 throw）。`plugin/scripts/arch-discovery-routine.ts:361/400` 属另一条例程的独立实现，不在本 finding、也不在本任务 Touches 内，未改动。
- 提交：`246f88557`（task branch `task/gap-routine-architecture-analysis-dup-strict-jsonl-reader-two-copies`）。
- 测试：`bash scripts/test.sh plugin/test/discovery-method-routine.test.mjs` ⇒ exit 0，60/60 pass；新增用例 `both JSONL readers — ONE strict reader, both call sites, a non-object line still THROWS` 对两条读函数分别断言 missing / 正常对象行 / `[]`、`42`、`null`、字符串行抛 `/is not a JSON object/` / 破行抛 `/is not valid JSON/`。
- 上一轮 suite 红（`added=experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs`）已复核为 **live-state flake，非本任务 delta**：
  - 复现尝试：在本 worktree 单独跑 `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/symlink-mirror-invocation.test.mjs` ⇒ 48/48 pass（含 `[task-status-drift-check.ts] symlink-path and real-path invocations produce identical stdout/stderr/exit code` 这一条）。
  - 机制：日志里唯一差异行是 `gap-b15-telemetry-snapshot-untracked (… Touches file(s) not in tree)`。该任务的 Touches 含裸目录条目 `milestones/fast-mode-telemetry/`，`task-status-drift-check.ts` 的 `touchesAllExist` 用 `fs.existsSync` 判它；git 不跟踪空目录，该目录只在运行时 telemetry 产物存在时才在盘上（实测：worktree 里该目录存在但为空，`git check-ignore` 不命中）。全量 suite 并行跑时，两次相隔数秒的调用之间该目录出现/消失即产生差异 —— 与 symlink/real 调用路径无关（该测试的 `redactLiveBranchState` 只豁免 STRANDED 块，不覆盖此行）。
  - 与本任务的关系：本任务 delta 仅 2 个文件（`plugin/scripts/discovery-method-routine.ts`、`plugin/test/discovery-method-routine.test.mjs`），与该测试无交集；`anti-drift-touches-check` 亦判定 2/2 文件全部在 Touches 内。⛔ 该测试不在本任务 ## Touches 内，未改动。
- 本轮落地前置：`git merge develop` 无冲突；scoped 门 `scripts/test.sh --for-task … --allow-thin` ⇒ exit 0；anti-drift ⇒ `ANTI-DRIFT OK … 2 actual file(s), all within declared Touches`。

## GIT axes (ADR-007)
- 该轴仍暗,理由:本任务只在 `plugin/scripts/discovery-method-routine.ts` 内部合并两个等价读函数，import 图与包边界零变化，未采集 archguard L_D/L_G 读数。

## Touches
- `plugin/scripts/discovery-method-routine.ts`
- `plugin/test/discovery-method-routine.test.mjs`
- `tasks/gap-routine-architecture-analysis-dup-strict-jsonl-reader-two-copies.md`
