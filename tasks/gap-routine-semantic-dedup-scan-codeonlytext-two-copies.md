---
id: gap-routine-semantic-dedup-scan-codeonlytext-two-copies
title: "semantic-dedup-scan: codeOnlyText is byte-identical (only the doc
  comment differs) and both files carry maskComments; the two files are not a
  whole-file fork (378 vs 384 lines, nea"
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
codeOnlyText is byte-identical (only the doc comment differs) and both files carry maskComments; the two files are not a whole-file fork (378 vs 384 lines, near-disjoint exports) so the true residual overlap is this helper pair

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790218481576` · ts `2026-09-24T02:54:41.576Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`codeOnlyText`、`maskComments`
- 涉及文件：
- `plugin/scripts/fan-in-workflow-retirement-check.ts:215`
- `plugin/scripts/outer-retirement-precondition-check.ts:169`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `codeonlytext-two-copies`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790218481576`）所描述的问题被复核并处置 —— 复核结论：**属实，且是复算出来的而非采信**。base `f36e85ea9` 上：两文件的 `codeOnlyText` **逐字节相同**（仅 JSDoc 不同），`maskComments` 仅差两行行内注释。硬规则 5b 同载体（`plugin/scripts/*.ts`）扫描另得 **第 3 份同语义 `maskComments`**（`registry-bare-filename-scan.ts` —— 它自己的文件头就写着「与 outer-retirement-precondition-check.ts 的 maskComments 同语义」），以及 **第 4 处同计算异名副本**（同文件私有 `stripCommentsIncludingHash`：maskComments + 逐位清空，与 `codeOnlyText` 逐操作相同）。23 例差分对照（行/块/`#` 注释、字符串、模板字面量、转义引号、未闭合字面量、空串）确认三份逐字节一致，且 `codeOnlyText` 恰等于「按掩码清空」。处置 = **修掉（extract）**：`maskComments` / `codeOnlyText` 落 `plugin/scripts/source-text-lib.ts`（该模块声明范围恰为「纯源文本变换」，且不 import 任何模块 ⇒ 单向边、不引入 import 环）；三个 carrier 改为 import（两个保留 re-export，以免动它们自己的测试文件）；异名副本合并进共用名。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 结论 = **修掉**，四条可复跑读数：①**处置量是一个可读的数**：按【代码位置】（`buildNonCodeMask` 掩码后判位置，硬规则 2）枚举 `plugin/scripts/*.ts` 的 `function maskComments(` / `function codeOnlyText(` 声明 —— base = **7 处 / 5 文件**（其中共享 home 之外 5 处同语义），本分支 = **4 处 / 3 文件**（`source-text-lib.ts` 2 处 = 两个名字各一份实现；另 2 处是**已登记的同名异义变体**：kernel-sibling 的空白门 `#`、profiles-role-coverage 的「返回字符串且只认 `//`」）；`stripCommentsIncludingHash` 的代码位置出现数 **1 → 0**。同语义副本（共享 home 之外）**5 → 0**。②**行为保持**：三个 carrier 的 `maskComments` / `codeOnlyText` 与共享 home 在同 23 例语料上逐字节一致（含 re-export 面）；`tsc --noEmit -p tsconfig.json` EXIT=0；受影响的 8 个测试文件 **131/131**；scoped 门 `bash scripts/test.sh --for-task … --allow-thin` EXIT=0（**69/69**，选中 4 个测试文件）。③**防复发**：`plugin/test/source-text-lib.test.mjs` 新增 positional 回归 —— 命中集合必须**恰好等于**已登记的两个异义变体，故新副本出现在任何地方都红、删掉这两个已知变体也红（强制显式更新）；另加三条对照钉住「不可互换」（一输入四原语四答案 / 正则字面量 / `#` 分支空白门）。④**残留已声明，⛔ 不是「闸坏了」**：同一个 findingId 在 `2026-09-18`（runId `semantic-dedup-scan-1789723686226`，symbols 只有 `codeOnlyText`）已被报过一次而**从未立案**；dedup 闸的语料是**板面任务**（`boardKeys`）而不是 findings 载体，当时板上没有对应键，且符号集已漂移（本次多了 `maskComments`）—— 闸自身的头注释正是这么声明这条边界的（exact symbol-set equality）。实测：本任务立案后，同符号集再报 ⇒ dedup 拒（key `symbols:codeonlytext,maskcomments`）；漂移符号集（只 `codeOnlyText`）仍放行。该残留由上述 positional 回归承载。

## DoD
- [x] 上面的判据实跑通过 —— 上述读数均已实跑：base↔本分支 23 例差分对照（逐字节一致）、声明数枚举（before 7 处/5 文件 → after 4 处/3 文件，含两个已登记异义变体）、`tsc --noEmit -p tsconfig.json` EXIT=0、8 个受影响测试文件 131/131、scoped 门 EXIT=0（69/69）。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 修复由 worker 派发链执行（worktree `quay-worktrees/gap-routine-semantic-dedup-scan-codeonlytext-two-copies`，分支 `task/gap-routine-semantic-dedup-scan-codeonlytext-two-copies`，提交 `050daae45`）；例程探针只往 `.quay/routine-findings.jsonl` 写 finding 记录并机械立案，未执行任何修复。

## Touches
- `plugin/scripts/source-text-lib.ts`
- `plugin/scripts/fan-in-workflow-retirement-check.ts`
- `plugin/scripts/outer-retirement-precondition-check.ts`
- `plugin/scripts/registry-bare-filename-scan.ts`
- `plugin/test/source-text-lib.test.mjs`
- `plugin/scripts/capability-catalog-declarations.json`
- `tasks/gap-routine-semantic-dedup-scan-codeonlytext-two-copies.md`