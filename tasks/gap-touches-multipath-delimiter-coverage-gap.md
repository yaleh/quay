---
id: gap-touches-multipath-delimiter-coverage-gap
title: flagMultiPathTouchEntries 只测 ' / ' 分隔——'、' 全角分隔的 Touches 复合条目漏检，anti-drift 首次才拦（AC76 fan-in 实证）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（inner 2026-08-16 立案——AC76 fan-in 实证：`touches-parser.ts` 每个 bullet 一个 composite glob，`、` 分隔的两路径条目（`plugin/scripts/a.ts、plugin/scripts/b.ts`）在 anti-drift 处 HARD-FAIL（out-of-declared）。`checkTaskOneEntryOnePath` 的 `flagMultiPathTouchEntries` 只测 `' / '` 分隔符，`'、'`（全角顿号）是覆盖缺口——首个机制是 anti-drift 才拦到后果（作者时检查器没拦）。）**

**现象**：`tasks/gap-ac76-tick-core-retirement-cleanup.md` 的 Touches 曾有两条 `、`-复合 bullet（`slot-refill.ts、fast-mode-telemetry.ts` / `red-on-omission-audit.ts、red-on-omission-audit.test.mjs`），fan-in 的 anti-drift-touches-check HARD-FAIL。`flagMultiPathTouchEntries` 只测 `' / '`（半角斜杠分隔）⇒ `、` 漏检 ⇒ 作者时无红。

**修法**：`flagMultiPathTouchEntries`（及其判定）扩展分隔符集，覆盖 `、`（全角顿号）/ `，`（全角逗号）/ `,`（半角逗号）等多路径分隔——任何 single bullet 含 ≥2 个路径 ⇒ 红。保持现有单路径条目不误报。

**判据1**：`、`-复合 Touches bullet 被作者时检查器标红（不再只靠 anti-drift）。
**判据2（能取假）**：单路径条目不误报；多路径（' / ' 或 '、'）标红。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 flagMultiPathTouchEntries（所在文件：touches 相关检查器/parser）+ 测试。
2. 扩展分隔符集（'、'/'，'/','等），加负控制（单路径不误报）。
3. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：`、`-复合 Touches bullet 作者时标红。
- [x] AC2 判据2 能取假：单路径不误报；多路径（/ 或 、）标红。
- [x] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] flagMultiPathTouchEntries 覆盖全角分隔符，`、`-复合条目不再漏检（AC76 fan-in 教训固化）。

## Evidence

**实现（`plugin/scripts/touches-one-entry-one-path-check.ts`）**：
- 新增 `MULTI_PATH_SEPARATOR_RE = / \/ |、|，|,/`——分隔符集 = 既有 `" / "` + 全角顿号 `、` + 全角逗号 `，` + 半角逗号 `,`。
- **精度启发**（判据2 能取假，避免误报）：分隔符在场**不够**——`flagMultiPathTouchEntries` 现先 `stripAllTouchAnnotations`（剥 `（…）`/`(...)` 注解）再 `replace(BRACE_GROUP_RE, "")`（剥 `{a,b}` glob 花括号展开——逗号是 glob 语法不是路径分隔），再按分隔符 split，**仅当 ≥2 个 token 是 path-like**（`PATH_TOKEN_RE`：含 `/`+点后缀，或裸文件名+已知仓库扩展名 .ts/.js/.mjs/.md/.sh/.json/.yml/.tsx…）才标红。
- 判词（`checkTaskOneEntryOnePath`）同步改为「含多路径分隔（" / " / "、" / "，" / ","）」。

**测试（`plugin/test/touches-one-entry-one-path-check.test.mjs`）**：新增 4 组判据2 用例——
`、`-复合（AC76 实证形）标红 / `，`-复合标红 / `,`-复合标红 / 混合 ` / `+`、` 三路径只标 1 次；负控制：单路径 + 顿号/逗号在 `（…）` 注解内 ⇒ 不误报。
`node --test plugin/test/touches-one-entry-one-path-check.test.mjs` = **15 tests / 15 pass / 0 fail**。

**Scoped 门**：`bash scripts/test.sh --for-task gap-touches-multipath-delimiter-coverage-gap --allow-thin` = **EXIT 0**（15/15 pass；含 ts-typecheck/esbuild + scoped 静态检查 + task-contract-check no violations）。注：worktree 无 node_modules，按 `gap-worktree-node-modules-inconsistent-self-verify` 惯例建符号链接 → `/home/yale/work/quay/node_modules`。

**⚠️ 扫描暴露 2 条既有真实 `、`-复合 bullet（判据2 能取假的正向证据）**：扩展分隔符后，全仓扫描（`scanTasksOneEntryOnePath`）新标红 2 条 **status=done 历史任务**——`tasks/gap-serve-pid-derived-port-collision-family.md`（11 个 `.mjs` 一 bullet）与 `tasks/gap-tmp-dir-leak-unpaired-mkdtemp-cleanup.md`（5 个 `.mjs` 一 bullet）——旧 `" / "`-only 检查看不见它们（与 AC76 fan-in 同形漏检）。二者不在本任务 Touches 内、无法在本任务拆（anti-drift 会拦 out-of-declared），故扫描测试断言**恰好这 2 条**（CLI exit 1 且点名），留待后续任务逐个拆成一条目一行。其余 prose/时间戳/花括号展开 bullet 均**不**误报（判定已验证）。

## Touches

- plugin/scripts/touches-one-entry-one-path-check.ts（flagMultiPathTouchEntries 多路径分隔符扩展——覆盖 '、'/'，'/','）
- plugin/test/touches-one-entry-one-path-check.test.mjs（对应负控制测试）
- tasks/gap-touches-multipath-delimiter-coverage-gap.md（自身）
