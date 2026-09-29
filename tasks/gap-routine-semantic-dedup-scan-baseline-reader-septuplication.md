---
id: gap-routine-semantic-dedup-scan-baseline-reader-septuplication
title: "semantic-dedup-scan: One behavior copied seven times (bodies hash
  identically after name/path normalization): read the ratchet file, parse
  baseline-count, set of non-comment lines,"
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
One behavior copied seven times (bodies hash identically after name/path normalization): read the ratchet file, parse baseline-count, set of non-comment lines, plus a three-copy shrink-only writer that diverged only in its reason string; no shared ratchet-baseline module exists.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790678624535` · ts `2026-09-29T10:43:44.535Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readBaseline`、`readDodSuiteLineBaseline`、`readBareDirTouchesBaseline`、`readWiringClaimAcProbeBaseline`、`readRatchet`、`readOneEntryBaseline`、`writeBaseline`、`writeRatchet`
- 涉及文件：
- `plugin/scripts/task-ac-carryover-check.ts:213`
- `plugin/scripts/task-contract-check.ts:244`
- `plugin/scripts/task-contract-check.ts:283`
- `plugin/scripts/task-contract-check.ts:327`
- `plugin/scripts/task-contract-check.ts:426`
- `plugin/scripts/touches-one-entry-one-path-check.ts:201`
- `plugin/scripts/threshold-scope-check.ts:386`
- kind：`identity-replication`
- verdict：`real-duplication`

## Requested action
extract

## Disposition

**① 复核（读 JSONL 正本 record，不读本任务正文的转述）**：`.quay/routine-findings.jsonl` 第 1423 行 —
`findingId=baseline-reader-septuplication` · `routine=semantic-dedup-scan` · `runId=semantic-dedup-scan-1790678624535` ·
`dupKind=identity-replication` · `verdict=real-duplication` · `suggestedAction=extract`。逐条复核**成立**：
develop 上 7 处 reader body 逐字相同（只差各自持有的路径常量），3 处 writer body 只差 header 注释与 reason 名词。

**② 处置 = 修掉（extract），⛔ 不是「已注意到」**：

1. 新增唯一正本 `plugin/scripts/ratchet-baseline.ts`。它持有**机制**：`# baseline-count:` 头解析、缺文件 ⇒ 空集合/null 地板、
   非注释行集合、shrink-only 闸的两个拒绝臂（超顶 / 新增条目）。
2. 四个检查器的 **7 个 reader + 3 个 writer 全部改为委派**，共 10 个调用点。每个消费者**自己拥有**的东西
   （文件路径、header 注释、条目名词、超顶建议）改为**调用点传入** —— 所以一个消费者不会静默继承另一个的措辞。
   - `task-ac-carryover-check.ts`：`readBaseline` / `writeBaseline`
   - `task-contract-check.ts`：`readDodSuiteLineBaseline` / `readBareDirTouchesBaseline` / `readWiringClaimAcProbeBaseline` / `readRatchet` / `writeRatchet`
   - `touches-one-entry-one-path-check.ts`：`readOneEntryBaseline`
   - `threshold-scope-check.ts`：`readRatchet` / `writeRatchet`
   公开函数名与签名**逐一保留**（既有调用者与测试的 import 面不变；拒绝措辞逐字保留，例如
   `task-ac-carryover-check` 仍是 `NEW unowned AC(s)` / `give the ACs a carrying successor`）。
3. 新增模块按仓库规矩登记进 `plugin/scripts/capability-catalog-declarations.json`（六表）⇒
   `bash plugin/scripts/capability-catalog.sh` 报 `361 scripts | 361 declared | 0 unclassified | 356 ship`，exit 0。
4. 直接单测 `plugin/test/ratchet-baseline.test.mjs`（12/12 绿），两个拒绝臂都**双向**断言（既断言 `ok:false`，
   也断言**盘上文件未被改写** —— 只断言 reason 会被「先写后返回」的实现蒙混过关）。

**③ 可核读数（修前 / 修后，同一条 grep）**：

