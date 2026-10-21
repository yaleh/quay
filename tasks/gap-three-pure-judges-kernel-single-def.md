---
id: gap-three-pure-judges-kernel-single-def
title: 3 个纯判定函数（countAcCheckboxes / stripTrailingFullWidthAnnotation /
  expandGlob）收敛到 kernel/ 各 1 处定义（6 份 → 3 份）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-909
---
## Proposal

**目标**：把三个无副作用纯判定函数收敛到 `packages/quay/src/kernel/` 各一处定义，产品层与工具层消费方全部 import 同一真身；删除其余 3 份副本。GOAL-906 的范围就是这 3 个名字，判据按名字计数（不是总数），避免 3 份定义集中在同一个名字上仍然绿。

**机械事实（HEAD 按位置核对，`grep -rnE "function NAME\b"`）**：

| 函数 | 现有 2 处定义 |
|---|---|
| countAcCheckboxes | `packages/quay/src/task-parsing.ts:117`、`plugin/scripts/task-schema.ts:431` |
| stripTrailingFullWidthAnnotation | `packages/quay/src/observation.ts:504`、`plugin/scripts/touches-parser.ts:78` |
| expandGlob | `plugin/scripts/canonical-test-files.ts:41`、`scripts/test-coverage-check.ts:122` |

基线读数：三个名字各 2（目标判据当前红）。行号会随编辑漂移，AC 只认名称计数，不认行号。

