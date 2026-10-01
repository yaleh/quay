---
id: gap-routine-semantic-dedup-scan-readgitignorebasenames-dup
title: "semantic-dedup-scan: byte-identical exported bodies (474 chars);
  tick-core-static-check's own JSDoc says it 'mirrors' threshold-scope-check but
  defines its own copy; no shared modu"
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
byte-identical exported bodies (474 chars); tick-core-static-check's own JSDoc says it 'mirrors' threshold-scope-check but defines its own copy; no shared module holds it yet

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790851304231` · ts `2026-10-01T10:41:44.231Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readGitignoreBasenames`
- 涉及文件：
- `plugin/scripts/threshold-scope-check.ts:247`
- `plugin/scripts/tick-core-static-check.ts:302`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract — move to a shared lib and import in both

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `readgitignorebasenames-dup`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790851304231`）所描述的问题被复核并处置 —— 复核：finding 描述**属实**，且是独立复算而非采信——在 pristine `develop` 上，`threshold-scope-check.ts` 与 `tick-core-static-check.ts` 的 `function readGitignoreBasenames(...) { … }` 体**逐字节相同**（三方 sha256 前 16 位 `3c059f301ada1509`，569 chars 含签名+花括号；与 finding 的「474 chars」之差只是计数口径）。处置 = **修掉（extract）**：抽入 `plugin/scripts/fs-walk.ts` —— 两个检查器**已经**因 `buildFileIndex` 导入的那个 leaf，且该文件已持有同族的 gitignore 面（`gitVisiblePaths`）。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 结论 = **修掉**，三条可复跑证据：①**定义数是一个可读的数**：`git grep -l "function readGitignoreBasenames" develop -- 'plugin/scripts/*.ts'` = **2**（threshold-scope-check / tick-core-static-check），改动后同一谓词 `grep -rl` = **1**（fs-walk.ts）。②**纯搬移**：develop 两处与 fs-walk.ts 新家的函数体三方 sha256 全等（`3c059f301ada1509`）⇒ ⛔ 无 regex/logic 编辑。③**行为保持**：`node --test plugin/test/{threshold-scope-check,tick-core-static-check}.test.mjs` **32/32 绿**；公共面未变（两处均 `import { … readGitignoreBasenames } from "./fs-walk.ts"` 且 `export { readGitignoreBasenames };`）。**硬规则 5b 兄弟扫描**：同一 body-hash 谓词扫 `plugin/scripts/*.ts` 全部 `function` 体，除本符号外仍有 **58 组** 字节相同函数体（前 3：`[norm] ac61-staleness-disposition-check.ts:norm | dual-source-check.ts:norm`、`[readFileOrEmpty,readFile,readFileSafe] arch-coverage-report | axis-generator | gate-script-base`、`[git] build-evidence-collector | build-evidence-gate`）——同族缺陷成簇的**存量**，由同一 routine 逐条立案（本窗口 rate 上限 3，多数已被 rate 闸拒），⛔ 超出本任务 Touches，此处只报数不扩范围。

## DoD
- [x] 上面的判据实跑通过 —— 上述命令均已实跑：三方 body sha 对拍（IDENTICAL）、定义数 2→1、两检查器测试 32/32、新增 pins `plugin/test/fs-walk.test.mjs` **21/21**（含「DEFINED once」源扫描负控：任一检查器若重新长出本地副本，definer 集变多即红）、`capability-catalog.sh --entry-surface` rc=0（未新增脚本文件，fs-walk 六表声明已在）。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 复核与修复由本 worker（派发链）执行；探针 `semantic-dedup-scan` 只写入 `.quay/routine-findings.jsonl` 并经 `routine-file-gate.ts` 三闸机械立案，**未运行任何修复**。

## Touches
- `plugin/scripts/fs-walk.ts`
- `plugin/scripts/threshold-scope-check.ts`
- `plugin/scripts/tick-core-static-check.ts`
- `plugin/test/fs-walk.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-readgitignorebasenames-dup.md`

## Needs-Human

**执行 2026-10-01T11:04:04.701Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser attributed no failing file (failure-line count unavailable on this judgment)); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 46
- run_id：wk-prod-anchor
- session_id：464d9078-6122-4c9d-9571-efd9eddb3676
- suite 日志：/data/home/yale/work/quay/.quay/fan-in-suite-gap-routine-semantic-dedup-scan-readgitignorebasenames-dup~wk-prod-anchor~1790852579720-ce5158.log
- fan-in 日志：/data/home/yale/work/quay/.quay/fan-in-gap-routine-semantic-dedup-scan-readgitignorebasenames-dup-wk-prod-anchor.log