- reader 骨架 `text.match(/^# baseline-count`：**修前 7**（task-ac-carryover 1 + task-contract 4 + touches-one-entry 1 + threshold-scope 1）⇒ **修后 0**（四个文件全 0）。
- writer 骨架 `refusing to write:`：**修前 3** ⇒ **修后 0**。
- 唯一实现点：`grep -c '^export const BASELINE_COUNT_RE' plugin/scripts/ratchet-baseline.ts` ⇒ 1。
- 委派调用点合计：2+5+1+2 = **10**（= 7 reader + 3 writer）。
- 全仓 `plugin/scripts` 剩余 `baseline-count` 头解析点只有 3 个文件：`ratchet-baseline.ts`（本正本）+ 下面 ④ 的两个。

**④ 没动的、以及为什么**（硬规则 5b：修完一个实例后 grep 原则的其它适用点，并把命中与结论写下来）：

- `test-isolation-check.ts:900` / `test-framework-policy-check.ts:159` 的 `parseBaselineCount` **不是**本 finding 的 7 个之一：
  它们从**字符串**取 ceiling（**不建条目集合**），且用**另一个、带锚的正则** `^#\s*baseline-count:\s*(\d+)\s*$`。
  那是**另一个函数**，不是本函数的副本 —— 折进来会逼一个正则同时服务两份契约。
  <!-- dedup-ref --> 它们归**同轮立案的兄弟任务** `gap-routine-semantic-dedup-scan-parse-baseline-count-divergent-anchor`
  （finding `parse-baseline-count-divergent-anchor`，其 Touches 恰是那两个文件 + `task-ac-carryover-check.ts`）。
  **本任务因此刻意不改正则**：`ratchet-baseline.ts` 导出的 `BASELINE_COUNT_RE` 就是那 7 个 reader 逐字用过的
  **未锚**正则，把这个分叉**原样留给那个任务**处置，不在本任务里替它做决定（该 finding 的论点正依赖这个差异）。
- `plugin/scripts/` 全量 grep：除上述两处外没有第三处 `baseline-count` 头解析。

**⑤ 探针只立案不执行（DoD 第 2 条）**：`.quay/routine-findings.jsonl` 中本 runId 只有两类 record ——
`kind=finding`（诊断）与 `kind=filing-round`（立案，`filed=[…]`）。**产出者/修复由本派发链的 worker 执行**，例程没有代跑。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `baseline-reader-septuplication`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790678624535`）所描述的问题被复核并处置 —— 复核：JSONL 第 1423 行 record 逐条成立（verdict=real-duplication，suggestedAction=extract）；处置=修掉，抽出 `plugin/scripts/ratchet-baseline.ts`，四个检查器 7 reader + 3 writer 共 10 个调用点改为委派
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 见上「Disposition ③」的可核读数：reader 骨架 7→0、writer 骨架 3→0、唯一实现点 1、委派点 10；命令与数字可原地重跑

## DoD
- [x] 上面的判据实跑通过 —— `bash plugin/scripts/capability-catalog.sh` ⇒ `361 scripts | 361 declared | 0 unclassified` exit 0；`node --test plugin/test/ratchet-baseline.test.mjs` ⇒ 12 pass / 0 fail；四个消费者既有测试（task-ac-carryover-check / task-contract-check / bare-dir-touches-check / touches-one-entry-one-path-check / threshold-scope-check）⇒ 129 pass / 0 fail / 2 skipped（行为未变）；`fan-in-ts-typecheck-gate.ts --task <本任务> --worktree <worktree>` ⇒ typecheck GREEN ADMITTED；`scripts/test.sh --for-task <本任务> --allow-thin` ⇒ exit 0
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 见「Disposition ⑤」：JSONL 中本 runId 只有 `kind=finding` 与 `kind=filing-round` 两类 record，无任何执行/修复 record；修复由本 worker（派发链）执行

## Touches
- `plugin/scripts/ratchet-baseline.ts`
- `plugin/scripts/task-ac-carryover-check.ts`
- `plugin/scripts/task-contract-check.ts`
- `plugin/scripts/touches-one-entry-one-path-check.ts`
- `plugin/scripts/threshold-scope-check.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/ratchet-baseline.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-baseline-reader-septuplication.md`
