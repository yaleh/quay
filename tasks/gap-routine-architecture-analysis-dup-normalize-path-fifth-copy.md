---
id: gap-routine-architecture-analysis-dup-normalize-path-fifth-copy
title: "architecture-analysis: archguard dup hash e964e05c0cd10901: the 10-line
  dot-segment net-path normalizer exists twice byte-identically (2
  implementations repo-wide, `grep -rn 'seg ="
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
archguard dup hash e964e05c0cd10901: the 10-line dot-segment net-path normalizer exists twice byte-identically (2 implementations repo-wide, `grep -rn 'seg === "\.\."'` → exactly these two); gap-b3 unified 4 prior copies into gate-script-base.normalizeRel but the touches-orthogonality-check sibling survived even though that file already imports gate-script-base (line 20) — the 硬规则 5b shape.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792752934532` · ts `2026-10-23T10:55:34.532Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`normalizeRel`、`normalizePath`
- 涉及文件：
- `plugin/scripts/gate-script-base.ts:553`
- `plugin/scripts/touches-orthogonality-check.ts:46`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Import normalizeRel from gate-script-base.ts in touches-orthogonality-check.ts and delete normalizePath (5-line diff, one import edge already exists).

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-23T10:55:34.532Z

## Disposition
**修掉（fixed）** —— 与 suggestedAction 有一处刻意的偏离，理由如下。

`plugin/scripts/touches-orthogonality-check.ts` 已 import `./gate-script-base.ts`（原第 20 行），本次把
`normalizeRel` 加进**同一条 import 语句**（新 import 边 = 0），并删除本地那份 10 行函数体；但**导出名
`normalizePath` 保留为模块作用域的 const 别名**（`export const normalizePath = normalizeRel;`），
而不是按 suggestedAction 字面「delete normalizePath」把符号整个删掉。

⛔ 为什么不直接删符号：`normalizePath` 有 6 个仓内消费者**从这个模块**import（`anti-drift-touches-check.ts`、
`check-set-after-change-check.ts`、`concurrent-batch-scheduler.ts`、`derive-touches-heuristic.ts`、
`driver-filters.ts`，以及 `plugin/workflows/fan-in-execute.js` 生成块里的 import 行）。删符号会把这 6 条
import 边全部打断，是 6 文件的改写而不是「5-line diff」；而本次要找的缺陷是**函数体重复**（两份 byte-identical
的 10 行），不是**名字重复**。别名消掉了重复体、保住了调用面 ⇒ 仓内只剩一份实现。

⛔ 一个实测踩到的形态（写进这里，因为它不是猜测）：先用 `export { normalizeRel as normalizePath }` 写别名，
测试立即红在 `ReferenceError: normalizePath is not defined` —— **re-export 只绑定导出表，不产生模块作用域
绑定**，本模块自己下方的 5 处调用点全部抛错。别名必须是本地声明（`const`），不能是 `export { … as … }`。

复核判据（finding 自己引用的那条谓词，现在跑出来是 1 而不是 2）：
```
$ grep -rn 'seg === "\.\."' plugin/ scripts/ packages/ experiments/ | grep -v node_modules | grep -v /vendor/
plugin/scripts/gate-script-base.ts:558:    if (seg === "..") { out.pop(); continue; }
```
硬规则 5b 的兄弟实例复查：`grep -rn 'out\.pop()'` 在 `plugin/ scripts/ packages/ experiments/` 只另有
`plugin/scripts/runtime-usage-inventory.ts:1068`（`while (out.length && out[out.length - 1] === "") out.pop();`
—— 剥尾部空段，与 dot-segment 规范化无关，非兄弟实例）。

实证（worktree `gap-routine-architecture-analysis-dup-normalize-path-fifth-copy`）：
- 行为等价：对 7 个规范化用例（`./a/b.js` / `a//b.js` / `a/b/` / `a/./b.js` / `a/../a/b.js` / `.//a/b.js` / `a\b.js`）
  逐条断言 `normalizePath(c) === normalizeRel(c)`，全等。
- 测试：`plugin/test/touches-orthogonality-check.test.mjs` + `experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs`
  + `plugin/test/concurrent-batch-scheduler.test.mjs` + `plugin/test/driver-filters.test.mjs` ⇒ 198 tests / 198 pass / 0 fail。

## ADR-007 dark axis
- L_D: dup-normalizer-bodies=1 (was 2), new-import-edges=0, consumer-import-edges-broken=0
（唯一实现 = `gate-script-base.normalizeRel`；`normalizePath` 是别名不是第二份体。L_G 本轮未测量，本任务只改依赖/重复结构，不做包级结构判定。）

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-normalize-path-fifth-copy`（routine `architecture-analysis`，runId `architecture-analysis-1792752934532`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/touches-orthogonality-check.ts`
- `tasks/gap-routine-architecture-analysis-dup-normalize-path-fifth-copy.md`
