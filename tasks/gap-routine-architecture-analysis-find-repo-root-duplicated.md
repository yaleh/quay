---
id: gap-routine-architecture-analysis-find-repo-root-duplicated
title: "architecture-analysis: The 12-line upward walk for tasks/ + .quay is
  byte-identical in two sibling scripts (archguard group d74f85df, 107 tokens) —
  projection and regeneration can "
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
The 12-line upward walk for tasks/ + .quay is byte-identical in two sibling scripts (archguard group d74f85df, 107 tokens) — projection and regeneration can disagree about repo root once one copy is corrected.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793162787359` · ts `2026-10-28T04:46:27.359Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`findRepoRoot`
- 涉及文件：
- `experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.ts:48`
- `experiments/quay-perpetual-stream/scripts/it0-backlog-regen.ts:46`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Hoist findRepoRoot into a shared experiments lib module and import it from both scripts.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-28T04:46:27.359Z

## Disposition
**复核**（findingId `find-repo-root-duplicated`，runId `architecture-analysis-1793162787359`，`.quay/routine-findings.jsonl`）：两个 sibling 脚本各自定义了一份 12 行、逐字节相同的向上根走查（`it0-backlog-projection-check.ts:48` / `it0-backlog-regen.ts:46`）。两处都判「`tasks/` 或 `.quay/` 存在即为仓根」，但没有共享载体 ⇒ 一处被修正、另一处没跟上时，projection check 与 regen 会对「读哪个仓」产生分歧。

**处置 = 修掉**（不是「已注意到」）：
- 删掉两份本地 `findRepoRoot`；两个脚本改为 `import { repoRoot } from "./repo-root.ts"`。`experiments/quay-perpetual-stream/scripts/repo-root.ts` 是指向 `plugin/scripts/repo-root.ts` 的符号链接 ⇒ 仓内仍**只有一个**实现，按仓根形状判定（bundle → consumer → plain-git，含 `git rev-parse --show-toplevel` 与 cwd 兜底），而不是数上溯层数。
- 本 finding 的指称量（本地实现数）：**before=2 → after=0**（`git show develop:<file> | grep -c 'function findRepoRoot'` = 1 / 1；工作树 = 0 / 0）。
- archguard `detect_duplicates`（projectRoot = 任务 worktree，scope = `experiments/quay-perpetual-stream/scripts`，scannedFiles=22 / scannedFunctions=181，minStatements=3 / minTokens=30 —— 门槛**低于**原 finding 的 107-token 组，故是被检集合的超集）：含 `findRepoRoot` 的组（原 hash `d74f85df`）**不再出现**；同一次扫描仍报出这两个文件间的另一组（`4a5818d6ec44f059`，4 行 sort comparator）⇒ 检测器在这两个文件上是活的，不是空转。
- 行为等价（负控制）：`it0-backlog-regen.ts experiments/quay-perpetual-stream` 与 `it0-backlog-projection-check.ts experiments/quay-perpetual-stream` 的 stdout 与 exit code 与 develop 版本逐字节相同。projection check 的 exit 1 是**既有**的 backlog.md 陈旧态（develop 上同样 exit 1、失败行逐行相同），本次改动未改变它、也未掩盖它。

**范围外观察（非阻塞，硬规则 12）**：同一次扫描另见这两个文件间的重复组 `4a5818d6ec44f059`（4 行 sort comparator）。它不在本 finding 的 subject（`findRepoRoot`）内，本次未动；下一次 architecture-analysis 例行扫描会以它自己的 subject 重新报出。

## ADR-007 axis reading
- L_D archguard detect_duplicates(experiments/quay-perpetual-stream/scripts): findRepoRoot-dup-groups=0 (before=1, hash d74f85df, 107 tokens); scannedFiles=22 scannedFunctions=181

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `find-repo-root-duplicated`（routine `architecture-analysis`，runId `architecture-analysis-1793162787359`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `experiments/quay-perpetual-stream/scripts/it0-backlog-projection-check.ts`
- `experiments/quay-perpetual-stream/scripts/it0-backlog-regen.ts`
- `tasks/gap-routine-architecture-analysis-find-repo-root-duplicated.md`