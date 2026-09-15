---
id: gap-routine-semantic-dedup-scan-shell-scan-surface-family
title: "semantic-dedup-scan: collectShellScripts and listExecutableFiles are
  whole-function byte-identical copies (521b / 558b, only JSDoc wording differs)
  and scanSurface is a 5-member sa"
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
collectShellScripts and listExecutableFiles are whole-function byte-identical copies (521b / 558b, only JSDoc wording differs) and scanSurface is a 5-member same-named family whose two largest members are byte-identical including their SCAN_ROOTS constant.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1789322638156` · ts `2026-09-13T18:03:58.156Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`collectShellScripts`、`scanSurface`、`listExecutableFiles`
- 涉及文件：
- `plugin/scripts/adr016-screen-use-check.ts:167`
- `plugin/scripts/dead-code-after-return-check.ts:120`
- `plugin/scripts/fan-in-workflow-retirement-check.ts:219`
- `plugin/scripts/outer-retirement-precondition-check.ts:172`
- `plugin/scripts/kernel-sibling-resolution-check.ts:436`
- `plugin/scripts/target-identity-literal-check.ts:188`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `shell-scan-surface-family`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1789322638156`）所描述的问题被复核并处置 —— 复核结论：finding 描述**属实**，且是复算出来的而非采信：在 pristine base `f451a065b` 上，kernel-sibling-resolution-check / target-identity-literal-check 的 `SCAN_ROOTS`+`SURFACE_SKIP_DIRS`+`scanSurface` body 块**逐字节相同（574 B）**；归一化 body 摘要在 `plugin/scripts/*.ts` 上另得 2 组同形对（`collectShellScripts` ×2、`listExecutableFiles` ×2）。处置 = **修掉（extract）**：三族全部抽入 `plugin/scripts/fs-walk.ts`（本 finding 与 `fs-walk-family` / `firstargregion-stripshellcomments` 同属一次 routine run，该模块正是那一族遍历的落点），原 6 个具名 checker 的定义数全部归 0（四个改为直接调用、两个改为 re-export 别名，公共面未变）。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 结论 = **修掉**，证据三条且可复跑：①**处置量是一个可读的数**：同一归一化 body 摘要，同形组 **3 组 → 1 组**；`collectShellScripts` 2 定义→1、`listExecutableFiles` 2 定义→1、`scanSurface` 四方阵→只剩 concurrency-literal-check / suite-slot-ssot-check 各自那一行 `return scanRoots(root, SCAN_ROOTS, SURFACE_SKIP_DIRS);`（**两张不同的表**，行内已无算法可抽 ⇒ 是地板不是遗漏，已写进 fs-walk.ts 的 5b 记录）。②**行为保持**：6 个 checker CLI 在同一 `--root` 下前后对拍 —— stdout 逐字节相同、退出码相同（含 `fan-in-workflow-retirement-check` 那条与本改动无关的既有 RED：双副本 + 非 wk-prod 锁事件）。③**scoped 门**：`bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-shell-scan-surface-family --allow-thin` EXIT=0（107/107）。

## DoD
- [x] 上面的判据实跑通过 —— 上述命令均已实跑：pristine base 块级 diff（CONFIRMED，574 B）、归一化摘要扫描（before 3 组 / after 1 组）、6 检查器同根前后对拍（6/6 SAME）、`node --test` fs-walk 18/18 与六个 checker 测试文件 89/89、scoped 门 EXIT=0（107 tests / 107 pass）。另有一条**非空转对照**：结论落定前的第一次 scoped 门是 89 tests —— 因为当时 worktree 的任务体还停在 develop 的旧 Touches，未选中本任务新增的 fs-walk 三条断言；同步 Touches 后同一命令变成 107 tests。绿必须能被证明「查到了该查的东西」。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 修复由 worker 派发链执行（worktree `quay-worktrees/gap-routine-semantic-dedup-scan-shell-scan-surface-family`，分支 `task/…`，提交 `5c1697bda` + `d61a79c62`）；例程 `semantic-dedup-scan` 的探针规格自身明写 “DO NOT FIX ANYTHING YOU FIND”，只写了 `.quay/routine-findings.jsonl` 一行 finding 并机械立案，未执行任何修复。

## Touches
- `plugin/scripts/adr016-screen-use-check.ts`
- `plugin/scripts/dead-code-after-return-check.ts`
- `plugin/scripts/fan-in-workflow-retirement-check.ts`
- `plugin/scripts/outer-retirement-precondition-check.ts`
- `plugin/scripts/kernel-sibling-resolution-check.ts`
- `plugin/scripts/target-identity-literal-check.ts`
- `plugin/scripts/fs-walk.ts`
- `plugin/test/fs-walk.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-shell-scan-surface-family.md`