**为什么机制层可以静态 import kernel/**：`packages/quay/scripts/build-plugin-dist.mjs` 的 `coreSrcAliasPlugin`（:668-686）按 `packages/quay/src/**` 后缀匹配任意 specifier，重指向真实 Core 源树并 INLINE 进 `dist/*.js`。先例：`plugin/scripts/ready-pool-check.ts:188` 静态 import `../../packages/quay/src/kernel/task-shape-artifacts.ts` 并随 `dist/ready-pool-check.js` 出货；`plugin/scripts/regex-escape.ts` 与 `plugin/scripts/shape-sections.ts` 是 kernel 的纯 re-export 垫片（其头注释写明了同一条 inlining 论证）。因此下面三处「机制层不能静态 import packages/ 树」的注释**已过期**，必须一并改正（硬规则 5b：在同一载体里 grep 该说法的其它适用点，而不是只改被点到的那一处）：

- `packages/quay/src/task-parsing.ts:8-9`
- `plugin/scripts/task-schema.ts:427-430`
- `plugin/test/task-parsing-parity.test.mjs:11-12`

**建议落点**（模块名可微调，但定义必须在 kernel/ 下）：`packages/quay/src/kernel/ac-checkbox-count.ts`、`kernel/touches-annotation.ts`、`kernel/glob-expand.ts`。kernel 文件只许 import `node:*`/npm 裸说明符，不得 import kernel 之外的仓库内模块（`plugin/scripts/import-graph-check.ts` 第四规则，`kernelChecked`）。

**实施步骤**：

1. 新建三个 kernel 模块，函数体逐字节迁移（不改判定语义；`countAcCheckboxes` 的 `null → {total:NaN,checked:NaN,unchecked:NaN,sectionFound:false}` fail-closed 形状原样保留）。`globSegmentToRegex` 与 `expandGlob` 一起进 kernel（它是后者的私有辅助，留在原处会变成死代码）。
2. 产品层：`packages/quay/src/task-parsing.ts`、`packages/quay/src/observation.ts` 改为从 kernel import；需要保持旧 import 面时用 `export { ... } from "./kernel/..."`（不含 `function` 关键字）。
3. 工具层：`plugin/scripts/task-schema.ts` 改为 `export { countAcCheckboxes } from "../../packages/quay/src/kernel/ac-checkbox-count.ts"`，这样 `stale-ready-audit.ts` / `task-status-drift-check.ts` / `task-ac-carryover-check.ts` / `worker-driver.ts` / `slot-refill.ts` / `ready-pool-check.ts` 的现有 `./task-schema.ts` import 面不需要动。`plugin/scripts/touches-parser.ts`、`plugin/scripts/canonical-test-files.ts` 同样改为 import kernel。`scripts/test-coverage-check.ts` 从 `../packages/quay/src/kernel/glob-expand.ts` import，并保留其 `export { parseCanonicalGlobs, expandGlob, canonicalTestFiles, ... }`（:254）以免 `plugin/test/test-coverage-check.test.mjs` 的 import 面断掉。
4. 删除 3 份副本函数体与过期注释。**注意判据是字面 grep**：三个被扫目录（`packages/quay/src`、`plugin/scripts`、`scripts`）任何 `.ts` 里都不得出现 `function <NAME>` 字样的注释/文档字符串，否则计数被注释顶成 2。
5. 新增 kernel 单测（`packages/quay/test/kernel-pure-judges.test.mjs`，需带 `// @test-group product` 且用 `node:test`，否则 test-framework-policy 静态检查红）；parity 测试保留行为断言，只改写其过期前提说明。

**非目标**：不改变 AC/DoD 计数、全角注解剥离、glob 展开的语义；不收敛本任务之外的重复（`stripTouchAnnotation` 两份、复数版 `expandGlobs`、drain-scheduler 双副本）。它们与本任务同族但不是 AC-909 点名的名字。

**粒度判定**：`node --experimental-strip-types plugin/scripts/task-granularity-advice.ts --touches <上述源文件> --json` 返回 `peers: []` —— none found，无合并候选。

## AC

- [x] AC1 目标判据绿：`for n in countAcCheckboxes stripTrailingFullWidthAnnotation expandGlob; do c=$(grep -rnE "function ${n}\b" packages/quay/src plugin/scripts scripts --include='*.ts' 2>/dev/null | wc -l); if [ "$c" -ne 1 ]; then echo "$n has $c definitions (want 1)" >&2; exit 1; fi; done; echo "OK: 3 pure-judge functions each have exactly 1 definition"` 退出码 0 且 stdout 为该 OK 行。
- [x] AC2 三个唯一实现全部落在 kernel/：`grep -rnE "function (countAcCheckboxes|stripTrailingFullWidthAnnotation|expandGlob)\b" packages/quay/src plugin/scripts scripts --include='*.ts'` 恰好输出 3 行，且 3 行路径均以 `packages/quay/src/kernel/` 开头（把 3 行原样贴进 Resolution）。
- [x] AC3 消费方接真身（按位置核对 import/export 语句，不按关键词）：`grep -nE 'kernel/(ac-checkbox-count|touches-annotation|glob-expand)\.ts'` 在 `packages/quay/src/task-parsing.ts`、`packages/quay/src/observation.ts`、`plugin/scripts/task-schema.ts`、`plugin/scripts/touches-parser.ts`、`plugin/scripts/canonical-test-files.ts`、`scripts/test-coverage-check.ts` 六个文件中各至少命中 1 行。
- [x] AC4 反向可假（必须记录两次读数）：先在 `plugin/scripts/task-schema.ts` 临时加 `export function countAcCheckboxes(s) { return s; }`，AC1 命令必须退出 1 且 stderr 含 `countAcCheckboxes has 2 definitions (want 1)`；再删除该临时定义，AC1 必须退出 0。提交前 `git diff -- plugin/scripts/task-schema.ts` 里不得留下该临时定义。
- [x] AC5 新增单测覆盖三函数：`node --no-warnings --experimental-strip-types --test packages/quay/test/kernel-pure-judges.test.mjs` 退出 0，且用例覆盖 `null` fail-closed 形状、嵌套全角括号剥离、整段通配 glob 展开三种输入。
- [x] AC6 既有行为测试仍绿：`scripts/test.sh plugin/test/task-parsing-parity.test.mjs plugin/test/touches-parser-parity.test.mjs plugin/test/canonical-test-files-symlink-order.test.mjs plugin/test/test-coverage-check.test.mjs` 退出 0。
- [x] AC7 kernel 边界与图棘轮不升：`node --experimental-strip-types plugin/scripts/import-graph-check.ts` 退出 0，其 `--json` 读数中 `kernelChecked:true` 且 `reverseEdges` 不高于基线。
- [x] AC8 过期说法清零：`grep -rn "WITHOUT the packages/ tree\|不能静态 import packages" packages/quay/src/task-parsing.ts plugin/scripts/task-schema.ts plugin/test/task-parsing-parity.test.mjs` 返回 0 行（三处改写为与 `coreSrcAliasPlugin` 一致的说明）。
- [x] AC9 任务定向套件绿：`scripts/test.sh --for-task gap-three-pure-judges-kernel-single-def` 退出 0（含 scoped 静态检查层）。

## DoD

- [x] 落地产物可读：在 landed 提交上 `git show <commit>:plugin/scripts/task-schema.ts | grep -c 'function countAcCheckboxes'` = 0，且 `git show <commit>:packages/quay/src/kernel/ac-checkbox-count.ts` 非空；另外两个函数同形核对。
- [x] 目标判据在 landed 提交上实跑一次，输出贴进 Resolution（不是只贴实现前的基线）。
- [x] AC4 的两次读数（红/绿）原样贴进 Resolution，证明判据能取假。
- [x] 六个消费方的 kernel import 行原样贴进 Resolution（按位置，不是关键词）。
- [x] 定向套件与 `import-graph-check` 的退出码与实际读数贴进 Resolution。
- [x] 任务体自身的 `## Touches` 与实际改动文件一致（多改/少改都在 Resolution 里说明）。

## Touches

- packages/quay/src/kernel/ac-checkbox-count.ts
- packages/quay/src/kernel/touches-annotation.ts
- packages/quay/src/kernel/glob-expand.ts
- packages/quay/src/task-parsing.ts
- packages/quay/src/observation.ts
- plugin/scripts/task-schema.ts
- plugin/scripts/touches-parser.ts
- plugin/scripts/canonical-test-files.ts
- scripts/test-coverage-check.ts
- packages/quay/test/kernel-pure-judges.test.mjs
- plugin/test/task-parsing-parity.test.mjs
- plugin/test/touches-parser-parity.test.mjs
- plugin/test/canonical-test-files-symlink-order.test.mjs
- plugin/test/test-coverage-check.test.mjs
- tasks/gap-three-pure-judges-kernel-single-def.md

## Resolution

**Outcome**: landed — 三个纯判定函数各 1 处定义，全部在 `packages/quay/src/kernel/` 下；6 份 → 3 份。实现提交 `bb6ec04eb`（task 分支 `task/gap-three-pure-judges-kernel-single-def`）。

以下读数均在该提交上、工作树 clean（`git status --short` 为空）时实跑。

### AC1 目标判据（landed 提交上实跑）

```
$ for n in countAcCheckboxes stripTrailingFullWidthAnnotation expandGlob; do c=$(grep -rnE "function ${n}\b" packages/quay/src plugin/scripts scripts --include='*.ts' 2>/dev/null | wc -l); if [ "$c" -ne 1 ]; then echo "$n has $c definitions (want 1)" >&2; exit 1; fi; done; echo "OK: 3 pure-judge functions each have exactly 1 definition"
OK: 3 pure-judge functions each have exactly 1 definition
$ echo $?
0
```

### AC2 三行唯一定义（原样输出）

```
$ grep -rnE "function (countAcCheckboxes|stripTrailingFullWidthAnnotation|expandGlob)\b" packages/quay/src plugin/scripts scripts --include='*.ts'
packages/quay/src/kernel/ac-checkbox-count.ts:40:export function countAcCheckboxes(acSection) {
packages/quay/src/kernel/touches-annotation.ts:29:export function stripTrailingFullWidthAnnotation(s: string): string {
packages/quay/src/kernel/glob-expand.ts:33:export function expandGlob(pattern: string, root: string): string[] {
```

### AC3 六个消费方的 kernel import/export 行（按位置）

```
$ grep -nE 'kernel/(ac-checkbox-count|touches-annotation|glob-expand)\.ts' packages/quay/src/task-parsing.ts packages/quay/src/observation.ts plugin/scripts/task-schema.ts plugin/scripts/touches-parser.ts plugin/scripts/canonical-test-files.ts scripts/test-coverage-check.ts
packages/quay/src/task-parsing.ts:116:export { countAcCheckboxes } from "./kernel/ac-checkbox-count.ts";
packages/quay/src/observation.ts:48:import { stripTrailingFullWidthAnnotation } from "./kernel/touches-annotation.ts";
plugin/scripts/task-schema.ts:435:export { countAcCheckboxes } from "../../packages/quay/src/kernel/ac-checkbox-count.ts";
plugin/scripts/touches-parser.ts:5:import { stripTrailingFullWidthAnnotation } from "../../packages/quay/src/kernel/touches-annotation.ts";
plugin/scripts/canonical-test-files.ts:26:import { expandGlob } from "../../packages/quay/src/kernel/glob-expand.ts";
scripts/test-coverage-check.ts:45:import { expandGlob } from "../packages/quay/src/kernel/glob-expand.ts";
```

每个文件 ≥1 行；`plugin/scripts/canonical-test-files.ts:29` 另有同源的 re-export（保持本模块历史 import 面）。

### AC4 反向可假 — 两次读数

RED — 在 `plugin/scripts/task-schema.ts` 末尾临时追加 `export function countAcCheckboxes(s) { return s; }` 后，同一 AC1 命令：

```
exit=1
stdout: (empty)
stderr: countAcCheckboxes has 2 definitions (want 1)
```

GREEN — `git checkout -- plugin/scripts/task-schema.ts` 删除临时定义后：

```
$ <AC1 命令>
OK: 3 pure-judge functions each have exactly 1 definition
exit=0
$ git diff -- plugin/scripts/task-schema.ts | grep -c "countAcCheckboxes(s)"
0
```

临时定义未留在提交里（`git status --short` 为空）。

### AC5 新增单测

```
$ node --no-warnings --experimental-strip-types --test packages/quay/test/kernel-pure-judges.test.mjs
✔ ① each pure judge is DECLARED exactly once, under packages/quay/src/kernel/
✔ ② product entry, mechanism entry and kernel leaf expose the SAME countAcCheckboxes object
✔ ③ countAcCheckboxes — null is FAIL-CLOSED, not { unchecked: 0 } (structural NaN)
✔ ③ stripTrailingFullWidthAnnotation — NESTED full-width parens strip to the matching opener
✔ ③ expandGlob — a whole-segment `*` expands against the root; `*` never crosses `/`
ℹ tests 5  pass 5  fail 0   exit=0
```

AC5 点名的三类输入均有覆盖：`null` fail-closed 形状、嵌套全角括号剥离、整段通配 glob 展开（每类附负控制，避免空转）。

### AC6 既有行为测试

```
$ bash scripts/test.sh plugin/test/task-parsing-parity.test.mjs plugin/test/touches-parser-parity.test.mjs plugin/test/canonical-test-files-symlink-order.test.mjs plugin/test/test-coverage-check.test.mjs
ℹ tests 35  pass 35  fail 0   exit=0
```

### AC7 kernel 边界与图棘轮

```
$ node --experimental-strip-types plugin/scripts/import-graph-check.ts --json
{"evaluated":true,"reverseEdges":[],"kernelChecked":true,"kernelViolations":[],
 "verdict":{"ok":true,"over":[],"baselineRaised":[],
            "headBaseline":{"valueSccs":0,"typeSccs":0,"reverseEdges":0},
            "bootstrap":false,"kernelBlocked":false}}
exit=0
```

`reverseEdges` 计数 0，与基线 `{valueSccs:0, typeSccs:0, reverseEdges:0}` 相同（未升）；`kernelViolations` 为空。

### AC8 过期说法清零

```
$ grep -rn "WITHOUT the packages/ tree\|不能静态 import packages" packages/quay/src/task-parsing.ts plugin/scripts/task-schema.ts plugin/test/task-parsing-parity.test.mjs
（0 行）exit=1
```

三处均改写为与 `coreSrcAliasPlugin` 一致的说明（指向 `build-plugin-dist.mjs` 的 re-point + INLINE；先例 `ready-pool-check.ts` 静态 import `kernel/task-shape-artifacts.ts` 并随 dist 出货）。

### AC9 任务定向套件（含 scoped 静态检查层）

```
$ bash scripts/test.sh --for-task gap-three-pure-judges-kernel-single-def --allow-thin
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
  scoped check: run_checker "import-graph-check" ...
  scoped check: run_checker "test-framework-policy-check" ...
  ...（scoped 层已执行；NOT-EVALUATED 项仅 it0-split-or-commit-check --changed，见其自身说明）
ℹ tests 222  pass 222  fail 0   exit=0
```

### DoD 落地产物（`git show bb6ec04eb:<path>`）

```
plugin/scripts/task-schema.ts            'function countAcCheckboxes'                  → 0
packages/quay/src/task-parsing.ts        'function countAcCheckboxes'                  → 0
plugin/scripts/touches-parser.ts         'function stripTrailingFullWidthAnnotation'   → 0
packages/quay/src/observation.ts         'function stripTrailingFullWidthAnnotation'   → 0
plugin/scripts/canonical-test-files.ts   'function expandGlob'                         → 0
scripts/test-coverage-check.ts           'function expandGlob'                         → 0
packages/quay/src/kernel/ac-checkbox-count.ts    → 48 行（非空）
packages/quay/src/kernel/touches-annotation.ts   → 44 行（非空）
packages/quay/src/kernel/glob-expand.ts          → 63 行（非空）
```

另：`npx tsc --noEmit -p tsconfig.json` 在该提交上 exit 0。

### Touches 一致性

`node --no-warnings --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts --task gap-three-pure-judges-kernel-single-def --worktree <wt> --merge-target develop` →

```
ANTI-DRIFT OK: task gap-three-pure-judges-kernel-single-def — 11 actual file(s), all within declared Touches (15 glob(s))
exit=0
```

**少改说明**（声明但未编辑的 3 个）：`plugin/test/touches-parser-parity.test.mjs`、`plugin/test/canonical-test-files-symlink-order.test.mjs`、`plugin/test/test-coverage-check.test.mjs` —— 它们在收敛后无需改动即通过（AC6），列入 Touches 是因为本任务执行/核对了它们。第 15 条 `tasks/gap-three-pure-judges-kernel-single-def.md` 由 `task_write` 写入。**无 Touches 之外的改动。**

### 范围诚实

- 只收敛 AC-909 点名的 3 个名字；同族但未点名的重复（`stripTouchAnnotation` 两份、复数版 `expandGlobs`、drain-scheduler 双副本）按非目标保留。
- `plugin/scripts/loop-complete-task.ts:21` 与 `plugin/scripts/malformed-task-check.ts:55` 仍带有同族旧表述，但它们是**另一批文件的动态 import 理由**，不在本任务 Touches 内；按 anti-drift 纪律未越界修改，记为后续观察项。
