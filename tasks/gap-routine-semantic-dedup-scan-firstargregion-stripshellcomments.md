---
id: gap-routine-semantic-dedup-scan-firstargregion-stripshellcomments
title: "semantic-dedup-scan: Both pairs have identical algorithms —
  firstArgRegion differs only in parameter ORDER (283b vs 295b),
  stripShellComments only in brace layout (679b vs 777b); t"
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
Both pairs have identical algorithms — firstArgRegion differs only in parameter ORDER (283b vs 295b), stripShellComments only in brace layout (679b vs 777b); the size gaps that made them look diverged are formatting.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1789322638156` · ts `2026-09-13T18:03:58.156Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`firstArgRegion`、`stripShellComments`
- 涉及文件：
- `plugin/scripts/task-file-bypass-check.ts:126`
- `plugin/scripts/test-isolation-check.ts:537`
- `plugin/scripts/adr016-screen-use-check.ts:137`
- `plugin/scripts/dead-code-after-return-check.ts:78`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `firstargregion-stripshellcomments`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1789322638156`）所描述的问题被复核并处置 —— 复核结论：finding 描述属实（两对算法完全相同，只有格式/参数序之差）。处置=**修掉（extract）**：`firstArgRegion` / `stripShellComments` / `stripComments` 三大符号全仓（excl. node_modules）各只剩 1 处定义，都在 `plugin/scripts/source-text-lib.ts`；原 4 个具名文件定义数全部为 0（`adr016-screen-use-check` / `dead-code-after-return-check` 改为 re-export，公共面未变）。5b 同载体扫描另发现**同族第三对** `stripComments`（`registry-bare-filename-scan.ts:526` vs `runtime-usage-inventory.ts:590`，逐字节相同）一并抽取。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 结论=修掉，证据三条且可复跑：①行为保持（6 个检查器 CLI 在同 `--root` 下前后对拍：stdout 逐字节相同、stderr 相同（仅去掉 node 自带的 MODULE_TYPELESS 行）、退出码相同）；②`plugin/test/source-text-lib.test.mjs` 的对照（两个剥注释器**互不可替代**，双向断言）经突变检验——给 `stripShellComments` 加上 `//` 处理后恰好只有该对照转红；③scoped 门 `scripts/test.sh --for-task <id> --allow-thin` 退出码 0。

## DoD
- [x] 上面的判据实跑通过 —— 上述命令均已实跑：符号定义枚举、6 检查器前后对拍、`node --test plugin/test/source-text-lib.test.mjs`（10/10）、突变对照（红/复原）、scoped 门（EXIT=0）。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 本任务的修复由 worker 派发链执行（worktree `quay-worktrees/gap-routine-semantic-dedup-scan-firstargregion-stripshellcomments`，分支 `task/…`，提交 `15e604559`）；例程 `semantic-dedup-scan` 只写了 `.quay/routine-findings.jsonl` 一行 finding 并机械立案，未执行任何修复。

## Touches
- `plugin/scripts/task-file-bypass-check.ts`
- `plugin/scripts/test-isolation-check.ts`
- `plugin/scripts/adr016-screen-use-check.ts`
- `plugin/scripts/dead-code-after-return-check.ts`
- `plugin/scripts/registry-bare-filename-scan.ts`
- `plugin/scripts/runtime-usage-inventory.ts`
- `plugin/scripts/source-text-lib.ts`
- `plugin/scripts/capability-catalog.sh`
- `plugin/test/source-text-lib.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-firstargregion-stripshellcomments.md`
